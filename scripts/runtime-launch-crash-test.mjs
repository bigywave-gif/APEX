import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commitRunState } from './run-ledger.mjs';
import { demoContract, seedDesignContract } from './interactive-demo-test-fixture.mjs';
import { findRuntimeLaunchProcess, readRuntimeLaunchIntent } from './runtime-launch-intent.mjs';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(core, 'scripts/apex-router.mjs'), action = path.join(core, 'scripts/apex-action.mjs');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-runtime-crash-')), runId = 'runtime-crash', session = 'crash-session';
const runDir = path.join(project, '.apex', 'runs', runId);
const call = args => { const result = spawnSync(process.execPath, [router, ...args], { encoding: 'utf8', timeout: 30000 }); assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); };
const waitFor = async (fn, label) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error(`timed out waiting for ${label}`); };
let gateway, childPid, stopped = false;
try {
  call(['intake', project, runId, 'greenfield', 'standard', 'interactive', session, '确认调用 APEX']);
  const stateFile = path.join(runDir, 'state.json'), state = JSON.parse(fs.readFileSync(stateFile));
  state.gates.gate1 = { status: 'passed', at: new Date().toISOString(), evidence: ['test'] }; state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.phase = 'G-05 VISUAL';
  state.artifacts.visualSandboxFiles = 'visual-sandbox-files.json'; state.artifacts.demoSourceManifest = 'demo-source-manifest.json'; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json'; state.artifacts.experienceStrategy = 'fixture-product-strategy.json';
  fs.writeFileSync(path.join(runDir, 'fixture-product-strategy.json'), JSON.stringify({ functionalPlan: demoContract.journeys.filter(item => item.kind === 'task').map(item => ({ task: item.task })) }));
  fs.writeFileSync(path.join(runDir, 'visual-execution-plan.json'), JSON.stringify({ selectionAnalysis: seedDesignContract(runDir), sourceSelections: ['layout', 'component', 'style', 'font', 'content'].map(kind => ({ id: kind, kind, visualNodes: ['demo-root'], ...(kind === 'content' ? { parameters: { origin: 'fixture', fields: ['title'], implementation: 'render title' } } : {}) })) }));
  fs.mkdirSync(path.join(runDir, 'visual-sandbox')); fs.writeFileSync(path.join(runDir, 'visual-sandbox/index.html'), '<main data-apex-source-selection="layout">Runtime Demo</main>');
  fs.writeFileSync(path.join(runDir, 'visual-sandbox-files.json'), JSON.stringify({ schemaVersion: '3.0', status: 'materialized', entrypoint: 'visual-sandbox/index.html', interactionContract: demoContract, files: [{ path: 'visual-sandbox/index.html', sha256: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, 'visual-sandbox/index.html'))).digest('hex')}` }] }));
  fs.writeFileSync(path.join(runDir, 'demo-source-manifest.json'), JSON.stringify({ schemaVersion: '3.0', interactionContract: demoContract, entrypoint: 'index.html', files: [{ path: 'index.html', encoding: 'utf8', content: '<main data-apex-source-selection="layout">Runtime Demo</main>' }], sourceBindings: [{ sourceSelectionId: 'layout', files: ['index.html'] }] }));
  commitRunState(runDir, state, { reason: 'state-authority-test-fixture' });
  const authorization = call(['authorize', project, runId, session, 'generate_visual']);
  gateway = spawn(process.execPath, [action, 'run', project, runId, session, authorization.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; gateway.stderr.on('data', data => stderr += data);
  const ended = new Promise(resolve => gateway.on('close', (code, signal) => resolve({ code, signal })));
  const operation = path.join(runDir, 'operations', `${path.basename(authorization.authorizationRef, '.json')}.json`);
  const observed = await Promise.race([waitFor(() => {
    try {
      const intent = readRuntimeLaunchIntent(runDir, runId), receipt = JSON.parse(fs.readFileSync(operation));
      const pid = intent && findRuntimeLaunchProcess(intent);
      return pid && receipt.localProcess?.pid && !fs.existsSync(path.join(runDir, 'visual-sandbox-runtime.json')) ? { pid, starter: receipt.localProcess.pid } : null;
    } catch { return null; }
  }, 'child process before registration'), ended.then(result => { throw new Error(`startup ended before crash injection: ${JSON.stringify(result)} ${stderr}`); })]);
  childPid = observed.pid; process.kill(childPid, 'SIGSTOP'); stopped = true; process.kill(observed.starter, 'SIGKILL');
  const result = await ended; assert.notEqual(result.code, 0); assert.equal(fs.existsSync(path.join(runDir, 'runtime-launch-intent.json')), true); assert.equal(fs.existsSync(path.join(runDir, 'visual-sandbox-runtime.json')), false);
  const retry = call(['authorize', project, runId, session, 'generate_visual']);
  let recovered;
  if (process.env.APEX_TEST_LONG_RECOVERY === '1') {
    const blocked = spawnSync(process.execPath, [action, 'run', project, runId, session, retry.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /existing run-local Demo process is running but its URL is unavailable/);
    const pending = call(['status', project, runId, session]); assert.equal(pending.executionDirective.blockingOperation.category, 'runtime-recovery-unavailable');
    const identical = call(['authorize', project, runId, session, 'generate_visual']);
    const denied = spawnSync(process.execPath, [action, 'run', project, runId, session, identical.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(denied.status, 0); assert.match(denied.stderr, /identical controlled operation already failed/);
    process.kill(childPid, 'SIGCONT'); stopped = false;
    const intent = readRuntimeLaunchIntent(runDir, runId), healthUrl = `http://127.0.0.1:${intent.port}/`;
    let ready = false; for (let i = 0; i < 50 && !ready; i++) { try { ready = (await fetch(healthUrl)).status === 200; } catch {} if (!ready) await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(ready, true);
    const resumed = call(['status', project, runId, session]); assert.notEqual(resumed.executionDirective?.blockingOperation?.category, 'runtime-recovery-unavailable');
    const finalAuth = call(['authorize', project, runId, session, 'generate_visual']);
    recovered = spawnSync(process.execPath, [action, 'run', project, runId, session, finalAuth.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir], { encoding: 'utf8', timeout: 30000 });
  } else recovered = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [action, 'run', project, runId, session, retry.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir], { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    proc.stdout.on('data', data => stdout += data); proc.stderr.on('data', data => stderr += data); proc.on('error', reject);
    const retryReceipt = path.join(runDir, 'operations', `${path.basename(retry.authorizationRef, '.json')}.json`);
    let resume;
    const monitor = setInterval(() => { try { if (JSON.parse(fs.readFileSync(retryReceipt)).localProcess?.pid) { clearInterval(monitor); resume = setTimeout(() => { try { process.kill(childPid, 'SIGCONT'); stopped = false; } catch (error) { reject(error); } }, 500); } } catch {} }, 5);
    proc.on('close', status => { clearInterval(monitor); clearTimeout(resume); resolve({ status, stdout, stderr }); });
  });
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout); const output = JSON.parse(recovered.stdout);
  assert.equal(output.reused, true); assert.equal(output.pid, childPid); assert.equal(fs.existsSync(path.join(runDir, 'runtime-launch-intent.json')), false);
  const cancelled = call(['cancel', project, runId, session, '取消当前执行']); assert.ok(cancelled.cancellation.services.stopped.some(item => item.pid === childPid)); childPid = null;
  if (process.env.APEX_TEST_LONG_RECOVERY !== '1') {
    const long = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 60000, env: { ...process.env, APEX_TEST_LONG_RECOVERY: '1' } });
    assert.equal(long.status, 0, long.stderr || long.stdout);
  }
  console.log(JSON.stringify({ status: 'passed', scope: 'actual starter SIGKILL before registration; delayed child readiness and recovery' }));
} finally {
  if (!childPid) { try { const intent = readRuntimeLaunchIntent(runDir, runId); if (intent) childPid = findRuntimeLaunchProcess(intent); } catch {} }
  if (childPid) { if (stopped) try { process.kill(childPid, 'SIGCONT'); } catch {} try { process.kill(childPid, 'SIGTERM'); } catch {} }
  if (gateway?.exitCode === null && gateway.signalCode === null) gateway.kill('SIGKILL');
  fs.rmSync(project, { recursive: true, force: true });
}
