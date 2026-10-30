# Common Tester 2.0.1

제품 요구사항을 근거로 웹앱의 Playwright 테스트를 생성하고 실행하는 도구다. 문서를 임베딩해 필요한 원문을 찾고, OpenAI API로 테스트 명세를 만든다. Codex App Server는 명세와 대상 화면을 보고 테스트 코드를 작성한다. 실행 결과는 React 화면에서 근거, 실패 사유, 스크린샷과 함께 확인한다.

```text
제품/버전 문서 → 임베딩과 근거 검색 → 테스트 명세 → 실제 화면 수집과 코드 생성 → Playwright 실행 → 결과 집계
```

## 요구사항 문서에서 테스트 코드까지

자유 검색어로 일부 정책을 검사할 때 매번 요구사항 문서 전체를 모델에 넣으면 관계없는 기능까지 섞이고, 특정 문구가 어느 문서에서 왔는지 추적하기 어렵다. 그래서 **RAG 방식으로 필요한 요구사항을 찾은 뒤 그 원문을 근거로 명세를 생성**하도록 구성했다. 먼저 [문서 색인](api/core.py#L98)에서 문단을 128토큰 이내 조각으로 나누고 FastEmbed로 384차원 벡터를 만든다. SQLite의 한 행에는 벡터뿐 아니라 원문, 파일 경로, 문단 번호, 조각 번호를 함께 넣는다. 나중에 검색 결과를 받으면 숫자 벡터를 해석하는 대신 같은 행에 저장된 원문과 출처를 바로 가져올 수 있다.

사용자가 자유 검색어를 입력하면 [근거 검색 노드](api/workflow.py#L132)는 검색어도 같은 모델로 임베딩한다. 저장된 조각과 코사인 유사도(두 벡터의 방향이 얼마나 가까운지 나타내는 값)를 계산해 상위 8개를 찾고, 단어가 정확히 들어간 문구 검색 결과도 합친다. 이렇게 고른 **원문과 출처만** 명세 작성 모델에 전달한다. 임베딩 숫자를 LLM에 보내거나 숫자에서 원문을 복원하지 않는다. `전체`를 선택하면 의미 검색으로 요구사항을 줄이지 않고 모두 전달한다. 전체 제품을 검사할 때 검색 순위 때문에 항목이 빠져서는 안 되기 때문이다.

**LangGraph를 이용하여** 이 작업을 다섯 노드의 흐름으로 구성했다. [공유 상태 `HandoffState`](api/workflow.py#L27)에 제품, 버전, 대상 URL, 실행 ID와 각 단계의 결과를 담는다. [그래프 연결](api/workflow.py#L397)은 `retrieve_evidence → build_handoff → generate_playwright → run_playwright → summarize_results` 순서다. 첫 노드는 문서에서 원문 근거를 골라 `evidence`를 반환하고, 다음 노드는 이를 읽어 `test_spec`을 반환한다. 이후 노드가 생성 코드의 정보, 브라우저 실행 정보, 최종 보고서를 차례로 상태에 추가한다. 노드마다 맡는 입력과 출력이 정해져 있어 어디에서 실패했는지 확인할 수 있다. `start_at`과 `stop_after` 조건으로 명세까지만 만든 뒤 그 실행 ID로 코드 생성을 이어갈 수 있다. 생성된 코드는 같은 작업 ID 아래 새 실행 ID를 만들어 다시 테스트할 수 있다. 이 프로젝트의 실행 기록은 LangGraph 체크포인터가 아니라 `.local/runs/<run_id>/`에 따로 저장한다.

`build_handoff`에서는 첫 번째 **LLM인 OpenAI Responses API**에 검색 근거를 최대 12개 요구사항씩 보낸다. [JSON Schema 요청](api/workflow.py#L223)으로 허용 또는 거부 상황, 실행 행동, 기대 관찰 결과, 원문 출처를 받는다. [검증 단계](api/workflow.py#L278)는 요구사항 누락, 근거에 없는 출처, 빈 행동을 검사하고 잘못된 묶음만 한 번 다시 요청한다. 원문에 없는 실패 기준은 지어내지 않고 `unresolved`로 남긴다. 그 결과가 `.local/runs/<run_id>/test-spec.json`이다.

`generate_playwright`에서는 두 번째 **LLM을 Codex App Server로 호출**한다. [Chromium 화면 수집](scripts/inspect-page.cjs#L9)으로 얻은 실제 HTML, 접근성 구조, 버튼과 링크 정보에 방금 만든 `test-spec.json`을 더해 [코드 생성 단계](api/codex_generator.py#L139)에 전달한다. Codex는 이 자료를 보고 화면에 존재하는 선택자로 `*.spec.ts`를 작성하고, 화면에 없는 기능은 `coverage.json`에 미지원 이유를 기록한다. Playwright `--list`로 코드가 테스트로 인식되는지 확인한 다음 실제 브라우저에서 실행한다. 첫 번째 LLM의 산출물을 파일로 저장해 다음 노드의 입력으로 연결한다.

### 원문 한 건이 결과가 되는 과정

[포트폴리오 요구사항](documents/portfolio/v1/requirements.md)의 `CONNECT_002`는 “작업 링크를 누르면 `#work` 영역으로 이동한다”는 문장이다.

| 산출물 | 실제 변화 | 확인할 위치 |
| --- | --- | --- |
| 색인 | 해당 문장을 출처 `requirements.md`, 문단 5, 조각 1과 벡터로 저장 | [문서 색인](api/core.py#L98) |
| 근거 | `전체` 범위라 이 요구사항을 포함한 6개를 원문과 출처로 선택 | [근거 검색](api/workflow.py#L132) |
| 명세 | 링크 클릭이라는 행동과 `#work` 이동이라는 기대 관찰 결과를 JSON으로 저장 | [명세 생성](api/workflow.py#L294) |
| 코드 | 실제 화면을 보고 링크의 `href`, 클릭 후 URL, 도착 영역 제목을 검사 | [생성된 테스트](docs/verification/deployed-run/portfolio.spec.ts) |
| 결과 | 브라우저 테스트 통과와 PNG 1장을 기록. 허용/거부 업무 신호는 없어 정책 미확인 | [실행 증거](docs/verification/deployed-run/README.md) |

이 과정에서 **테스트 통과**는 화면의 상세 조건을 만족했다는 뜻이고, **TP/FN/FP/TN**은 별도로 관찰한 허용/거부 결과와 기대 정책을 비교한 값이다. 두 판정을 섞지 않는다.

## 구현 원리와 코드 위치

링크는 GitHub에서 해당 코드 줄로 이동한다. 위에서 아래로 읽으면 문서 한 문장이 실행 결과로 바뀌는 순서를 따라갈 수 있다.

| 순서 | 어떻게 구현했는가 | 왜 그렇게 했는가 | 직접 확인할 파일 |
| --- | --- | --- | --- |
| 1. 문서 저장 | `documents/제품/버전/`의 문서를 문단으로 읽고 긴 문단을 128토큰 이내로 나눈다. | 제품과 버전을 분리하고 임베딩 입력이 잘리지 않게 한다. | [문단 읽기](api/core.py#L28), [토큰 기준 분할](api/core.py#L70) |
| 2. 임베딩 | FastEmbed의 `paraphrase-multilingual-MiniLM-L12-v2`로 각 조각을 384차원 벡터로 바꾼다. SQLite에 원문, 벡터, 파일 경로, 문단 번호, 조각 번호를 함께 저장한다. | 의미가 비슷한 요구사항을 찾고 원문 위치를 확인한다. | [임베딩과 SQLite 저장](api/core.py#L98) |
| 3. 변경 확인 | 원본 파일의 SHA-256을 저장하고 검색 전에 현재 파일과 비교한다. 다르면 재임베딩을 요구한다. | 변경 전 벡터에 변경 후 문서를 연결하지 않는다. | [해시 저장](api/core.py#L98), [해시 비교](api/workflow.py#L56) |
| 4. 근거 검색 | `전체`는 모든 요구사항을 선택한다. 자유 검색어는 문구 일치와 코사인 유사도 상위 8개를 합친다. | 전체 검사에서 누락을 막고 특정 주제 검색도 지원한다. | [요구사항 복원](api/workflow.py#L56), [범위별 검색](api/workflow.py#L132) |
| 5. 테스트 명세 | 선택한 원문과 출처를 최대 12개 요구사항씩 OpenAI Responses API에 보내 행동과 기대 관찰 결과가 담긴 JSON을 받는다. 원문에 없는 판정 기준은 `unresolved`에 남긴다. | 코드 생성 전에 요구사항을 실행 가능한 상황으로 정리한다. | [API 요청](api/workflow.py#L223), [묶음 처리와 명세 저장](api/workflow.py#L294) |
| 6. 명세 검증 | 요구사항 누락, 잘못된 출처, 빈 행동과 기대 결과를 검사한다. 오류가 난 묶음은 피드백과 함께 한 번 재요청한다. | 출처가 틀리거나 내용이 빠진 명세를 실행하지 않는다. | [검증 규칙](api/workflow.py#L278), [재요청](api/workflow.py#L294) |
| 7. 코드 생성 | Chromium으로 실제 대상 화면의 HTML, 접근성 구조와 요소 정보를 수집한다. Codex App Server가 명세와 화면 자료로 `*.spec.ts`를 만들고 Playwright `--list`로 파일 인식을 확인한다. | 실제 화면에 맞는 선택자를 쓰고 없는 기능은 미지원 사유를 남긴다. | [화면 수집](scripts/inspect-page.cjs#L9), [Codex 연결](api/codex_generator.py#L20), [코드 생성과 목록 확인](api/codex_generator.py#L139) |
| 8. 실행과 집계 | Playwright가 테스트를 실행하고 통과와 실패 모두 PNG를 저장한다. 실제 허용/거부 신호와 기대값을 비교하고 React에 실패, 출처, 이미지를 표시한다. | 실패 원인을 화면 증거와 원문 근거로 확인한다. | [실행](api/playwright_runner.py#L43), [캡처 설정](playwright.config.ts#L10), [실제 정책 관찰](playwright-observations.ts#L8), [집계](api/results.py#L29), [화면](web/src/App.tsx#L104) |

테스트 코드의 통과 여부만으로 실제 정책을 추측하지 않는다. 기대 허용/실제 허용은 TP, 기대 허용/실제 거부는 FN, 기대 거부/실제 허용은 FP, 기대 거부/실제 거부는 TN이다. 허용/거부를 구별할 화면 신호가 없으면 **정책 미확인**, 브라우저 실행에 문제가 생기면 **실행 오류**로 표시한다. 대상 화면에 기능이 없으면 `coverage.json`에 미지원 이유를 남기며 통과로 계산하지 않는다.

## 문서와 예제

| 경로 | 용도 |
| --- | --- |
| [documents/product/v1/제품_요구사항_정의서.pdf](documents/product/v1/제품_요구사항_정의서.pdf) | 제품 요구사항 원본, 9쪽 |
| [documents/product/v1/requirements.md](documents/product/v1/requirements.md) | PDF의 요구사항 75행을 ID, 쪽수, 표 행과 함께 옮긴 검색용 문서 |
| `documents/product/v1/embeddings.sqlite3` | 원문과 벡터를 저장하는 로컬 DB. 임베딩 시 생성되며 Git에서 제외 |
| [docs/product-uncertainties.md](docs/product-uncertainties.md) | 원문에 없는 판정 기준과 중복 ID 검토 기록. 검색 대상에서 제외 |
| [examples/product-demo.html](examples/product-demo.html) | 제품 요구사항 중 일부를 확인하는 로컬 예제 화면 |
| [documents/portfolio/v1/requirements.md](documents/portfolio/v1/requirements.md) | 공개 포트폴리오 화면의 제목과 내부 이동을 점검하는 문서 |
| [docs/implementation/](docs/implementation/) | 단계별 구현과 검증 기록 |
| [1.0.0/](1.0.0/) | 이전 코드와 2.0.0 스냅샷 |

PDF의 `BE_RECOMMEND_001`은 서로 다른 두 행에 중복되어 있다. ID는 고치지 않고 PDF 6쪽의 표 행으로 구별한다. 총 75행, 고유 ID는 74개다. PDF는 원본으로 보존하며 [변환 스크립트](scripts/import_product_pdf.py)로 검색용 Markdown을 만든다. 새 제품은 `documents/제품/버전/requirements.md`에 `REQ_001 | 이름 | 내용` 형식으로 작성하고 항목 사이에 빈 줄을 넣을 수 있다.

## 설치와 실행

Python 3.12와 Node.js 22.23.3에서 확인했다. Docker는 필요 없다. PowerShell에서 `D:\common_tester`를 열고 다음을 실행한다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
npm.cmd ci
npm.cmd --prefix web ci
npx.cmd playwright install chromium
```

루트 `.env`에 `OPENAI_API_KEY`를 설정하고 Codex CLI에 로그인한다. 각 명령은 **별도 PowerShell 창**에서 프로젝트 루트를 기준으로 실행한다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir api --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd --prefix web run dev
```

로컬 제품 예제도 검사할 때만 세 번째 창에서 실행한다.

```powershell
.\.venv\Scripts\python.exe -m http.server 8765 --bind 127.0.0.1 --directory examples
```

[사용설명서](docs/사용설명서.md)에 처음 실행하는 사람을 위한 화면별 순서와 문제 해결 방법이 있다.

## 실제 실행 결과와 검증 범위

React 화면 `http://127.0.0.1:5173/`에서 `portfolio/v1`, 대상 URL `http://goodsosbva1.dothome.co.kr/`, 범위 `전체`를 선택해 실행했다. 요구사항 6개로 생성한 테스트 **6개 통과, 실패 0개, PNG 6장**이었다. 이 문서는 제목, 메뉴 이동, 본문 바로가기 점검용이다. 허용/거부 업무 신호가 없어 정책 판정 6개는 미확인으로 남겼다.

[실행 요약과 원본 스크린샷](docs/verification/deployed-run/README.md), [실제로 생성된 Playwright 코드](docs/verification/deployed-run/portfolio.spec.ts)에서 요구사항 `CONNECT_002`가 작업 메뉴의 링크, 클릭 후 URL, 도착 영역 제목 검사로 바뀐 것을 확인할 수 있다.

로컬 제품 예제의 5단계 검증에서는 계획 190상황 중 20개를 실행했다. 나머지 170개는 미지원으로 기록했다. 정상 화면과 네 결함 화면에서 같은 20개 테스트를 실행해 PNG 100장과 의도한 실패 4건을 확인했다. 이후 전체 재실행 A에서는 19개 중 18개 통과와 브랜드 필터 누락 1개 실패, B에서는 6개 통과를 확인했다. 생성된 코드에는 검토가 필요하며, 예제 화면이 원본 PDF의 전체 기능을 구현한 것은 아니다.

## 확인 명령

API, 웹 화면, 로컬 제품 예제가 켜져 있을 때 프로젝트 루트에서 실행한다.

```powershell
.\.venv\Scripts\python.exe api\check_foundation.py
.\.venv\Scripts\python.exe api\check_target_url.py
.\.venv\Scripts\python.exe api\check_page_reference.py
.\.venv\Scripts\python.exe api\check_spec_validation.py
.\.venv\Scripts\python.exe api\check_stage5.py
.\.venv\Scripts\python.exe api\check_stage6.py
node web\check_remote_url_ui.cjs
npm.cmd --prefix web run build
```

`check_stage6.py`는 저장된 두 실행의 격리와 출처를 확인한다. `--run`을 붙이면 실제 OpenAI API와 Codex를 호출해 새 작업 두 개를 만든다. [전체 재실행 기록](docs/implementation/06-full-reexecution.md)과 [배포 URL 연결 기록](docs/implementation/07-target-url.md)에 결과를 남겼다.
