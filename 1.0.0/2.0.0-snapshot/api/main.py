import json
import os
import re
import uuid
import binascii
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from pydantic import BaseModel, Field

from core import DATA, ROOT, connect, register
from workflow import compile_graph, local_url


env_file = ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            os.environ.setdefault("OPENAI_API_KEY", line.partition("=")[2].strip())

app = FastAPI(title="Common Tester 2.0.0")


class DocumentInput(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    version: str = Field(pattern=r"^[a-zA-Z0-9._-]{1,32}$")
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(max_length=2_800_000)


class RunInput(BaseModel):
    document_id: str
    version: str
    url: str
    objective: str = Field(min_length=3, max_length=500)
    case_count: int = Field(ge=1, le=30)


def record(row):
    item = dict(row)
    for field in ("plan", "evidence", "controls", "result"):
        item[field] = json.loads(item[field]) if item[field] else None
    return item


def get_run(run_id):
    with connect() as db:
        row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "실행을 찾지 못했습니다.")
    return record(row)


def graph_config(run_id):
    return {"configurable": {"thread_id": run_id}}


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/api/documents")
def documents():
    with connect() as db:
        return [dict(row) for row in db.execute("""SELECT d.id,d.version,d.title,d.created_at,
            count(c.source_id) AS chunk_count FROM documents d LEFT JOIN chunks c
            ON c.document_id=d.id AND c.version=d.version GROUP BY d.id,d.version
            ORDER BY d.created_at DESC,d.version DESC""")]


@app.post("/api/documents")
def add_document(payload: DocumentInput):
    try:
        return register(payload.id, payload.version, payload.title, payload.filename, payload.content_base64)
    except (ValueError, OSError, KeyError, binascii.Error, zipfile.BadZipFile, UnicodeError, ET.ParseError) as error:
        raise HTTPException(400, str(error)) from error


@app.get("/api/runs")
def runs():
    with connect() as db:
        return [record(row) for row in db.execute("SELECT * FROM runs ORDER BY created_at DESC,id DESC LIMIT 30")]


@app.post("/api/runs")
def create_run(payload: RunInput):
    if not local_url(payload.url):
        raise HTTPException(400, "http://localhost 또는 http://127.0.0.1 주소만 가능합니다.")
    with connect() as db:
        exists = db.execute("SELECT 1 FROM documents WHERE id=? AND version=?",
                            (payload.document_id, payload.version)).fetchone()
        if not exists:
            raise HTTPException(404, "문서 버전을 찾지 못했습니다.")
        run_id = str(uuid.uuid4())
        db.execute("""INSERT INTO runs (id,document_id,version,url,objective,case_count,status,stage)
            VALUES (?,?,?,?,?,?,?,?)""", (run_id, payload.document_id, payload.version,
            payload.url, payload.objective, payload.case_count, "generating", "검색"))
    try:
        with SqliteSaver.from_conn_string(str(DATA / "workflow.sqlite3")) as saver:
            graph = compile_graph(saver)
            graph.invoke({**payload.model_dump(), "run_id": run_id}, graph_config(run_id))
            state = graph.get_state(graph_config(run_id)).values
        if state.get("stage") != "승인 대기":
            raise ValueError("워크플로가 승인 대기 지점에 도달하지 못했습니다.")
        with connect() as db:
            db.execute("""UPDATE runs SET status='awaiting_review',stage=?,plan=?,evidence=?,controls=? WHERE id=?""",
                       (state["stage"], json.dumps(state["plan"], ensure_ascii=False),
                        json.dumps(state["evidence"], ensure_ascii=False),
                        json.dumps(state["controls"], ensure_ascii=False), run_id))
    except Exception as error:
        with connect() as db:
            db.execute("UPDATE runs SET status='error',stage='생성 오류',error=? WHERE id=?", (str(error)[:2000], run_id))
    return get_run(run_id)


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str):
    return get_run(run_id)


@app.post("/api/runs/{run_id}/reject")
def reject(run_id: str):
    run = get_run(run_id)
    if run["status"] != "awaiting_review":
        raise HTTPException(409, "검토 대기 중인 계획만 거절할 수 있습니다.")
    with connect() as db:
        updated = db.execute("UPDATE runs SET status='rejected',stage='거절' WHERE id=? AND status='awaiting_review'", (run_id,))
        if updated.rowcount != 1:
            raise HTTPException(409, "이미 처리된 실행입니다.")
    with SqliteSaver.from_conn_string(str(DATA / "workflow.sqlite3")) as saver:
        compile_graph(saver).invoke(Command(resume=False), graph_config(run_id))
    return get_run(run_id)


@app.post("/api/runs/{run_id}/approve")
def approve(run_id: str):
    run = get_run(run_id)
    if run["status"] != "awaiting_review":
        raise HTTPException(409, "검토 대기 중인 계획만 승인할 수 있습니다.")
    with connect() as db:
        updated = db.execute("UPDATE runs SET status='running',stage='실행' WHERE id=? AND status='awaiting_review'", (run_id,))
        if updated.rowcount != 1:
            raise HTTPException(409, "이미 처리된 실행입니다.")
    try:
        with SqliteSaver.from_conn_string(str(DATA / "workflow.sqlite3")) as saver:
            state = compile_graph(saver).invoke(Command(resume=True), graph_config(run_id))
        results = state["result"]
        status = "passed" if all(item["status"] == "passed" for item in results) else "failed"
        with connect() as db:
            db.execute("UPDATE runs SET status=?,stage='결과',result=? WHERE id=?",
                       (status, json.dumps(results, ensure_ascii=False), run_id))
    except Exception as error:
        with connect() as db:
            db.execute("UPDATE runs SET status='error',stage='실행 오류',error=? WHERE id=?", (str(error)[:2000], run_id))
    return get_run(run_id)


@app.get("/api/runs/{run_id}/files/{filename}")
def artifact(run_id: str, filename: str):
    get_run(run_id)
    if filename != "generated_test.py" and not re.fullmatch(r"case-\d{3}-(?:passed|failed)\.png|case-\d{3}-trace\.zip", filename):
        raise HTTPException(404, "파일을 찾지 못했습니다.")
    path = DATA / "runs" / run_id / filename
    if not path.is_file():
        raise HTTPException(404, "파일을 찾지 못했습니다.")
    return FileResponse(path)
