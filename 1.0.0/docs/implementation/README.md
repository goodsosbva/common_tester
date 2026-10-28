# Common Tester 단계별 구현 기록

먼저 [00. 설계 근거와 동작 원리](00-design-principles.md)를 읽으면 각 단계를 왜 이 순서로 구현했는지 알 수 있습니다. 단계별 검증 결과는 해당 단계 작성 시점의 기록입니다.

| 단계 | 구현 기록 | 완료 결과 |
| --- | --- | --- |
| 0 | [설계 근거와 동작 원리](00-design-principles.md) | 문제, 기술 선택, 요청 흐름, 검증 기준 |
| 1 | [프로젝트 기반과 실행계획 형식](01-foundation.md) | React, FastAPI, PostgreSQL 연결 |
| 2 | [Python Playwright 실행기](02-playwright-runner.md) | 정상 화면 2건 통과, 결함 화면 1건 실패 감지 |
| 3 | [정책 검색과 근거 연결](03-policy-retrieval.md) | 한국어 질문 5개 Top-1 5/5, 버전 격리와 근거 검증 |
| 4 | [모델 도구 호출과 계획 생성](04-tool-calling.md) | 도구 3종 검증, 실제 모델 계획 20개 생성 확인 |
| 5 | [LangGraph 검토 및 실행 흐름](05-langgraph-workflow.md) | 1회 보정, PostgreSQL 체크포인트 재개, 승인과 거절, 브라우저 실행 검증 |
| 6 | [React 검토 및 실행 화면](06-react-workspace.md) | 화면에서 계획과 정책 원문 검토, 승인과 거절, 결과와 실패 증거 확인 |
| 7 | [검색, 계획, 브라우저 품질 평가](07-quality-evaluation.md) | 검색 Top-1 24/24, 계획 검증 16/16, 브라우저 시나리오 17/17, Playwright 케이스 20개 |
| 8 | [배포 구성과 최종 확인](08-final-deployment.md) | Docker Compose 구성, 로컬 전용 포트, 저장 볼륨. Docker Desktop 오류로 컨테이너 실행 미확인 |
| 9 | [테스트 수 지정과 실행 화면 캡처](09-case-count-and-screenshots.md) | 1~30개 지정, 실제 모델 생성 20개 실행 20/20 통과, 캡처 20개 |

9단계까지 구현했습니다. 2026-10-26 실제 모델이 데모 주문 폼용 계획 20개를 생성했고 Playwright에서 20/20 통과했으며 캡처 20장을 저장했습니다. Docker 컨테이너 실행은 아직 확인하지 못했습니다.

[2026-10-26 실제 모델 생성과 실행 결과](live-model-result.md)
