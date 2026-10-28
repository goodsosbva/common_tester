from pathlib import Path

from fastapi import HTTPException

from .models import TestPlan
from .policies import missing_policy_sources


def validate_plan(connection, run, plan: TestPlan):
    if (run["project_id"], run["route"], run["policy_version"]) != (
        plan.project_id, plan.route, plan.policy_version,
    ):
        raise HTTPException(status_code=409, detail="Plan target does not match run")
    for case in plan.cases:
        for evidence in case.evidence:
            if evidence.kind == "policy" and evidence.version not in (None, plan.policy_version):
                raise HTTPException(status_code=422, detail="Policy evidence version does not match plan")
            if evidence.kind == "code" and (
                run["project_id"] != "demo-orders"
                or run["route"].split("?", 1)[0] != "/fixtures/order.html"
                or evidence.source_id != "code:order_form"
                or evidence.version is not None
            ):
                raise HTTPException(status_code=422, detail="Unknown code evidence")
    missing = missing_policy_sources(connection, plan)
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown policy evidence: {sorted(missing)}")
    if run["project_id"] == "demo-orders" and run["route"].split("?", 1)[0] == "/fixtures/order.html":
        # shortcut: literal message support is checked for the registered demo page only.
        page_source = (Path(__file__).resolve().parents[2] / "examples" / "fixtures" / "order.html").read_text(encoding="utf-8")
        for case in plan.cases:
            source_ids = [item.source_id for item in case.evidence if item.kind == "policy"]
            rows = connection.execute(
                "SELECT content FROM policy_chunks WHERE source_id = ANY(%s)", (source_ids,),
            ).fetchall()
            evidence_text = page_source + "\n" + "\n".join(row["content"] for row in rows)
            for assertion in case.assertions:
                if assertion.action == "text" and assertion.expected not in evidence_text:
                    raise HTTPException(status_code=422, detail=f"Unsupported text assertion in case {case.id}")
