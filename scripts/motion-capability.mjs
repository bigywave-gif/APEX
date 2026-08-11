#!/usr/bin/env node
/** Freezes the motion capabilities that the visual stage is allowed to use. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
const ignored = new Set(['.git', '.apex', 'node_modules', 'dist', 'build', 'coverage']);
const supported = new Set(['motion', 'framer-motion', 'gsap', 'lottie-web', '@rive-app/canvas', '@formkit/auto-animate', 'animejs', 'three', '@react-three/fiber', '@react-three/drei', '@babylonjs/core', '@babylonjs/loaders']);
function die(message) { console.error(`Motion capability failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
function walk(root, current = root, output = [], limit = 1600) { if (output.length >= limit || !fs.existsSync(current)) return output; for (const item of fs.readdirSync(current, { withFileTypes: true })) { if (ignored.has(item.name)) continue; const file = path.join(current, item.name); if (item.isDirectory()) walk(root, file, output, limit); else if (/\.(?:css|scss|sass|js|jsx|ts|tsx|mjs|vue|svelte)$/.test(item.name)) output.push(file); if (output.length >= limit) break; } return output; }
function assets(projectRoot) { const found = []; for (const file of walk(projectRoot)) { const text = fs.readFileSync(file, 'utf8'); const pathName = rel(projectRoot, file); if (/@keyframes\b/.test(text)) found.push({ path: pathName, kind: 'css-keyframes' }); if (/\.animate\s*\(|Element\.animate\s*\(/.test(text)) found.push({ path: pathName, kind: 'waapi' }); if (/from ['\"](?:motion|framer-motion)['\"]|motion\./.test(text)) found.push({ path: pathName, kind: 'motion' }); if (/from ['\"]gsap['\"]|gsap\./.test(text)) found.push({ path: pathName, kind: 'gsap' }); if (/lottie/i.test(text)) found.push({ path: pathName, kind: 'lottie' }); if (/rive/i.test(text)) found.push({ path: pathName, kind: 'rive' }); if (/from ['\"](?:three|@react-three\/[^'\"]+|@babylonjs\/[^'\"]+)['\"]|\b(?:THREE|Canvas|Engine)\b/.test(text)) found.push({ path: pathName, kind: 'three-d' }); } return found; }
const [command, runArg, projectArg, selectionArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg || !projectArg || !selectionArg) die('usage: motion-capability.mjs compile <run-dir> <project-root> <selection.json>');
const runDir = path.resolve(runArg), projectRoot = path.resolve(projectArg); try { requireRouterAction(runDir, 'compile_visual_bundle'); } catch (error) { die(error.message); }
const manifestFile = path.join(projectRoot, 'package.json'); const manifest = fs.existsSync(manifestFile) ? read(manifestFile) : { dependencies: {}, devDependencies: {} }; const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
const inventory = { schemaVersion: '3.0', projectRoot, runtime: fs.existsSync(manifestFile) ? ['node'] : [], installedPackages: Object.entries(dependencies).filter(([name]) => supported.has(name)).map(([name, version]) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name)), motionAssets: assets(projectRoot), hostCapabilities: ['ui-ux-pro-max-skill', 'shadcn-ui-reference', 'motion-ai-kit', 'framer-motion'] };
const inventoryFile = path.join(runDir, 'motion-capability-inventory.json'); write(inventoryFile, inventory);
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile);
const visualPlan = read(path.join(runDir, state.artifacts.visualExecutionPlan || 'visual-execution-plan.json'));
const sourceSelections = new Map((visualPlan.sourceSelections || []).map(item => [item.id, item]));
const plannedMotions = new Map((visualPlan.motion || []).map(item => [item.id, item]));
const source = read(path.resolve(selectionArg)); if (source.schemaVersion !== '3.0' || !Array.isArray(source.bindings) || !source.bindings.length) die('selection needs schemaVersion 3.0 and at least one motion binding');
const selection = { schemaVersion: '3.0', inventoryHash: hash(inventoryFile), designSkills: source.designSkills || [], componentSources: source.componentSources || [], bindings: source.bindings };
if (!selection.designSkills.includes('ui-ux-pro-max-skill') || !selection.componentSources.length) die('selection must include ui-ux-pro-max-skill and at least one component source');
for (const binding of selection.bindings) { const planned = plannedMotions.get(binding.motionId); const sourceSelection = sourceSelections.get(binding.sourceSelectionId); if (!binding.motionId || !binding.sourceSelectionId || !['existing-project', 'native-web', 'approved-candidate'].includes(binding.sourceType) || !['css', 'waapi', 'framer-motion', 'gsap'].includes(binding.engine) || !binding.capabilityId || !binding.implementationPath || !binding.api || !Array.isArray(binding.previewTimestampsMs) || binding.previewTimestampsMs.length < 2 || !planned || planned.sourceSelectionId !== binding.sourceSelectionId || !sourceSelection || sourceSelection.kind !== 'motion' || sourceSelection.sourceId !== binding.capabilityId || sourceSelection.sourceType !== binding.sourceType) die(`invalid or unselected capability binding: ${binding.motionId || '<unknown>'}`); if (binding.sourceType === 'existing-project' && !inventory.installedPackages.some(item => item.name === binding.capabilityId) && !inventory.motionAssets.length) die(`existing-project capability is not present: ${binding.capabilityId}`); if (binding.sourceType === 'approved-candidate' && (!binding.dependency?.package || !binding.dependency?.version || !['installed', 'planned'].includes(binding.dependency.status) || !binding.dependency.source || binding.dependency.package !== sourceSelection.sourceId || binding.dependency.version !== sourceSelection.version)) die(`online motion candidate needs an exact selected dependency plan: ${binding.motionId}`); }
const selectionFile = path.join(runDir, 'motion-capability-selection.json'); write(selectionFile, selection);
state.artifacts.motionCapabilityInventory = 'motion-capability-inventory.json'; state.artifacts.motionCapabilitySelection = 'motion-capability-selection.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ inventory: inventoryFile, selection: selectionFile, bindings: selection.bindings.length }));
