#!/usr/bin/env node
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Adapter coverage failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
const [command, evidenceArg] = process.argv.slice(2); if (command !== 'verify' || !evidenceArg) die('usage: adapter-coverage.mjs verify <cross-project-evidence.json>');
const matrix = read(path.join(root, 'registry/adapter-coverage-matrix.json')), evidence = read(path.resolve(evidenceArg));
const projects = evidence.projects || [], adapters = new Set(projects.map(item => item.adapterId)), profiles = new Map((matrix.profiles || []).map(item => [item.id, item]));
if (projects.length < matrix.minimumEvidence.projects || adapters.size < matrix.minimumEvidence.distinctAdapters) die('cross-project evidence needs three completed projects using three distinct adapters');
const projectIds = new Set(), projectRoots = new Set(), runRoots = new Set();
for (const project of projects) {
  let projectRoot, runRoot;
  try { projectRoot = fs.realpathSync(project.projectRoot); runRoot = fs.realpathSync(project.runDir); }
  catch { die('each project and Run must have an existing, resolvable root'); }
  if (!project.id || projectIds.has(project.id) || projectRoots.has(projectRoot) || runRoots.has(runRoot)) die('cross-project evidence must use distinct project IDs, project roots and Runs');
  projectIds.add(project.id); projectRoots.add(projectRoot); runRoots.add(runRoot);
}
for (const project of projects) {
  if (!project.id || !profiles.has(project.adapterId) || !project.runDir || !project.artifacts?.projectInventory || !project.artifacts?.existingBaseline || !project.artifacts?.gate3 || !project.artifacts?.evidenceProvenance || !project.artifactHashes) die(`project lacks a registered adapter or required run artifacts: ${project.id || '<unknown>'}`);
  const runDir = fs.realpathSync(project.runDir), projectRoot = fs.realpathSync(project.projectRoot), profile = profiles.get(project.adapterId);
  const statePath = path.join(runDir, 'state.json');
  if (!fs.existsSync(statePath) || !fs.realpathSync(statePath).startsWith(`${runDir}${path.sep}`)) die(`Run state must belong to the current Run: ${project.id}`);
  const state = read(statePath);
  const expectedRun = path.join(projectRoot, '.apex', 'runs', String(state.runId || ''));
  if (!state.runId || !runDir.startsWith(`${projectRoot}${path.sep}`) || !fs.existsSync(expectedRun) || fs.realpathSync(expectedRun) !== runDir) die(`Run does not belong to its project: ${project.id}`);
  for (const [name, artifact] of Object.entries(project.artifacts)) {
    const target = path.resolve(runDir, artifact);
    if (!target.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(target) || !fs.realpathSync(target).startsWith(`${runDir}${path.sep}`) || project.artifactHashes[name] !== hash(target)) die(`project evidence artifact is missing, changed, outside the Run, or unhashed: ${project.id}/${name}`);
  }
  const inventory = read(path.resolve(runDir, project.artifacts.projectInventory)), verification = read(path.resolve(runDir, project.artifacts.gate3)), provenance = read(path.resolve(runDir, project.artifacts.evidenceProvenance));
  if (path.basename(runDir) !== state.runId || inventory.projectRoot !== project.projectRoot || inventory.adapterRecommendation?.id !== project.adapterId) die(`project identity, run identity, or adapter identity does not bind to supplied evidence: ${project.id}`);
  if (state.gates?.gate3?.status !== 'passed' || (verification.verificationStatus ?? verification.gate3) !== 'passed' || provenance.status !== 'passed') die(`project Gate 3 or provenance is not truly passed: ${project.id}`);
  for (const check of profile.requiredChecks) if (!(project.checks || []).includes(check)) die(`adapter required check is absent: ${project.id}/${check}`);
}
console.log(JSON.stringify({ status: 'passed', projects: projects.length, adapters: adapters.size }));
