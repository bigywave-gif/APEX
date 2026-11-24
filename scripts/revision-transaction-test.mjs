import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendLedgerEvent, beginRevisionTransaction, commitRunState, finalizeCommittedRevision, pendingRevisionTransactions, readRunState, reconcileRun, recordArtifact } from './run-ledger.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-revision-transaction-'));
const run = (name, args) => spawnSync(process.execPath, [path.join(scripts, name), ...args], { encoding: 'utf8', timeout: 30000 });
try {
  for (const kind of ['live', 'foreign', 'legacy', 'interrupted', 'partial', 'archive-conflict', 'base-changed', 'completed', 'committed', 'already-logged', 'conflict', 'diverged']) {
    const session = `session-${kind}`, id = `revision-${kind}`;
    let result = run('apex-router.mjs', ['intake', project, id, 'greenfield', 'standard', 'interactive', session, '确认调用 APEX']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const dir = path.join(project, '.apex', 'runs', id);
    if (kind === 'completed') {
      result = run('apex-router.mjs', ['revise', project, id, session, 'gate1', 'visible', '用户要求调整产品边界']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(pendingRevisionTransactions(dir), []);
      const revision = JSON.parse(fs.readFileSync(path.join(dir, 'prompt-revisions.ndjson'), 'utf8').trim());
      assert.equal(revision.reason, '用户要求调整产品边界'); assert.ok(revision.transactionId);
      continue;
    }
    let before = readRunState(dir);
    if (kind === 'partial' || kind === 'archive-conflict') {
      const refs = ['visual-execution-plan.json', 'runtime-demo.json'];
      for (const ref of refs) {
        const text = `fixture ${ref}`; fs.writeFileSync(path.join(dir, ref), text);
        recordArtifact(dir, { artifactId: `partial-${ref}`, reference: ref, sha256: `sha256:${crypto.createHash('sha256').update(text).digest('hex')}` });
      }
      before.artifacts.visualExecutionPlan = refs[0]; before.artifacts.runtimeDemo = refs[1]; before.revision += 1;
      commitRunState(dir, before, { reason: 'partial-revision-fixture' }); before = readRunState(dir);
    }
    const entry = { type: 'prompt-revision-transaction-started', transactionId: `transaction-${kind}`, at: new Date().toISOString(), sessionId: session, checkpoint: 'gate1', impact: 'visible', reason: '保留用户原始修改要求', stateRevision: before.revision, ownerPid: kind === 'live' ? process.pid : 2147483647, ownerHost: kind === 'foreign' ? 'another-host' : os.hostname() };
    if (kind !== 'legacy') entry.protocol = 2;
    assert.throws(() => beginRevisionTransaction(dir, { ...entry, baseStateHash: 'sha256:incorrect' }), /base state hash changed/);
    beginRevisionTransaction(dir, entry);
    assert.equal(pendingRevisionTransactions(dir)[0].reason, entry.reason);
    assert.match(pendingRevisionTransactions(dir)[0].baseStateHash, /^sha256:[a-f0-9]{64}$/);
    assert.throws(() => beginRevisionTransaction(dir, { ...entry, transactionId: 'duplicate' }), /earlier prompt revision/);
    assert.ok(reconcileRun(dir).issues.some(issue => issue.type === 'prompt-revision-pending' && issue.transactionId === entry.transactionId));
    if (kind === 'partial' || kind === 'archive-conflict') {
      const archive = 'invalidated/partial-fixture', refs = ['visual-execution-plan.json', 'runtime-demo.json'];
      appendLedgerEvent(dir, { type: 'visual-intermediates-invalidation-started', transactionId: entry.transactionId, reason: 'prompt-revision-gate1', archive, artifacts: refs });
      fs.mkdirSync(path.join(dir, archive), { recursive: true });
      fs.renameSync(path.join(dir, refs[0]), path.join(dir, archive, refs[0]));
      if (kind === 'archive-conflict') fs.writeFileSync(path.join(dir, refs[0]), 'conflicting replacement');
    }
    if (kind === 'base-changed') { const later = structuredClone(before); later.revision += 1; commitRunState(dir, later, { reason: 'changed-base-fixture' }); }
    if (['committed', 'already-logged', 'conflict', 'diverged'].includes(kind)) {
      const next = structuredClone(before); next.revision += 1; next.updatedAt = new Date().toISOString();
      next.confirmationEpochs = { ...(next.confirmationEpochs || {}), gate1: 3 };
      const revision = { at: new Date().toISOString(), sessionId: session, checkpoint: entry.checkpoint, impact: entry.impact, reason: entry.reason, stateRevision: next.revision, transactionId: entry.transactionId, revisionOutcome: { kind: 'current-checkpoint-revision' } };
      const stateHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(next)).digest('hex')}`;
      commitRunState(dir, next, { reason: 'revision-commit-fixture', event: { type: 'prompt-revision-state-committed', transactionId: entry.transactionId, stateHash, revision } });
      if (kind === 'diverged') { const later = structuredClone(next); later.revision += 1; commitRunState(dir, later, { reason: 'conflicting-state-fixture' }); }
      if (kind === 'already-logged' || kind === 'conflict') fs.writeFileSync(path.join(dir, 'prompt-revisions.ndjson'), `${JSON.stringify(kind === 'conflict' ? { ...revision, reason: 'changed' } : revision)}\n`);
    }
    result = run('apex-router.mjs', ['authorize', project, id, session, 'recover']); assert.equal(result.status, 0, result.stderr || result.stdout);
    const auth = JSON.parse(result.stdout).authorizationRef;
    result = run('apex-action.mjs', ['run', project, id, session, auth, 'recover', 'apex-recover.mjs', dir]);
    if (kind === 'live' || kind === 'foreign') { assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(JSON.parse(result.stdout).status, 'waiting'); }
    else if (kind === 'legacy') { assert.notEqual(result.status, 0); assert.match(result.stderr, /lacks replayable provenance/); }
    else if (kind === 'archive-conflict') {
      assert.notEqual(result.status, 0); assert.match(result.stderr, /conflicting source and target/);
      const retryAuth = run('apex-router.mjs', ['authorize', project, id, session, 'recover']); assert.equal(retryAuth.status, 0, retryAuth.stderr || retryAuth.stdout);
      const retry = run('apex-action.mjs', ['run', project, id, session, JSON.parse(retryAuth.stdout).authorizationRef, 'recover', 'apex-recover.mjs', dir]);
      assert.notEqual(retry.status, 0); assert.match(retry.stderr, /identical controlled operation already failed/);
    }
    else if (kind === 'base-changed') { assert.notEqual(result.status, 0); assert.match(result.stderr, /base state changed/); }
    else if (kind === 'interrupted' || kind === 'partial') {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).status, 'revision-replayed');
      assert.equal(readRunState(dir).revision, before.revision + 1);
      const records = fs.readFileSync(path.join(dir, 'prompt-revisions.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(records.length, 1); assert.equal(records[0].reason, entry.reason); assert.equal(records[0].transactionId, entry.transactionId);
      assert.deepEqual(pendingRevisionTransactions(dir), []);
      if (kind === 'partial') {
        assert.equal(readRunState(dir).artifacts.visualExecutionPlan, null);
        assert.ok(reconcileRun(dir).issues.some(issue => issue.type === 'registered-artifact-missing'));
        const nextAuth = run('apex-router.mjs', ['authorize', project, id, session, 'recover']); assert.equal(nextAuth.status, 0, nextAuth.stderr || nextAuth.stdout);
        const next = run('apex-action.mjs', ['run', project, id, session, JSON.parse(nextAuth.stdout).authorizationRef, 'recover', 'apex-recover.mjs', dir]);
        assert.equal(next.status, 0, next.stderr || next.stdout); assert.equal(reconcileRun(dir).status, 'consistent');
      }
      continue;
    }
    else if (kind === 'conflict') { assert.notEqual(result.status, 0); assert.match(result.stderr, /revision log conflicts/); }
    else if (kind === 'diverged') { assert.notEqual(result.status, 0); assert.match(result.stderr, /current state/); }
    else {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).revisionRecovery.status, 'completed');
      assert.equal(readRunState(dir).confirmationEpochs.gate1, 3, 'recovery must not apply the revision twice');
      assert.equal(fs.readFileSync(path.join(dir, 'prompt-revisions.ndjson'), 'utf8').trim().split('\n').length, 1);
      assert.deepEqual(pendingRevisionTransactions(dir), []);
      assert.equal(finalizeCommittedRevision(dir, entry.transactionId).status, 'already-completed');
      continue;
    }
    if (['live', 'foreign', 'legacy'].includes(kind)) assert.equal(readRunState(dir).revision, before.revision, 'recovery must not change state before the revision is resolved');
    assert.equal(pendingRevisionTransactions(dir)[0].reason, entry.reason);
  }
  const raceId = 'revision-race', raceSession = 'session-race';
  const intake = run('apex-router.mjs', ['intake', project, raceId, 'greenfield', 'standard', 'interactive', raceSession, '确认调用 APEX']);
  assert.equal(intake.status, 0, intake.stderr || intake.stdout);
  const raceDir = path.join(project, '.apex', 'runs', raceId), baseRevision = readRunState(raceDir).revision;
  const moduleUrl = pathToFileURL(path.join(scripts, 'run-ledger.mjs')).href;
  const worker = `import { beginRevisionTransaction } from ${JSON.stringify(moduleUrl)}; try { beginRevisionTransaction(process.argv[1], { transactionId: process.argv[2], stateRevision: Number(process.argv[3]), ownerPid: process.pid }); } catch (error) { if (!error.message.includes('earlier prompt revision')) throw error; process.exitCode = 2; }`;
  const codes = await Promise.all(Array.from({ length: 5 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker, raceDir, `race-${index}`, String(baseRevision)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', code => resolve({ code, stderr }));
  })));
  assert.equal(codes.filter(item => item.code === 0).length, 1, JSON.stringify(codes));
  assert.equal(codes.filter(item => item.code === 2).length, 4, JSON.stringify(codes));
  assert.equal(pendingRevisionTransactions(raceDir).length, 1);
  const replayId = 'replay-race', replaySession = 'replay-race-session';
  const replayIntake = run('apex-router.mjs', ['intake', project, replayId, 'greenfield', 'standard', 'interactive', replaySession, '确认调用 APEX']); assert.equal(replayIntake.status, 0, replayIntake.stderr || replayIntake.stdout);
  const replayDir = path.join(project, '.apex', 'runs', replayId), replayState = readRunState(replayDir);
  beginRevisionTransaction(replayDir, { transactionId: 'replay-race-id', protocol: 2, stateRevision: replayState.revision, ownerPid: 2147483647, ownerHost: os.hostname() });
  const replayWorker = `import { claimRevisionReplay } from ${JSON.stringify(moduleUrl)}; try { claimRevisionReplay(process.argv[1], 'replay-race-id'); await new Promise(resolve => setTimeout(resolve, 1500)); } catch (error) { if (!error.message.includes('owner may still be running')) throw error; process.exitCode = 2; }`;
  const replayCodes = await Promise.all(Array.from({ length: 5 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', replayWorker, replayDir], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', code => resolve({ code, stderr }));
  })));
  assert.equal(replayCodes.filter(item => item.code === 0).length, 1, JSON.stringify(replayCodes));
  assert.equal(replayCodes.filter(item => item.code === 2).length, 4, JSON.stringify(replayCodes));
  console.log(JSON.stringify({ status: 'passed', scope: 'durable original request, single active revision, live-owner fencing and interrupted revision blocking' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
