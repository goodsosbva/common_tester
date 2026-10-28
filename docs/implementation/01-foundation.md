# 1단계 새 실행 환경과 문서 임베딩

완료일: 2026-10-27

## 왜 이렇게 만들었는가

- 제품과 버전은 폴더로 구분한다. 같은 파일명이 다른 버전에 있어도 별도 SQLite 파일을 사용하므로 서로 덮어쓰지 않는다.
- 문서 원문을 문단과 조각으로 나누고 상대 경로, 문단 번호, 조각 번호를 함께 저장한다. 검색 결과가 어느 원문에서 왔는지 확인할 수 있다.
- 임베딩은 검색용이다. LLM에 줄 근거는 벡터를 역변환한 내용이 아니라 SQLite에 함께 보관한 원문이다.
- 재임베딩은 임시 SQLite를 완성한 뒤 원래 파일과 교체한다. 처리 도중 실패하면 이전 버전 DB를 보존한다.
- 제품 목록은 현재 원문 해시와 저장된 원문 해시를 비교한다. 원문을 수정하면 다시 임베딩할 때까지 준비되지 않은 상태로 표시한다.
- 각 제품/버전 안의 여러 DOCX, Markdown, TXT 파일을 읽는다. 문서 ID를 따로 입력하지 않는다.

## 만든 것

| 위치 | 내용 |
| --- | --- |
| api/core.py | 원문 읽기, 문단/조각 분리, FastEmbed 다국어 임베딩, 버전별 SQLite 교체 |
| api/main.py | 상태 조회, 제품/버전 목록, 선택 버전 재임베딩 API |
| web/src/ | 제품/버전 선택과 임베딩 상태를 보여 주는 새 React 화면 |
| package.json, playwright.config.ts | 이후 Codex가 만드는 TypeScript 테스트를 실행할 Node Playwright Test 환경 |
| documents/order-demo/v1, v2 | 실제 주문 정책 원문과 각각의 임베딩 DB |
| api/check_foundation.py | v1 변경이 v2에 영향을 주지 않는지 확인하는 스크립트 |

SQLite에는 source_files(path, sha256), chunks(path, paragraph_no, chunk_no, content, embedding), metadata(model, indexed_at)를 둔다. 버전 값은 DB에 중복 저장하지 않고 상위 폴더가 나타낸다.

## 확인 결과

| 확인 | 결과 |
| --- | --- |
| 새 Python 가상환경 의존성 설치 | 성공 |
| 새 React 화면 빌드 | 성공 |
| Playwright Test 1.56.0 및 Chromium 화면 확인 | 성공 |
| 주문 정책 v1 임베딩 | 원문 조각 5개 |
| 주문 정책 v2 임베딩 | 원문 조각 5개 |
| v1을 재임베딩한 뒤 v2 DB SHA-256 비교 | 동일 |
| v1 원문 수정 직후 목록 상태 | v1 갱신 필요, v2 준비됨 |
| 테스트용 v1 원문 변경 후 재임베딩 | v1 DB 변경, v2 DB 그대로 |
| DOCX 문단 읽기와 출처 번호 확인 | 성공 |
| 실제 API와 웹 화면 HTTP 응답 | 각각 200 |
| 브라우저의 제품/버전 2개 표시 | 성공 |

현재 화면 주소는 http://127.0.0.1:5173 이다. API는 http://127.0.0.1:8000 에서 실행 중이다. 캡처는 .local/stage1-ui.png에 있다.

## 현재 범위

1단계는 문서 준비와 화면의 기본 구조까지다. retrieve_evidence부터 summarize_results까지의 5개 실행 노드, Codex 연결, 테스트 실행, 결과 화면은 아직 연결하지 않았다. 다음 단계는 저장된 임베딩을 검색해 원문 근거를 모으고 Codex 전달 명세 JSON을 만드는 것이다.


## 이후 원문 기준 변경

1단계의 order-demo 정책은 저장 방식 확인용 예제였고, 현재 examples/order-demo-documents/에 보관했다. 활성 제품의 테스트 생성 기준은 제품 PDF로 변경했다. 세부 내용은 01-product-source.md와 docs/product-plan.md를 따른다.
