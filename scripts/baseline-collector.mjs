#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');

function die(message) { console.error(`Baseline capture failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function assertCanonicalRoot() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function requireProjectFile(projectRoot, reference, label) {
  const file = path.resolve(projectRoot, reference);
  if (!fs.existsSync(file)) die(`${label} does not exist: ${reference}`);
}
function hash(content) { return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`; }
function fingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function sameFingerprint(expected, file) { if (!expected || !fs.existsSync(file)) return false; const actual = fingerprint(file); return Object.entries(expected).every(([key, value]) => actual[key] === value); }

const [command, runArg, inputArg, projectArg] = process.argv.slice(2);
assertCanonicalRoot();
if (command !== 'capture' || !runArg || !inputArg) die('usage: capture <run-dir> <baseline-input.json> [project-root]');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'collect_existing_baseline'); } catch (error) { die(error.message); }
const projectRoot = path.resolve(projectArg || path.join(runDir, '..', '..', '..'));
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
if (state.track !== 'existing') die('Existing Baseline can only be captured for an existing run');
if (!state.artifacts.codeReference) die('complete code reference is required before Existing Baseline capture');
const codeReferencePath = path.resolve(runDir, state.artifacts.codeReference);
if (!codeReferencePath.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(codeReferencePath)) die('code reference artifact is missing or outside the run');
const codeReference = read(codeReferencePath);
if (codeReference.schemaVersion !== '3.0' || codeReference.complete !== true || !Array.isArray(codeReference.files) || !codeReference.files.length) die('code reference is not a complete source snapshot');
const integrityIndexFile = path.join(runDir, 'source-integrity-index.json');
const integrity = fs.existsSync(integrityIndexFile) ? read(integrityIndexFile) : { files: [] };
const indexedFiles = new Map((integrity.files || []).map(item => [item.path, item]));
let reusedIntegrityEntries = 0;
for (const item of codeReference.files) {
  const source = path.resolve(projectRoot, item.path || ''); const copy = path.resolve(runDir, item.copyPath || '');
  if (!source.startsWith(`${projectRoot}${path.sep}`) || !copy.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(source) || !fs.existsSync(copy)) die(`complete code reference is missing: ${item.path}`);
  const cached = indexedFiles.get(item.path);
  // Capture may reuse the preceding immutable snapshot when both file-system
  // fingerprints match. Gate 1/2/3 separately perform the authoritative full
  // SHA-256 recomputation before any approval or implementation authority.
  if (cached?.sha256 === item.sha256 && sameFingerprint(cached.sourceFingerprint, source) && sameFingerprint(cached.copyFingerprint, copy)) { reusedIntegrityEntries += 1; continue; }
  if (hash(fs.readFileSync(source)) !== item.sha256 || hash(fs.readFileSync(copy)) !== item.sha256) die(`project code changed after complete reference capture: ${item.path}`);
}
if (!state.artifacts.pageSkeleton) die('page skeleton is required before Existing Baseline capture');
const skeletonPath = path.resolve(runDir, state.artifacts.pageSkeleton);
if (!skeletonPath.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(skeletonPath)) die('page skeleton artifact is missing or outside the run');
const pageSkeleton = read(skeletonPath);
if (pageSkeleton.sourceTreeHash !== codeReference.sourceTreeHash || !pageSkeleton.skeletonHash || !pageSkeleton.nodes?.length) die('page skeleton does not bind the complete scoped code reference');
const displayPath = path.join(runDir, 'evidence', 'browser-capture.json');
if (!fs.existsSync(displayPath)) die('real frontend display evidence is required before Existing Baseline capture');
const display = read(displayPath);
if (display.status !== 'passed' || !Array.isArray(display.evidence) || display.evidence.some(item => item.status !== 'captured' || !item.screenshot || !item.domHtml)) die('real frontend display evidence is incomplete');
const baseline = read(path.resolve(inputArg));
baseline.schemaVersion = '3.0';
baseline.capturedAt = new Date().toISOString();
baseline.codeReference = { path: state.artifacts.codeReference, sourceTreeHash: codeReference.sourceTreeHash, sourceFileCount: codeReference.sourceFileCount, complete: true, pageSkeletonPath: state.artifacts.pageSkeleton, pageSkeletonHash: pageSkeleton.skeletonHash };
baseline.displayEvidence = { path: path.relative(runDir, displayPath), hash: hash(fs.readFileSync(displayPath)), capturedRoutes: display.evidence.map(item => item.route) };
for (const screen of baseline.screens || []) requireProjectFile(projectRoot, screen.path, `screen evidence for ${screen.viewport}`);
for (const entry of baseline.codeEntrypoints || []) requireProjectFile(projectRoot, entry, 'code entrypoint');
for (const sample of baseline.apiSamples || []) {
  requireProjectFile(projectRoot, sample.request, `API request sample for ${sample.endpoint}`);
  requireProjectFile(projectRoot, sample.response, `API response sample for ${sample.endpoint}`);
}
if (!baseline.styleBaseline || baseline.styleBaseline.mode !== 'existing-platform' || !Array.isArray(baseline.styleBaseline.sources) || !baseline.styleBaseline.sources.length) die('Existing Baseline must capture a platform style baseline with source files');
for (const source of baseline.styleBaseline.sources) {
  requireProjectFile(projectRoot, source.path, 'style baseline source');
  if (!source.sha256 || hash(fs.readFileSync(path.resolve(projectRoot, source.path))) !== source.sha256) die(`style baseline source hash does not match: ${source.path}`);
}
const output = path.join(runDir, 'existing-baseline.json');
write(output, baseline);
const result = spawnSync(process.execPath, [validator, 'validate', 'existing-baseline.schema.json', output], { encoding: 'utf8' });
if (result.status !== 0) die((result.stderr || result.stdout).trim());
state.artifacts.existingBaseline = 'existing-baseline.json';
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ baseline: output, routes: baseline.routes.length, screens: baseline.screens.length, apiSamples: baseline.apiSamples.length, reusedIntegrityEntries }));
