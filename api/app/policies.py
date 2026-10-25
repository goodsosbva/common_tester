import hashlib
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

from .models import PolicyDocumentCreate, PolicySearchRequest, TestPlan


MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
ROOT = Path(__file__).resolve().parents[2]


class PolicyVersionConflict(Exception):
    pass


@lru_cache(maxsize=1)
def embedding_model():
    return TextEmbedding(model_name=MODEL_NAME, cache_dir=str(ROOT / ".local" / "models"))


def split_paragraphs(body: str):
    for paragraph in body.replace("\r\n", "\n").split("\n\n"):
        paragraph = " ".join(paragraph.split())
        while paragraph:
            yield paragraph[:500]
            paragraph = paragraph[500:]


def bigrams(text: str):
    return {word[index:index + 2] for word in re.findall(r"[가-힣a-z0-9]+", text.lower())
            for index in range(len(word) - 1)}


def create_tables(connection):
    connection.execute("""
        CREATE TABLE IF NOT EXISTS policy_documents (
            project_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            version TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            body_hash TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (project_id, document_id, version)
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS policy_chunks (
            source_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            version TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding REAL[] NOT NULL,
            model TEXT NOT NULL,
            FOREIGN KEY (project_id, document_id, version)
                REFERENCES policy_documents(project_id, document_id, version) ON DELETE CASCADE
        )
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS policy_chunks_scope
        ON policy_chunks(project_id, version, model)
    """)


def register(connection, document: PolicyDocumentCreate):
    body_hash = hashlib.sha256(document.body.encode("utf-8")).hexdigest()
    existing = connection.execute(
        """SELECT body_hash FROM policy_documents
           WHERE project_id = %s AND document_id = %s AND version = %s""",
        (document.project_id, document.document_id, document.version),
    ).fetchone()
    if existing:
        if existing["body_hash"] != body_hash:
            raise PolicyVersionConflict("This policy version already has different content")
        count = connection.execute(
            """SELECT count(*) AS count FROM policy_chunks
               WHERE project_id = %s AND document_id = %s AND version = %s""",
            (document.project_id, document.document_id, document.version),
        ).fetchone()["count"]
        return {**document.model_dump(exclude={"body"}), "body_hash": body_hash, "chunk_count": count}

    parts = list(split_paragraphs(document.body))
    if not parts:
        raise ValueError("Policy body is empty")
    vectors = list(embedding_model().embed([f"{document.title}\n{part}" for part in parts]))
    connection.execute(
        """INSERT INTO policy_documents (project_id, document_id, version, title, body, body_hash, model)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (document.project_id, document.document_id, document.version, document.title,
         document.body, body_hash, MODEL_NAME),
    )
    for ordinal, (part, vector) in enumerate(zip(parts, vectors)):
        source_id = f"policy:{document.project_id}:{document.document_id}:{document.version}:{ordinal}"
        connection.execute(
            """INSERT INTO policy_chunks
               (source_id, project_id, document_id, version, ordinal, content, embedding, model)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (source_id, document.project_id, document.document_id, document.version,
             ordinal, part, vector.tolist(), MODEL_NAME),
        )
    return {**document.model_dump(exclude={"body"}), "body_hash": body_hash, "chunk_count": len(parts)}


def search(connection, request: PolicySearchRequest):
    rows = connection.execute(
        """SELECT c.source_id, c.project_id, c.document_id, c.version, c.ordinal,
                  c.content, c.embedding, d.title
           FROM policy_chunks c JOIN policy_documents d
             USING (project_id, document_id, version)
           WHERE c.project_id = %s AND c.version = %s AND c.model = %s""",
        (request.project_id, request.version, MODEL_NAME),
    ).fetchall()
    if not rows:
        return []
    query = next(embedding_model().embed([request.query]))
    query_norm = np.linalg.norm(query)
    query_bigrams = bigrams(request.query)
    hits = []
    for row in rows:
        vector = np.asarray(row.pop("embedding"), dtype=np.float32)
        denominator = float(query_norm * np.linalg.norm(vector))
        semantic = float(np.dot(query, vector) / denominator) if denominator else 0.0
        keyword = len(query_bigrams & bigrams(f"{row['title']} {row['content']}")) / len(query_bigrams) if query_bigrams else 0.0
        hits.append({**row, "semantic_score": semantic, "keyword_score": keyword,
                     "score": semantic + 0.35 * keyword})
    return sorted(hits, key=lambda hit: hit["score"], reverse=True)[:request.top_k]


def missing_policy_sources(connection, plan: TestPlan):
    sources = {
        evidence.source_id
        for case in plan.cases
        for evidence in case.evidence
        if evidence.kind == "policy"
    }
    if not sources:
        return set()
    rows = connection.execute(
        """SELECT source_id FROM policy_chunks
           WHERE project_id = %s AND version = %s AND source_id = ANY(%s)""",
        (plan.project_id, plan.policy_version, list(sources)),
    ).fetchall()
    return sources - {row["source_id"] for row in rows}
