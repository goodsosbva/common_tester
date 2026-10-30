import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from core import ROOT
from playwright_runner import run_folder, execution_folder


QUADRANTS = {("allow", "allow"): "TP", ("allow", "deny"): "FN", ("deny", "allow"): "FP", ("deny", "deny"): "TN"}
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def save_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def classify(expected: str, actual: str | None, execution_error: bool = False) -> str | None:
    return None if execution_error else QUADRANTS.get((expected, actual))


def summarize_results(run_id: str, execution_id: str, *, publish: bool = True) -> dict:
    folder = run_folder(run_id)
    output = execution_folder(run_id, execution_id)
    execution = json.loads((output / "execution.json").read_text(encoding="utf-8"))
    spec = json.loads((folder / "test-spec.json").read_text(encoding="utf-8"))
    requirements = {item["requirement_key"]: item for item in spec["requirements"]}
    scenarios = {case["scenario_key"]: {**case, "requirement_key": req["requirement_key"]} for req in spec["requirements"] for case in req["scenarios"]}
    base = f"/api/runs/{run_id}/executions/{execution_id}/files/"
    cases = []
    for case in execution["cases"]:
        requirement = requirements.get(case["requirement_key"], {})
        observation = case.get("observation") or {}
        errors = [ANSI.sub("", error.get("message", str(error))) for error in case.get("errors", [])]
        infrastructure = case["status"] in {"interrupted", "timedOut"} or any(marker in "\n".join(errors) for marker in ("browserType.launch", "strict mode violation", "net::ERR_CONNECTION_REFUSED", "Target page, context or browser has been closed", "browser has been closed"))
        actual = observation.get("actual_policy", "unknown")
        if actual not in {"allow", "deny"}:
            actual = "unknown"
        quadrant = classify(case["expected_policy"], actual, infrastructure)
        policy_mismatch = quadrant in {"FN", "FP"}
        failed = case["status"] in {"failed", "timedOut"} or policy_mismatch or bool(case.get("capture_error"))
        verdict = "execution_error" if infrastructure else "failed" if failed else "unconfirmed" if quadrant is None else "passed"
        cases.append({
            **case, "test_status": case["status"], "verdict": verdict, "classification": quadrant,
            "actual_policy": actual, "observation": observation,
            "observation_reason": case.get("observation_error") or observation.get("reason") or "이 실행에는 실제 허용/거부 관찰 기록이 없습니다.",
            "requirement_id": requirement.get("requirement_id", case["requirement_key"].split("@")[0]),
            "requirement_title": requirement.get("title", "요구사항"),
            "source_text": requirement.get("source_text", ""), "errors": errors,
            "situation": scenarios.get(case["scenario_key"], {}).get("situation", ""),
            "actions": scenarios.get(case["scenario_key"], {}).get("actions", []),
            "screenshot_files": [{"path": path, "url": base + quote(path, safe="/")} for path in case["screenshots"]],
            "trace_files": [{"path": path, "url": base + quote(path, safe="/")} for path in case["traces"]],
        })
    order = {"execution_error": 0, "failed": 1, "unconfirmed": 2, "passed": 3}
    cases.sort(key=lambda item: (order[item["verdict"]], item["scenario_key"]))
    unexecuted = []
    for item in execution["unexecuted"]:
        scenario = scenarios.get(item["scenario_key"], {})
        requirement = requirements.get(scenario.get("requirement_key"), {})
        unexecuted.append({**item, "requirement_title": requirement.get("title", "요구사항"), "expected_policy": scenario.get("expected_policy"), "expected_observation": scenario.get("expected_observation", ""), "source_text": requirement.get("source_text", ""), "source_refs": requirement.get("source_refs", [])})
    counts = {
        "planned": len(scenarios), "executed": len(cases),
        "test_passed": sum(case["test_status"] == "passed" for case in cases),
        "failed": sum(case["verdict"] == "failed" for case in cases),
        "unconfirmed": sum(case["classification"] is None and case["verdict"] != "execution_error" for case in cases),
        "execution_errors": sum(case["verdict"] == "execution_error" for case in cases) + int(execution["status"] == "execution_error"),
        "unexecuted": len(unexecuted), "screenshots": execution["counts"]["screenshots"],
        "capture_errors": execution["counts"]["capture_errors"],
        "quadrants": {name: sum(case["classification"] == name for case in cases) for name in ("TP", "FN", "FP", "TN")},
    }
    report = {
        "run_id": run_id, "execution_id": execution_id, "product": spec["product"], "version": spec["version"], "scope": spec["scope"],
        "target_url": execution["target_url"], "started_at": execution["started_at"], "finished_at": execution["finished_at"],
        "status": execution["status"], "error": execution.get("error"), "summary": counts,
        "cases": cases, "failures": [case for case in cases if case["verdict"] in {"failed", "execution_error"}],
        "unexecuted": unexecuted,
        "unresolved": [{**item, "requirement_title": requirements.get(item["requirement_key"], {}).get("title", "요구사항")} for item in spec.get("unresolved", [])],
        "test_sources": [{**source, "url": base + "test-source/" + quote(source["file"])} for source in execution.get("test_sources", [])],
        "artifacts": {name: base + name for name in ("execution.json", "failures.json", "playwright-results.json", "playwright.log")},
    }
    save_json(output / "report.json", report)
    if publish:
        latest_file = folder / "report.json"
        latest = json.loads(latest_file.read_text(encoding="utf-8")) if latest_file.is_file() else {}
        if not latest or latest.get("started_at", "") <= report["started_at"]:
            save_json(latest_file, report)
    return report


