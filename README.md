# Common Tester

Common Tester는 웹 화면의 입력 정책을 실제 브라우저 테스트로 확인하는 데모 앱입니다. 개발자나 QA 담당자가 검사할 화면, 정책 버전, 검사 목표와 사례 수를 입력하면 관련 정책 문단과 화면 요소를 조회해 테스트 계획을 만듭니다. 계획을 검토해 승인하면 Playwright가 사례를 실행하고 통과 여부와 화면 캡처를 남깁니다. 실패한 사례에는 trace도 남깁니다.

현재 모델 생성 흐름은 데모 주문 등록 화면에서 동작합니다. 주문명 길이, 수량 범위, 금액 형식, 메모 입력 규칙을 정책으로 등록했고 1~30개 사례 생성을 요청할 수 있습니다. 화면의 계획과 정책 원문을 확인한 뒤 실행합니다.

- [설계 근거와 동작 원리](docs/implementation/00-design-principles.md)
- [실제 모델 생성과 실행 결과](docs/implementation/live-model-result.md)
- [단계별 구현 기록](docs/implementation/README.md)

## Docker Compose 실행

Docker Desktop을 시작한 뒤 저장소 루트에서 `.env` 파일을 만듭니다. 데이터베이스 암호는 로컬에서 무작위로 생성합니다.

```powershell
Copy-Item .env.example .env
$secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$envFile = (Get-Content .env -Raw -Encoding ascii).Replace('replace-with-random-hex-value', $secret)
Set-Content .env -Value $envFile -Encoding ascii -NoNewline
Remove-Variable secret, envFile
```

실제 모델 호출을 원하면 교체한 OpenAI 키를 로컬 `.env`의 `OPENAI_API_KEY`에 입력합니다. 키를 저장소나 채팅에 넣지 않습니다.

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:8000/api/health
.\scripts\check-container.ps1
```

- 웹 화면과 API 문서: http://127.0.0.1:8000
- 서비스 로그: `docker compose logs -f api`
- 종료: `docker compose down`
- 데이터베이스, 임베딩 모델, 실행 증거는 Docker 볼륨에 남습니다. `docker compose down -v`는 이 데이터를 삭제합니다.

## Windows 로컬 개발

로컬 개발은 시스템 PostgreSQL 서비스를 변경하지 않고 저장소의 `.local/`에 전용 PostgreSQL을 만듭니다.
모델 생성을 사용할 때는 저장소 루트의 `.env`에 `OPENAI_API_KEY=<새 키>`를 설정합니다. `start-api.ps1`이 이 값을 읽습니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
.\scripts\start-api.ps1
```

두 번째 PowerShell 창에서:

```powershell
Set-Location web
npm ci
npm run dev
```

- 화면: http://127.0.0.1:5173
- API: http://127.0.0.1:8000/docs
- DB 종료: `.\scripts\stop-db.ps1`

## 기능과 검증

- 프로젝트와 버전별 한국어 정책 검색, 출처 ID 검증
- 모델 도구 호출로 계획 생성, 실패 계획 1회 보정
- 계획 검토 후 승인 또는 거절, PostgreSQL 체크포인트 재개
- 브라우저 실행 결과, 스크린샷과 Playwright 추적 조회
- [고정 정답 평가](docs/implementation/07-quality-evaluation.md): 검색 24문항, 계획 검증 16건, 브라우저 시나리오 17개, Playwright 케이스 20개
- [단계별 구현 기록](docs/implementation/README.md)

## 실제 모델 검증

2026-10-26 로컬 `.env`의 키로 모델이 데모 주문 폼의 계획 20개를 생성했다. 정책 검색과 화면 확인 도구를 사용했고, 승인 후 Playwright 실행에서 20개 모두 통과했다. 사례별 PNG 20장이 저장됐다. 상세 조건과 사례별 결과는 [실제 실행 기록](docs/implementation/live-model-result.md)에 있다.

이 결과는 등록된 데모 화면과 정책에 대한 확인이다. 고정 정답 평가의 점수와 실제 모델 생성 결과는 구분한다.
