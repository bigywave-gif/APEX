#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
/** Validates real multi-viewport, state and interaction evidence before Gate 3. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { protectedVisualEvidenceChecks } from './scope-boundary.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Stability evidence failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
const [command, runArg, matrixArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'verify' || !runArg || !matrixArg) die('usage: verify <run-dir> <runtime-state-matrix.json>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const matrix = read(path.resolve(matrixArg)); const stateFile = path.join(runDir, 'state.json'); const state = read(stateFile);
const failures = []; const names = new Set();
const sourceProvenance = (() => {
  const evidencePath = path.join(runDir, 'evidence', 'runtime-browser-capture.json');
  if (!fs.existsSync(evidencePath)) return { ready: false, reason: 'formal runtime browser capture is missing' };
  const capture = read(evidencePath);
  const bindings = capture.sourceBindings || [];
  if (capture.kind !== 'runtime' || capture.status !== 'passed' || !bindings.length) return { ready: false, reason: 'formal runtime browser capture has no passed source binding evidence' };
  const expected = new Set(bindings.flatMap(binding => binding.sourceSelectionIds || []));
  if (!expected.size || (capture.sourceSelectionIds || []).some(id => !expected.has(id)) || [...expected].some(id => !(capture.sourceSelectionIds || []).includes(id))) return { ready: false, reason: 'formal runtime browser capture source-selection set diverges from its frozen bindings' };
  const missing = (capture.evidence || []).flatMap(entry => (entry.sourceBindings || []).filter(binding => !binding.rendered).map(binding => `${entry.id}:${binding.sourceMarker}`));
  if (missing.length || (capture.evidence || []).some(entry => entry.status !== 'captured' || [...expected].some(id => !(entry.sourceSelections || []).includes(id)))) return { ready: false, reason: `formal runtime source bindings are not rendered in every captured viewport (${missing.join(', ') || 'selection coverage missing'})` };
  return { ready: true, evidence: 'evidence/runtime-browser-capture.json', sourceSelectionIds: [...expected].sort(), bindings: bindings.map(binding => ({ visualNode: binding.visualNode, selector: binding.selector, sourceMarker: binding.sourceMarker, sourceSelectionIds: binding.sourceSelectionIds })) };
})();
if (!sourceProvenance.ready) failures.push(`formal runtime source provenance is incomplete: ${sourceProvenance.reason}`);
const bundle = read(path.join(runDir, state.artifacts.visualBundle || 'visual-bundle.json'));
if (matrix.responsiveContractId !== bundle.responsive?.contractId) failures.push('runtime state matrix is not bound to the frozen responsive contract');
const visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
const expectedBaseline = state.locks?.stitchSkipped === true
  ? { kind: 'effect-image', imageHash: visual.referenceImage?.sha256 }
  : (() => { const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json')); const selected = (freeze.approvedScreens || []).find(item => item.imageHash === matrix.baseline?.imageHash); return { kind: 'stitch', imageHash: selected?.imageHash }; })();
if (!expectedBaseline.imageHash || matrix.baseline?.kind !== expectedBaseline.kind || matrix.baseline?.imageHash !== expectedBaseline.imageHash) failures.push('runtime state matrix is not bound to the approved implementation baseline');
for (const stateCase of matrix.states || []) { if (names.has(stateCase.name)) failures.push(`duplicate state: ${stateCase.name}`); names.add(stateCase.name); if (stateCase.applicable && (stateCase.result !== 'passed' || !stateCase.screenshot)) failures.push(`applicable state lacks passed screenshot: ${stateCase.name}`); if (!stateCase.applicable && (stateCase.result !== 'not-applicable' || !stateCase.reason)) failures.push(`not-applicable state needs reason: ${stateCase.name}`); }
const viewportClasses = new Set();
for (const viewport of matrix.viewports || []) { if (viewportClasses.has(viewport.class)) failures.push(`duplicate responsive viewport: ${viewport.class}`); viewportClasses.add(viewport.class); if (!fs.existsSync(path.resolve(runDir, viewport.screenshot))) failures.push(`viewport screenshot missing: ${viewport.name}`); }
for (const viewportClass of ['mobile', 'tablet', 'desktop']) if (!viewportClasses.has(viewportClass)) failures.push(`responsive viewport missing: ${viewportClass}`);
const responsiveRanges = new Map((bundle.responsive?.viewports || []).map(viewport => [viewport.class, viewport])); const rangeSamples = new Map();
for (const sample of matrix.rangeChecks || []) { const range = responsiveRanges.get(sample.class); const key = `${sample.class}:${sample.width}`; if (!range || sample.width < range.minWidth || sample.width > range.maxWidth) failures.push(`responsive range sample is outside its contract: ${key}`); if (rangeSamples.has(key)) failures.push(`duplicate responsive range sample: ${key}`); rangeSamples.set(key, sample); if (!fs.existsSync(path.resolve(runDir, sample.screenshot))) failures.push(`responsive range screenshot missing: ${key}`); }
for (const viewportClass of ['mobile', 'tablet', 'desktop']) if ([...rangeSamples.values()].filter(sample => sample.class === viewportClass).length < 3) failures.push(`responsive range needs min/mid/max evidence: ${viewportClass}`);
for (const stateCase of matrix.states || []) if (stateCase.screenshot && !fs.existsSync(path.resolve(runDir, stateCase.screenshot))) failures.push(`state screenshot missing: ${stateCase.name}`);
for (const interaction of matrix.interactions || []) if (!fs.existsSync(path.resolve(runDir, interaction.evidence))) failures.push(`interaction evidence missing: ${interaction.id}`);
if (state.track === 'existing') {
  const scopeFile = path.join(runDir, state.artifacts.changeScope || 'change-scope.json');
  const scope = read(scopeFile), scopeHash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(scopeFile)).digest('hex')}`;
  for (const check of protectedVisualEvidenceChecks(runDir, scopeHash, scope.protected?.visualNodes, matrix.interactions)) if (!check.passed) failures.push(`protected visual node changed or has invalid zero-diff evidence: ${check.visualNode}`);
}
if (failures.length || matrix.status !== 'passed') die([...(failures.length ? failures : []), ...(matrix.status !== 'passed' ? ['matrix status must be passed'] : [])].join('; '));
matrix.sourceProvenance = sourceProvenance;
// The normal invocation passes the canonical output path as matrixArg.  Always
// write after enrichment; conditional writes here silently discarded the
// newly derived provenance while still reporting success.
const output = path.join(runDir, 'runtime-state-matrix.json'); write(output, matrix); state.artifacts.runtimeStateMatrix = 'runtime-state-matrix.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ evidence: output, status: 'passed', viewports: matrix.viewports.length, states: matrix.states.length }));
