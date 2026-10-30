"""Check token preservation and the completed normal/defect browser executions."""
import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

import core
from main import app
from workflow import WORKFLOW_GRAPH


root = core.ROOT
latest = json.loads((root / ".local" / "stage4-latest.json").read_text(encoding="utf-8"))
run_id = latest["run_id"]
folder = root / ".local" / "runs" / run_id
with sqlite3.connect(core.version_path("product", "v1") / "embeddings.sqlite3") as db:
    rows = db.execute("SELECT path,paragraph_no,chunk_no,content,embedding FROM chunks ORDER BY path,paragraph_no,chunk_no").fetchall()
    metadata = dict(db.execute("SELECT key,value FROM metadata"))
assert metadata["chunking"] == core.CHUNKING_VERSION
for path, paragraphs in [("requirements.md", core.paragraphs(core.version_path("product", "v1") / "requirements.md"))]:
    for number, original in enumerate(paragraphs, 1):
        chunks = [row[3] for row in rows if row[0] == path and row[1] == number]
        assert "".join(chunks) == original, (path, number)
assert all(len(core.chunk_tokenizer().encode(row[3]).ids) <= core.EMBEDDING_TOKEN_LIMIT for row in rows)
assert all(len(json.loads(row[4])) == 384 for row in rows)
assert {"retrieve_evidence", "build_handoff", "generate_playwright", "run_playwright"} <= set(WORKFLOW_GRAPH.get_graph().nodes)
spec = json.loads((folder / "test-spec.json").read_text(encoding="utf-8"))
expected = {scenario["scenario_key"] for req in spec["requirements"] for scenario in req["scenarios"]}
refs = {(row[0], row[1], row[2]) for row in rows}
for req in spec["requirements"]:
    for case in req["scenarios"]:
        assert case["source_refs"] == req["source_refs"]
        assert all((ref["path"], ref["paragraph_no"], ref["chunk_no"]) in refs for ref in case["source_refs"])
coverage = json.loads((folder / "generated-tests" / "coverage.json").read_text(encoding="utf-8"))["scenarios"]
assert len({item["scenario_key"] for item in coverage}) == len(coverage)
assert {item["scenario_key"] for item in coverage} == expected
modes = ("normal", "email", "blank-accepted", "warning-color", "warning-position")
assert set(modes) <= set(latest["executions"])
assert len({latest["executions"][mode]["execution_id"] for mode in modes}) == len(modes)
executions = {}
for mode in modes:
    execution_id = latest["executions"][mode]["execution_id"]
    output = folder / "executions" / execution_id
    execution = json.loads((output / "execution.json").read_text(encoding="utf-8"))
    assert execution["status"] == "completed", (mode, execution["error"])
    assert execution["counts"]["capture_errors"] == 0, mode
    assert execution["counts"]["skipped"] == 0, mode
    assert {case["scenario_key"] for case in execution["cases"]} == {item["scenario_key"] for item in coverage if item["status"] == "generated"}
    assert {item["scenario_key"] for item in execution["unexecuted"]} == {item["scenario_key"] for item in coverage if item["status"] == "unsupported"}
    for case in execution["cases"]:
        assert case["screenshots"], (mode, case["title"])
        for screenshot in case["screenshots"]:
            file = output / screenshot
            assert file.resolve().is_relative_to(output.resolve())
            assert file.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"), file
        if case["status"] in {"failed", "timedOut"}:
            assert case["errors"] and case["traces"], (mode, case["title"])
    failures = json.loads((output / "failures.json").read_text(encoding="utf-8"))
    assert {case["scenario_key"] for case in failures} == {case["scenario_key"] for case in execution["cases"] if case["status"] in {"failed", "timedOut"}}
    executions[mode] = execution
assert len({json.dumps(execution["test_sources"], sort_keys=True) for execution in executions.values()}) == 1
normal = {case["scenario_key"]: case for case in executions["normal"]["cases"]}
for mode in modes[1:]:
    changes = [case for case in executions[mode]["cases"] if case["status"] in {"failed", "timedOut"} and normal[case["scenario_key"]]["status"] == "passed"]
    assert changes, (mode, "정상에서 통과한 테스트가 결함을 잡지 못했습니다.")
    if mode == "email":
        assert any(case["expected_policy"] == "allow" and case["requirement_key"].startswith("BE_USER_001@") for case in changes)
    else:
        assert any(case["expected_policy"] == "deny" and case["requirement_key"].startswith("BE_USER_001@") for case in changes)

with TestClient(app) as client:
    execution = executions["normal"]
    url = f"/api/runs/{run_id}/executions/{execution['execution_id']}"
    assert client.get(url).json()["execution_id"] == execution["execution_id"]
    screenshot = execution["cases"][0]["screenshots"][0]
    response = client.get(url + "/files/" + screenshot)
    assert response.status_code == 200 and response.content.startswith(b"\x89PNG")
    assert client.get(url + "/files/..%5c..%5c..%5c..%5c.env").status_code == 404
    assert client.post(f"/api/runs/{run_id}/execute", json={"target_url": "file:///C:/invalid-target.html"}).status_code == 400
    failed_launch = client.post(f"/api/runs/{run_id}/execute", json={"target_url": "http://127.0.0.1:1/"}).json()
    assert failed_launch["status"] == "execution_error" and failed_launch["error"] and not failed_launch["cases"]

summary = {"run_id": run_id, "token_preservation": True, "graph_nodes": 4, "coverage_complete": True, "mutations_detected": list(modes[1:]), "screenshots_valid": True, "artifact_api": True, "launcher_error_separate": True}
(root / ".local" / "stage4-check.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASS: " + json.dumps(summary, ensure_ascii=False))
