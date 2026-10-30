import json
import os
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
password = (ROOT / ".local" / "postgres-password").read_text().strip()
os.environ["DATABASE_URL"] = f"postgresql://common_tester:{password}@127.0.0.1:55432/common_tester"

from app.main import app  # noqa: E402


with TestClient(app) as client:
    first = client.post("/api/demo/setup")
    second = client.post("/api/demo/setup")
    assert first.status_code == second.status_code == 200
    assert first.json()["chunk_count"] == second.json()["chunk_count"] == 1

    plan = json.loads((ROOT / "examples" / "bug-plan.json").read_text(encoding="utf-8"))
    created = client.post("/api/runs", json={
        "project_id": plan["project_id"], "route": plan["route"],
        "policy_version": plan["policy_version"],
    })
    assert created.status_code == 201
    run_id = created.json()["id"]
    assert client.put(f"/api/runs/{run_id}/plan", json=plan).status_code == 200
    executed = client.post(f"/api/runs/{run_id}/execute")
    assert executed.status_code == 200, executed.text
    result = executed.json()["result"]
    assert result["status"] == "failed"
    case = result["cases"][0]
    for key, signature in (("screenshot", b"\x89PNG"), ("trace", b"PK")):
        filename = Path(case[key]).name
        artifact = client.get(f"/api/runs/{run_id}/artifacts/{filename}")
        assert artifact.status_code == 200 and artifact.content.startswith(signature)
        assert len(artifact.content) > 100
    assert client.get(f"/api/runs/{run_id}/artifacts/case-99.png").status_code == 404

print("데모 정책 중복 등록, 실패 화면과 추적 파일 다운로드, 미등록 파일 차단 확인")
