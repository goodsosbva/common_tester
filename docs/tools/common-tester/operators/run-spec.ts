// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureDir, resolveRoot, writeJson, writeText } = require('../context');

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function authDisabled(ctx) {
  return ctx.command.noAuth || ctx.command.auth === 'false';
}

function writePlaywrightConfig(ctx) {
  const runtime = ctx.policies.playwright.runtime;
  const targetId = ctx.target.targetId;
  const baseURL = ctx.command.baseUrl || runtime.baseURL;
  const webServerCommand = ctx.command.webServerCommand || runtime.webServer.command;
  const configPath = runtime.configPath;
  const outputDir = runtime.outputDir.replaceAll('{targetId}', targetId);
  const reportDir = runtime.reportDir.replaceAll('{targetId}', targetId);
  const jsonOutput = `${ctx.paths.resultsDir}/result.playwright.json`;
  const absoluteTestDir = resolveRoot(ctx.rootDir, path.dirname(ctx.paths.generatedSpecFile));
  const absoluteOutputDir = resolveRoot(ctx.rootDir, outputDir);
  const absoluteReportDir = resolveRoot(ctx.rootDir, reportDir);
  const absoluteJsonOutput = resolveRoot(ctx.rootDir, jsonOutput);
  const webServerEnv = runtime.webServer.env || {};
  const webServerEnvEntries = Object.entries(webServerEnv)
    .map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value == null ? '' : String(value))},`)
    .join('\n');

  ensureDir(resolveRoot(ctx.rootDir, path.dirname(configPath)));

  const config = [
    "import { defineConfig } from 'playwright/test';",
    '',
    `const baseURL = process.env.COMMON_TESTER_BASE_URL || ${JSON.stringify(baseURL)};`,
    `const webServerCommand = process.env.COMMON_TESTER_WEB_SERVER_COMMAND || ${JSON.stringify(webServerCommand)};`,
    '',
    'export default defineConfig({',
    `  testDir: ${JSON.stringify(toPosix(absoluteTestDir))},`,
    `  testMatch: ${JSON.stringify(path.basename(ctx.paths.generatedSpecFile))},`,
    `  timeout: ${Number(runtime.testTimeout || 90000)},`,
    `  expect: { timeout: ${Number(runtime.expectTimeout || 10000)} },`,
    `  outputDir: ${JSON.stringify(toPosix(absoluteOutputDir))},`,
    '  reporter: [',
    "    ['list'],",
    `    ['json', { outputFile: ${JSON.stringify(toPosix(absoluteJsonOutput))} }],`,
    `    ['html', { outputFolder: ${JSON.stringify(toPosix(absoluteReportDir))}, open: 'never' }],`,
    '  ],',
    '  use: {',
    '    baseURL,',
    '    headless: true,',
    "    trace: 'retain-on-failure',",
    "    screenshot: 'only-on-failure',",
    "    video: 'retain-on-failure',",
    '  },',
    '  webServer: {',
    '    command: webServerCommand,',
    '    url: baseURL,',
    `    reuseExistingServer: ${runtime.webServer.reuseExistingServer === true ? 'true' : 'false'},`,
    `    timeout: ${Number(runtime.webServer.timeout || 120000)},`,
    webServerEnvEntries ? '    env: {' : null,
    webServerEnvEntries || null,
    webServerEnvEntries ? '    },' : null,
    '  },',
    '});',
    '',
  ].join('\n');

  writeText(ctx.rootDir, configPath, config);
  return { configPath, outputDir, reportDir, jsonOutput };
}

async function runSpec(ctx) {
  const canRun = (ctx.runPlan?.executableCaseCount || 0) > 0;
  const runtime = ctx.policies.playwright.runtime;
  const explicitAuthRequired = (ctx.automationContract?.cases || []).some((testCase) => testCase.auth?.required === true && testCase.generate === true);
  const authRequired = !authDisabled(ctx) && (explicitAuthRequired || (runtime.auth?.requiredDefault !== false && canRun));
  const configInfo = writePlaywrightConfig(ctx);
  const result = {
    targetId: ctx.target.targetId,
    status: canRun ? 'not_run' : 'skipped',
    reason: canRun ? null : 'No generate:true cases in automation-contract.yaml.',
    command: ctx.policies.playwright.execution.command.replaceAll('{targetId}', ctx.target.targetId),
    config: configInfo,
    exitCode: null,
    stdout: '',
    stderr: '',
  };

  if (canRun && ctx.command.skipPlaywrightRun) {
    result.status = 'skipped';
    result.reason = 'Skipped by --skip-playwright-run.';
  } else if (canRun && authRequired && (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD)) {
    result.status = 'failed';
    result.reason = 'Missing E2E_USERNAME/E2E_PASSWORD for authenticated generated tests.';
  } else if (canRun) {
    let cli = null;
    try {
      cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
    } catch (error) {
      try {
        cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
      } catch (_) {
        cli = [
          path.join(ctx.rootDir, 'node_modules', '@playwright', 'test', 'cli.js'),
          path.join(ctx.rootDir, 'node_modules', 'playwright', 'cli.js'),
        ].find((candidate) => fs.existsSync(candidate));
      }
    }

    if (!fs.existsSync(cli)) {
      result.status = 'failed';
      result.reason = `Playwright CLI not found: ${cli}`;
    } else {
      const run = spawnSync(process.execPath, [cli, 'test', '--config', runtime.configPath], {
        cwd: ctx.rootDir,
        encoding: 'utf8',
        timeout: 240000,
        shell: false,
      });

      result.exitCode = run.status;
      result.signal = run.signal || null;
      result.error = run.error ? String(run.error.message || run.error) : null;
      result.stdout = run.stdout || '';
      result.stderr = run.stderr || '';
      result.status = run.status === 0 ? 'passed' : 'failed';
      result.reason = run.status === 0 ? null : 'Playwright test command failed.';
    }
  }

  ctx.runResult = result;
  writeJson(ctx.rootDir, ctx.paths.resultJson, result);

  return {
    status: 'ok',
    runStatus: result.status,
    exitCode: result.exitCode,
  };
}

module.exports = { runSpec };
