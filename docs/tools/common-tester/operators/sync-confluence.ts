// @ts-nocheck
const { hashJson, writeJson } = require('../context');

async function syncConfluence(ctx) {
  const policy = ctx.policies.confluence;
  const emailEnv = policy.auth.emailEnv;
  const tokenEnv = policy.auth.tokenEnv;
  const hasEmail = Boolean(process.env[emailEnv]);
  const hasToken = Boolean(process.env[tokenEnv]);
  const canRead = policy.read && policy.read.readOnly === true;

  const status = canRead && hasEmail && hasToken ? 'pending_implementation' : 'skipped_missing_env';
  const sourceIndex = {
    status,
    readOnly: canRead,
    baseUrl: policy.baseUrl,
    rootPages: policy.rootPages,
    auth: {
      emailEnv,
      tokenEnv,
      hasEmail,
      hasToken,
    },
    matchedSources: [],
    sourceSetHash: hashJson({
      status,
      rootPages: policy.rootPages,
      target: ctx.target,
    }),
    message:
      status === 'skipped_missing_env'
        ? `Set ${emailEnv} and ${tokenEnv} to enable Confluence sync.`
        : 'Confluence API sync is the next implementation slice.',
  };

  ctx.sourceIndex = sourceIndex;
  writeJson(ctx.rootDir, ctx.paths.sourceIndex, sourceIndex);

  return {
    status: 'ok',
    confluenceStatus: status,
    sourceSetHash: sourceIndex.sourceSetHash,
  };
}

module.exports = { syncConfluence };
