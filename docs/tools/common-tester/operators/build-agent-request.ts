// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const {
  readJson,
  readText,
  readYaml,
  resolveRoot,
  toPosix,
  writeJson,
  writeText,
  writeYaml,
} = require('../context');

function listNormalizedFiles(ctx) {
  const dir = resolveRoot(ctx.rootDir, ctx.paths.confluenceNormalizedDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => `${ctx.paths.confluenceNormalizedDir}/${file}`);
}

function requestCapabilityFile(capability) {
  return `${capability || 'input'}.yaml`;
}

function findAgentInstructionFiles(rootDir) {
  const skipDirs = new Set([
    '.git',
    '.nx',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'playwright-report',
    'test-results',
  ]);
  const results = [];

  function visit(dir) {
    if (results.length >= 20) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        const relativeDir = toPosix(path.relative(rootDir, path.join(dir, entry.name)));
        if (relativeDir.startsWith('docs/common-tester/runtime')) continue;
        visit(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase() === 'agents.md') {
        const fullPath = path.join(dir, entry.name);
        results.push({
          path: toPosix(path.relative(rootDir, fullPath)),
          content: fs.readFileSync(fullPath, 'utf8').slice(0, 20000),
        });
      }
    }
  }

  visit(rootDir);
  return results;
}