def execution_summaries(folder: Path) -> list[dict]:
    rows = []
    for path in (folder / "executions").glob("*/execution.json"):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            report_file = path.parent / "report.json"
            summary = json.loads(report_file.read_text(encoding="utf-8"))["summary"] if report_file.is_file() else None
            rows.append({"execution_id": raw["execution_id"], "target_url": raw["target_url"], "started_at": raw["started_at"], "status": raw["status"], "counts": raw["counts"], "summary": summary})
        except (OSError, ValueError, KeyError):
            continue
    return sorted(rows, key=lambda item: item["started_at"], reverse=True)


def run_detail(run_id: str) -> dict:
    folder = run_folder(run_id)
    def read(name):
        file = folder / name
        return json.loads(file.read_text(encoding="utf-8")) if file.is_file() else {}
    spec, generation, pipeline = read("test-spec.json"), read("generation.json"), read("pipeline.json")
    return {
        "run_id": run_id, "product": spec.get("product", pipeline.get("product", "")), "version": spec.get("version", pipeline.get("version", "")),
        "scope": spec.get("scope", pipeline.get("scope", "")), "target_url": spec.get("target_url", pipeline.get("target_url", "")),
        "created_at": pipeline.get("created_at") or datetime.fromtimestamp((folder / "test-spec.json" if spec else folder).stat().st_ctime, timezone.utc).isoformat(),
        "requirement_count": len(spec.get("requirements", [])), "scenario_count": sum(len(req["scenarios"]) for req in spec.get("requirements", [])),
        "generated_count": generation.get("discovered_test_count", 0), "unsupported_count": generation.get("unsupported_count", 0),
        "status": pipeline.get("status") or ("generated" if generation else "handoff" if spec else "empty"),
        "current_node": pipeline.get("current_node"), "error": pipeline.get("error"),
        "executions": execution_summaries(folder),
    }


def list_runs() -> list[dict]:
    rows = []
    for folder in (ROOT / ".local" / "runs").glob("*"):
        if not folder.is_dir() or not re.fullmatch(r"[a-f0-9]{32}", folder.name):
            continue
        try:
            rows.append(run_detail(folder.name))
        except (OSError, ValueError, KeyError):
            continue
    return sorted(rows, key=lambda item: item["created_at"], reverse=True)
