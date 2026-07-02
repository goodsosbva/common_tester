# Common Tester Execution Guide

## 0. 목적

이 문서는 Common Tester를 터미널에서 실행했을 때 어떤 순서로 동작해야 하는지 설명한다.

중요한 원칙:

```text
사용자가 Playwright MCP를 에이전트에게 따로 지시하지 않는다.
runner가 docs/common-tester/*.yaml을 읽고 operator들을 자동으로 실행한다.
Playwright MCP 검증도 verify_mcp operator의 책임이다.
```

따라서 이 문서는 "에이전트에게 URL을 열어달라고 요청하는 설명서"가 아니다.

## 1. 최종 목표 흐름

최종 Common Tester는 아래 명령 하나로 시작되어야 한다.

```bash
MSYS_NO_PATHCONV=1 pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy"
```

위 명령은 내부적으로 아래 순서를 탄다.

```text
resolve_target
  -> targetId와 runtime targetDir 생성

scan_project
  -> 현재 프로젝트의 Nx/pnpm/Vue route tree 분석
  -> host app, route, component, i18n, 실행 URL 근거 생성

sync_confluence
  -> Confluence root 하위 문서 read-only 수집
  -> version/bodyHash/normalizedHash/sourceSetHash 생성

decide_reuse
  -> Confluence 변경 없음: 기존 로컬 md/contract 재사용
  -> 변경 있음: 관련 target 산출물 재생성 결정

build_docs
  -> requirements.md
  -> project-evidence.md
  -> contract-gaps.md
  -> test-case-spec.md

write_spec_draft
  -> 로컬 문서와 프로젝트 근거를 기준으로 테스트 코드 초안 생성
  -> 아직 실행 가능 여부는 확정하지 않음

verify_mcp
  -> runner 내부 Playwright MCP adapter로 실제 화면 검증
  -> route load, UI, selector, network, mismatch를 mcp-observation.yaml에 저장

refine_spec
  -> mcp-observation.yaml을 기준으로 automation-contract.yaml 보정
  -> generate:true 케이스만 최종 generated spec에 반영

run_spec
  -> docs/common-tester/runtime/playwright.config.ts로 generated spec 실행
  -> results 하위에 실행 결과 저장

write_report
  -> result.md/result.json/lock.json 갱신
```

## 2. 현재 runner 구현 상태

현재 포함된 runner는 전체 최종본이 아니라, 구조 검증 가능한 초기 runner다.

현재 가능한 것:

```text
resolve_target
scan_project
sync_confluence 상태 기록
decide_reuse 상태 기록
build_docs placeholder 생성
write_spec_draft 생성
verify_mcp adapter 상태 기록
refine_spec placeholder 보정
run_spec skip 상태 기록
write_report 생성
```

아직 남은 것:

```text
Confluence API 실제 본문 수집
Confluence 문서 target matching 고도화
runner-owned Playwright MCP adapter 실제 연결
MCP observation 기반 generate:true contract 생성
docs runtime Playwright config 생성
generated spec 실제 실행
```

즉 지금 테스트할 것은 "최종 자동화가 완성됐는가"가 아니라, 아래다.

```text
터미널 명령 하나로 flow가 자동 진행되는가
route/component 분석이 현재 프로젝트에서 맞는가
각 산출물이 docs/common-tester/runtime 하위에 생성되는가
MCP 단계가 수동 지시가 아니라 verify_mcp operator 상태로 기록되는가
```

## 3. Git Bash 경로 변환 주의

Git Bash에서 `/monitoring/alarm/policy`는 Windows 경로로 바뀔 수 있다.

잘못된 결과:

```text
c-program-files-git-monitoring-alarm-policy
```

Git Bash에서는 반드시 `MSYS_NO_PATHCONV=1`을 붙인다.

```bash
MSYS_NO_PATHCONV=1 pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy"
```

PowerShell에서는 아래 명령을 그대로 써도 된다.

```powershell
pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy"
```

정상 targetId:

```text
monitoring-alarm-policy
```

