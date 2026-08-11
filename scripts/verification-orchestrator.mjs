#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';

function die(message) { console.error(`Verification failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
async function execute(check, projectRoot, runDir) {
  try {
    if (check.type === 'command') {
      const result = spawnSync('/bin/zsh', ['-lc', check.command], { cwd: projectRoot, encoding: 'utf8', timeout: check.timeoutMs || 120000 });
      return { id: check.id, status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status, output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) };
    }
    if (check.type === 'http') {
      const response = await fetch(check.url, { redirect: 'manual' });
      return { id: check.id, status: response.status === (check.expectedStatus || 200) ? 'passed' : 'failed', actualStatus: response.status, expectedStatus: check.expectedStatus || 200 };
    }
    const file = path.resolve(runDir, check.path);
    if (check.type === 'file') return { id: check.id, status: fs.existsSync(file) ? 'passed' : 'failed', path: check.path };
    if (check.type === 'evidence') {
      if (!fs.existsSync(file)) return { id: check.id, status: 'unverified', path: check.path, reason: 'evidence-missing' };
      const evidence = read(file);
      return { id: check.id, status: evidence.status === 'passed' && Array.isArray(evidence.evidence) && evidence.evidence.length ? 'passed' : 'failed', path: check.path, evidence };
    }
    return { id: check.id, status: 'failed', reason: 'unsupported-check' };
  } catch (error) { return { id: check.id, status: 'failed', error: error.message }; }
}

const [command, runArg, planArg, projectArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'run' || !runArg || !planArg) die('usage: run <run-dir> <verification-plan.json> [project-root]');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const projectRoot = path.resolve(projectArg || path.join(runDir, '..', '..', '..'));
const plan = read(path.resolve(planArg));
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
const deliveryContract = read(path.join(runDir, state.artifacts.deliveryContract || 'delivery-contract.json'));
const categoryForRequirement = {
  unit: 'code',
  integration: 'runtime',
  contract: 'contract',
  e2e: 'functional',
  visual: 'visual',
  accessibility: 'accessibility',
  performance: 'performance',
  regression: 'siteRegression',
  smoke: 'runtime'
};
const required = [...new Set((deliveryContract.verificationRequirements || []).map(requirement => categoryForRequirement[requirement]).filter(Boolean))];
for (const category of ['responsive', 'console']) if (plan.categories?.[category]?.length) required.push(category);
const bundle = { schemaVersion: '3.0', code: [], runtime: [], visual: [], functional: [], siteRegression: [], responsive: [], accessibility: [], console: [], performance: [], contract: [], unverified: [], gate3: 'pending' };
for (const category of required) {
  const checks = plan.categories?.[category] || [];
  if (!checks.length) bundle.unverified.push({ category, reason: 'no-checks' });
  for (const check of checks) {
    const result = await execute(check, projectRoot, runDir);
    bundle[category].push(result);
    if (result.status !== 'passed') bundle.unverified.push({ category, id: check.id, status: result.status, reason: result.reason || result.error || 'check-failed' });
  }
}
bundle.gate3 = bundle.unverified.length ? 'failed' : 'passed';
write(path.join(runDir, 'verification-bundle.json'), bundle);
state.artifacts.verificationBundle = 'verification-bundle.json';
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ gate3: bundle.gate3, unverified: bundle.unverified.length, verificationBundle: path.join(runDir, 'verification-bundle.json') }));
if (bundle.gate3 !== 'passed') process.exitCode = 2;
