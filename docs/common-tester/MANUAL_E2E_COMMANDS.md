# Common Tester Manual E2E Commands

This is the command sequence verified for Git Bash / MINGW64.

## 0. Start From Project Root

```bash
cd ~/Desktop/cmp3052-frontend
pwd
```

## 1. Install Foundation Files

Put the foundation zip under the project `docs/` directory first.

```bash
FOUNDATION_ZIP="docs/common-tester-agent-foundation.zip"

test -f "$FOUNDATION_ZIP" &&
unzip -o "$FOUNDATION_ZIP" -d . &&
test -f docs/common-tester/00-entry.md &&
test -f docs/tools/common-tester/runner.js &&
echo "foundation install OK"
```

Check installation:

```bash
ls docs/common-tester/00-entry.md
ls docs/common-tester/01-flow.yaml
ls docs/common-tester/taxonomy/input.yaml
ls docs/tools/common-tester/runner.js
ls docs/common-tester/fixtures/confluence/oc3-input-basic.json
```

## 2. Verify Runner With Fixture

Fixture means a local sample Confluence response for installation checking. It is not the real Confluence source.

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js prepare-agent \
  --route "/__install_check__" \
  --capability input \
  --confluence-fixture docs/common-tester/fixtures/confluence/oc3-input-basic.json
```

Check output:

```bash
ls docs/common-tester/runtime/targets/install-check
ls docs/common-tester/runtime/targets/install-check/policy-candidates.yaml
ls docs/common-tester/runtime/targets/install-check/agent-request.md
```

## 3. Prepare Real Target

Do not paste the Confluence token into the command line.
If these environment variables are not set, `prepare-agent` fails instead of silently using an old cache.

```bash
read -p "CONFLUENCE_EMAIL: " CONFLUENCE_EMAIL
read -s -p "CONFLUENCE_API_TOKEN: " CONFLUENCE_API_TOKEN
echo
export CONFLUENCE_EMAIL
export CONFLUENCE_API_TOKEN

MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js prepare-agent \
  --route "/your/route/create" \
  --capability input \
  --confluence-root-page-id 2926936245
```

The target directory can be created early by `resolve_target`.
Treat these files, not the directory itself, as the prepare success signal:

```bash
ls docs/common-tester/runtime/targets/your-route-create/policy-candidates.yaml
ls docs/common-tester/runtime/targets/your-route-create/policy-rules.yaml
ls docs/common-tester/runtime/targets/your-route-create/agent-request.md
ls docs/common-tester/runtime/targets/your-route-create/agent-output-contract.yaml
```

One-line success check:

```bash
test -f docs/common-tester/runtime/targets/your-route-create/policy-candidates.yaml &&
test -f docs/common-tester/runtime/targets/your-route-create/policy-rules.yaml &&
test -f docs/common-tester/runtime/targets/your-route-create/agent-request.md &&
test -f docs/common-tester/runtime/targets/your-route-create/agent-output-contract.yaml &&
echo "prepare-agent OK"
```

Confirm that real Confluence was used:

```bash
grep -n '"mode": "api"' docs/common-tester/runtime/cache/confluence/tree-index.json
grep -n '"hasEmail": true' docs/common-tester/runtime/cache/confluence/tree-index.json
grep -n '"hasToken": true' docs/common-tester/runtime/cache/confluence/tree-index.json
```

Only use cache intentionally:

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js prepare-agent \
  --route "/your/route/create" \
  --capability input \
  --confluence-root-page-id 2926936245 \
  --allow-confluence-cache true
```

If a directory like `c-program-files-git-monitoring-alarm-policy` appears, the command was run without `MSYS_NO_PATHCONV=1`.

After prepare is finished, clear Confluence credentials from the current shell:

```bash
unset CONFLUENCE_API_TOKEN
unset CONFLUENCE_EMAIL
```

## 4. Ask Agent To Create Agent Response

Ask Codex, Cursor, or Copilot:

```text
Read docs/common-tester/runtime/targets/your-route-create/agent-request.md.
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

Check required files:

```bash
ls docs/common-tester/runtime/targets/your-route-create/agent-response/element-inventory.yaml
ls docs/common-tester/runtime/targets/your-route-create/agent-response/coverage-matrix.yaml
ls docs/common-tester/runtime/targets/your-route-create/agent-response/coverage-ledger.md
ls docs/common-tester/runtime/targets/your-route-create/agent-response/common-policy.md
ls docs/common-tester/runtime/targets/your-route-create/agent-response/page-requirements.md
ls docs/common-tester/runtime/targets/your-route-create/agent-response/input-fields.md
ls docs/common-tester/runtime/targets/your-route-create/agent-response/acceptance-criteria.md
ls docs/common-tester/runtime/targets/your-route-create/agent-response/common-policy.yaml
ls docs/common-tester/runtime/targets/your-route-create/agent-response/page-contract.yaml
ls docs/common-tester/runtime/targets/your-route-create/agent-response/automation-contract.yaml
```

## 5. Generate Spec And Verify Test Count

```bash
MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js continue \
  --route "/your/route/create" \
  --capability input \
  --skip-playwright-run
```

Check generated files:

```bash
ls docs/common-tester/runtime/targets/your-route-create/page-contract.yaml
ls docs/common-tester/runtime/targets/your-route-create/automation-contract.yaml
ls docs/common-tester/runtime/targets/your-route-create/run-plan.json
ls docs/common-tester/runtime/targets/your-route-create/listed-tests.json
ls docs/common-tester/runtime/targets/your-route-create/generated/your-route-create.spec.ts
cat docs/common-tester/runtime/targets/your-route-create/listed-tests.json
```

`listed-tests.json` must show the same expected and listed test count.

## 6. Run Playwright

Do not paste the password into the command line.

```bash
if [ -z "${E2E_USERNAME:-}" ]; then read -p "E2E_USERNAME: " E2E_USERNAME; export E2E_USERNAME; fi
if [ -z "${E2E_PASSWORD:-}" ]; then read -s -p "E2E_PASSWORD: " E2E_PASSWORD; echo; export E2E_PASSWORD; fi

MSYS_NO_PATHCONV=1 node docs/tools/common-tester/runner.js continue \
  --route "/your/route/create" \
  --capability input
```

Check result:

```bash
cat docs/common-tester/runtime/targets/your-route-create/results/result.json
cat docs/common-tester/runtime/targets/your-route-create/results/result.md
```

After the run is finished, clear E2E credentials from the current shell:

```bash
unset E2E_PASSWORD
unset E2E_USERNAME
unset CONFLUENCE_API_TOKEN
unset CONFLUENCE_EMAIL
```

## 7. Watch The Generated Spec In Browser

```bash
./node_modules/.bin/playwright.CMD test \
  docs/common-tester/runtime/targets/your-route-create/generated/your-route-create.spec.ts \
  --config docs/common-tester/runtime/playwright.config.ts \
  --headed \
  --workers=1
```

Debug mode:

```bash
./node_modules/.bin/playwright.CMD test \
  docs/common-tester/runtime/targets/your-route-create/generated/your-route-create.spec.ts \
  --config docs/common-tester/runtime/playwright.config.ts \
  --debug \
  --workers=1
```
