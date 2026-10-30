import json
import os
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
password = (ROOT / ".local" / "postgres-password").read_text().strip()
os.environ["DATABASE_URL"] = f"postgresql://common_tester:{password}@127.0.0.1:55432/common_tester"
os.environ["OPENAI_API_KEY"] = "local-fake-test-key"

from app.main import app  # noqa: E402


plan = json.loads((ROOT / "examples" / "normal-plan.json").read_text(encoding="utf-8"))
policy = json.loads((ROOT / "examples" / "policies" / "order-name-v1.json").read_text(encoding="utf-8"))


def new_run(client):
    response = client.post("/api/runs", json={
        "project_id": plan["project_id"], "route": plan["route"],
        "policy_version": plan["policy_version"],
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


class Drafts:
    def __init__(self, versions):
        self.versions = iter(versions)
        self.calls = 0

    def __call__(self, run, objective, database, base_url, call_log):
        from app.models import TestPlan

        self.calls += 1
        call_log.append({"name": "search_policy", "result": "fake model response"})
        return TestPlan.model_validate(next(self.versions)), f"fake-{self.calls}", 10


bad_plan = json.loads(json.dumps(plan))
bad_plan["cases"][0]["evidence"][0]["source_id"] = "policy:demo-orders:missing:v1:0"
drafts = Drafts([bad_plan, plan])

with TestClient(app) as client:
    assert client.post("/api/policies", json=policy).status_code == 200
    run_id = new_run(client)
    with patch("app.workflow.generate_plan", side_effect=drafts):
        response = client.post(f"/api/runs/{run_id}/workflow/start", json={"objective": "주문명 20자 제한 검사"})
    assert response.status_code == 200, response.text
    waiting = response.json()
    assert waiting["status"] == "awaiting_review"
    assert waiting["workflow"]["attempts"] == 2
    assert waiting["generation"]["attempts"][0]["response_id"] == "fake-1"
    assert waiting["generation"]["attempts"][1]["response_id"] == "fake-2"
    assert client.post(f"/api/runs/{run_id}/execute").status_code == 409

# 새 앱 컨텍스트와 체크포인터 연결에서 같은 thread_id로 재개한다.
with TestClient(app) as client:
    with patch("app.workflow.generate_plan", side_effect=AssertionError("resume regenerated the plan")):
        response = client.post(f"/api/runs/{run_id}/workflow/resume", json={"approved": True})
    assert response.status_code == 200, response.text
    completed = response.json()
    assert completed["status"] == "passed"
    assert completed["workflow"] == {"phase": "completed", "attempts": 2, "result_status": "passed"}
    assert completed["result"]["passed"] == 2
    assert client.post(f"/api/runs/{run_id}/workflow/resume", json={"approved": True}).status_code == 409

    rejected_id = new_run(client)
    with patch("app.workflow.generate_plan", side_effect=Drafts([plan])):
        assert client.post(f"/api/runs/{rejected_id}/workflow/start",
                           json={"objective": "주문명 20자 제한 검사"}).status_code == 200
    rejected = client.post(f"/api/runs/{rejected_id}/workflow/resume", json={"approved": False})
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    assert client.post(f"/api/runs/{rejected_id}/execute").status_code == 409

    invalid_id = new_run(client)
    with patch("app.workflow.generate_plan", side_effect=Drafts([bad_plan, bad_plan])):
        invalid = client.post(f"/api/runs/{invalid_id}/workflow/start",
                              json={"objective": "주문명 20자 제한 검사"})
    assert invalid.status_code == 200, invalid.text
    assert invalid.json()["status"] == "error"
    assert invalid.json()["workflow"]["phase"] == "invalid"
    assert invalid.json()["plan"] is None

print("2회 검증 보정, PostgreSQL 체크포인트 재개, 승인 실행, 거절, 반복 오류 차단 확인")
