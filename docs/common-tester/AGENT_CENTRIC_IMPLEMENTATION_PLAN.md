# Agent 중심 공통테스터 구현 계획서

## 결론

공통테스터는 JS runner가 테스트 설계를 대신하는 도구가 아니다.

공통테스터는 Confluence 공통기획을 정리하고, Agent가 프로젝트 코드를 읽어 테스트를 설계하게 만든 뒤, 그 결과를 Playwright 코드로 실행하는 흐름이다.

따라서 핵심 역할은 이렇게 나뉜다.

```text
JS runner
  Confluence 수집, 정규화, 정책 후보 정리, Agent 요청서 생성, 계약 검증, Playwright 실행

Agent
  프로젝트 route/component 분석, field/control 후보 판단, 테스트 케이스 설계, 계약 파일 작성

Playwright
  실제 브라우저 테스트 실행
```

---

## 1. 최종 목표

사용자가 다음처럼 대상 route와 capability를 지정한다.

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js prepare-agent \
  --route "/your/route/create" \
  --capability input \
  --confluence-root-page-id 2926936245
```

그러면 runner는 Confluence 정책을 정리하고 Agent가 읽을 요청서를 만든다.

Agent는 요청서와 프로젝트 코드를 읽고 테스트 계약을 작성한다.

그 다음 사용자가 continue를 실행한다.

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js continue \
  --route "/your/route/create" \
  --capability input
```

그러면 runner가 Agent 계약을 검증하고 Playwright spec을 생성한 뒤 실제 테스트를 실행한다.

---

## 2. 왜 runner 역할을 줄이는가

처음에는 runner가 route/component를 찾고 field/control 후보까지 정리하는 방향을 검토했다.

하지만 이 방향은 위험하다.

프로젝트마다 router 구조, component graph, modal, wizard, form state, validation schema, UI component wrapper가 다르다.

고정 JS runner가 이 변화를 모두 이해한다고 보는 것은 맞지 않다.

따라서 runner는 다음까지만 맡는다.

```text
Confluence raw 수집
Confluence 정규화
policy unit 분해
taxonomy 기반 정책 분류
policy-candidates.yaml 생성
agent-request.md 생성
Agent 산출물 검증
Playwright 실행
```

아래 판단은 Agent가 맡는다.

```text
route/component 분석
field/control 후보 판단
input/dropdown/radio/switch/modal/wizard 테스트 설계
테스트 개수가 충분한지 판단
성공/실패/경계값 케이스 설계
```

---

## 3. prepare-agent 흐름

prepare-agent는 테스트 코드를 만들지 않는다.

Agent가 판단할 근거를 만든 뒤 멈춘다.

```text
[사용자 명령]
prepare-agent
  ↓
[JS runner]
1. load_foundation
2. resolve_target
3. sync_confluence_tree
4. normalize_confluence
5. build_policy_units
6. classify_policy_units
7. build_policy_candidates
8. build_agent_request
  ↓
[산출물]
agent-request.md
agent-output-contract.yaml
policy-candidates.yaml
normalized Confluence md
```

### 각 단계 역할

```text
load_foundation
  docs/common-tester 기준 문서와 yaml을 읽는다.

resolve_target
  route를 targetId로 변환하고 runtime 산출물 위치를 정한다.

sync_confluence_tree
  Confluence root page 기준 child tree를 수집한다.

normalize_confluence
  raw 문서를 Agent가 읽기 쉬운 md 형태로 정규화한다.

build_policy_units
  Confluence 문서를 section/rule 단위로 분해한다.

classify_policy_units
  taxonomy/input.yaml 기준으로 rule 성격을 분류한다.

build_policy_candidates
  input capability와 관련 있는 Confluence 정책 후보를 만든다.
  프로젝트 route/component/field 판단은 하지 않는다.

build_agent_request
  Agent가 읽을 요청서와 산출물 계약을 만든다.
```

---

## 4. Agent 작업 흐름

prepare-agent 이후 Agent가 핵심 판단을 한다.

Agent에게 전달할 기본 지시문은 다음이다.

```text
Read docs/common-tester/runtime/targets/{targetId}/agent-request.md.
Read docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md.
Read docs/common-tester/test-design/input-case-expansion.md.
Read policy-candidates.yaml and normalized Confluence documents.

Analyze the project route/component yourself.
Do not rely on JS runner for field/control discovery.

Create every required file listed in agent-output-contract.yaml under agent-response/.
Every discovered field/control must be accepted, rejected, blocked, or unresolved.
For input constraints, create success, failure, and boundary cases.
Do not generate sample-only tests.
Explain why the generated tests are sufficient in coverage-ledger.md.
```

