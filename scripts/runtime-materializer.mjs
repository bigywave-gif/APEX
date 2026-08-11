#!/usr/bin/env node
/** Installs and verifies only the exact runtime packages and pattern files used by the approved effect image. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
function die(message) { console.error(`Runtime materializer failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, value) { const target = path.resolve(root, value || ''); return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null; }
function packageFile(root, name) { return path.join(root, 'node_modules', ...name.split('/'), 'package.json'); }
function commandFor(projectRoot, packages) {
  const exact = packages.map(item => `${item.package}@${item.version}`);
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return ['pnpm', ['add', '--save-exact', '--ignore-scripts', ...exact]];
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return ['yarn', ['add', '--exact', '--ignore-scripts', ...exact]];
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb')) || fs.existsSync(path.join(projectRoot, 'bun.lock'))) return ['bun', ['add', '--exact', '--ignore-scripts', ...exact]];
  return ['npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', ...exact]];
}
const [command, runArg, projectArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (!['install', 'audit'].includes(command) || !runArg || !projectArg) die('usage: install|audit <run-dir> <project-root>');
const runDir = path.resolve(runArg), projectRoot = path.resolve(projectArg);
try { requireRouterAction(runDir, command === 'install' ? 'implement' : 'verify'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile);
const plan = read(path.join(runDir, state.artifacts.visualExecutionPlan || 'visual-execution-plan.json'));
const lock = read(path.join(runDir, state.artifacts.runtimeSourceLock || 'runtime-source-lock.json'));
const selections = new Map((plan.sourceSelections || []).map(selection => [selection.id, selection]));
const runtimeSelections = [...selections.values()].filter(selection => selection.materialization === 'runtime-package');
const patternBySelection = new Map();
for (const pattern of lock.patterns || []) {
  if (!pattern.sourceSelectionId || !selections.has(pattern.sourceSelectionId)) die(`runtime lock pattern has no confirmed selection: ${pattern.id || '<unknown>'}`);
  const list = patternBySelection.get(pattern.sourceSelectionId) || []; list.push(pattern); patternBySelection.set(pattern.sourceSelectionId, list);
}
for (const selection of runtimeSelections) if (!patternBySelection.get(selection.id)?.length) die(`runtime package selection has no rendered complete pattern: ${selection.id}`);
const packageMap = new Map();
for (const selection of runtimeSelections) {
  const patterns = patternBySelection.get(selection.id); const first = patterns[0];
  if (first.package !== selection.sourceId || first.version !== selection.version) die(`runtime selection diverges from rendered pattern: ${selection.id}`);
  if (patterns.some(pattern => pattern.package !== first.package || pattern.version !== first.version)) die(`runtime selection resolves to multiple packages: ${selection.id}`);
  const key = `${first.package}@${first.version}`; const current = packageMap.get(key) || { package: first.package, version: first.version, selectionIds: [], patterns: [] };
  current.selectionIds.push(selection.id); current.patterns.push(...patterns); packageMap.set(key, current);
}
const packages = [...packageMap.values()];
if (command === 'install' && packages.length) {
  const [binary, args] = commandFor(projectRoot, packages); const result = spawnSync(binary, args, { cwd: projectRoot, encoding: 'utf8' });
  if (result.status !== 0) die(`exact runtime install failed: ${(result.stderr || result.stdout).trim()}`);
}
const errors = []; const verified = [];
for (const item of packages) {
  const manifest = packageFile(projectRoot, item.package);
  if (!fs.existsSync(manifest) || read(manifest).version !== item.version) { errors.push(`${item.package}@${item.version}: exact runtime package is not installed in the project`); continue; }
  const files = [...new Map(item.patterns.flatMap(pattern => pattern.files || []).map(file => [file.path, file])).values()];
  if (!files.length) { errors.push(`${item.package}@${item.version}: rendered pattern has no frozen files`); continue; }
  for (const file of files) { const target = inside(projectRoot, file.path); if (!target || !fs.existsSync(target) || hash(target) !== file.sha256) errors.push(`${item.package}@${item.version}: runtime pattern file differs from the rendered source: ${file.path}`); }
  verified.push({ package: item.package, version: item.version, selectionIds: item.selectionIds, files });
}
const result = { schemaVersion: '3.0', status: errors.length ? 'failed' : 'passed', packages: verified, errors, verifiedAt: new Date().toISOString() };
if (command === 'install') { write(path.join(runDir, 'runtime-materialization.json'), result); state.artifacts.runtimeMaterialization = 'runtime-materialization.json'; }
else { write(path.join(runDir, 'evidence', 'runtime-materialization-audit.json'), result); state.artifacts.runtimeMaterializationAudit = 'evidence/runtime-materialization-audit.json'; }
state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ status: result.status, packages: verified.length, errors: errors.length })); if (errors.length) process.exitCode = 2;
