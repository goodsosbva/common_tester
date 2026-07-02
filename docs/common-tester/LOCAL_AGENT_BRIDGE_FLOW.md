# Local Agent Bridge Flow

## Premise

Common Tester is not a one-command fully automatic agent.

The runner collects source data and executes deterministic steps. The agent reads the generated request and creates semantic artifacts.

```text
runner -> Confluence collection and policy candidates -> agent-request
user -> asks Codex/Cursor/Copilot to analyze project code and create agent-response
runner -> validates agent-response -> renders Playwright -> lists/runs tests
```

## Step 1. Prepare Agent Request

Run this from the project root.

Prefer environment variables for Confluence credentials. CLI arguments work, but shell history and process inspection can expose them.
If credentials are missing, the runner fails. It does not silently use an old cache for real Confluence runs.

Git Bash / MINGW64:

```bash
read -p "CONFLUENCE_EMAIL: " CONFLUENCE_EMAIL
read -s -p "CONFLUENCE_API_TOKEN: " CONFLUENCE_API_TOKEN
echo
export CONFLUENCE_EMAIL
export CONFLUENCE_API_TOKEN

MSYS_NO_PATHCONV=1 \
node docs/tools/common-tester/runner.js prepare-agent \
  --route "/monitoring/alarm/policy" \
  --capability input \
  --confluence-root-page-id 2926936245

unset CONFLUENCE_API_TOKEN
unset CONFLUENCE_EMAIL
```

Use cache only when you intentionally want to reuse an existing Confluence cache:

```bash
MSYS_NO_PATHCONV=1 \
node docs/tools/common-tester/runner.js prepare-agent \
  --route "/monitoring/alarm/policy" \
  --capability input \
  --confluence-root-page-id 2926936245 \
  --allow-confluence-cache true
```

For fixture verification:

```bash
MSYS_NO_PATHCONV=1 \
node docs/tools/common-tester/runner.js prepare-agent \
  --route "/monitoring/alarm/policy" \
  --capability input \
  --confluence-root-page-id 2926936245 \
  --confluence-fixture docs/common-tester/fixtures/confluence/oc3-input-basic.json
```

This creates:

```text
docs/common-tester/runtime/cache/confluence/tree-index.json
docs/common-tester/runtime/cache/confluence/raw/{pageId}.json
docs/common-tester/runtime/cache/confluence/normalized/{pageId}.md
docs/common-tester/runtime/cache/confluence/section-index.json
docs/common-tester/runtime/cache/confluence/policy-units.yaml
docs/common-tester/runtime/cache/confluence/policy-categories.yaml
docs/common-tester/runtime/targets/{targetId}/policy-candidates.yaml
docs/common-tester/runtime/targets/{targetId}/agent-request.md
docs/common-tester/runtime/targets/{targetId}/agent-output-contract.yaml
```

The runner stops with:

```text
status = waiting_for_agent
```

## Step 2. Ask An Agent

Ask Codex, Cursor, or Copilot:

```text
Read docs/common-tester/runtime/targets/{targetId}/agent-request.md.
Read docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md.
Read docs/common-tester/POLICY_TO_TEST_FLOW_PLAN.md.
Read docs/common-tester/test-design/input-case-expansion.md.
Create every required file listed in agent-output-contract.yaml under agent-response/.
Read policy-candidates.yaml before writing tests.
Analyze the project route/component yourself.
Do not rely on JS runner for field/control discovery.
Write element-inventory.yaml analysis.filesInspected and analysis.completenessBasis.
Every discovered field/control must include codeRefs pointing to inspected project source files.
Read policy-candidates.yaml coverage.minGeneratedCaseCount and coverage.requiredIntents.
Treat policy candidates as evidence, not as generated tests.
Generated tests must expand from actual page fields multiplied by applicable policy intents.
Create agent-response/element-inventory.yaml before writing page-contract.yaml.
Create agent-response/coverage-matrix.yaml before writing automation-contract.yaml.
element-inventory.yaml is the complete field inventory for list/create/edit/modal input-like fields in scope.
For create/edit wizard screens, element-inventory.yaml must include every step control, not only controls that input.fill can operate.
Controls unsupported by the current renderer must remain in element-inventory.yaml and coverage-matrix.yaml with generate:false and blockedReason.
coverage-matrix.yaml is the complete field x policy intent table.
For value-oriented input rows, coverage-matrix.yaml must include inputCases.success and/or inputCases.failure.
Every input-like field must have at least one success input case and one failure input case unless the row is generate:false with a blockedReason.
Every coverage-matrix.yaml row with generate:true must be covered by automation-contract.yaml cases[].coversMatrixRows.
Every declared input case must be covered by automation-contract.yaml cases[].coversInputCases.
Create coverage-ledger.md and list every generated case id and every generate:true matrix row id.
coverage-ledger.md must also list every success/failure inputId.
Generated case count must be at least coverage.minGeneratedCaseCount.
Every coverage.requiredIntents[].intent must appear in at least one generate:true case coversIntents.
Every generate:true case must include coversIntents.
page-contract.yaml must include every input-like field in the target scope, including fields inside create/edit modals or panels when the flow reaches them.
For every page-contract field, generate cases that cover the field's coverageIntents/applicableIntents.
If a textbox/textarea/number/combobox field has no coverageIntents/applicableIntents, apply all coverage.requiredIntents to that field.
Every generated case must cite candidateId from policy-candidates.yaml in sourceRefs.
page-contract.yaml sourceRefs must include pageId and titlePath.
automation-contract.yaml must include pageRef pointing to the generated page-contract.yaml.
Do not put selectors in automation-contract.yaml.
Use targetRef to reference page-contract.yaml elements.
```

