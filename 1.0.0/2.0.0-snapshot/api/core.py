import base64
import hashlib
import io
import json
import math
import os
import re
import sqlite3
import xml.etree.ElementTree as ET
import zipfile
from functools import lru_cache
from contextlib import contextmanager
from pathlib import Path

from fastembed import TextEmbedding


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".local"
DB = DATA / "common_tester.sqlite3"
MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@contextmanager
def connect():
    DATA.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT NOT NULL, version TEXT NOT NULL, title TEXT NOT NULL,
            digest TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id, version)
        );
        CREATE TABLE IF NOT EXISTS chunks (
            source_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version TEXT NOT NULL,
            ordinal INTEGER NOT NULL, content TEXT NOT NULL, embedding TEXT NOT NULL,
            FOREIGN KEY (document_id, version) REFERENCES documents(id, version)
        );
        CREATE INDEX IF NOT EXISTS chunks_version ON chunks(document_id, version);
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version TEXT NOT NULL,
            url TEXT NOT NULL, objective TEXT NOT NULL, case_count INTEGER NOT NULL,
            status TEXT NOT NULL, stage TEXT NOT NULL, plan TEXT, evidence TEXT,
            controls TEXT, result TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id, version) REFERENCES documents(id, version)
        );
    """)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@lru_cache(maxsize=1)
def encoder():
    return TextEmbedding(model_name=MODEL, cache_dir=str(DATA / "models"))


def parse_document(filename: str, encoded: str):
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > 2_000_000:
        raise ValueError("문서 크기는 2MB 이하여야 합니다.")
    suffix = Path(filename).suffix.lower()
    if suffix in {".md", ".txt"}:
        text = raw.decode("utf-8-sig")
        parts = re.split(r"\n\s*\n", text)
    elif suffix == ".docx":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > 5_000_000:
                raise ValueError("문서 본문이 너무 큽니다.")
            root = ET.fromstring(archive.read(info))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        parts = ["".join(node.itertext()) for node in root.findall(".//w:p", ns)]
    else:
        raise ValueError(".docx, .md, .txt 파일만 등록할 수 있습니다.")
    paragraphs = []
    for part in parts:
        part = " ".join(part.split())
        while part:
            paragraphs.append(part[:500])
            part = part[500:]
    if not paragraphs:
        raise ValueError("문서에 읽을 수 있는 문단이 없습니다.")
    return raw, paragraphs


def register(document_id, version, title, filename, encoded):
    raw, paragraphs = parse_document(filename, encoded)
    digest = hashlib.sha256(raw).hexdigest()
    with connect() as db:
        old = db.execute("SELECT digest FROM documents WHERE id=? AND version=?", (document_id, version)).fetchone()
        if old:
            if old["digest"] != digest:
                raise ValueError("같은 문서 ID와 버전에 다른 내용이 이미 등록되어 있습니다.")
            return {"id": document_id, "version": version, "title": title, "chunk_count": db.execute(
                "SELECT count(*) FROM chunks WHERE document_id=? AND version=?", (document_id, version)).fetchone()[0]}
    vectors = [vector.tolist() for vector in encoder().embed(paragraphs)]
    with connect() as db:
        db.execute("INSERT INTO documents (id,version,title,digest) VALUES (?,?,?,?)", (document_id, version, title, digest))
        db.executemany("INSERT INTO chunks VALUES (?,?,?,?,?,?)", [
            (f"{document_id}:{version}:{index + 1}", document_id, version, index + 1, paragraph, json.dumps(vector))
            for index, (paragraph, vector) in enumerate(zip(paragraphs, vectors))
        ])
    return {"id": document_id, "version": version, "title": title, "chunk_count": len(paragraphs)}


def search(document_id, version, query, limit=5):
    with connect() as db:
        rows = db.execute("SELECT source_id,content,embedding FROM chunks WHERE document_id=? AND version=?",
                          (document_id, version)).fetchall()
    if not rows:
        return []
    vector = next(encoder().embed([query])).tolist()
    def score(row):
        stored = json.loads(row["embedding"])
        denominator = math.sqrt(sum(x * x for x in vector) * sum(x * x for x in stored))
        return sum(a * b for a, b in zip(vector, stored)) / denominator if denominator else 0
    return [{"source_id": row["source_id"], "content": row["content"], "score": round(score(row), 4)}
            for row in sorted(rows, key=score, reverse=True)[:limit]]
