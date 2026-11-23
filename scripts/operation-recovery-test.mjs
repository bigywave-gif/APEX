import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { inspectRunningOperations, markInterruptedOperations } from './operation-recovery.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-operation-recovery-'));
try {
  fs.mkdirSync(path.join(dir, 'operations'));
  const write = (name, value) => fs.writeFileSync(path.join(dir, 'operations', name), JSON.stringify(value));
  write('active.json', { status: 'running', owner: { pid: process.pid, host: os.hostname() } });
  write('legacy.json', { status: 'running' });
  write('foreign.json', { status: 'running', owner: { pid: process.pid, host: `${os.hostname()}-other` } });
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const deadPid = child.pid;
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  write('exited.json', { status: 'running', owner: { pid: deadPid, host: os.hostname() } });
  let result = inspectRunningOperations(dir);
  assert.deepEqual(result.deferred.map(item => item.reason).sort(), ['gateway-live', 'owner-unverified', 'owner-unverified']);
  assert.equal(result.interrupted.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'operations/active.json'))).status, 'running');
  assert.equal(inspectRunningOperations(dir, 'operations/active.json').deferred.length, 2);
  fs.unlinkSync(path.join(dir, 'operations/active.json')); fs.unlinkSync(path.join(dir, 'operations/legacy.json')); fs.unlinkSync(path.join(dir, 'operations/foreign.json'));
  result = inspectRunningOperations(dir);
  assert.deepEqual(markInterruptedOperations(dir, result.interrupted), ['operations/exited.json']);
  const recorded = JSON.parse(fs.readFileSync(path.join(dir, 'operations/exited.json')));
  assert.equal(recorded.status, 'interrupted'); assert.equal(recorded.recovery.externalSideEffects, 'unverified');
  assert.deepEqual(inspectRunningOperations(dir), { interrupted: [], deferred: [] });
  fs.writeFileSync(path.join(dir, 'operations/broken.json'), '{');
  assert.equal(inspectRunningOperations(dir).deferred[0].reason, 'unreadable-receipt');
  fs.unlinkSync(path.join(dir, 'operations/broken.json'));
  write('changed.json', { status: 'running', owner: { pid: deadPid, host: os.hostname() } });
  const stale = inspectRunningOperations(dir).interrupted;
  write('changed.json', { status: 'succeeded' });
  assert.throws(() => markInterruptedOperations(dir, stale), /changed during recovery/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'operations/changed.json'))).status, 'succeeded');
  console.log(JSON.stringify({ status: 'passed', scope: 'live, exited, legacy and foreign gateway recovery' }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
