from pathlib import Path

from runner import execute


plan = {"cases": [{"id": "forced-failure", "title": "실패 증거 확인", "kind": "normal",
    "source_ids": ["test:v1:1"], "steps": [{"action": "fill", "locator": {"kind": "label", "name": "이메일"},
    "value": "user@example.com"}], "assertions": [{"check": "text", "locator": {"kind": "css", "name": "body"},
    "value": "이 문구는 화면에 없음"}]}]}
results = execute("check-failure", "http://127.0.0.1:8765/signup.html", plan)
assert results[0]["status"] == "failed", results
folder = Path(__file__).resolve().parents[1] / ".local" / "runs" / "check-failure"
assert (folder / results[0]["screenshot"]).is_file()
assert (folder / results[0]["trace"]).is_file()
print("failure screenshot and trace: PASS")
