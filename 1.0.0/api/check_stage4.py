import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
password = (ROOT / ".local" / "postgres-password").read_text().strip()
os.environ["DATABASE_URL"] = f"postgresql://common_tester:{password}@127.0.0.1:55432/common_tester"
os.environ["OPENAI_API_KEY"] = "local-fake-test-key"

from app.main import app  # noqa: E402


def function_call(call_id, name, arguments):
    return SimpleNamespace(type="function_call", call_id=call_id, name=name,
                           arguments=json.dumps(arguments, ensure_ascii=False))


class FakeResponses:
    def __init__(self, plan):
        self.plan = plan
        self.step = 0

    def parse(self, **kwargs):
        self.step += 1
        if self.step == 1:
            assert kwargs["tool_choice"] == {"type": "function", "name": "search_policy"}
            output = [function_call("call-1", "search_policy", {"query": "주문명 20자 제한", "top_k": 3})]
        elif self.step == 2:
            assert kwargs["input"][0]["call_id"] == "call-1"
            assert "policy:demo-orders:order-name:v1:0" in kwargs["input"][0]["output"]
            output = [function_call("call-2", "read_project_file",
                                    {"file_id": "order_form", "start_line": 1, "end_line": 40})]
        elif self.step == 3:
            assert kwargs["input"][0]["call_id"] == "call-2"
            assert "주문명" in kwargs["input"][0]["output"]
            output = [function_call("call-3", "inspect_page", {"route_id": "run_route"})]
        else:
            assert kwargs["input"][0]["call_id"] == "call-3"
            assert "order-name" in kwargs["input"][0]["output"] or "주문명" in kwargs["input"][0]["output"]
            output = []
        return SimpleNamespace(id=f"response-{self.step}", usage=SimpleNamespace(total_tokens=10),
                               output=output, output_parsed=self.plan if not output else None)


class FakeOpenAI:
    def __init__(self, plan):
        self.responses = FakeResponses(plan)


class BadArgumentsResponses:
    def parse(self, **kwargs):
        return SimpleNamespace(id="bad-response", usage=SimpleNamespace(total_tokens=1),
                               output=[function_call("bad-call", "search_policy",
                                                     {"query": "주문명 제한", "top_k": 100})],
                               output_parsed=None)


with TestClient(app) as client:
    policy = json.loads((ROOT / "examples" / "policies" / "order-name-v1.json").read_text(encoding="utf-8"))
    assert client.post("/api/policies", json=policy).status_code == 200
    plan = json.loads((ROOT / "examples" / "normal-plan.json").read_text(encoding="utf-8"))
    run = client.post("/api/runs", json={
        "project_id": plan["project_id"], "route": plan["route"], "policy_version": plan["policy_version"],
    }).json()

    with patch("app.generator.OpenAI", return_value=FakeOpenAI(plan)):
        response = client.post(f"/api/runs/{run['id']}/generate", json={"objective": "주문명 20자 제한 검사"})
    assert response.status_code == 200, response.text
    generated = response.json()
    assert generated["plan"]["cases"][0]["id"] == "valid-order-name"
    assert [call["name"] for call in generated["generation"]["calls"]] == [
        "search_policy", "read_project_file", "inspect_page",
    ]
    assert generated["generation"]["total_tokens"] == 40
    assert client.get(f"/api/runs/{run['id']}").json()["generation"]["status"] == "completed"

    executed = client.post(f"/api/runs/{run['id']}/execute")
    assert executed.status_code == 200, executed.text
    assert executed.json()["status"] == "passed"

    second = client.post("/api/runs", json={
        "project_id": plan["project_id"], "route": plan["route"], "policy_version": plan["policy_version"],
    }).json()
    bad_plan = json.loads(json.dumps(plan))
    bad_plan["cases"][0]["evidence"][0]["source_id"] = "policy:demo-orders:missing:v1:0"
    with patch("app.generator.OpenAI", return_value=FakeOpenAI(bad_plan)):
        rejected = client.post(f"/api/runs/{second['id']}/generate", json={"objective": "주문명 20자 제한 검사"})
    assert rejected.status_code == 422
    saved = client.get(f"/api/runs/{second['id']}").json()
    assert saved["plan"] is None and saved["status"] == "created"
    assert saved["generation"]["status"] == "error"

    third = client.post("/api/runs", json={
        "project_id": plan["project_id"], "route": plan["route"], "policy_version": plan["policy_version"],
    }).json()
    with patch("app.generator.OpenAI", return_value=SimpleNamespace(responses=BadArgumentsResponses())):
        invalid = client.post(f"/api/runs/{third['id']}/generate", json={"objective": "주문명 20자 제한 검사"})
    assert invalid.status_code == 502
    checked = client.get(f"/api/runs/{third['id']}").json()
    assert checked["status"] == "created" and checked["plan"] is None
    assert checked["generation"]["calls"][0]["name"] == "search_policy"
    assert "error" in checked["generation"]["calls"][0]

print("도구 3종 호출과 기록, 계획 저장 후 브라우저 통과, 허위 근거와 잘못된 도구 인자 거부 확인")
