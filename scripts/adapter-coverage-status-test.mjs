import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-adapter-status-'));
try {
  const matrix = JSON.parse(fs.readFileSync(path.join(root, 'registry/adapter-coverage-matrix.json')));
  const profiles = matrix.profiles.slice(0, matrix.minimumEvidence.distinctAdapters);
  const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const projects = profiles.map((profile, index) => {
    const runId = `run-${index}`, projectRoot = path.join(temporary, `project-${index}`), runDir = path.join(projectRoot, '.apex', 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const artifacts = { projectInventory: 'inventory.json', existingBaseline: 'baseline.json', gate3: 'verification.json', evidenceProvenance: 'provenance.json' };
    write(path.join(runDir, 'state.json'), { runId, gates: { gate3: { status: 'passed' } } });
    write(path.join(runDir, artifacts.projectInventory), { projectRoot, adapterRecommendation: { id: profile.id } });
    write(path.join(runDir, artifacts.existingBaseline), {});
    write(path.join(runDir, artifacts.gate3), index === 0 ? { gate3: 'passed' } : { gate3: 'pending', verificationStatus: 'passed' });
    write(path.join(runDir, artifacts.evidenceProvenance), { status: 'passed' });
    return { id: runId, runDir, projectRoot, adapterId: profile.id, checks: profile.requiredChecks, artifacts, artifactHashes: Object.fromEntries(Object.entries(artifacts).map(([name, value]) => [name, hash(path.join(runDir, value))])) };
  });
  const input = path.join(temporary, 'evidence.json');
  const verify = () => { write(input, { projects }); return spawnSync(process.execPath, [path.join(root, 'scripts/adapter-coverage.mjs'), 'verify', input], { encoding: 'utf8' }); };
  assert.equal(verify().status, 0, 'legacy and new verification bundles must both be accepted after the actual Gate 3 passed');
  const savedRoot = projects[1].projectRoot, alias = path.join(temporary, 'project-alias');
  fs.symlinkSync(projects[0].projectRoot, alias, process.platform === 'win32' ? 'junction' : 'dir'); projects[1].projectRoot = alias;
  const duplicateRoot = verify(); assert.notEqual(duplicateRoot.status, 0); assert.match(duplicateRoot.stderr, /distinct project IDs, project roots and Runs/); projects[1].projectRoot = savedRoot;
  const savedId = projects[1].id; projects[1].id = projects[0].id;
  assert.match(verify().stderr, /distinct project IDs, project roots and Runs/); projects[1].id = savedId;
  const savedRun = projects[1].runDir; projects[1].runDir = projects[0].runDir;
  assert.match(verify().stderr, /distinct project IDs, project roots and Runs/); projects[1].runDir = savedRun;
  if (process.platform !== 'win32') {
    const external = path.join(temporary, 'external.json'), baseline = path.join(projects[0].runDir, projects[0].artifacts.existingBaseline);
    fs.copyFileSync(baseline, external); fs.rmSync(baseline); fs.symlinkSync(external, baseline);
    const escapedArtifact = verify(); assert.notEqual(escapedArtifact.status, 0); assert.match(escapedArtifact.stderr, /outside the Run/);
    fs.rmSync(baseline); fs.copyFileSync(external, baseline);
  }
  const copiedRun = path.join(temporary, 'detached-run'); fs.cpSync(projects[0].runDir, copiedRun, { recursive: true });
  const originalRun = projects[0].runDir; projects[0].runDir = copiedRun;
  const detached = verify(); assert.notEqual(detached.status, 0); assert.match(detached.stderr, /Run does not belong to its project/); projects[0].runDir = originalRun;
  const movedRun = path.join(temporary, 'moved-run'); fs.renameSync(originalRun, movedRun); fs.symlinkSync(movedRun, originalRun, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedRun = verify(); assert.notEqual(linkedRun.status, 0); assert.match(linkedRun.stderr, /Run does not belong to its project/);
  fs.rmSync(originalRun); fs.renameSync(movedRun, originalRun);
  const first = projects[0], stateFile = path.join(first.runDir, 'state.json');
  write(stateFile, { runId: first.id, gates: { gate3: { status: 'pending' } } });
  assert.notEqual(verify().status, 0, 'a pending actual Gate 3 must never be accepted');
  write(stateFile, { runId: first.id, gates: { gate3: { status: 'passed' } } });
  const bundle = path.join(first.runDir, first.artifacts.gate3);
  write(bundle, { gate3: 'passed', verificationStatus: 'failed' }); first.artifactHashes.gate3 = hash(bundle);
  assert.notEqual(verify().status, 0, 'a failed current verification must not fall back to a passed legacy field');
  console.log(JSON.stringify({ status: 'passed', scope: 'distinct project identities, Run and artifact ownership, legacy and current bundle status, actual Gate 3 and failure precedence' }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
