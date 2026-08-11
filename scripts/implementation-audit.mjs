#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { protectedFileChecks } from './scope-boundary.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Implementation audit failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, value) { const target = path.resolve(root, value || ''); return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null; }
function importsPackage(files, packageName) { const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const expression = new RegExp(`(?:from\\s*['"]${escaped}['"]|require\\(\\s*['"]${escaped}['"]|import\\(\\s*['"]${escaped}['"])`); return files.some(file => expression.test(fs.readFileSync(file, 'utf8'))); }
function usesApi(files, api) { return Boolean(api) && files.some(file => fs.readFileSync(file, 'utf8').includes(api)); }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
const [command, runArg, projectArg] = process.argv.slice(2);
canonical();
if (command !== 'audit' || !runArg || !projectArg) die('usage: audit <run-dir> <project-root>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); } const projectRoot = path.resolve(projectArg); const state = read(path.join(runDir, 'state.json'));
const map = read(path.join(runDir, state.artifacts.implementationMap || 'implementation-map.json')); const contract = read(path.join(runDir, state.artifacts.deliveryContract || 'delivery-contract.json'));
const sourceManifest = state.artifacts.visualSourceManifest ? read(path.join(runDir, state.artifacts.visualSourceManifest)) : null;
const plan = state.artifacts.visualExecutionPlan ? read(path.join(runDir, state.artifacts.visualExecutionPlan)) : null;
const errors = []; const checks = [];
if (state.track === 'existing') {
  const scope = map.scopeControl;
  if (!scope || scope.implementationPolicy !== 'deny-outside-change-closure' || scope.regressionPolicy !== 'verify-protected-baseline-without-redesign') errors.push('implementation map is missing the frozen affected-only scope boundary');
  else {
    const allowedNodes = new Set(scope.affectedVisualNodes || []), allowedTargets = new Set(scope.allowedRuntimeTargets || []);
    for (const entry of map.entries || []) if (!allowedNodes.has(entry.visualNode) || (entry.runtimeTarget || []).some(target => !allowedTargets.has(target))) errors.push(`${entry.visualNode}: implementation escaped the confirmed change closure`);
    for (const item of protectedFileChecks(projectRoot, scope.protectedFiles)) {
      if (!item.passed) errors.push(`protected baseline changed outside the confirmed scope: ${item.path}`);
      checks.push({ path: item.path, status: item.passed ? 'passed' : 'failed', kind: 'protected-baseline' });
    }
  }
}
for (const entry of map.entries || []) {
  const missingTargets = (entry.runtimeTarget || []).filter(target => !fs.existsSync(path.resolve(projectRoot, target)));
  const missingSelectors = (entry.testSelectors || []).filter(selector => !selector || !selector.startsWith('[data-testid='));
  if (missingTargets.length) errors.push(`${entry.visualNode}: runtime target missing (${missingTargets.join(', ')})`);
  if (missingSelectors.length) errors.push(`${entry.visualNode}: invalid test selector`);
  if (!entry.apiContracts?.length && contract.capabilities.includes('backend')) errors.push(`${entry.visualNode}: backend delivery requires API contract mapping`);
  const source = sourceManifest?.bindings?.find(item => item.visualNode === entry.visualNode);
  const sourceTargets = (entry.runtimeTarget || []).map(target => path.resolve(projectRoot, target)).filter(fs.existsSync);
  const markerPresent = source && sourceTargets.some(target => fs.readFileSync(target, 'utf8').includes(source.sourceMarker));
  if (!source || !entry.sourceBindings || entry.sourceBindings.selector !== source.selector || entry.sourceBindings.implementation !== source.implementation || entry.sourceBindings.sourceMarker !== source.sourceMarker || !markerPresent) errors.push(`${entry.visualNode}: frozen visual source binding is missing, diverged, or not emitted in code`);
  if (source) for (const sourceId of [source.layoutSourceId, source.componentSourceId, source.styleSourceId, source.fontSourceId, ...(source.iconSourceIds || []), ...(source.assetSourceIds || [])]) { const selected = sourceManifest.sources.find(item => item.id === sourceId); if (selected?.materialization === 'runtime-package' && !importsPackage(sourceTargets, selected.sourceId)) errors.push(`${entry.visualNode}: runtime package ${selected.sourceId} is not imported by its frozen implementation target`); }
  checks.push({ visualNode: entry.visualNode, status: missingTargets.length || missingSelectors.length ? 'failed' : 'passed', runtimeTarget: entry.runtimeTarget, testSelectors: entry.testSelectors });
}
for (const binding of map.motionBindings || []) {
  const target = path.resolve(projectRoot, binding.runtimeTarget || '');
  const selected = plan?.sourceSelections?.find(item => item.id === binding.sourceSelectionId);
  const usesSelectedRuntime = selected?.materialization !== 'runtime-package' || (fs.existsSync(target) && importsPackage([target], selected.sourceId));
  const passed = Boolean(binding.motionId && binding.sourceSelectionId && binding.selector && binding.api && fs.existsSync(target) && usesSelectedRuntime && usesApi([target], binding.api));
  if (!passed) errors.push(`motion ${binding.motionId || '<unknown>'}: implementation target, selected runtime, or declared API use is missing`);
  checks.push({ motionId: binding.motionId, status: passed ? 'passed' : 'failed', runtimeTarget: binding.runtimeTarget, engine: binding.engine });
}
for (const [kind, bindings, idField] of [['icon', map.iconBindings || [], 'iconId'], ['chart', map.chartBindings || [], 'chartId']]) for (const binding of bindings) {
  const target = path.resolve(projectRoot, binding.runtimeTarget || '');
  const selected = plan?.sourceSelections?.find(item => item.id === binding.sourceSelectionId);
  const usesSelectedRuntime = selected?.materialization !== 'runtime-package' || (fs.existsSync(target) && importsPackage([target], selected.sourceId));
  const passed = Boolean(binding[idField] && binding.sourceSelectionId && binding.selector && binding.api && fs.existsSync(target) && usesSelectedRuntime && usesApi([target], binding.api));
  if (!passed) errors.push(`${kind} ${binding[idField] || '<unknown>'}: implementation target, selected runtime, or declared API use is missing`);
  checks.push({ [idField]: binding[idField], status: passed ? 'passed' : 'failed', runtimeTarget: binding.runtimeTarget, kind });
}
if (state.track === 'existing') {
  const baseline = read(path.join(runDir, state.artifacts.existingBaseline || 'existing-baseline.json'));
  for (const entrypoint of baseline.codeEntrypoints || []) if (!fs.existsSync(path.resolve(projectRoot, entrypoint))) errors.push(`baseline entrypoint missing: ${entrypoint}`);
}
if (state.artifacts.materializedAssets) {
  const materialized = read(path.join(runDir, state.artifacts.materializedAssets));
  for (const asset of materialized.assets || []) {
    const frozen = inside(runDir, asset.storedPath);
    const target = inside(projectRoot, asset.projectPath);
    const passed = Boolean(frozen && target && fs.existsSync(frozen) && fs.existsSync(target) && hash(frozen) === asset.storedHash && hash(target) === asset.storedHash);
    if (!passed) errors.push(`materialized source ${asset.selectionId || '<unknown>'}: project file is missing or differs from the frozen selected source`);
    checks.push({ selectionId: asset.selectionId, status: passed ? 'passed' : 'failed', kind: 'materialized-source', projectPath: asset.projectPath });
  }
}
const result = { status: errors.length ? 'failed' : 'passed', evidence: checks, errors, auditedAt: new Date().toISOString() };
const output = path.join(runDir, 'evidence', 'implementation-audit.json'); write(output, result); console.log(JSON.stringify({ evidence: output, status: result.status, errors: errors.length })); if (errors.length) process.exitCode = 2;
