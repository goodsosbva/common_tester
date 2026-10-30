from fastapi import BackgroundTasks, FastAPI, HTTPException
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from fastapi.responses import FileResponse
import json

from core import index_version, list_products
from workflow import run_handoff, run_generation, run_execution, prepare_pipeline, execute_pipeline, interrupt_pending_runs
from results import list_runs, run_detail, summarize_results
from playwright_runner import execution_folder


@asynccontextmanager
async def lifespan(app):
    interrupt_pending_runs()
    yield


app = FastAPI(title="Common Tester", version="2.0.1", lifespan=lifespan)


class HandoffRequest(BaseModel):
    product: str = Field(min_length=1, max_length=64)
    version: str = Field(min_length=1, max_length=64)
    target_url: str = Field(min_length=1, max_length=2048)
    scope: str = Field(min_length=1, max_length=120)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.1"}


@app.get("/api/products")
def products():
    return list_products()


@app.post("/api/products/{product}/{version}/index")
def index(product: str, version: str):
    try:
        return index_version(product, version)
    except (ValueError, OSError, UnicodeError, KeyError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/handoffs")
def handoffs(request: HandoffRequest):
    try:
        return run_handoff(request.product, request.version, request.target_url, request.scope)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

@app.post("/api/runs/{run_id}/generate-playwright")
def generate_run_playwright(run_id: str):
    try:
        return run_generation(run_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


class ExecutionRequest(BaseModel):
    target_url: str | None = Field(default=None, max_length=2048)


@app.post("/api/runs", status_code=202)
def pipeline(request: HandoffRequest, background: BackgroundTasks):
    try:
        state = prepare_pipeline(request.product, request.version, request.target_url, request.scope)
        background.add_task(execute_pipeline, state)
        return {"run_id": state["run_id"], "status": "queued"}
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/runs")
def runs():
    return list_runs()


@app.get("/api/runs/{run_id}")
def run_info(run_id: str):
    try:
        return run_detail(run_id)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/runs/{run_id}/executions/{execution_id}/report")
def execution_report(run_id: str, execution_id: str):
    try:
        file = execution_folder(run_id, execution_id) / "report.json"
        return json.loads(file.read_text(encoding="utf-8")) if file.is_file() else summarize_results(run_id, execution_id, publish=False)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/runs/{run_id}/execute")
def execute_run(run_id: str, request: ExecutionRequest | None = None):
    try:
        return run_execution(run_id, request.target_url if request else None)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/runs/{run_id}/executions/{execution_id}")
def execution_result(run_id: str, execution_id: str):
    try:
        return json.loads((execution_folder(run_id, execution_id) / "execution.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/runs/{run_id}/executions/{execution_id}/files/{file_path:path}")
def execution_artifact(run_id: str, execution_id: str, file_path: str):
    try:
        folder = execution_folder(run_id, execution_id).resolve()
        file = (folder / file_path).resolve()
        if not file.is_relative_to(folder) or not file.is_file():
            raise ValueError("허용된 결과 파일이 아닙니다.")
        return FileResponse(file)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
