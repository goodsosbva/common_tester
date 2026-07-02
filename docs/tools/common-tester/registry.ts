// @ts-nocheck
const { resolveTarget } = require('./operators/resolve-target');
const { scanProject } = require('./operators/scan-project');
const { syncConfluence } = require('./operators/sync-confluence');
const { loadFoundation } = require('./operators/load-foundation');
const { syncConfluenceTree } = require('./operators/sync-confluence-tree');
const { normalizeConfluence } = require('./operators/normalize-confluence');
const { buildPolicyUnits } = require('./operators/build-policy-units');
const { classifyPolicyUnits } = require('./operators/classify-policy-units');
const { extractPolicyRules } = require('./operators/extract-policy-rules');
const { buildPolicyCandidates } = require('./operators/build-policy-candidates');
const { buildAgentRequest } = require('./operators/build-agent-request');
const { readAgentResponse } = require('./operators/read-agent-response');
const { validateContract } = require('./operators/validate-contract');
const { buildRunPlan } = require('./operators/build-run-plan');
const { generateSpec } = require('./operators/generate-spec');
const { auditGeneratedSpec } = require('./operators/audit-generated-spec');
const { listSpec } = require('./operators/list-spec');
const { verifyRuntime } = require('./operators/verify-runtime');
const { decideReuse } = require('./operators/decide-reuse');
const { buildDocs } = require('./operators/build-docs');
const { writeSpecDraft } = require('./operators/write-spec-draft');
const { verifyMcp } = require('./operators/verify-mcp');
const { refineSpec } = require('./operators/refine-spec');
const { runSpec } = require('./operators/run-spec');
const { writeReport } = require('./operators/write-report');
const { printSummary } = require('./operators/print-summary');

const registry = {
  load_foundation: loadFoundation,
  resolve_target: resolveTarget,
  scan_project: scanProject,
  sync_confluence: syncConfluence,
  sync_confluence_tree: syncConfluenceTree,
  normalize_confluence: normalizeConfluence,
  build_policy_units: buildPolicyUnits,
  classify_policy_units: classifyPolicyUnits,
  extract_policy_rules: extractPolicyRules,
  build_policy_candidates: buildPolicyCandidates,
  build_agent_request: buildAgentRequest,
  read_agent_response: readAgentResponse,
  validate_contract: validateContract,
  build_run_plan: buildRunPlan,
  generate_spec: generateSpec,
  audit_generated_spec: auditGeneratedSpec,
  list_spec: listSpec,
  verify_runtime: verifyRuntime,
  decide_reuse: decideReuse,
  build_docs: buildDocs,
  write_spec_draft: writeSpecDraft,
  verify_mcp: verifyMcp,
  refine_spec: refineSpec,
  run_spec: runSpec,
  write_report: writeReport,
  print_summary: printSummary,
};

module.exports = { registry };
