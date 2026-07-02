# common_tester

Common Tester 실행기와 테스트 정책/계약 문서 모음입니다.

## Local Markdown 실행

```bash
node docs/tools/common-tester/runner.js create --route "/orders" --capability input --reference-md docs/reference/order-form.md
```

로그인이 필요 없는 외부 프로젝트 공개 라우트는 인증을 끄고 실행 URL/서버 명령을 넘깁니다.

```bash
node docs/tools/common-tester/runner.js continue --route "/orders" --no-auth --base-url "http://localhost:3000" --web-server-command "npm run dev"
```
