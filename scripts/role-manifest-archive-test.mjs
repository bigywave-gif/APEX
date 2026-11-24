import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeLedger, recordArtifact } from './run-ledger.mjs';
import { preserveRoleManifest } from './role-manifest-archive.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-role-manifest-archive-'));
try {
  const state = { revision: 1, artifacts: {} }; fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state)); initializeLedger(root, state, 'fixture');
  const ref = 'role-advisory-manifest.json', original = '{ "stages": { "visual": {} } }\n';
  fs.writeFileSync(path.join(root, ref), original);
  const sha256 = `sha256:${crypto.createHash('sha256').update(original).digest('hex')}`;
  recordArtifact(root, { artifactId: 'manifest-old', reference: ref, sha256 });
  const epoch = path.join(root, 'invalidated', 'epoch-1');
  const preserved = preserveRoleManifest(root, ref, epoch, 'fixture-revision');
  assert.equal(preserved.sha256, sha256); assert.equal(fs.readFileSync(path.join(root, preserved.archive), 'utf8'), original);
  const db = new DatabaseSync(path.join(root, 'run-ledger.sqlite'), { readOnly: true });
  assert.equal(db.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get('manifest-old').status, 'archived');
  const event = JSON.parse(db.prepare("SELECT payload_json FROM events WHERE event_type = 'role-manifest-preserved'").get().payload_json); db.close();
  assert.equal(event.archive, preserved.archive); assert.equal(event.sha256, sha256);
  fs.writeFileSync(path.join(root, ref), '{"stages":{}}\n');
  assert.equal(fs.readFileSync(path.join(root, preserved.archive), 'utf8'), original, 'rewriting the active manifest must not alter its archived bytes');
  assert.throws(() => preserveRoleManifest(root, ref, epoch, 'conflicting-revision'), /archive conflicts/);
  assert.throws(() => preserveRoleManifest(root, ref, path.join(root, 'outside'), 'wrong-path'), /invalidation epoch/);
  const current = fs.readFileSync(path.join(root, ref));
  recordArtifact(root, { artifactId: 'manifest-new', reference: ref, sha256: `sha256:${crypto.createHash('sha256').update(current).digest('hex')}` });
  fs.writeFileSync(path.join(root, ref), 'tampered');
  assert.throws(() => preserveRoleManifest(root, ref, path.join(root, 'invalidated', 'epoch-2'), 'tampered-revision'), /changed before archival/);
  const currentDb = new DatabaseSync(path.join(root, 'run-ledger.sqlite'), { readOnly: true });
  assert.equal(currentDb.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get('manifest-new').status, 'verified', 'a mismatched manifest must not retire its ledger evidence'); currentDb.close();
  console.log(JSON.stringify({ status: 'passed', scope: 'exact historical role manifest bytes, ledger provenance, and conflicting archive rejection' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
