// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureDir, resolveRoot, writeJson, writeText } = require('../context');
const { renderAuthHelper, renderAuthTestSetup } = require('../renderer/playwright-auth-renderer');

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function authDisabled(ctx) {
  return ctx.command.noAuth || ctx.command.auth === 'false';
}

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

function runtimeCheckPaths(ctx) {
  const dir = `${ctx.paths.targetDir}/runtime-check`;
  return {
    dir,
    spec: `${dir}/runtime-check.spec.ts`,
    config: `${dir}/runtime-check.config.ts`,
    json: `${ctx.paths.targetDir}/runtime-check.json`,
    markdown: `${ctx.paths.targetDir}/runtime-check.md`,
    playwrightJson: `${dir}/runtime-check.playwright.json`,
    outputDir: `${dir}/test-results`,
  };
}

function writeRuntimeCheckFiles(ctx, paths) {
  const runtime = ctx.policies.playwright.runtime;
  const route = ctx.target.route;
  const authRequired = !authDisabled(ctx) && runtime.auth?.requiredDefault !== false;
  const baseURL = ctx.command.baseUrl || runtime.baseURL;
  const webServerCommand = ctx.command.webServerCommand || runtime.webServer.command;
  const absoluteDir = resolveRoot(ctx.rootDir, paths.dir);
  const absoluteOutputDir = resolveRoot(ctx.rootDir, paths.outputDir);
  const absolutePlaywrightJson = resolveRoot(ctx.rootDir, paths.playwrightJson);
  const absoluteResultJson = resolveRoot(ctx.rootDir, paths.json);
  ensureDir(absoluteDir);
  const authHelper = renderAuthHelper({
    targetId: ctx.target.targetId,
    route,
    missingCredentialsMessage: 'Missing E2E_USERNAME/E2E_PASSWORD for runtime check.',
  });

  const spec = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { test, expect } from 'playwright/test';",
    '',
    authHelper,
    renderAuthTestSetup(authRequired),
    '',
    'async function collectDiagnostics(page, consoleErrors, pageErrors) {',
    '  const dom = await page.evaluate(() => ({',
    '    url: location.href,',
    '    title: document.title,',
    '    bodyText: document.body?.innerText?.slice(0, 1000) || "",',
    '    bodyChildCount: document.body?.children?.length || 0,',
    '    inputs: Array.from(document.querySelectorAll("input, textarea, [contenteditable=\\"true\\"], [role=\\"textbox\\"]")).slice(0, 50).map((el) => ({',
    '      tag: el.tagName,',
    '      type: el.getAttribute("type"),',
    '      placeholder: el.getAttribute("placeholder"),',
    '      ariaLabel: el.getAttribute("aria-label"),',
    '      name: el.getAttribute("name"),',
    '    })),',
    '  })).catch((error) => ({ url: page.url(), error: String(error.message || error) }));',
    '  return { ...dom, consoleErrors, pageErrors };',
    '}',
    '',
    "test('common tester runtime route check', async ({ page }) => {",
    '  const consoleErrors = [];',
    '  const pageErrors = [];',
    "  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });",
    "  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));",
    '  let diagnostics = null;',
    '  try {',
    `    await ${authRequired ? 'gotoAuthenticated' : 'gotoRoute'}(page, ${JSON.stringify(route)});`,
    '    await page.waitForTimeout(3000);',
    '    diagnostics = await collectDiagnostics(page, consoleErrors, pageErrors);',
    `    fs.writeFileSync(${JSON.stringify(toPosix(absoluteResultJson))}, JSON.stringify({ status: 'ok', route: ${JSON.stringify(route)}, diagnostics }, null, 2));`,
    '    if (new URL(diagnostics.url).pathname.includes("/login") || diagnostics.bodyText.includes("운영자 로그인")) {',
    '      throw new Error("Still on login screen after authentication.");',
    '    }',
    '    expect(new URL(diagnostics.url).pathname).toBe(' + JSON.stringify(route) + ');',
    '    expect(diagnostics.bodyChildCount).toBeGreaterThan(0);',
    '    if (diagnostics.pageErrors.length) throw new Error(`Page errors during runtime check: ${diagnostics.pageErrors.slice(0, 3).join(" | ")}`);',
    '  } catch (error) {',
    '    diagnostics = diagnostics || await collectDiagnostics(page, consoleErrors, pageErrors);',
    `    fs.writeFileSync(${JSON.stringify(toPosix(absoluteResultJson))}, JSON.stringify({ status: 'failed', route: ${JSON.stringify(route)}, error: String(error.message || error), diagnostics }, null, 2));`,
    '    throw error;',
    '  }',
    '});',
    '',
  ].filter(Boolean).join('\n');

  const config = [
    "import { defineConfig } from 'playwright/test';",
    '',
    `const baseURL = process.env.COMMON_TESTER_BASE_URL || ${JSON.stringify(baseURL)};`,
    `const webServerCommand = process.env.COMMON_TESTER_WEB_SERVER_COMMAND || ${JSON.stringify(webServerCommand)};`,
    '',
    'export default defineConfig({',
    `  testDir: ${JSON.stringify(toPosix(absoluteDir))},`,
    `  testMatch: ${JSON.stringify(path.basename(paths.spec))},`,
    '  timeout: 180000,',
    '  expect: { timeout: 10000 },',
    `  outputDir: ${JSON.stringify(toPosix(absoluteOutputDir))},`,
    '  reporter: [',
    "    ['list'],",
    `    ['json', { outputFile: ${JSON.stringify(toPosix(absolutePlaywrightJson))} }],`,
    '  ],',
    '  use: {',
    '    baseURL,',
    '    headless: true,',
    "    trace: 'retain-on-failure',",
    "    screenshot: 'only-on-failure',",
    '  },',
    '  webServer: {',
    '    command: webServerCommand,',
    '    url: baseURL,',
    `    reuseExistingServer: ${runtime.webServer.reuseExistingServer === true ? 'true' : 'false'},`,
    `    timeout: ${Number(runtime.webServer.timeout || 120000)},`,
    '  },',
    '});',
    '',
  ].join('\n');

  writeText(ctx.rootDir, paths.spec, spec);
  writeText(ctx.rootDir, paths.config, config);
}

