import json
from pathlib import Path

from pydantic import ValidationError

from app.models import TestPlan


example = Path(__file__).resolve().parents[1] / "examples" / "test-plan.json"
payload = json.loads(example.read_text(encoding="utf-8"))
plan = TestPlan.model_validate(payload)
assert plan.cases[0].steps[0].field_id == plan.fields[0].id

payload["cases"][0]["steps"][0]["field_id"] = "missing"
try:
    TestPlan.model_validate(payload)
except ValidationError:
    print("실행계획 형식 검사: 정상 입력 통과, 잘못된 필드 참조 거부")
else:
    raise AssertionError("unknown field reference was accepted")
