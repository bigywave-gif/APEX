#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Visual reference compilation failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
const [command, runArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (!['compile', 'emit'].includes(command) || !runArg || !inputArg) die('usage: compile|emit <run-dir> <visual-reference-input.json>');
const runDir = path.resolve(runArg); const input = read(path.resolve(inputArg));
try { requireRouterAction(runDir, command === 'emit' ? ['compile_visual_bundle', 'generate_visual'] : 'compile_visual_bundle'); } catch (error) { die(error.message); }
const state = read(path.join(runDir, 'state.json'));
if (state.track === 'existing') {
  if (!state.artifacts.codeReference) die('Existing Visual requires a complete code reference');
  const codeReference = read(path.resolve(runDir, state.artifacts.codeReference));
  if (codeReference.complete !== true || !codeReference.files?.length) die('Existing code reference is incomplete');
  if (input.existingCodeReference?.sourceTreeHash !== codeReference.sourceTreeHash || input.existingCodeReference?.sourceFileCount !== codeReference.sourceFileCount || input.existingCodeReference?.complete !== true) die('visual input must bind the complete Existing code reference');
  if (!state.artifacts.pageSkeleton) die('Existing Visual requires a real page skeleton');
  const skeleton = read(path.resolve(runDir, state.artifacts.pageSkeleton)); const mappings = input.existingPageSkeleton?.mappings || []; const skeletonNodes = new Set((skeleton.nodes || []).map(item => `${item.sourcePath}\u0000${item.marker}`));
  if (input.existingPageSkeleton?.sourceTreeHash !== codeReference.sourceTreeHash || input.existingPageSkeleton?.skeletonHash !== skeleton.skeletonHash || new Set(mappings.map(item => item.visualNode)).size !== input.layoutLock?.nodes?.length || !input.layoutLock?.nodes?.every(node => mappings.some(item => item.visualNode === node.id)) || mappings.some(item => !skeletonNodes.has(`${item.sourcePath}\u0000${item.sourceMarker}`))) die('every visual layout node must strictly map to a node in the real Existing page skeleton');
}
if (command === 'emit' && !['gate1-visual', 'runtime-visual-baseline'].includes(input.source)) die('emit requires source: gate1-visual or runtime-visual-baseline');
const image = path.resolve(input.referenceImage?.path || '');
if (!fs.existsSync(image)) die(`reference image is missing: ${image}`);
if (input.source === 'runtime-visual-baseline') {
  const baselinePath = state.artifacts.runtimeVisualBaseline;
  if (!baselinePath) die('runtime-rendered visual input requires a frozen runtime visual baseline');
  const baseline = read(path.join(runDir, baselinePath));
  if (path.resolve(runDir, baseline.referenceImage.path) !== image || baseline.referenceImage.sha256 !== hash(image)) die('runtime-rendered visual input must use the baseline screenshot unchanged');
}
for (const key of ['contentLock', 'layoutLock', 'analyticsLock', 'designTokens', 'componentContracts']) if (!(key in input)) die(`${key} is required`);
if (input.contentLock.locale !== 'zh-CN' || !Array.isArray(input.contentLock.protectedText) || !input.contentLock.protectedText.length) die('contentLock must contain zh-CN protected text');
if (input.layoutLock.mode !== 'strict') die('layoutLock.mode must be strict');
if (!Array.isArray(input.layoutLock.nodes) || !input.layoutLock.nodes.length || input.layoutLock.nodes.some(node => !node.id || !node.marker || !node.kind || !Number.isInteger(node.order))) die('layoutLock.nodes must define id, marker, kind and integer order for every protected node');
if (!Array.isArray(input.analyticsLock.charts) || !input.analyticsLock.charts.length || input.analyticsLock.charts.some(chart => !chart.marker)) die('analyticsLock.charts must define a marker for every chart');
if (!input.componentContracts.every(component => component?.id && component.marker && component.kind)) die('componentContracts must define id, marker and kind for every component');
const contentHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(input.contentLock)).digest('hex')}`;
const layoutHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(input.layoutLock)).digest('hex')}`;
const analyticsHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(input.analyticsLock)).digest('hex')}`;
const artifact = { schemaVersion: '3.0', source: input.source || 'manual-visual-input', referenceImage: { path: path.relative(runDir, image), sha256: hash(image), viewport: input.referenceImage.viewport || 'desktop' }, contentLock: { ...input.contentLock, hash: contentHash }, layoutLock: { ...input.layoutLock, hash: layoutHash }, analyticsLock: { ...input.analyticsLock, hash: analyticsHash }, designTokens: input.designTokens, componentContracts: input.componentContracts, ...(state.track === 'existing' ? { existingCodeReference: input.existingCodeReference, existingPageSkeleton: input.existingPageSkeleton } : {}) };
const output = path.join(runDir, 'visual-reference.json'); write(output, artifact);
const stateFile = path.join(runDir, 'state.json'); if (fs.existsSync(stateFile)) { state.artifacts.visualReference = 'visual-reference.json'; if (command === 'emit') { write(path.join(runDir, 'gate1-visual-output.json'), input); state.artifacts.gate1VisualOutput = 'gate1-visual-output.json'; } state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state); }
console.log(JSON.stringify({ visualReference: output, gate1VisualOutput: command === 'emit' ? path.join(runDir, 'gate1-visual-output.json') : null, referenceHash: artifact.referenceImage.sha256 }));
