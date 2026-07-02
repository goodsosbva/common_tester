// @ts-nocheck
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const {
  ensureDir,
  hashJson,
  hashText,
  readJson,
  resolveRoot,
  toPosix,
  writeJson,
} = require('../context');

const MAX_REFERENCE_MARKDOWN_BYTES = 1024 * 1024;

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function splitOptionValues(value) {
  return asArray(value)
    .flatMap((item) => String(item).split(/[,;]/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertInsideRoot(rootDir, fullPath) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(fullPath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Reference markdown must stay inside the project root: ${fullPath}`);
  }
}

function walkMarkdownFiles(rootDir, fullDir) {
  const files = [];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'playwright-report', 'test-results']);

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(rootDir, fullPath));
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || relativePath.startsWith('docs/common-tester/runtime')) continue;
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(fullPath);
    }
  }

  visit(fullDir);
  return files;
}

function referenceMarkdownInputs(ctx) {
  return [
    ...splitOptionValues(ctx.command.referenceMd),
    ...splitOptionValues(ctx.command.referenceDoc),
    ...splitOptionValues(ctx.command.referenceDocs),
    ...splitOptionValues(ctx.command.referenceDir),
  ];
}

function collectReferenceMarkdownFiles(ctx) {
  const inputs = referenceMarkdownInputs(ctx);
  const byPath = new Map();

  for (const input of inputs) {
    const fullPath = path.resolve(ctx.rootDir, input);
    assertInsideRoot(ctx.rootDir, fullPath);
    if (!fs.existsSync(fullPath)) throw new Error(`Reference markdown not found: ${input}`);

    const stat = fs.statSync(fullPath);
    const files = stat.isDirectory() ? walkMarkdownFiles(ctx.rootDir, fullPath) : [fullPath];
    for (const file of files) {
      assertInsideRoot(ctx.rootDir, file);
      if (!file.toLowerCase().endsWith('.md')) throw new Error(`Reference file must be .md: ${toPosix(path.relative(ctx.rootDir, file))}`);
      if (fs.statSync(file).size > MAX_REFERENCE_MARKDOWN_BYTES) {
        throw new Error(`Reference markdown is too large: ${toPosix(path.relative(ctx.rootDir, file))}`);
      }
      byPath.set(path.resolve(file), file);
    }
  }

  return [...byPath.values()].sort().map((file) => ({
    fullPath: file,
    relativePath: toPosix(path.relative(ctx.rootDir, file)),
  }));
}

function markdownTitle(content, relativePath) {
  return String(content).match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relativePath, '.md');
}

function readReferenceMarkdown(ctx) {
  const files = collectReferenceMarkdownFiles(ctx);
  if (!files.length) return null;

  const pages = files.map((file, index) => {
    const content = fs.readFileSync(file.fullPath, 'utf8');
    const title = markdownTitle(content, file.relativePath);
    const id = `md-${hashText(file.relativePath).slice(0, 12)}`;
    return {
      id,
      parentId: null,
      title,
      titlePath: ['Reference Markdown', title],
      depth: 0,
      version: fs.statSync(file.fullPath).mtimeMs,
      webUrl: null,
      labels: [],
      sourcePath: file.relativePath,
      body: {
        markdown: {
          value: content,
        },
      },
      bodyHash: hashText(content),
      order: index + 1,
    };
  });
  pages.actualRootId = 'reference-markdown';
  return pages;
}

function clearJsonDir(rootDir, relativeDir) {
  const fullDir = resolveRoot(rootDir, relativeDir);
  ensureDir(fullDir);
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      fs.unlinkSync(path.join(fullDir, entry.name));
    }
  }
}

function getAuth(ctx) {
  const policy = ctx.policies.confluence;
  const email = ctx.command.confluenceEmail || process.env[policy.auth.emailEnv];
  const token = ctx.command.confluenceToken || process.env[policy.auth.tokenEnv];
  return {
    email,
    token,
    source: ctx.command.confluenceEmail || ctx.command.confluenceToken ? 'cli' : 'env',
    hasEmail: Boolean(email),
    hasToken: Boolean(token),
  };
}

function requestJson(url, auth) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`,
    };
    https
      .get(url, { headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Confluence request failed: ${res.statusCode} ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Confluence JSON parse failed: ${url}`));
          }
        });
      })
      .on('error', reject);
  });
}

function normalizePage(raw, parentId = null, depth = 0, titlePath = []) {
  const id = String(raw.id || raw.pageId);
  const title = raw.title || raw.name || id;
  const version = raw.version?.number || raw.version || 1;
  const storageValue =
    raw.body?.storage?.value ||
    raw.body?.value ||
    raw.storage ||
    raw.html ||
    '';
  return {
    id,
    parentId: parentId == null ? null : String(parentId),
    title,
    titlePath: [...titlePath, title],
    depth,
    version,
    webUrl: raw._links?.webui || raw.webUrl || null,
    labels: raw.labels?.results || raw.labels || [],
    body: {
      storage: {
        value: storageValue,
      },
    },
    bodyHash: hashText(storageValue),
  };
}

async function readFixture(ctx) {
  const fixturePath = ctx.command.confluenceFixture;
  if (!fixturePath) return null;
  const fullPath = path.isAbsolute(fixturePath) ? fixturePath : resolveRoot(ctx.rootDir, fixturePath);
  const fixture = readJson(ctx.rootDir, toPosix(path.relative(ctx.rootDir, fullPath)), null) || JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const pages = [];
  const byParent = new Map();
  for (const page of fixture.pages || []) {
    const parentId = page.parentId == null ? null : String(page.parentId);
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(page);
  }

  function walk(raw, parentId, depth, titlePath) {
    const page = normalizePage(raw, parentId, depth, titlePath);
    pages.push(page);
    const children = byParent.get(page.id) || [];
    for (const child of children) {
      walk(child, page.id, depth + 1, page.titlePath);
    }
  }

  const rootId = String(ctx.command.confluenceRootPageId || fixture.rootPageId || ctx.policies.confluence.rootPages?.[0]?.pageId);
  const root = (fixture.pages || []).find((page) => String(page.id || page.pageId) === rootId);
  if (!root) {
    throw new Error(`Fixture root page not found: ${rootId}`);
  }
  walk(root, null, 0, []);
  return pages;
}

async function readConfluenceApi(ctx, auth) {
  if (!auth.hasEmail || !auth.hasToken) {
    throw new Error('Missing Confluence email/token. Pass --confluence-email and --confluence-token or set env variables.');
  }

  const baseUrl = String(ctx.policies.confluence.baseUrl || '').replace(/\/+$/, '');
  const rootId = String(ctx.command.confluenceRootPageId || ctx.policies.confluence.rootPages?.[0]?.pageId);
  const pageSize = Number(ctx.policies.confluence.read?.pageSize || 50);
  const pages = [];
  const visited = new Set();

  async function fetchV2Children(pageId) {
    let childrenUrl = `${baseUrl}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/children?limit=${pageSize}`;
    const children = [];
    while (childrenUrl) {
      const response = await requestJson(childrenUrl, auth);
      children.push(...(response.results || []));
      const next = response._links?.next || null;
      childrenUrl = next ? (next.startsWith('http') ? next : `${baseUrl}${next}`) : null;
    }
    return children;
  }

  async function fetchV1PageChildren(pageId) {
    let childrenUrl = `${baseUrl}/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/page?limit=${pageSize}`;
    const children = [];
    while (childrenUrl) {
      const response = await requestJson(childrenUrl, auth);
      children.push(...(response.results || []));
      const next = response._links?.next || null;
      childrenUrl = next ? (next.startsWith('http') ? next : `${baseUrl}/wiki${next}`) : null;
    }
    return children;
  }

  async function getChildren(pageId) {
    let v2Children = [];
    try {
      v2Children = await fetchV2Children(pageId);
    } catch (error) {
      v2Children = [];
    }
    if (v2Children.length) return v2Children;
    return fetchV1PageChildren(pageId);
  }

  async function fetchPageBody(pageId) {
    const v2Url = `${baseUrl}/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`;
    try {
      return await requestJson(v2Url, auth);
    } catch (error) {
      const v1Url = `${baseUrl}/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=version,body.storage,ancestors,space`;
      const raw = await requestJson(v1Url, auth);
      const ancestors = raw.ancestors || [];
      const lastAncestor = ancestors.length ? ancestors[ancestors.length - 1] : null;
      return {
        ...raw,
        parentId: lastAncestor?.id || null,
        webUrl: raw._links?.webui || null,
      };
    }
  }

  async function fetchPage(pageId, parentId, depth, titlePath) {
    if (visited.has(String(pageId))) return;
    visited.add(String(pageId));
    const raw = await fetchPageBody(pageId);
    const page = normalizePage(raw, parentId, depth, titlePath);
    pages.push(page);

    const children = await getChildren(pageId);
    for (const child of children || []) {
      await fetchPage(child.id, page.id, depth + 1, page.titlePath);
    }
  }

  let actualRootId = rootId;
  await fetchPage(actualRootId, null, 0, []);
  if (
    pages.length === 1 &&
    ctx.policies.confluence.leafRootHandling?.expandParentWhenLeaf === true &&
    (pages[0].parentId || String(rootId) === String(ctx.policies.confluence.leafRootHandling?.requestedLeafPageId))
  ) {
    actualRootId = pages[0].parentId || String(ctx.policies.confluence.rootPages?.[0]?.pageId);
    pages.length = 0;
    visited.clear();
    await fetchPage(actualRootId, null, 0, []);
  }
  pages.actualRootId = actualRootId;
  return pages;
}

function readCachedPages(ctx) {
  const tree = readJson(ctx.rootDir, ctx.paths.confluenceTreeIndex, null);
  if (!tree || !Array.isArray(tree.pages) || !tree.pages.length) return null;
  const pages = [];
  for (const entry of tree.pages) {
    const page = readJson(ctx.rootDir, `${ctx.paths.confluenceRawDir}/${entry.pageId}.json`, null);
    if (!page) return null;
    pages.push(page);
  }
  pages.actualRootId = tree.rootPageId;
  return {
    tree,
    pages,
  };
}

function isTruthy(value) {
  return value === true || String(value || '').toLowerCase() === 'true' || String(value || '') === '1';
}

async function syncConfluenceTree(ctx) {
  const auth = getAuth(ctx);
  let pages;
  let mode = 'api';
  let fallbackReason = null;
  const usesReferenceMarkdown = referenceMarkdownInputs(ctx).length > 0;
  try {
    const referencePages = readReferenceMarkdown(ctx);
    const fixturePages = referencePages ? null : await readFixture(ctx);
    if (referencePages) {
      pages = referencePages;
      mode = 'markdown';
    } else if (fixturePages) {
      pages = fixturePages;
      mode = 'fixture';
    } else {
      pages = await readConfluenceApi(ctx, auth);
    }
  } catch (error) {
    if (usesReferenceMarkdown) {
      return {
        status: 'failed',
        message: error.message,
      };
    }
    fallbackReason = error.message;
    const cached = readCachedPages(ctx);
    const allowCacheFallback = isTruthy(ctx.command.allowConfluenceCache);
    if (!allowCacheFallback) {
      return {
        status: 'failed',
        message: `${error.message}. Cache fallback is blocked for real Confluence runs. Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN, or pass --allow-confluence-cache true when you intentionally want to reuse an existing cache.`,
      };
    }
    if (!cached) {
      return {
        status: 'failed',
        message: error.message,
      };
    }
    pages = cached.pages;
    mode = 'cache';
  }

  clearJsonDir(ctx.rootDir, ctx.paths.confluenceRawDir);
  for (const page of pages) {
    writeJson(ctx.rootDir, `${ctx.paths.confluenceRawDir}/${page.id}.json`, page);
  }

  const treeIndex = {
    schemaVersion: 1,
    mode,
    requestedRootPageId: String(mode === 'markdown' ? pages.actualRootId : ctx.command.confluenceRootPageId || ctx.policies.confluence.rootPages?.[0]?.pageId),
    rootPageId: String(pages.actualRootId || ctx.command.confluenceRootPageId || ctx.policies.confluence.rootPages?.[0]?.pageId),
    auth: {
      source: auth.source,
      hasEmail: auth.hasEmail,
      hasToken: auth.hasToken,
    },
    pages: pages.map((page) => ({
      pageId: page.id,
      parentId: page.parentId,
      title: page.title,
      titlePath: page.titlePath,
      depth: page.depth,
      version: page.version,
      webUrl: page.webUrl,
      labels: page.labels,
      bodyHash: page.bodyHash,
      sourcePath: page.sourcePath || null,
    })),
  };
  treeIndex.treeHash = hashJson(treeIndex.pages);
  writeJson(ctx.rootDir, ctx.paths.confluenceTreeIndex, treeIndex);
  writeJson(ctx.rootDir, ctx.paths.sourceIndex, {
    schemaVersion: 1,
    status: 'synced',
    mode,
    rootPageId: treeIndex.rootPageId,
    pageCount: pages.length,
    treeHash: treeIndex.treeHash,
    auth: treeIndex.auth,
    referenceFiles: mode === 'markdown' ? pages.map((page) => page.sourcePath).filter(Boolean) : [],
    fallbackReason,
  });

  ctx.confluenceTree = treeIndex;
  ctx.sourceIndex = {
    sourceSetHash: treeIndex.treeHash,
  };
  return {
    status: 'ok',
    mode,
    pageCount: pages.length,
    treeIndex: ctx.paths.confluenceTreeIndex,
  };
}

module.exports = { syncConfluenceTree };
