// @ts-nocheck
const { writeJson } = require('../context');

async function decideReuse(ctx) {
  const targetId = ctx.target.targetId;
  const previous = ctx.lock.targets?.[targetId] || null;
  const currentHash = ctx.sourceIndex?.sourceSetHash || null;
  const reusable = Boolean(previous && previous.sourceSetHash === currentHash);
  const decision = {
    targetId,
    reusable,
    reasons: reusable
      ? ['sourceSetHash unchanged']
      : ['no reusable requirements yet or sourceSetHash changed'],
    previous: previous
      ? {
          sourceSetHash: previous.sourceSetHash,
          requirementsHash: previous.requirementsHash,
        }
      : null,
    current: {
      sourceSetHash: currentHash,
    },
  };

  ctx.reuseDecision = decision;
  writeJson(ctx.rootDir, ctx.paths.reuseDecision, decision);

  return {
    status: 'ok',
    reusable,
  };
}

module.exports = { decideReuse };
