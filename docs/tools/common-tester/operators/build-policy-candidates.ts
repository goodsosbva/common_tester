// @ts-nocheck
const {
  hashText,
  readJson,
  readYaml,
  writeYaml,
} = require('../context');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function includesAny(value, words) {
  const source = String(value || '').toLowerCase();
  return asArray(words).filter((word) => source.includes(String(word).toLowerCase()));
}

function loadSelection(ctx, capability) {
  const taxonomy = readYaml(ctx.rootDir, `docs/common-tester/taxonomy/${capability || 'input'}.yaml`);
  return taxonomy.selection || {};
}

function scoreCandidate(unit, selection) {
  const categoryScore = asArray(unit.categories).reduce((sum, category) => sum + Number(category.score || 0), 0);
  const intentScore = unique(asArray(unit.categories).flatMap((category) => asArray(category.testIntents))).length;
  const titleText = [
    unit.heading,
    asArray(unit.sourceRef?.titlePath).join(' '),
  ].join(' ');
  const highMatches = includesAny(titleText, selection.sourceTitleBoost?.high);
  const mediumMatches = includesAny(titleText, selection.sourceTitleBoost?.medium);
  const penaltyMatches = includesAny(titleText, selection.sourceTitlePenalty);
  const highBoost = highMatches.length * 80;
  const mediumBoost = mediumMatches.length * 25;
  const penalty = highMatches.length ? 0 : penaltyMatches.length * 50;
  return Math.max(0, categoryScore * 10 + intentScore + highBoost + mediumBoost - penalty);
}

function buildReasons(unit, selection) {
  const reasons = [];
  for (const category of asArray(unit.categories)) {
    reasons.push(`${category.id}: ${asArray(category.matchedKeywords).join(', ')}`);
  }
  const titleText = [
    unit.heading,
    asArray(unit.sourceRef?.titlePath).join(' '),
  ].join(' ');
  const highMatches = includesAny(titleText, selection.sourceTitleBoost?.high);
  const mediumMatches = includesAny(titleText, selection.sourceTitleBoost?.medium);
  const penaltyMatches = includesAny(titleText, selection.sourceTitlePenalty);
  if (highMatches.length) reasons.push(`source high priority: ${highMatches.join(', ')}`);
  if (mediumMatches.length) reasons.push(`source medium priority: ${mediumMatches.join(', ')}`);
  if (penaltyMatches.length && !highMatches.length) reasons.push(`source penalty: ${penaltyMatches.join(', ')}`);
  return reasons;
}

function buildCoverage(candidates) {
  const requiredIntents = [];
  const byIntent = new Map();
  for (const candidate of candidates) {
    for (const intent of asArray(candidate.suggestedTestIntents)) {
      if (!byIntent.has(intent)) {
        byIntent.set(intent, {
          intent,
          candidateIds: [],
          categoryIds: [],
          reason: 'Selected from high-scoring policy candidates.',
        });
      }
      const entry = byIntent.get(intent);
      entry.candidateIds.push(candidate.candidateId);
      entry.categoryIds.push(...asArray(candidate.categoryIds));
    }
  }

  for (const entry of byIntent.values()) {
    entry.candidateIds = unique(entry.candidateIds).slice(0, 8);
    entry.categoryIds = unique(entry.categoryIds);
    requiredIntents.push(entry);
  }

  return {
    minGeneratedCaseCount: requiredIntents.length,
    selectionBasis: {
      candidateMeaning: 'A policy candidate is evidence from Confluence, not one generated test.',
      testExpansionRule: 'This count is only the policy-intent floor. Agent decides final test breadth from project code, field inventory, and input expansion rules.',
      intentSource: 'requiredIntents is the complete distinct set of suggestedTestIntents from selected candidates.',
    },
    requiredIntents,
    rules: [
      'Agent must not create fewer than minGeneratedCaseCount generate:true cases because every required intent needs at least one executable case.',
      'minGeneratedCaseCount is not the final target count. Field/control discovery and input expansion should normally create more cases.',
      'Each generate:true case must include coversIntents.',
      'Every required intent must be covered by at least one generate:true case.',
      'For field-level coverage, every applicable field-intent row from coverage-matrix.yaml must be covered.',
      'A case may cite multiple policy candidates, but it must not claim an intent without a matching candidate source.',
    ],
  };
}

function buildCandidateId(unit, categoryIds) {
  const sourceRef = unit.sourceRef || {};
  const basis = JSON.stringify({
    pageId: sourceRef.pageId || '',
    titlePath: asArray(sourceRef.titlePath),
    heading: unit.heading || '',
    categoryIds: asArray(categoryIds).sort(),
    text: String(unit.text || '').slice(0, 1000),
  });
  return `policy-candidate-${hashText(basis).slice(0, 12)}`;
}

