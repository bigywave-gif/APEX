#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { validateFormalInteractionEvidence } from './formal-interaction-evidence.mjs';
import { controlledOutput, declaredVerificationCommand } from './verification-policy.mjs';
import { qualityEvidenceCurrent } from './quality-measurement-lib.mjs';
import { visualQualityEvidence } from './visual-quality-evidence.mjs';
import { apiContractEvidenceCurrent, apiContractEvidenceAssessment } from './api-contract-evidence.mjs';
import { apiObservationCurrent } from './api-http-observation.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function die(message) { console.error(`Verification failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
async function execute(check, projectRoot, runDir, policy) {
  try {
    if (check.type === 'formal-interactions') {
      const state = read(path.join(runDir, 'state.json'));
      if (state.roleChain?.confirmationModel !== 'two-confirmations' || !state.artifacts?.runtimeStateMatrix) return { id: check.id, status: 'unverified', reason: 'current formal interaction matrix is missing' };
      const matrix = read(path.join(runDir, state.artifacts.runtimeStateMatrix));
      const verified = validateFormalInteractionEvidence(runDir, state, matrix.interactions);
      return { id: check.id, status: 'passed', evidence: verified.tasks };
    }
    if (check.type === 'command') {
      if (policy && !declaredVerificationCommand(check, policy.inventory, policy.manifest)) return { id: check.id, status: 'unverified', reason: 'command is not an unchanged project-declared verification script' };
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
      if (policy && !controlledOutput(runDir, check.path, ['quality-evidence.mjs', 'contract-verifier.mjs'])) return { id: check.id, status: 'unverified', path: check.path, reason: 'evidence is not an unchanged controlled verification output' };
      const evidence = read(file);
      if (policy && check.path === 'evidence/contract-verification.json' && !(evidence.status === 'passed' && apiContractEvidenceCurrent(runDir, policy.state, evidence) && apiObservationCurrent(runDir, policy.state, projectRoot, evidence.samplesRef))) { const assessment = apiContractEvidenceAssessment(runDir, policy.state, evidence); return { id: check.id, path: check.path, ...assessment }; }
      if (policy && check.path === 'evidence/visual-verification.json' && (evidence.scope !== 'design-fidelity-only' || visualQualityEvidence(runDir, policy.state).status !== 'passed')) return { id: check.id, status: 'unverified', path: check.path, reason: 'current confirmed design parity is missing or stale' };
      if (policy && ['evidence/accessibility-verification.json', 'evidence/performance-verification.json'].includes(check.path)) {
        const measurementRef = evidence.measurementPath;
        if (!measurementRef || !qualityEvidenceCurrent(runDir, policy.state, evidence, check.path.includes('accessibility') ? 'accessibility' : 'performance', policy.contract, projectRoot)) return { id: check.id, status: 'unverified', path: check.path, reason: 'quality measurement is missing or stale for the current implementation' };
      }
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
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
let policy = null;
if (state.roleChain?.confirmationModel === 'two-confirmations') {
  const expectedPlan = state.artifacts?.verificationPlan;
  if (fs.realpathSync(projectRoot) !== fs.realpathSync(process.env.APEX_ROUTER_PROJECT_ROOT || '')) die('verification must use the Router-authorized project');
  if (!expectedPlan || fs.realpathSync(path.resolve(planArg)) !== fs.realpathSync(path.resolve(runDir, expectedPlan)) || !controlledOutput(runDir, expectedPlan, ['verification-planner.mjs'])) die('verification plan must be the unchanged controlled current Run plan');
  const inventoryRef = state.artifacts?.verificationInventory;
  if (!inventoryRef || !controlledOutput(runDir, inventoryRef, ['project-intake.mjs'])) die('verification inventory must be an unchanged controlled current Run output');
  const inventory = read(path.join(runDir, inventoryRef));
  const manifestPath = path.join(projectRoot, 'package.json');
  policy = { state, inventory, manifest: fs.existsSync(manifestPath) ? read(manifestPath) : null };
}
const plan = read(path.resolve(planArg));
const deliveryContract = read(path.join(runDir, state.artifacts.deliveryContract || 'delivery-contract.json'));
if (policy) policy.contract = deliveryContract;
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
    const result = await execute(check, projectRoot, runDir, policy);
    bundle[category].push(result);
    if (result.status !== 'passed') bundle.unverified.push({ category, id: check.id, status: result.status, reason: result.reason || result.error || 'check-failed' });
  }
}
const verificationStatus = bundle.unverified.length ? 'failed' : 'passed';
bundle.verificationStatus = verificationStatus;
bundle.gate3 = state.roleChain?.confirmationModel === 'two-confirmations' ? (['passed', 'failed'].includes(state.gates?.gate3?.status) ? state.gates.gate3.status : 'pending') : verificationStatus;
write(path.join(runDir, 'verification-bundle.json'), bundle);
state.artifacts.verificationBundle = 'verification-bundle.json';
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ verificationStatus, gate3: bundle.gate3, unverified: bundle.unverified.length, verificationBundle: path.join(runDir, 'verification-bundle.json') }));
if (verificationStatus !== 'passed') process.exitCode = 2;
