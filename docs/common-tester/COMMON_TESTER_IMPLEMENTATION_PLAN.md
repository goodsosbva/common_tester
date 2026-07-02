# Common Tester Implementation Plan

## 0. 최신 전제

이 문서는 프로젝트 루트에 로컬 Common Tester를 처음 심는 것을 기준으로 한다.

기존 `docs/`, 기존 common-tester 산출물, 기존 e2e 테스트는 설계 기준으로 삼지 않는다. 단, 현재 프로젝트의 기술 스택, 실행 앱, 라우트, 컴포넌트, i18n, API 구조는 실제 소스 코드에서 읽는다.

Common Tester는 저장소 공유용 산출물이 아니라 로컬 실행 도구다. 그래서 모든 기준 문서, 실행기 셋팅, 생성 테스트 코드, 실행 결과는 `docs/` 하위에 둔다.

최종 목표:

```text
터미널 명령 하나 실행
  -> Confluence read-only 수집
  -> 로컬 기준 문서 생성 또는 재사용
  -> 프로젝트 코드 근거 결합
  -> 테스트 코드 초안 자동 생성
  -> Playwright MCP로 실제 화면 자동 검증
  -> MCP 결과로 테스트 코드 보정
  -> generated spec 실행
  -> 결과를 docs 하위에 저장
```

중요: 사용자가 Playwright MCP 검증을 에이전트에게 따로 지시하는 방식은 탈락이다. `verify_mcp`는 runner 내부 operator의 책임이다.

## 1. 반드시 지켜야 할 요구조건

1. 에이전트별 기본 문서에 의존하지 않는다.
2. `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`는 모두 `docs/common-tester/00-entry.md`를 가리키는 얇은 브리지다.
3. 사용자는 터미널 명령 하나로 공통 흐름을 시작한다.
4. 실행기는 `docs/common-tester/*.yaml`을 직접 읽고 그 순서와 정책대로 움직인다.
5. 실행기 셋팅과 구현 파일도 `docs/tools/common-tester/` 하위에 둔다.
6. Confluence는 읽기 전용이다. 쓰기 API는 사용하지 않는다.
7. Confluence 변경이 없으면 기존 로컬 md/contract를 재사용한다.
8. Confluence 변경이 있으면 관련 target의 로컬 md/contract만 재생성한다.
9. 테스트 코드는 Confluence 원문이 아니라 로컬 산출물과 `automation-contract.yaml`을 기준으로 생성한다.
10. 테스트 코드는 해당 프로젝트의 실제 코드 구조, 라우트, 컴포넌트, i18n, API 근거를 보고 만든다.
11. 기존 테스트 파일은 새 설계의 기준으로 삼지 않는다.
12. Playwright MCP는 실제 화면 검증 단계에서 runner가 자동으로 사용한다.
13. 모든 테스트 코드 관련 결과물은 `docs/` 하위에 저장한다.
14. secret은 `docs/`에 저장하지 않는다. Confluence token, E2E 계정은 env만 허용한다.

## 2. 최종 루트 구조

```text
project-root/
  AGENTS.md
  .cursorrules
  .github/
    copilot-instructions.md

  docs/
    common-tester/
      00-entry.md
      01-flow.yaml
      02-confluence.yaml
      03-artifacts.yaml
      04-project-scan.yaml
      05-playwright.yaml
      06-cache-policy.yaml
      COMMON_TESTER_IMPLEMENTATION_PLAN.md
      PLAYWRIGHT_MCP_OPERATION_GUIDE.md

      templates/
        requirements.md
        project-evidence.md
        contract-gaps.md
        test-case-spec.md
        mcp-observation.yaml
        automation-contract.yaml

      runtime/
        lock.json
        playwright.config.ts
        auth.setup.ts
        cache/
          confluence/
        targets/
          {targetId}/
            target.json
            source-index.json
            project-model.json
            reuse-decision.json
            requirements.md
            project-evidence.md
            contract-gaps.md
            test-case-spec.md
            mcp-observation.yaml
            automation-contract.yaml
            generated/
              {targetId}.spec.ts
            results/
              result.md
              result.json
              playwright-report/
              test-results/
              screenshots/
              traces/

    tools/
      common-tester/
        runner.ts
        registry.ts
        context.ts
        tsconfig.json
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
```

역할:

```text
docs/common-tester/*.md|yaml
  사람이 읽고 실행기가 읽는 정책/계약 문서

docs/tools/common-tester/**
  정책 문서를 읽어 실제로 동작하는 runner와 operator 구현

docs/common-tester/runtime/**
  target별 로컬 요구사항, 근거 문서, 생성 테스트 코드, 실행 결과
```

