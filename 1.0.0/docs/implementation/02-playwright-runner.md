# Common Tester 구현 기록: 2단계 Python Playwright 실행기

## 목표와 완료 기준

- 사람이 작성한 `TestPlan`을 실제 브라우저에서 실행한다.
- 정상 주문 화면의 테스트는 통과하고, 의도적으로 결함을 넣은 화면에서는 실패를 기록한다.
- 실패 화면의 캡처와 trace, 사례별 결과를 남겨 원인을 재확인할 수 있게 한다.

## 구현한 파일

| 파일 | 역할 |
| --- | --- |
| [runner.py](../../api/app/runner.py) | `TestPlan`의 필드, 단계, 검증을 Playwright 동작으로 해석 |
| [main.py](../../api/app/main.py) | 실행 API, 상태 갱신, 결과 저장, 샘플 화면 제공 |
| [models.py](../../api/app/models.py) | 실행 상태와 결과 필드 정의 |
| [order.html](../../examples/fixtures/order.html) | 주문명 20자 제한을 검사하는 공개용 샘플 화면. `?bug=1`은 제한을 30자로 바꾼 결함 상태 |
| [normal-plan.json](../../examples/normal-plan.json), [bug-plan.json](../../examples/bug-plan.json) | 정상 화면과 결함 화면에 적용할 수동 작성 실행계획 |
| [check-stage2.ps1](../../scripts/check-stage2.ps1) | 두 계획의 실제 실행 결과와 증거 파일을 확인 |

## 실행 과정

1. `POST /api/runs`로 실행 ID를 만들고 `PUT /api/runs/{id}/plan`으로 실행계획을 저장한다.
2. `POST /api/runs/{id}/execute`가 계획을 다시 검증하고 상태를 `running`으로 바꾼다.
3. Python Playwright가 Chromium을 열고 사례마다 새 브라우저 context를 만든다.
4. `role`, `label`, `test_id`, `css` locator로 요소를 찾는다. 해당 요소가 둘 이상이면 임의의 첫 요소를 쓰지 않고 실패로 기록한다.
5. 허용된 `fill`, `click`, `select`, `press`만 수행하고 `visible`, `value`, `text`를 검증한다.
6. 실패하면 캡처와 Playwright trace를 `.local/runs/<run-id>/`에 저장한다.
7. 사례 결과를 PostgreSQL의 `runs.result` JSONB에 저장하고 실행 상태를 `passed`, `failed`, `error` 중 하나로 끝낸다.

같은 실행 ID의 중복 실행과 실행 후 계획 변경은 409로 거부한다. 실행계획이 없는 실행도 시작할 수 없다. 테스트 대상의 기본 주소는 로컬 API 서버이며, `TEST_TARGET_BASE_URL` 환경 변수로 변경할 수 있다.

## 로컬에서 재현

PowerShell 첫 번째 창에서 저장소 루트 기준:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
.\scripts\start-api.ps1
```

두 번째 창에서:

```powershell
.\scripts\check-stage2.ps1
```

검사 스크립트는 두 실행을 새로 생성하므로 여러 번 실행할 수 있다. 실패 파일은 `.local/`에만 저장되며 Git에 포함되지 않는다.

## 실제 확인 결과

| 대상 | 기대 | 결과 |
| --- | --- | --- |
| 정상 주문 화면 | 정상 주문명 저장, 21자 주문명 거부 | 2건 중 2건 통과 |
| 결함 주문 화면 | 21자 주문명 거부 | 1건 실패, 실제 화면은 `저장되었습니다.` 표시 |

- 결함 실행의 캡처에는 21자 주문명과 잘못된 저장 성공 문구가 함께 보였다.
- 실패 캡처와 trace 파일이 생성됐고, 실패 상태와 사례별 결과를 API로 다시 조회했다.
- Playwright 1.56.0과 로컬 Chromium으로 검증했다. 브라우저 API 사용 방식은 [Playwright Python locator 문서](https://playwright.dev/python/docs/locators)와 [trace 문서](https://playwright.dev/python/docs/trace-viewer)를 따른다.

## 2단계 종료 시 남은 범위

- 실행계획과 정책 출처는 사람이 작성했다. 출처 ID의 실재 여부는 [3단계](03-policy-retrieval.md)에서 연결했다.
- 모델의 도구 호출, LangGraph, 화면의 상세 실행 결과 표시는 이후 단계다.
- 컨테이너 이미지와 Kubernetes 검증은 최종 확인 단계에서 진행한다.
