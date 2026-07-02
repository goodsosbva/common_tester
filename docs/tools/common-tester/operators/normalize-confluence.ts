// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const {
  ensureDir,
  hashText,
  readJson,
  resolveRoot,
  writeJson,
  writeText,
} = require('../context');

function clearMarkdownDir(rootDir, relativeDir) {
  const fullDir = resolveRoot(rootDir, relativeDir);
  ensureDir(fullDir);
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      fs.unlinkSync(path.join(fullDir, entry.name));
    }
  }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTables(html) {
  const tables = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let match;
  while ((match = tableRegex.exec(html))) {
    const tableHtml = match[0];
    const rows = [];
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml))) {
      const rowHtml = rowMatch[0];
      const cells = [];
      const cellRegex = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml))) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push({ html: tableHtml, rows });
  }
  return tables;
}

function tableToMarkdown(rows) {
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
  const header = padded[0];
  const divider = Array(width).fill('---');
  const body = padded.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function normalizeHtml(html, page) {
  let working = String(html || '')
    .replace(/<ac:[\s\S]*?<\/ac:[^>]+>/gi, ' ')
    .replace(/<ri:[^>]+\/>/gi, ' ');
  const tableBlocks = [];
  for (const table of extractTables(working)) {
    const token = `__COMMON_TESTER_TABLE_${tableBlocks.length}__`;
    tableBlocks.push(tableToMarkdown(table.rows));
    working = working.replace(table.html, token);
  }

  working = working
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n${'#'.repeat(Number(level) + 1)} ${stripTags(text)}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${stripTags(text)}`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${stripTags(text)}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  let md = decodeEntities(working)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n');
  tableBlocks.forEach((table, index) => {
    md = md.replace(`__COMMON_TESTER_TABLE_${index}__`, `\n${table}\n`);
  });

  return [
    `# ${page.title}`,
    '',
    `source: pageId=${page.id}`,
    `titlePath: ${page.titlePath.join(' > ')}`,
    `version: ${page.version}`,
    '',
    md,
    '',
  ].join('\n');
}

function normalizeMarkdown(markdown, page) {
  const body = String(markdown || '').replace(/\r\n/g, '\n').trim();
  return [
    `# ${page.title}`,
    '',
    `source: pageId=${page.id}`,
    page.sourcePath ? `sourcePath: ${page.sourcePath}` : null,
    `titlePath: ${page.titlePath.join(' > ')}`,
    `version: ${page.version}`,
    '',
    body,
    '',
  ].filter((line) => line != null).join('\n');
}

function extractSections(markdown, page) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = {
        pageId: page.id,
        title: heading[2],
        level: heading[1].length,
        titlePath: [...page.titlePath, heading[2]],
        text: '',
      };
    } else if (current) {
      current.text += `${line}\n`;
    }
  }
  if (current) sections.push(current);
  return sections.map((section) => ({
    ...section,
    hash: hashText(section.text),
  }));
}

async function normalizeConfluence(ctx) {
  const tree = readJson(ctx.rootDir, ctx.paths.confluenceTreeIndex, null);
  if (!tree || !Array.isArray(tree.pages)) {
    return {
      status: 'failed',
      message: 'Missing Confluence tree-index.json. Run prepare-agent sync step first.',
    };
  }

  clearMarkdownDir(ctx.rootDir, ctx.paths.confluenceNormalizedDir);
  const sections = [];
  for (const item of tree.pages) {
    const page = readJson(ctx.rootDir, `${ctx.paths.confluenceRawDir}/${item.pageId}.json`, null);
    if (!page) continue;
    const sourceMarkdown = page.body?.markdown?.value;
    const html = page.body?.storage?.value || '';
    const markdown = sourceMarkdown == null ? normalizeHtml(html, page) : normalizeMarkdown(sourceMarkdown, page);
    const relative = `${ctx.paths.confluenceNormalizedDir}/${page.id}.md`;
    writeText(ctx.rootDir, relative, markdown);
    sections.push(...extractSections(markdown, page));
  }

  const sectionIndex = {
    schemaVersion: 1,
    treeHash: tree.treeHash,
    sections: sections.map((section, index) => ({
      sectionId: `section-${index + 1}`,
      pageId: section.pageId,
      title: section.title,
      level: section.level,
      titlePath: section.titlePath,
      hash: section.hash,
    })),
  };
  writeJson(ctx.rootDir, ctx.paths.confluenceSectionIndex, sectionIndex);
  ctx.sectionIndex = sectionIndex;

  return {
    status: 'ok',
    normalizedDir: ctx.paths.confluenceNormalizedDir,
    sectionCount: sectionIndex.sections.length,
  };
}

module.exports = { normalizeConfluence };
