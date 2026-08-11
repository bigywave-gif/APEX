#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
/** Records verifiable runtime evidence for every approved WebGL/WebGPU scene. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`3D evidence failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(runDir, value, label) { const target = path.resolve(runDir, value); if (!target.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(target)) die(`${label} must exist inside the run directory`); return path.relative(runDir, target).split(path.sep).join('/'); }

const [command, runArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'record' || !runArg || !inputArg) die('usage: three-d-evidence.mjs record <run-dir> <input.json>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json'); const state = read(stateFile);
const planFile = path.join(runDir, state.artifacts.visualExecutionPlan || 'visual-execution-plan.json'); const plan = read(planFile);
if (!plan.threeD?.length) die('the frozen visual execution plan has no 3D scene');
const input = read(path.resolve(inputArg));
const scenes = [];
for (const planned of plan.threeD) {
  const provided = input.scenes?.find(item => item.id === planned.id);
  if (!provided || provided.renderer !== planned.renderer || provided.result !== 'passed') die(`passed runtime evidence is required for scene: ${planned.id}`);
  const assetSelectionIds = (planned.assets || []).map(asset => asset.sourceSelectionId); if (!Array.isArray(provided.assetSelectionIds) || provided.assetSelectionIds.length !== assetSelectionIds.length || assetSelectionIds.some(id => !provided.assetSelectionIds.includes(id))) die(`3D evidence does not consume every selected asset source: ${planned.id}`);
  scenes.push({ id: planned.id, renderer: planned.renderer, assetSelectionIds, screenshot: inside(runDir, provided.screenshot, `${planned.id} screenshot`), performanceEvidence: inside(runDir, provided.performanceEvidence, `${planned.id} performance evidence`), fallbackEvidence: inside(runDir, provided.fallbackEvidence, `${planned.id} fallback evidence`), reducedMotionEvidence: inside(runDir, provided.reducedMotionEvidence, `${planned.id} reducedMotion evidence`), result: 'passed' });
}
const evidence = { schemaVersion: '3.0', visualExecutionPlanHash: hash(planFile), scenes, status: 'passed' };
write(path.join(runDir, 'three-d-evidence.json'), evidence); state.artifacts.threeDEvidence = 'three-d-evidence.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ evidence: path.join(runDir, 'three-d-evidence.json'), scenes: scenes.length }));