루트 `tools/common-tester/`는 사용하지 않는다.

## 3. 브리지 문서의 역할

브리지 문서는 실행기가 아니다. 에이전트를 단일 진입점으로 보내는 포인터다.

```text
AGENTS.md
.cursorrules
.github/copilot-instructions.md
```

핵심 내용:

```md
테스트 생성/수정 작업 전 반드시 docs/common-tester/00-entry.md를 읽는다.
Confluence 원문을 직접 기준으로 Playwright 테스트 코드를 작성하지 않는다.
Common Tester 흐름을 따른다.
```

이 구조는 Codex, Cursor, Copilot이 서로 다른 기본 문서를 보더라도 진입점을 `00-entry.md`로 통일하기 위해 필요하다.

## 4. 기준 문서 역할

### 4.1 `00-entry.md`

공통 테스터의 진입 문서다.

담을 내용:

- Common Tester 목적
- 직접 테스트 코드를 쓰지 말라는 규칙
- 터미널 명령 실행 방식
- `automation-contract.yaml`이 최종 생성 기준이라는 규칙
- `docs/tools/common-tester/`가 실행기 위치라는 규칙
- 세부 정책 파일 목록

실행기에서의 사용:

- `runner.ts`가 시작 시 존재 여부를 확인한다.
- 없으면 Common Tester 셋팅 미완료로 보고 중단한다.

### 4.2 `01-flow.yaml`

실행 순서의 단일 기준이다.

```yaml
version: 1
runner:
  root: docs/tools/common-tester
  entry: docs/tools/common-tester/runner.ts
  registry: docs/tools/common-tester/registry.ts
  context: docs/tools/common-tester/context.ts
  operatorsDir: docs/tools/common-tester/operators
steps:
  - resolve_target
  - scan_project
  - sync_confluence
  - decide_reuse
  - build_docs
  - write_spec_draft
  - verify_mcp
  - refine_spec
  - run_spec
  - write_report
```

핵심 변경:

```text
build_docs
  -> write_spec_draft
  -> verify_mcp
  -> refine_spec
```

테스트 코드는 MCP 전에 초안이 생성된다. MCP는 초안을 검증하고, `refine_spec`이 그 결과를 반영한다.

### 4.3 `02-confluence.yaml`

Confluence read-only 수집 정책이다.

```yaml
baseUrl: https://okestro.atlassian.net
rootPages:
  - pageId: "2926936245"
auth:
  emailEnv: CONFLUENCE_EMAIL
  tokenEnv: CONFLUENCE_API_TOKEN
read:
  readOnly: true
  bodyFormat: storage
  recursiveChildren: true
  pageSize: 50
changeDetection:
  - pageId
  - version
  - bodyHash
  - normalizedHash
```

token 값은 파일에 쓰지 않는다. `readOnly: true`가 아니면 중단한다.

### 4.4 `03-artifacts.yaml`

산출물 위치 계약이다.

```yaml
workDir: docs/common-tester/runtime
targetDir: docs/common-tester/runtime/targets/{targetId}
artifacts:
  target: target.json
  sourceIndex: source-index.json
  projectModel: project-model.json
  reuseDecision: reuse-decision.json
  requirements: requirements.md
  projectEvidence: project-evidence.md
  contractGaps: contract-gaps.md
  testCaseSpec: test-case-spec.md
  mcpObservation: mcp-observation.yaml
  automationContract: automation-contract.yaml
  generatedSpecDir: generated
  resultsDir: results
```

모든 operator는 이 정책을 통해 파일 경로를 얻는다.

### 4.5 `04-project-scan.yaml`

현재 프로젝트 코드 분석 정책이다.

```yaml
scan:
  include:
    - package.json
    - pnpm-workspace.yaml
    - nx.json
    - apps/**/project.json
    - packages/**/project.json
    - apps/**/src/**/*.{ts,tsx,vue,js,jsx}
    - packages/**/src/**/*.{ts,tsx,vue,js,jsx}
  exclude:
    - node_modules/**
    - dist/**
    - build/**
    - docs/**
    - "**/e2e/**"
    - "**/*.spec.*"
    - "**/*.test.*"
detect:
  workspace: true
  nxProjectGraph: true
  routeTree: true
  hostApp: true
  component: true
  apiClient: true
  i18nLabel: true
  authRuntimeHint: true
```

`scan-project.ts`는 단순 문자열 검색기가 아니라 route tree composer여야 한다.

### 4.6 `05-playwright.yaml`

