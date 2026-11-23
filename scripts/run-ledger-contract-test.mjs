#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitRunState, readRunState, reconcileRun, recordArtifact, runLedgerPaths } from './run-ledger.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ledger-'));
try {
  const initial = { runId: 'ledger-test', revision: 1, artifacts: {} };
  commitRunState(root, initial, { reason: 'test-initial', event: { type: 'run-created' }, checkpoint: 'initial' });
  const next = { ...initial, revision: 2, phase: 'G-02' };
  commitRunState(root, next, { reason: 'test-transition', event: { type: 'gate-transition' } });
  const casRoot = path.join(root, 'cas');
  const expected = commitRunState(casRoot, next, { reason: 'cas-initial' }).stateHash;
  const newer = { ...next, revision: 3, phase: 'G-03 concurrent' };
  commitRunState(casRoot, newer, { reason: 'concurrent-writer', expectedStateHash: expected });
  assert.throws(() => commitRunState(casRoot, { ...next, revision: 3, phase: 'stale' }, { expectedStateHash: expected }), /run state changed before atomic commit/);
  assert.deepEqual(readRunState(casRoot), newer, 'stale state must not overwrite the newer durable state');
  // Simulate a crash after committing newer state but before its projection.
  // An old projection with a fresh mtime must not be imported as a legacy edit.
  fs.writeFileSync(path.join(casRoot, 'state.json'), JSON.stringify(next));
  assert.deepEqual(readRunState(casRoot), newer, 'previously committed projection must recover the latest durable state');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(casRoot, 'state.json'), 'utf8')), newer, 'recovery must repair the projection');

  fs.writeFileSync(path.join(root, 'state.json'), '{broken');
  assert.deepEqual(readRunState(root), next, 'ledger must recover a broken compatibility projection');
  // Older guarded scripts occasionally replaced state.json without advancing
  // revision.  The compatibility layer must import the newer projection
  // rather than resurrect an earlier Gate state from the ledger.
  const legacyProjection = { ...next, phase: 'G-03 legacy-projection' };
  fs.writeFileSync(path.join(root, 'state.json'), `${JSON.stringify(legacyProjection, null, 2)}\n`);
  assert.deepEqual(readRunState(root), legacyProjection, 'a newer legacy projection must be imported without revision-based rollback');
  assert.equal(reconcileRun(root).status, 'consistent');
  fs.writeFileSync(path.join(root, 'artifact.txt'), 'immutable evidence');
  const artifactHash = 'sha256:762eae78c6f230f3e1ebea889e8e57ef06b80a5cf3a062e19a6dd569dbe772f9';
  recordArtifact(root, { artifactId: 'source', reference: 'artifact.txt', sha256: artifactHash });
  recordArtifact(root, { artifactId: 'derived', reference: 'artifact.txt', sha256: artifactHash, parentArtifactIds: ['source'] });
  assert.equal(reconcileRun(root).artifactLineage.edges, 1, 'artifact dependency must be durable');
  assert.equal(reconcileRun(root).status, 'consistent', 'registered evidence must verify before mutation');
  fs.writeFileSync(path.join(root, 'artifact.txt'), 'mutated evidence');
  assert.equal(reconcileRun(root).status, 'repair-required', 'hash drift must block a run');
  assert.ok(fs.existsSync(runLedgerPaths(root).ledger), 'ledger database must exist');
  console.log(JSON.stringify({ status: 'passed', checks: 9 }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
