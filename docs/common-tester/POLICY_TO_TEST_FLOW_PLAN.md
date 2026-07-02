# Policy To Test Flow Plan

## 결론

테스트 개수는 Confluence 정책 후보 개수로 결정하지 않는다.

또한 JS runner가 고정 규칙으로 테스트 개수를 결정하지 않는다.

테스트 개수는 Agent가 실제 프로젝트 코드와 Confluence 정책을 함께 읽고 판단한다.

Agent는 실제 화면의 입력 요소 수, 각 입력 요소에 적용되는 정책 intent, validation schema, success/failure/boundary case를 근거로 테스트 계약을 만든다.

따라서 Common Tester의 핵심 연결식은 다음이다.

```text
Confluence policy candidate
  -> policy intent
  -> policy rule params
  -> element inventory field
  -> field constraint
  -> test expansion case
  -> coverage matrix row
  -> automation-contract case
  -> Playwright test
```

정책 후보가 47개라는 말은 테스트가 47개라는 뜻이 아니다.

정책 후보는 테스트의 근거다.

테스트는 Agent가 작성한 `element-inventory.yaml`, `coverage-matrix.yaml`, `automation-contract.yaml`의 연결로 늘어난다.

새 기준에서는 중간 다리가 하나 더 필요하다.

Confluence 평문에 "소수점 둘째 자리까지"라고 적혀 있으면 Agent가 감으로 해석하면 안 된다.

먼저 `policy-rules.yaml`에 `maxDecimals: 2`로 구조화되어야 한다.

그 다음 Agent가 그 규칙을 실제 필드에 매핑해 `field-constraint-inventory.yaml`을 만들고, 그 제약을 성공/실패/경계값으로 풀어 `test-expansion-plan.yaml`을 만든다.

---

## 1. policy-candidates.yaml은 어떻게 만들어지는가

`policy-candidates.yaml`은 아래 입력을 사용해 생성한다.

```text
policy-units.yaml
policy-categories.yaml
taxonomy/input.yaml
```

`project-model.json`은 기본 흐름의 필수 입력이 아니다.

route/component/field/control 판단의 최종 책임은 Agent에게 있다.

생성 순서는 다음이다.

```text
classifiedUnits 읽기
  ↓
categoryIds / suggestedTestIntents / matchedKeywords 추출
  ↓
taxonomy/input.yaml selection 규칙으로 score 계산
  ↓
minScore 미만은 rejectedCandidates로 이동
  ↓
score 내림차순으로 정렬
  ↓
maxCandidates 범위까지 candidates 선택
  ↓
pageId / titlePath / heading / categoryIds / policy text 기준 stable candidateId 부여
  ↓
intent별 candidate 묶음 생성
  ↓
coverage.requiredIntents 생성
```

각 candidate는 반드시 다음 정보를 가진다.

```yaml
candidateId: policy-candidate-8f43a12c0a91
capability: input
sourceRef:
  pageId: "1859978517"
  pageTitle: "01. 텍스트 규칙"
  titlePath:
    - "02. 공통 정책"
    - "01. 텍스트 규칙"
    - "설명 등 장문의 내용 입력의 경우"
policyUnitId: policy-unit-0018
categoryIds:
  - input.value.allowedCharacters
suggestedTestIntents:
  - allowed-character-fixtures
relevance:
  score: 211
  reasons:
    - "input.value.allowedCharacters: 한글, 알파벳, 숫자"
```

즉 candidate는 테스트 코드가 아니라, 테스트를 만들 수 있는 정책 근거다.

---

## 2. coverage.requiredIntents는 무엇인가

`coverage.requiredIntents`는 selected candidates의 `suggestedTestIntents`를 중복 제거한 목록이다.

예시:

```yaml
coverage:
  minGeneratedCaseCount: 11
  requiredIntents:
    - intent: allowed-character-fixtures
      candidateIds:
        - policy-candidate-8f43a12c0a91
    - intent: boundary-length
      candidateIds:
        - policy-candidate-6d21be90f44c
    - intent: required-empty
      candidateIds:
        - policy-candidate-c912aa7d33e0
    - intent: whitespace-only
      candidateIds:
        - policy-candidate-c912aa7d33e0
    - intent: commit-action
      candidateIds:
        - policy-candidate-a81b20c9f1da
    - intent: clear-condition
      candidateIds:
        - policy-candidate-51d902ac0f77
    - intent: result-reflection
      candidateIds:
        - policy-candidate-a81b20c9f1da
    - intent: validation-message
      candidateIds:
        - policy-candidate-4db753a8c120
    - intent: visible-enabled
      candidateIds:
        - policy-candidate-a81b20c9f1da
    - intent: placeholder
      candidateIds:
        - policy-candidate-a81b20c9f1da
    - intent: focusable
      candidateIds:
        - policy-candidate-a81b20c9f1da
```