Playwright 코드 생성, MCP 검증, 실행 정책이다.

```yaml
generation:
  inputOnly: automation-contract.yaml
  specDir: docs/common-tester/runtime/targets/{targetId}/generated
  selectorPriority:
    - getByRole
    - getByLabel
    - getByTestId
    - getByText
  forbidden:
    - waitForTimeout
    - unstableNth
    - deepCssSelector
mcp:
  runnerOwned: true
  output: mcp-observation.yaml
execution:
  enabled: true
  configPath: docs/common-tester/runtime/playwright.config.ts
  testDir: docs/common-tester/runtime/targets
  outputDir: docs/common-tester/runtime/targets/{targetId}/results/test-results
  reportDir: docs/common-tester/runtime/targets/{targetId}/results/playwright-report
  fallbackCommand: pnpm exec playwright test
```

`verify_mcp`는 사용자가 에이전트에게 따로 지시하는 단계가 아니다. runner 내부 adapter가 수행해야 한다.

### 4.7 `06-cache-policy.yaml`

로컬 산출물 재사용 정책이다.

```yaml
policy: auto
reuseRequirementsWhen:
  - sourceSetHashUnchanged
  - requirementsBuilderVersionUnchanged
rebuildRequirementsWhen:
  - confluencePageVersionChanged
  - normalizedHashChanged
rebuildProjectEvidenceWhen:
  - projectModelHashChanged
rebuildContractWhen:
  - requirementsHashChanged
  - projectEvidenceHashChanged
  - testCaseSpecHashChanged
  - mcpObservationHashChanged
```

`decide-reuse.ts`는 `runtime/lock.json`과 현재 수집 결과를 비교한다.

## 5. runner 오케스트레이션 원리

실행기는 AI에게 "알아서 해"라고 맡기는 블랙박스가 아니다.

```text
runner.ts
  -> 00-entry.md 존재 확인
  -> 01-flow.yaml 로드
  -> 02~06 yaml 로드
  -> runtime/lock.json 로드 또는 생성
  -> registry.ts로 step 구현 확인
  -> 각 operator 순차 실행
  -> context와 파일 산출물 갱신
  -> result와 lock 기록
```

`registry.ts`:

```ts
export const registry = {
  resolve_target: resolveTarget,
  scan_project: scanProject,
  sync_confluence: syncConfluence,
  decide_reuse: decideReuse,
  build_docs: buildDocs,
  write_spec_draft: writeSpecDraft,
  verify_mcp: verifyMcp,
  refine_spec: refineSpec,
  run_spec: runSpec,
  write_report: writeReport,
};
```

## 6. operator별 인과

### 6.1 `resolve-target.ts`

입력 route/target을 targetId로 바꾸고 target runtime 디렉터리를 만든다.

출력:

```text
target.json
```

### 6.2 `scan-project.ts`

프로젝트 코드에서 workspace, host app, route tree, component, API, i18n 근거를 찾는다.

cmp305 기준 예:

```text
apps/service-admin-web/src/pages/index.ts
  -> monitoringRoutes
packages/monitoring/monitoring/src/pages/index.ts
  -> /monitoring parent
packages/monitoring/monitoring/src/pages/alarm-rule/index.ts
  -> alarm/policy child
AlarmRulePage.vue
```

출력:

```text
project-model.json
project-evidence.md
```

### 6.3 `sync-confluence.ts`

Confluence root 하위 문서를 read-only로 수집하고 target 관련 문서를 매칭한다.

출력:

```text
source-index.json
runtime/cache/confluence/*
```

### 6.4 `decide-reuse.ts`

Confluence sourceSetHash와 lock을 비교해 기존 md를 재사용할지 결정한다.

출력:

```text
reuse-decision.json
```

### 6.5 `build-docs.ts`

Confluence 정규화 내용과 프로젝트 근거를 결합해 로컬 기준 문서를 만든다.

출력:

```text
requirements.md
project-evidence.md
contract-gaps.md
test-case-spec.md
```

### 6.6 `write-spec-draft.ts`

`test-case-spec.md`, `project-evidence.md`, `05-playwright.yaml`을 기준으로 테스트 코드 초안을 만든다.

MCP 전에 초안을 만든다는 점이 중요하다.

출력:

```text
automation-contract.yaml
generated/{targetId}.spec.ts
```

### 6.7 `verify-mcp.ts`

runner 내부 Playwright MCP adapter로 실제 화면을 검증한다.

확인 대상:

```text
route load
login state
page title/header
search controls
table
create button
row actions
network/API
stable selectors
document/code/screen mismatch
```

