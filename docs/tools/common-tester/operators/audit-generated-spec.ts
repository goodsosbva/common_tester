// @ts-nocheck
const { readText, readYaml, writeJson } = require('../context');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unwrapDeclaredValue(value) {
  if (value && typeof value === 'object') {
    if (value.source && value.source !== 'literal') return undefined;
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  }
  return value;
}

function assertRenderedValue(spec, value, errors, context) {
  const declaredValue = unwrapDeclaredValue(value);
  if (declaredValue === undefined) return;
  const rendered = JSON.stringify(declaredValue);
  if (!spec.includes(rendered)) {
    errors.push(`${context}: rendered spec does not contain expected literal ${rendered}`);
  }
}

async function auditGeneratedSpec(ctx) {
  const spec = ctx.generatedSpec || readText(ctx.rootDir, ctx.paths.generatedSpecFile);
  const automationContract = ctx.automationContract || readYaml(ctx.rootDir, ctx.paths.automationContract);
  const errors = [];
  const generatedCases = asArray(automationContract.cases).filter((testCase) => testCase.generate === true);

  for (const testCase of generatedCases) {
    if (!spec.includes(`// caseId: ${testCase.id}`)) {
      errors.push(`${testCase.id}: rendered spec is missing caseId comment`);
    }
    for (const [stepIndex, step] of asArray(testCase.steps).entries()) {
      if (step.action === 'input.fill') {
        assertRenderedValue(spec, step.value, errors, `${testCase.id}.steps[${stepIndex}]`);
      }
    }
    for (const [assertionIndex, assertion] of asArray(testCase.assertions).entries()) {
      if (assertion.action === 'expect.value') {
        assertRenderedValue(spec, assertion.value, errors, `${testCase.id}.assertions[${assertionIndex}]`);
      }
    }
  }

  const testCount = (spec.match(/\n\s*test\(/g) || []).length;
  if (testCount < generatedCases.length) {
    errors.push(`rendered spec has ${testCount} executable test() calls but automation-contract has ${generatedCases.length} generate:true cases`);
  }

  const audit = {
    schemaVersion: 1,
    kind: 'generated-spec-audit',
    targetId: ctx.target.targetId,
    route: ctx.target.route,
    generatedCaseCount: generatedCases.length,
    renderedTestCount: testCount,
    status: errors.length ? 'failed' : 'ok',
    errors,
  };
  writeJson(ctx.rootDir, `${ctx.paths.targetDir}/spec-audit.json`, audit);

  if (errors.length) {
    return {
      status: 'failed',
      message: `Generated spec audit failed: ${errors.length} error(s). See ${ctx.paths.targetDir}/spec-audit.json`,
    };
  }

  return {
    status: 'ok',
    generatedCaseCount: generatedCases.length,
    renderedTestCount: testCount,
    auditFile: `${ctx.paths.targetDir}/spec-audit.json`,
  };
}

module.exports = { auditGeneratedSpec };