function writeRuntimeMarkdown(ctx, result, paths) {
  const diagnostics = result.diagnostics || {};
  const lines = [
    `# Runtime Check: ${ctx.target.targetId}`,
    '',
    `- status: ${result.status}`,
    `- route: ${ctx.target.route}`,
    `- url: ${diagnostics.url || '(unknown)'}`,
    `- body child count: ${diagnostics.bodyChildCount ?? '(unknown)'}`,
    `- input candidates: ${Array.isArray(diagnostics.inputs) ? diagnostics.inputs.length : 0}`,
    `- console errors: ${Array.isArray(diagnostics.consoleErrors) ? diagnostics.consoleErrors.length : 0}`,
    result.error ? `- error: ${result.error}` : '- error: (none)',
    diagnostics.bodyText ? `- body sample: ${String(diagnostics.bodyText).replace(/\s+/g, ' ').slice(0, 300)}` : '- body sample: (none)',
    '',
  ];
  writeText(ctx.rootDir, paths.markdown, `${lines.join('\n')}\n`);
}

async function verifyRuntime(ctx) {
  const canRun = (ctx.runPlan?.executableCaseCount || 0) > 0;
  const runtime = ctx.policies.playwright.runtime;
  const authRequired = !authDisabled(ctx) && runtime.auth?.requiredDefault !== false && canRun;
  const paths = runtimeCheckPaths(ctx);
  const result = {
    targetId: ctx.target.targetId,
    status: canRun ? 'not_run' : 'skipped',
    reason: canRun ? null : 'No executable cases.',
    route: ctx.target.route,
    json: paths.json,
    markdown: paths.markdown,
  };

  if (!canRun) {
    writeJson(ctx.rootDir, paths.json, result);
    writeRuntimeMarkdown(ctx, result, paths);
    ctx.runtimeCheck = result;
    return { status: 'ok', runtimeStatus: result.status };
  }

  if (ctx.command.skipPlaywrightRun || ctx.command.skipRuntimeCheck) {
    result.status = 'skipped';
    result.reason = ctx.command.skipRuntimeCheck
      ? 'Skipped by --skip-runtime-check.'
      : 'Skipped because --skip-playwright-run was set.';
    writeJson(ctx.rootDir, paths.json, result);
    writeRuntimeMarkdown(ctx, result, paths);
    ctx.runtimeCheck = result;
    return { status: 'ok', runtimeStatus: result.status };
  }

  if (authRequired && (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD)) {
    result.status = 'failed';
    result.reason = 'Missing E2E_USERNAME/E2E_PASSWORD for runtime check.';
    writeJson(ctx.rootDir, paths.json, result);
    writeRuntimeMarkdown(ctx, result, paths);
    ctx.runtimeCheck = result;
    return { status: 'failed', message: result.reason };
  }

  const cli = findPlaywrightCli(ctx.rootDir);
  if (!cli) {
    result.status = 'failed';
    result.reason = 'Playwright CLI not found.';
    writeJson(ctx.rootDir, paths.json, result);
    writeRuntimeMarkdown(ctx, result, paths);
    ctx.runtimeCheck = result;
    return { status: 'failed', message: result.reason };
  }

  for (const file of [paths.json, paths.playwrightJson]) {
    try {
      fs.rmSync(resolveRoot(ctx.rootDir, file), { force: true });
    } catch (_) {}
  }

  writeRuntimeCheckFiles(ctx, paths);
  const run = spawnSync(process.execPath, [cli, 'test', '--config', paths.config], {
    cwd: ctx.rootDir,
    encoding: 'utf8',
    timeout: 240000,
    shell: false,
  });

  let checkResult = null;
  try {
    checkResult = JSON.parse(fs.readFileSync(resolveRoot(ctx.rootDir, paths.json), 'utf8'));
  } catch (_) {
    checkResult = {
      status: run.status === 0 ? 'ok' : 'failed',
      route: ctx.target.route,
      error: run.error ? String(run.error.message || run.error) : 'Runtime check did not write result json.',
    };
  }

  checkResult.exitCode = run.status;
  checkResult.signal = run.signal || null;
  checkResult.stdout = run.stdout || '';
  checkResult.stderr = run.stderr || '';
  if (run.status !== 0) checkResult.status = 'failed';

  writeJson(ctx.rootDir, paths.json, checkResult);
  writeRuntimeMarkdown(ctx, checkResult, paths);
  ctx.runtimeCheck = checkResult;

  if (checkResult.status === 'failed') {
    return {
      status: 'failed',
      message: checkResult.error || checkResult.reason || 'Runtime check failed.',
    };
  }

  return {
    status: 'ok',
    runtimeStatus: checkResult.status,
    route: ctx.target.route,
    inputCandidates: checkResult.diagnostics?.inputs?.length || 0,
  };
}

module.exports = { verifyRuntime };
