# Common Tester 구현 기록: 5단계 LangGraph 실행 흐름

## 목표

- 계획 생성부터 검증, 사람의 승인, 브라우저 실행, 결과 기록까지 한 흐름으로 연결한다.
- 정책 근거가 틀린 계획은 한 번만 재생성해 다시 검증한다.
- 승인 대기 지점을 PostgreSQL 체크포인트에 남겨 서버 연결을 새로 열어도 이어서 실행한다.
- 승인하지 않은 계획은 브라우저에서 실행하지 않는다.

## 구현한 경로

| 파일 | 내용 |
| --- | --- |
| [workflow.py](../../api/app/workflow.py) | LangGraph 노드와 조건부 이동, 승인 중단, 실행과 결과 기록 |
| [validation.py](../../api/app/validation.py) | 수동 저장, 기존 모델 생성, 새 워크플로가 공유하는 계획 검증 |
| [main.py](../../api/app/main.py) | 체크포인터 테이블 준비와 워크플로 시작, 재개 API |
| [models.py](../../api/app/models.py) | 승인 요청과 검토 대기, 거절 상태 |
| [check_stage5.py](../../api/check_stage5.py) | 보정, 체크포인트 재개, 승인과 거절, 오류 경계 검사 |

## 실제 처리 순서

1. `POST /api/runs/{id}/workflow/start`가 목표를 받아 실행 상태를 `generating`으로 바꾼다.
2. `draft`가 4단계 도구 호출 생성기를 사용해 `TestPlan`을 만든다.
3. `validate`가 계획의 실행 대상, 정책 버전, 정책 근거 ID를 확인한다.
4. 검증 실패 시 `repair`가 오류를 다음 생성 요청에 붙여 한 번 더 시도한다. 두 번째도 실패하면 `error`로 끝낸다.
5. 검증 통과 계획을 DB에 저장하고 `awaiting_review`에서 `interrupt()`로 멈춘다. 이때 LangGraph 상태는 실행 ID를 `thread_id`로 삼아 PostgreSQL에 저장한다.
6. `POST /api/runs/{id}/workflow/resume`에 `{"approved": true}`를 보내면 `Command(resume=...)`로 같은 체크포인트를 이어서 실행한다. `false`면 `rejected`로 끝난다.
7. 승인 시 Python Playwright가 브라우저 검사를 수행한다. 결과와 최종 상태는 DB에 저장되고 `report` 노드가 워크플로 완료를 기록한다.

`/api/runs/{id}`에서 `plan`, `generation.attempts`, `workflow`, `result`를 확인할 수 있다. 검토 대기 중에는 기존 `/execute` 경로도 409로 거부한다.

## 요청 예시

```http
POST /api/runs/{id}/workflow/start
Content-Type: application/json

{"objective":"주문명 20자 제한 검사"}
```

```http
POST /api/runs/{id}/workflow/resume
Content-Type: application/json

{"approved":true}
```

시작 요청은 등록된 `demo-orders`의 `/fixtures/order.html`에서만 허용한다. 기존 4단계 `/generate` API는 유지했다.

## 검증 결과

- 모의 모델의 첫 계획은 존재하지 않는 정책 근거를 담았다. 검증 오류를 받은 두 번째 계획은 통과했고 `generation.attempts`에 두 번의 응답이 기록됐다.
- 승인 전 `/execute` 요청은 409였다. 앱 컨텍스트와 PostgreSQL 체크포인터 연결을 다시 만든 뒤 같은 실행 ID로 재개했고, 계획을 다시 만들지 않고 정상 화면 2건이 통과했다.
- 거절된 계획은 `rejected`가 되었고 실행되지 않았다. 같은 승인 요청을 반복하면 409였다.
- 두 번 모두 근거가 잘못된 경우 `error`와 검증 이유가 남고 계획은 저장되지 않았다.
- 4단계 모의 모델 통합 검사도 다시 통과했다.

검사 명령은 전용 API와 DB를 실행한 상태에서 `\.venv\Scripts\python.exe api\check_stage5.py`다.

## 남은 범위

- 실제 OpenAI API 응답은 아직 검증하지 못했다. 유효한 새 키를 로컬 환경 변수로 설정한 뒤 실제 생성과 승인 흐름을 확인해야 한다.
- 검증은 계획의 구조, 대상, 정책 근거의 존재와 버전까지 확인한다. 정책 원문이 테스트의 기대값을 의미상 뒷받침하는지는 사람이 승인 화면에서 검토해야 한다.
- 브라우저 실행 도중 프로세스가 강제 종료되면 실행 결과를 확정할 수 없다. 해당 실행을 자동 재시도하지 않고 새 실행을 만들어 확인해야 한다.
- 웹 화면의 계획 검토와 승인 조작은 6단계에서 추가한다.

LangGraph의 [중단과 재개](https://docs.langchain.com/oss/python/langgraph/interrupts), [PostgreSQL 체크포인트](https://docs.langchain.com/oss/python/langgraph/persistence), [StateGraph 조건부 흐름](https://docs.langchain.com/oss/python/langgraph/graph-api)을 기준으로 구현했다.
