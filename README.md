# common_tester

Common Tester 실행기와 테스트 정책/계약 문서 모음입니다.

도구의 목적과 전체 흐름은 [docs/common-tester/README.md](docs/common-tester/README.md)를 참고하세요.

## 실행 방법

```bash
# route 뒤에 path 입력, --capability 중점으로 테스트 하는 부분 입력, 테스트 생성 시, 참고할 규칙을  --reference-md 뒤에 md 형시으로 작성
node docs/tools/common-tester/runner.js create --route "/orders" --capability input --reference-md docs/reference/order-form.md
```

로그인이 필요 없는 외부 프로젝트 공개 라우트는 인증을 끄고 실행 URL/서버 명령을 넘깁니다.

```bash
node docs/tools/common-tester/runner.js continue --route "/orders" --no-auth --base-url "http://localhost:3000" --web-server-command "npm run dev"
```
