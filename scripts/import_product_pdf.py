"""Convert the product requirement table PDF into search-ready Markdown."""

import argparse
import hashlib
import re
from collections import Counter
from pathlib import Path

import pdfplumber


SECTIONS = (
    "회원", "상품", "장바구니", "주문", "리뷰", "커뮤니티",
    "추천", "알림", "관리자", "메인", "고도화",
)


def domain(requirement_id: str) -> str:
    if requirement_id == "BE_USER_013" or requirement_id.startswith("BE_COMMUNITY_"):
        return "커뮤니티"
    if requirement_id == "BE_USER_014" or requirement_id.startswith("BE_ALERT_"):
        return "알림"
    if requirement_id.startswith("BE_USER_"):
        return "회원"
    if requirement_id == "BE_MAIN_001":
        return "메인"
    if requirement_id == "BE_MAIN_002" or requirement_id.startswith("BE_RECOMMEND_"):
        return "추천"
    if requirement_id.startswith("BE_PRODUCT_"):
        number = int(requirement_id.rsplit("_", 1)[1])
        if 5 <= number <= 7:
            return "장바구니"
        if 13 <= number <= 18:
            return "주문"
        if 19 <= number <= 21:
            return "리뷰"
        return "상품"
    if requirement_id.startswith("BE_ADMIN_"):
        return "관리자"
    if requirement_id.startswith("BE_REPAIR_"):
        return "고도화"
    raise ValueError(f"분류하지 못한 요구사항: {requirement_id}")


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def convert(source: Path, target: Path) -> tuple[int, int]:
    records = []
    with pdfplumber.open(source) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for row_no, row in enumerate(table, 1):
                    if len(row) < 8 or not row[6] or not row[6].startswith("BE_"):
                        continue
                    requirement_id = normalize(row[6])
                    title = normalize(row[5])
                    detail = normalize(row[7])
                    if not title or not detail:
                        raise ValueError(f"{page_no}쪽 {row_no}행의 제목 또는 상세가 비었습니다.")
                    records.append({
                        "id": requirement_id,
                        "title": title,
                        "detail": detail,
                        "page": page_no,
                        "row": row_no,
                        "domain": domain(requirement_id),
                        "crud": normalize(row[8]) if len(row) > 8 else "",
                        "priority": normalize(row[10]) if len(row) > 10 else "",
                    })

    duplicates = {key: count for key, count in Counter(item["id"] for item in records).items() if count > 1}
    if len(records) != 75 or duplicates != {"BE_RECOMMEND_001": 2}:
        raise ValueError(f"원본 행 또는 중복 ID를 다시 확인하십시오: {len(records)}행, {duplicates}")

    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    lines = [
        "# 제품 요구사항 정의서 원문 정리",
        "",
        f"원본 PDF: {source.name}",
        f"원본 SHA-256: {checksum}",
        "원본 요구사항: 75행, 고유 ID 74개",
        "판정 원칙: 원문에 적힌 조건만 확정한다. 추가 성공/실패 문구와 경계값은 미확정이다.",
        "중복 ID: BE_RECOMMEND_001은 위시리스트 추천과 장바구니 추천 두 행에 반복된다. ID를 변경하거나 합치지 않는다.",
        "",
    ]
    for section in SECTIONS:
        lines.extend([f"## {section}", ""])
        for item in records:
            if item["domain"] != section:
                continue
            lines.append(
                f'{item["id"]} | {item["title"]} | 원본 PDF {item["page"]}쪽 표 {item["row"]}행'
            )
            lines.append(f'원문 상세: {item["detail"]}')
            lines.append(
                f'원본 표의 CRUD: {item["crud"] or "미기재"} | 우선순위: {item["priority"] or "미기재"}'
            )
            lines.append("")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")
    return len(records), len(set(item["id"] for item in records))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    count, unique = convert(args.source, args.target)
    print(f"제품 PDF: {count}행, 고유 ID {unique}개를 {args.target}에 보관")
