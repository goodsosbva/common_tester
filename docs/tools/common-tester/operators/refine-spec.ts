// @ts-nocheck
const { hashJson, writeJson, writeText } = require('../context');
const { renderSpec } = require('../renderer/playwright-renderer');

async function refineSpec(ctx) {
  const observation = ctx.mcpObservation || {};
  const route = ctx.target.route || '/';
  const forceRun = ctx.command.forceRun === true || String(ctx.command.forceRun).toLowerCase() === 'true';
  const canGenerate =
    forceRun || (observation.status === 'observed' && observation.recommendation?.canGenerateSpec === true);
  const reason = canGenerate
    ? forceRun
      ? 'force-run enabled for input-only MVP execution test.'
      : 'Playwright MCP observation allows executable spec generation.'
    : observation.message || 'Playwright MCP observation is not available or not sufficient for executable spec generation.';

  const contract = {
    targetId: ctx.target.targetId,
    phase: 'refined',
    route,
    capability: ctx.automationContract?.capability || 'input',
    generate: canGenerate,
    reason,
    mcpObservationStatus: observation.status || 'unknown',
    forceRun,
    cases: (ctx.automationContract?.cases || []).map((testCase) => ({
      ...testCase,
      generate: canGenerate,
      status: canGenerate ? 'ready' : 'blocked_by_mcp',
      selectors: observation.selectors?.stable || [],
      blockers: canGenerate ? [] : [reason],
    })),
  };
  contract.hash = hashJson(contract);

  const spec = renderSpec(contract);

  ctx.automationContract = contract;
  writeJson(ctx.rootDir, ctx.paths.automationContract, contract);
  writeText(ctx.rootDir, ctx.paths.generatedSpecFile, spec);

  return {
    status: 'ok',
    phase: 'refined',
    generated: canGenerate,
    reason,
  };
}

module.exports = { refineSpec };