정상 targetDir:

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy
```

## 4. 실행 방법

프로젝트 루트에서 실행한다.

```bash
MSYS_NO_PATHCONV=1 pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy"
```

정상 출력 예:

```text
[common-tester] action=create
[common-tester] root=C:\Users\admin\Desktop\mono_305_gitlab\cmp305-frontend
[common-tester] step=resolve_target
[common-tester] step=scan_project
[common-tester] step=sync_confluence
[common-tester] step=decide_reuse
[common-tester] step=build_docs
[common-tester] step=write_spec_draft
[common-tester] step=verify_mcp
[common-tester] step=refine_spec
[common-tester] step=run_spec
[common-tester] step=write_report
[common-tester] done
[common-tester] targetDir=...\docs\common-tester\runtime\targets\monitoring-alarm-policy
```

## 5. 결과 확인

아래 파일들이 생성되어야 한다.

```text
docs/common-tester/runtime/targets/monitoring-alarm-policy/target.json
docs/common-tester/runtime/targets/monitoring-alarm-policy/project-model.json
docs/common-tester/runtime/targets/monitoring-alarm-policy/source-index.json
docs/common-tester/runtime/targets/monitoring-alarm-policy/reuse-decision.json
docs/common-tester/runtime/targets/monitoring-alarm-policy/requirements.md
docs/common-tester/runtime/targets/monitoring-alarm-policy/project-evidence.md
docs/common-tester/runtime/targets/monitoring-alarm-policy/contract-gaps.md
docs/common-tester/runtime/targets/monitoring-alarm-policy/test-case-spec.md
docs/common-tester/runtime/targets/monitoring-alarm-policy/mcp-observation.yaml
docs/common-tester/runtime/targets/monitoring-alarm-policy/automation-contract.yaml
docs/common-tester/runtime/targets/monitoring-alarm-policy/generated/monitoring-alarm-policy.spec.ts
docs/common-tester/runtime/targets/monitoring-alarm-policy/results/result.md
docs/common-tester/runtime/targets/monitoring-alarm-policy/results/result.json
```

`project-model.json`에서 확인할 정상 값:

```text
route.input = /monitoring/alarm/policy
hostApp.name = service-admin-web
hostApp.serveCommand = pnpm admin
hostApp.baseURL = http://localhost:18000
route.parentRouteFile = packages/monitoring/monitoring/src/pages/index.ts
route.childRouteFile = packages/monitoring/monitoring/src/pages/alarm-rule/index.ts
route.componentFile = packages/monitoring/monitoring/src/pages/alarm-rule/ui/AlarmRulePage.vue
environment.requiredPlatformPresent = true
```

`mcp-observation.yaml`에서 현재 확인할 값:

```text
status = adapter_not_configured 또는 adapter_not_implemented
runnerOwnedStep = true
message = verify_mcp is an automatic runner operator...
```

이 값은 현재 runner가 MCP 검증을 수동 에이전트 지시로 넘기지 않고, 자동 operator의 책임으로 기록한다는 뜻이다.

## 6. 현재 단계의 성공 기준

현재 단계에서 성공:

```text
명령 하나로 모든 flow step이 실행된다.
write_spec_draft가 verify_mcp보다 먼저 실행된다.
verify_mcp가 수동 요청 문구 없이 adapter 상태를 mcp-observation.yaml에 남긴다.
refine_spec이 mcp-observation.yaml을 읽고 최종 automation-contract/spec을 보정한다.
route/component 분석이 성공한다.
결과가 docs/common-tester/runtime 하위에 생성된다.
```

현재 단계에서 아직 성공이 아닌 것:

```text
실제 Confluence 본문 수집
실제 Playwright MCP 브라우저 검증
실제 generated spec 실행
```

이 세 가지는 다음 구현 단계의 대상이다.

## 7. 다음 구현 작업

다음 구현은 아래 순서로 진행한다.

```text
1. sync-confluence.ts
   - Atlassian REST API read-only 호출
   - root page children 조회
   - body storage 수집
   - normalizedHash/sourceSetHash 생성
   - 관련 문서 matching

2. verify-mcp.ts
   - runner-owned MCP adapter 연결
   - http://localhost:18000/monitoring/alarm/policy 자동 접속
   - route load/UI/selector/network 관찰
   - mcp-observation.yaml 저장

3. refine-spec.ts
   - mcp-observation.yaml의 stable selector 반영
   - canGenerateSpec=true 케이스만 generate:true로 변경

4. run-spec.ts
   - docs/common-tester/runtime/playwright.config.ts 생성
   - generated spec 실행
   - result.json/result.md 갱신
```

## 8. 실패 시 확인 위치

targetId가 `c-program-files-git-monitoring-alarm-policy`로 나오면:

```text
Git Bash 경로 변환 문제다.
MSYS_NO_PATHCONV=1을 붙여 다시 실행한다.
```

route/component가 null이면:

```text
docs/tools/common-tester/operators/scan-project.ts
docs/common-tester/runtime/targets/{targetId}/project-model.json
```

Confluence가 skipped이면:

```text
CONFLUENCE_EMAIL
CONFLUENCE_API_TOKEN
docs/tools/common-tester/operators/sync-confluence.ts
```

MCP가 adapter_not_configured이면:

```text
COMMON_TESTER_MCP_ADAPTER
docs/tools/common-tester/operators/verify-mcp.ts
```

spec 실행이 skipped이면:

```text
docs/common-tester/runtime/targets/{targetId}/automation-contract.yaml
docs/tools/common-tester/operators/refine-spec.ts
docs/tools/common-tester/operators/run-spec.ts
```