이 값은 Confluence 정책 기준의 breadth다.

하지만 최종 테스트 수는 이 숫자로 끝나지 않는다.

Agent가 프로젝트 코드에서 발견한 실제 필드에 이 intent와 input expansion rule을 적용하면 테스트 수가 늘어난다.

---

## 3. element-inventory.yaml이 필요한 이유

Agent가 화면의 form control을 빠뜨리면 테스트는 늘어날 수 없다.

따라서 Agent는 `agent-request.md`를 읽은 뒤 프로젝트 코드와 화면 흐름에서 실제 입력 요소 목록을 먼저 만든다.

이 파일은 runner가 임의로 추측해서 완성하지 않는다.

이유는 명확하다.

입력 필드는 list 화면에만 있지 않다.

생성 버튼을 눌러 열리는 drawer, modal, panel, edit 화면 안에도 있다.

wizard의 다음 step에도 있다.

radio, combobox, checkbox, switch, date picker, readonly picker, disabled dependent field도 테스트 대상 후보에 포함된다.

고정 JS가 이 흐름을 모두 알 수 없기 때문에 Agent가 프로젝트 코드를 보고 `agent-response/element-inventory.yaml`로 확정한다.

중요한 규칙이 있다.

`element-inventory.yaml`은 현재 renderer로 바로 실행 가능한 필드만 적는 파일이 아니다.

화면의 모든 form control을 적는 파일이다.

현재 renderer가 지원하지 않는 control은 `coverage-matrix.yaml`에서 `generate:false`와 `blockedReason`으로 남긴다.

조용히 누락하면 실패다.

```yaml
schemaVersion: 1
kind: element-inventory
targetId: monitoring-alarm-policy
route: /monitoring/alarm/policy
analysis:
  filesInspected:
    - file: packages/monitoring/monitoring/src/pages/alarm-rule/ui/AlarmRuleCreatePage.vue
      reason: requested route component
    - file: packages/monitoring/monitoring/src/features/alarm-rule/create/model/schema.ts
      reason: validation schema
  completenessBasis: route component, child form components, and validation schema were inspected before field inventory was written.
fields:
  - fieldId: searchKeyword
    scope: list
    control: textbox
    label: 검색어
    required: false
    selectorHints:
      - strategy: placeholder
        value: 항목 이름 또는 값을 입력해 주세요.
    codeRefs:
      - file: libs/shared/ui/src/form-elements/search-filters/cmp-filter/CmpFilterContent.vue
  - fieldId: policyName
    scope: create
    control: textbox
    label: 정책명
    required: true
  - fieldId: severity
    scope: create
    control: combobox
    label: 심각도
    required: true
  - fieldId: nextStep
    scope: wizard
    control: button
    label: 다음
    required: false
```

이 파일의 목적은 명확하다.

Agent가 `page-contract.yaml`에 넣어야 할 field 목록을 고정한다.

이 inventory에 있는 field가 `page-contract.yaml`에 없으면 `continue`에서 실패한다.

반대로 코드와 validation schema에 존재하는 form control이 inventory에 빠져도 잘못된 산출물이다.

---

## 3-1. policy-rules.yaml이 필요한 이유

`policy-candidates.yaml`은 어떤 Confluence 문장이 테스트에 관련 있는지 알려준다.

하지만 다음 문장은 candidate만으로는 부족하다.

```text
숫자 입력은 소수점 둘째 자리까지 허용한다.
```

테스트를 만들려면 이 문장이 아래처럼 바뀌어야 한다.

```yaml
ruleId: policy-rule-...
category: input.numeric.decimalPrecision
params:
  maxDecimals: 2
suggestedExpansion:
  success:
    - integer
    - decimal-2-digits
  failure:
    - decimal-3-digits
    - non-numeric
```

이 파일은 JS runner가 만드는 1차 구조화 결과다.

단, 최종 판단은 Agent가 한다.

Agent는 `policy-rules.yaml`과 normalized Confluence markdown을 함께 확인하고, 실제 프로젝트 필드에 적용 가능한 규칙만 `field-constraint-inventory.yaml`에 옮긴다.

---

## 3-2. field-constraint-inventory.yaml이 필요한 이유

이 파일은 "어떤 필드에 어떤 제약이 적용되는가"를 고정한다.

예시:

```yaml
fields:
  - fieldId: thresholdValue
    targetRef: elements.fields.thresholdValue
    control: number
    label: 임계치
    constraints:
      - constraintId: thresholdValue-decimal-precision
        type: input.numeric.decimalPrecision
        params:
          maxDecimals: 2
        sourceRefs:
          - kind: policy-rule
            ruleId: policy-rule-...
      - constraintId: thresholdValue-required
        type: input.value.required
        params:
          required: true
        sourceRefs:
          - kind: project-schema
            file: packages/...
```

