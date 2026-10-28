from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Locator(StrictModel):
    kind: Literal["role", "label", "test_id", "css"]
    value: str = Field(min_length=1)
    name: str | None = None


class FieldDefinition(StrictModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    locator: Locator


class EvidenceRef(StrictModel):
    kind: Literal["policy", "code"]
    source_id: str = Field(min_length=1)
    version: str | None = None


class Step(StrictModel):
    action: Literal["fill", "click", "select", "press"]
    field_id: str = Field(min_length=1)
    value: str | None = None

    @model_validator(mode="after")
    def check_value(self):
        if self.action != "click" and self.value is None:
            raise ValueError(f"{self.action} requires value")
        if self.action == "click" and self.value is not None:
            raise ValueError("click does not use value")
        return self


class Assertion(StrictModel):
    action: Literal["visible", "value", "text"]
    field_id: str = Field(min_length=1)
    expected: str | None = None

    @model_validator(mode="after")
    def check_expected(self):
        if self.action != "visible" and self.expected is None:
            raise ValueError(f"{self.action} requires expected")
        return self


class TestCase(StrictModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    steps: list[Step] = Field(min_length=1)
    assertions: list[Assertion] = Field(min_length=1)
    evidence: list[EvidenceRef] = Field(min_length=1)


class TestPlan(StrictModel):
    schema_version: Literal[1]
    project_id: str = Field(min_length=1)
    route: str = Field(pattern=r"^/", min_length=1)
    policy_version: str = Field(min_length=1)
    fields: list[FieldDefinition] = Field(min_length=1)
    cases: list[TestCase] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def check_references(self):
        field_ids = [field.id for field in self.fields]
        case_ids = [case.id for case in self.cases]
        if len(field_ids) != len(set(field_ids)):
            raise ValueError("field ids must be unique")
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("case ids must be unique")
        known = set(field_ids)
        for case in self.cases:
            for reference in [*case.steps, *case.assertions]:
                if reference.field_id not in known:
                    raise ValueError(f"unknown field id: {reference.field_id}")
        return self


class RunCreate(StrictModel):
    project_id: str = Field(min_length=1, max_length=100)
    route: str = Field(pattern=r"^/", max_length=500)
    policy_version: str = Field(min_length=1, max_length=100)


class RunSummary(RunCreate):
    id: UUID
    status: Literal["created", "generating", "awaiting_review", "rejected", "running", "passed", "failed", "error"]
    created_at: datetime


class RunDetail(RunSummary):
    plan: TestPlan | None
    result: dict | None
    generation: dict | None
    workflow: dict | None


class GenerationRequest(StrictModel):
    objective: str = Field(min_length=3, max_length=300)
    case_count: int = Field(default=1, ge=1, le=30)


class ReviewDecision(StrictModel):
    approved: bool


class PolicyDocumentCreate(StrictModel):
    project_id: str = Field(pattern=r"^[A-Za-z0-9_-]+$", max_length=100)
    document_id: str = Field(pattern=r"^[A-Za-z0-9_-]+$", max_length=100)
    version: str = Field(pattern=r"^[A-Za-z0-9._-]+$", max_length=100)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=50000)

    @model_validator(mode="after")
    def check_body(self):
        if not self.body.strip():
            raise ValueError("policy body must contain text")
        return self


class PolicyDocumentSummary(StrictModel):
    project_id: str
    document_id: str
    version: str
    title: str
    body_hash: str
    chunk_count: int


class PolicySearchRequest(StrictModel):
    project_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    query: str = Field(min_length=2, max_length=500)
    top_k: int = Field(default=5, ge=1, le=10)


class PolicySource(StrictModel):
    source_id: str
    project_id: str
    document_id: str
    version: str
    title: str
    ordinal: int
    content: str


class PolicySearchHit(PolicySource):
    score: float
    semantic_score: float
    keyword_score: float
