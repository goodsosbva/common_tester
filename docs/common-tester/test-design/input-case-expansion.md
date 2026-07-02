# Input Case Expansion Guide

## 결론

input 테스트는 정상 입력 한 번으로 끝나지 않는다.

Confluence 공통정책이나 프로젝트 validation에서 입력 제약이 발견되면 Agent는 성공값, 실패값, 경계값을 함께 설계해야 한다.

## 이 문서의 목적

이 문서는 JS runner가 테스트 개수를 계산하게 하려는 문서가 아니다.

Agent가 Confluence 정책과 프로젝트 validation을 읽었을 때, 테스트 케이스를 충분히 다양하게 확장하도록 돕는 기준 문서다.

## 기본 원칙

1. 입력 제약이 있으면 경계값을 만든다.
2. 필수값이면 미입력과 공백만 입력을 테스트한다.
3. 최소 길이가 있으면 최소 미만, 최소값, 정상값을 테스트한다.
4. 최대 길이가 있으면 최대값, 최대 초과값을 테스트한다.
5. 허용 문자 정책이 있으면 허용 문자와 비허용 문자를 모두 테스트한다.
6. 숫자 입력이면 최소/최대/소수점/문자 입력을 확인한다.
7. 입력 후 반영 위치가 있으면 값 유지뿐 아니라 결과 반영까지 확인한다.
8. 저장/검색/확정 동작이 있으면 commit trigger를 확인한다.

## 길이 제한 정책

예를 들어 Confluence 또는 validation에서 다음 정책이 발견되었다고 가정한다.

```text
이름은 2~20자만 입력 가능하다.
```

Agent는 최소한 다음 케이스를 고려한다.

```yaml
caseIdeas:
  - id: length-below-min
    value: "가"
    expected: validation-error
    reason: 최소 2자보다 짧다.

  - id: length-at-min
    value: "가나"
    expected: accepted
    reason: 최소 2자 경계값이다.

  - id: length-inside-range
    value: "정상정책명"
    expected: accepted
    reason: 정상 범위 대표값이다.

  - id: length-at-max
    value: "가나다라마바사아자차카타파하가나다라마"
    expected: accepted
    reason: 최대 20자 경계값이다.

  - id: length-above-max
    value: "가나다라마바사아자차카타파하가나다라마바사"
    expected: validation-error
    reason: 최대 20자를 초과한다.
```

프로젝트 validation helper의 기본값도 제약이다.

예를 들어 `createTextLengthSchema(fieldName)`의 기본값이 `min=2`, `max=30`이면, 필드 선언부에 숫자가 직접 보이지 않아도 다음 경계값을 만든다.

```yaml
caseIdeas:
  - id: length-below-min
    valueLength: 1
    expected: validation-error

  - id: length-at-min
    valueLength: 2
    expected: accepted

  - id: length-inside-range
    valueLength: 10
    expected: accepted

  - id: length-at-max
    valueLength: 30
    expected: accepted

  - id: length-above-max
    valueLength: 31
    expected: validation-error
```

Confluence 공통정책과 프로젝트 validation이 다르면 둘 중 하나를 숨기지 않는다. 실행 기대값은 실제 프로젝트 validation 기준으로 만들고, 차이는 `coverage-ledger.md`에 정책/구현 불일치로 기록한다.

## 필수값 정책

필수 입력이면 다음을 고려한다.

```yaml
caseIdeas:
  - id: required-empty
    value: ""
    expected: validation-error

  - id: required-whitespace
    value: "   "
    expected: validation-error-or-trimmed

  - id: required-valid
    value: "정상값"
    expected: accepted
```

## 허용 문자 정책

예를 들어 다음 정책이 있으면:

```text
한글, 영문, 숫자, 하이픈, 언더바만 허용한다.
```

Agent는 다음을 고려한다.

```yaml
caseIdeas:
  - id: allowed-korean
    value: "정책이름"
    expected: accepted

  - id: allowed-alpha-number
    value: "Policy001"
    expected: accepted

  - id: allowed-hyphen-underscore
    value: "Policy_001-A"
    expected: accepted

  - id: disallowed-special
    value: "Policy@001!"
    expected: validation-error

  - id: disallowed-leading-trailing-space
    value: " 정책 "
    expected: validation-error-or-trimmed
```

## 숫자 입력 정책

숫자 입력이면 다음을 고려한다.

```yaml
caseIdeas:
  - id: numeric-valid-integer
    value: "10"
    expected: accepted

  - id: numeric-valid-decimal
    value: "10.5"
    expected: accepted-if-decimal-allowed

  - id: numeric-empty
    value: ""
    expected: validation-error-if-required

  - id: numeric-text
    value: "abc"
    expected: validation-error

  - id: numeric-negative
    value: "-1"
    expected: validation-error-if-negative-not-allowed

  - id: numeric-too-large
    value: "1000000000000001"
    expected: validation-error-if-max-exceeded
```

## commit 동작

입력값이 언제 확정되는지에 따라 테스트가 달라진다.

```yaml
commitTriggers:
  - enter
  - blur
  - search-button
  - save-button
  - selection-immediate
```

예:

```yaml
caseIdeas:
  - id: value-retained-before-commit
    action: fill
    expected: input-value-retained

  - id: commit-by-enter
    action: press-enter
    expected: result-updated

  - id: commit-by-blur
    action: blur
    expected: validation-or-result-updated
```

## 결과 반영

입력 테스트는 가능하면 값 유지에서 멈추지 않는다.

다음 중 하나 이상을 확인한다.

```yaml
resultBindings:
  - input value is retained
  - validation message appears
  - validation message disappears
  - filter tag appears
  - table rows are refreshed
  - API query contains value
  - save button becomes enabled
  - submit request payload contains value
```

## Agent 산출물 반영

Agent는 위 판단을 다음 파일에 반영한다.

```text
element-inventory.yaml
  - 어떤 입력 필드가 있는지 기록

field-constraint-inventory.yaml
  - Confluence policy-rules.yaml과 프로젝트 validation을 필드별 제약으로 매핑

test-expansion-plan.yaml
  - 각 제약을 성공/실패/경계 케이스로 분해

coverage-matrix.yaml
  - 어떤 field에 어떤 input case가 적용되는지 기록

automation-contract.yaml
  - 실제 Playwright로 실행할 action/assertion 기록
  - test-expansion-plan.yaml의 caseId를 coversExpansionCases로 추적

coverage-ledger.md
  - 왜 이 테스트 수와 케이스가 충분한지 설명
  - field, constraint, expansion case, generated test 연결을 설명
```

## 금지 사항

- 정상 입력 한 번만 만들고 끝내지 않는다.
- placeholder 확인만 하고 입력 검증을 끝내지 않는다.
- Confluence에 길이/필수/문자 정책이 있는데 경계값을 만들지 않으면 안 된다.
- 프로젝트 validation schema에 제약이 있는데 테스트에 반영하지 않으면 안 된다.
- 텍스트 입력 필드는 `blocked`로 통과시키지 않는다. Agent는 선행 조작을 찾아 executable case를 만들거나, 불가능하면 계약 전체를 unresolved로 실패시킨다.
- create/edit/wizard 화면에서 바로 보이는 필드만 골라 성공 처리하지 않는다. 나중 단계 input이 source에서 확인되면 선행 동작을 모델링하거나, 데이터 prerequisite 부재를 증거로 남기고 partial success를 만들지 않는다.
