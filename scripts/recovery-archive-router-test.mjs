import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { appendLedgerEvent, archiveArtifacts, commitRunState, readRunState, recordArtifact, reconcileRun } from './run-ledger.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-recovery-archive-router-'));
const run = (script, args) => spawnSync(process.execPath, [path.join(scripts, script), ...args], { encoding: 'utf8', timeout: 30000 });
const sha = text => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
try {
  for (const mode of ['wrong-path', 'matched', 'interrupted', 'active', 'gate']) {
    const validPath = mode !== 'wrong-path', accepted = mode === 'matched', id = mode, session = `session-${id}`;
    let result = run('apex-router.mjs', ['intake', project, id, 'greenfield', 'standard', 'interactive', session, '确认调用 APEX']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const dir = path.join(project, '.apex', 'runs', id), reference = 'advisories/visual/result.json';
    if (mode === 'active' || mode === 'gate') {
      const state = readRunState(dir);
      if (mode === 'active') state.artifacts.recoveryFixture = reference;
      else state.gates.gate1.evidence = [reference];
      state.revision += 1;
      commitRunState(dir, state, { reason: 'active-reference-fixture' });
    }
    const currentRef = 'advisories/visual/current.json', currentFile = path.join(dir, currentRef);
    recordArtifact(dir, { artifactId: 'old-version', reference: currentRef, sha256: sha('old') });
    archiveArtifacts(dir, [currentRef], 'fixture-revision');
    fs.mkdirSync(path.dirname(currentFile), { recursive: true }); fs.writeFileSync(currentFile, 'current');
    recordArtifact(dir, { artifactId: 'current-version', reference: currentRef, sha256: sha('current') });
    const oldArchive = path.join(dir, 'invalidated/previous', currentRef);
    fs.mkdirSync(path.dirname(oldArchive), { recursive: true }); fs.writeFileSync(oldArchive, 'old');
    recordArtifact(dir, { artifactId: 'missing-result', reference, sha256: sha('fixture') });
    const archived = path.join(dir, 'invalidated', 'fixture', validPath ? reference : 'other/result.json');
    fs.mkdirSync(path.dirname(archived), { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 5));
    appendLedgerEvent(dir, { type: mode === 'interrupted' ? 'visual-intermediates-invalidation-started' : 'visual-intermediates-invalidated', archive: 'invalidated/fixture', artifacts: [validPath ? reference : 'other/result.json'] });
    fs.writeFileSync(archived, 'fixture');
    result = run('apex-router.mjs', ['authorize', project, id, session, 'recover']);
    assert.equal(result.status, 0, result.stderr || result.stdout); const auth = JSON.parse(result.stdout).authorizationRef;
    result = run('apex-action.mjs', ['run', project, id, session, auth, 'recover', 'apex-recover.mjs', dir]);
    const db = new DatabaseSync(path.join(dir, 'run-ledger.sqlite'), { readOnly: true });
    assert.equal(db.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get('current-version').status, 'verified', 'recovery must retain the rebuilt version'); db.close();
    if (accepted) {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(reconcileRun(dir).status, 'consistent');
    } else {
      assert.notEqual(result.status, 0, 'an unrelated same-name archive must not unblock recovery');
      assert.ok(reconcileRun(dir).issues.some(issue => issue.type === 'registered-artifact-missing' && issue.reference === reference));
    }
  }
  {
    const id = 'changed-browser-capture', session = 'session-changed-browser-capture';
    let result = run('apex-router.mjs', ['intake', project, id, 'greenfield', 'standard', 'interactive', session, '确认调用 APEX']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const dir = path.join(project, '.apex', 'runs', id), reference = 'evidence/runtime-browser-capture.json', file = path.join(dir, reference);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'original');
    recordArtifact(dir, { artifactId: 'original-browser-capture', reference, sha256: sha('original') });
    fs.writeFileSync(file, 'externally-changed');
    result = run('apex-router.mjs', ['authorize', project, id, session, 'recover']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run('apex-action.mjs', ['run', project, id, session, JSON.parse(result.stdout).authorizationRef, 'recover', 'apex-recover.mjs', dir]);
    assert.notEqual(result.status, 0, 'unproven browser evidence changes must keep recovery blocked');
    assert.ok(reconcileRun(dir).issues.some(issue => issue.type === 'registered-artifact-hash-mismatch' && issue.reference === reference));
    const db = new DatabaseSync(path.join(dir, 'run-ledger.sqlite'), { readOnly: true });
    assert.equal(db.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get('original-browser-capture').status, 'verified'); db.close();
    assert.equal(fs.readFileSync(file, 'utf8'), 'externally-changed');
  }
  for (const mode of ['input-only', 'output-named-input', 'mixed-reference']) {
    const id = `recovery-${mode}`, session = `session-${id}`;
    let result = run('apex-router.mjs', ['intake', project, id, 'greenfield', 'standard', 'interactive', session, '确认调用 APEX']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const dir = path.join(project, '.apex', 'runs', id), reference = 'evidence/example-input.json', file = path.join(dir, reference);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'original');
    if (mode !== 'input-only') recordArtifact(dir, { artifactId: 'protected-output', reference, sha256: sha('original') });
    if (mode !== 'output-named-input') recordArtifact(dir, { artifactId: 'prior-input', reference, sha256: sha('original'), status: 'input' });
    fs.writeFileSync(file, 'corrected');
    result = run('apex-router.mjs', ['authorize', project, id, session, 'recover']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = run('apex-action.mjs', ['run', project, id, session, JSON.parse(result.stdout).authorizationRef, 'recover', 'apex-recover.mjs', dir]);
    const db = new DatabaseSync(path.join(dir, 'run-ledger.sqlite'), { readOnly: true });
    if (mode === 'input-only') {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(db.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get('prior-input').status, 'archived');
    } else {
      assert.notEqual(result.status, 0, 'a changed registered output must remain blocked even when its name looks like an input');
      assert.equal(db.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get('protected-output').status, 'verified');
      assert.ok(reconcileRun(dir).issues.some(issue => issue.type === 'registered-artifact-hash-mismatch' && issue.reference === reference));
    }
    db.close();
  }
  console.log(JSON.stringify({ status: 'passed', scope: 'Router recovery rejects unrelated archives and accepts exact historical evidence' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
