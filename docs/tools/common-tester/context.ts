// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let yaml;

function countIndent(line) {
  return line.match(/^ */)?.[0].length || 0;
}

function parseScalar(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === '{}') return {};
  if (trimmed === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitKeyValue(text) {
  const index = text.indexOf(':');
  if (index < 0) return null;
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}

function parseSimpleYaml(content) {
  const lines = String(content)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'));

  function parseBlock(index, indent) {
    while (index < lines.length && countIndent(lines[index]) < indent) index += 1;
    const line = lines[index];
    if (!line || countIndent(line) < indent) return [null, index];
    return line.slice(indent).startsWith('- ')
      ? parseArray(index, indent)
      : parseObject(index, indent);
  }

  function parseObject(index, indent) {
    const object = {};
    while (index < lines.length) {
      const line = lines[index];
      const currentIndent = countIndent(line);
      if (currentIndent < indent) break;
      if (currentIndent > indent) break;
      const text = line.slice(indent);
      if (text.startsWith('- ')) break;
      const parts = splitKeyValue(text);
      if (!parts) {
        index += 1;
        continue;
      }
      const [key, value] = parts;
      if (value === '') {
        const [child, next] = parseBlock(index + 1, indent + 2);
        object[key] = child == null ? {} : child;
        index = next;
      } else {
        object[key] = parseScalar(value);
        index += 1;
      }
    }
    return [object, index];
  }

  function parseArray(index, indent) {
    const array = [];
    while (index < lines.length) {
      const line = lines[index];
      const currentIndent = countIndent(line);
      if (currentIndent < indent) break;
      if (currentIndent !== indent || !line.slice(indent).startsWith('- ')) break;
      const rest = line.slice(indent + 2).trim();
      if (rest === '') {
        const [child, next] = parseBlock(index + 1, indent + 2);
        array.push(child);
        index = next;
        continue;
      }

      const parts = splitKeyValue(rest);
      if (parts) {
        const [key, value] = parts;
        const item = {};
        if (value === '') {
          const [child, next] = parseBlock(index + 1, indent + 2);
          item[key] = child == null ? {} : child;
          index = next;
        } else {
          item[key] = parseScalar(value);
          index += 1;
        }
        if (index < lines.length && countIndent(lines[index]) >= indent + 2) {
          const [more, next] = parseBlock(index, indent + 2);
          if (more && !Array.isArray(more)) Object.assign(item, more);
          index = next;
        }
        array.push(item);
      } else {
        array.push(parseScalar(rest));
        index += 1;
      }
    }
    return [array, index];
  }

  return parseBlock(0, 0)[0] || {};
}

function dumpSimpleYaml(value, indent = 0) {
  const space = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const dumped = dumpSimpleYaml(item, indent + 2).trimEnd();
          const lines = dumped.split('\n');
          const baseIndent = ' '.repeat(indent + 2);
          const stripBaseIndent = (line) => line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line.trimStart();
          return `${space}- ${stripBaseIndent(lines[0])}\n${lines.slice(1).map((line) => `${space}  ${stripBaseIndent(line)}`).join('\n')}`.trimEnd();
        }
        return `${space}- ${String(item)}`;
      })
      .join('\n') + '\n';
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => {
        if (item && typeof item === 'object') {
          return `${space}${key}:\n${dumpSimpleYaml(item, indent + 2).trimEnd()}`;
        }
        return `${space}${key}: ${JSON.stringify(item)}`;
      })
      .join('\n') + '\n';
  }
  return `${space}${JSON.stringify(value)}\n`;
}