이 파일이 있어야 Agent가 "임계치", "위반 비율", "위반 수", "알람 정책명", "설명" 같은 필드를 빠뜨렸는지 검증할 수 있다.

---

## 3-3. test-expansion-plan.yaml이 필요한 이유

이 파일은 필드 제약을 실제 테스트 분할로 바꾼다.

예시:

```yaml
expectedExecutableCaseCountMin: 35
cases:
  - caseId: thresholdValue-decimal-valid
    fieldId: thresholdValue
    constraintId: thresholdValue-decimal-precision
    partition: success
    value: "10.25"
    expected:
      kind: accepted
  - caseId: thresholdValue-decimal-over
    fieldId: thresholdValue
    constraintId: thresholdValue-decimal-precision
    partition: failure
    value: "10.255"
    expected:
      kind: validation-message
```

이 파일이 있어야 테스트가 5개만 생성되는 상황을 막을 수 있다.

`automation-contract.yaml`의 생성 케이스 수가 `expectedExecutableCaseCountMin`보다 작으면 `continue`에서 실패한다.

또한 모든 `test-expansion-plan.yaml` 케이스는 `automation-contract.yaml`의 `coversExpansionCases`로 추적되어야 한다.

---

## 4. coverage-matrix.yaml은 어떻게 만들어지는가

`coverage-matrix.yaml`은 Agent가 `element-inventory.yaml`, `policy-candidates.yaml`, `field-constraint-inventory.yaml`, `test-expansion-plan.yaml`을 함께 보고 만든다.

```text
for each field in element-inventory.fields
  for each intent in policy-candidates.coverage.requiredIntents
    if intent applies to field.control / required / scope
      create matrix row
```

예시:

```yaml
schemaVersion: 1
kind: coverage-matrix
targetId: monitoring-alarm-policy
rows:
  - rowId: matrix-row-0001
    fieldId: policyName
    targetRef: elements.fields.policyName
    intent: visible-enabled
    candidateIds:
      - policy-candidate-a81b20c9f1da
    generate: true
  - rowId: matrix-row-0002
    fieldId: policyName
    targetRef: elements.fields.policyName
    intent: required-empty
    candidateIds:
      - policy-candidate-c912aa7d33e0
    generate: true
  - rowId: matrix-row-0003
    fieldId: severity
    targetRef: elements.fields.severity
    intent: visible-enabled
    candidateIds:
      - policy-candidate-a81b20c9f1da
    generate: true
```

이 파일은 Agent가 판단한 테스트 커버리지를 기록한다.

```text
generate:true matrix row 수 = Agent가 필요하다고 판단한 테스트 커버리지 수
```

JS runner는 이 숫자를 설계하지 않는다.

JS runner는 `coverage-matrix.yaml`과 `automation-contract.yaml`이 서로 맞는지, 그리고 근거가 빠지지 않았는지를 검증한다.

하나의 Playwright test가 여러 matrix row를 커버할 수는 있다.

하지만 모든 generate:true row는 반드시 `automation-contract.yaml`에서 추적되어야 한다.

즉 47개 candidate가 있더라도 테스트는 47개로 고정되지 않는다.

생성 화면에 입력 필드가 10개이고, 각 필드에 적용되는 intent가 8개라면 matrix row는 최대 80개가 된다.

그 80개 row를 몇 개의 Playwright test로 묶을지는 Agent가 정하되, 모든 row를 `coversMatrixRows`로 추적해야 한다.

또 하나가 더 필요하다.

입력 테스트는 성공 입력과 실패 입력이 없으면 의미가 약하다.

따라서 value-oriented row는 `inputCases`를 가져야 한다.

```yaml
rows:
  - rowId: matrix-row-policy-name-allowed
    fieldId: policyName
    targetRef: elements.fields.policyName
    intent: allowed-character-fixtures
    candidateIds:
      - policy-candidate-8f43a12c0a91
    generate: true
    inputCases:
      success:
        - inputId: success-korean
          value: 정상정책명
          expected:
            kind: accepted
        - inputId: success-alpha-number
          value: Policy-001
          expected:
            kind: accepted

  - rowId: matrix-row-policy-name-required
    fieldId: policyName
    targetRef: elements.fields.policyName
    intent: required-empty
    candidateIds:
      - policy-candidate-c912aa7d33e0
    generate: true
    inputCases:
      failure:
        - inputId: failure-empty
          value: ""
          expected:
            kind: validation-message
            message: 필수
        - inputId: failure-whitespace
          value: "   "
          expected:
            kind: validation-message
            message: 필수
```

이렇게 해야 테스트가 단순히 필드를 클릭해보는 수준에서 끝나지 않는다.

