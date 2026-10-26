from typing import TypedDict
from uuid import UUID

from fastapi import HTTPException
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from psycopg.types.json import Jsonb

from .generator import MODEL, generate_plan
from .models import TestPlan
from .runner import execute
from .validation import validate_plan


class WorkflowState(TypedDict, total=False):
    run_id: str
    objective: str
    case_count: int
    attempt: int
    feedback: str
    plan: dict
    generation: dict
    validation_error: str | None
    approved: bool
    result: dict


def build_graph(database, base_url, root):
    def draft(state: WorkflowState):
        with database() as connection:
            run = connection.execute("SELECT * FROM runs WHERE id = %s", (UUID(state["run_id"]),)).fetchone()
        objective = state["objective"]
        if state.get("feedback"):
            objective += "\nCorrect this validation error from the previous draft: " + state["feedback"]
        calls = []
        plan, response_id, tokens = generate_plan(
            run, objective, database, base_url, calls, case_count=state.get("case_count", 20),
        )
        attempts = state.get("generation", {}).get("attempts", [])
        attempts = [*attempts, {"response_id": response_id, "total_tokens": tokens, "calls": calls}]
        return {
            "attempt": state["attempt"] + 1,
            "plan": plan.model_dump(mode="json"),
            "generation": {"model": MODEL, "objective": state["objective"],
                           "case_count": state.get("case_count", 20), "attempts": attempts},
            "validation_error": None,
        }

    def validate(state: WorkflowState):
        with database() as connection:
            run = connection.execute("SELECT * FROM runs WHERE id = %s", (UUID(state["run_id"]),)).fetchone()
            try:
                plan = TestPlan.model_validate(state["plan"])
                case_count = state.get("case_count", 20)
                if len(plan.cases) != case_count:
                    return {"validation_error": f"Create exactly {case_count} distinct cases; received {len(plan.cases)}."}
                validate_plan(connection, run, plan)
            except (HTTPException, ValueError) as error:
                return {"validation_error": str(getattr(error, "detail", error))[:1000]}
            connection.execute(
                """UPDATE runs SET status = 'awaiting_review', plan = %s, generation = %s, workflow = %s
                   WHERE id = %s""",
                (Jsonb(state["plan"]), Jsonb(state["generation"]),
                 Jsonb({"phase": "awaiting_review", "attempts": state["attempt"]}), UUID(state["run_id"])),
            )
        return {"validation_error": None}

    def after_validation(state: WorkflowState):
        if not state.get("validation_error"):
            return "review"
        return "repair" if state["attempt"] < 2 else "invalid"

    def repair(state: WorkflowState):
        return {"feedback": state["validation_error"]}

    def invalid(state: WorkflowState):
        with database() as connection:
            connection.execute(
                "UPDATE runs SET status = 'error', generation = %s, workflow = %s WHERE id = %s",
                (Jsonb(state["generation"]),
                 Jsonb({"phase": "invalid", "reason": state["validation_error"], "attempts": state["attempt"]}),
                 UUID(state["run_id"])),
            )
        return {}

    def review(state: WorkflowState):
        approved = interrupt({"run_id": state["run_id"], "plan": state["plan"]})
        return {"approved": bool(approved)}

    def after_review(state: WorkflowState):
        return "execute" if state["approved"] else "rejected"

    def rejected(state: WorkflowState):
        with database() as connection:
            connection.execute(
                "UPDATE runs SET status = 'rejected', workflow = %s WHERE id = %s AND status = 'awaiting_review'",
                (Jsonb({"phase": "rejected", "attempts": state["attempt"]}), UUID(state["run_id"])),
            )
        return {}

    def run_browser(state: WorkflowState):
        run_id = UUID(state["run_id"])
        with database() as connection:
            row = connection.execute(
                """UPDATE runs SET status = 'running', workflow = %s
                   WHERE id = %s AND status = 'awaiting_review' RETURNING plan""",
                (Jsonb({"phase": "running", "attempts": state["attempt"]}), run_id),
            ).fetchone()
        if row is None:
            # shortcut: browser side effects cannot be replayed safely after a crash; require a new run.
            result = {"status": "error", "error": "Execution state is uncertain; create a new run", "cases": []}
            with database() as connection:
                connection.execute(
                    "UPDATE runs SET status = 'error', result = %s WHERE id = %s AND status = 'running'",
                    (Jsonb(result), run_id),
                )
            return {"result": result}
        try:
            result = execute(TestPlan.model_validate(row["plan"]), run_id, base_url, root / ".local" / "runs")
        except Exception as error:
            result = {"status": "error", "error": str(error)[:2000], "cases": []}
        with database() as connection:
            connection.execute(
                "UPDATE runs SET status = %s, result = %s WHERE id = %s AND status = 'running'",
                (result["status"], Jsonb(result), run_id),
            )
        return {"result": result}

    def report(state: WorkflowState):
        with database() as connection:
            connection.execute(
                "UPDATE runs SET workflow = %s WHERE id = %s",
                (Jsonb({"phase": "completed", "attempts": state["attempt"],
                        "result_status": state["result"]["status"]}), UUID(state["run_id"])),
            )
        return {}

    graph = StateGraph(WorkflowState)
    for name, node in (("draft", draft), ("validate", validate), ("repair", repair),
                       ("invalid", invalid), ("review", review), ("rejected", rejected),
                       ("execute", run_browser), ("report", report)):
        graph.add_node(name, node)
    graph.add_edge(START, "draft")
    graph.add_edge("draft", "validate")
    graph.add_conditional_edges("validate", after_validation)
    graph.add_edge("repair", "draft")
    graph.add_edge("invalid", END)
    graph.add_conditional_edges("review", after_review)
    graph.add_edge("rejected", END)
    graph.add_edge("execute", "report")
    graph.add_edge("report", END)
    return graph
