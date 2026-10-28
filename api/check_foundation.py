import hashlib
import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

import core
from main import app


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix="common-tester-stage1-") as temporary:
    core.DOCUMENTS = Path(temporary)
    product = core.DOCUMENTS / "sample"
    v1 = product / "v1"
    v2 = product / "v2"
    v1.mkdir(parents=True)
    v2.mkdir(parents=True)
    (v1 / "requirements.md").write_text("주문명은 필수입니다.\n\n수량은 1 이상입니다.", encoding="utf-8")
    (v2 / "requirements.md").write_text("주문명은 필수입니다.\n\n수량은 2 이상입니다.", encoding="utf-8")

    first = core.index_version("sample", "v1")
    second = core.index_version("sample", "v2")
    v1_before = digest(v1 / "embeddings.sqlite3")
    v2_before = digest(v2 / "embeddings.sqlite3")

    (v1 / "requirements.md").write_text(
        "주문명은 필수입니다.\n\n" + "수량은 3 이상입니다. " * 160, encoding="utf-8"
    )
    pending = {item["version"]: item for item in core.list_products()}
    assert not pending["v1"]["indexed"] and pending["v2"]["indexed"]
    updated = core.index_version("sample", "v1")
    assert digest(v1 / "embeddings.sqlite3") != v1_before
    assert digest(v2 / "embeddings.sqlite3") == v2_before
    assert updated["chunk_count"] > first["chunk_count"]

    with closing(sqlite3.connect(v1 / "embeddings.sqlite3")) as db:
        rows = db.execute(
            "SELECT path, paragraph_no, chunk_no, content, embedding FROM chunks "
            "ORDER BY path, paragraph_no, chunk_no"
        ).fetchall()
    assert rows[0][:3] == ("requirements.md", 1, 1)
    assert all(json.loads(row[4]) for row in rows)

    with TestClient(app) as client:
        assert client.get("/api/health").json()["version"] == "2.0.1"
        products = client.get("/api/products").json()
        assert len(products) == 2 and all(item["indexed"] for item in products)
        response = client.post("/api/products/sample/v1/index")
        assert response.status_code == 200, response.text

    assert digest(v2 / "embeddings.sqlite3") == v2_before

assert core.paragraphs(core.ROOT / "Common Tester 2.0.1 기획안.docx")
print("PASS: 버전별 재임베딩 격리, 문단/조각/벡터, API, DOCX 읽기")
