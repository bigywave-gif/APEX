#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { controlledOutput } from './verification-policy.mjs';
import { assessMeasuredQuality, measurementMatchesRegistration, qualityEvidenceCurrent } from './quality-measurement-lib.mjs';
import { visualQualityEvidence } from './visual-quality-evidence.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Quality evidence failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function evidence(kind, input, contract, projectRoot, runDir) {
  const failures = [];
  if (kind === 'visual') {
    if (!Array.isArray(input.screens) || !input.screens.length) failures.push('screens missing');
    for (const screen of input.screens || []) {
      if (!screen.route || !screen.viewport || !screen.path) failures.push('screen requires route, viewport and path');
      else if (!fs.existsSync(path.resolve(projectRoot, screen.path)) && !fs.existsSync(path.resolve(runDir, screen.path))) failures.push(`screenshot missing: ${screen.path}`);
      if (screen.approved !== true) failures.push(`visual comparison is not approved: ${screen.route || 'unknown'}`);
    }
  } else if (kind === 'accessibility') {
    if (input.standard !== contract.qualityBar.accessibilityTarget) failures.push(`standard must equal ${contract.qualityBar.accessibilityTarget}`);
    if (!Array.isArray(input.violations)) failures.push('violations array missing');
    else if (input.violations.length) failures.push(`${input.violations.length} accessibility violations remain`);
  } else if (kind === 'performance') {
    for (const [key, limit] of Object.entries(contract.qualityBar.performanceTarget || {})) {
      if (typeof input[key] !== 'number') failures.push(`${key} metric missing`);
      else if (input[key] > limit) failures.push(`${key} ${input[key]} exceeds ${limit}`);
    }
    if (!input.environment) failures.push('measurement environment missing');
  } else die('kind must be visual, accessibility or performance');
  return { status: failures.length ? 'failed' : 'passed', evidence: [{ kind, status: failures.length ? 'failed' : 'passed', input, failures }], checkedAt: new Date().toISOString() };
}
const [command, runArg, kind, inputArg, projectArg] = process.argv.slice(2);
canonical();
if (command !== 'verify' || !runArg || !kind || !inputArg) die('usage: verify <run-dir> <visual|accessibility|performance> <input.json> [project-root]');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); } const projectRoot = path.resolve(projectArg || path.join(runDir, '..', '..', '..')); const state = read(path.join(runDir, 'state.json')); const contract = read(path.join(runDir, state.artifacts.deliveryContract || 'delivery-contract.json')); const input = read(path.resolve(inputArg));
let result;
if (state.roleChain?.confirmationModel === 'two-confirmations' && kind === 'visual') result = visualQualityEvidence(runDir, state);
else if (state.roleChain?.confirmationModel === 'two-confirmations' && ['accessibility', 'performance'].includes(kind)) {
  const reference = input.measurementPath;
  if (!reference || !controlledOutput(runDir, reference, ['quality-measurement.mjs'])) result = { status: 'unverified', evidence: [], reason: 'actual controlled measurement is missing or stale', checkedAt: new Date().toISOString() };
  else {
    const measurement = read(path.join(runDir, reference));
    if (measurement.kind !== kind || !measurementMatchesRegistration(runDir, state, measurement) || measurement.projectRoot !== fs.realpathSync(projectRoot) || fs.realpathSync(projectRoot) !== fs.realpathSync(process.env.APEX_ROUTER_PROJECT_ROOT || '')) result = { status: 'unverified', evidence: [], reason: 'measurement is not bound to the authorized project and kind', checkedAt: new Date().toISOString() };
    else {
      result = { ...assessMeasuredQuality(kind, measurement.report, contract), measurementPath: reference, measurementSha256: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, reference))).digest('hex')}` };
      if (result.status === 'passed' && !qualityEvidenceCurrent(runDir, state, result, kind, contract, projectRoot)) result = { status: 'unverified', evidence: [], reason: 'measurement context is stale', checkedAt: new Date().toISOString() };
    }
  }
} else result = evidence(kind, input, contract, projectRoot, runDir);
const output = path.join(runDir, 'evidence', `${kind}-verification.json`); write(output, result); console.log(JSON.stringify({ evidence: output, status: result.status })); if (result.status !== 'passed') process.exitCode = 2;
