#!/usr/bin/env node
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { DatabaseSync } from 'node:sqlite';
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
  const ledgerPath = path.join(runDir, 'run-ledger.sqlite');
  if (!fs.existsSync(ledgerPath) || !fs.realpathSync(ledgerPath).startsWith(`${runDir}${path.sep}`)) die(`Run ledger is missing or outside the current Run: ${project.id}`);
  let state, verifiedOutputs;
  try {
    const db = new DatabaseSync(ledgerPath, { readOnly: true });
    try {
      db.exec('BEGIN');
      const snapshot = db.prepare('SELECT state_json, state_hash FROM state_snapshots ORDER BY id DESC LIMIT 1').get();
      if (!snapshot) throw new Error('durable state is missing');
      state = JSON.parse(snapshot.state_json);
      const stateHash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
      if (stateHash(state) !== snapshot.state_hash || stateHash(read(statePath)) !== snapshot.state_hash) throw new Error('state projection differs from durable ledger');
      for (const [name, reference] of Object.entries(project.artifacts)) {
        const match = db.prepare("SELECT 1 FROM artifacts WHERE reference = ? AND sha256 = ? AND status = 'verified' LIMIT 1").get(reference, project.artifactHashes[name]);
        if (!match) throw new Error(`artifact is not currently verified in the ledger: ${name}`);
      }
      verifiedOutputs = db.prepare("SELECT reference, sha256, metadata_json FROM artifacts WHERE status = 'verified'").all();
      db.exec('COMMIT');
    } finally { db.close(); }
  } catch (error) { die(`Run ledger verification failed for ${project.id}: ${error.message}`); }
  const expectedRun = path.join(projectRoot, '.apex', 'runs', String(state.runId || ''));
  if (!state.runId || !runDir.startsWith(`${projectRoot}${path.sep}`) || !fs.existsSync(expectedRun) || fs.realpathSync(expectedRun) !== runDir) die(`Run does not belong to its project: ${project.id}`);
  for (const [name, artifact] of Object.entries(project.artifacts)) {
    const target = path.resolve(runDir, artifact);
    if (!target.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(target) || !fs.realpathSync(target).startsWith(`${runDir}${path.sep}`) || project.artifactHashes[name] !== hash(target)) die(`project evidence artifact is missing, changed, outside the Run, or unhashed: ${project.id}/${name}`);
  }
  const inventory = read(path.resolve(runDir, project.artifacts.projectInventory)), verification = read(path.resolve(runDir, project.artifacts.gate3)), provenance = read(path.resolve(runDir, project.artifacts.evidenceProvenance));
  if (path.basename(runDir) !== state.runId || inventory.projectRoot !== project.projectRoot || inventory.adapterRecommendation?.id !== project.adapterId) die(`project identity, run identity, or adapter identity does not bind to supplied evidence: ${project.id}`);
  for (const [name, stateName] of Object.entries({ projectInventory: 'projectInventory', existingBaseline: 'existingBaseline', gate3: 'verificationBundle', evidenceProvenance: 'evidenceProvenance' })) if (state.artifacts?.[stateName] !== project.artifacts[name]) die(`project evidence is not the current Run artifact: ${project.id}/${name}`);
  if (state.gates?.gate3?.status !== 'passed' || (verification.verificationStatus ?? verification.gate3) !== 'passed' || provenance.status !== 'passed') die(`project Gate 3 or provenance is not truly passed: ${project.id}`);
  for (const check of profile.requiredChecks) {
    if (!(project.checks || []).includes(check)) die(`adapter required check is absent: ${project.id}/${check}`);
    if (check === 'gate3') continue;
    const review = project.checkEvidence?.[check];
    if (!review || !Array.isArray(review.evidenceIds) || !review.evidenceIds.length || typeof review.rationale !== 'string' || review.rationale.trim().length < 12) die(`adapter check needs evidence and a review rationale: ${project.id}/${check}`);
    for (const id of review.evidenceIds) {
      const entries = (provenance.entries || []).filter(item => item.id === id);
      if (entries.length !== 1 || entries[0].result !== 'passed') die(`adapter check references missing or unpassed provenance: ${project.id}/${check}`);
      const entry = entries[0], file = path.resolve(runDir, entry.path || ''), receipt = path.resolve(runDir, entry.operationReceipt || ''), operations = path.join(runDir, 'operations');
      if (!file.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${runDir}${path.sep}`) || hash(file) !== entry.sha256 || !receipt.startsWith(`${operations}${path.sep}`) || !fs.existsSync(receipt) || !fs.realpathSync(receipt).startsWith(`${operations}${path.sep}`)) die(`adapter check evidence is missing, changed or outside the Run: ${project.id}/${check}`);
      const operation = read(receipt);
      if (operation.status !== 'succeeded' || operation.outputFileHashes?.[entry.path] !== entry.sha256) die(`adapter check evidence lacks a successful controlled operation: ${project.id}/${check}`);
      const registered = verifiedOutputs.some(item => {
        if (item.reference !== entry.path || item.sha256 !== entry.sha256) return false;
        try { const metadata = JSON.parse(item.metadata_json); return operation.authorizationRef && operation.action && operation.script && operation.operationKey && metadata.authorizationRef === operation.authorizationRef && metadata.action === operation.action && metadata.script === operation.script && metadata.operationKey === operation.operationKey; } catch { return false; }
      });
      if (!registered) die(`adapter check evidence is not bound to the controlled operation in the ledger: ${project.id}/${check}`);
    }
  }
}
console.log(JSON.stringify({ status: 'passed', projects: projects.length, adapters: adapters.size, note: 'Evidence links and review rationales are checked; semantic sufficiency and real-world independence still require professional review.' }));
