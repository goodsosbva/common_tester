// @ts-nocheck
const fs = require('node:fs');
const {
  readText,
  readYaml,
  resolveRoot,
  writeText,
} = require('../context');

const SUPPORTED_ACTIONS = new Set([
  'page.goto',
  'input.fill',
  'input.clear',
  'input.press',
  'button.click',
  'control.click',
  'dropdown.selectFirst',
]);
const SUPPORTED_ASSERTIONS = new Set(['expect.value', 'expect.visible', 'expect.enabled', 'expect.textVisible', 'expect.textMatches', 'expect.textHidden']);
const TEXT_FIELD_CONTROLS = new Set(['textbox', 'textarea', 'number']);
const SUCCESS_INPUT_INTENTS = new Set(['allowed-character-fixtures', 'boundary-length', 'focusable', 'commit-action', 'clear-condition', 'result-reflection']);
const FAILURE_INPUT_INTENTS = new Set(['boundary-length', 'required-empty', 'whitespace-only', 'validation-message']);

function getByPath(value, dotPath) {
  return String(dotPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function ensure(condition, errors, message) {
  if (!condition) errors.push(message);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasPartialCoverageLanguage(value) {
  return /partial|limited|only the immediately|unavailable|cannot reach|can't reach|no selectable|not reachable|prerequisite.*unavailable|일부|부분|제한|불가|도달.*못|선행.*없|데이터.*없/i.test(String(value || ''));
}

function getKnownCandidateIds(policyCandidates) {
  return new Set((policyCandidates?.candidates || []).map((candidate) => candidate.candidateId).filter(Boolean));
}

function getCandidateMap(policyCandidates) {
  return new Map((policyCandidates?.candidates || []).map((candidate) => [candidate.candidateId, candidate]));
}

function getKnownIntentIds(policyCandidates) {
  return new Set(
    (policyCandidates?.candidates || [])
      .flatMap((candidate) => candidate.suggestedTestIntents || [])
      .filter(Boolean)
  );
}

function validateTargetMatch(ctx, docs) {
  const errors = [];
  for (const [name, doc] of Object.entries(docs)) {
    ensure(doc?.targetId === ctx.target.targetId, errors, `${name}.targetId must match current targetId ${ctx.target.targetId}`);
    ensure(doc?.route === ctx.target.route, errors, `${name}.route must match current route ${ctx.target.route}`);
  }
  ensure(
    docs.automationContract?.pageRef === ctx.paths.agentResponsePageContract || docs.automationContract?.pageRef === ctx.paths.pageContract,
    errors,
    `automation-contract.pageRef must point to the current page-contract.yaml`
  );
  return errors;
}

function validateElementInventory(elementInventory, ctx) {
  const errors = [];
  const isInternalCheck = String(ctx?.target?.route || '').startsWith('/__');
  ensure(elementInventory.schemaVersion === 1, errors, 'element-inventory.schemaVersion must be 1');
  ensure(elementInventory.kind === 'element-inventory', errors, 'element-inventory.kind must be element-inventory');
  ensure(elementInventory.targetId, errors, 'element-inventory.targetId is required');
  ensure(elementInventory.route, errors, 'element-inventory.route is required');
  ensure(elementInventory.analysis, errors, 'element-inventory.analysis is required');
  ensure(Array.isArray(elementInventory.analysis?.filesInspected) && elementInventory.analysis.filesInspected.length > 0, errors, 'element-inventory.analysis.filesInspected is required');
  ensure(elementInventory.analysis?.completenessBasis, errors, 'element-inventory.analysis.completenessBasis is required');
  ensure(
    !hasPartialCoverageLanguage(elementInventory.analysis?.completenessBasis),
    errors,
    'element-inventory.analysis.completenessBasis describes partial/unreachable coverage. Do not pass partial page coverage as complete; model prerequisites or leave the contract unresolved.'
  );
  for (const [refIndex, ref] of asArray(elementInventory.analysis?.filesInspected).entries()) {
    ensure(ref.file, errors, `element-inventory.analysis.filesInspected[${refIndex}]: file is required`);
    if (ref.file) {
      const normalizedFile = String(ref.file).replace(/\\/g, '/');
      if (!isInternalCheck) {
        ensure(
          !normalizedFile.startsWith('docs/common-tester/'),
          errors,
          `element-inventory.analysis.filesInspected[${refIndex}]: filesInspected must point to project source, not common-tester docs`
        );
      }
      ensure(
        fs.existsSync(resolveRoot(ctx.rootDir, normalizedFile)),
        errors,
        `element-inventory.analysis.filesInspected[${refIndex}]: referenced file does not exist: ${normalizedFile}`
      );
    }
  }
  ensure(Array.isArray(elementInventory.fields), errors, 'element-inventory.fields must be an array');

  const fieldIds = new Set();
  for (const [index, field] of (elementInventory.fields || []).entries()) {
    ensure(field.fieldId, errors, `element-inventory.fields[${index}]: fieldId is required`);
    ensure(field.scope, errors, `element-inventory.fields[${index}]: scope is required`);
    ensure(field.control, errors, `element-inventory.fields[${index}]: control is required`);
    ensure(field.label, errors, `element-inventory.fields[${index}]: label is required`);
    ensure(field.required !== undefined, errors, `element-inventory.fields[${index}]: required is required`);
    ensure(Array.isArray(field.codeRefs) && field.codeRefs.length > 0, errors, `element-inventory.fields[${index}]: codeRefs are required because Agent owns project code analysis`);
    for (const [refIndex, ref] of asArray(field.codeRefs).entries()) {
      ensure(ref.file, errors, `element-inventory.fields[${index}].codeRefs[${refIndex}]: file is required`);
      if (ref.file) {
        const normalizedFile = String(ref.file).replace(/\\/g, '/');
        if (!isInternalCheck) {
          ensure(
            !normalizedFile.startsWith('docs/common-tester/'),
            errors,
            `element-inventory.fields[${index}].codeRefs[${refIndex}]: codeRefs must point to project source, not common-tester docs`
          );
        }
        ensure(
          fs.existsSync(resolveRoot(ctx.rootDir, normalizedFile)),
          errors,
          `element-inventory.fields[${index}].codeRefs[${refIndex}]: referenced file does not exist: ${normalizedFile}`
        );
      }
    }
    if (field.fieldId) {
      ensure(!fieldIds.has(field.fieldId), errors, `element-inventory: duplicate fieldId ${field.fieldId}`);
      fieldIds.add(field.fieldId);
    }
  }

  return errors;
}

function validateCoverageMatrix(elementInventory, pageContract, coverageMatrix, policyCandidates) {
  const errors = [];
  const inventoryFieldIds = new Set((elementInventory.fields || []).map((field) => field.fieldId).filter(Boolean));
  const knownCandidateIds = getKnownCandidateIds(policyCandidates);
  const candidateMap = getCandidateMap(policyCandidates);
  const knownIntentIds = getKnownIntentIds(policyCandidates);
  const hasPolicyCandidates = knownCandidateIds.size > 0;
  const rowIds = new Set();

  ensure(coverageMatrix.schemaVersion === 1, errors, 'coverage-matrix.schemaVersion must be 1');
  ensure(coverageMatrix.kind === 'coverage-matrix', errors, 'coverage-matrix.kind must be coverage-matrix');
  ensure(coverageMatrix.targetId, errors, 'coverage-matrix.targetId is required');
  ensure(coverageMatrix.route, errors, 'coverage-matrix.route is required');
  ensure(Array.isArray(coverageMatrix.rows), errors, 'coverage-matrix.rows must be an array');

  for (const [index, row] of (coverageMatrix.rows || []).entries()) {
    const path = `coverage-matrix.rows[${index}]`;
    ensure(row.rowId, errors, `${path}: rowId is required`);
    ensure(row.fieldId, errors, `${path}: fieldId is required`);
    ensure(row.targetRef, errors, `${path}: targetRef is required`);
    ensure(row.intent, errors, `${path}: intent is required`);
    if (hasPolicyCandidates) {
      ensure(Array.isArray(row.candidateIds) && row.candidateIds.length > 0, errors, `${path}: candidateIds are required`);
    }
    ensure(row.generate !== undefined, errors, `${path}: generate is required`);
    if (row.rowId) {
      ensure(!rowIds.has(row.rowId), errors, `coverage-matrix: duplicate rowId ${row.rowId}`);
      rowIds.add(row.rowId);
    }
    if (row.fieldId) ensure(inventoryFieldIds.has(row.fieldId), errors, `${path}: unknown fieldId ${row.fieldId}`);
    if (row.targetRef) ensure(getByPath(pageContract, row.targetRef), errors, `${path}: targetRef not found ${row.targetRef}`);
    if (hasPolicyCandidates) {
      if (row.intent) ensure(knownIntentIds.has(row.intent), errors, `${path}: unknown intent ${row.intent}`);
      for (const candidateId of row.candidateIds || []) {
        ensure(knownCandidateIds.has(candidateId), errors, `${path}: unknown policy candidateId ${candidateId}`);
        const candidate = candidateMap.get(candidateId);
        ensure(
          asArray(candidate?.suggestedTestIntents).includes(row.intent),
          errors,
          `${path}: candidateId ${candidateId} does not back intent ${row.intent}`
        );
      }
    }
    if (row.generate === false) {
      ensure(row.blockedReason, errors, `${path}: generate:false rows require blockedReason`);
    }
    if (row.generate === true && SUCCESS_INPUT_INTENTS.has(row.intent)) {
      ensure(
        asArray(row.inputCases?.success).length > 0,
        errors,
        `${path}: intent ${row.intent} requires at least one inputCases.success item`
      );
    }
    if (row.generate === true && FAILURE_INPUT_INTENTS.has(row.intent)) {
      ensure(
        asArray(row.inputCases?.failure).length > 0,
        errors,
        `${path}: intent ${row.intent} requires at least one inputCases.failure item`
      );
    }
    for (const group of ['success', 'failure']) {
      const inputIds = new Set();
      for (const [inputIndex, inputCase] of asArray(row.inputCases?.[group]).entries()) {
        ensure(inputCase.inputId, errors, `${path}.inputCases.${group}[${inputIndex}]: inputId is required`);
        ensure(Object.prototype.hasOwnProperty.call(inputCase, 'value'), errors, `${path}.inputCases.${group}[${inputIndex}]: value is required`);
        ensure(inputCase.expected, errors, `${path}.inputCases.${group}[${inputIndex}]: expected is required`);
        if (inputCase.inputId) {
          ensure(!inputIds.has(inputCase.inputId), errors, `${path}.inputCases.${group}: duplicate inputId ${inputCase.inputId}`);
          inputIds.add(inputCase.inputId);
        }
      }
    }
  }

  for (const field of elementInventory.fields || []) {
    const pageFieldRef = getInventoryElementRef(field);
    ensure(getByPath(pageContract, pageFieldRef), errors, `element-inventory field is missing from page-contract.yaml: ${pageFieldRef}`);
    if (TEXT_FIELD_CONTROLS.has(field.control)) {
      const rows = (coverageMatrix.rows || []).filter((row) => row.fieldId === field.fieldId);
      ensure(rows.length > 0, errors, `coverage-matrix: no rows generated for input-like field ${field.fieldId}`);
      const fieldBlocked = Boolean(field.blockedReason);
      if (fieldBlocked) {
        ensure(
          false,
          errors,
          `coverage-matrix: input-like field ${field.fieldId} is blocked. Agent must add executable prerequisite steps or mark the whole contract unresolved instead of silently omitting an input.`
        );
        continue;
      }
      ensure(rows.some((row) => row.generate === true), errors, `coverage-matrix: no generate:true rows for input-like field ${field.fieldId}`);
      const successInputCount = rows.reduce((sum, row) => sum + asArray(row.inputCases?.success).length, 0);
      const failureInputCount = rows.reduce((sum, row) => sum + asArray(row.inputCases?.failure).length, 0);
      ensure(successInputCount > 0, errors, `coverage-matrix: input-like field ${field.fieldId} has no success input case`);
      ensure(failureInputCount > 0, errors, `coverage-matrix: input-like field ${field.fieldId} has no failure input case`);
    }
  }

  return errors;
}

function getKnownPolicyRuleIds(policyRules) {
  return new Set(asArray(policyRules?.rules).map((rule) => rule.ruleId).filter(Boolean));
}

function validateFieldConstraintInventory(elementInventory, pageContract, fieldConstraintInventory, policyRules) {
  const errors = [];
  const inventoryFieldIds = new Set(asArray(elementInventory.fields).map((field) => field.fieldId).filter(Boolean));
  const pageFieldRefs = new Set(Object.keys(pageContract.elements?.fields || {}).map((fieldId) => `elements.fields.${fieldId}`));
  const knownPolicyRuleIds = getKnownPolicyRuleIds(policyRules);
  const constraintIds = new Set();

  ensure(fieldConstraintInventory.schemaVersion === 1, errors, 'field-constraint-inventory.schemaVersion must be 1');
  ensure(fieldConstraintInventory.kind === 'field-constraint-inventory', errors, 'field-constraint-inventory.kind must be field-constraint-inventory');
  ensure(fieldConstraintInventory.targetId, errors, 'field-constraint-inventory.targetId is required');
  ensure(fieldConstraintInventory.route, errors, 'field-constraint-inventory.route is required');
  ensure(Array.isArray(fieldConstraintInventory.fields), errors, 'field-constraint-inventory.fields must be an array');

  const constraintFieldIds = new Set();
  for (const [fieldIndex, field] of asArray(fieldConstraintInventory.fields).entries()) {
    const path = `field-constraint-inventory.fields[${fieldIndex}]`;
    ensure(field.fieldId, errors, `${path}: fieldId is required`);
    ensure(field.targetRef, errors, `${path}: targetRef is required`);
    ensure(field.control, errors, `${path}: control is required`);
    ensure(field.label, errors, `${path}: label is required`);
    ensure(Array.isArray(field.constraints), errors, `${path}: constraints must be an array`);
    if (field.fieldId) {
      ensure(inventoryFieldIds.has(field.fieldId), errors, `${path}: unknown element-inventory fieldId ${field.fieldId}`);
      constraintFieldIds.add(field.fieldId);
    }
    if (field.targetRef) {
      ensure(pageFieldRefs.has(field.targetRef), errors, `${path}: targetRef not found in page-contract fields ${field.targetRef}`);
    }
    for (const [constraintIndex, constraint] of asArray(field.constraints).entries()) {
      const constraintPath = `${path}.constraints[${constraintIndex}]`;
      ensure(constraint.constraintId, errors, `${constraintPath}: constraintId is required`);
      ensure(constraint.type, errors, `${constraintPath}: type is required`);
      ensure(constraint.params && typeof constraint.params === 'object', errors, `${constraintPath}: params are required`);
      ensure(Array.isArray(constraint.sourceRefs) && constraint.sourceRefs.length > 0, errors, `${constraintPath}: sourceRefs are required`);
      if (constraint.constraintId) {
        ensure(!constraintIds.has(constraint.constraintId), errors, `field-constraint-inventory: duplicate constraintId ${constraint.constraintId}`);
        constraintIds.add(constraint.constraintId);
      }
      for (const [sourceIndex, sourceRef] of asArray(constraint.sourceRefs).entries()) {
        const sourcePath = `${constraintPath}.sourceRefs[${sourceIndex}]`;
        ensure(sourceRef.kind, errors, `${sourcePath}: kind is required`);
        if (sourceRef.kind === 'policy-rule') {
          ensure(sourceRef.ruleId, errors, `${sourcePath}: policy-rule sourceRefs require ruleId`);
          if (sourceRef.ruleId) {
            ensure(knownPolicyRuleIds.has(sourceRef.ruleId), errors, `${sourcePath}: unknown policy-rules.yaml ruleId ${sourceRef.ruleId}`);
          }
        }
        if (sourceRef.kind === 'project-schema' || sourceRef.kind === 'project-code') {
          ensure(sourceRef.file, errors, `${sourcePath}: project sourceRefs require file`);
        }
      }
    }
  }

  for (const field of asArray(elementInventory.fields)) {
    if (TEXT_FIELD_CONTROLS.has(field.control)) {
      ensure(
        constraintFieldIds.has(field.fieldId),
        errors,
        `field-constraint-inventory: missing input-like field ${field.fieldId}`
      );
    }
  }

  return errors;
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function hasAlphabetOnlyConstraint(constraint) {
  const type = normalizeText(constraint.type);
  const params = constraint.params || {};
  const allowedCharacters = asArray(params.allowedCharacters).map((item) => String(item).toLowerCase());
  return (
    type.includes('alphabet') ||
    type.includes('english') ||
    type.includes('allowedcharacters.alphabet') ||
    (
      allowedCharacters.length > 0 &&
      allowedCharacters.every((item) => ['alphabet', 'alpha', 'english', '영문', '알파벳'].includes(item))
    )
  );
}

function normalizeAllowedCharacterGroup(group) {
  const value = normalizeText(group);
  if (['korean', 'hangul', '한글', '국문'].includes(value)) return 'korean';
  if (['alphabet', 'alpha', 'english', '영문', '알파벳'].includes(value)) return 'alphabet';
  if (['number', 'numeric', 'digit', '숫자'].includes(value)) return 'number';
  if (['hyphen', 'dash', '-'].includes(value)) return 'hyphen';
  if (['underscore', '_'].includes(value)) return 'underscore';
  if (['space', 'whitespace', '공백'].includes(value)) return 'space';
  return value.replace(/[^a-z0-9가-힣]+/g, '-') || 'sample';
}

function getRequiredCaseTypesForConstraint(constraint) {
  const type = normalizeText(constraint.type);
  if (type.includes('required')) return ['empty', 'whitespace-only', 'valid-non-empty'];
  if (type.includes('length.range')) return ['below-min', 'at-min', 'inside-range', 'at-max', 'above-max'];
  if (type.includes('length.min')) return ['below-min', 'at-min', 'above-min'];
  if (type.includes('length.max')) return ['below-max', 'at-max', 'above-max'];
  if (type.includes('numeric.range')) return ['below-min-fail', 'min-success', 'max-success', 'above-max-fail'];
  if (type.includes('numeric.maxvalue')) return ['at-max-success', 'above-max-fail'];
  if (type.includes('numeric.minvalue')) return ['below-min-fail', 'at-min-success'];
  if (type.includes('decimalprecision')) return ['integer-success', 'decimal-at-max-success', 'decimal-over-max-fail', 'non-numeric-fail'];
  if (type.includes('type.numeric')) return ['integer-success', 'text-fail'];
  if (type.includes('allowedcharacters')) {
    if (hasAlphabetOnlyConstraint(constraint)) {
      return ['alphabet-success', 'korean-fail', 'number-fail', 'special-character-fail'];
    }
    const allowedGroups = Array.from(new Set(asArray(constraint.params?.allowedCharacters).map(normalizeAllowedCharacterGroup).filter(Boolean)));
    const allowedCases = allowedGroups.length
      ? allowedGroups.map((group) => `allowed-${group}-success`)
      : ['allowed-sample-success'];
    return [...allowedCases, 'disallowed-sample-fail'];
  }
  if (type.includes('forbiddencharacters')) return ['valid-without-forbidden', 'forbidden-character-fail'];
  return ['valid-sample', 'invalid-sample'];
}

function estimateMinimumCasesForConstraint(constraint) {
  return getRequiredCaseTypesForConstraint(constraint).length;
}

function estimateMinimumExpansionCases(fieldConstraintInventory) {
  return asArray(fieldConstraintInventory.fields).reduce((sum, field) =>
    sum + asArray(field.constraints).reduce((fieldSum, constraint) =>
      fieldSum + estimateMinimumCasesForConstraint(constraint), 0
    ), 0
  );
}

function validateTestExpansionPlan(fieldConstraintInventory, testExpansionPlan) {
  const errors = [];
  const fieldIds = new Set(asArray(fieldConstraintInventory.fields).map((field) => field.fieldId).filter(Boolean));
  const constraintsById = new Map();
  for (const field of asArray(fieldConstraintInventory.fields)) {
    for (const constraint of asArray(field.constraints)) {
      if (constraint.constraintId) constraintsById.set(constraint.constraintId, field.fieldId);
    }
  }
  const caseIds = new Set();
  const allowedPartitions = new Set(['success', 'failure', 'boundary']);
  const estimatedMinimumCaseCount = estimateMinimumExpansionCases(fieldConstraintInventory);

  ensure(testExpansionPlan.schemaVersion === 1, errors, 'test-expansion-plan.schemaVersion must be 1');
  ensure(testExpansionPlan.kind === 'test-expansion-plan', errors, 'test-expansion-plan.kind must be test-expansion-plan');
  ensure(testExpansionPlan.targetId, errors, 'test-expansion-plan.targetId is required');
  ensure(testExpansionPlan.route, errors, 'test-expansion-plan.route is required');
  ensure(Number.isFinite(Number(testExpansionPlan.expectedExecutableCaseCountMin)), errors, 'test-expansion-plan.expectedExecutableCaseCountMin is required');
  ensure(Array.isArray(testExpansionPlan.cases), errors, 'test-expansion-plan.cases must be an array');

  const generatedCases = asArray(testExpansionPlan.cases).filter((item) => item.generate === true);
  ensure(
    Number(testExpansionPlan.expectedExecutableCaseCountMin || 0) >= estimatedMinimumCaseCount,
    errors,
    `test-expansion-plan.expectedExecutableCaseCountMin ${testExpansionPlan.expectedExecutableCaseCountMin} is below validator-estimated minimum ${estimatedMinimumCaseCount} from field constraints`
  );
  ensure(
    generatedCases.length >= Number(testExpansionPlan.expectedExecutableCaseCountMin || 0),
    errors,
    `test-expansion-plan: generate:true case count ${generatedCases.length} is below expectedExecutableCaseCountMin ${testExpansionPlan.expectedExecutableCaseCountMin}`
  );

  for (const [caseIndex, testCase] of asArray(testExpansionPlan.cases).entries()) {
    const path = `test-expansion-plan.cases[${caseIndex}]`;
    ensure(testCase.caseId, errors, `${path}: caseId is required`);
    ensure(testCase.fieldId, errors, `${path}: fieldId is required`);
    ensure(testCase.constraintId, errors, `${path}: constraintId is required`);
    ensure(testCase.caseType, errors, `${path}: caseType is required`);
    ensure(testCase.partition, errors, `${path}: partition is required`);
    if (testCase.partition) {
      ensure(allowedPartitions.has(testCase.partition), errors, `${path}: unsupported partition ${testCase.partition}`);
    }
    ensure(Object.prototype.hasOwnProperty.call(testCase, 'value'), errors, `${path}: value is required`);
    ensure(testCase.generate !== undefined, errors, `${path}: generate is required`);
    ensure(testCase.expected, errors, `${path}: expected is required`);
    if (testCase.caseId) {
      ensure(!caseIds.has(testCase.caseId), errors, `test-expansion-plan: duplicate caseId ${testCase.caseId}`);
      caseIds.add(testCase.caseId);
    }
    if (testCase.fieldId) ensure(fieldIds.has(testCase.fieldId), errors, `${path}: unknown fieldId ${testCase.fieldId}`);
    if (testCase.constraintId) {
      ensure(constraintsById.has(testCase.constraintId), errors, `${path}: unknown constraintId ${testCase.constraintId}`);
      ensure(
        !testCase.fieldId || constraintsById.get(testCase.constraintId) === testCase.fieldId,
        errors,
        `${path}: constraintId ${testCase.constraintId} does not belong to fieldId ${testCase.fieldId}`
      );
    }
  }

  for (const field of asArray(fieldConstraintInventory.fields)) {
    for (const constraint of asArray(field.constraints)) {
      const cases = generatedCases.filter((item) => item.constraintId === constraint.constraintId);
      ensure(cases.length > 0, errors, `test-expansion-plan: no executable cases for constraint ${constraint.constraintId}`);
      const partitions = new Set(cases.map((item) => item.partition));
      ensure(partitions.has('success'), errors, `test-expansion-plan: constraint ${constraint.constraintId} has no success partition`);
      ensure(partitions.has('failure'), errors, `test-expansion-plan: constraint ${constraint.constraintId} has no failure partition`);
      const requiredCaseTypes = getRequiredCaseTypesForConstraint(constraint);
      const actualCaseTypes = new Set(cases.map((item) => item.caseType).filter(Boolean));
      for (const requiredCaseType of requiredCaseTypes) {
        ensure(
          actualCaseTypes.has(requiredCaseType),
          errors,
          `test-expansion-plan: constraint ${constraint.constraintId} is missing required caseType ${requiredCaseType}`
        );
      }
    }
  }

  return errors;
}

function getInventoryElementRef(field) {
  if (field.control === 'button' || field.control === 'modal-trigger') {
    return `elements.buttons.${field.fieldId}`;
  }
  return `elements.fields.${field.fieldId}`;
}

const GENERIC_FIELD_CSS_SELECTORS = new Set([
  'input',
  'input:not([readonly])',
  'textarea',
  'select',
  '.ant-select',
  '.ant-input',
  '.ant-input-number',
  '.ant-input-number input',
]);

function normalizeSelectorValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function selectorKey(selector) {
  if (!selector?.strategy) return '';
  const value = normalizeSelectorValue(selector.value || selector.text || selector.role);
  return `${selector.strategy}:${value}`;
}

function validateSelector(selector, errors, path, groupName) {
  ensure(selector && selector.strategy, errors, `${path}: selector.strategy is required`);
  if (!selector) return;
  if (selector.strategy === 'role') {
    ensure(selector.role, errors, `${path}: role selector requires role`);
  } else if (selector.strategy === 'label') {
    ensure(selector.text, errors, `${path}: label selector requires text`);
  } else if (selector.strategy === 'placeholder') {
    ensure(selector.value, errors, `${path}: placeholder selector requires value`);
  } else if (selector.strategy === 'testId') {
    ensure(selector.value, errors, `${path}: testId selector requires value`);
  } else if (selector.strategy === 'text') {
    ensure(selector.text, errors, `${path}: text selector requires text`);
  } else if (selector.strategy === 'css') {
    ensure(selector.value, errors, `${path}: css selector requires value`);
    const value = normalizeSelectorValue(selector.value);
    ensure(
      groupName !== 'fields' || !GENERIC_FIELD_CSS_SELECTORS.has(value.toLowerCase()),
      errors,
      `${path}: field css selector is too broad: ${value}`
    );
  } else {
    errors.push(`${path}: unsupported selector strategy ${selector.strategy}`);
  }
}

function validatePageContract(pageContract) {
  const errors = [];
  ensure(pageContract.schemaVersion === 1, errors, 'page-contract.schemaVersion must be 1');
  ensure(pageContract.kind === 'page-contract', errors, 'page-contract.kind must be page-contract');
  ensure(pageContract.targetId, errors, 'page-contract.targetId is required');
  ensure(pageContract.route, errors, 'page-contract.route is required');
  ensure(pageContract.elements, errors, 'page-contract.elements is required');

  const fieldSelectors = new Map();

  for (const groupName of ['fields', 'buttons', 'tables']) {
    const group = pageContract.elements?.[groupName] || {};
    for (const [name, element] of Object.entries(group)) {
      ensure(element.label, errors, `${groupName}.${name}: label is required`);
      ensure(Array.isArray(element.selectors) && element.selectors.length > 0, errors, `${groupName}.${name}: selectors are required`);
      ensure(Array.isArray(element.sourceRefs) && element.sourceRefs.length > 0, errors, `${groupName}.${name}: sourceRefs are required`);
      for (const [refIndex, ref] of (element.sourceRefs || []).entries()) {
        ensure(ref.pageId, errors, `${groupName}.${name}.sourceRefs[${refIndex}]: pageId is required`);
        ensure(ref.titlePath, errors, `${groupName}.${name}.sourceRefs[${refIndex}]: titlePath is required`);
      }
      for (const [index, selector] of (element.selectors || []).entries()) {
        validateSelector(selector, errors, `${groupName}.${name}.selectors[${index}]`, groupName);
        if (groupName === 'fields') {
          const key = selectorKey(selector);
          const existing = fieldSelectors.get(key);
          ensure(!key || !existing, errors, `${groupName}.${name}.selectors[${index}]: selector duplicates ${existing}`);
          if (key && !existing) fieldSelectors.set(key, `${groupName}.${name}.selectors[${index}]`);
        }
      }
    }
  }
  return errors;
}

function validateAutomationContract(pageContract, automationContract, policyCandidates, coverageMatrix, elementInventory) {
  const errors = [];
  const knownCandidateIds = getKnownCandidateIds(policyCandidates);
  const candidateMap = getCandidateMap(policyCandidates);
  const knownIntentIds = getKnownIntentIds(policyCandidates);
  const hasPolicyCandidates = knownCandidateIds.size > 0;
  const coverage = policyCandidates?.coverage || {};
  const minGeneratedCaseCount = Number(coverage.minGeneratedCaseCount || 0);
  const requiredIntents = (coverage.requiredIntents || []).map((item) => item.intent).filter(Boolean);
  const generatedCases = (automationContract.cases || []).filter((testCase) => testCase.generate === true);
  const generatedTitles = new Set();
  const matrixRows = (coverageMatrix?.rows || []).filter((row) => row.generate === true);
  const inventoryFieldMap = new Map((elementInventory?.fields || []).map((field) => [field.fieldId, field]));
  const matrixRowIds = new Set((coverageMatrix?.rows || []).map((row) => row.rowId).filter(Boolean));
  const matrixRowMap = new Map((coverageMatrix?.rows || []).map((row) => [row.rowId, row]));
  const matrixInputCaseRefs = new Set();
  for (const row of coverageMatrix?.rows || []) {
    for (const group of ['success', 'failure']) {
      for (const inputCase of asArray(row.inputCases?.[group])) {
        if (row.rowId && inputCase.inputId) {
          matrixInputCaseRefs.add(`${row.rowId}::${inputCase.inputId}`);
        }
      }
    }
  }
  ensure(automationContract.schemaVersion === 1, errors, 'automation-contract.schemaVersion must be 1');
  ensure(automationContract.kind === 'automation-contract', errors, 'automation-contract.kind must be automation-contract');
  ensure(automationContract.targetId, errors, 'automation-contract.targetId is required');
  ensure(automationContract.pageRef, errors, 'automation-contract.pageRef is required');
  ensure(Array.isArray(automationContract.cases), errors, 'automation-contract.cases must be an array');
  if (minGeneratedCaseCount > 0) {
    ensure(
      generatedCases.length >= minGeneratedCaseCount,
      errors,
      `automation-contract: generated case count ${generatedCases.length} is below coverage.minGeneratedCaseCount ${minGeneratedCaseCount}`
    );
  }

  for (const testCase of automationContract.cases || []) {
    ensure(testCase.id, errors, 'case.id is required');
    ensure(testCase.capability, errors, `${testCase.id}: capability is required`);
    ensure(testCase.title, errors, `${testCase.id}: title is required`);
    if (testCase.generate === true && testCase.title) {
      ensure(!generatedTitles.has(testCase.title), errors, `${testCase.id}: duplicate generated test title ${testCase.title}`);
      generatedTitles.add(testCase.title);
    }
    ensure(Array.isArray(testCase.sourceRefs) && testCase.sourceRefs.length > 0, errors, `${testCase.id}: sourceRefs are required`);
    if (testCase.generate === true && hasPolicyCandidates) {
      const citedCandidateIds = (testCase.sourceRefs || []).map((ref) => ref.candidateId).filter(Boolean);
      ensure(citedCandidateIds.length > 0, errors, `${testCase.id}: generated cases must cite policy-candidates.yaml candidateId`);
      for (const candidateId of citedCandidateIds) {
        ensure(knownCandidateIds.has(candidateId), errors, `${testCase.id}: unknown policy candidateId ${candidateId}`);
      }
    }
    ensure(Array.isArray(testCase.steps), errors, `${testCase.id}: steps must be an array`);
    ensure(Array.isArray(testCase.assertions), errors, `${testCase.id}: assertions must be an array`);
    if (testCase.generate === true) {
      ensure(testCase.assertions?.length > 0, errors, `${testCase.id}: generated cases require assertions`);
      ensure(Array.isArray(testCase.coversMatrixRows) && testCase.coversMatrixRows.length > 0, errors, `${testCase.id}: generate:true cases require coversMatrixRows`);
      for (const rowId of testCase.coversMatrixRows || []) {
        ensure(matrixRowIds.has(rowId), errors, `${testCase.id}: unknown coversMatrixRows value ${rowId}`);
      }
      for (const ref of asArray(testCase.coversInputCases)) {
        ensure(ref.rowId, errors, `${testCase.id}: coversInputCases rowId is required`);
        ensure(ref.inputId, errors, `${testCase.id}: coversInputCases inputId is required`);
        if (ref.rowId && ref.inputId) {
          const key = `${ref.rowId}::${ref.inputId}`;
          ensure(matrixInputCaseRefs.has(key), errors, `${testCase.id}: unknown coversInputCases value ${key}`);
          ensure(
            asArray(testCase.coversMatrixRows).includes(ref.rowId),
            errors,
            `${testCase.id}: coversInputCases rowId ${ref.rowId} must also appear in coversMatrixRows`
          );
          const row = matrixRowMap.get(ref.rowId);
          const targetRefs = asArray(testCase.steps).map((step) => step.targetRef).filter(Boolean);
          ensure(targetRefs.includes(row?.targetRef), errors, `${testCase.id}: coversInputCases ${key} must have a step touching ${row?.targetRef}`);
        }
      }
      ensure(Array.isArray(testCase.coversIntents) && testCase.coversIntents.length > 0, errors, `${testCase.id}: generate:true cases require coversIntents`);
      if (hasPolicyCandidates) {
        for (const intent of testCase.coversIntents || []) {
          ensure(knownIntentIds.has(intent), errors, `${testCase.id}: unknown coversIntents value ${intent}`);
          const citedCandidateIds = (testCase.sourceRefs || []).map((ref) => ref.candidateId).filter(Boolean);
          const backed = citedCandidateIds.some((candidateId) =>
            asArray(candidateMap.get(candidateId)?.suggestedTestIntents).includes(intent)
          );
          ensure(backed, errors, `${testCase.id}: coversIntents value ${intent} is not backed by any cited candidateId`);
        }
      }
    }

    for (const step of testCase.steps || []) {
      ensure(SUPPORTED_ACTIONS.has(step.action), errors, `${testCase.id}.${step.id || 'step'}: unsupported action ${step.action}`);
      ensure(!step.selector, errors, `${testCase.id}.${step.id || 'step'}: raw selector is forbidden in automation contract`);
      if (step.action === 'page.goto') {
        const route = String(step.route || step.url || '');
        ensure(!route.includes('/login'), errors, `${testCase.id}.${step.id || 'step'}: login route is forbidden; authentication is handled by foundation runtime`);
      }
      if (step.action !== 'page.goto') {
        ensure(step.targetRef, errors, `${testCase.id}.${step.id || 'step'}: targetRef is required`);
        ensure(getByPath(pageContract, step.targetRef), errors, `${testCase.id}.${step.id || 'step'}: targetRef not found ${step.targetRef}`);
      }
      if (step.action === 'input.fill') {
        ensure(Object.prototype.hasOwnProperty.call(step, 'value'), errors, `${testCase.id}.${step.id || 'step'}: input.fill requires value`);
      }
    }

    for (const assertion of testCase.assertions || []) {
      ensure(SUPPORTED_ASSERTIONS.has(assertion.action), errors, `${testCase.id}.${assertion.id || 'assertion'}: unsupported assertion ${assertion.action}`);
      if (assertion.action === 'expect.value') {
        ensure(Object.prototype.hasOwnProperty.call(assertion, 'value'), errors, `${testCase.id}.${assertion.id || 'assertion'}: expect.value requires value; do not use expected`);
      }
      if (assertion.action === 'expect.textVisible' || assertion.action === 'expect.textHidden') {
        ensure(assertion.text, errors, `${testCase.id}.${assertion.id || 'assertion'}: text is required`);
      } else if (assertion.action === 'expect.textMatches') {
        ensure(assertion.pattern || assertion.textRegex, errors, `${testCase.id}.${assertion.id || 'assertion'}: pattern is required`);
      } else {
        ensure(assertion.targetRef, errors, `${testCase.id}.${assertion.id || 'assertion'}: targetRef is required`);
        ensure(getByPath(pageContract, assertion.targetRef), errors, `${testCase.id}.${assertion.id || 'assertion'}: targetRef not found ${assertion.targetRef}`);
      }
    }
  }

  if (requiredIntents.length) {
    const coveredIntents = new Set(generatedCases.flatMap((testCase) => testCase.coversIntents || []));
    for (const intent of requiredIntents) {
      ensure(coveredIntents.has(intent), errors, `automation-contract: required coverage intent is not covered: ${intent}`);
    }
  }

  if (matrixRows.length) {
    const coveredRows = new Set(generatedCases.flatMap((testCase) => testCase.coversMatrixRows || []));
    for (const row of matrixRows) {
      ensure(coveredRows.has(row.rowId), errors, `automation-contract: coverage-matrix row is not covered: ${row.rowId}`);
    }
  }

  if (matrixInputCaseRefs.size) {
    const coveredInputCases = new Set();
    for (const testCase of generatedCases) {
      for (const ref of asArray(testCase.coversInputCases)) {
        if (ref.rowId && ref.inputId) coveredInputCases.add(`${ref.rowId}::${ref.inputId}`);
      }
    }
    for (const ref of matrixInputCaseRefs) {
      ensure(coveredInputCases.has(ref), errors, `automation-contract: coverage-matrix input case is not covered: ${ref}`);
    }
  }

  const fieldEntries = Object.entries(pageContract.elements?.fields || {});
  for (const [fieldName, field] of fieldEntries) {
    const inventoryField = inventoryFieldMap.get(fieldName);
    if (inventoryField?.blockedReason) continue;
    const fieldRef = `elements.fields.${fieldName}`;
    const fieldIntents = asArray(
      field.coverageIntents ||
      field.applicableIntents ||
      inventoryField?.coverageIntents ||
      inventoryField?.applicableIntents
    );
    const requiredFieldIntents = fieldIntents.length
      ? fieldIntents
      : TEXT_FIELD_CONTROLS.has(field.control)
        ? requiredIntents
        : [];
    for (const intent of requiredFieldIntents) {
      const covered = generatedCases.some((testCase) => {
        const targetRefs = [
          ...asArray(testCase.steps).map((step) => step.targetRef),
          ...asArray(testCase.assertions).map((assertion) => assertion.targetRef),
        ].filter(Boolean);
        return asArray(testCase.coversIntents).includes(intent) && targetRefs.includes(fieldRef);
      });
      ensure(covered, errors, `${fieldRef}: required coverage intent is not covered by a generated case touching this field: ${intent}`);
    }
  }
  return errors;
}

function unwrapDeclaredValue(value) {
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
    return JSON.stringify(value);
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(unwrapDeclaredValue(left)) === JSON.stringify(unwrapDeclaredValue(right));
}

function hasFailureProof(testCase, expansionCase) {
  if (expansionCase.partition !== 'failure') return true;
  const expected = expansionCase.expected || {};
  if (expected.validationMessage || expected.errorMessage || expected.submitBlocked || expected.nextBlocked) return true;
  return asArray(testCase.assertions).some((assertion) => assertion.action === 'expect.textVisible' || assertion.action === 'expect.textMatches');
}

function validateAutomationExpansionCoverage(automationContract, testExpansionPlan) {
  const errors = [];
  const generatedExpansionCases = asArray(testExpansionPlan.cases).filter((testCase) => testCase.generate === true);
  const expansionCaseMap = new Map(generatedExpansionCases.map((testCase) => [testCase.caseId, testCase]));
  const expansionCaseIds = new Set(generatedExpansionCases.map((testCase) => testCase.caseId).filter(Boolean));
  const generatedCases = asArray(automationContract.cases).filter((testCase) => testCase.generate === true);
  const coveredCaseIds = new Set();

  ensure(
    generatedCases.length >= Number(testExpansionPlan.expectedExecutableCaseCountMin || 0),
    errors,
    `automation-contract: generated case count ${generatedCases.length} is below test-expansion-plan expectedExecutableCaseCountMin ${testExpansionPlan.expectedExecutableCaseCountMin}`
  );

  for (const testCase of generatedCases) {
    ensure(
      Array.isArray(testCase.coversExpansionCases) && testCase.coversExpansionCases.length > 0,
      errors,
      `${testCase.id}: generate:true cases require coversExpansionCases from test-expansion-plan.yaml`
    );
    for (const caseId of asArray(testCase.coversExpansionCases)) {
      ensure(expansionCaseIds.has(caseId), errors, `${testCase.id}: unknown coversExpansionCases value ${caseId}`);
      const expansionCase = expansionCaseMap.get(caseId);
      if (expansionCase) {
        const targetRef = `elements.fields.${expansionCase.fieldId}`;
        const matchingFill = asArray(testCase.steps).find((step) =>
          step.action === 'input.fill' &&
          step.targetRef === targetRef &&
          valuesEqual(step.value, expansionCase.value)
        );
        ensure(
          Boolean(matchingFill),
          errors,
          `${testCase.id}: expansion case ${caseId} must fill ${targetRef} with the exact value declared in test-expansion-plan.yaml`
        );
        ensure(
          hasFailureProof(testCase, expansionCase),
          errors,
          `${testCase.id}: failure expansion case ${caseId} needs observable failure proof, not only invalid value retention`
        );
      }
      coveredCaseIds.add(caseId);
    }
  }

  for (const caseId of expansionCaseIds) {
    ensure(coveredCaseIds.has(caseId), errors, `automation-contract: test-expansion-plan case is not covered: ${caseId}`);
  }

  return errors;
}

async function validateContract(ctx) {
  const elementInventory = readYaml(ctx.rootDir, ctx.paths.agentResponseElementInventory);
  const coverageMatrix = readYaml(ctx.rootDir, ctx.paths.agentResponseCoverageMatrix);
  const fieldConstraintInventory = readYaml(ctx.rootDir, ctx.paths.agentResponseFieldConstraintInventory);
  const testExpansionPlan = readYaml(ctx.rootDir, ctx.paths.agentResponseTestExpansionPlan);
  const pageContract = readYaml(ctx.rootDir, ctx.paths.agentResponsePageContract);
  const automationContract = readYaml(ctx.rootDir, ctx.paths.agentResponseAutomationContract);
  const commonPolicy = readYaml(ctx.rootDir, ctx.paths.agentResponseCommonPolicyYaml);
  const policyCandidates = readYaml(ctx.rootDir, ctx.paths.policyCandidates);
  const policyRules = readYaml(ctx.rootDir, ctx.paths.policyRules);
  const coverageLedger = readText(ctx.rootDir, ctx.paths.agentResponseCoverageLedgerMarkdown);
  const errors = [
    ...validateTargetMatch(ctx, { elementInventory, coverageMatrix, fieldConstraintInventory, testExpansionPlan, pageContract, automationContract }),
    ...validateElementInventory(elementInventory, ctx),
    ...validatePageContract(pageContract),
    ...validateFieldConstraintInventory(elementInventory, pageContract, fieldConstraintInventory, policyRules),
    ...validateTestExpansionPlan(fieldConstraintInventory, testExpansionPlan),
    ...validateCoverageMatrix(elementInventory, pageContract, coverageMatrix, policyCandidates),
    ...validateAutomationContract(pageContract, automationContract, policyCandidates, coverageMatrix, elementInventory),
    ...validateAutomationExpansionCoverage(automationContract, testExpansionPlan),
  ];

  for (const row of (coverageMatrix.rows || []).filter((item) => item.generate === true)) {
    ensure(coverageLedger.includes(row.rowId), errors, `coverage-ledger.md: missing coverage-matrix row ${row.rowId}`);
    for (const group of ['success', 'failure']) {
      for (const inputCase of asArray(row.inputCases?.[group])) {
        ensure(coverageLedger.includes(inputCase.inputId), errors, `coverage-ledger.md: missing input case ${row.rowId}::${inputCase.inputId}`);
      }
    }
  }
  for (const testCase of (automationContract.cases || []).filter((item) => item.generate === true)) {
    ensure(coverageLedger.includes(testCase.id), errors, `coverage-ledger.md: missing generated case ${testCase.id}`);
    for (const expansionCaseId of asArray(testCase.coversExpansionCases)) {
      ensure(coverageLedger.includes(expansionCaseId), errors, `coverage-ledger.md: missing expansion case ${testCase.id}::${expansionCaseId}`);
    }
  }

  if (errors.length) {
    writeText(ctx.rootDir, ctx.paths.contractGaps, [`# Contract Validation Gaps`, '', ...errors.map((error) => `- ${error}`), ''].join('\n'));
    return {
      status: 'failed',
      message: `Contract validation failed: ${errors.length} error(s). See ${ctx.paths.contractGaps}`,
    };
  }

  ctx.pageContract = pageContract;
  ctx.automationContract = automationContract;
  ctx.commonPolicy = commonPolicy;
  ctx.fieldConstraintInventory = fieldConstraintInventory;
  ctx.testExpansionPlan = testExpansionPlan;

  writeText(ctx.rootDir, ctx.paths.elementInventory, readText(ctx.rootDir, ctx.paths.agentResponseElementInventory));
  writeText(ctx.rootDir, ctx.paths.coverageMatrix, readText(ctx.rootDir, ctx.paths.agentResponseCoverageMatrix));
  writeText(ctx.rootDir, ctx.paths.fieldConstraintInventory, readText(ctx.rootDir, ctx.paths.agentResponseFieldConstraintInventory));
  writeText(ctx.rootDir, ctx.paths.testExpansionPlan, readText(ctx.rootDir, ctx.paths.agentResponseTestExpansionPlan));
  writeText(ctx.rootDir, ctx.paths.pageContract, readText(ctx.rootDir, ctx.paths.agentResponsePageContract));
  writeText(ctx.rootDir, ctx.paths.automationContract, readText(ctx.rootDir, ctx.paths.agentResponseAutomationContract));
  writeText(ctx.rootDir, ctx.paths.commonPolicyYaml, readText(ctx.rootDir, ctx.paths.agentResponseCommonPolicyYaml));

  return {
    status: 'ok',
    caseCount: automationContract.cases.length,
    generatedCaseCount: automationContract.cases.filter((testCase) => testCase.generate === true).length,
  };
}

module.exports = { validateContract };
