# Common Tester 2.0.1

제품 기획과 요구사항을 근거로 웹앱을 점검하는 도구다. 기준 문서는 documents/product/v1의 원본 PDF다. PDF 표의 요구사항 ID와 위치를 보존한 requirements.md를 임베딩해 검색하고, 원문에 없는 판정 기준은 docs/product-uncertainties.md에 미확정으로 기록한다. 검토 메모는 임베딩 검색 대상에서 제외한다.

현재 `retrieve_evidence → build_handoff → generate_playwright → run_playwright → summarize_results` 다섯 노드가 연결됐다. 문서는 128토큰 이내로 분할해 로컬 임베딩하고, 검색된 원문을 OpenAI API 명세로 바꾼 뒤 Codex App Server로 Playwright 코드를 생성한다. 성공과 실패 모두 캡처하고, 실제 화면 신호로 TP/FN/FP/TN을 분류한다. React 화면에서 실패 항목, 근거 원문, 스크린샷과 실행 기록을 확인할 수 있다. 이전 코드는 `1.0.0/2.0.0-snapshot/`에 보관했다.

5단계 로컬 검증 예제는 당시 계획 190상황 중 20개를 실행했다. 나머지 170개는 예제 앱의 미지원 사유를 기록하며 통과로 계산하지 않는다. 정상 앱과 네 결함 앱에서 같은 20개 테스트를 실행해 PNG 100장과 의도한 실패 4건을 확인했다. 조회 전용 2개는 상세 점검을 통과해도 허용/거부 관찰 신호가 없어 정책 미확인이다.

## 기획 원본과 폴더

| 경로 | 역할 |
| --- | --- |
| documents/product/v1/제품_요구사항_정의서.pdf | 제품 요구사항의 기준 원본, 9쪽 |
| documents/product/v1/requirements.md | PDF의 75개 요구사항 행, ID와 쪽수/표 행을 보존한 검색용 문서 |
| docs/product-uncertainties.md | 원본에 없는 판정 기준과 중복 ID 검토 메모. 임베딩에서 제외 |
| documents/product/v1/embeddings.sqlite3 | 원문과 벡터를 저장한 해당 버전 DB |
| docs/product-plan.md | 회원, 상품, 장바구니, 주문, 리뷰, 커뮤니티, 추천, 알림, 관리자 기능 목차 |
| examples/order-demo-documents/ | 1단계 저장 구조 검증용 주문 정책 예제, 활성 제품에서 제외 |
| examples/product-demo.html | 일부 요구사항의 테스트를 위한 로컬 예제 화면 |
| api/, web/ | FastAPI와 React 화면 |
| docs/implementation/ | 단계별 구현 및 확인 기록 |

PDF에서 BE_RECOMMEND_001이 서로 다른 추천 요구사항 두 행에 사용된다. ID는 고치지 않고 PDF 6쪽의 표 행으로 구분한다. 전체는 75행, 고유 ID는 74개다. 제품 예제 화면이 PDF의 모든 기능을 구현했다고 가정하지 않는다.

## 설치

Python 3.12와 Node.js 22.23.3에서 확인했다. Docker는 필요 없다.

PowerShell에서 D:\common_tester를 작업 폴더로 설정한 뒤:

    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
    npm ci
    Set-Location web
    npm ci

브라우저가 설치되지 않았다면 루트에서 실행한다.

    npx playwright install chromium

## 실행

API 터미널:

    .\.venv\Scripts\python.exe -m uvicorn main:app --app-dir api --host 127.0.0.1 --port 8000

화면 터미널:

    Set-Location web
    npm run dev

예제 앱 터미널:

    .\.venv\Scripts\python.exe -m http.server 8765 --bind 127.0.0.1 --directory examples

화면 주소는 http://127.0.0.1:5173 이다. 작업 기록과 실행 선택으로 결과를 확인한다. 새 테스트 준비에서 product / v1, 대상 URL, 범위 전체를 선택한 뒤 생성부터 실행까지 시작할 수 있다. 문서를 변경했다면 먼저 문서 임베딩을 누른다. 명세 생성에는 루트 `.env`의 `OPENAI_API_KEY`를 사용하고, 코드 생성에는 로그인된 Codex App Server를 사용한다.

## 근거 검색과 전달 명세

제품/버전, 테스트 대상 URL, 검사 범위를 JSON으로 `POST /api/handoffs`에 전달한다. 전체 제품 요구사항을 처리할 때는 `scope`에 `전체`를 전달한다. 실행별 evidence.json과 test-spec.json은 .local/runs/<실행ID>/에 저장된다. `POST /api/runs/<실행ID>/generate-playwright`는 Codex App Server로 테스트 코드를 만들고 Playwright `--list`로 파일을 확인한다.

## 확인

    .\.venv\Scripts\python.exe api\check_foundation.py
    .\.venv\Scripts\python.exe api\check_stage5.py
    node web\check_stage5_ui.cjs
    Set-Location web
    npm run build

[제품 기획 정리](docs/product-plan.md)
[PDF 반영 기록](docs/implementation/01-product-source.md)
[2단계 구현 기록](docs/implementation/02-evidence-handoff.md)
[3단계 구현 기록](docs/implementation/03-codex-playwright.md)