try {
  yaml = require('js-yaml');
} catch (error) {
  yaml = {
    load: parseSimpleYaml,
    dump: (value) => dumpSimpleYaml(value, 0),
  };
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function resolveRoot(rootDir, relativePath) {
  return path.resolve(rootDir, relativePath);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(rootDir, relativePath) {
  return fs.readFileSync(resolveRoot(rootDir, relativePath), 'utf8');
}

function readJson(rootDir, relativePath, fallback = undefined) {
  const fullPath = resolveRoot(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function readYaml(rootDir, relativePath) {
  return yaml.load(readText(rootDir, relativePath));
}

function writeText(rootDir, relativePath, content) {
  const fullPath = resolveRoot(rootDir, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf8');
}

function writeJson(rootDir, relativePath, value) {
  writeText(rootDir, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeYaml(rootDir, relativePath, value) {
  writeText(rootDir, relativePath, yaml.dump(value, { lineWidth: 120, noRefs: true }));
}

function hashText(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashJson(value) {
  return hashText(JSON.stringify(value));
}

function slugify(input) {
  const normalized = String(input || 'target')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-zA-Z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'target';
}

function interpolate(template, values) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    values[key] == null ? `{${key}}` : String(values[key])
  );
}

function listFiles(rootDir, options = {}) {
  const includeExt = options.includeExt || null;
  const excludeParts = options.excludeParts || ['node_modules', '.git', 'dist', 'build'];
  const output = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(rootDir, fullPath));
      if (excludeParts.some((part) => relativePath.split('/').includes(part))) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (includeExt && !includeExt.some((ext) => entry.name.endsWith(ext))) continue;
      output.push(relativePath);
    }
  }

  walk(rootDir);
  return output;
}

function createTargetPaths(ctx) {
  const targetDir = interpolate(ctx.policies.artifacts.targetDir, {
    targetId: ctx.target.targetId,
  });
  const names = ctx.policies.artifacts.artifacts;
  const cache = ctx.policies.artifacts.cache || {};
  const agentResponseDir = `${targetDir}/${names.agentResponseDir || 'agent-response'}`;
  return {
    targetDir,
    target: `${targetDir}/${names.target}`,
    sourceIndex: `${targetDir}/${names.sourceIndex}`,
    projectModel: `${targetDir}/${names.projectModel}`,
    reuseDecision: `${targetDir}/${names.reuseDecision}`,
    requirements: `${targetDir}/${names.requirements}`,
    projectEvidence: `${targetDir}/${names.projectEvidence}`,
    elementInventory: `${targetDir}/${names.elementInventory || 'element-inventory.yaml'}`,
    coverageMatrix: `${targetDir}/${names.coverageMatrix || 'coverage-matrix.yaml'}`,
    contractGaps: `${targetDir}/${names.contractGaps}`,
    testCaseSpec: `${targetDir}/${names.testCaseSpec}`,
    agentRequestMarkdown: `${targetDir}/${names.agentRequestMarkdown}`,
    agentRequestJson: `${targetDir}/${names.agentRequestJson}`,
    agentOutputContract: `${targetDir}/${names.agentOutputContract}`,
    policyCandidates: `${targetDir}/${names.policyCandidates || 'policy-candidates.yaml'}`,
    policyRules: `${targetDir}/${names.policyRules || 'policy-rules.yaml'}`,
    agentResponseDir,
    agentResponseElementInventory: `${agentResponseDir}/${names.elementInventory || 'element-inventory.yaml'}`,
    agentResponseCoverageMatrix: `${agentResponseDir}/${names.coverageMatrix || 'coverage-matrix.yaml'}`,
    agentResponseCommonPolicyMarkdown: `${agentResponseDir}/${names.commonPolicyMarkdown}`,
    agentResponsePageRequirementsMarkdown: `${agentResponseDir}/${names.pageRequirementsMarkdown}`,
    agentResponseInputFieldsMarkdown: `${agentResponseDir}/${names.inputFieldsMarkdown}`,
    agentResponseAcceptanceCriteriaMarkdown: `${agentResponseDir}/${names.acceptanceCriteriaMarkdown}`,
    agentResponseCoverageLedgerMarkdown: `${agentResponseDir}/${names.coverageLedgerMarkdown || 'coverage-ledger.md'}`,
    agentResponseFieldConstraintInventory: `${agentResponseDir}/${names.fieldConstraintInventory || 'field-constraint-inventory.yaml'}`,
    agentResponseTestExpansionPlan: `${agentResponseDir}/${names.testExpansionPlan || 'test-expansion-plan.yaml'}`,
    agentResponseCommonPolicyYaml: `${agentResponseDir}/${names.commonPolicyYaml}`,
    agentResponsePageContract: `${agentResponseDir}/${names.pageContract}`,
    agentResponseAutomationContract: `${agentResponseDir}/${names.automationContract}`,
    commonPolicyMarkdown: `${targetDir}/${names.commonPolicyMarkdown}`,
    pageRequirementsMarkdown: `${targetDir}/${names.pageRequirementsMarkdown}`,
    inputFieldsMarkdown: `${targetDir}/${names.inputFieldsMarkdown}`,
    acceptanceCriteriaMarkdown: `${targetDir}/${names.acceptanceCriteriaMarkdown}`,
    fieldConstraintInventory: `${targetDir}/${names.fieldConstraintInventory || 'field-constraint-inventory.yaml'}`,
    testExpansionPlan: `${targetDir}/${names.testExpansionPlan || 'test-expansion-plan.yaml'}`,
    commonPolicyYaml: `${targetDir}/${names.commonPolicyYaml}`,
    pageContract: `${targetDir}/${names.pageContract}`,
    mcpObservation: `${targetDir}/${names.mcpObservation}`,
    automationContract: `${targetDir}/${names.automationContract}`,
    runPlan: `${targetDir}/${names.runPlan}`,
    listedTests: `${targetDir}/${names.listedTests}`,
    generatedSpecDir: `${targetDir}/${names.generatedSpecDir}`,
    generatedDraftSpecFile: `${targetDir}/${names.generatedSpecDir}/${ctx.target.targetId}.draft.spec.ts`,
    generatedSpecFile: `${targetDir}/${interpolate(names.generatedSpecFile, { targetId: ctx.target.targetId })}`,
    resultsDir: `${targetDir}/${names.resultsDir}`,
    resultMarkdown: `${targetDir}/${names.resultMarkdown}`,
    resultJson: `${targetDir}/${names.resultJson}`,
    confluenceCacheDir: cache.confluenceDir,
    confluenceTreeIndex: cache.treeIndex,
    confluenceSectionIndex: cache.sectionIndex,
    confluencePolicyUnits: cache.policyUnits || `${cache.confluenceDir}/policy-units.yaml`,
    confluencePolicyCategories: cache.policyCategories || `${cache.confluenceDir}/policy-categories.yaml`,
    confluencePolicyRules: cache.policyRules || `${cache.confluenceDir}/policy-rules.yaml`,
    confluenceRawDir: cache.rawBodyDir,
    confluenceNormalizedDir: cache.normalizedBodyDir,
  };
}

module.exports = {
  createTargetPaths,
  ensureDir,
  hashJson,
  hashText,
  interpolate,
  listFiles,
  readJson,
  readText,
  readYaml,
  resolveRoot,
  slugify,
  toPosix,
  writeJson,
  writeText,
  writeYaml,
};
