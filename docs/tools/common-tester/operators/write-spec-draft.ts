// @ts-nocheck
const { hashJson, writeJson, writeText } = require('../context');
const { buildInputCase } = require('../capabilities/input');
const { renderSpec } = require('../renderer/playwright-renderer');

async function writeSpecDraft(ctx) {
  const route = ctx.target.route || '/';
  const capability = ctx.command.capability || 'input';
  if (capability !== 'input') {
    return {
      status: 'failed',
      message: `Only input capability is supported in this MVP. Received: ${capability}`,
    };
  }

  const inputCase = buildInputCase(ctx);
  const contract = {
    targetId: ctx.target.targetId,
    phase: 'draft',
    route,
    capability,
    generate: inputCase.generate === true,
    reason: 'Input-only draft spec was generated before Playwright MCP verification. refine_spec must enable final executable cases after MCP observation.',
    cases: [inputCase],
  };
  contract.hash = hashJson(contract);

  const spec = renderSpec(contract);

  ctx.automationContract = contract;
  ctx.draftSpec = spec;
  writeJson(ctx.rootDir, ctx.paths.automationContract, contract);
  writeText(ctx.rootDir, ctx.paths.generatedDraftSpecFile, spec);
  writeText(ctx.rootDir, ctx.paths.generatedSpecFile, spec);

  return {
    status: 'ok',
    phase: 'draft',
    generated: true,
    capability,
    executable: inputCase.generate === true,
    draftSpecFile: ctx.paths.generatedDraftSpecFile,
    specFile: ctx.paths.generatedSpecFile,
  };
}

module.exports = { writeSpecDraft };