[4단계 실행과 캡처 기록](docs/implementation/04-playwright-execution.md)

[5단계 집계와 React 화면 기록](docs/implementation/05-results-workspace.md)

## 결과 조회 API

- `POST /api/runs`: 제품/버전/대상 URL/범위를 받아 202와 작업 ID를 반환하고 다섯 노드를 백그라운드에서 실행한다.
- `GET /api/runs`: 작업 기록과 개별 실행 요약.
- `GET /api/runs/{run_id}`: 현재 처리 노드, 상태, 오류.
- `POST /api/runs/{run_id}/execute`: 기존 코드로 새 실행을 만들고 집계한다.
- `GET /api/runs/{run_id}/executions/{execution_id}/report`: 실패, 정책 사분면, 미확인, 원문과 이미지.

정책의 허용/거부와 색상/위치 등 상세 점검 결과는 구분한다. 거부해야 할 빈 입력을 거부했지만 경고 색상이 틀리면 TN과 상세 실패로 기록한다. 6단계에서 새 작업 두 개의 전체 실행과 작업 ID별 격리를 확인했다. 최종 A는 19개 중 18개 통과, 브랜드 필터 누락 1개 실패이며 B는 6개 통과다. A의 생성 코드 1개는 검토해 수정했다. 전체 요구사항이 구현됐거나 생성 코드가 무수정으로 정확하다는 의미는 아니다.


[6단계 전체 재실행과 파일 격리 기록](docs/implementation/06-full-reexecution.md)

## 최종 반복 검증

API, 화면, 예제 앱이 켜진 프로젝트 루트에서:

    .\.venv\Scripts\python.exe api\check_spec_validation.py
    .\.venv\Scripts\python.exe api\check_stage6.py
    node web\check_stage6_ui.cjs

새 전체 작업 두 개를 다시 만들려면 `api/check_stage6.py --run`을 사용한다. 이 명령은 실제 OpenAI API와 Codex를 호출한다. 생성 상황 수와 실행 가능 테스트 수는 달라질 수 있으며, 실행 오류가 있으면 검증이 실패해 해당 결과를 확인해야 한다.

최종 검증에서 기존 원문/결과 532개 파일은 그대로였고, 서로 다른 15개 API 응답과 두 Codex 대화를 사용했다. 실행마다 명세와 코드 사본의 해시, PNG, 출처가 해당 작업에 속하는지 대조했다. UI에서도 작업 전환, 이미지 출처와 모바일 표시를 확인했다.


[HTTP/HTTPS 대상 URL 허용 변경](docs/implementation/07-target-url.md)

테스트 대상은 HTTP/HTTPS URL을 허용한다. 코드 생성 전에 실제 URL의 공개 화면을 Chromium으로 수집한다. 고정 예제 HTML 대신 수집한 HTML과 화면 요소 정보를 Codex에 전달한다. 사용자가 승인한 http://goodsosbva1.dothome.co.kr/ 에서 portfolio/v1 문서의 전체 흐름으로 6개 통과와 PNG 6장을 확인했다.


## 사용설명서

처음 사용하는 사람은 [사용설명서](docs/사용설명서.md)를 순서대로 따라 하면 된다. 최신 안내는 Markdown 문서다. 기존 Word 문서는 배포 URL 연결 이전에 작성한 기록이다. 현재 설치된 PC의 실행 준비, 예제 테스트, 결과와 실패 확인, 재실행, 배포 URL의 지원 범위와 문제 해결을 설명한다.


## 실제 배포 URL로 처음 실행

1. http://127.0.0.1:5173/ 에서 새 테스트 준비를 연다.
2. 제품과 버전은 portfolio/v1을 선택한다.
3. 대상 앱 URL은 http://goodsosbva1.dothome.co.kr/ 를 넣고 범위는 전체로 둔다.
4. 문서가 준비되지 않았으면 문서 임베딩을 누른다.
5. 생성부터 실행까지 시작을 누르고 결과와 스크린샷을 확인한다.

portfolio/v1은 공개 첫 화면의 제목과 내부 이동을 확인하는 연결 점검 문서다. 제품의 모든 업무 정책을 검증하는 문서가 아니다. 부품 쇼핑몰 예제는 기존 product/v1과 examples/product-demo.html을 사용한다.

새 제품은 documents/제품/버전/requirements.md에 `REQ_001 | 이름 | 내용` 형식으로 요구사항을 작성할 수 있다. 항목 사이에 빈 줄을 넣는다. 원문의 실제 요구사항 ID를 유지하며 문서의 폴더와 문단/조각 번호를 출처로 사용한다. 임의의 PDF 자동 변환은 제공하지 않는다.

기획과 대상 화면이 맞지 않아 모든 상황이 미지원이면 테스트 0개를 전체 통과로 표시하지 않고 미실행 사유를 보여준다.


## 배포 URL 실행 증거

[실행 요약과 테스트별 스크린샷](docs/verification/deployed-run/README.md)을 저장했다. 이 기록은 실제 전체 흐름에서 생성된 테스트 6개, 통과 6개, PNG 6장이다. 제목과 내부 이동 점검이므로 업무 정책의 허용/거부는 미확인 6개로 남긴다. 비밀키, 임베딩 DB와 전체 임시 실행 폴더는 저장소에 포함하지 않는다.