Agent는 다음을 직접 수행한다.

```text
1. 프로젝트 router에서 대상 route 확인
2. route component 확인
3. 하위 component 추적
4. field/control 후보 수집
5. validation schema/default value/i18n/form state 확인
6. Confluence 정책과 연결
7. input case expansion 문서 기준으로 성공/실패/경계값 설계
8. agent-response 계약 파일 작성
```

Agent 산출물은 다음이다.

```text
agent-response/
  element-inventory.yaml
  coverage-matrix.yaml
  page-contract.yaml
  automation-contract.yaml
  coverage-ledger.md
  common-policy.md
  page-requirements.md
  input-fields.md
  acceptance-criteria.md
  common-policy.yaml
```

`element-inventory.yaml`은 field 목록만 쓰면 안 된다.

Agent는 먼저 어떤 route/component/form/validation 파일을 읽었는지 `analysis.filesInspected`에 남긴다.

그리고 왜 그 파일들을 기준으로 현재 inventory가 충분하다고 보는지 `analysis.completenessBasis`에 설명한다.

---

## 5. input 테스트 다채화 기준

Agent는 `docs/common-tester/test-design/input-case-expansion.md`를 기준으로 input 테스트를 확장한다.

예를 들어 Confluence나 validation schema에서 다음 조건을 발견했다고 한다.

```text
이름은 2~20자만 입력 가능하다.
```

Agent는 정상값 하나만 만들면 안 된다.

다음 케이스를 고려해야 한다.

```text
1자 입력
  최소 길이 미만 실패 확인

2자 입력
  최소 경계값 성공 확인

정상 범위 입력
  일반 성공 확인

20자 입력
  최대 경계값 성공 확인

20자 초과 입력
  최대 길이 초과 실패 확인
```

필수 입력이면 다음도 포함한다.

```text
빈 값
공백만 입력
정상 입력
```

허용 문자 정책이 있으면 다음도 포함한다.

```text
허용 한글
허용 영문/숫자
허용 하이픈/언더바
비허용 특수문자
앞뒤 공백
```

숫자 입력이면 다음도 포함한다.

```text
정상 정수
정상 소수
빈 값
문자 입력
음수
최대값 초과
```

---

## 6. continue 흐름

Agent가 산출물을 만든 뒤 사용자가 continue를 실행한다.

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js continue \
  --route "/your/route/create" \
  --capability input
```

continue는 Agent 판단을 대신하지 않는다.

continue는 Agent가 작성한 계약이 실행 가능한지만 검증하고 실행한다.

```text
[사용자 명령]
continue
  ↓
