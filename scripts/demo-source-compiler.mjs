#!/usr/bin/env node
/** Compile a host-authored runtime Demo source input into the only manifest the sandbox writer accepts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Demo source compile failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${path.basename(file)}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
const [command, runArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg || !inputArg) die('usage: demo-source-compiler.mjs compile <run-dir> <demo-source-input.json>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'generate_visual'); } catch (error) { die(error.message); }
const inputFile = path.resolve(inputArg);
if (!inputFile.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(inputFile)) die('Demo source input must be an existing file inside the current run');
const input = read(inputFile);
if (input.schemaVersion !== '3.0' || typeof input.entrypoint !== 'string' || !Array.isArray(input.files) || !input.files.length || !Array.isArray(input.sourceBindings)) die('Demo source input requires schemaVersion 3.0, entrypoint, files, and sourceBindings');
const stateFile = path.join(runDir, 'state.json'); const state = read(stateFile);
const planFile = state.artifacts?.visualExecutionPlan ? path.join(runDir, state.artifacts.visualExecutionPlan) : null;
if (!planFile || !fs.existsSync(planFile)) die('Demo source compilation requires the current confirmed visual-execution-plan.json');
const plan = read(planFile); const selected = new Set((plan.sourceSelections || []).map(item => item.id));
const bindings = new Map(input.sourceBindings.map(item => [item?.sourceSelectionId, item]));
if (!selected.size || input.sourceBindings.length !== selected.size || bindings.size !== selected.size || [...selected].some(id => !bindings.has(id))) die('Demo source bindings must cover every confirmed visual source selection exactly once');
for (const binding of bindings.values()) if (!Array.isArray(binding.files) || !binding.files.length || binding.files.some(file => typeof file !== 'string')) die('each Demo source binding must declare its materialized files');
const declared = new Set(input.files.map(file => file?.path));
if (declared.size !== input.files.length || [...bindings.values()].some(binding => binding.files.some(file => !declared.has(file)))) die('Demo source bindings must only reference declared Demo files');
const contentByPath = new Map(input.files.map(file => [file.path, typeof file?.content === 'string' ? file.content : '']));
for (const [sourceSelectionId, binding] of bindings.entries()) {
  const marker = `data-apex-source-selection`;
  const declaredInRenderedSource = binding.files.some(file => {
    const content = contentByPath.get(file) || '';
    return content.includes(`${marker}=\"${sourceSelectionId}\"`) || content.includes(`${marker}='${sourceSelectionId}'`);
  });
  if (!declaredInRenderedSource) die(`Demo source must render the selected source marker for ${sourceSelectionId}; sourceBindings alone are not runtime evidence`);
}
let existingPageSkeleton = null;
if (state.track === 'existing') {
  const skeletonFile = state.artifacts?.pageSkeleton ? path.join(runDir, state.artifacts.pageSkeleton) : null;
  if (!skeletonFile || !fs.existsSync(skeletonFile)) die('Existing Demo source compilation requires the frozen page-skeleton.json');
  const skeleton = read(skeletonFile);
  const planBinding = plan.existingPageSkeleton;
  const knownNodeIds = new Set((skeleton.nodes || []).map(node => node.id));
  const selectedVisualNodes = new Set((plan.sourceSelections || []).flatMap(selection => selection.visualNodes || []));
  const visualMappings = new Map((planBinding?.mappings || []).map(mapping => [mapping?.visualNode, mapping?.nodeId]));
  if (!planBinding || planBinding.sourceTreeHash !== skeleton.sourceTreeHash || planBinding.skeletonHash !== skeleton.skeletonHash || visualMappings.size !== selectedVisualNodes.size || [...selectedVisualNodes].some(node => !visualMappings.has(node)) || [...visualMappings.entries()].some(([node, nodeId]) => !selectedVisualNodes.has(node) || !knownNodeIds.has(nodeId))) die('Existing visual plan must bind every selected visual node to a current frozen page-skeleton node before Demo source compilation');
  existingPageSkeleton = {
    sourceTreeHash: skeleton.sourceTreeHash,
    skeletonHash: skeleton.skeletonHash,
    mappings: plan.sourceSelections.map(selection => ({ sourceSelectionId: selection.id, nodeIds: [...new Set(selection.visualNodes.map(node => visualMappings.get(node)))].sort() }))
  };
  if (input.existingPageSkeleton && JSON.stringify(input.existingPageSkeleton) !== JSON.stringify(existingPageSkeleton)) die('Demo source input may not override the Existing visual-plan page-skeleton mapping');
}
const manifest = { schemaVersion: '3.0', entrypoint: input.entrypoint, files: input.files, sourceBindings: input.sourceBindings, ...(existingPageSkeleton ? { existingPageSkeleton } : {}) };
const output = path.join(runDir, 'demo-source-manifest.json'); write(output, manifest);
state.artifacts.demoSourceManifest = 'demo-source-manifest.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ demoSourceManifest: output, sourceBindingCount: bindings.size }));
