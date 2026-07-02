// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const {
  ensureDir,
  hashText,
  readJson,
  readText,
  resolveRoot,
  toPosix,
  writeYaml,
} = require('../context');

function listMarkdownFiles(rootDir, relativeDir) {
  const fullDir = resolveRoot(rootDir, relativeDir);
  if (!fs.existsSync(fullDir)) return [];
  return fs
    .readdirSync(fullDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => `${relativeDir}/${file}`);
}

function getPageMeta(markdown, relativePath) {
  const pageId = markdown.match(/^source:\s*pageId=([^\s]+)/m)?.[1] || path.basename(relativePath, '.md');
  const pageTitle = markdown.match(/^#\s+(.+)$/m)?.[1] || pageId;
  const titlePath = markdown.match(/^titlePath:\s*(.+)$/m)?.[1]?.split(/\s*>\s*/).filter(Boolean) || [pageTitle];
  const version = markdown.match(/^version:\s*(.+)$/m)?.[1] || null;
  return { pageId, pageTitle, titlePath, version };
}

function splitSections(markdown, page) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = {
    heading: page.pageTitle,
    level: 1,
    text: '',
    titlePath: page.titlePath,
  };

  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s+(.+)$/);
    if (heading) {
      if (current.text.trim()) sections.push(current);
      current = {
        heading: heading[2].trim(),
        level: heading[1].length,
        text: '',
        titlePath: [...page.titlePath, heading[2].trim()],
      };
      continue;
    }
    current.text += `${line}\n`;
  }
  if (current.text.trim()) sections.push(current);
  return sections;
}

function cleanupText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractChunks(section) {
  const lines = section.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  let table = [];

  function flushTable() {
    if (table.length >= 2) {
      chunks.push(table.join('\n'));
    }
    table = [];
  }

  for (const line of lines) {
    if (line.startsWith('|')) {
      table.push(line);
      continue;
    }
    flushTable();
    if (line.startsWith('- ')) {
      chunks.push(line.replace(/^-+\s*/, ''));
      continue;
    }
    if (/[:：]$/.test(line) && line.length < 80) continue;
    chunks.push(line);
  }
  flushTable();

  return chunks
    .map(cleanupText)
    .filter((text) => text.length >= 8)
    .map((text) => text.slice(0, 1200));
}

async function buildPolicyUnits(ctx) {
  const tree = readJson(ctx.rootDir, ctx.paths.confluenceTreeIndex, null);
  const files = listMarkdownFiles(ctx.rootDir, ctx.paths.confluenceNormalizedDir);
  if (!tree || !files.length) {
    return {
      status: 'failed',
      message: 'Missing normalized reference markdown. Run sync_confluence_tree and normalize_confluence first.',
    };
  }

  const units = [];
  for (const relativePath of files) {
    const markdown = readText(ctx.rootDir, relativePath);
    const page = getPageMeta(markdown, relativePath);
    const sections = splitSections(markdown, page);
    for (const section of sections) {
      const chunks = extractChunks(section);
      chunks.forEach((text) => {
        const unitId = `policy-unit-${String(units.length + 1).padStart(4, '0')}`;
        units.push({
          unitId,
          sourceRef: {
            pageId: page.pageId,
            pageTitle: page.pageTitle,
            titlePath: section.titlePath,
            version: page.version,
            normalizedFile: toPosix(relativePath),
          },
          heading: section.heading,
          text,
          hash: hashText(`${page.pageId}\n${section.heading}\n${text}`),
        });
      });
    }
  }

  const output = {
    schemaVersion: 1,
    kind: 'policy-units',
    generatedAt: new Date().toISOString(),
    source: {
      treeIndex: ctx.paths.confluenceTreeIndex,
      normalizedDir: ctx.paths.confluenceNormalizedDir,
      treeHash: tree.treeHash || null,
    },
    unitCount: units.length,
    units,
  };

  ensureDir(path.dirname(resolveRoot(ctx.rootDir, ctx.paths.confluencePolicyUnits)));
  writeYaml(ctx.rootDir, ctx.paths.confluencePolicyUnits, output);
  ctx.policyUnits = output;

  return {
    status: 'ok',
    unitCount: units.length,
    output: ctx.paths.confluencePolicyUnits,
  };
}

module.exports = { buildPolicyUnits };