The agent must create:

```text
docs/common-tester/runtime/targets/{targetId}/agent-response/common-policy.md
docs/common-tester/runtime/targets/{targetId}/agent-response/page-requirements.md
docs/common-tester/runtime/targets/{targetId}/agent-response/input-fields.md
docs/common-tester/runtime/targets/{targetId}/agent-response/acceptance-criteria.md
docs/common-tester/runtime/targets/{targetId}/agent-response/common-policy.yaml
docs/common-tester/runtime/targets/{targetId}/agent-response/page-contract.yaml
docs/common-tester/runtime/targets/{targetId}/agent-response/automation-contract.yaml
```

## Step 3. Continue

For contract/spec/list/report verification without launching Playwright:

Git Bash / MINGW64:

```bash
MSYS_NO_PATHCONV=1 \
node docs/tools/common-tester/runner.js continue \
  --route "/monitoring/alarm/policy" \
  --skip-playwright-run true
```

For actual Playwright execution:

Git Bash / MINGW64:

```bash
if [ -z "${E2E_USERNAME:-}" ]; then read -p "E2E_USERNAME: " E2E_USERNAME; export E2E_USERNAME; fi
if [ -z "${E2E_PASSWORD:-}" ]; then read -s -p "E2E_PASSWORD: " E2E_PASSWORD; echo; export E2E_PASSWORD; fi

MSYS_NO_PATHCONV=1 \
node docs/tools/common-tester/runner.js continue \
  --route "/monitoring/alarm/policy"

unset E2E_PASSWORD
unset E2E_USERNAME
```

This creates:

```text
docs/common-tester/runtime/targets/{targetId}/common-policy.yaml
docs/common-tester/runtime/targets/{targetId}/page-contract.yaml
docs/common-tester/runtime/targets/{targetId}/automation-contract.yaml
docs/common-tester/runtime/targets/{targetId}/run-plan.json
docs/common-tester/runtime/targets/{targetId}/generated/{targetId}.spec.ts
docs/common-tester/runtime/targets/{targetId}/listed-tests.json
docs/common-tester/runtime/targets/{targetId}/results/result.json
docs/common-tester/runtime/targets/{targetId}/results/result.md
```

Check these values after `continue --skip-playwright-run`:

```text
listed-tests.json
  status = passed
  expectedExecutableCaseCount = listedCaseCount

results/result.json
  status = skipped
  reason = Skipped by --skip-playwright-run.

results/result.md
  contract validation = ok
  listed tests = executable cases
  run status = skipped
```

## Failure Guarantees

- Missing `agent-output-contract.yaml` fails and asks to run `prepare-agent`.
- Missing agent-response files fail before spec generation.
- Invalid `targetRef` fails before spec generation.
- Raw selectors inside `automation-contract.yaml` fail before spec generation.
- Playwright list count must match `run-plan.json`.
- Auth-required tests fail early when `E2E_USERNAME/E2E_PASSWORD` are missing.
- Git Bash / MINGW64 commands must use `MSYS_NO_PATHCONV=1`; otherwise `/monitoring/alarm/policy` can be converted into a Windows path.

## Runtime Safety

- `docs/common-tester/runtime` is generated output.
- Do not commit or share `runtime` contents.
- Prefer credential environment variables over CLI credential arguments.
- Do not use inline credential commands such as `E2E_PASSWORD="<password>" node ...`.
- Clear credential environment variables with `unset` after each run.
- If CLI credential arguments are used, clear shell history according to the local security policy.
- Actual Playwright runs may create screenshots, traces, videos, storage state, or localStorage artifacts.
- Treat `runtime/.auth`, `runtime/**/test-results`, and `runtime/**/playwright-report` as sensitive local artifacts.
