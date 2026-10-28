# 1단계: 테스트 실행의 기본 구조

## 한 문장으로 설명

테스트 한 번을 `run`으로 저장하고, 생성기와 브라우저 실행기가 함께 사용할 `TestPlan` 형식을 정한 뒤, React 화면에서 FastAPI를 거쳐 PostgreSQL까지 저장과 조회가 되는 경로를 만들었다.

이 단계에서는 AI가 계획을 만들거나 브라우저를 조작하지 않는다. 2단계에서 실행기를, 3단계 이후에 정책 검색과 모델 생성을 붙일 수 있도록 입력과 저장 형식을 먼저 확정했다.

## 왜 이 구조로 만들었나

- **실행 단위가 필요했다.** 같은 화면을 여러 번 테스트해도 요청과 결과를 구분할 수 있도록 실행마다 UUID를 발급한다.
- **생성기와 실행기의 약속이 필요했다.** 생성기가 자유 형식의 문장을 반환하면 실행기가 해석하기 어렵다. 그래서 화면 요소, 조작 순서, 기대 결과를 `TestPlan`이라는 구조화된 데이터로 정의했다.
- **저장과 검증의 역할을 나눴다.** `project_id`, `route`, `policy_version`, `status`처럼 목록과 상태 확인에 필요한 값은 `runs` 테이블의 열로 저장한다. 테스트 사례 수에 따라 모양이 달라지는 계획은 JSONB로 저장한다. 저장 전에 Pydantic과 서버 검증을 통과시킨다.

## 실제 요청 한 번이 처리되는 순서

예: `demo-orders` 프로젝트의 `/fixtures/order.html`을 정책 `v1` 기준으로 테스트한다.

1. React가 프로젝트 ID, 화면 경로, 정책 버전을 입력받아 `POST /api/runs`로 보낸다. 화면 코드는 [App.tsx](../../web/src/App.tsx)의 `createRun`에 있다.
2. FastAPI가 요청을 `RunCreate` 모델로 검사한다. 경로는 `/`로 시작해야 하고 식별자는 빈 문자열일 수 없다. 모델은 [models.py](../../api/app/models.py)에 있다.
3. `create_run`이 `uuid4()`로 실행 ID를 만들고 PostgreSQL `runs` 테이블에 `project_id`, `route`, `policy_version`을 저장한다. `status`의 기본값은 `created`다. DB가 반환한 행을 API 응답으로 보낸다. 코드는 [main.py](../../api/app/main.py)에 있다.
4. React가 반환된 실행을 화면에 선택하고 `GET /api/runs`로 목록을 다시 읽는다. 상세 화면을 열면 `GET /api/runs/{id}`로 해당 행을 조회한다.
5. 계획을 저장할 때는 `PUT /api/runs/{id}/plan`으로 `TestPlan` JSON을 보낸다. FastAPI와 Pydantic이 형식을 검사하고, 서버가 해당 실행을 `SELECT ... FOR UPDATE`로 잠근 뒤 상태와 대상을 확인한다. 통과하면 계획 전체를 JSONB 열에 저장한다.

요약하면 `화면 입력 → HTTP 요청 → Pydantic 검사 → DB 저장 → HTTP 응답 → 화면 갱신`이다.

## TestPlan을 어떻게 설계했나

계획에는 다음 데이터가 들어간다.

| 항목 | 의미 | 예 |
| --- | --- | --- |
| 대상 | 어느 프로젝트와 화면, 정책 버전인지 | `demo-orders`, `/fixtures/order.html`, `v1` |
| `fields` | 조작할 화면 요소와 찾는 방법 | `order_name`을 `label=주문명`으로 찾기 |
| `steps` | 브라우저가 할 동작 | `order_name`에 `정상 주문` 입력 |
| `assertions` | 동작 뒤 기대하는 상태 | `order_name`의 값이 `정상 주문`인지 확인 |
| `evidence` | 해당 사례의 근거 출처 | 정책 문단의 `source_id` |

예를 들면 `fields`에 `order_name`이라는 요소를 한 번 정의하고, 사례는 그 ID를 참조한다. 브라우저 실행기는 나중에 이 ID로 locator를 찾고 `fill`과 `value` 검증을 수행한다. 전체 예시는 [test-plan.json](../../examples/test-plan.json)에 있다.

계획 저장 전에 [models.py](../../api/app/models.py)는 필드 ID와 사례 ID의 중복, 존재하지 않는 필드 참조, 동작과 기대값의 누락을 거부한다. `schema_version: 1`을 두어 계획 형식이 바뀔 때 버전을 구별할 수 있게 했다. [validation.py](../../api/app/validation.py)는 실행과 계획의 프로젝트, 경로, 정책 버전이 같은지도 확인한다.

정책 출처 ID의 실제 존재 여부 검사는 3단계에서 추가했다. 현재 코드에는 이 검사도 포함되어 있지만 1단계의 핵심은 계획의 **형식과 대상 일치**를 보장하는 것이다.

## 확인한 것과 범위

- 정상 계획 저장과 조회, 잘못된 필드 참조 거부를 확인했다.
- React에서 실행을 만들면 목록과 상세에 저장된 실행 ID가 나타나는지 확인했다.
- TypeScript 검사와 Vite 빌드가 통과했다.
- 1단계의 테스트 계획은 수동 예시다. 브라우저 실행, 정책 검색, 모델 생성은 이후 단계에서 구현했다.

로컬 구동 방법은 [README](../../README.md)에 있다.
