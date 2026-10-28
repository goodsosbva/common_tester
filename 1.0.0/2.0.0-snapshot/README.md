# Common Tester 2.0.0

로컬 웹 앱을 대상으로, 문서 근거가 있는 브라우저 테스트를 계획하고 실행하는 도구다. 기획 문서를 버전별로 등록하면 관련 문단을 검색하고, 화면 요소를 확인한 뒤 OpenAI가 테스트 명세를 만든다. 사람이 명세를 승인해야 Playwright가 실행된다. 각 사례의 결과와 성공 또는 실패 캡처, 실패 trace, 생성된 테스트 코드를 볼 수 있다.

## 구성

- `1.0.0/`: 이전 버전 보관
- `api/`: FastAPI, SQLite, FastEmbed, LangGraph, Playwright
- `web/`: React 화면
- `examples/`: 로컬 통합 확인용 가입 화면과 정책
- `examples/order-demo.html`: 1.0.0 주문 정책을 검증하는 테스트 앱
- `examples/order-policy-v1.md`, `examples/order-policy-v2.md`: 1.0.0 JSON 정책 원문을 버전별로 묶은 문서
- `PLAN_2.0.0.md`: 기획안

[주문 앱 실험 결과](docs/order-demo-test.md)에 정상 화면 10건, 의도적 결함 2건, v2 경계 2건의 결과와 캡처를 정리했다.

## 실행

Python 3.13과 Node.js가 필요하다. Docker는 사용하지 않는다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
Copy-Item .env.example .env
```

`.env`의 `OPENAI_API_KEY`를 로컬에서 설정한다. 이 파일과 실행 데이터 `.local/`은 Git에서 제외된다. API와 화면은 터미널을 각각 열어 실행한다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir api --host 127.0.0.1 --port 8000
```

```powershell
Set-Location web
npm ci
npm run dev
```

화면은 `http://127.0.0.1:5173`에서 열린다. 테스트 대상은 별도로 실행 중인 `http://localhost` 또는 `http://127.0.0.1` 웹 앱이어야 한다. 예제 대상은 루트에서 `python -m http.server 8765 --directory examples`로 실행할 수 있다.

## 흐름

1. 문서 ID, 버전, 제목, 파일을 등록한다. 동일 ID와 버전의 내용 변경은 거부된다.
2. 문서 버전, 로컬 URL, 검사 목적, 테스트 수를 입력한다.
3. 선택 버전에서 최대 5문단을 검색한다. LangGraph가 화면 확인, 명세 생성, 검증을 순서대로 수행한다. 검증 오류는 한 번 재생성한다.
4. 테스트 계획의 단계와 출처를 검토하고 승인하거나 거절한다. 승인 대기 상태는 SQLite checkpoint에 저장된다. 승인 전에는 실행 파일이 만들어지지 않는다.
5. 승인된 명세를 LangGraph 실행 노드가 고정 Playwright 코드로 변환해 실행한다. 각 사례는 독립된 브라우저 컨텍스트를 사용한다.

검사 실행은 로컬 주소만 허용한다. 외부 네트워크 요청은 브라우저에서 차단한다. 문서와 모델 응답은 코드로 실행하지 않는다.

## 확인

```powershell
.\.venv\Scripts\python.exe api\check_core.py
.\.venv\Scripts\python.exe api\check_runner.py
.\.venv\Scripts\python.exe api\check_integration.py
.\.venv\Scripts\python.exe api\check_order_app.py
Set-Location web
npm run build
```

`check_runner.py`는 예제 앱이 실행 중일 때 실패 캡처와 trace를 확인한다. `check_integration.py`는 예제 앱과 API가 실행 중이고 OpenAI 키가 설정된 상태에서 문서 등록부터 승인, 결과 확인까지 수행한다.

## 부품 스토어 QA 예제

Tech-Up 공개 자료를 참고해 만든 독립 테스트용 쇼핑 앱과 통합 기획/요구사항 문서다. 원본에 없는 경계값과 오류 문구는 이 예제의 규칙으로 따로 정의했다.

- 대상 앱: examples/techup-demo.html
- 기획서 및 요구사항 정의서: examples/techup-product-requirements-v1.md
- 로컬 점검: .\.venv\Scripts\python.exe examples\check_techup_app.py
- 실행 주소: http://127.0.0.1:8765/techup-demo.html
- 의도적 결함: ?bug=email 또는 ?bug=stock

루트에서 python -m http.server 8765 --bind 127.0.0.1 --directory examples 명령으로 앱을 띄운다. Common Tester 문서 ID는 techup-qa, 버전은 1.0.0으로 등록하면 된다. 검사 목적에는 MEM-01 이메일 형식 또는 CRT-02 재고 제한처럼 요구사항 ID와 기능명을 적는다. 한 번에 검색하는 문단은 최대 5개이므로 영역별로 실행한다.
