// @ts-nocheck
const path = require('node:path');
const {
  ensureDir,
  readJson,
  readYaml,
  resolveRoot,
  writeJson,
} = require('./context');
const { registry } = require('./registry');

function parseArgs(argv) {
  const args = [...argv];
  const action = args.shift() || 'create';
  const parsed = { action, _: [] };
  const toKey = (value) =>
    value.replace(/-([a-zA-Z0-9])/g, (_, char) => char.toUpperCase());
  const setArg = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], value] : [parsed[key], value];
    } else {
      parsed[key] = value;
    }
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = toKey(arg.slice(2));
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        setArg(key, next);
        i += 1;
      } else {
        setArg(key, true);
      }
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}

function loadPolicies(rootDir) {
  return {
    flow: readYaml(rootDir, 'docs/common-tester/01-flow.yaml'),
    confluence: readYaml(rootDir, 'docs/common-tester/02-confluence.yaml'),
    artifacts: readYaml(rootDir, 'docs/common-tester/03-artifacts.yaml'),
    projectScan: readYaml(rootDir, 'docs/common-tester/04-project-scan.yaml'),
    playwright: readYaml(rootDir, 'docs/common-tester/05-playwright.yaml'),
    cache: readYaml(rootDir, 'docs/common-tester/06-cache-policy.yaml'),
  };
}

async function main() {
  const rootDir = process.cwd();
  const command = parseArgs(process.argv.slice(2));
  const entryPath = resolveRoot(rootDir, 'docs/common-tester/00-entry.md');

  if (!require('node:fs').existsSync(entryPath)) {
    throw new Error('Missing docs/common-tester/00-entry.md');
  }

  const policies = loadPolicies(rootDir);
  const lock = readJson(rootDir, policies.artifacts.lockFile, { targets: {} });
  ensureDir(resolveRoot(rootDir, policies.artifacts.workDir));

  const ctx = {
    rootDir,
    command,
    policies,
    lock,
    target: null,
    paths: {},
    stepResults: {},
    startedAt: new Date().toISOString(),
  };

  const steps = policies.flow.steps || [];
  const actionConfig = policies.flow.actions?.[command.action];
  const stepIds = actionConfig?.steps || steps.map((step) => step.id);
  if (!stepIds.length) {
    throw new Error(`No flow action configured for: ${command.action}`);
  }
  console.log(`[common-tester] action=${command.action}`);
  console.log(`[common-tester] root=${rootDir}`);

  for (const stepId of stepIds) {
    const fn = registry[stepId];
    if (!fn) {
      throw new Error(`No operator registered for flow step: ${stepId}`);
    }
    console.log(`[common-tester] step=${stepId}`);
    const result = await fn(ctx);
    ctx.stepResults[stepId] = result;
    if (result && result.status === 'failed') {
      throw new Error(`${stepId} failed: ${result.message || 'unknown error'}`);
    }
    if (result && result.status === 'waiting_for_agent') {
      console.log(`[common-tester] waiting_for_agent=${result.requestFile}`);
      console.log(`[common-tester] next=${result.nextCommand}`);
      break;
    }
  }

  const lockPath = policies.artifacts.lockFile;
  writeJson(rootDir, lockPath, ctx.lock);

  console.log('[common-tester] done');
  if (ctx.paths && ctx.paths.targetDir) {
    console.log(`[common-tester] targetDir=${path.resolve(rootDir, ctx.paths.targetDir)}`);
  }
  if (ctx.runResult?.status === 'failed') {
    console.error(`[common-tester] run_failed=${ctx.runResult.reason || 'Playwright test command failed.'}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[common-tester] failed: ${error.message}`);
  process.exitCode = 1;
});
