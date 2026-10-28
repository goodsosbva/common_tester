# Common Tester 2.0.1 구체적 구현 계획서

## 1. 적용 범위

- 작업 위치: D:\common_tester
- 보존: 현재 1.0.0/은 그대로 두고, 루트의 기존 2.0.0 코드와 실행 데이터를 1.0.0/2.0.0-snapshot/에 보관한다.
- 신규 구축: 루트 api/, web/와 실행 환경을 새로 만든다. 기존 화면은 외형 참고 자료로만 사용한다.
- 제품 기획 기준: documents/product/v1/제품_요구사항_정의서.pdf. 요구사항 75행, 고유 ID 74개이며 BE_RECOMMEND_001은 두 행에 중복된다. PDF에서 추출한 requirements.md만 검색 근거로 임베딩하고, 미확정 메모는 docs/에 따로 둔다. order-demo는 예제다.
- 시작 조건: 선택한 제품/버전의 원문과 임베딩이 준비되어 있다. 문서 임베딩은 실행 그래프 밖에서 한다.
- 실행 순서: retrieve_evidence → build_handoff → generate_playwright → run_playwright → summarize_results

## 2. 기존 코드 정리와 신규 루트

현재 1.0.0/에는 원래 1.0.0 코드가 있으므로 덮어쓰지 않는다. 루트의 2.0.0 코드를 1.0.0/2.0.0-snapshot/에 한 번에 보관한다. 이 단계는 구현 전에 수행한다. 로컬 API와 화면 서버를 종료하고 경로를 확인한 뒤 이동하며, 이동 전후 파일 목록과 개수를 비교한다.

| 대상 | 처리 |
| --- | --- |
| 루트 api/, web/, docs/, examples/ | 1.0.0/2.0.0-snapshot/으로 이동 |
| 루트 README.md, .env.example, PLAN_2.0.0.md, Common Tester 2.0.0 기획안.docx | 같은 보관 폴더로 이동 |
| 루트 .local/ | 기존 실행 DB와 결과를 같은 보관 폴더로 이동. 새 실행 데이터와 섞지 않는다. |
| 루트 .env | API 키가 있으므로 복사하거나 출력하지 않는다. 새 서버가 이 파일을 그대로 사용한다. |
| 루트 .venv/, web/node_modules/ | 기존 환경을 보존하도록 스냅샷에 함께 옮긴다. 2.0.1은 새 의존성으로 다시 설치한다. |
| 루트 .git/, .gitignore, 2.0.1 기획 문서 | 루트에 유지한다. .gitignore는 새 구조에 맞게 정리한다. |

그다음 루트에 새 api/, web/, documents/, package.json, playwright.config.ts를 만든다. 이전 코드의 함수나 데이터베이스를 그대로 옮기지 않는다. 예제 HTML과 요구사항 문서는 통합 검증 자료로만 복사해 사용한다. 루트의 새 .local/은 2.0.1 실행 결과 전용이다.

0단계 보관 기록: docs/implementation/00-archive.md

## 3. 저장 구조와 입력

