// @ts-nocheck
const fs = require('node:fs');
const { resolveRoot } = require('../context');

async function loadFoundation(ctx) {
  const required = [
    'docs/common-tester/00-entry.md',
    'docs/common-tester/01-flow.yaml',
    'docs/common-tester/02-confluence.yaml',
    'docs/common-tester/03-artifacts.yaml',
    'docs/common-tester/04-project-scan.yaml',
    'docs/common-tester/05-playwright.yaml',
    'docs/common-tester/06-cache-policy.yaml',
    'docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md',
    'docs/common-tester/POLICY_TO_TEST_FLOW_PLAN.md',
    'docs/common-tester/capabilities/input/00-index.yaml',
    'docs/common-tester/capabilities/input/required.yaml',
    'docs/common-tester/capabilities/input/length.yaml',
    'docs/common-tester/capabilities/input/numeric.yaml',
    'docs/common-tester/capabilities/input/allowed-characters.yaml',
    'docs/common-tester/capabilities/input/validation-feedback.yaml',
    'docs/common-tester/policy-extraction/00-index.yaml',
    'docs/common-tester/policy-extraction/input.yaml',
    'docs/common-tester/test-design/input-case-expansion.md',
    'docs/common-tester/taxonomy/00-index.yaml',
    'docs/common-tester/taxonomy/input.yaml',
    'docs/common-tester/schemas/common-policy.schema.yaml',
    'docs/common-tester/schemas/policy-candidates.schema.yaml',
    'docs/common-tester/schemas/policy-rules.schema.yaml',
    'docs/common-tester/schemas/element-inventory.schema.yaml',
    'docs/common-tester/schemas/coverage-matrix.schema.yaml',
    'docs/common-tester/schemas/field-constraint-inventory.schema.yaml',
    'docs/common-tester/schemas/test-expansion-plan.schema.yaml',
    'docs/common-tester/schemas/page-contract.schema.yaml',
    'docs/common-tester/schemas/automation-contract.schema.yaml',
    'docs/tools/common-tester/runner.js',
    'docs/tools/common-tester/runner.ts',
    'docs/tools/common-tester/registry.ts',
    'docs/tools/common-tester/context.ts',
    'docs/tools/common-tester/operators/load-foundation.ts',
    'docs/tools/common-tester/operators/resolve-target.ts',
    'docs/tools/common-tester/operators/sync-confluence-tree.ts',
    'docs/tools/common-tester/operators/normalize-confluence.ts',
    'docs/tools/common-tester/operators/build-policy-units.ts',
    'docs/tools/common-tester/operators/classify-policy-units.ts',
    'docs/tools/common-tester/operators/extract-policy-rules.ts',
    'docs/tools/common-tester/operators/scan-project.ts',
    'docs/tools/common-tester/operators/build-policy-candidates.ts',
    'docs/tools/common-tester/operators/build-agent-request.ts',
    'docs/tools/common-tester/operators/read-agent-response.ts',
    'docs/tools/common-tester/operators/validate-contract.ts',
    'docs/tools/common-tester/operators/build-run-plan.ts',
    'docs/tools/common-tester/operators/generate-spec.ts',
    'docs/tools/common-tester/operators/audit-generated-spec.ts',
    'docs/tools/common-tester/operators/list-spec.ts',
    'docs/tools/common-tester/operators/run-spec.ts',
    'docs/tools/common-tester/operators/write-report.ts',
    'docs/tools/common-tester/operators/print-summary.ts',
    'docs/tools/common-tester/renderer/playwright-auth-renderer.js',
    'docs/tools/common-tester/renderer/playwright-renderer.js',
    'docs/tools/common-tester/renderer/selector-renderer.js',
  ];
  const missing = required.filter((file) => !fs.existsSync(resolveRoot(ctx.rootDir, file)));
  if (missing.length) {
    return {
      status: 'failed',
      message: `Missing foundation files: ${missing.join(', ')}`,
    };
  }

  return {
    status: 'ok',
    files: required,
  };
}

module.exports = { loadFoundation };
