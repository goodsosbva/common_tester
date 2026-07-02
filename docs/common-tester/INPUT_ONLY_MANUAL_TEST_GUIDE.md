# Input-Only Common Tester Manual Test Guide

## 1. 목적

input-only MVP가 아래 흐름으로 동작하는지 확인한다.

```text
터미널 명령
-> route 분석
-> input capability contract 생성
-> Playwright draft spec 렌더링
-> MCP adapter 상태 기록
-> refined spec 렌더링
-> Playwright 테스트 실행
-> report 생성
```

## 2. 실행 명령

Git Bash에서는 `MSYS_NO_PATHCONV=1`을 붙이고, 실제 Playwright 실행까지 확인하기 위해 `--force-run true`를 붙인다.

```bash
MSYS_NO_PATHCONV=1 pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy" --capability input --input-label "검색어" --input-value "test" --force-run true
```

PowerShell에서는 아래처럼 실행한다.

```powershell
pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy" --capability input --input-label "검색어" --input-value "test" --force-run true
```

## 3. 정상 출력 확인

아래 step이 순서대로 보여야 한다.

```text
resolve_target
scan_project
sync_confluence
decide_reuse
build_docs
write_spec_draft
verify_mcp
refine_spec
run_spec
write_report
```

## 4. 생성 파일 확인

아래 파일을 확인한다.

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy/automation-contract.yaml
docs/common-tester/runtime/targets/monitoring-alarm-policy/generated/monitoring-alarm-policy.draft.spec.ts
docs/common-tester/runtime/targets/monitoring-alarm-policy/generated/monitoring-alarm-policy.spec.ts
docs/common-tester/runtime/targets/monitoring-alarm-policy/mcp-observation.yaml
docs/common-tester/runtime/targets/monitoring-alarm-policy/results/result.md
```

## 5. automation-contract.yaml 확인

아래 값이 있어야 한다.

```text
capability = input
cases[0].id = input-basic
cases[0].steps[0].kind = goto
cases[0].steps[1].kind = fill
cases[0].steps[2].kind = expectValue
```

`--input-label "검색어"`로 실행했다면 selector는 아래 형태여야 한다.

```json
{
  "kind": "label",
  "text": "검색어"
}
```

## 6. draft spec 확인

아래 파일을 연다.

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy/generated/monitoring-alarm-policy.draft.spec.ts
```

아래 코드 형태가 있어야 한다.

```ts
await page.goto("/monitoring/alarm/policy");
await page.getByLabel("검색어").fill("test");
await expect(page.getByLabel("검색어")).toHaveValue("test");
```

MCP 검증 전이므로 기본적으로 `test.skip`일 수 있다.

## 7. refined spec 확인

아래 파일을 연다.

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy/generated/monitoring-alarm-policy.spec.ts
```

`--force-run true`로 실행하면 input-only 파이프라인 검증을 위해 `test(...)` 상태가 되어야 한다.

## 8. MCP 상태 확인

아래 파일을 연다.

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy/mcp-observation.yaml
```

현재 MVP에서는 아래 상태가 정상이다.

```text
status = adapter_not_configured
runnerOwnedStep = true
```

이 뜻은 MCP 검증을 수동 에이전트 지시로 넘기지 않고, runner의 자동 단계로 남겨두었다는 뜻이다.

## 9. result 확인

아래 파일을 연다.

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy/results/result.md
```

아래가 보여야 한다.

```text
write_spec_draft
verify_mcp
refine_spec
run_spec
```

`--force-run true`로 실행했다면 `run status`는 `passed` 또는 `failed`여야 한다. 실패해도 Playwright 테스트 실행까지 도달했다는 뜻이다.

## 10. 실패 시 확인

targetId가 이상하면:

```text
Git Bash 경로 변환 문제다.
MSYS_NO_PATHCONV=1을 붙여 다시 실행한다.
```

input 코드가 생성되지 않으면:

```text
docs/tools/common-tester/capabilities/input.js
docs/tools/common-tester/renderer/playwright-renderer.js
docs/tools/common-tester/operators/write-spec-draft.ts
```

최종 spec이 skip이면:

```text
`--force-run true`가 빠졌는지 확인한다.
MCP adapter 정식 연결 전에는 `--force-run true`가 input-only 실행 검증용 옵션이다.
```