[JS runner]
1. load_foundation
2. resolve_target
3. read_agent_response
4. validate_contract
5. build_run_plan
6. generate_spec
7. list_spec
8. run_spec
9. write_report
```

### 각 단계 역할

```text
read_agent_response
  Agent가 만든 agent-response/*.yaml, *.md 파일을 읽는다.

validate_contract
  필수 파일 존재 여부를 확인한다.
  element-inventory와 page-contract 연결을 확인한다.
  coverage-matrix row와 automation-contract case 연결을 확인한다.
  coverage-ledger.md에 근거가 남았는지 확인한다.
  renderer가 지원하지 않는 action/assertion을 막는다.

build_run_plan
  automation-contract의 generate:true case를 실행 계획으로 만든다.

generate_spec
  page-contract + automation-contract를 Playwright spec.ts로 렌더링한다.

list_spec
  playwright --list를 실행해 실제 테스트 개수를 확인한다.

run_spec
  Playwright 테스트를 실행한다.

write_report
  result.md/result.json을 작성한다.
```

---

## 7. validate_contract의 새 기준

validate_contract는 테스트 개수를 설계하지 않는다.

대신 다음을 검증한다.

```text
1. Agent 산출물 필수 파일이 모두 있는가
2. element-inventory.yaml의 field/control이 page-contract.yaml에 연결되는가
3. coverage-matrix.yaml의 row가 automation-contract.yaml case로 덮이는가
4. automation-contract.yaml이 renderer 지원 action/assertion만 쓰는가
5. coverage-ledger.md가 테스트 충분성 근거를 설명하는가
6. rejected/blocked/unresolved 항목에 이유가 있는가
7. Playwright --list 결과와 run-plan이 일치하는가
```

즉 runner가 “35개 이상 만들어라”처럼 최종 테스트 수를 직접 설계하지 않는다.

하지만 Confluence 정책에서 나온 `coverage.requiredIntents`는 최소 하한이다.

각 required intent가 최소 한 번 이상 실행 케이스로 덮이지 않으면 실패한다.

Agent가 왜 그 테스트 수가 충분한지 설명하고, runner는 그 설명과 계약 연결이 빠졌는지 검증한다.

---

## 8. 명령어 기준 수동 실행 순서

### 1단계. foundation 설치

프로젝트 루트에서 foundation zip을 푼다.

```bash
unzip -o "/c/Users/admin/Documents/공통테스터/common-tester-agent-foundation.zip"
```

### 2단계. prepare-agent 실행

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js prepare-agent \
  --route "/your/route/create" \
  --capability input \
  --confluence-root-page-id 2926936245
```

### 3단계. Agent에게 agent-request.md 기준 작업 지시

```text
Read docs/common-tester/runtime/targets/your-route-create/agent-request.md.
Create every required file listed in agent-output-contract.yaml under agent-response/.
Read docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md.
Read docs/common-tester/test-design/input-case-expansion.md.
Analyze the project route/component yourself.
Do not rely on JS runner for field/control discovery.
Every discovered field/control must be accepted, rejected, blocked, or unresolved.
For input constraints, create success, failure, and boundary cases.
Explain why the generated tests are sufficient in coverage-ledger.md.
```

### 4단계. continue 실행

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js continue \
  --route "/your/route/create" \
  --capability input
```

### 5단계. 브라우저를 보면서 직접 실행

```bash
./node_modules/.bin/playwright.CMD test \
  docs/common-tester/runtime/targets/your-route-create/generated/your-route-create.spec.ts \
  --config docs/common-tester/runtime/playwright.config.ts \
  --headed \
  --workers=1
```

---

## 9. 내일 구현 순서

### 1순위. Agent 요청서 강화 확인

`build-agent-request.ts`가 다음 문서를 반드시 요청서에 포함해야 한다.

```text
docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md
docs/common-tester/test-design/input-case-expansion.md
```

### 2순위. runner 역할 축소 정리

`scan_project`는 기본 prepare-agent 흐름에서 실행하지 않는다.

필요하면 나중에 별도 debug/advisory 명령으로만 둔다.

Agent 요청서에는 다음을 명확히 쓴다.

```text
Agent owns project route/component analysis.
Do not rely on JS runner for field/control discovery.
Every element-inventory field must include codeRefs.
```

### 3순위. Agent 산출물 품질 검증

`validate_contract`는 다음을 강화한다.

```text
coverage-ledger.md에 테스트 충분성 설명이 없으면 실패
blocked/rejected/unresolved 이유가 없으면 실패
automation-contract가 coverage-matrix row를 덮지 않으면 실패
inputCases가 coversInputCases로 연결되지 않으면 실패
```

### 4순위. renderer 확장

현재 renderer는 input 중심이다.

테스트가 다채롭게 나오려면 다음 action/assertion을 점진적으로 늘려야 한다.

```text
radio.select
option.select
switch.toggle
expect.checked
expect.selectedText
expect.validationMessage
expect.modalVisible
```

단, renderer 확장은 Agent가 설계한 계약을 실행 가능하게 만드는 보조 작업이다.

테스트 설계 책임은 계속 Agent에게 있다.

---

## 10. 성공 기준

성공 기준은 단순히 테스트 수가 많은 것이 아니다.

성공 기준은 다음이다.

```text
1. Confluence 정책 근거가 남는다.
2. Agent가 프로젝트 route/component를 직접 분석한 흔적이 `analysis.filesInspected`에 남는다.
3. Agent가 발견한 field/control 목록이 element-inventory에 남는다.
4. 각 field/control이 accepted/rejected/blocked/unresolved로 설명된다.
5. input 제약은 성공/실패/경계값으로 확장된다.
6. automation-contract가 실제 Playwright spec으로 렌더링된다.
7. playwright --list에서 테스트 개수가 확인된다.
8. playwright test가 실행된다.
9. result.md에 테스트 수, 통과/실패, blocked/unresolved가 남는다.
```

현재 5개 테스트만 생성되는 흐름은 성공 기준을 만족하지 못한다.

그 이유는 테스트 수 자체보다, Agent가 프로젝트의 전체 field/control과 input 제약을 충분히 설명하지 않았기 때문이다.

---

## 11. 최종 판단

이 계획의 핵심은 runner를 똑똑하게 만드는 것이 아니다.

Agent가 제대로 판단할 수 있는 근거와 기준 문서를 주고, Agent가 만든 계약을 runner가 실행 가능한지 검증하는 것이다.

```text
runner = 정리자 + 검증자 + 실행자
Agent = 분석자 + 설계자 + 계약 작성자
Playwright = 브라우저 실행자
```

이 구조가 폐하가 요구한 공통테스터의 기준이다.
