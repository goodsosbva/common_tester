// @ts-nocheck
const { hashJson, writeJson } = require('../context');

async function buildRunPlan(ctx) {
  const cases = ctx.automationContract?.cases || [];
  const plannedCases = cases.map((testCase) => ({
    id: testCase.id,
    title: testCase.title,
    capability: testCase.capability,
    generate: testCase.generate === true,
    mode: testCase.mode || 'auto',
    specFile: ctx.paths.generatedSpecFile,
    reason: testCase.generate === true ? 'contract_valid' : (testCase.reason || 'generate_false'),
  }));
  const runPlan = {
    schemaVersion: 1,
    kind: 'run-plan',
    targetId: ctx.target.targetId,
    route: ctx.target.route,
    plannedCases,
    executableCaseCount: plannedCases.filter((item) => item.generate).length,
  };
  runPlan.hash = hashJson(runPlan);
  ctx.runPlan = runPlan;
  writeJson(ctx.rootDir, ctx.paths.runPlan, runPlan);
  return {
    status: 'ok',
    executableCaseCount: runPlan.executableCaseCount,
    runPlan: ctx.paths.runPlan,
  };
}

module.exports = { buildRunPlan };
