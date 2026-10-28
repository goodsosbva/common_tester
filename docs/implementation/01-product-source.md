# 사용자 제공 요구사항 PDF를 제품 기획 기준으로 등록

수정일: 2026-10-27

## 변경 이유

1단계의 order-demo v1/v2는 문서 저장과 버전 격리를 확인하기 위한 작은 예제였다. 제품 전체의 테스트 생성 기준으로 사용하면 회원, 상품, 장바구니, 주문, 리뷰, 커뮤니티, 추천, 알림, 관리자 요구사항이 빠진다.

## 적용한 원본

- 사용자 제공 PDF: 제품_요구사항_정의서.pdf
- 9쪽 표에서 ID가 있는 요구사항 75행을 추출했다.
- 고유 ID는 74개이며 BE_RECOMMEND_001이 6쪽 표 1행과 2행에 중복된다.
- PDF 원본 해시를 확인해 documents/product/v1에 복사했다.
- 원본 표의 ID, 제목, 상세, PDF 쪽수, 표 행을 requirements.md에 보관했다.
- requirements.md만 88개 조각으로 나눠 해당 버전 SQLite에 임베딩했다. 미확정 검토 메모는 검색 근거에서 제외했다.

## 현재 활성 제품

| 위치 | 용도 |
| --- | --- |
| documents/product/v1/제품_요구사항_정의서.pdf | 판정 기준의 원본 |
| documents/product/v1/requirements.md | 원본 표를 출처와 함께 검색 가능하게 만든 문서 |
| documents/product/v1/embeddings.sqlite3 | 제품 원문 검색용 벡터와 원문 |
| docs/product-plan.md | 기능별 목차와 미확정 기준 |
| docs/product-uncertainties.md | 원본에 없는 판정 기준을 기록한 검토 메모, 검색 근거에서 제외 |
| examples/order-demo-documents/ | 기존 주문 정책 v1/v2 보관, 활성 제품 검색에서 제외 |

PDF에서 정하지 않은 오류 문구와 경계는 만들지 않았다. 추천 영역의 중복 ID도 수정하지 않고 출처 위치로 구분한다.
