import base64
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8000/api"


def call(path, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=150) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(error.read().decode()[:1000]) from error


document = ROOT / "examples" / "signup-policy-v1.md"
call("/documents", {"id": "signup-example", "version": "v1", "title": "가입 예제 정책",
    "filename": document.name, "content_base64": base64.b64encode(document.read_bytes()).decode()})
run = call("/runs", {"document_id": "signup-example", "version": "v1",
    "url": "http://127.0.0.1:8765/signup.html",
    "objective": "올바른 이메일 가입 완료와 이메일 미입력 제출 방지를 각각 확인",
    "case_count": 2})
print("plan:", run["status"], "cases:", len((run["plan"] or {}).get("cases", [])))
if run["status"] != "awaiting_review":
    raise RuntimeError(run["error"] or "Planning did not reach review")
before = ROOT / ".local" / "runs" / run["id"] / "generated_test.py"
assert not before.exists(), "Browser script exists before approval"
run = call(f"/runs/{run['id']}/approve", {})
print("run:", run["status"], "results:", [(item["case_id"], item["status"]) for item in run["result"] or []])
if run["status"] == "error":
    raise RuntimeError(run["error"] or "Execution failed")
assert before.exists(), "Approved script missing"
assert len(run["result"] or []) == 2
assert all(item["screenshot"] and (before.parent / item["screenshot"]).exists() for item in run["result"])
print("screenshots: PASS; run_id:", run["id"])
