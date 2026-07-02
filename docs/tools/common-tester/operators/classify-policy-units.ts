// @ts-nocheck
const {
  readYaml,
  writeYaml,
} = require('../context');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesText(haystack, keyword) {
  const source = String(haystack || '').toLowerCase();
  const needle = String(keyword || '').toLowerCase();
  return Boolean(needle && source.includes(needle));
}

function loadCapabilityTaxonomy(ctx, capability) {
  const index = readYaml(ctx.rootDir, 'docs/common-tester/taxonomy/00-index.yaml');
  const config = index.capabilities?.[capability];
  const includeFiles = asArray(config?.include);
  if (!includeFiles.length) {
    throw new Error(`No taxonomy files registered for capability: ${capability}`);
  }

  const taxonomies = includeFiles.map((file) => ({
    file: `docs/common-tester/taxonomy/${file}`,
    data: readYaml(ctx.rootDir, `docs/common-tester/taxonomy/${file}`),
  }));

  return {
    index,
    files: taxonomies,
    categories: taxonomies.flatMap((entry) =>
      asArray(entry.data.categories).map((category) => ({
        ...category,
        taxonomyFile: entry.file,
      }))
    ),
  };
}

function classifyUnit(unit, categories) {
  const haystack = [
    unit.heading,
    asArray(unit.sourceRef?.titlePath).join(' '),
    unit.text,
  ].join('\n');

  return categories
    .map((category) => {
      const keywords = asArray(category.detect?.keywords);
      const matchedKeywords = keywords.filter((keyword) => includesText(haystack, keyword));
      if (!matchedKeywords.length) return null;
      return {
        id: category.id,
        meaning: category.meaning,
        taxonomyFile: category.taxonomyFile,
        matchedKeywords,
        score: matchedKeywords.length,
        testIntents: asArray(category.testIntents),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

async function classifyPolicyUnits(ctx) {
  const capability = ctx.command.capability || 'input';
  const unitsDoc = ctx.policyUnits || readYaml(ctx.rootDir, ctx.paths.confluencePolicyUnits);
  const taxonomy = loadCapabilityTaxonomy(ctx, capability);

  const classifiedUnits = asArray(unitsDoc.units)
    .map((unit) => ({
      unitId: unit.unitId,
      sourceRef: unit.sourceRef,
      heading: unit.heading,
      text: unit.text,
      hash: unit.hash,
      categories: classifyUnit(unit, taxonomy.categories),
    }))
    .filter((unit) => unit.categories.length > 0);

  const categorySummary = {};
  for (const unit of classifiedUnits) {
    for (const category of unit.categories) {
      categorySummary[category.id] = (categorySummary[category.id] || 0) + 1;
    }
  }

  const output = {
    schemaVersion: 1,
    kind: 'policy-categories',
    generatedAt: new Date().toISOString(),
    capability,
    sources: {
      policyUnits: ctx.paths.confluencePolicyUnits,
      taxonomyIndex: 'docs/common-tester/taxonomy/00-index.yaml',
      taxonomyFiles: taxonomy.files.map((entry) => entry.file),
    },
    unitCount: asArray(unitsDoc.units).length,
    classifiedCount: classifiedUnits.length,
    unclassifiedCount: Math.max(0, asArray(unitsDoc.units).length - classifiedUnits.length),
    categorySummary,
    classifiedUnits,
  };

  writeYaml(ctx.rootDir, ctx.paths.confluencePolicyCategories, output);
  ctx.policyCategories = output;

  return {
    status: 'ok',
    capability,
    classifiedCount: classifiedUnits.length,
    output: ctx.paths.confluencePolicyCategories,
  };
}

module.exports = { classifyPolicyUnits };
