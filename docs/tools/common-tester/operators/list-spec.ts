// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readJson, resolveRoot, writeJson } = require('../context');

function findPlaywrightCli(rootDir) {
  try {
    return path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  } catch (error) {
    try {
      return path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    } catch (_) {
      const candidates = [
        path.join(rootDir, 'node_modules', '@playwright', 'test', 'cli.js'),
        path.join(rootDir, 'node_modules', 'playwright', 'cli.js'),
      ];
      return candidates.find((candidate) => fs.existsSync(candidate)) || null;
    }
  }
}

function hasFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory() && hasFiles(fullPath)) return true;
  }
  return false;
}

function removeIfEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  if (hasFiles(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function cleanListOnlyArtifacts(ctx) {
  const resultsDir = resolveRoot(ctx.rootDir, ctx.paths.resultsDir);
  removeIfEmpty(path.join(resultsDir, 'test-results'));
  removeIfEmpty(path.join(resultsDir, 'playwright-report'));
}

async function listSpec(ctx) {
  const runPlan = ctx.runPlan || readJson(ctx.rootDir, ctx.paths.runPlan, null);
  const expected = runPlan?.executableCaseCount || 0;
  const cli = findPlaywrightCli(ctx.rootDir);
  const result = {
    targetId: ctx.target.targetId,
    status: 'not_run',
    expectedExecutableCaseCount: expected,
    listedCaseCount: null,
    command: null,
    stdout: '',
    stderr: '',
  };

  const configPath = ctx.policies.playwright.runtime.configPath;
  const hasConfig = fs.existsSync(resolveRoot(ctx.rootDir, configPath));

  if (!cli || !hasConfig || ctx.command.skipPlaywrightList) {
    const spec = fs.readFileSync(resolveRoot(ctx.rootDir, ctx.paths.generatedSpecFile), 'utf8');
    const fallbackCount = (spec.match(/\n\s*test\(/g) || []).length;
    result.status = fallbackCount === expected ? 'passed_fallback' : 'failed';
    result.listedCaseCount = fallbackCount;
    result.reason = ctx.command.skipPlaywrightList
      ? 'Skipped by --skip-playwright-list.'
      : !cli
        ? 'Playwright CLI not found; counted rendered test() calls.'
        : `Playwright config not found: ${configPath}; counted rendered test() calls.`;
  } else {
    result.command = `${process.execPath} ${cli} test --config ${configPath} --list --reporter=list`;
    const run = spawnSync(process.execPath, [cli, 'test', '--config', configPath, '--list', '--reporter=list'], {
      cwd: ctx.rootDir,
      encoding: 'utf8',
      timeout: 120000,
      shell: false,
    });
    result.stdout = run.stdout || '';
    result.stderr = run.stderr || '';
    result.exitCode = run.status;
    const totalMatch = result.stdout.match(/Total:\s+(\d+)\s+tests?/i);
    const listed = totalMatch ? Number(totalMatch[1]) : (result.stdout.match(/^\s+.+\.spec\.[tj]s:/gm) || []).length;
    result.listedCaseCount = listed;
    result.status = run.status === 0 && listed === expected ? 'passed' : 'failed';
    result.reason = result.status === 'failed' ? 'Listed Playwright tests did not match run-plan executable case count.' : null;
  }

  cleanListOnlyArtifacts(ctx);

  ctx.listSpecResult = result;
  writeJson(ctx.rootDir, ctx.paths.listedTests, result);

  if (result.status === 'failed') {
    return {
      status: 'failed',
      message: result.reason || 'Spec list validation failed.',
    };
  }

  return {
    status: 'ok',
    listStatus: result.status,
    expected,
    listed: result.listedCaseCount,
  };
}

module.exports = { listSpec };
