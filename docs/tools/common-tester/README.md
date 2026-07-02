# Common Tester Runner Location

이 디렉터리는 Common Tester 실행기 셋팅과 구현 파일이 들어갈 위치다.

폐하의 기준에 따라 실행기 관련 파일도 루트 `tools/`가 아니라 `docs/tools/common-tester/` 하위에 둔다.

최종 구현 구조는 다음과 같다.

```text
docs/tools/common-tester/
  runner.ts
  registry.ts
  context.ts
  operators/
    resolve-target.ts
    scan-project.ts
    sync-confluence.ts
    decide-reuse.ts
    build-docs.ts
    write-spec-draft.ts
    verify-mcp.ts
    refine-spec.ts
    run-spec.ts
    write-report.ts
  capabilities/
    input.js
  renderer/
    selector-renderer.js
    playwright-renderer.js
```

`runner.ts`는 `docs/common-tester/01-flow.yaml`을 읽고, `registry.ts`를 통해 operator를 실행한다.

Confluence 대신 프로젝트 안의 Markdown 기준 문서를 쓰려면 아래처럼 실행한다.

```bash
node docs/tools/common-tester/runner.js create --route "/orders" --capability input --reference-md docs/reference/order-form.md
```

로그인이 필요 없는 공개 라우트를 외부 프로젝트에서 검증할 때는 인증 준비를 끄고 실행 URL/서버 명령을 넘긴다.

```bash
node docs/tools/common-tester/runner.js continue --route "/orders" --no-auth --base-url "http://localhost:3000" --web-server-command "npm run dev"
```

`capabilities/input.js`는 input-only MVP 테스트 케이스를 `automation-contract.yaml` 형태로 만든다.

`renderer/playwright-renderer.js`는 `automation-contract.yaml`의 step을 Playwright 코드로 변환한다.

생성되는 테스트 코드, 중간 문서, 실행 결과는 `docs/common-tester/runtime/` 하위에 둔다.

루트 `tools/common-tester/`는 사용하지 않는다.
