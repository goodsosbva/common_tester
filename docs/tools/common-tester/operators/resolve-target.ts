// @ts-nocheck
const path = require('node:path');
const {
  createTargetPaths,
  ensureDir,
  resolveRoot,
  slugify,
  writeJson,
} = require('../context');

function normalizeGitBashPathConvertedRoute(value) {
  if (!value) return value;
  const text = String(value);
  const match = text.match(/^[A-Za-z]:\/Program Files\/Git(\/.*)$/);
  if (match) return match[1];
  return text;
}

async function resolveTarget(ctx) {
  const route = normalizeGitBashPathConvertedRoute(ctx.command.route) || null;
  const targetName = ctx.command.target || ctx.command._?.join(' ') || route;

  if (!route && !targetName) {
    return {
      status: 'failed',
      message: 'Pass --route "/path" or a target name.',
    };
  }

  const targetId = slugify(route || targetName);
  ctx.target = {
    targetId,
    route,
    targetName,
    action: ctx.command.action,
    createdAt: new Date().toISOString(),
  };
  ctx.paths = createTargetPaths(ctx);

  ensureDir(resolveRoot(ctx.rootDir, ctx.paths.targetDir));
  ensureDir(resolveRoot(ctx.rootDir, ctx.paths.generatedSpecDir));
  ensureDir(resolveRoot(ctx.rootDir, ctx.paths.resultsDir));
  writeJson(ctx.rootDir, ctx.paths.target, ctx.target);

  return {
    status: 'ok',
    targetId,
    targetDir: path.resolve(ctx.rootDir, ctx.paths.targetDir),
  };
}

module.exports = { resolveTarget };
