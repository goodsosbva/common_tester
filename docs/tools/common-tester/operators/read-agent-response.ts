// @ts-nocheck
const fs = require('node:fs');
const {
  readYaml,
  resolveRoot,
} = require('../context');

async function readAgentResponse(ctx) {
  if (!fs.existsSync(resolveRoot(ctx.rootDir, ctx.paths.agentOutputContract))) {
    return {
      status: 'failed',
      message: `Missing ${ctx.paths.agentOutputContract}. Run prepare-agent before continue.`,
    };
  }
  const contract = readYaml(ctx.rootDir, ctx.paths.agentOutputContract);
  const required = contract.requiredFiles || [];
  const missing = required.filter((file) => !fs.existsSync(resolveRoot(ctx.rootDir, file)));
  if (missing.length) {
    return {
      status: 'failed',
      message: `Agent response is incomplete. Missing: ${missing.join(', ')}`,
    };
  }

  return {
    status: 'ok',
    responseDir: ctx.paths.agentResponseDir,
    requiredFileCount: required.length,
  };
}

module.exports = { readAgentResponse };