성공 입력은 정상값이 받아들여지는지 확인한다.

실패 입력은 빈 값, 공백, 길이 초과, 허용되지 않는 문자 같은 값을 넣었을 때 막히는지 확인한다.

---

## 5. automation-contract.yaml은 무엇을 커버해야 하는가

`automation-contract.yaml`의 각 case는 다음 중 하나 이상을 가져야 한다.

```yaml
coversMatrixRows:
  - matrix-row-0001
coversIntents:
  - visible-enabled
coversInputCases:
  - rowId: matrix-row-policy-name-required
    inputId: failure-empty
```

최종 기준은 `coversMatrixRows`다.

`coversIntents`는 보조 정보다.

`coversInputCases`는 실제 성공/실패 입력값을 실행했다는 증거다.

예시:

```yaml
cases:
  - id: create-policy-name-required-empty
    capability: input
    title: 정책명 필수 입력은 빈 값 저장을 막는다
    generate: true
    coversMatrixRows:
      - matrix-row-0002
    coversIntents:
      - required-empty
    coversInputCases:
      - rowId: matrix-row-0002
        inputId: failure-empty
    steps:
      - action: input.clear
        targetRef: elements.fields.policyName
    assertions:
      - action: expect.textVisible
        text: 필수
        exact: false
    sourceRefs:
      - candidateId: policy-candidate-c912aa7d33e0
        pageId: "1931674086"
        titlePath:
          - "02. 공통 정책"
          - "03. 필터 & 검색"
```

---

## 6. validator가 강제해야 하는 것

`continue`는 다음을 검증해야 한다.

```text
1. element-inventory.yaml의 모든 field가 page-contract.yaml에 존재한다.
2. page-contract.yaml의 field selector/sourceRefs가 유효하다.
3. coverage-matrix.yaml의 모든 generate:true row가 automation-contract.yaml에서 coversMatrixRows로 참조된다.
4. automation-contract.yaml의 모든 coversMatrixRows가 실제 matrix row id다.
5. 각 coversIntents는 sourceRefs의 candidateId가 실제로 뒷받침해야 한다.
6. value-oriented row는 성공/실패 inputCases를 선언해야 한다.
7. 모든 inputCases는 automation-contract.yaml의 coversInputCases에서 참조되어야 한다.
8. 각 generated case는 candidateId를 sourceRefs에 남긴다.
9. coverage-ledger.md는 모든 matrix row, inputId, generated case를 언급해야 한다.
10. 각 generated case는 targetRef만 사용하고 raw selector를 쓰지 않는다.
11. generated spec의 test 수와 run-plan의 executable case 수가 일치한다.
```

이 검증이 있어야 Agent가 2개만 만들고 통과하는 상황을 막을 수 있다.

---

## 7. 최종 흐름도

```text
prepare-agent
  ↓
Confluence tree/raw/normalized 수집
  ↓
policy-units.yaml
  ↓
policy-categories.yaml
  ↓
policy-rules.yaml
  - maxDecimals, minLength, maxLength 같은 구조화 값
  ↓
policy-candidates.yaml
  - candidates
  - rejectedCandidates
  - coverage.requiredIntents
  ↓
agent-request.md
  - candidates 읽기 강제
  - 프로젝트 코드는 Agent가 직접 분석
  - inventory field 누락 금지
  - matrix row 커버 강제
  ↓
Agent writes agent-response
  - element-inventory.yaml
  - field-constraint-inventory.yaml
  - test-expansion-plan.yaml
  - coverage-matrix.yaml
  - coverage-ledger.md
  - page-contract.yaml
  - automation-contract.yaml
  ↓
continue
  ↓
validate-contract
  - inventory vs page-contract
  - policy-rules vs field-constraint
  - field-constraint vs test-expansion
  - test-expansion vs automation-contract
  - matrix vs automation-contract
  - sourceRefs/targetRef 검증
  ↓
generate spec
  ↓
playwright --list
  ↓
playwright test
  ↓
result.md / result.json
```

---

## 8. 이 계획이 보장하는 것

이전 구조:

```text
정책 후보 47개 -> Agent가 임의로 2개 테스트 작성 -> 통과
```

새 구조:

```text
정책 후보 47개
  -> intent 전체 추출
  -> 평문 정책을 구조화 규칙으로 변환
  -> 실제 field 전체 추출
  -> field별 제약 매핑
  -> success/failure/boundary 확장
  -> field x intent matrix 생성
  -> matrix row 전체 커버 전까지 실패
```

따라서 생성 페이지에 input이 많으면 테스트도 많아진다.

테스트 수가 줄어드는 경우는 Agent가 임의로 줄인 것이 아니라, matrix에서 `generate:false`와 사유가 명시된 경우뿐이다.
