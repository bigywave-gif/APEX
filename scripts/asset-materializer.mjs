#!/usr/bin/env node
import { commitRunState, readRunStateForUpdate } from './run-ledger.mjs';
import { canonicalApexRoot } from './apex-paths.mjs';
/** Freezes and transfers only the selected static/owned visual source files. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Asset materializer failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, value) { const target = path.resolve(root, value || ''); return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null; }
function safeFile(root, value) {
  const target = inside(root, value);
  if (!target) return null;
  try { const realRoot = fs.realpathSync(root), real = fs.realpathSync(target); return real.startsWith(`${realRoot}${path.sep}`) && fs.statSync(real).isFile() ? target : null; } catch { return null; }
}
// Validate existing ancestors before creating directories; never write through a final symlink.
function safeTarget(root, value, create = false) {
  if (typeof value !== 'string' || path.isAbsolute(value)) return null;
  const target = inside(root, value);
  if (!target) return null;
  const realRoot = fs.realpathSync(root), parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stat) { if (create && i < parts.length - 1) { fs.mkdirSync(current); stat = fs.lstatSync(current); } else continue; }
    if (i === parts.length - 1 && stat.isSymbolicLink()) return null;
    let real; try { real = fs.realpathSync(current); } catch { return null; }
    if (!real.startsWith(`${realRoot}${path.sep}`) || (i < parts.length - 1 && !fs.statSync(current).isDirectory()) || (i === parts.length - 1 && !fs.statSync(current).isFile())) return null;
  }
  return target;
}
const [command, runArg, thirdArg, fourthArg] = process.argv.slice(2);
const inputArg = command === 'collect' ? thirdArg : null;
const projectArg = command === 'collect' ? fourthArg : thirdArg;
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (!['collect', 'apply', 'audit'].includes(command) || !runArg) die('usage: collect <run-dir> <selection.json> | apply|audit <run-dir> <project-root>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, command === 'collect' ? 'compile_visual_bundle' : command === 'apply' ? 'implement' : 'verify'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json'); const { state, expectedStateHash } = readRunStateForUpdate(runDir);
if (command === 'collect') {
  if (!inputArg) die('collect requires a materialization selection file'); const input = read(path.resolve(inputArg)); const plan = read(path.join(runDir, state.artifacts.visualExecutionPlan || 'visual-execution-plan.json')); const selections = new Map((plan.sourceSelections || []).map(item => [item.id, item])); const sourceManifest = read(path.join(runDir, state.artifacts.visualSourceManifest || 'visual-source-manifest.json')); const sourcesBySelection = new Map((sourceManifest.sources || []).map(source => [source.planSourceSelectionId, source])); const runtimeLock = read(path.join(runDir, state.artifacts.runtimeSourceLock || 'runtime-source-lock.json')); const runtimeRoot = runtimeLock.sourceKind === 'visual-sandbox' ? inside(runDir, runtimeLock.runtimeRoot) : null; const assets = [];
  for (const item of input.items || []) { const selection = selections.get(item.selectionId); const visualSource = sourcesBySelection.get(item.selectionId); const source = safeFile(runDir, item.sourcePath); if (!selection || !visualSource || visualSource.materialization !== selection.materialization || !['inline-transfer', 'generated-source'].includes(selection.materialization) || !source || !item.projectPath || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(item.selectionId) || path.isAbsolute(item.projectPath) || !inside('/project', item.projectPath)) die(`invalid materialization item: ${item.selectionId || '<unknown>'}`); if (selection.sourceType === 'approved-candidate') { const expectedFiles = (visualSource.resolvedFiles || []).map(file => ({ ...file, absolute: runtimeRoot && safeFile(runtimeRoot, file.path) && safeFile(runDir, path.join(runtimeRoot, file.path)) })); const matched = expectedFiles.find(file => file.absolute === source && file.sha256 === hash(source)); if (!matched) die(`materialized candidate file is not the exact rendered source selection: ${item.selectionId}`); } const storedRef = path.join('materialized-assets', 'files', `${item.selectionId}-${path.basename(source)}`); const stored = safeTarget(runDir, storedRef, true); if (!stored) die(`unsafe frozen asset path: ${item.selectionId}`); fs.copyFileSync(source, stored); assets.push({ selectionId: item.selectionId, sourcePath: path.relative(runDir, source), sourceHash: hash(source), storedPath: path.relative(runDir, stored), storedHash: hash(stored), projectPath: item.projectPath, license: item.license || null }); }
  if (!assets.length) die('at least one selected source file must be materialized'); for (const selection of selections.values()) if (['inline-transfer', 'generated-source'].includes(selection.materialization) && selection.sourceType === 'approved-candidate') { const source = sourcesBySelection.get(selection.id); const expected = (source?.resolvedFiles || []).filter(file => file.role !== 'package-manifest'); const actual = assets.filter(asset => asset.selectionId === selection.id); if (!expected.length || actual.length !== expected.length || expected.some(file => !actual.some(asset => asset.sourceHash === file.sha256))) die(`every rendered selected source file must be materialized: ${selection.id}`); } const manifest = { schemaVersion: '3.0', assets }; write(path.join(runDir, 'materialized-assets.json'), manifest); state.artifacts.materializedAssets = 'materialized-assets.json'; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'asset-materializer-state-update', expectedStateHash }); console.log(JSON.stringify({ materializedAssets: assets.length }));
} else {
  if (!projectArg) die(`${command} requires a project root`); const projectRoot = path.resolve(projectArg); const manifest = read(path.join(runDir, state.artifacts.materializedAssets || 'materialized-assets.json')); const errors = [];
  const pending = [];
  for (const asset of manifest.assets || []) {
    const stored = safeFile(runDir, asset.storedPath);
    const target = command === 'apply' ? safeTarget(projectRoot, asset.projectPath) : safeFile(projectRoot, asset.projectPath);
    if (!stored || hash(stored) !== asset.storedHash) errors.push(`${asset.selectionId}: frozen source changed or outside run`);
    else if (!target) errors.push(`${asset.selectionId}: project materialization path missing or outside project`);
    else pending.push({ asset, stored, target });
  }
  if (!errors.length) for (const { asset, stored, target } of pending) {
    if (command === 'apply') {
      const checked = safeTarget(projectRoot, asset.projectPath, true);
      if (!checked || !safeFile(runDir, asset.storedPath) || hash(stored) !== asset.storedHash) { errors.push(`${asset.selectionId}: asset path changed before write`); break; }
      const temporary = path.join(path.dirname(checked), `.apex-asset-${crypto.randomUUID()}`);
      try { fs.copyFileSync(stored, temporary, fs.constants.COPYFILE_EXCL); fs.renameSync(temporary, checked); }
      finally { fs.rmSync(temporary, { force: true }); }
    }
    if (!safeFile(projectRoot, asset.projectPath) || hash(target) !== asset.storedHash) errors.push(`${asset.selectionId}: project materialization missing or changed`);
  }
  const result = { status: errors.length ? 'failed' : 'passed', errors, assets: manifest.assets?.length || 0 }; if (command === 'audit') { write(path.join(runDir, 'evidence', 'materialized-assets-audit.json'), result); state.artifacts.materializedAssetsAudit = 'evidence/materialized-assets-audit.json'; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'asset-materializer-state-update', expectedStateHash }); } console.log(JSON.stringify(result)); if (errors.length) process.exitCode = 2;
}