async function buildAgentRequest(ctx) {
  const normalizedFiles = listNormalizedFiles(ctx);
  const agentInstructions = findAgentInstructionFiles(ctx.rootDir);
  const policyCandidates = fs.existsSync(resolveRoot(ctx.rootDir, ctx.paths.policyCandidates))
    ? readYaml(ctx.rootDir, ctx.paths.policyCandidates)
    : null;
  const hasPolicyCandidates = (policyCandidates?.candidateCount || 0) > 0;
  const requiredIntents = (policyCandidates?.coverage?.requiredIntents || [])
    .map((item) => item.intent)
    .filter(Boolean);
  const hasProjectModel = fs.existsSync(resolveRoot(ctx.rootDir, ctx.paths.projectModel));
  const hasProjectEvidence = fs.existsSync(resolveRoot(ctx.rootDir, ctx.paths.projectEvidence));
  const outputContract = {
    schemaVersion: 1,
    kind: 'agent-output-contract',
    targetId: ctx.target.targetId,
    requiredFiles: [
      ctx.paths.agentResponseElementInventory,
      ctx.paths.agentResponseCoverageMatrix,
      ctx.paths.agentResponseCommonPolicyMarkdown,
      ctx.paths.agentResponsePageRequirementsMarkdown,
      ctx.paths.agentResponseInputFieldsMarkdown,
      ctx.paths.agentResponseAcceptanceCriteriaMarkdown,
      ctx.paths.agentResponseCoverageLedgerMarkdown,
      ctx.paths.agentResponseFieldConstraintInventory,
      ctx.paths.agentResponseTestExpansionPlan,
      ctx.paths.agentResponseCommonPolicyYaml,
      ctx.paths.agentResponsePageContract,
      ctx.paths.agentResponseAutomationContract,
    ],
    schemas: {
      pageContract: 'docs/common-tester/schemas/page-contract.schema.yaml',
      automationContract: 'docs/common-tester/schemas/automation-contract.schema.yaml',
      elementInventory: 'docs/common-tester/schemas/element-inventory.schema.yaml',
      coverageMatrix: 'docs/common-tester/schemas/coverage-matrix.schema.yaml',
      policyRules: 'docs/common-tester/schemas/policy-rules.schema.yaml',
      fieldConstraintInventory: 'docs/common-tester/schemas/field-constraint-inventory.schema.yaml',
      testExpansionPlan: 'docs/common-tester/schemas/test-expansion-plan.schema.yaml',
    },
    rules: [
      'All generated contract entries must include sourceRefs.',
      'page-contract.yaml sourceRefs must include pageId and titlePath.',
      'Agent owns project route/component analysis. Do not wait for JS runner to discover fields.',
      'Agent must inspect the target route/component code directly and document the files it used.',
      'element-inventory.yaml must include analysis.filesInspected and analysis.completenessBasis before fields.',
      'Every element-inventory.yaml field must include codeRefs pointing to the project files the Agent inspected.',
      'page-contract.yaml must include every input-like field the Agent finds in the target scope, including fields inside create/edit modals or panels when the requested page flow reaches them.',
      'element-inventory.yaml must not be limited to fields that are immediately reachable without clicks.',
      'For wizard/create/edit flows, Agent must inspect every step component, form constants, and validation schema; include every rendered form control in element-inventory.yaml.',
      'Do not shrink wizard/create/edit coverage to only immediately visible fields to make validation pass. If later-step text inputs are source-discovered but unreachable because required dynamic data is unavailable, record that evidence and leave the contract unresolved instead of producing false partial success.',
      'Textbox, textarea, number, and combobox fields must not be hidden behind blockedReason. Agent must add executable prerequisite steps/openFlow or leave the contract failing as unresolved.',
      'Do not exclude radio, combobox, checkbox, switch, date, modal, drawer, readonly picker, or disabled dependent controls from element-inventory just because input.fill cannot operate them.',
      'When a control needs navigation, use page-contract.yaml buttons plus automation actions button.click/control.click where possible.',
      'When a required dropdown has dynamic options and the first enabled option is acceptable, model it with dropdown.selectFirst instead of hardcoding option text.',
      'Before using dropdown.selectFirst, button.click, or control.click in automation-contract.yaml, prove from project code or observed UI flow that the target is visible and enabled after the preceding steps.',
      'If a field/control is disabled until another field, tab, resource, metric, modal choice, wizard step, or radio mode is selected, automation-contract.yaml must put those enabling prerequisite steps before the disabled-dependent control.',
      'Do not create repeated tests that click the same disabled dependent control directly. Model the enabling path once as shared setup steps, or mark the contract unresolved with evidence so validate_contract fails.',
      'automation-contract.yaml case title must be a concrete behavior sentence: include the target field/control, the input/action, submit/click step when relevant, and the expected validation/result. Do not use vague titles like "required empty check"; use titles like "임계값 인풋값을 비우고 저장 클릭 후 필수 입력 문구가 표시되는지 확인".',
      'page-contract.yaml field selectors must be field-scoped and unique. Do not use generic selectors such as input, input:not([readonly]), textarea, select, .ant-select, .ant-input, .ant-input-number, or .ant-input-number input for fields.',
      'Each page-contract field may include coverageIntents/applicableIntents. If omitted for textbox/textarea/number/combobox, all coverage.requiredIntents apply.',
      'automation-contract.yaml must include pageRef pointing to the generated page-contract.yaml.',
      'Authentication is owned by the foundation Playwright runtime. Agent must not add login page fields, login button clicks, or credential input steps to page-contract.yaml or automation-contract.yaml.',
      'Generated automation should start from the requested target route with page.goto. The renderer will create and reuse Playwright storageState for E2E_USERNAME/E2E_PASSWORD.',
      'Read policy-candidates.yaml before writing any test contract.',
      'Read policy-rules.yaml before writing field constraints. policy-rules.yaml converts plain reference policy text into structured params such as minLength, maxLength, maxDecimals, required, and allowedCharacters.',
      'Read docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md before analyzing project code.',
      'Read docs/common-tester/test-design/policy-case-expansion.md before designing any test cases. This guide applies to every capability, not only input.',
      'Read docs/common-tester/capabilities/input/00-index.yaml and every referenced input capability file before designing input tests.',
      'Read docs/common-tester/policy-extraction/00-index.yaml and the matching capability file before mapping policies to fields.',
      'Read docs/common-tester/test-design/input-case-expansion.md before designing input cases.',
      'Read policy-candidates.yaml coverage.minGeneratedCaseCount and coverage.requiredIntents.',
      'Read the Non-Negotiable Coverage Contract in agent-request.md.',
      'Every common policy rule must expand by capability case patterns, not by one sample, subjective judgement, or whatever is easiest to render.',
      'Input, selection, table/list, modal/drawer, action/submit, state, and permission rules all require success/failure/boundary/state/prerequisite coverage where applicable.',
      'Input constraints must expand by capability requiredCases, not by sample count or subjective judgement.',
      'Every test-expansion-plan.yaml case generated from a capability requiredCase must include caseType equal to that requiredCase id.',
      'For length.range constraints, create below-min, at-min, inside-range, at-max, and above-max cases.',
      'Project validation helper defaults count as real constraints. For example, if createTextLengthSchema defaults to min=2/max=30 and the field does not override max, generate boundary cases for 1, 2, inside, 30, and 31 characters.',
      'If reference/common policy and project validation disagree, record the mismatch in coverage-ledger.md and use project-code evidence for the executable expectation; do not silently test only the narrower sample set.',
      'For required constraints, create empty, whitespace-only, and valid-non-empty cases.',
      'For alphabet-only/allowed-character constraints, create alphabet-success, korean-fail, number-fail, and special-character-fail cases when applicable.',
      'For generic allowedCharacters constraints, create one allowed-{group}-success case per allowed character group and one disallowed-sample-fail case.',
      'For decimal precision constraints, create integer-success, decimal-at-max-success, decimal-over-max-fail, and non-numeric-fail cases.',
      'All constraints must expand into success, failure, boundary, state, and prerequisite cases where evidence exists; input is only one example of this rule.',
      'If no dedicated capability catalog exists yet for a non-input rule, apply docs/common-tester/test-design/policy-case-expansion.md and record concrete caseTypes in test-expansion-plan.yaml.',
      'Agent must create field-constraint-inventory.yaml before page-contract.yaml is finalized.',
      'Agent must create test-expansion-plan.yaml before automation-contract.yaml is written.',
      'Every policy-derived field constraint must cite policy-rules.yaml ruleId.',
      'Every project-derived field constraint must cite project schema/code sourceRefs.',
      'Every applicable constraint must create success and failure partitions in test-expansion-plan.yaml unless explicitly blocked with evidence.',
      'automation-contract.yaml cases generated from test-expansion-plan.yaml must include coversExpansionCases.',
      'automation-contract.yaml generate:true case count must be at least test-expansion-plan.yaml expectedExecutableCaseCountMin.',
      'Do not lower test-expansion-plan.yaml expectedExecutableCaseCountMin to make validation pass. validate_contract recalculates a minimum from field-constraint-inventory.yaml.',
      'automation-contract.yaml expect.value assertions must use the key value. Do not use expected for expect.value.',
      'Failure cases must prove failure with validation-message visibility, value rejection/normalization, or submit/next blocking. A failing input case cannot only assert that the invalid value is retained.',
      'If a policy says 2-20 characters, include below-min, at-min, valid-inside, at-max, and above-max ideas unless blocked.',
      'coverage-ledger.md must map every required intent or matrix row to generated case ids and targetRefs.',
      'element-inventory.yaml must list every input-like field in scope before page-contract.yaml is written.',
      'element-inventory.yaml analysis.filesInspected must cite route/component/form/validation files used to prove inventory completeness.',
      'element-inventory.yaml must prove project-code analysis with codeRefs for every field/control.',
      'coverage-matrix.yaml must expand element-inventory fields by applicable policy intent before automation-contract.yaml is written.',
      'coverage-matrix.yaml must declare inputCases.success and inputCases.failure for value-oriented input rows.',
      'Every coverage-matrix.yaml row with generate:true must be referenced by automation-contract.yaml cases[].coversMatrixRows.',
      'Every coverage-matrix.yaml inputCases item must be referenced by automation-contract.yaml cases[].coversInputCases.',
      'Every test-expansion-plan.yaml generate:true case must be referenced by automation-contract.yaml cases[].coversExpansionCases.',
      'automation-contract.yaml cases must include coversIntents for generate:true cases.',
      'Generated cases must cover every coverage.requiredIntents[].intent at least once.',
      'Generated cases must cover required coverage intents for every page-contract field they apply to.',
      'Generated case count must be at least coverage.minGeneratedCaseCount.',
      hasPolicyCandidates
        ? 'Every generated case must cite candidateId from policy-candidates.yaml in sourceRefs.'
        : 'policy-candidates.yaml has no candidates. Do not invent candidateId or unresolved-policy-candidate. Use normalized reference docs, policy-rules.yaml, and project sourceRefs; still generate executable coverage from field constraints.',
      'automation-contract.yaml must not contain raw selectors.',
      'automation-contract.yaml must use targetRef to refer to page-contract.yaml elements.',
      'automation-contract.yaml must not model login as a test flow. Login is a fixed precondition handled before generated test steps run.',
      'Generated input cases must include input.fill and expect.value.',
      'If evidence is insufficient for an input-like field, do not produce a false-success contract. Leave the gap explicit so validate_contract fails.',
      'blockedReason is allowed for unsupported non-input controls only; it is not a way to skip input-like fields.',
    ],
    coverageGate: {
      minGeneratedCaseCount: policyCandidates?.coverage?.minGeneratedCaseCount || 0,
      requiredIntents,
      requireCoverageLedger: true,
      requireElementInventory: true,
      requireCoverageMatrix: true,
      requireSuccessFailureInputCases: true,
      requireCandidateIntentMatch: hasPolicyCandidates,
      requireEveryInScopeFieldCovered: true,
      requirePolicyRules: true,
      requireFieldConstraintInventory: true,
      requireTestExpansionPlan: true,
    },
  };

  const request = {
    schemaVersion: 1,
    kind: 'agent-request',
    target: ctx.target,
    capability: ctx.command.capability || 'input',
    agentInstructions,
    foundationFiles: [
      'docs/common-tester/00-entry.md',
      'docs/common-tester/AGENTS.md',
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
      `docs/common-tester/policy-extraction/${requestCapabilityFile(ctx.command.capability || 'input')}`,
      'docs/common-tester/test-design/input-case-expansion.md',
      'docs/common-tester/taxonomy/00-index.yaml',
      `docs/common-tester/taxonomy/${requestCapabilityFile(ctx.command.capability || 'input')}`,
      outputContract.schemas.elementInventory,
      outputContract.schemas.coverageMatrix,
      outputContract.schemas.policyRules,
      outputContract.schemas.fieldConstraintInventory,
      outputContract.schemas.testExpansionPlan,
    ],
    inputs: {
      confluenceTreeIndex: ctx.paths.confluenceTreeIndex,
      confluenceSectionIndex: ctx.paths.confluenceSectionIndex,
      confluencePolicyUnits: ctx.paths.confluencePolicyUnits,
      confluencePolicyCategories: ctx.paths.confluencePolicyCategories,
      confluencePolicyRules: ctx.paths.policyRules,
      normalizedFiles,
      policyCandidates: ctx.paths.policyCandidates,
      optionalProjectModel: hasProjectModel ? ctx.paths.projectModel : null,
      optionalProjectEvidence: hasProjectEvidence ? ctx.paths.projectEvidence : null,
      pageContractSchema: outputContract.schemas.pageContract,
      automationContractSchema: outputContract.schemas.automationContract,
      elementInventorySchema: outputContract.schemas.elementInventory,
      coverageMatrixSchema: outputContract.schemas.coverageMatrix,
      policyRulesSchema: outputContract.schemas.policyRules,
      fieldConstraintInventorySchema: outputContract.schemas.fieldConstraintInventory,
      testExpansionPlanSchema: outputContract.schemas.testExpansionPlan,
      outputContract: ctx.paths.agentOutputContract,
    },
    outputs: outputContract.requiredFiles,
  };

  const md = [
    `# Common Tester Agent Request: ${ctx.target.targetId}`,
    '',
    '## Target',
    '',
    `- route: ${ctx.target.route || '(none)'}`,
    `- capability: ${request.capability}`,
    '',
    '## What You Must Read',
    '',
    ...agentInstructions.map((file) => `- ${file.path} (AGENTS.md instructions included below)`),
    ...request.foundationFiles.map((file) => `- ${file}`),
    `- ${ctx.paths.confluenceTreeIndex}`,
    `- ${ctx.paths.confluenceSectionIndex}`,
    `- ${ctx.paths.confluencePolicyUnits}`,
    `- ${ctx.paths.confluencePolicyCategories}`,
    `- ${ctx.paths.policyRules}`,
    `- ${ctx.paths.policyCandidates}`,
    ...normalizedFiles.map((file) => `- ${file}`),
    ...(hasProjectModel ? [`- ${ctx.paths.projectModel} (optional runner hint only)`] : []),
    ...(hasProjectEvidence ? [`- ${ctx.paths.projectEvidence} (optional runner hint only)`] : []),
    `- ${outputContract.schemas.pageContract}`,
    `- ${outputContract.schemas.automationContract}`,
    `- ${outputContract.schemas.policyRules}`,
    `- ${outputContract.schemas.fieldConstraintInventory}`,
    `- ${outputContract.schemas.testExpansionPlan}`,
    `- ${ctx.paths.agentOutputContract}`,
    '',
    '## Effective AGENTS.md Instructions',
    '',
    ...(agentInstructions.length
      ? agentInstructions.flatMap((file) => [
          `### ${file.path}`,
          '',
          '```md',
          file.content,
          '```',
          '',
        ])
      : ['- No AGENTS.md files found.', '']),
    '## What You Must Create',
    '',
    ...outputContract.requiredFiles.map((file) => `- ${file}`),
    '',
    '## Agent Work Order',
    '',
    'Follow this order. Do not skip project analysis.',
    '',
    '1. Read the normalized reference documents, policy-rules.yaml, and policy-candidates.yaml.',
    '2. Read docs/common-tester/AGENT_CENTRIC_FLOW_PLAN.md.',
    '3. Read docs/common-tester/capabilities/input/00-index.yaml, every input capability file it references, docs/common-tester/policy-extraction/00-index.yaml, and docs/common-tester/test-design/input-case-expansion.md.',
    '4. Analyze the project route/component yourself from the current repository.',
    '5. Do not rely on JS runner for route/component/field/control discovery.',
    '6. List every discovered field/control in element-inventory.yaml with codeRefs.',
    '7. Convert policy-rules.yaml plus project schema/code evidence into field-constraint-inventory.yaml.',
    '8. Write element-inventory.yaml analysis.filesInspected and analysis.completenessBasis.',
    '9. Expand every applicable field constraint into capability requiredCases in test-expansion-plan.yaml, and write caseType for each generated case.',
    '10. Expand input constraints into coverage-matrix.yaml success/failure inputCases.',
    '11. Identify enablement dependencies for disabled/dependent controls and record the required prerequisite path in page-contract.yaml / automation-contract.yaml setup steps.',
    '12. Create coverage-matrix.yaml before automation-contract.yaml.',
    '13. Cover every generate:true matrix row, inputCase, and expansion case from automation-contract.yaml.',
    '14. Explain why the generated test set is sufficient in coverage-ledger.md.',
    '',
    '## Contract Rules',
    '',
    ...outputContract.rules.map((rule) => `- ${rule}`),
    '',
    '## Non-Negotiable Coverage Contract',
    '',
    'You are not writing examples. You are writing the complete agent-response contract.',
    '',
    `- candidateCount: ${policyCandidates?.candidateCount ?? '(unknown)'}`,
    `- minGeneratedCaseCount: ${policyCandidates?.coverage?.minGeneratedCaseCount ?? '(unknown)'}`,
    hasPolicyCandidates
      ? '- policy candidate mode: candidateId and candidate-backed coversIntents are required'
      : '- policy candidate mode: no candidates selected; candidateId is optional and must not be invented. Use project-derived coversIntents and sourceRefs.',
    '- requiredIntents:',
    ...(requiredIntents.length ? requiredIntents.map((intent) => `  - ${intent}`) : ['  - (unknown)']),
    '',
    'automation-contract.yaml is invalid unless:',
    '',
    '1. generate:true case count >= minGeneratedCaseCount',
    '2. every requiredIntent appears in at least one generate:true case coversIntents',
    hasPolicyCandidates
      ? '3. every generate:true case has sourceRefs[].candidateId'
      : '3. every generate:true case has sourceRefs from normalized reference docs, policy-rules.yaml, or project code',
    hasPolicyCandidates
      ? '4. every candidateId exists in policy-candidates.yaml candidates'
      : '4. candidateId is not required when policy-candidates.yaml candidateCount is 0',
    hasPolicyCandidates
      ? '5. every coversIntents value is backed by at least one cited candidateId whose suggestedTestIntents contains that intent'
      : '5. coversIntents may be project-derived stable intent ids from field constraints and test-expansion-plan caseType',
    '6. every input-like field in scope appears in page-contract.yaml',
    '7. Agent must inspect the project route/component code and element-inventory.yaml lists every list/create/edit/modal/wizard form control in the target flow, not only fields currently supported by input.fill',
    '7-1. every element-inventory field/control must include codeRefs for inspected project files',
    '7-2. element-inventory analysis.filesInspected must list route/component/form/validation files and analysis.completenessBasis must explain inventory completeness',
    '7-3. page-contract field selectors must be field-scoped and unique; generic field selectors such as input:not([readonly]) and .ant-select are forbidden',
    '8. coverage-matrix.yaml contains one row for each applicable field-intent pair',
    '9. value-oriented coverage-matrix rows declare concrete success/failure inputCases',
    '10. every coverage-matrix generate:true row appears in at least one generated case coversMatrixRows',
    '11. every declared inputCases item appears in at least one generated case coversInputCases',
    '12. field-constraint-inventory.yaml maps every input-like element to policy/project constraints',
    '13. test-expansion-plan.yaml expands every applicable constraint into executable capability requiredCases, including caseType for each case',
    '14. every generated expansion case appears in at least one automation-contract.yaml coversExpansionCases entry',
    '15. automation-contract.yaml generate:true case count is >= test-expansion-plan.yaml expectedExecutableCaseCountMin',
    '16. every in-scope input-like field is touched by generated cases covering all applicable requiredIntents',
    '16-1. textbox, textarea, number, and combobox fields cannot be skipped with blockedReason',
    '16-2. if reaching an input-like field requires wizard navigation, modal opening, prior selection, or prerequisite data, Agent must model that path with page-contract controls and automation steps',
    '16-3. if that path cannot be modeled yet, the contract must fail validation instead of pretending coverage is sufficient',
    '16-4. generated steps must not click disabled dependent controls before their enabling prerequisites; this creates timeout-only failures, not useful E2E coverage',
    '17. each generated case title must be concrete enough to understand from Playwright console output alone: field/control + input/action + submit/click + expected result',
    '18. partial/sample output is forbidden',
    '19. coverage-ledger.md must show intent, matrix-row, inputId, expansion case, and generated test coverage before you finish',
    '20. every common policy rule must be expanded using docs/common-tester/test-design/policy-case-expansion.md; input constraints additionally use docs/common-tester/capabilities/input/*.yaml and docs/common-tester/test-design/input-case-expansion.md',
    '21. non-input policies such as selection, table/list, modal/drawer, action/submit, disabled/no-data, and permission states must not be collapsed into a single happy-path click',
    '22. automation-contract.yaml expect.value assertions must use value, and rendered values must match the test-expansion-plan case value',
    '',
    '## Renderer Contract Summary',
    '',
    '- page-contract.yaml owns selectors and elements.',
    '- automation-contract.yaml owns test intent and references elements by targetRef.',
    '- renderer input is page-contract.yaml + automation-contract.yaml.',
    '- policy-candidates.yaml is the bridge from reference common policy to concrete test intent.',
    '- policy-rules.yaml is the bridge from reference plain text to structured values such as maxDecimals: 2.',
    '- field-constraint-inventory.yaml maps those structured rules to actual route fields using project evidence.',
    '- docs/common-tester/capabilities/input/*.yaml defines the mandatory caseType catalog for each input constraint type.',
    '- docs/common-tester/test-design/policy-case-expansion.md defines the generic expansion contract for every common policy rule, including non-input capabilities.',
    '- test-expansion-plan.yaml turns each mapped constraint into concrete capability caseTypes, success/failure/boundary partitions, and literal values.',
    '- coverage.requiredIntents gives reference-backed policy breadth; it does not replace Agent judgment.',
    '- Agent decides the field breadth of generated tests by inspecting project route/component code.',
    '- coverage-matrix.yaml records the Agent-selected field-intent rows.',
    '- coverage-matrix.yaml also owns success/failure input datasets for value-oriented rows.',
    '- Unsupported non-input controls stay visible in element-inventory and coverage-matrix with generate:false plus blockedReason; they must not be silently omitted.',
    '- Input-like fields do not get blocked silently. They either receive executable coverage or make validate_contract fail.',
    '',
  ].join('\n');

  writeYaml(ctx.rootDir, ctx.paths.agentOutputContract, outputContract);
  writeJson(ctx.rootDir, ctx.paths.agentRequestJson, request);
  writeText(ctx.rootDir, ctx.paths.agentRequestMarkdown, md);

  return {
    status: 'waiting_for_agent',
    requestFile: ctx.paths.agentRequestMarkdown,
    outputContract: ctx.paths.agentOutputContract,
    nextCommand: `Ask an agent to create ${ctx.paths.agentResponseDir}, then run: node docs/tools/common-tester/runner.js continue --route "${ctx.target.route || ''}"`,
  };
}

module.exports = { buildAgentRequest };
