import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beginRevisionTransaction, pendingRevisionTransactions, readRunState, reconcileRun } from './run-ledger.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-revision-transaction-'));
const run = (name, args) => spawnSync(process.execPath, [path.join(scripts, name), ...args], { encoding: 'utf8', timeout: 30000 });
try {
  for (const kind of ['live', 'interrupted', 'completed']) {
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
    const before = readRunState(dir);
    const entry = { type: 'prompt-revision-transaction-started', transactionId: `transaction-${kind}`, at: new Date().toISOString(), sessionId: session, checkpoint: 'gate1', impact: 'visible', reason: '保留用户原始修改要求', stateRevision: before.revision, ownerPid: kind === 'live' ? process.pid : 2147483647 };
    beginRevisionTransaction(dir, entry);
    assert.equal(pendingRevisionTransactions(dir)[0].reason, entry.reason);
    assert.throws(() => beginRevisionTransaction(dir, { ...entry, transactionId: 'duplicate' }), /earlier prompt revision/);
    assert.ok(reconcileRun(dir).issues.some(issue => issue.type === 'prompt-revision-pending' && issue.transactionId === entry.transactionId));
    result = run('apex-router.mjs', ['authorize', project, id, session, 'recover']); assert.equal(result.status, 0, result.stderr || result.stdout);
    const auth = JSON.parse(result.stdout).authorizationRef;
    result = run('apex-action.mjs', ['run', project, id, session, auth, 'recover', 'apex-recover.mjs', dir]);
    if (kind === 'live') { assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(JSON.parse(result.stdout).status, 'waiting'); }
    else { assert.notEqual(result.status, 0); assert.match(result.stdout, /revision-recovery-required/); }
    assert.equal(readRunState(dir).revision, before.revision, 'recovery must not change state before the revision is resolved');
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
  console.log(JSON.stringify({ status: 'passed', scope: 'durable original request, single active revision, live-owner fencing and interrupted revision blocking' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
