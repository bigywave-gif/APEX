import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { implementationSealCurrent, recoverImplementationSeal, visualSourceCurrent } from './implementation-seal.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-seal-test-'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
try {
  const refs = ['approvals/demo.json', 'bundle.json', 'map.json', 'presentation.md', 'presentation.json'];
  for (const ref of refs) { const file = path.join(root, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ref); }
  const hashes = refs.map(ref => ({ path: ref, sha256: sha(fs.readFileSync(path.join(root, ref))) }));
  const sealPath = `machine-seals/implementation-${sha(JSON.stringify(hashes))}.json`;
  fs.mkdirSync(path.join(root, 'machine-seals'));
  const seal = { schemaVersion: '3.0', type: 'implementation-machine-seal', status: 'validated', runId: 'run', demoApproval: refs[0], artifactHashes: hashes };
  fs.writeFileSync(path.join(root, sealPath), JSON.stringify(seal));
  const state = { runId: 'run', artifacts: { visualBundle: refs[1], implementationMap: refs[2], implementationPresentation: refs[3], implementationPresentationManifest: refs[4] }, gates: { gate2: { evidence: [sealPath] } } };
  assert.equal(implementationSealCurrent(root, state, refs[0]), true);
  assert.equal(implementationSealCurrent(root, state, 'approvals/other.json'), false);
  fs.appendFileSync(path.join(root, refs[2]), 'modified');
  assert.equal(implementationSealCurrent(root, state, refs[0]), false);
  fs.writeFileSync(path.join(root, refs[2]), refs[2]);
  fs.writeFileSync(path.join(root, sealPath), JSON.stringify({ ...seal, runId: 'other' }));
  assert.equal(implementationSealCurrent(root, state, refs[0]), false);
  fs.writeFileSync(path.join(root, sealPath), JSON.stringify({ ...seal, artifactHashes: hashes.slice(1) }));
  assert.equal(implementationSealCurrent(root, state, refs[0]), false);
  fs.writeFileSync(path.join(root, sealPath), JSON.stringify(seal));
  assert.equal(implementationSealCurrent(root, { ...state, gates: { gate2: { evidence: [] } } }, refs[0]), false);
  fs.unlinkSync(path.join(root, sealPath));
  assert.equal(recoverImplementationSeal(root, state, refs[0]).status, 'recovered');
  assert.equal(implementationSealCurrent(root, state, refs[0]), true);
  fs.unlinkSync(path.join(root, sealPath)); fs.appendFileSync(path.join(root, refs[2]), 'changed');
  assert.equal(recoverImplementationSeal(root, state, refs[0]).status, 'failed');
  assert.equal(fs.existsSync(path.join(root, sealPath)), false);

  fs.writeFileSync(path.join(root, refs[2]), refs[2]);
  const sourceRef = 'visual-source.json', sourcePath = path.join(root, sourceRef); fs.writeFileSync(sourcePath, '{"version":1}');
  fs.writeFileSync(path.join(root, refs[1]), JSON.stringify({ visualSourceManifest: { path: sourceRef, hash: `sha256:${sha(fs.readFileSync(sourcePath))}` } }));
  const sourceHashes = refs.map(ref => ({ path: ref, sha256: sha(fs.readFileSync(path.join(root, ref))) }));
  const sourceSeal = `machine-seals/implementation-${sha(JSON.stringify(sourceHashes))}.json`;
  fs.writeFileSync(path.join(root, sourceSeal), JSON.stringify({ ...seal, artifactHashes: sourceHashes }));
  const current = { ...state, roleChain: { confirmationModel: 'two-confirmations' }, artifacts: { ...state.artifacts, visualSourceManifest: sourceRef }, gates: { gate2: { evidence: [sourceSeal] } } };
  assert.equal(implementationSealCurrent(root, current, refs[0]), true);
  assert.equal(visualSourceCurrent(root, current), true);
  fs.appendFileSync(sourcePath, ' ');
  assert.equal(visualSourceCurrent(root, current), false);
  assert.equal(implementationSealCurrent(root, current, refs[0]), false);
  fs.unlinkSync(path.join(root, sourceSeal));
  assert.equal(recoverImplementationSeal(root, current, refs[0]).status, 'failed');
  assert.equal(fs.existsSync(path.join(root, sourceSeal)), false);
  fs.writeFileSync(sourcePath, '{"version":1}');
  assert.equal(recoverImplementationSeal(root, current, refs[0]).status, 'recovered');

  console.log(JSON.stringify({ status: 'passed', checks: 10 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
