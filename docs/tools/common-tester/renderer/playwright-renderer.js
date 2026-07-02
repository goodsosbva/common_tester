const { renderSelector } = require('./selector-renderer');
const { renderAuthHelper, renderAuthTestSetup } = require('./playwright-auth-renderer');

function indent(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');
}

function getByPath(value, dotPath) {
  return String(dotPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function resolveValue(value, fixtures = {}) {
  if (value == null) return '';
  if (typeof value !== 'object') return value;
  if (value.source === 'literal') return value.value;
  if (value.source === 'fixture') return getByPath(fixtures, value.path);
  if (value.source === 'generated') {
    const prefix = value.prefix || 'common-tester';
    return `${prefix}-${Date.now()}`;
  }
  if (value.source === 'env') return process.env[value.name] || '';
  return value.value || '';
}

function renderTargetRef(pageContract, targetRef) {
  const element = getByPath(pageContract, targetRef);
  if (!element) throw new Error(`targetRef not found: ${targetRef}`);
  const selector = element.selectors?.[0];
  if (!selector) throw new Error(`selector not found for targetRef: ${targetRef}`);
  return renderSelector(selector);
}

function renderInputValue(value) {
  return JSON.stringify(value == null ? '' : String(value));
}

function renderTargetLabel(pageContract, targetRef) {
  const element = getByPath(pageContract, targetRef);
  return element?.label || element?.name || element?.text || element?.placeholder || element?.title || targetRef || '대상';
}

function renderReadableValue(value, fixtures = {}) {
  const resolved = resolveValue(value, fixtures);
  if (resolved == null || resolved === '') return '빈 값';
  return `"${String(resolved)}"`;
}

function describeStepForTitle(step, ctx) {
  if (step.kind === 'goto' || step.action === 'page.goto') return null;
  if (step.action === 'input.clear') {
    return `${renderTargetLabel(ctx.pageContract, step.targetRef)} 값을 비움`;
  }
  if (step.action === 'input.press') {
    return `${renderTargetLabel(ctx.pageContract, step.targetRef)}에서 ${step.key || 'Enter'} 키 입력`;
  }
  if (step.action === 'input.fill') {
    return `${renderTargetLabel(ctx.pageContract, step.targetRef)}에 ${renderReadableValue(step.value, ctx.fixtures)} 입력`;
  }
  if (step.action === 'button.click' || step.action === 'control.click') {
    return `${renderTargetLabel(ctx.pageContract, step.targetRef)} 클릭`;
  }
  if (step.action === 'dropdown.selectFirst') {
    return `${renderTargetLabel(ctx.pageContract, step.targetRef)} 첫 항목 선택`;
  }
  if (step.kind === 'fill') return `${renderReadableValue(step.value, ctx.fixtures)} 입력`;
  if (step.kind === 'click') return '클릭';
  return null;
}

function describeAssertionForTitle(assertion, ctx) {
  if (assertion.action === 'expect.value') {
    return `${renderTargetLabel(ctx.pageContract, assertion.targetRef)} 값이 ${renderReadableValue(assertion.value, ctx.fixtures)}인지 확인`;
  }
  if (assertion.action === 'expect.textVisible') {
    return `${renderReadableValue(assertion.text, ctx.fixtures)} 문구가 표시되는지 확인`;
  }
  if (assertion.action === 'expect.textMatches') {
    return `/${assertion.pattern || assertion.textRegex || ''}/ 패턴 문구가 표시되는지 확인`;
  }
  if (assertion.action === 'expect.textHidden') {
    return `${renderReadableValue(assertion.text, ctx.fixtures)} 문구가 숨겨지는지 확인`;
  }
  if (assertion.action === 'expect.visible') {
    return `${renderTargetLabel(ctx.pageContract, assertion.targetRef)} 표시 여부 확인`;
  }
  if (assertion.action === 'expect.enabled') {
    return `${renderTargetLabel(ctx.pageContract, assertion.targetRef)} 활성화 여부 확인`;
  }
  return null;
}

function buildReadableTestTitle(testCase, ctx) {
  const steps = (testCase.steps || [])
    .map((step) => describeStepForTitle(step, ctx))
    .filter(Boolean)
    .slice(0, 4);
  const assertions = (testCase.assertions || [])
    .map((assertion) => describeAssertionForTitle(assertion, ctx))
    .filter(Boolean)
    .slice(0, 2);

  if (!steps.length && !assertions.length) return testCase.title || testCase.id || '제목 없음';
  const actionPart = steps.length ? steps.join(', ') : (testCase.title || testCase.id || '동작');
  const assertionPart = assertions.length ? `${assertions.join(', ')}` : '결과 확인';
  const title = `${actionPart} 후 ${assertionPart}`;
  return title.length > 180 ? `${title.slice(0, 177)}...` : title;
}

function renderActionableCheck(selector, label) {
  const message = `${label} must be visible and enabled before action`;
  return [
    `await expect(${selector}, ${JSON.stringify(message)}).toBeVisible({ timeout: ACTION_TIMEOUT });`,
    `await expect(${selector}, ${JSON.stringify(message)}).toBeEnabled({ timeout: ACTION_TIMEOUT });`,
  ].join('\n');
}

function renderStep(step, ctx) {
  if (step.kind === 'goto') {
    return `await ${ctx.authRequired ? 'gotoAuthenticated' : 'gotoRoute'}(page, ${JSON.stringify(step.url)});`;
  }

  if (step.action === 'page.goto') {
    return `await ${ctx.authRequired ? 'gotoAuthenticated' : 'gotoRoute'}(page, ${JSON.stringify(step.route)});`;
  }

  if (step.action === 'input.clear') {
    const selector = renderTargetRef(ctx.pageContract, step.targetRef);
    return [
      renderActionableCheck(selector, `${step.action}:${step.targetRef}`),
      `await ${selector}.clear({ timeout: ACTION_TIMEOUT });`,
    ].join('\n');
  }

  if (step.action === 'input.press') {
    const selector = renderTargetRef(ctx.pageContract, step.targetRef);
    return [
      renderActionableCheck(selector, `${step.action}:${step.targetRef}`),
      `await ${selector}.press(${JSON.stringify(step.key || 'Enter')}, { timeout: ACTION_TIMEOUT });`,
    ].join('\n');
  }

  if (step.action === 'button.click' || step.action === 'control.click') {
    const selector = renderTargetRef(ctx.pageContract, step.targetRef);
    return [
      renderActionableCheck(selector, `${step.action}:${step.targetRef}`),
      `await ${selector}.click({ timeout: ACTION_TIMEOUT });`,
    ].join('\n');
  }

  if (step.action === 'dropdown.selectFirst') {
    const selector = renderTargetRef(ctx.pageContract, step.targetRef);
    return [
      renderActionableCheck(selector, `${step.action}:${step.targetRef}`),
      `await ${selector}.click({ timeout: ACTION_TIMEOUT });`,
      `await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:not(.ant-select-item-option-disabled)').first().click({ timeout: ACTION_TIMEOUT });`,
    ].join('\n');
  }

  if (step.action === 'input.fill') {
    const value = resolveValue(step.value, ctx.fixtures);
    const selector = renderTargetRef(ctx.pageContract, step.targetRef);
    return [
      step.options?.clearBefore ? `await ${selector}.clear();` : null,
      `await visibleFill(${selector}, ${renderInputValue(value)});`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (step.kind === 'fill') {
    const selector = renderSelector(step.selector);
    return [
      renderActionableCheck(selector, step.kind),
      `await ${selector}.fill(${JSON.stringify(step.value)}, { timeout: ACTION_TIMEOUT });`,
    ].join('\n');
  }

  if (step.kind === 'expectValue') {
    return `await expect(${renderSelector(step.selector)}).toHaveValue(${JSON.stringify(step.value)});`;
  }

  if (step.kind === 'expectVisible') {
    return `await expect(${renderSelector(step.selector)}).toBeVisible();`;
  }

  if (step.kind === 'click') {
    const selector = renderSelector(step.selector);
    return [
      renderActionableCheck(selector, step.kind),
      `await ${selector}.click({ timeout: ACTION_TIMEOUT });`,
    ].join('\n');
  }

  throw new Error(`Unsupported step kind: ${step.kind}`);
}

function renderAssertion(assertion, ctx) {
  if (assertion.action === 'expect.value') {
    if (!Object.prototype.hasOwnProperty.call(assertion, 'value')) {
      throw new Error(`expect.value assertion requires value for targetRef: ${assertion.targetRef}`);
    }
    return `await expect(${renderTargetRef(ctx.pageContract, assertion.targetRef)}).toHaveValue(${JSON.stringify(resolveValue(assertion.value, ctx.fixtures))});`;
  }

  if (assertion.action === 'expect.textVisible') {
    const text = resolveValue(assertion.text, ctx.fixtures);
    return `await expect(page.getByText(${JSON.stringify(text)}, { exact: ${assertion.exact !== false} }).first()).toBeVisible();`;
  }

  if (assertion.action === 'expect.textMatches') {
    const pattern = resolveValue(assertion.pattern || assertion.textRegex, ctx.fixtures);
    if (!pattern) throw new Error('expect.textMatches assertion requires pattern.');
    return `await expect(page.getByText(new RegExp(${JSON.stringify(pattern)})).first()).toBeVisible();`;
  }

  if (assertion.action === 'expect.textHidden') {
    const text = resolveValue(assertion.text, ctx.fixtures);
    return `await expect(page.getByText(${JSON.stringify(text)}, { exact: ${assertion.exact !== false} }).first()).toBeHidden();`;
  }

  if (assertion.action === 'expect.visible') {
    return `await expect(${renderTargetRef(ctx.pageContract, assertion.targetRef)}).toBeVisible();`;
  }

  if (assertion.action === 'expect.enabled') {
    return `await expect(${renderTargetRef(ctx.pageContract, assertion.targetRef)}).toBeEnabled();`;
  }

  throw new Error(`Unsupported assertion action: ${assertion.action}`);
}

function hasGotoStep(steps) {
  return steps.some((step) => step.action === 'page.goto' || step.kind === 'goto');
}

function renderSourceRef(ref) {
  const parts = [
    ref.candidateId ? `candidateId=${ref.candidateId}` : null,
    ref.policyUnitId ? `policyUnitId=${ref.policyUnitId}` : null,
    ref.pageId ? `pageId=${ref.pageId}` : null,
    ref.titlePath ? `titlePath=${Array.isArray(ref.titlePath) ? ref.titlePath.join(' > ') : ref.titlePath}` : null,
  ].filter(Boolean);
  return `// sourceRef: ${parts.join('; ')}`;
}

function renderCase(testCase, options = {}) {
  const shouldRun = testCase.generate === true || options.forceExecutable === true;
  const testFn = shouldRun ? 'test' : 'test.skip';
  const steps = [...(testCase.steps || [])];
  if (shouldRun && !hasGotoStep(steps) && options.route) {
    steps.unshift({ action: 'page.goto', route: options.route });
  }
  const ctx = {
    pageContract: options.pageContract || {},
    fixtures: options.fixtures || {},
    authRequired: options.authRequired !== false && testCase.auth?.required !== false,
  };
  const body = [
    ...steps.map((step) => renderStep(step, ctx)),
    ...(testCase.assertions || []).map((assertion) => renderAssertion(assertion, ctx)),
  ].join('\n');
  const comments = [`// caseId: ${testCase.id || 'unknown'}`];
  for (const ref of testCase.sourceRefs || []) {
    comments.push(renderSourceRef(ref));
  }

  if (!shouldRun) {
    comments.push(`// status: ${testCase.status || 'not_executable'}`);
    comments.push(`// selectorStatus: ${testCase.selectorStatus || 'unknown'}`);
  }

  const readableTitle = buildReadableTestTitle(testCase, ctx);
  const testTitle = testCase.id ? `${readableTitle} [${testCase.id}]` : readableTitle;

  return [
    `  ${testFn}(${JSON.stringify(testTitle)}, async ({ page }) => {`,
    ...comments.map((line) => indent(line, 4)),
    indent(body, 4),
    '  });',
  ].join('\n');
}

function renderFailureScreenshotHook() {
  return [
    'test.afterEach(async ({ page }, testInfo) => {',
    '  if (testInfo.status === testInfo.expectedStatus) return;',
    '  if (page.url() === "about:blank") return;',
    '  const screenshotPath = testInfo.outputPath("failure-screenshot.png");',
    '  try {',
    '    await page.screenshot({ path: screenshotPath, fullPage: true });',
    '    if (fs.existsSync(screenshotPath)) {',
    '      await testInfo.attach("failure screenshot", { path: screenshotPath, contentType: "image/png" });',
    '    }',
    '  } catch (_) {}',
    '});',
    '',
  ].join('\n');
}

function renderSpec(contract, options = {}) {
  const cases = contract.cases || [];
  const route = contract.route || options.route || '/';
  const authRequired = options.authRequired !== false;
  const authHelper = renderAuthHelper({
    targetId: contract.targetId,
    route,
    missingCredentialsMessage: 'Missing E2E_USERNAME/E2E_PASSWORD for authenticated generated tests.',
  });
  return [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { test, expect } from 'playwright/test';",
    '',
    authHelper,
    renderAuthTestSetup(authRequired),
    renderFailureScreenshotHook(),
    `test.describe(${JSON.stringify(contract.targetId)}, () => {`,
    cases.map((testCase) => renderCase(testCase, { ...options, fixtures: contract.fixtures || {}, route: contract.route })).join('\n\n'),
    '});',
    '',
  ].join('\n');
}

module.exports = { renderSpec };
