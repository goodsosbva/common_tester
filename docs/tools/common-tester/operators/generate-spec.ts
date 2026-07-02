// @ts-nocheck
const path = require('node:path');
const { ensureDir, readYaml, resolveRoot, toPosix, writeText } = require('../context');
const { renderSpec } = require('../renderer/playwright-renderer');

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
  return configPath;
}

async function generateSpec(ctx) {
  const pageContract = ctx.pageContract || readYaml(ctx.rootDir, ctx.paths.pageContract);
  const automationContract = ctx.automationContract || readYaml(ctx.rootDir, ctx.paths.automationContract);
  const explicitAuthRequired = (automationContract.cases || []).some((testCase) => testCase.auth?.required === true && testCase.generate === true);
  const authRequired = !authDisabled(ctx) && (explicitAuthRequired || ctx.policies.playwright.runtime.auth?.requiredDefault !== false);
  const spec = renderSpec(automationContract, { pageContract, authRequired });

  ctx.pageContract = pageContract;
  ctx.automationContract = automationContract;
  ctx.generatedSpec = spec;
  writeText(ctx.rootDir, ctx.paths.generatedSpecFile, spec);
  const configPath = writePlaywrightConfig(ctx);

  return {
    status: 'ok',
    specFile: ctx.paths.generatedSpecFile,
    configPath,
    renderedCaseCount: automationContract.cases?.length || 0,
  };
}

module.exports = { generateSpec };
