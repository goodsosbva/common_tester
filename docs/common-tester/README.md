# Common Tester란?

Common Tester는 프로젝트별 테스트 정책 문서나 참고 문서를 바탕으로, 공통 형식의 페이지 계약을 만들고 Playwright 테스트로 실행하는 로컬 테스트 러너입니다.

이 저장소는 테스트 대상 앱을 보관하는 곳이 아니라, 여러 프론트엔드 프로젝트에 재사용할 수 있는 테스트 생성/검증 로직을 만드는 곳입니다.

## What It Does

- `create`: 테스트할 route, capability, reference 문서를 받아 agent-request와 정책 후보를 만듭니다.
- `agent-response`: agent가 page-contract와 automation-contract를 작성하는 입력/출력 지점입니다.
- `continue`: 계약 검증, Playwright spec 생성, 런타임 체크, 테스트 실행, 리포트 생성을 이어서 수행합니다.
- `--no-auth`, `--base-url`, `--web-server-command`: 로그인 없는 외부 공개 프로젝트에서도 같은 러너를 실행할 수 있게 합니다.


## 실행 방법

```bash
node docs/tools/common-tester/runner.js create --route "/orders" --capability input --reference-md docs/reference/order-form.md
```

agent가 생성된 요청을 보고 `agent-response` 계약을 작성합니다.

```bash
node docs/tools/common-tester/runner.js continue --route "/orders"
```

로그인이 필요 없는 외부 프로젝트는 인증을 끄고 실행 대상 URL과 서버 명령을 넘깁니다.

```bash
node docs/tools/common-tester/runner.js continue --route "/orders" --no-auth --base-url "http://localhost:3000" --web-server-command "npm run dev"
```

## 실행 결과

정상 실행되면 route별 Playwright spec과 실행 리포트가 생성됩니다. 테스트 코드에 의해 테스트가 실패하면 Common Tester는 계약 오류, 런타임 체크 오류, Playwright 실행 오류 중 어디서 멈췄는지 기록하고, 대상 앱 자체의 설치/서버 문제는 별도 원인으로 남깁니다.
