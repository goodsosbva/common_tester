# Common Tester 구현 기록: 8단계 최종 실행과 제출

## 목표

- PostgreSQL, FastAPI, React 정적 파일, Chromium 실행기를 Docker Compose 한 번으로 시작한다.
- 데이터베이스, 임베딩 모델, 실행 증거를 컨테이너 재생성 뒤에도 보관한다.
- 브라우저 화면부터 PostgreSQL 저장과 실제 Playwright 실행까지 마지막 경로를 확인한다.

## 구성

| 파일 | 내용 |
| --- | --- |
| [Dockerfile](../../Dockerfile) | Node 빌드 단계와 Python API, Playwright Chromium 실행 이미지 |
| [compose.yaml](../../compose.yaml) | PostgreSQL 17과 API, 상태 검사, 데이터 볼륨 |
| [.dockerignore](../../.dockerignore) | 로컬 DB, 모델 캐시, 가상환경, 키 파일을 이미지 컨텍스트에서 제외 |
| [.env.example](../../.env.example) | 로컬 DB 암호와 선택적 OpenAI 키 환경 변수 예시 |
| [check-container.ps1](../../scripts/check-container.ps1) | 화면 파일, DB 연결, 데모 정책, Playwright 두 건 검사 |
| [main.py](../../api/app/main.py) | 빌드된 React 파일을 FastAPI 루트 경로로 제공 |

Compose는 호스트의 `127.0.0.1:8000`에만 공개한다. PostgreSQL은 호스트 포트를 열지 않는다. PostgreSQL 자료와 `.local` 데이터를 각각 영구 볼륨에 저장한다. `.env`는 Git과 빌드 컨텍스트에서 제외한다.

## 실행과 종료

저장소 루트에서 `.env.example`을 복사해 `.env`를 만들고, 데이터베이스 암호는 64자리 16진수 값으로 바꾼다. 실제 모델 호출을 쓸 때 새 API 키를 로컬 `.env`에 넣는다.

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:8000/api/health
.\scripts\check-container.ps1
```

브라우저에서 http://127.0.0.1:8000을 열어 계획 생성, 근거 확인, 승인 또는 거절 흐름을 사용한다. 종료는 `docker compose down`이다. `docker compose down -v`는 DB와 실행 자료를 삭제한다.

## 확인 상태

- `docker compose config --quiet`로 Compose 설정 문법을 확인했다.
- `check-container.ps1`의 PowerShell 문법을 확인했다.
- Docker Desktop Linux 엔진이 시작되지 않아 이미지 빌드와 컨테이너 실행 검사는 완료하지 못했다. 로컬 Docker 런타임의 `sailor-ingest.sock` 접근 오류가 발생했다.
- 컨테이너가 시작되면 `check-container.ps1`로 웹 파일, DB 연결, 데모 정책과 Chromium 정상 실행 두 건을 확인해야 한다.

## 한계

- 실제 OpenAI 응답과 모델 생성 계획 품질은 키를 안전하게 로컬에 설정하기 전까지 확인되지 않았다.
- 평가는 주문 데모 화면과 고정 정답 데이터에 한정한다. 컨테이너 실행 결과는 아직 없다.
- Docker 이미지 태그는 메이저와 마이너 계열로 지정했다. 재현 가능한 공급망 검증과 이미지 취약점 스캔은 이 범위에 포함하지 않았다.

Node 22 Alpine, Python 3.13 Slim, PostgreSQL 17 Alpine Docker Official Image 태그를 사용했다. [Node 공식 이미지](https://hub.docker.com/_/node), [Python 공식 이미지](https://hub.docker.com/_/python), [PostgreSQL 공식 이미지](https://hub.docker.com/_/postgres)
