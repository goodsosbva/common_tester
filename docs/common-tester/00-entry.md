# Common Tester Entry

Agent는 이 문서를 먼저 읽고 시작한다.

## 결론

테스트 코드는 Agent의 추측으로 만들지 않는다.

Confluence 공통정책을 rule 단위로 쪼개고, taxonomy로 성격을 분류한 뒤, Agent가 프로젝트 코드와 화면 구조를 직접 해석해 테스트 계약을 만든다.

JS runner는 테스트 설계자가 아니다.

JS runner는 Confluence raw 문서를 수집하고, Agent가 읽기 좋은 정책 근거와 작업 요청서를 만드는 역할까지만 맡는다.

route/component 분석, field/control 후보 판단, 테스트 케이스 충분성 판단은 Agent가 맡는다.

## 실행 원칙

1. `prepare-agent`는 테스트 코드를 만들지 않는다.
2. `prepare-agent`는 Confluence, taxonomy, policy candidates, agent request를 만든다.
3. Agent는 `agent-request.md`에 적힌 Confluence 정책 근거와 기반 문서를 읽고, 직접 프로젝트 route/component/field/control을 분석한다.
4. Agent는 분석한 field/control 후보를 accepted, rejected, blocked, unresolved 중 하나로 설명한다.
5. Agent는 공통 규칙을 capability별 성공값, 실패값, 경계값, 상태값, 선행조건 케이스 묶음으로 확장한 뒤 `agent-response` 계약을 작성한다.
6. `continue`는 계약 파일 형식, 근거 추적, 후보 누락 설명, Playwright 렌더링 가능 여부를 검증한다.
7. 근거 없는 테스트는 생성하지 않는다.

## Agent가 반드시 읽을 기반 문서

- `docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md`
- `docs/common-tester/test-design/policy-case-expansion.md`
- `docs/common-tester/test-design/input-case-expansion.md`
