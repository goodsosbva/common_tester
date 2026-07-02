// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const {
  hashJson,
  listFiles,
  readJson,
  readText,
  resolveRoot,
  toPosix,
  writeJson,
  writeText,
} = require('../context');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFirst(files, rootDir, predicate) {
  for (const file of files) {
    const content = readText(rootDir, file);
    if (predicate(content, file)) return { file, content };
  }
  return null;
}

function extractRouteMeta(content, childPath) {
  const escaped = escapeRegExp(childPath);
  const blockMatch = content.match(new RegExp(`path:\\s*['"]${escaped}['"][\\s\\S]*?\\n\\s*},`, 'm'));
  const block = blockMatch ? blockMatch[0] : content;
  const component = block.match(/component:\s*\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)/)?.[1] || null;
  const name = block.match(/name:\s*['"]([^'"]+)['"]/)?.[1] || null;
  const title = block.match(/title:\s*['"]([^'"]+)['"]/)?.[1] || null;
  const i18n = block.match(/i18n:\s*['"]([^'"]+)['"]/)?.[1] || null;
  return { component, name, title, i18n };
}

function resolveImportFile(importerFile, importPath) {
  if (!importPath) return null;
  const importerDir = path.dirname(importerFile);
  const absolute = path.resolve(importerDir, importPath);
  const candidates = [absolute, `${absolute}.vue`, `${absolute}.ts`, `${absolute}.tsx`, path.join(absolute, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return toPosix(candidate);
  }
  return toPosix(absolute);
}

async function scanProject(ctx) {
  const rootDir = ctx.rootDir;
  const route = ctx.target.route || '';
  const routeParts = route.replace(/^\/+/, '').split('/').filter(Boolean);
  const parentPath = routeParts.length ? `/${routeParts[0]}` : null;
  const childPath = routeParts.slice(1).join('/');
  const hints = ctx.policies.projectScan.currentProjectHints || {};
  const tsFiles = listFiles(rootDir, {
    includeExt: ['.ts', '.tsx', '.vue', '.js', '.jsx'],
    excludeParts: ['node_modules', '.git', 'dist', 'build', 'docs', 'e2e'],
  });

  const packageJson = readJson(rootDir, 'package.json', {});
  const hostProjectPath = `apps/${hints.defaultHostApp || 'service-admin-web'}/project.json`;
  const hostProject = readJson(rootDir, hostProjectPath, null);

  const hostRoute = findFirst(tsFiles.filter((file) => file.startsWith('apps/') && file.endsWith('/src/pages/index.ts')), rootDir, (content) =>
    content.includes('monitoringRoutes') || content.includes('packages-monitoring')
  );
  const parentRoute = parentPath
    ? findFirst(tsFiles.filter((file) => file.includes('/src/pages/index.ts')), rootDir, (content) =>
        new RegExp(`path:\\s*['"]${escapeRegExp(parentPath)}['"]`).test(content)
      )
    : null;
  const childRoute = childPath
    ? findFirst(tsFiles.filter((file) => file.includes('/src/pages/') && file.endsWith('index.ts')), rootDir, (content) =>
        new RegExp(`path:\\s*['"]${escapeRegExp(childPath)}['"]`).test(content)
      )
    : null;

  const meta = childRoute ? extractRouteMeta(childRoute.content, childPath) : {};
  const componentFile = childRoute && meta.component
    ? toPosix(path.relative(rootDir, resolveImportFile(resolveRoot(rootDir, childRoute.file), meta.component)))
    : null;

  const envFiles = listFiles(rootDir, {
    includeExt: ['.env', '.development', '.preview', '.production'],
    excludeParts: ['node_modules', '.git', 'dist', 'build', 'docs'],
  }).filter((file) => file.startsWith(`apps/${hints.defaultHostApp || 'service-admin-web'}/.env`));
  const platformLines = envFiles.flatMap((file) => {
    const content = readText(rootDir, file);
    return content
      .split(/\r?\n/)
      .map((line, index) => ({ file, lineNumber: index + 1, line }))
      .filter((entry) => entry.line.startsWith(`${hints.platformEnvName || 'VITE_ENABLE_PLATFORM_LIST'}=`));
  });

  const model = {
    target: ctx.target,
    workspace: {
      packageName: packageJson.name,
      packageManager: packageJson.packageManager,
      scripts: packageJson.scripts || {},
    },
    hostApp: {
      name: hints.defaultHostApp || null,
      projectFile: hostProject ? hostProjectPath : null,
      projectType: hostProject?.projectType || null,
      serveCommand: hints.defaultServeCommand || null,
      baseURL: hints.defaultBaseURL || null,
    },
    route: {
      input: route,
      parentPath,
      childPath,
      hostRouteFile: hostRoute?.file || null,
      parentRouteFile: parentRoute?.file || null,
      childRouteFile: childRoute?.file || null,
      componentImport: meta.component || null,
      componentFile,
      routeName: meta.name || null,
      title: meta.title || null,
      i18nKey: meta.i18n || null,
    },
    environment: {
      platformEnvName: hints.platformEnvName || null,
      requiredPlatform: hints.requiredPlatformForMonitoring || null,
      platformLines,
      requiredPlatformPresent: platformLines.some((entry) =>
        entry.line.includes(hints.requiredPlatformForMonitoring || 'MONITORING')
      ),
    },
    unresolved: {
      hostRoute: !hostRoute,
      parentRoute: Boolean(parentPath && !parentRoute),
      childRoute: Boolean(childPath && !childRoute),
      component: Boolean(childRoute && meta.component && !componentFile),
    },
  };
  model.hash = hashJson(model);

  const evidence = [
    `# Project Evidence: ${ctx.target.targetId}`,
    '',
    `- route: ${route || '(none)'}`,
    `- host app: ${model.hostApp.name || '(unknown)'}`,
    `- serve command: ${model.hostApp.serveCommand || '(unknown)'}`,
    `- baseURL: ${model.hostApp.baseURL || '(unknown)'}`,
    `- host route file: ${model.route.hostRouteFile || '(not found)'}`,
    `- parent route file: ${model.route.parentRouteFile || '(not found)'}`,
    `- child route file: ${model.route.childRouteFile || '(not found)'}`,
    `- component file: ${model.route.componentFile || '(not found)'}`,
    `- route name: ${model.route.routeName || '(not found)'}`,
    `- i18n key: ${model.route.i18nKey || '(not found)'}`,
    `- ${model.environment.platformEnvName}: ${model.environment.requiredPlatformPresent ? 'contains required platform' : 'missing required platform'}`,
    '',
    '## Decision',
    '',
    model.route.childRouteFile && model.route.componentFile
      ? 'The target route can be composed from the host app and package route files.'
      : 'The target route could not be fully composed yet.',
    '',
  ].join('\n');

  ctx.projectModel = model;
  writeJson(rootDir, ctx.paths.projectModel, model);
  writeText(rootDir, ctx.paths.projectEvidence, evidence);

  return {
    status: 'ok',
    routeResolved: Boolean(model.route.childRouteFile && model.route.componentFile),
    componentFile: model.route.componentFile,
  };
}

module.exports = { scanProject };
