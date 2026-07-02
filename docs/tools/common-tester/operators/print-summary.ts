// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const { readJson, readText, resolveRoot } = require('../context');

function exists(ctx, relativePath) {
  return fs.existsSync(resolveRoot(ctx.rootDir, relativePath));
}

function printFile(label, relativePath, content) {
  console.log(`[common-tester] ${label}=${relativePath}`);
  if (content) {
    console.log(content);
  }
}

async function printSummary(ctx) {
  const targetDirAbs = path.resolve(ctx.rootDir, ctx.paths.targetDir);
  console.log(`[common-tester] targetDir=${targetDirAbs}`);

  const resultPath = ctx.paths.resultMarkdown;
  const auditPath = `${ctx.paths.targetDir}/spec-audit.json`;
  const listedPath = ctx.paths.listedTests;
  const specPath = ctx.paths.generatedSpecFile;
  const reportDir = String(ctx.policies.playwright.runtime.reportDir || '')
    .replaceAll('{targetId}', ctx.target.targetId);
  const reportIndex = `${reportDir}/index.html`;

  const missing = [resultPath, auditPath, listedPath, specPath].filter((file) => !exists(ctx, file));
  if (missing.length) {
    console.log('[common-tester] missing_outputs=');
    for (const file of missing) console.log(`- ${file}`);
    return {
      status: 'failed',
      message: `Missing summary outputs: ${missing.join(', ')}`,
    };
  }

  const result = readText(ctx.rootDir, resultPath)
    .split(/\r?\n/)
    .slice(0, 24)
    .join('\n');
  printFile('result', resultPath, result);

  const audit = readJson(ctx.rootDir, auditPath, null);
  const listed = readJson(ctx.rootDir, listedPath, null);
  console.log('[common-tester] specAudit=' + JSON.stringify({
    status: audit?.status,
    generatedCaseCount: audit?.generatedCaseCount,
    renderedTestCount: audit?.renderedTestCount,
  }));
  console.log('[common-tester] listedTests=' + JSON.stringify({
    status: listed?.status,
    expectedExecutableCaseCount: listed?.expectedExecutableCaseCount,
    listedCaseCount: listed?.listedCaseCount,
    exitCode: listed?.exitCode,
  }));
  console.log(`[common-tester] generatedSpec=${specPath}`);
  console.log('[common-tester] playwrightReport=' + JSON.stringify({
    reportDir,
    exists: exists(ctx, reportIndex),
    note: exists(ctx, reportIndex)
      ? 'Report exists. You can run show-report.'
      : 'Report does not exist because Playwright test has not been run, or the run failed before report creation.',
  }));
  console.log(`[common-tester] runHeadedCommand=pnpm exec playwright test ${specPath} --config ${ctx.policies.playwright.runtime.configPath} --headed --workers=1`);
  console.log(`[common-tester] showReportCommand=npx playwright show-report ${reportDir}`);

  return {
    status: 'ok',
    targetDir: ctx.paths.targetDir,
    result: resultPath,
    specAudit: auditPath,
    listedTests: listedPath,
    generatedSpec: specPath,
    reportDir,
    reportExists: exists(ctx, reportIndex),
  };
}

module.exports = { printSummary };
