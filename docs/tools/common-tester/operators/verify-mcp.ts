// @ts-nocheck
const { hashJson, writeJson } = require('../context');

async function verifyMcp(ctx) {
  const baseURL = ctx.policies.playwright.runtime.baseURL;
  const adapterMode = process.env.COMMON_TESTER_MCP_ADAPTER || 'not_configured';
  const observation = {
    status: adapterMode === 'not_configured' ? 'adapter_not_configured' : 'adapter_not_implemented',
    targetId: ctx.target.targetId,
    url: ctx.target.route ? `${baseURL}${ctx.target.route}` : baseURL,
    requiredBeforeSpecGeneration: ctx.policies.playwright.mcp.requiredBeforeSpecGeneration,
    runnerOwnedStep: true,
    adapter: {
      mode: adapterMode,
      env: 'COMMON_TESTER_MCP_ADAPTER',
    },
    observations: [],
    blockers: [
      adapterMode === 'not_configured'
        ? 'Runner-owned Playwright MCP adapter is not configured yet.'
        : 'Runner-owned Playwright MCP adapter implementation is missing.',
    ],
    message:
      'verify_mcp is an automatic runner operator. It must not be replaced by a manual user-to-agent instruction.',
    recommendation: {
      canGenerateSpec: false,
      reason: 'MCP screen observation is required before executable spec generation.',
    },
  };
  observation.hash = hashJson(observation);

  ctx.mcpObservation = observation;
  writeJson(ctx.rootDir, ctx.paths.mcpObservation, observation);

  return {
    status: 'ok',
    observationStatus: observation.status,
    adapterMode,
  };
}

module.exports = { verifyMcp };
