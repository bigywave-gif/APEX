#!/usr/bin/env node
/** Freezes a visual baseline rendered from complete package patterns or native Web sources. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
function die(message) { console.error(`Runtime visual baseline failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, candidate) { const resolved = path.resolve(root, candidate); return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null; }
function packageFile(runtimeRoot, name) { return path.join(runtimeRoot, 'node_modules', ...name.split('/'), 'package.json'); }

const [command, runArg, projectArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg || !projectArg || !inputArg) die('usage: compile <run-dir> <project-root> <runtime-visual-baseline-input.json>');
const runDir = path.resolve(runArg), projectRoot = path.resolve(projectArg);
try { requireRouterAction(runDir, 'generate_visual'); } catch (error) { die(error.message); }
const input = read(path.resolve(inputArg));
if (input.schemaVersion !== '3.0' || !Array.isArray(input.patterns) || !input.referenceScreenId) die('input needs schemaVersion 3.0, a patterns array, and referenceScreenId');
const runtimeRoot = input.runtimeRoot ? inside(runDir, input.runtimeRoot) : projectRoot;
if (!runtimeRoot || !fs.existsSync(runtimeRoot)) die('runtimeRoot must be the project root or an existing run-local visual sandbox');
const sourceKind = runtimeRoot === projectRoot ? 'project-installed' : 'visual-sandbox';
const runState = read(path.join(runDir, 'state.json')); const visualPlanFile = runState.artifacts?.visualExecutionPlan && path.join(runDir, runState.artifacts.visualExecutionPlan);
if (!visualPlanFile || !fs.existsSync(visualPlanFile)) die('a confirmed visual execution plan with concrete source selections is required before a runtime baseline can be frozen');
const planSelections = new Map((read(visualPlanFile).sourceSelections || []).map(item => [item.id, item])); if (!planSelections.size) die('visual execution plan has no concrete source selections');
if (sourceKind === 'visual-sandbox' && input.patterns.length) {
  const manifestRef = read(path.join(runDir, 'state.json')).artifacts?.visualSandboxDependency;
  const manifestFile = manifestRef && inside(runDir, manifestRef); if (!manifestFile || !fs.existsSync(manifestFile)) die('run-local runtimeRoot requires a frozen visual sandbox dependency manifest');
  const manifest = read(manifestFile); if (manifest.sourceKind !== 'visual-sandbox' || manifest.runtimeRoot !== input.runtimeRoot) die('runtimeRoot does not match the frozen visual sandbox dependency manifest');
}
const evidencePath = path.join(runDir, 'evidence', 'browser-capture.json'); const evidence = read(evidencePath);
if (evidence.status !== 'passed') die('browser capture must pass before a runtime baseline can be frozen');
const screen = evidence.evidence?.find(item => item.id === input.referenceScreenId && item.status === 'captured' && item.screenshot && item.domHtml);
if (!screen) die('referenceScreenId must identify a captured browser screen with DOM evidence');
const motionSamples = evidence.motionSamples || [];
if (motionSamples.length < 2 || motionSamples.some(item => item.status !== 'captured' || !item.screenshot)) die('at least two captured runtime motion samples are required');
const ids = new Set(); const nodes = new Set();
const patterns = input.patterns.map(pattern => {
  if (!pattern?.id || ids.has(pattern.id) || !pattern.sourceSelectionId || !Array.isArray(pattern.visualNodes) || !pattern.visualNodes.length || !pattern.package || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pattern.version) || !pattern.componentPath || !Array.isArray(pattern.stylePaths) || !pattern.stylePaths.length || pattern.completeStyle !== true || pattern.noCssPatch !== true || !pattern.props || typeof pattern.props !== 'object') die(`invalid complete pattern: ${pattern?.id || '<unknown>'}`);
  const selection = planSelections.get(pattern.sourceSelectionId); if (!selection || selection.sourceId !== pattern.package || selection.version !== pattern.version || !pattern.visualNodes.every(node => selection.visualNodes.includes(node))) die(`runtime pattern is not the exact source selected in the confirmed visual plan: ${pattern.id}`);
  ids.add(pattern.id); for (const node of pattern.visualNodes) { if (nodes.has(node)) die(`visual node appears in more than one pattern: ${node}`); nodes.add(node); }
  const installed = packageFile(runtimeRoot, pattern.package); if (!fs.existsSync(installed)) die(`pattern package is not installed in the runtime source: ${pattern.package}`);
  if (read(installed).version !== pattern.version) die(`pattern package version is not exact: ${pattern.package}`);
  const files = [{ path: path.relative(runtimeRoot, installed), role: 'package-manifest' }, { path: pattern.componentPath, role: 'component' }, ...pattern.stylePaths.map(path => ({ path, role: 'style' })), ...(pattern.animationPath ? [{ path: pattern.animationPath, role: 'animation' }] : [])].map(file => { const target = inside(runtimeRoot, file.path); if (!target || !fs.existsSync(target)) die(`pattern file is missing or outside the runtime source: ${file.path}`); return { ...file, sha256: hash(target) }; });
  return { ...pattern, files };
});
const nativeSelections = [...planSelections.values()]
  .filter(selection => selection.materialization !== 'runtime-package')
  .map(selection => ({ id: selection.id, kind: selection.kind, sourceType: selection.sourceType, sourceId: selection.sourceId, resourceId: selection.resourceId, version: selection.version, materialization: selection.materialization, visualNodes: selection.visualNodes, parameters: selection.parameters }));
if (!patterns.length && !nativeSelections.length) die('runtime baseline needs a complete package pattern or a native Web source selection');
// A screenshot may only be treated as a visual baseline when its DOM declares
// every confirmed source that shaped it: layout, tokens, fonts, icons, charts,
// components, and motion.  Runtime packages additionally need file-level proof.
const expectedSourceSelections = [...planSelections.keys()];
if (!Array.isArray(evidence.sourceSelectionIds) || !expectedSourceSelections.every(id => evidence.sourceSelectionIds.includes(id)) || evidence.evidence.some(item => !Array.isArray(item.sourceSelections) || !expectedSourceSelections.every(id => item.sourceSelections.includes(id)))) die('browser evidence is not DOM-bound to every confirmed layout, token, font, icon, chart, component, and motion source selection');
const expectedSourceFiles = patterns.flatMap(pattern => (pattern.files || []).filter(file => file.role !== 'package-manifest').map(file => `${pattern.sourceSelectionId}:${file.sha256}`));
if (evidence.evidence.some(item => !Array.isArray(item.sourceFiles) || !expectedSourceFiles.every(file => item.sourceFiles.includes(file)))) die('browser evidence is not DOM-bound to every exact source file used by the rendered patterns');
const sourceLock = { schemaVersion: '3.0', projectRoot, runtimeRoot: sourceKind === 'project-installed' ? projectRoot : path.relative(runDir, runtimeRoot), sourceKind, patterns, nativeSelections };
const lockFile = path.join(runDir, 'runtime-source-lock.json'); write(lockFile, sourceLock);
const screenshot = inside(runDir, screen.screenshot), dom = inside(runDir, screen.domHtml);
if (!screenshot || !dom || !fs.existsSync(screenshot) || !fs.existsSync(dom)) die('browser evidence paths must remain inside the run directory');
for (const sample of motionSamples) { const shot = inside(runDir, sample.screenshot); if (!shot || !fs.existsSync(shot)) die(`motion screenshot is missing: ${sample.id}`); }
if (!screen.url) die('browser capture must retain the runtime Demo URL');
const viewportClass = /^\d+x\d+$/.test(screen.viewport || '') && Number(screen.viewport.split('x')[0]) < 768 ? 'mobile' : Number(screen.viewport.split('x')[0]) < 1100 ? 'tablet' : 'desktop';
const baseline = { schemaVersion: '3.0', sourceLockHash: hash(lockFile), browserCapture: { path: 'evidence/browser-capture.json', sha256: hash(evidencePath) }, runtimeDemo: { url: screen.url, entryScreenId: screen.id, viewport: viewportClass, domHtml: screen.domHtml, sourceRoot: sourceKind === 'project-installed' ? projectRoot : path.relative(runDir, runtimeRoot) }, referenceImage: { path: screen.screenshot, sha256: hash(screenshot), viewport: viewportClass }, motionSamples: motionSamples.map(item => ({ id: item.id, screenshot: item.screenshot, timestampMs: item.timestampMs })) };
const baselineFile = path.join(runDir, 'runtime-visual-baseline.json'); write(baselineFile, baseline);
const demoFile = path.join(runDir, 'runtime-demo.json'); write(demoFile, { schemaVersion: '3.0', runtimeVisualBaseline: 'runtime-visual-baseline.json', ...baseline.runtimeDemo, sourceLockHash: baseline.sourceLockHash, browserCaptureHash: baseline.browserCapture.sha256 });
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile); state.artifacts.runtimeSourceLock = 'runtime-source-lock.json'; state.artifacts.runtimeVisualBaseline = 'runtime-visual-baseline.json'; state.artifacts.runtimeDemo = 'runtime-demo.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ runtimeSourceLock: lockFile, runtimeVisualBaseline: baselineFile, runtimeDemo: demoFile, demoUrl: baseline.runtimeDemo.url, patterns: patterns.length, nativeSelections: nativeSelections.length }));
