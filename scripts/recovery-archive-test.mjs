import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archivedMissingReferences } from './recovery-archive.mjs';
import { archiveArtifacts, initializeLedger, reconcileRun, recordArtifact } from './run-ledger.mjs';

const run = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-recovery-archive-'));
const hash = text => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
const put = (relative, text) => { const file = path.join(run, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
try {
  const state = { revision: 1, artifacts: {} };
  fs.writeFileSync(path.join(run, 'state.json'), JSON.stringify(state)); initializeLedger(run, state, 'fixture');
  const original = 'historical evidence', ref = 'advisories/visual/result.json';
  recordArtifact(run, { artifactId: 'old', reference: ref, sha256: hash(original) });
  put('invalidated/epoch-a/another/result.json', original);
  const events = [{ archive: 'invalidated/epoch-a', artifacts: [ref], recordedAt: '2099-01-01T00:00:00.000Z' }];
  let issues = reconcileRun(run).issues;
  assert.deepEqual(archivedMissingReferences(run, issues, events), [], 'same basename under a different path must not match');
  put(`invalidated/epoch-a/${ref}`, 'different content');
  assert.deepEqual(archivedMissingReferences(run, issues, events), [], 'the archived bytes must match the registered version');
  put(`invalidated/epoch-a/${ref}`, original);
  assert.deepEqual(archivedMissingReferences(run, issues), [], 'a matching file without a controlled invalidation event is insufficient');
  assert.deepEqual(archivedMissingReferences(run, issues, events, { artifacts: { roleDecisionSummaries: { visual: ref } } }), [], 'state-referenced evidence must not be retired');
  assert.deepEqual(archivedMissingReferences(run, issues, events, { gates: { gate2: { status: 'passed', evidence: [ref] } } }), [], 'approval evidence still referenced by a Gate must not be retired');
  assert.deepEqual(archivedMissingReferences(run, issues, events), [ref]);
  archiveArtifacts(run, archivedMissingReferences(run, issues, events), 'verified-invalidated-fixture');
  assert.equal(reconcileRun(run).status, 'consistent');
  put(ref, 'rebuilt current evidence');
  recordArtifact(run, { artifactId: 'new', reference: ref, sha256: hash('rebuilt current evidence') });
  issues = reconcileRun(run).issues;
  assert.deepEqual(archivedMissingReferences(run, issues, events), [], 'a current rebuilt artifact must not be archived again');
  assert.equal(reconcileRun(run).status, 'consistent');
  fs.rmSync(path.join(run, ref));
  assert.deepEqual(archivedMissingReferences(run, reconcileRun(run).issues, events), [], 'an old archive cannot replace a missing newer version');
  const sameRef = 'advisories/visual/same.json';
  recordArtifact(run, { artifactId: 'same-new', reference: sameRef, sha256: hash('same bytes') });
  put(`invalidated/epoch-old/${sameRef}`, 'same bytes');
  const oldEvent = [{ archive: 'invalidated/epoch-old', artifacts: [sameRef], recordedAt: '2000-01-01T00:00:00.000Z' }];
  assert.deepEqual(archivedMissingReferences(run, reconcileRun(run).issues, oldEvent), [], 'an invalidation older than the current registration cannot retire it');
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-recovery-external-'));
  try {
    const outside = path.join(external, 'result.json'); fs.writeFileSync(outside, 'rebuilt current evidence');
    const link = path.join(run, 'invalidated/epoch-link', ref); fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(outside, link);
    assert.deepEqual(archivedMissingReferences(run, reconcileRun(run).issues, events), [], 'archive evidence must remain inside the Run');
  } finally { fs.rmSync(external, { recursive: true, force: true }); }
  console.log(JSON.stringify({ status: 'passed', scope: 'full-path and content-bound recovery; rebuilt evidence remains current' }));
} finally { fs.rmSync(run, { recursive: true, force: true }); }