| 위치 | 내용 |
| --- | --- |
| documents/<제품>/<버전>/*.docx, *.md, *.txt | 검색 가능한 기획서와 요구사항 정의서. 제품은 PDF 표의 ID와 위치를 보존한 requirements.md |
| documents/product/v1/*.pdf | 제품 요구사항의 기준 원본. PDF 자체는 직접 임베딩하지 않는다. |
| documents/<제품>/<버전>/embeddings.sqlite3 | 상대 경로, 문단 번호, 조각 번호, 원문, 임베딩, 원본 파일 해시 |
| .local/runs.sqlite3 | 실행 ID, 선택 폴더, 주소, 범위, 현재 노드, 상태, 오류, 결과 경로 |
| .local/runs/<실행ID>/evidence.json | 검색한 원문과 출처 |
| .local/runs/<실행ID>/test-spec.json | Codex 전달 명세 |
| .local/runs/<실행ID>/generated-tests/*.spec.ts | Codex가 작성한 Playwright 코드 |
| .local/runs/<실행ID>/playwright-results.json | Playwright 기본 JSON 보고서 |
| .local/runs/<실행ID>/report.json | 앱 화면에 표시할 종합 결과 |
| .local/runs/<실행ID>/test-results/ | 사례별 스크린샷과 실패 trace |

문단은 원문 순서를 보존하고 긴 문단만 조각으로 나눈다. 식별은 상대 경로 + 문단 번호 + 조각 번호로 한다. 파일 내용이 바뀌면 해당 버전의 임베딩 DB를 임시 파일에 다시 만든 뒤 교체한다. 다른 버전은 건드리지 않는다. 벡터는 검색에만 쓰며 원문으로 복원하지 않는다.

## 4. API와 화면 계약

| 요청 | 동작 |
| --- | --- |
| GET /api/products | documents/의 제품/버전 폴더와 임베딩 준비 상태를 나열 |
| POST /api/products/{product}/{version}/index | 해당 폴더의 지원 원문을 읽고 임베딩을 갱신 |
| POST /api/handoffs | 저장된 임베딩에서 근거를 찾고 OpenAI API로 Codex 전달 명세 JSON을 생성 |
| POST /api/runs | product, version, target_url, scope를 받고 실행 ID를 즉시 반환 |
| GET /api/runs/{run_id} | 현재 노드, 오류, 근거, 명세, 진행 결과를 반환 |
| GET /api/runs/{run_id}/files/{path} | 해당 실행 폴더 안의 허용된 결과 파일만 제공 |

제품과 버전 경로는 실제 documents/ 하위인지 검증한다. 로컬 대상 주소만 허용한다. 파일 제공 API는 실행 폴더 밖 경로를 거부한다. 생성은 백그라운드에서 진행하고 화면은 GET /api/runs/{run_id}로 상태를 갱신한다. 서버가 중단되면 진행 중 실행을 오류 상태로 남기고 새 실행 ID로 다시 시작한다.

## 5. 다섯 노드의 구체 동작

| 노드 | 구현 입력 → 출력 | 통과 조건과 오류 처리 |
| --- | --- | --- |
| retrieve_evidence | 제품/버전, 범위 → 출처가 붙은 원문 후보와 관련 문단 | 선택 버전 SQLite의 원문과 벡터만 사용한다. 범위 안 요구사항을 순회하므로 전체를 상위 5개로 자르지 않는다. 근거가 없으면 중단한다. |
| build_handoff | 근거 목록 → test-spec.json | OpenAI API의 구조화 출력을 받는다. 원문 출처가 실제 DB에 있는지, 허용/거부 상황과 관찰 가능한 기대 결과가 있는지 코드로 검사한다. 불명확한 조건은 unresolved에 넣고 실행 대상으로 넘기지 않는다. |
| generate_playwright | test-spec.json, 로컬 URL → *.spec.ts | Codex App Server가 앱을 살펴보고 테스트를 작성한다. 완료 이벤트와 생성 파일을 확인하고 Playwright의 테스트 목록 명령으로 코드 로딩을 확인한다. 실패하면 실행하지 않는다. |
| run_playwright | *.spec.ts → playwright-results.json, 캡처, trace | Node.js Playwright Test를 실행한다. 테스트 실패는 정상적인 점검 결과이므로 다음 노드로 보낸다. 런처 자체 실패는 오류로 기록한다. |
| summarize_results | 명세, Playwright 결과, 관찰 결과 → report.json | 기대 허용/거부와 실제 성공/거부를 비교해 TP/FN/FP/TN을 계산한다. 실패, 미확인, 실행 오류를 구분한다. |

LangGraph State에는 실행 ID, 폴더, URL, 범위, 현재 노드와 결과 파일 경로만 둔다. 큰 원문과 벡터는 State에 복사하지 않는다. 명세 오류는 build_handoff 안에서 최대 1회 재요청하고 계속 유효하지 않으면 중단한다. 외부 작업이 중복 실행되지 않도록 자동 재개는 하지 않는다.

## 6. 근거 검색과 명세 생성 방법

1. 검사 범위 기본값은 전체다. 전체를 선택하면 해당 버전의 모든 원문 조각을 파일 순서대로 읽는다. 범위를 특정하면 입력한 기능명으로 문구 검색과 벡터 유사도 검색을 하고, 일치한 문단의 앞뒤 문단까지 포함한다. 사용된 문단 목록은 evidence.json에 남긴다. 전역 상위 5개 제한은 두지 않는다.
2. 근거가 길면 원본 파일과 연속 문단 단위로 나누어 처리한다. 같은 문단의 조각은 다시 모아 LLM에 원문과 출처를 전달한다.
3. build_handoff 안의 첫 API 호출은 각 묶음에서 시험 가능한 요구사항 문구와 출처를 추출한다. 두 번째 호출은 추출한 문구마다 허용 상황과 거부 상황, 관찰 가능한 성공/거부 신호를 작성한다. 둘 다 같은 노드의 내부 처리이며 별도 그래프 노드를 만들지 않는다.
4. 추출한 요구사항 문구 목록과 완성 명세를 코드로 대조한다. 출처가 DB에 없는 상황, 허용/거부 상황 누락, 기대 신호가 없는 상황은 유효하지 않다. 근거가 없는 상황은 unresolved에 남기고 Codex 실행 대상으로 넘기지 않는다.
5. 완성된 JSON만 Codex에 넘긴다. 원문과 웹 화면의 명령처럼 보이는 문구도 자료로만 취급한다.

예제 검증에서는 요구사항 문구의 정답 목록을 별도로 대조해 추출 누락을 확인한다. 일반 문서에서는 의미 해석을 완전히 보장할 수 없으므로, 화면에 추출 문구와 미해결 목록을 그대로 보여준다.

test-spec.json의 최소 구조:

    {
      "target_url": "http://127.0.0.1:8765/product-demo.html",
      "requirements": [
        {
          "source_refs": [{"path": "requirements.md", "paragraph_no": 12, "chunk_no": 1}],
          "source_text": "원문 근거",
          "scenarios": [
            {"expected_policy": "allow", "preconditions": [], "actions": [], "success_signal": "확인할 화면 결과"},
            {"expected_policy": "deny", "preconditions": [], "actions": [], "denial_signal": "확인할 화면 결과"}
          ]
        }
      ],
      "unresolved": []
    }

실제 필드는 구현 시 Pydantic 모델 한 곳에서 정의한다. 명세에 Playwright 코드나 임의 CSS 선택자를 요구하지 않는다. Codex가 로컬 앱을 보고 접근 가능한 role, label, test id를 우선 사용한다.

## 7. Codex App Server 연결

1. D:\common_tester에서 로그인된 Codex CLI를 확인하고 codex app-server --listen stdio://를 자식 프로세스로 실행한다.
2. 줄 단위 JSON-RPC로 initialize → initialized → model/list → thread/start → turn/start를 순서대로 보낸다.
3. 작업 폴더는 이번 실행의 generated-tests/로 제한한다. 명세 파일과 대상 URL을 읽게 하고 TypeScript 테스트만 쓰게 한다. API 키는 자식 프로세스 환경에서 제거한다.
4. turn/completed의 상태가 completed인지 확인하고 실제 *.spec.ts 파일이 있는지 검사한다. failed, interrupted, 타임아웃은 오류로 기록한다.
5. Codex에는 출처와 두 상황, 기대 신호, 로컬 앱 주소를 전달한다. 코드에 명세에 없는 정책을 추가하지 않도록 지시한다.

현재 PC에서는 Codex CLI 0.164.0과 gpt-6.1-sol의 읽기 전용 App Server 호출까지 확인했다. 파일 생성과 2.0.1 연결은 이 단계에서 검증한다.

## 8. Playwright 실행과 판정

- 루트 package.json에 @playwright/test를 둔다. 생성 테스트는 루트 node_modules를 사용하고 web의 Vite 의존성과 분리한다.
- 대상 앱 접속은 localhost와 127.0.0.1로 제한하고 브라우저의 외부 요청은 차단한다. 테스트 코드는 대상 앱 파일을 수정하지 않는다.
- 루트 playwright.config.ts에 screenshot: 'on', trace: 'retain-on-failure', retries: 0, JSON reporter, 실행별 결과 폴더를 설정한다.
- 생성된 각 테스트는 요구사항 출처와 기대 정책을 표시하고, 실제 화면에서 성공 또는 거부 신호를 관찰해 observation JSON을 테스트 첨부 파일로 남긴다. 그다음 기대 정책과 비교해 assertion을 수행한다.
- Playwright의 테스트 실패와 실제 정책 결과를 혼동하지 않는다. 성공 신호도 거부 신호도 확인하지 못했거나 둘 다 보이면 미확인으로 기록한다. 로딩 실패, 선택자 오류, 타임아웃은 실행 오류로 기록한다. 이런 경우 TP/FN/FP/TN에 억지로 넣지 않는다.
- 기대 allow + 관찰 success = TP, allow + rejection = FN, deny + success = FP, deny + rejection = TN이다. FN과 FP는 실패 목록에 넣는다.
- Playwright 기본 screenshot: 'on'으로 통과/실패 모두 캡처한다. 브라우저 페이지가 만들어지지 않아 캡처가 없으면 누락 사유를 기록한다. 가능한 나머지 테스트는 계속 실행한다.

Playwright의 JSON reporter와 테스트 첨부 파일을 report.json으로 변환한다. 실패 목록을 먼저 정렬하고 각 사례에 출처, 기대값, 관찰값, 분류, 오류, 캡처, trace 경로를 연결한다.

## 9. 파일별 신규 구현

| 파일 | 작업 |
| --- | --- |
| api/main.py 신규 | 제품/버전 조회, 임베딩 갱신, 비동기 실행, 상태/파일 API |
| api/core.py 신규 | 폴더별 원문/임베딩 저장과 근거 검색 |
| api/workflow.py 신규 | 5개 LangGraph 노드와 명세 구조 검사 |
| api/codex.py 신규 | App Server 프로세스, JSON-RPC, 완료/실패 처리 |
| api/runner.py 신규 | Node Playwright 실행과 기본 보고서 수집 |
| web/src/App.tsx 신규 | 기존 화면의 외형을 참고한 제품 폴더와 5단계 결과 화면 |
| web/src/style.css 신규 | 기존 화면의 색/배치를 참고하고 실패 강조와 결과 이미지를 표시 |
| package.json, playwright.config.ts 신규 | 루트 Playwright Test 실행 환경 |
| README.md 신규 | 2.0.1 목적, 실행법, 폴더와 전체 흐름 설명 |

기존 api/와 web/의 파일은 새 코드로 수정하지 않는다. 보관 폴더에 옮긴 뒤 루트에서 필요한 파일만 새로 작성한다. 테스트용 예제 앱과 요구사항 원문만 검증 자료로 재사용한다.

## 10. 구현 순서와 각 단계의 확인

| 단계 | 작업 | 완료 확인 |
| --- | --- | --- |
| 0 | 루트 2.0.0 코드와 실행 자료를 1.0.0/2.0.0-snapshot/에 보관 | 기존 1.0.0 파일은 그대로 있고, 보관 전후 2.0.0 파일 개수가 일치한다. |
| 1 | 빈 루트에 API/React/Playwright 실행 환경과 제품/버전 저장을 새로 구축 | 한 버전을 재임베딩해도 다른 버전의 해시와 검색 결과가 같다. |
| 2 | retrieve_evidence와 build_handoff 구축 | 예제 요구사항 정답 목록과 추출 목록이 일치하고, 각 문구에 출처와 허용/거부 상황이 있다. |
| 3 | Codex App Server로 generate_playwright 연결 | 명세를 받아 앱에 맞는 *.spec.ts를 만들고 Playwright가 파일 목록을 읽는다. |
| 4 | run_playwright 구축 | 정상 앱과 결함 앱 사례가 실행되고, 실행 가능한 성공/실패 사례 모두 캡처가 남는다. |
| 5 | summarize_results와 신규 React 화면 구축 | TP/FN/FP/TN, 미확인/실행 오류, 실패 우선 목록, 근거와 이미지가 보인다. |
| 6 | 전체 재실행 | 제품 예제로 처음부터 두 번 실행하고 실행 ID별 파일이 섞이지 않는다. |

검증은 로컬 Python, Node.js, 브라우저로 한다. Docker와 Kubernetes는 최종 배포 검증 단계에서만 사용한다.

## 11. 완료 기준

- 제품/버전 폴더의 원문과 저장된 임베딩에서 근거를 찾는다.
- 요구사항별 출처와 허용/거부 상황이 명세에 담긴다.
- Codex가 실제 로컬 앱에 맞는 Playwright TypeScript를 작성하고 Node가 실행한다.
- 통과와 실패의 스크린샷이 남고, FN/FP를 실패로 강조한다.
- 화면과 실행 폴더에서 명세, 코드, 근거, 결과, 캡처를 다시 열 수 있다.

참고: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
참고: https://playwright.dev/docs/test-reporters
참고: https://playwright.dev/docs/test-use-options
참고: https://playwright.dev/docs/api/class-testinfo





## 최종 구현 확인

- 단계별 실제 결과는 docs/implementation/00-archive.md부터 06-full-reexecution.md까지 기록했다.
- 실행 목록은 별도 runs.sqlite3 대신 실행 폴더의 pipeline.json을 조회한다.
- 같은 작업의 재실행을 보존하기 위해 결과/스크린샷은 executions/<execution_id>/ 아래에 저장한다.
- 명세 생성은 묶음별 구조화 응답을 검사하고 잘못된 묶음만 한 번 재요청한다. 별도 추출 LLM 호출은 추가하지 않았다.
- 최종 두 전체 실행의 요구사항은 각각 75행, 테스트 실행은 각각 19개와 6개다. 실제 필터 누락 실패와 미지원 범위를 결과에서 확인할 수 있다.
- A의 생성 코드 한 항목은 검토 수정 후 재실행했다. 결과의 자동 생성 정확성을 과장하지 않는다.