출력:

```text
mcp-observation.yaml
```

수동으로 "에이전트에게 URL을 열어달라"고 하는 방식은 이 단계의 대체물이 아니다.

### 6.8 `refine-spec.ts`

`mcp-observation.yaml`을 읽어 `automation-contract.yaml`과 generated spec을 보정한다.

규칙:

```text
MCP 관찰 성공 + canGenerateSpec=true
  -> generate:true
  -> executable spec 생성

MCP 미관찰 또는 selector 불안정
  -> generate:false
  -> 이유를 contract에 기록
```

출력:

```text
automation-contract.yaml
generated/{targetId}.spec.ts
```

### 6.9 `run-spec.ts`

`docs/common-tester/runtime/playwright.config.ts`를 만들거나 갱신하고 generated spec을 실행한다.

실행 원칙:

```text
pnpm exec playwright test docs/common-tester/runtime/targets/{targetId}/generated/{targetId}.spec.ts --config docs/common-tester/runtime/playwright.config.ts
```

출력:

```text
results/result.json
results/playwright-report/
results/test-results/
results/screenshots/
results/traces/
```

### 6.10 `write-report.ts`

최종 결과와 실패 원인을 정리하고 lock을 갱신한다.

출력:

```text
results/result.md
runtime/lock.json
```

## 7. 명령 실행 시나리오

Git Bash:

```bash
MSYS_NO_PATHCONV=1 pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy"
```

PowerShell:

```powershell
pnpm exec ts-node docs/tools/common-tester/runner.ts create --route "/monitoring/alarm/policy"
```

정상 step 출력:

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

## 8. cmp305-frontend 적용 가능성

적용 가능하다.

확인된 근거:

```text
pnpm + Nx monorepo
service-admin-web가 실행 앱
Vite port는 18000
MONITORING platform env 존재
packages/monitoring/monitoring은 library
/monitoring/alarm/policy는 parent + child route 합성으로 확인 가능
AlarmRulePage.vue component 연결 가능
```

주의:

```text
Git Bash에서는 MSYS_NO_PATHCONV=1 필요
route tree composer가 약하면 scan_project가 실패한다
Confluence env 없으면 sync_confluence가 실제 수집을 못 한다
MCP adapter 연결 전까지 verify_mcp는 adapter_not_configured 상태가 된다
```

## 9. 로컬 산출물 저장 정책

`docs/` 하위에 둔다는 말은 저장소에 올린다는 뜻이 아니다. 프로젝트 루트 안에서 공통 테스터 산출물을 한 위치로 격리한다는 뜻이다.

로컬 보존 대상:

```text
docs/common-tester/00-entry.md
docs/common-tester/01-flow.yaml
docs/common-tester/02-confluence.yaml
docs/common-tester/03-artifacts.yaml
docs/common-tester/04-project-scan.yaml
docs/common-tester/05-playwright.yaml
docs/common-tester/06-cache-policy.yaml
docs/tools/common-tester/**
docs/common-tester/runtime/lock.json
docs/common-tester/runtime/targets/{targetId}/requirements.md
docs/common-tester/runtime/targets/{targetId}/project-evidence.md
docs/common-tester/runtime/targets/{targetId}/test-case-spec.md
docs/common-tester/runtime/targets/{targetId}/automation-contract.yaml
docs/common-tester/runtime/targets/{targetId}/generated/{targetId}.spec.ts
docs/common-tester/runtime/targets/{targetId}/results/result.md
```

secret:

```text
Confluence token
E2E password
raw HTML/body dump
trace/video/screenshot 대용량 파일
local runtime env
```

secret은 env로만 읽는다.

## 10. 구현 순서

1. 브리지 문서 배치
2. `docs/common-tester` 기준 문서 배치
3. `docs/tools/common-tester` runner/operator 배치
4. dry-run 실행
5. route tree composer 검증
6. Confluence sync 구현
7. build-docs 구현
8. write-spec-draft 구현
9. verify-mcp runner adapter 구현
10. refine-spec 구현
11. run-spec 구현
12. write-report 구현

## 11. 결론

이 계획은 폐하가 원하는 Common Tester 방향을 반영한다.

단, 최종 기준은 아래 네 가지가 반드시 지켜져야 한다.

```text
1. 실행기 위치는 docs/tools/common-tester
2. 테스트 초안 생성은 MCP 전에 수행
3. Playwright MCP는 수동 에이전트 지시가 아니라 runner operator 책임
4. 모든 기준/실행기/생성물/결과는 docs 하위에 위치
```
