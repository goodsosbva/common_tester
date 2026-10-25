# Common Tester 구현 기록: 3단계 정책 검색과 근거 연결

## 이번 단계의 범위

- 한국어 정책 문서를 프로젝트와 버전별로 등록하고 문단 단위로 색인한다.
- 질문과 가까운 정책 문단을 찾아 원문과 `source_id`를 돌려준다.
- 실행계획이 존재하지 않거나 다른 버전의 정책 문단을 근거로 쓰면 저장을 거부한다.

이번 단계는 RAG의 **검색과 근거 연결**이다. 검색 결과로 실행계획을 생성하는 모델 호출은 4단계에서 구현한다.

## 구현 구성

| 파일 | 구현 내용 |
| --- | --- |
| [policies.py](../../api/app/policies.py) | 문단 분할, FastEmbed 임베딩, 정책 등록, 검색 순위, 근거 ID 검증 |
| [models.py](../../api/app/models.py) | 정책 등록과 검색 요청 및 응답의 Pydantic 형식 |
| [main.py](../../api/app/main.py) | 정책 API와 PostgreSQL 테이블 생성, 실행계획 저장 시 근거 검사 |
| [예시 정책](../../examples/policies/order-name-v1.json) | 주문명 v1/v2, 수량, 금액, 메모 정책 |
| [check-stage3.ps1](../../scripts/check-stage3.ps1) | 정책 등록, 검색 순위, 버전 격리, 원문 조회, 잘못된 근거 차단 검사 |

## 데이터 흐름

1. `POST /api/policies`로 정책 원문, 프로젝트, 문서 ID, 버전, 제목을 보낸다.
2. 빈 줄로 나눈 문단을 최대 500자 단위로 분할하고 제목과 함께 임베딩한다. 모델은 `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, 벡터 크기는 384다.
3. PostgreSQL `policy_documents`에 원문과 SHA-256 해시, `policy_chunks`에 문단과 임베딩을 저장한다. 같은 문서와 버전을 같은 내용으로 재등록하면 기존 색인을 반환하고, 내용을 바꾸면 409를 반환한다.
4. `POST /api/policies/search`는 프로젝트와 버전이 일치하는 문단만 가져와 질문과 비교한다. 점수는 코사인 유사도와 한국어 두 글자 묶음의 일치 비율을 합친다: `score = semantic_score + 0.35 × keyword_score`.
5. 검색 결과는 `source_id`, 원문, 문서 제목, 버전, 문단 순서와 두 점수를 포함한다. `GET /api/policies/sources/{source_id}`로 해당 원문을 다시 확인할 수 있다.
6. `PUT /api/runs/{id}/plan`은 정책 근거가 같은 프로젝트와 정책 버전의 등록 문단인지 확인한다. 맞지 않으면 422다.

`source_id`는 `policy:<project>:<document>:<version>:<ordinal>` 형식이다. 예: `policy:demo-orders:order-name:v1:0`.

## 로컬에서 확인

API 실행 후 저장소 루트의 다른 PowerShell 창에서:

```powershell
.\scripts\check-stage3.ps1
```

첫 정책 등록에는 모델 다운로드가 필요하다. 캐시는 `.local/models/`에 저장되며 Git에 포함되지 않는다. 테스트 스크립트는 여러 번 실행해도 같은 버전의 문서를 중복 생성하지 않는다.

## 실제 측정 결과

샘플 정책 5개에서 문단 6개가 만들어졌다. 아래 질문 5개는 기대 문단이 모두 첫 결과였다.

| 질문 | 첫 결과 |
| --- | --- |
| 주문명 최대 글자 수 | 주문명 v1, 20자 제한 |
| 주문 수량은 몇 개까지 가능한가 | 수량 v1, 1~99 |
| 요청 금액에 음수를 넣어도 되나요 | 금액 v1, 음수 거부 |
| 메모는 필수인가요 | 메모 v1, 선택 입력 |
| 재고가 부족하면 저장되나요 | 수량 v1, 재고 부족 문단 |

- 이 샘플의 Top-1 적중: **5/5**. 작은 자체 예시 집합의 결과이며 일반 검색 정확도로 해석하지 않는다.
- v2 검색에는 주문명 v2의 30자 정책만 나왔고 v1 문단은 섞이지 않았다.
- 다른 버전의 문단 ID를 v1 실행계획에 넣으면 422로 거부했다.
- 2단계 브라우저 검사도 다시 실행해 정상 2건 통과, 결함 1건 실패를 확인했다.

## 현재 한계와 다음 단계

- 로컬 PostgreSQL 17에는 pgvector 확장이 없고 Windows C++ 빌드 도구도 없다. 지금은 벡터를 PostgreSQL `REAL[]`로 보관하고, 필터링된 소규모 문단을 Python에서 정확 비교한다. 이 방식은 큰 문서 집합의 검색 지연과 색인 확장성을 아직 검증하지 못한다.
- 정책 근거 ID의 존재와 버전은 검증하지만, 테스트 기대값의 숫자나 문구가 원문에서 논리적으로 도출되는지는 아직 검사하지 않는다.
- 4단계에서 모델의 정책 검색 도구 호출과 구조화된 실행계획 생성을 연결한다. pgvector와 배포 환경은 최종 검증에서 확인한다.

임베딩 모델의 다국어 지원과 크기는 [FastEmbed 모델 목록](https://qdrant.github.io/fastembed/examples/Supported_Models/)에서, pgvector의 Windows 설치 요구사항은 [공식 pgvector 문서](https://github.com/pgvector/pgvector#installation-notes---windows)에서 확인했다.
