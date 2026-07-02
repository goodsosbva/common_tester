# Policy Case Expansion Guide

## 결론

공통 규칙 하나는 테스트 하나가 아니다.

Agent는 Confluence 공통정책이나 프로젝트 규칙을 발견하면 capability 종류와 무관하게 성공, 실패, 경계, 상태, 선행조건 케이스 묶음으로 확장해야 한다.

## 공통 확장 원칙

정책 규칙을 테스트로 만들 때 최소한 아래 질문을 통과한다.

1. 정상 동작은 무엇인가?
2. 실패 동작은 무엇인가?
3. 경계값이나 임계 상태가 있는가?
4. 필수 선행조건이 있는가?
5. 선행조건이 없거나 비활성 상태일 때는 어떻게 보이는가?
6. 결과는 어디에서 증명되는가?
7. 접근 권한, 빈 데이터, 로딩, disabled 상태가 동작을 바꾸는가?

위 질문 중 적용되는 항목은 `test-expansion-plan.yaml`, `coverage-matrix.yaml`, `automation-contract.yaml`, `coverage-ledger.md`에 남긴다.

## capability별 예시

### input

예: 일반 텍스트는 2~100자

- 1자: validation failure
- 2자: success
- 중간값: success
- 100자: success
- 101자: validation failure

### selection

예: 드롭다운은 필수 선택

- 미선택 후 다음/저장: validation failure
- 첫 번째 enabled option 선택: success
- 선택 후 변경: selected value changes
- option 없음: 선택 불가 상태 또는 no-data feedback
- disabled 상태에서 클릭 시도 금지: prerequisite 먼저 모델링

### table/list

예: 목록은 검색/필터/정렬/페이지네이션을 제공

- 기본 진입: table/list visible
- 검색어 일치: 결과 반영
- 검색어 불일치: empty state
- 필터 적용: 결과 또는 필터 chip 반영
- 정렬 적용: 정렬 상태 또는 row order 변경
- 페이지 이동 가능 시: next/prev page state 확인

### modal/drawer

예: 생성 버튼은 modal을 연다

- open trigger 클릭: modal visible
- cancel/close: modal hidden and draft discarded
- required field 누락 후 confirm: validation failure
- valid input 후 confirm: modal closes and result reflects
- dependent control disabled: enabling prerequisite 먼저 실행

### action/submit

예: 저장은 유효한 입력에서만 동작

- invalid form submit: validation visible and request not sent
- valid form submit: success feedback/navigation/request payload
- duplicate submit 방지: loading/disabled state
- API failure: error feedback if project exposes it

## 산출물 규칙

- `policy-rules.yaml`: 공통정책을 구조화한 원천이다.
- `field-constraint-inventory.yaml`: 정책/프로젝트 규칙을 실제 필드와 컨트롤에 매핑한다.
- `test-expansion-plan.yaml`: 규칙 하나를 여러 caseType으로 확장한다.
- `coverage-matrix.yaml`: capability, targetRef, intent, success/failure case를 연결한다.
- `automation-contract.yaml`: 실행 가능한 Playwright steps/assertions만 둔다.
- `coverage-ledger.md`: 왜 이 케이스 수가 충분한지 정책, 프로젝트 근거, generated test를 연결한다.

## 금지

- 공통 규칙을 샘플 한 개로 축소하지 않는다.
- 현재 renderer가 쉬운 동작만 골라 partial success를 만들지 않는다.
- 화면 데이터가 없어 선행조건을 만족할 수 없으면 그 증거를 남기고 unresolved로 실패시킨다.
- validation, no-data, disabled, empty, boundary 상태를 숨기지 않는다.
