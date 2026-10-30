import hashlib
import io
import json
import os
import re
import sqlite3
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from contextlib import closing
from functools import lru_cache
from pathlib import Path

from fastembed import TextEmbedding


ROOT = Path(__file__).resolve().parents[1]
DOCUMENTS = ROOT / "documents"
MODEL_CACHE = ROOT / ".local" / "models"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
SUPPORTED = {".docx", ".md", ".txt"}
EMBEDDING_TOKEN_LIMIT = 128
CHUNKING_VERSION = "tokens-128-v1"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def version_path(product: str, version: str) -> Path:
    if not NAME.fullmatch(product) or not NAME.fullmatch(version) or product in {".", ".."} or version in {".", ".."}:
        raise ValueError("제품과 버전은 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.")
    path = DOCUMENTS / product / version
    if not path.is_dir() or not path.resolve().is_relative_to(DOCUMENTS.resolve()):
        raise ValueError("제품/버전 폴더를 찾지 못했습니다.")
    return path


def source_files(path: Path) -> list[Path]:
    files = sorted(file for file in path.rglob("*") if file.is_file() and file.suffix.lower() in SUPPORTED)
    if any(not file.resolve().is_relative_to(path.resolve()) for file in files):
        raise ValueError("제품/버전 폴더 밖의 파일은 읽을 수 없습니다.")
    return files


def paragraphs(file: Path) -> list[str]:
    raw = file.read_bytes()
    if len(raw) > 5_000_000:
        raise ValueError(f"{file.name}: 원본 파일은 5MB 이하여야 합니다.")
    if file.suffix.lower() == ".docx":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > 10_000_000:
                raise ValueError(f"{file.name}: Word 본문이 너무 큽니다.")
            root = ET.fromstring(archive.read(info))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        parts = ["".join(text.text or "" for text in p.findall(".//w:t", ns)) for p in root.findall(".//w:p", ns)]
    else:
        parts = re.split(r"\n\s*\n", raw.decode("utf-8-sig").replace("\r\n", "\n"))
    return [text for part in parts if (text := " ".join(part.split()))]


@lru_cache(maxsize=1)
def chunk_tokenizer():
    tokenizer = encoder().model.tokenizer
    full = type(tokenizer).from_str(tokenizer.to_str())
    full.no_truncation()
    full.no_padding()
    return full


def split_chunks(text: str) -> list[str]:
    tokenizer = chunk_tokenizer()
    budget = EMBEDDING_TOKEN_LIMIT - tokenizer.num_special_tokens_to_add(False)
    chunks = []
    while text:
        if len(tokenizer.encode(text).ids) <= EMBEDDING_TOKEN_LIMIT:
            chunks.append(text)
            break
        encoding = tokenizer.encode(text, add_special_tokens=False)
        end = encoding.offsets[budget - 1][1]
        while end > 0 and len(tokenizer.encode(text[:end]).ids) > EMBEDDING_TOKEN_LIMIT:
            end -= 1
        if end <= 0:
            raise ValueError("모델 입력 한도 안에서 원문 조각을 만들 수 없습니다.")
        space = text.rfind(" ", 0, end)
        if space >= end // 2:
            end = space + 1
        chunks.append(text[:end])
        text = text[end:]
    return chunks


@lru_cache(maxsize=1)
def encoder() -> TextEmbedding:
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    return TextEmbedding(model_name=MODEL_NAME, cache_dir=str(MODEL_CACHE))


def index_version(product: str, version: str) -> dict:
    path = version_path(product, version)
    files = source_files(path)
    if not files:
        raise ValueError("DOCX, Markdown, TXT 원문 파일이 없습니다.")

    rows = []
    hashes = []
    for file in files:
        relative = file.relative_to(path).as_posix()
        hashes.append((relative, hashlib.sha256(file.read_bytes()).hexdigest()))
        for paragraph_no, content in enumerate(paragraphs(file), 1):
            for chunk_no, chunk in enumerate(split_chunks(content), 1):
                rows.append((relative, paragraph_no, chunk_no, chunk))
    if not rows:
        raise ValueError("읽을 수 있는 문단이 없습니다.")

    vectors = encoder().embed([row[3] for row in rows])
    descriptor, temporary = tempfile.mkstemp(prefix="embeddings-", suffix=".sqlite3", dir=path)
    os.close(descriptor)
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.execute("CREATE TABLE source_files (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL)")
            db.execute("""CREATE TABLE chunks (
                path TEXT NOT NULL, paragraph_no INTEGER NOT NULL, chunk_no INTEGER NOT NULL,
                content TEXT NOT NULL, embedding TEXT NOT NULL,
                PRIMARY KEY (path, paragraph_no, chunk_no))""")
            db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.executemany("INSERT INTO source_files VALUES (?, ?)", hashes)
            db.executemany(
                "INSERT INTO chunks VALUES (?, ?, ?, ?, ?)",
                ((*row, json.dumps(vector.tolist())) for row, vector in zip(rows, vectors)),
            )
            db.executemany("INSERT INTO metadata VALUES (?, ?)", [
                ("model", MODEL_NAME),
                ("chunking", CHUNKING_VERSION),
                ("indexed_at", datetime.now(timezone.utc).isoformat()),
            ])
            if db.execute("SELECT count(*) FROM chunks").fetchone()[0] != len(rows):
                raise RuntimeError("임베딩 개수가 원문 조각과 다릅니다.")
            db.commit()
        os.replace(temporary, path / "embeddings.sqlite3")
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"product": product, "version": version, "file_count": len(files), "chunk_count": len(rows)}


def list_products() -> list[dict]:
    if not DOCUMENTS.is_dir():
        return []
    products = []
    for product in sorted(DOCUMENTS.iterdir()):
        if not product.is_dir() or not NAME.fullmatch(product.name):
            continue
        for version in sorted(product.iterdir()):
            if not version.is_dir() or not NAME.fullmatch(version.name):
                continue
            try:
                path = version_path(product.name, version.name)
                files = [file.relative_to(path).as_posix() for file in source_files(path)]
                reference_files = [
                    file.relative_to(path).as_posix()
                    for file in sorted(path.rglob("*.pdf"))
                    if file.is_file() and file.resolve().is_relative_to(path.resolve())
                ]
            except ValueError:
                continue
            database = path / "embeddings.sqlite3"
            count = 0
            stored_hashes = {}
            metadata = {}
            if database.is_file():
                try:
                    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as db:
                        count = db.execute("SELECT count(*) FROM chunks").fetchone()[0]
                        stored_hashes = dict(db.execute("SELECT path, sha256 FROM source_files"))
                        metadata = dict(db.execute("SELECT key, value FROM metadata"))
                except sqlite3.DatabaseError:
                    pass
            current_hashes = {
                relative: hashlib.sha256((path / relative).read_bytes()).hexdigest()
                for relative in files
            }
            products.append({
                "product": product.name,
                "version": version.name,
                "files": files,
                "reference_files": reference_files,
                "indexed": count > 0 and current_hashes == stored_hashes and metadata.get("chunking") == CHUNKING_VERSION,
                "chunk_count": count,
            })
    return products
