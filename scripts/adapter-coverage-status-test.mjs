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
    const runId = `run-${index}`, runDir = path.join(temporary, runId), projectRoot = path.join(temporary, `project-${index}`);
    fs.mkdirSync(runDir); fs.mkdirSync(projectRoot);
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
  const first = projects[0], stateFile = path.join(first.runDir, 'state.json');
  write(stateFile, { runId: first.id, gates: { gate3: { status: 'pending' } } });
  assert.notEqual(verify().status, 0, 'a pending actual Gate 3 must never be accepted');
  write(stateFile, { runId: first.id, gates: { gate3: { status: 'passed' } } });
  const bundle = path.join(first.runDir, first.artifacts.gate3);
  write(bundle, { gate3: 'passed', verificationStatus: 'failed' }); first.artifactHashes.gate3 = hash(bundle);
  assert.notEqual(verify().status, 0, 'a failed current verification must not fall back to a passed legacy field');
  console.log(JSON.stringify({ status: 'passed', scope: 'legacy and current bundle status, actual Gate 3 and failure precedence' }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
