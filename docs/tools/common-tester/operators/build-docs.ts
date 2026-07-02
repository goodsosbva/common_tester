// @ts-nocheck
const { hashText, writeText } = require('../context');

async function buildDocs(ctx) {
  const route = ctx.target.route || '(target name only)';
  const sourceReady = ctx.sourceIndex?.matchedSources?.length > 0;
  const requirements = [
    `# Requirements: ${ctx.target.targetId}`,
    '',
    `- target route: ${route}`,
    `- Confluence status: ${ctx.sourceIndex?.status || 'unknown'}`,
    '',
    '## Current State',
    '',
    sourceReady
      ? 'Confluence sources were matched. Requirements should be generated from those normalized sources.'
      : 'Confluence sources are not available in this initial runner pass. This file is a local placeholder and must be regenerated after Confluence sync is implemented/enabled.',
    '',
  ].join('\n');

  const gaps = [
    `# Contract Gaps: ${ctx.target.targetId}`,
    '',
    sourceReady ? '- No source gap detected in this pass.' : '- Confluence source content has not been synced yet.',
    ctx.projectModel?.route?.componentFile ? '' : '- Target component was not resolved.',
    '- Playwright MCP observation has not been run yet.',
    '',
  ].join('\n');

  const testCaseSpec = [
    `# Test Case Spec: ${ctx.target.targetId}`,
    '',
    '## Candidate Cases',
    '',
    '1. Page load',
    `   - Given: authenticated admin user`,
    `   - When: navigate to ${route}`,
    '   - Then: the target page is visible',
    '   - generation: blocked until Confluence requirements and MCP observation are available',
    '',
  ].join('\n');

  writeText(ctx.rootDir, ctx.paths.requirements, requirements);
  writeText(ctx.rootDir, ctx.paths.contractGaps, gaps);
  writeText(ctx.rootDir, ctx.paths.testCaseSpec, testCaseSpec);

  ctx.docHashes = {
    requirementsHash: hashText(requirements),
    contractGapsHash: hashText(gaps),
    testCaseSpecHash: hashText(testCaseSpec),
  };

  return {
    status: 'ok',
    sourceReady,
  };
}

module.exports = { buildDocs };
