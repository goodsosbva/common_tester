# Common Tester 구현 기록: 1단계 기반 구축

## 이번 단계의 목표

- 테스트 대상을 등록하고 실행 단위를 만들 수 있게 한다.
- 이후 생성기와 실행기가 공유할 실행계획 형식을 먼저 고정한다.
- 화면, API, PostgreSQL까지 실제 데이터가 오가는 최소 경로를 완성한다.

## 구현한 것

| 영역 | 기술 | 구현 내용 |
| --- | --- | --- |
| 화면 | React, TypeScript, Vite | 프로젝트 ID, 화면 경로, 정책 버전을 입력해 실행 생성. 최근 실행 조회와 상세 확인 |
| API | FastAPI, Pydantic | 실행 생성, 목록, 상세, 실행계획 저장. 요청 형식과 필드 참조 검증 |
| 저장 | PostgreSQL, psycopg | 실행 메타데이터와 JSONB 실행계획 저장 |
| 로컬 구동 | PowerShell | 저장소 전용 PostgreSQL을 127.0.0.1:55432에 만들고 API 실행 |

## 데이터가 흐르는 순서

1. 화면에서 `project_id`, `route`, `policy_version`을 입력한다.
2. `POST /api/runs`가 UUID를 발급하고 PostgreSQL `runs` 테이블에 저장한다.
3. 화면은 `GET /api/runs`로 최근 실행을 가져오고, 선택한 실행은 `GET /api/runs/{id}`로 조회한다.
4. 실행계획을 `PUT /api/runs/{id}/plan`으로 보내면 Pydantic이 형식을 검사한다. API는 계획의 대상과 실행의 대상이 같은지도 확인한 뒤 JSONB로 저장한다.

## 실행계획 형식

- [모델](../../api/app/models.py): 대상 식별자, 화면 필드와 locator, 테스트 단계, 검증 조건, 근거 출처를 하나의 `TestPlan`으로 정의했다.
- `schema_version: 1`로 형식 버전을 고정했다.
- 필드 ID와 사례 ID의 중복을 거부하고, 단계나 검증이 존재하지 않는 필드를 참조하면 저장하지 않는다.
- `fill`, `select`, `press`에는 입력값이, `value`, `text` 검증에는 기대값이 필요하다.
- `evidence`는 정책 또는 코드의 출처 ID를 담는다. 지금은 출처 ID의 실재 여부를 조회하지 않는다.
- 예시 데이터는 [test-plan.json](../../examples/test-plan.json)에 있다.

## API

| 메서드 | 경로 | 결과 |
| --- | --- | --- |
| GET | `/api/health` | DB 연결 확인 |
| POST | `/api/runs` | 실행 생성, 201 |
| GET | `/api/runs` | 최근 실행 50개 |
| GET | `/api/runs/{id}` | 실행 상세, 없으면 404 |
| PUT | `/api/runs/{id}/plan` | 실행계획 검증 및 저장, 대상 불일치면 409 |

구현 코드는 [API](../../api/app/main.py)와 [화면](../../web/src/App.tsx)에 있다. API 명세는 실행 후 `http://127.0.0.1:8000/docs`에서 볼 수 있다.

## 로컬에서 실행

저장소 루트의 PowerShell 창 두 개에서 실행한다. PostgreSQL 17이 설치되어 있어야 한다.

첫 번째 창:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
.\scripts\start-api.ps1
```

두 번째 창:

```powershell
Set-Location web
npm ci
npm run dev
```

- 화면: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8000/docs`
- 전용 DB 종료: 저장소 루트에서 `.\scripts\stop-db.ps1`
- DB 데이터와 비밀번호는 `.local/`에 있으며 Git에서 제외된다. 기존 시스템 PostgreSQL 서비스는 건드리지 않는다.

실행계획 저장 예시:

```powershell
$policy = Get-Content .\examples\policies\order-name-v1.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/policies -ContentType 'application/json' -Body $policy
$run = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/runs -ContentType 'application/json' -Body '{"project_id":"demo-orders","route":"/orders/new","policy_version":"v1"}'
$plan = Get-Content .\examples\test-plan.json -Raw
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:8000/api/runs/$($run.id)/plan" -ContentType 'application/json' -Body $plan
```

3단계부터 정책 근거 ID를 실제 등록 문단과 대조하므로, 현재 API에서는 예시 정책을 먼저 등록해야 한다.

## 확인한 결과

- Pydantic 검사: 정상 예시는 통과하고 존재하지 않는 필드 참조는 거부했다.
- API와 DB: 상태 확인, 실행 생성, 계획 저장, 상세 조회, 목록 조회가 연결되었다.
- 화면: 브라우저에서 실행 생성 후 최근 목록에 표시되고 상세에 생성된 UUID가 나타났다.
- 프런트엔드: TypeScript 검사와 Vite 빌드가 통과했다.

## 다음 단계

- 2단계에서 Python Playwright 실행기를 붙여 `TestPlan`의 단계와 검증을 실제 브라우저에서 수행한다.
- RAG, LangGraph, 함수 호출, 벡터 검색은 이후 단계다. 이번 단계의 계획 예시는 수동 입력이며 테스트 실행도 아직 하지 않는다.
- 컨테이너 이미지나 Kubernetes 확인은 최종 검증 단계에서 진행한다.
