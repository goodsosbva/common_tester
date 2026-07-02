// @ts-nocheck
const fs = require('node:fs');
const { hashText, readText, readYaml, resolveRoot, writeJson, writeText } = require('../context');

function readOptional(ctx, relativePath) {
  if (!relativePath || !fs.existsSync(resolveRoot(ctx.rootDir, relativePath))) return '';
  return readText(ctx.rootDir, relativePath);
}

function readYamlOptional(ctx, relativePath) {
  if (!relativePath || !fs.existsSync(resolveRoot(ctx.rootDir, relativePath))) return null;
  return readYaml(ctx.rootDir, relativePath);
}

function getByPath(value, dotPath) {
  return String(dotPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function renderTargetName(pageContract, targetRef) {
  const element = getByPath(pageContract, targetRef);
  const label = element?.label || element?.name || element?.text || element?.placeholder || element?.title;
  return label ? `${label} (${targetRef})` : targetRef || '(대상 없음)';
}

function renderTargetLabel(pageContract, targetRef) {
  const element = getByPath(pageContract, targetRef);
  return element?.label || element?.name || element?.text || element?.placeholder || element?.title || targetRef || '대상';
}

function renderValue(value) {
  if (value == null) return '빈 값';
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (value.source === 'literal') return value.value === '' ? '빈 값' : JSON.stringify(String(value.value));
  if (value.source === 'fixture') return `fixture:${value.path || '(path 없음)'}`;
  if (value.source === 'generated') return `자동 생성값(${value.prefix || 'common-tester'}-timestamp)`;
  if (value.source === 'env') return `환경변수 ${value.name || '(name 없음)'}`;
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return JSON.stringify(String(value.value));
  return JSON.stringify(value);
}

function renderStepLine(step, pageContract) {
  if (step.kind === 'goto') return `이동: ${step.url}`;
  if (step.action === 'page.goto') return `이동: ${step.route}`;
  if (step.action === 'input.clear') return `입력값 삭제: ${renderTargetName(pageContract, step.targetRef)}`;
  if (step.action === 'input.press') return `키 입력: ${renderTargetName(pageContract, step.targetRef)} / ${step.key || 'Enter'}`;
  if (step.action === 'input.fill') {
    return `입력: ${renderTargetName(pageContract, step.targetRef)} = ${renderValue(step.value)}`;
  }
  if (step.action === 'button.click' || step.action === 'control.click') {
    return `클릭: ${renderTargetName(pageContract, step.targetRef)}`;
  }
  if (step.action === 'dropdown.selectFirst') {
    return `드롭다운 첫 항목 선택: ${renderTargetName(pageContract, step.targetRef)}`;
  }
  if (step.kind === 'fill') return `입력: ${renderValue(step.value)}`;
  if (step.kind === 'click') return '클릭';
  return `${step.action || step.kind || '알 수 없는 동작'}: ${JSON.stringify(step)}`;
}

function renderAssertionLine(assertion, pageContract) {
  if (assertion.action === 'expect.value') {
    return `기대값: ${renderTargetName(pageContract, assertion.targetRef)} 값이 ${renderValue(assertion.value)}`;
  }
  if (assertion.action === 'expect.textVisible') {
    return `기대문구 표시: ${renderValue(assertion.text)}`;
  }
  if (assertion.action === 'expect.textMatches') {
    return `기대문구 패턴 표시: /${assertion.pattern || assertion.textRegex || ''}/`;
  }
  if (assertion.action === 'expect.textHidden') {
    return `기대문구 숨김: ${renderValue(assertion.text)}`;
  }
  if (assertion.action === 'expect.visible') {
    return `표시 확인: ${renderTargetName(pageContract, assertion.targetRef)}`;
  }
  if (assertion.action === 'expect.enabled') {
    return `활성화 확인: ${renderTargetName(pageContract, assertion.targetRef)}`;
  }
  return `${assertion.action || '알 수 없는 검증'}: ${JSON.stringify(assertion)}`;
}

function renderTitleValue(value) {
  if (value == null) return '빈 값';
  if (typeof value !== 'object') return value === '' ? '빈 값' : `"${String(value)}"`;
  if (value.source === 'literal') return value.value === '' ? '빈 값' : `"${String(value.value)}"`;
  if (value.source === 'fixture') return `fixture:${value.path || '(path 없음)'}`;
  if (value.source === 'generated') return `자동 생성값(${value.prefix || 'common-tester'}-timestamp)`;
  if (value.source === 'env') return `환경변수 ${value.name || '(name 없음)'}`;
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value === '' ? '빈 값' : `"${String(value.value)}"`;
  return JSON.stringify(value);
}

function renderStepTitle(step, pageContract) {
  if (step.kind === 'goto' || step.action === 'page.goto') return null;
  if (step.action === 'input.clear') return `${renderTargetLabel(pageContract, step.targetRef)} 값을 비움`;
  if (step.action === 'input.press') return `${renderTargetLabel(pageContract, step.targetRef)}에서 ${step.key || 'Enter'} 키 입력`;
  if (step.action === 'input.fill') return `${renderTargetLabel(pageContract, step.targetRef)}에 ${renderTitleValue(step.value)} 입력`;
  if (step.action === 'button.click' || step.action === 'control.click') return `${renderTargetLabel(pageContract, step.targetRef)} 클릭`;
  if (step.action === 'dropdown.selectFirst') return `${renderTargetLabel(pageContract, step.targetRef)} 첫 항목 선택`;
  if (step.kind === 'fill') return `${renderTitleValue(step.value)} 입력`;
  if (step.kind === 'click') return '클릭';
  return null;
}

function renderAssertionTitle(assertion, pageContract) {
  if (assertion.action === 'expect.value') {
    return `${renderTargetLabel(pageContract, assertion.targetRef)} 값이 ${renderTitleValue(assertion.value)}인지 확인`;
  }
  if (assertion.action === 'expect.textVisible') return `${renderTitleValue(assertion.text)} 문구가 표시되는지 확인`;
  if (assertion.action === 'expect.textMatches') return `/${assertion.pattern || assertion.textRegex || ''}/ 패턴 문구가 표시되는지 확인`;
  if (assertion.action === 'expect.textHidden') return `${renderTitleValue(assertion.text)} 문구가 숨겨지는지 확인`;
  if (assertion.action === 'expect.visible') return `${renderTargetLabel(pageContract, assertion.targetRef)} 표시 여부 확인`;
  if (assertion.action === 'expect.enabled') return `${renderTargetLabel(pageContract, assertion.targetRef)} 활성화 여부 확인`;
  return null;
}

function buildReadableTestTitle(testCase, pageContract) {
  const steps = (testCase.steps || [])
    .map((step) => renderStepTitle(step, pageContract))
    .filter(Boolean)
    .slice(0, 4);
  const assertions = (testCase.assertions || [])
    .map((assertion) => renderAssertionTitle(assertion, pageContract))
    .filter(Boolean)
    .slice(0, 2);

  if (!steps.length && !assertions.length) return testCase.title || testCase.id || '제목 없음';
  const actionPart = steps.length ? steps.join(', ') : (testCase.title || testCase.id || '동작');
  const assertionPart = assertions.length ? assertions.join(', ') : '결과 확인';
  const title = `${actionPart} 후 ${assertionPart}`;
  return title.length > 180 ? `${title.slice(0, 177)}...` : title;
}

function renderSourceRefLine(ref) {
  const parts = [
    ref.candidateId ? `candidateId=${ref.candidateId}` : null,
    ref.policyUnitId ? `policyUnitId=${ref.policyUnitId}` : null,
    ref.pageId ? `pageId=${ref.pageId}` : null,
    ref.titlePath ? `titlePath=${Array.isArray(ref.titlePath) ? ref.titlePath.join(' > ') : ref.titlePath}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : JSON.stringify(ref);
}

function renderInputCaseRef(ref) {
  if (ref == null) return '(none)';
  if (typeof ref !== 'object') return String(ref);
  const parts = [ref.rowId, ref.inputId].filter(Boolean);
  return parts.length ? parts.join('::') : JSON.stringify(ref);
}

function writeTestScenarios(ctx) {
  const automationContract = ctx.automationContract || readYamlOptional(ctx, ctx.paths.automationContract) || {};
  const pageContract = ctx.pageContract || readYamlOptional(ctx, ctx.paths.pageContract) || {};
  const cases = automationContract.cases || [];
  const scenarioPath = `${ctx.paths.targetDir}/test-scenarios.md`;
  const executableCases = cases.filter((testCase) => testCase.generate === true);

  const lines = [
    `# 테스트 시나리오 설명: ${ctx.target.targetId}`,
    '',
    `- route: ${ctx.target.route || automationContract.route || '(none)'}`,
    `- 전체 케이스: ${cases.length}`,
    `- 실행 케이스: ${executableCases.length}`,
    '',
    '이 문서는 생성된 Playwright 코드를 보지 않고도 각 테스트가 무엇을 입력하고 무엇을 검증하는지 확인하기 위한 요약입니다.',
    '',
  ];

  cases.forEach((testCase, index) => {
    lines.push(`## ${index + 1}. ${buildReadableTestTitle(testCase, pageContract)}`);
    lines.push('');
    if (testCase.title) {
      lines.push(`- 원본 제목: ${testCase.title}`);
    }
    lines.push(`- caseId: ${testCase.id || '(none)'}`);
    lines.push(`- 실행 여부: ${testCase.generate === true ? '실행' : '미실행'}`);
    lines.push(`- capability: ${testCase.capability || '(none)'}`);
    if (Array.isArray(testCase.coversIntents) && testCase.coversIntents.length) {
      lines.push(`- 검증 의도: ${testCase.coversIntents.join(', ')}`);
    }
    if (Array.isArray(testCase.coversInputCases) && testCase.coversInputCases.length) {
      lines.push(`- 입력 케이스: ${testCase.coversInputCases.map(renderInputCaseRef).join(', ')}`);
    }
    if (Array.isArray(testCase.coversMatrixRows) && testCase.coversMatrixRows.length) {
      lines.push(`- 커버리지 행: ${testCase.coversMatrixRows.join(', ')}`);
    }
    lines.push('');
    lines.push('### 동작');
    const steps = testCase.steps || [];
    if (steps.length) {
      steps.forEach((step, stepIndex) => {
        lines.push(`${stepIndex + 1}. ${renderStepLine(step, pageContract)}`);
      });
    } else {
      lines.push('- 동작 없음');
    }
    lines.push('');
    lines.push('### 기대 결과');
    const assertions = testCase.assertions || [];
    if (assertions.length) {
      assertions.forEach((assertion) => {
        lines.push(`- ${renderAssertionLine(assertion, pageContract)}`);
      });
    } else {
      lines.push('- 기대 결과 없음');
    }
    if (Array.isArray(testCase.sourceRefs) && testCase.sourceRefs.length) {
      lines.push('');
      lines.push('### 근거');
      testCase.sourceRefs.forEach((ref) => {
        lines.push(`- ${renderSourceRefLine(ref)}`);
      });
    }
    lines.push('');
  });

  writeText(ctx.rootDir, scenarioPath, `${lines.join('\n')}\n`);
  return scenarioPath;
}

async function writeReport(ctx) {
  const sourceIndex = readOptional(ctx, ctx.paths.sourceIndex) ? JSON.parse(readOptional(ctx, ctx.paths.sourceIndex)) : {};
  const elementInventory = readYamlOptional(ctx, ctx.paths.elementInventory) || {};
  const codeRefCount = (elementInventory.fields || []).reduce((sum, field) => sum + (field.codeRefs || []).length, 0);
  const testScenariosPath = writeTestScenarios(ctx);
  const report = [
    `# Common Tester Result: ${ctx.target.targetId}`,
    '',
    `- route: ${ctx.target.route || '(none)'}`,
    `- target dir: ${ctx.paths.targetDir}`,
    `- project analysis owner: agent`,
    `- agent inventory fields: ${(elementInventory.fields || []).length}`,
    `- agent code refs: ${codeRefCount}`,
    `- source mode: ${ctx.stepResults.sync_confluence_tree?.mode || sourceIndex.mode || 'unknown'}`,
    `- source documents: ${ctx.stepResults.sync_confluence_tree?.pageCount ?? sourceIndex.pageCount ?? 'unknown'}`,
    `- agent response: ${ctx.stepResults.read_agent_response?.status || 'unknown'}`,
    `- contract validation: ${ctx.stepResults.validate_contract?.status || 'unknown'}`,
    `- executable cases: ${ctx.stepResults.build_run_plan?.executableCaseCount ?? 'unknown'}`,
    `- listed tests: ${ctx.stepResults.list_spec?.listed ?? 'unknown'}`,
    `- runtime check: ${ctx.stepResults.verify_runtime?.runtimeStatus || ctx.runtimeCheck?.status || 'unknown'}`,
    `- runtime check file: ${ctx.runtimeCheck?.json || `${ctx.paths.targetDir}/runtime-check.json`}`,
    `- generated spec: ${ctx.paths.generatedSpecFile}`,
    `- test scenarios: ${testScenariosPath}`,
    `- run status: ${ctx.runResult?.status || 'unknown'}`,
    `- run reason: ${ctx.runResult?.reason || '(none)'}`,
    `- run command: ${ctx.runResult?.command || '(none)'}`,
    '',
    '## Step Results',
    '',
    '```json',
    JSON.stringify(ctx.stepResults, null, 2),
    '```',
    '',
  ].join('\n');

  writeText(ctx.rootDir, ctx.paths.resultMarkdown, report);

  const requirements = readOptional(ctx, ctx.paths.pageRequirementsMarkdown) || readOptional(ctx, ctx.paths.requirements);
  const agentEvidence = [
    readOptional(ctx, ctx.paths.elementInventory),
    readOptional(ctx, ctx.paths.coverageMatrix),
    readOptional(ctx, ctx.paths.agentResponseCoverageLedgerMarkdown),
  ].join('\n');
  const generatedSpec = readOptional(ctx, ctx.paths.generatedSpecFile);

  ctx.lock.targets = ctx.lock.targets || {};
  ctx.lock.targets[ctx.target.targetId] = {
    updatedAt: new Date().toISOString(),
    sourceSetHash: ctx.sourceIndex?.sourceSetHash || sourceIndex.treeHash || null,
    requirementsHash: hashText(requirements),
    agentEvidenceHash: hashText(agentEvidence),
    generatedSpecHash: hashText(generatedSpec),
    generated: (ctx.runPlan?.executableCaseCount || 0) > 0,
  };

  writeJson(ctx.rootDir, ctx.policies.artifacts.lockFile, ctx.lock);

  return {
    status: 'ok',
    report: ctx.paths.resultMarkdown,
  };
}

module.exports = { writeReport };
