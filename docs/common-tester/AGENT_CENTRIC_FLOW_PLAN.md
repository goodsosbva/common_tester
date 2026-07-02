# Agent-Centric Common Tester Flow

## 결론

공통테스터의 핵심 판단은 JS runner가 아니라 Agent가 한다.

JS runner는 Confluence 문서를 수집하고 정리해서 Agent가 판단할 근거를 만든다.

Agent는 그 근거와 실제 프로젝트 코드를 함께 읽고, 테스트 대상과 테스트 케이스를 설계한다.

## 왜 이렇게 바꾸는가

고정 JS runner가 모든 프로젝트의 route 구조, component 구조, field 개수, 입력 조건, modal, wizard, selection flow를 안정적으로 판단한다고 보는 것은 위험하다.

프로젝트마다 구조가 다르고, 같은 input capability라도 실제 테스트 요구사항은 계속 달라진다.

따라서 runner가 테스트 개수나 field 목록을 결정하면 공통테스터가 다시 고정 규칙 모음으로 굳는다.

공통테스터에서 고정되어야 하는 것은 테스트 판단이 아니라 작업 흐름과 산출물 계약이다.

## 역할 분리

### JS runner

JS runner는 다음만 담당한다.

- Confluence root page 하위 문서 수집
- raw cache 저장
- storage/html/adf 정규화
- section/rule 단위 분해
- taxonomy 기준 정책 성격 분류
- capability별 policy candidates 생성
- Agent가 읽을 `agent-request.md` 생성
- Agent 산출물의 형식, 참조, 근거 추적 검증
- Playwright spec 렌더링
- Playwright list/run 실행
- 결과 리포트 작성

JS runner는 다음을 하지 않는다.

- route/component 최종 판단
- field/control 최종 후보 결정
- 테스트 개수 설계
- page별 QA 기준 판단
- 복잡한 modal/wizard/selection flow 해석

### Agent

Agent는 다음을 담당한다.

- route에 맞는 프로젝트 router/component 코드 탐색
- page component와 하위 component 분석
- field/control 후보 수집
- validation schema, default values, i18n, form state 분석
- Confluence 정책과 프로젝트 코드의 연결 판단
- input, dropdown, radio, switch, modal, table, wizard별 테스트 설계
- 성공/실패/경계/상호작용 케이스 도출
- 충분한 테스트 개수 판단
- `element-inventory.yaml` 작성
- `coverage-matrix.yaml` 작성
- `page-contract.yaml` 작성
- `automation-contract.yaml` 작성
- `coverage-ledger.md` 작성

## 전체 흐름

```text
사용자 prepare-agent 명령
  ↓
JS runner
  load_foundation
  resolve_target
  sync_confluence_tree
  normalize_confluence
  build_policy_units
  classify_policy_units
  build_policy_candidates
  build_agent_request
  ↓
Agent
  agent-request.md 읽기
  Confluence 정책 근거 읽기
  프로젝트 route/component 직접 탐색
  field/control 후보 직접 정리
  input case expansion 기반으로 테스트 케이스 설계
  agent-response 계약 작성
  ↓
사용자 continue 명령
  ↓
JS runner
  read_agent_response
  validate_contract
  build_run_plan
  generate_spec
  list_spec
  run_spec
  write_report
```

## prepare-agent 명령

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js prepare-agent \
  --route "/your/route/create" \
  --capability input \
  --confluence-root-page-id 2926936245
```

## Agent 작업 요청의 핵심 문구

Agent 요청서에는 다음 의무가 들어가야 한다.

```text
Read agent-request.md.
Read policy-candidates.yaml.
Read docs/common-tester/test-design/input-case-expansion.md.
Analyze the project route/component yourself.
Do not rely on JS runner for field/control discovery.
Write element-inventory.yaml analysis.filesInspected and analysis.completenessBasis.
List every discovered field/control in element-inventory.yaml.
Every discovered item must be accepted, rejected, blocked, or unresolved.
For input constraints, create success, failure, and boundary cases.
Do not produce sample-only tests.
Explain why the generated test count is sufficient in coverage-ledger.md.
```

## continue 명령

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js continue \
  --route "/your/route/create" \
  --capability input
```

## continue 검증 원칙

`continue`는 Agent가 만든 판단을 대신하지 않는다.

`continue`는 다음만 검증한다.

- 필수 파일이 모두 있는가
- `element-inventory.yaml`의 field가 `page-contract.yaml`에 연결되는가
- `coverage-matrix.yaml` row가 `automation-contract.yaml` case로 덮이는가
- `coverage-ledger.md`에 후보, 정책, case 근거가 남아 있는가
- `automation-contract.yaml`이 renderer가 지원하는 action/assertion만 쓰는가
- Playwright `--list` 결과가 run-plan과 일치하는가

테스트 수가 적은 경우 runner가 최종 테스트 수를 설계하지는 않는다.

다만 Confluence 정책에서 나온 `coverage.requiredIntents`는 최소 정책 하한으로 검증한다.

즉 모든 required intent가 최소 한 번 이상 실행 케이스로 덮여야 하며, 최종 테스트 폭은 Agent가 field/control inventory와 input expansion 기준으로 결정한다.

설명 없는 축소, sample-only 출력, 후보 누락은 실패로 본다.

## 성공 기준

성공한 공통테스터 흐름은 다음을 만족한다.

- Confluence 원문이 raw/normalized/policy candidate 형태로 남는다.
- Agent가 프로젝트 코드를 직접 근거로 읽고 analysis.filesInspected로 남긴다.
- Agent가 field/control 후보를 누락 없이 설명한다.
- 입력 테스트는 정상값만 넣지 않고 실패값과 경계값을 포함한다.
- 생성된 Playwright spec은 실제 실행된다.
- result report에는 테스트 수, 통과/실패, 누락/blocked/unresolved 항목이 남는다.
