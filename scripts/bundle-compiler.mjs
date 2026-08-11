#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function die(message) { console.error(`Bundle compile failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

const [command, runArg, specArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg || !specArg) die('usage: compile <run-dir> <visual-spec.json>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'compile_visual_bundle'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
if (state.gates.gate1.status !== 'passed') die('Gate 1 has not passed');
if (!state.locks.visualApproved || (!state.locks.stitchCurrent && !state.locks.stitchSkipped)) die('latest Stitch canvas must be approved and current, or the Stitch stage must be explicitly skipped');
const site = read(path.join(runDir, state.artifacts.siteContract || 'site-contract.json'));
const freeze = state.locks.stitchSkipped ? null : read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
const visualReference = state.locks.stitchSkipped ? read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json')) : null;
const spec = read(path.resolve(specArg));
const dependency = read(path.join(runDir, state.artifacts.dependencyLock || 'dependency-lock.json'));
const motionContract = state.artifacts.motionContract ? read(path.join(runDir, state.artifacts.motionContract)) : null;
const capabilitySelection = state.artifacts.motionCapabilitySelection ? read(path.join(runDir, state.artifacts.motionCapabilitySelection)) : null;
const visualSourceManifest = state.artifacts.visualSourceManifest ? read(path.join(runDir, state.artifacts.visualSourceManifest)) : null;
if (state.track === 'existing') read(path.join(runDir, state.artifacts.functionalFreeze || 'functional-freeze.json'));

const approvedIds = new Set(freeze ? freeze.approvedScreens.map(screen => screen.screenId) : spec.components.map(component => component.screenId));
const mappedIds = new Set(spec.components.map(component => component.screenId));
for (const id of approvedIds) if (!mappedIds.has(id)) die(`approved Stitch screen is not mapped: ${id}`);
for (const component of spec.components) {
  if (freeze && !approvedIds.has(component.screenId)) die(`component maps an unapproved screen: ${component.screenId}`);
  for (const key of ['visualNode', 'stitchNode', 'runtimeTarget', 'designTokens', 'data', 'apiContracts', 'events', 'permissions', 'responsive', 'testSelectors', 'acceptance']) if (!(key in component)) die(`component ${component.visualNode || '<unknown>'} misses ${key}`);
}
if (!visualSourceManifest) die('a visual source manifest is required before compiling the Visual Bundle');
const visualBindings = new Map(visualSourceManifest.bindings.map(item => [item.visualNode, item]));
for (const component of spec.components) {
  const binding = visualBindings.get(component.visualNode);
  if (!binding) die(`component lacks a frozen visual source binding: ${component.visualNode}`);
  if (JSON.stringify(binding.runtimeTarget) !== JSON.stringify(component.runtimeTarget)) die(`component runtime target diverges from its visual source binding: ${component.visualNode}`);
}
for (const [items, kind] of [[spec.diagrams || [], 'diagram']]) for (const item of items) {
  if (!item || typeof item !== 'object' || !item.id) die(`${kind} must declare an id so its source can be frozen`);
  if (!visualSourceManifest.sources.some(source => source.kind === kind && source.resourceId === item.id)) die(`${kind} lacks a frozen source: ${item.id}`);
}
const planSelections = new Map((read(path.join(runDir, state.artifacts.visualExecutionPlan || 'visual-execution-plan.json')).sourceSelections || []).map(item => [item.id, item]));
const visualPlan = read(path.join(runDir, state.artifacts.visualExecutionPlan || 'visual-execution-plan.json'));
let implementationScope = null;
if (state.track === 'existing') {
  const scopeFile = path.join(runDir, state.artifacts.changeScope || 'change-scope.json');
  const frozenScope = read(scopeFile), scope = visualPlan.scopeControl;
  const allowedNodes = new Set(scope?.affectedVisualNodes || []), allowedTargets = new Set(scope?.affectedRuntimeTargets || []);
  if (!scope || scope.changeScopeHash !== `sha256:${crypto.createHash('sha256').update(fs.readFileSync(scopeFile)).digest('hex')}` || scope.implementationPolicy !== 'deny-outside-change-closure') die('Existing bundle must bind the frozen affected-only change scope');
  if (spec.components.some(component => !allowedNodes.has(component.visualNode) || component.runtimeTarget.some(target => !allowedTargets.has(target)))) die('Visual Bundle contains a component or runtime target outside the confirmed change closure');
  implementationScope = { changeScopeHash: scope.changeScopeHash, affectedVisualNodes: [...allowedNodes], allowedRuntimeTargets: [...allowedTargets], protectedVisualNodes: frozenScope.protected.visualNodes, protectedFiles: frozenScope.protected.files, implementationPolicy: 'deny-outside-change-closure', regressionPolicy: 'verify-protected-baseline-without-redesign' };
}
const iconBindings = (spec.icons || []).map(icon => {
  if (!icon?.id || !icon.sourceSelectionId || !icon.api || !icon.runtimeTarget || !icon.selector || icon.size === undefined || !icon.colorToken) die(`icon must declare id, selected source, API, target, selector, size, and color token: ${icon?.id || '<unknown>'}`);
  const selection = planSelections.get(icon.sourceSelectionId);
  const source = visualSourceManifest.sources.find(item => item.planSourceSelectionId === icon.sourceSelectionId);
  if (!selection || selection.kind !== 'icon' || !source || source.kind !== 'icon') die(`icon is not bound to a confirmed icon-library source selection: ${icon.id}`);
  const system = visualPlan.visualSystem?.iconSystem;
  if (!system || icon.sourceSelectionId !== system.sourceSelectionId || selection.sourceId !== system.family || selection.parameters.variant !== system.variant || !system.sizeScale.includes(icon.size) || !system.colorTokens.includes(icon.colorToken)) die(`icon diverges from the frozen icon visual language: ${icon.id}`);
  if (selection.sourceType === 'approved-candidate' && (!source.runtimePatternIds?.length || !source.resolvedFiles?.length)) die(`icon candidate lacks a real rendered icon-library pattern: ${icon.id}`);
  return { iconId: icon.id, sourceSelectionId: icon.sourceSelectionId, sourceType: selection.sourceType, sourceId: selection.sourceId, family: system.family, variant: system.variant, api: icon.api, runtimeTarget: icon.runtimeTarget, selector: icon.selector, size: icon.size, colorToken: icon.colorToken };
});
const chartBindings = (spec.charts || []).map(chart => {
  if (!chart?.id || !chart.sourceSelectionId || !chart.renderer || !chart.api || !chart.runtimeTarget || !chart.selector || !chart.themeSourceId || !chart.themeId || !Array.isArray(chart.paletteTokens) || !chart.paletteTokens.length || !chart.typographyToken || !chart.composition) die(`chart must declare id, selected source, renderer, API, target, selector, complete theme, and layout/style composition: ${chart?.id || '<unknown>'}`);
  const selection = planSelections.get(chart.sourceSelectionId);
  const source = visualSourceManifest.sources.find(item => item.planSourceSelectionId === chart.sourceSelectionId);
  if (!selection || selection.kind !== 'chart' || !source || source.kind !== 'chart') die(`chart is not bound to a confirmed chart source selection: ${chart.id}`);
  const system = visualPlan.visualSystem?.chartSystem;
  const theme = selection.parameters.theme;
  if (!system || chart.sourceSelectionId !== system.sourceSelectionId || chart.themeSourceId !== system.themeSourceId || chart.themeId !== system.themeId || JSON.stringify(chart.paletteTokens) !== JSON.stringify(system.paletteTokens) || chart.typographyToken !== system.typographyToken || JSON.stringify(chart.composition) !== JSON.stringify(system.composition) || !theme || theme.sourceId !== chart.themeSourceId || theme.id !== chart.themeId) die(`chart diverges from the frozen chart visual system: ${chart.id}`);
  if (selection.sourceType === 'approved-candidate' && (!source.runtimePatternIds?.length || !source.resolvedFiles?.length)) die(`chart candidate lacks a real rendered library pattern: ${chart.id}`);
  return { chartId: chart.id, sourceSelectionId: chart.sourceSelectionId, sourceType: selection.sourceType, sourceId: selection.sourceId, renderer: chart.renderer, api: chart.api, runtimeTarget: chart.runtimeTarget, selector: chart.selector, themeSourceId: chart.themeSourceId, themeId: chart.themeId, paletteTokens: chart.paletteTokens, typographyToken: chart.typographyToken, composition: chart.composition };
});
for (const item of dependency.items || []) if (!['passed', 'not-required'].includes(item.smokeTest)) die(`dependency smoke test not passed: ${item.assetRef}`);
if (spec.motion?.length) {
  if (!motionContract || motionContract.status !== 'ready') die('a ready motion contract is required when Visual Bundle contains motion');
  if (!capabilitySelection) die('motion capability selection is required when Visual Bundle contains motion');
  const contractIds = new Set(motionContract.motions.map(item => item.id));
  const selected = new Map(capabilitySelection.bindings.map(item => [item.motionId, item]));
  for (const motion of spec.motion) {
    const contract = motionContract.motions.find(item => item.id === motion.id);
    if (!contractIds.has(motion.id)) die(`Visual Bundle motion is not in the motion contract: ${motion.id}`);
    if (!selected.has(motion.id) || selected.get(motion.id).engine !== contract.engine) die(`Visual Bundle motion lacks a selected capability with the same engine: ${motion.id}`);
  }
}

const motionBindings = (spec.motion || []).map(motion => { const contract = motionContract.motions.find(item => item.id === motion.id); const selected = capabilitySelection.bindings.find(item => item.motionId === motion.id); if (JSON.stringify(motion.functionalBinding) !== JSON.stringify(contract.functionalBinding)) die(`Visual Bundle motion must preserve the frozen functional binding: ${motion.id}`); return { motionId: motion.id, sourceSelectionId: selected.sourceSelectionId, sourceType: selected.sourceType, capabilityId: selected.capabilityId, engine: contract.engine, runtimeTarget: selected.implementationPath, selector: contract.selector, api: selected.api, functionalBinding: contract.functionalBinding, keyframes: contract.keyframes, timing: contract.timing, previewTimestampsMs: selected.previewTimestampsMs }; });
const motionImplementation = spec.motion?.length ? { schemaVersion: '3.0', selectionHash: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, state.artifacts.motionCapabilitySelection))).digest('hex')}`, bindings: motionBindings } : null;
const implementation = { schemaVersion: '3.0', ...(implementationScope ? { scopeControl: implementationScope } : {}), motionBindings, iconBindings, chartBindings, entries: spec.components.map(component => { const source = visualBindings.get(component.visualNode); return { visualNode: component.visualNode, stitchNode: component.stitchNode, screenId: component.screenId, runtimeTarget: component.runtimeTarget, designTokens: component.designTokens, data: component.data, apiContracts: component.apiContracts, events: component.events, permissions: component.permissions, responsive: component.responsive, testSelectors: component.testSelectors, acceptance: component.acceptance, sourceBindings: { layoutSourceId: source.layoutSourceId, componentSourceId: source.componentSourceId, styleSourceId: source.styleSourceId, fontSourceId: source.fontSourceId, contentSourceId: source.contentSourceId, selector: source.selector, implementation: source.implementation, sourceMarker: source.sourceMarker } }; }) };
const bundle = {
  schemaVersion: '3.0',
  ...(implementationScope ? { scopeControl: implementationScope } : {}),
  siteContract: { version: site.version, hash: site.hash },
  ...(freeze ? { stitchFreeze: { path: state.artifacts.stitchFreeze || 'stitch-freeze.json', screenSetHash: freeze.fingerprints.screenSetHash } } : {}),
  implementationBaseline: freeze ? { kind: 'stitch', path: state.artifacts.stitchFreeze || 'stitch-freeze.json', hash: freeze.fingerprints.screenSetHash } : { kind: 'effect-image', path: state.artifacts.visualReference || 'visual-reference.json', hash: visualReference.referenceImage.sha256 },
  layout: spec.layout,
  components: spec.components,
  content: spec.content,
  data: spec.data,
  assets: dependency.items || [],
  icons: spec.icons,
  tables: spec.tables,
  charts: spec.charts,
  diagrams: spec.diagrams,
  motion: (spec.motion || []).map(motion => ({ ...motion, contractRef: state.artifacts.motionContract || null, contractHash: motionContract ? `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, state.artifacts.motionContract))).digest('hex')}` : null })),
  interaction: spec.interaction,
  responsive: spec.responsive,
  visualSourceManifest: { path: state.artifacts.visualSourceManifest, hash: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, state.artifacts.visualSourceManifest))).digest('hex')}` },
  implementationMap: implementation.entries,
  acceptance: spec.acceptance
};
write(path.join(runDir, 'implementation-map.json'), implementation);
if (motionImplementation) write(path.join(runDir, 'motion-implementation-map.json'), motionImplementation);
write(path.join(runDir, 'visual-bundle.json'), bundle);
state.artifacts.visualBundle = 'visual-bundle.json';
state.artifacts.implementationMap = 'implementation-map.json';
state.artifacts.motionImplementationMap = motionImplementation ? 'motion-implementation-map.json' : null;
state.phase = state.track === 'greenfield' ? 'G-08 GATE_2' : 'E-10 GATE_2';
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ visualBundle: path.join(runDir, 'visual-bundle.json'), implementationMap: path.join(runDir, 'implementation-map.json'), components: implementation.entries.length }));