async function buildPolicyCandidates(ctx) {
  const capability = ctx.command.capability || 'input';
  const categoriesDoc = ctx.policyCategories || readYaml(ctx.rootDir, ctx.paths.confluencePolicyCategories);
  const selection = loadSelection(ctx, capability);
  const maxCandidates = Number(selection.maxCandidates || 80);
  const minScore = Number(selection.minScore || 1);

  const allCandidates = asArray(categoriesDoc.classifiedUnits)
    .map((unit) => {
      const categoryIds = unique(asArray(unit.categories).map((category) => category.id));
      const testIntents = unique(asArray(unit.categories).flatMap((category) => asArray(category.testIntents)));
      const matchedKeywords = unique(asArray(unit.categories).flatMap((category) => asArray(category.matchedKeywords)));
      const score = scoreCandidate(unit, selection);
      return {
        candidateId: buildCandidateId(unit, categoryIds),
        capability,
        sourceRef: unit.sourceRef,
        policyUnitId: unit.unitId,
        heading: unit.heading,
        categoryIds,
        matchedKeywords,
        suggestedTestIntents: testIntents,
        relevance: {
          score,
          minScore,
          reasons: buildReasons(unit, selection),
        },
        policyText: unit.text,
      };
    })
    .sort((a, b) => b.relevance.score - a.relevance.score || a.candidateId.localeCompare(b.candidateId));
  const candidates = allCandidates
    .filter((candidate) => candidate.relevance.score >= minScore)
    .slice(0, maxCandidates);
  const rejectedCandidates = allCandidates
    .filter((candidate) => candidate.relevance.score < minScore)
    .slice(0, 50)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      sourceRef: candidate.sourceRef,
      heading: candidate.heading,
      categoryIds: candidate.categoryIds,
      relevance: candidate.relevance,
      rejectedReason: `score below minScore ${minScore}`,
    }));

  const output = {
    schemaVersion: 1,
    kind: 'policy-candidates',
    generatedAt: new Date().toISOString(),
    target: {
      targetId: ctx.target.targetId,
      route: ctx.target.route,
      capability,
      routeName: null,
      componentFile: null,
      projectAnalysisOwner: 'agent',
    },
    sources: {
      policyUnits: ctx.paths.confluencePolicyUnits,
      policyCategories: ctx.paths.confluencePolicyCategories,
      policyRules: ctx.paths.policyRules,
      taxonomyIndex: 'docs/common-tester/taxonomy/00-index.yaml',
    },
    selection: {
      minScore,
      maxCandidates,
      sourceTitleBoost: selection.sourceTitleBoost || {},
      sourceTitlePenalty: selection.sourceTitlePenalty || [],
    },
    generationRules: [
      'Use candidates as the common-policy evidence for agent-response files.',
      'Each generated test intent must cite at least one candidateId or sourceRef.',
      'Do not create browser selectors here; selectors belong in page-contract.yaml after project/code evidence is reviewed.',
      'If a candidate does not apply to the current page, mark it rejected in agent-response instead of silently ignoring it.',
      'JS runner does not decide route/component/field coverage. Agent must inspect the project code and write codeRefs in element-inventory.yaml.',
    ],
    scannedCandidateCount: allCandidates.length,
    candidateCount: candidates.length,
    warnings: candidates.length
      ? []
      : [
          'No policy candidates met the taxonomy score threshold. Treat policy-candidates.yaml as empty evidence and have the Agent verify normalized Confluence text plus project code directly.',
        ],
    coverage: buildCoverage(candidates),
    candidates,
    rejectedCandidates,
  };

  writeYaml(ctx.rootDir, ctx.paths.policyCandidates, output);
  ctx.policyCandidates = output;

  if (!candidates.length) {
    const confluenceTree = ctx.confluenceTree || readJson(ctx.rootDir, ctx.paths.confluenceTreeIndex, null) || {};
    const classifiedCount = asArray(categoriesDoc.classifiedUnits).length;
    const pageCount = asArray(confluenceTree.pages).length;
    return {
      status: 'ok',
      candidateCount: 0,
      warning: `No policy candidates produced for capability: ${capability}. classifiedUnits=${classifiedCount}, sourceDocuments=${pageCount}, rootPageId=${confluenceTree.rootPageId || 'unknown'}. Agent must verify normalized reference text and project code directly.`,
      output: ctx.paths.policyCandidates,
    };
  }

  return {
    status: 'ok',
    candidateCount: candidates.length,
    output: ctx.paths.policyCandidates,
  };
}

module.exports = { buildPolicyCandidates };
