#!/usr/bin/env node
import { commitRunState } from './run-ledger.mjs';
/** Proves a materialized Demo receives a real run-local URL rather than a status-only handoff. */
import fs from 'node:fs';
import { demoContract, seedDesignContract } from './interactive-demo-test-fixture.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
const run = (file, args) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
const expect = (result, label) => { if (result.status !== 0) throw new Error(`${label}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); };
const fetchStatus = url => new Promise((resolve, reject) => { const request = http.get(url, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.setTimeout(3000, () => request.destroy(new Error('timeout'))); });
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-sandbox-runtime-'));
const pids = [];
try {
  fs.mkdirSync(path.join(project, 'server'), { recursive: true }); fs.writeFileSync(path.join(project, 'server', 'api.js'), 'export const api = true;\n');
  expect(run(router, ['intake', project, 'run-runtime', 'greenfield', 'standard', 'interactive', 'session-runtime', '确认调用 APEX']), 'intake');
  const runDir = path.join(project, '.apex', 'runs', 'run-runtime'); const stateFile = path.join(runDir, 'state.json'); const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.writeFileSync(path.join(runDir, 'fixture-product-strategy.json'), JSON.stringify({ functionalPlan: demoContract.journeys.filter(item => item.kind === 'task').map(item => ({ task: item.task })) }));
  state.artifacts.experienceStrategy = 'fixture-product-strategy.json';
  state.gates.gate1 = { status: 'passed', at: new Date().toISOString(), evidence: ['test'] }; state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.phase = 'G-05 VISUAL'; state.artifacts.demoSourceManifest = 'demo-source-manifest.json'; state.artifacts.visualSandboxFiles = 'visual-sandbox-files.json'; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json';
  fs.writeFileSync(path.join(runDir, 'visual-execution-plan.json'), JSON.stringify({ selectionAnalysis: seedDesignContract(runDir), sourceSelections: [
    { id: 'native-layout', kind: 'layout', visualNodes: ['demo-root'] }, { id: 'component', kind: 'component', visualNodes: ['demo-root'] },
    { id: 'style', kind: 'style', visualNodes: ['demo-root'] }, { id: 'font', kind: 'font', visualNodes: ['demo-root'] },
    { id: 'content', kind: 'content', visualNodes: ['demo-root'], parameters: { origin: 'test.intent', fields: ['title'], implementation: 'render title' } }
  ] }));
  fs.mkdirSync(path.join(project, 'data'), { recursive: true }); fs.mkdirSync(path.join(project, 'logs'), { recursive: true }); fs.writeFileSync(path.join(project, 'data', 'runtime.json'), '{"revision":0}\n'); fs.writeFileSync(path.join(project, 'logs', 'output.log'), 'runtime started\n');
  fs.mkdirSync(path.join(runDir, 'visual-sandbox'), { recursive: true }); fs.writeFileSync(path.join(runDir, 'visual-sandbox', 'index.html'), '<main data-apex-source-selection="native-layout">Runtime Demo</main>');
  fs.writeFileSync(path.join(runDir, 'demo-source-manifest.json'), JSON.stringify({ schemaVersion: '3.0', interactionContract: demoContract, entrypoint: 'index.html', files: [{ path: 'index.html', encoding: 'utf8', content: '<main data-apex-source-selection="native-layout">Runtime Demo</main>' }], sourceBindings: [{ sourceSelectionId: 'native-layout', files: ['index.html'] }] }));
  fs.writeFileSync(path.join(runDir, 'visual-sandbox-files.json'), JSON.stringify({ schemaVersion: '3.0', interactionContract: demoContract, status: 'materialized', entrypoint: 'visual-sandbox/index.html' })); commitRunState(path.dirname(stateFile), state, { reason: 'state-authority-test-fixture' });
  const beforeStart = expect(run(router, ['status', project, 'run-runtime', 'session-runtime']), 'materialized Demo status');
  if (beforeStart.executionDirective?.currentStep?.id !== 'start-run-local-demo' || beforeStart.terminalResponseContract?.allowed !== false) throw new Error('a materialized but unstarted Demo must expose the exact automatic start step, never a null step or user prompt');
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-demo-foreign-'));
  try {
    const manifestFile = path.join(runDir, 'visual-sandbox-files.json'), original = fs.readFileSync(manifestFile), alias = path.join(runDir, 'visual-sandbox', 'foreign');
    fs.writeFileSync(path.join(foreign, 'index.html'), '<main data-apex-source-selection="native-layout">Foreign</main>'); fs.symlinkSync(foreign, alias);
    const altered = JSON.parse(original); altered.entrypoint = 'visual-sandbox/foreign/index.html'; fs.writeFileSync(manifestFile, JSON.stringify(altered));
    const wrongAuth = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'foreign sandbox authorization');
    const rejected = run(action, ['run', project, 'run-runtime', 'session-runtime', wrongAuth.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]);
    if (rejected.status === 0 || !rejected.stderr.includes('visual sandbox entrypoint must resolve inside the current Run sandbox') || fs.existsSync(path.join(runDir, 'visual-sandbox-runtime.json'))) throw new Error('Demo start must reject an entrypoint outside the Run sandbox');
    fs.unlinkSync(alias); fs.writeFileSync(manifestFile, original);
  } finally { fs.rmSync(foreign, { recursive: true, force: true }); }
  const authorization = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'runtime start authorization');
  const concurrentAuthorization = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'concurrent runtime start authorization');
  // PM2-style runtime writes are deliberately outside the frozen formal source
  // closure. They must not make a run-local Demo look like it edited production
  // code while the action is in flight.
  spawn(process.execPath, ['-e', `const fs=require('fs'); const data=${JSON.stringify(path.join(project, 'data', 'runtime.json'))}; const log=${JSON.stringify(path.join(project, 'logs', 'output.log'))}; setTimeout(()=>fs.writeFileSync(data, '{"revision":1}\\n'), 20); setTimeout(()=>fs.appendFileSync(log, 'tick\\n'), 60);`], { detached: true, stdio: 'ignore' }).unref();
  const start = reference => new Promise((resolve, reject) => { const child = spawn(process.execPath, [action, 'run', project, 'run-runtime', 'session-runtime', reference, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir], { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); });
  const concurrentStarts = await Promise.all([start(authorization.authorizationRef), start(concurrentAuthorization.authorizationRef)]);
  const successes = concurrentStarts.filter(item => item.status === 0).map(item => JSON.parse(item.stdout));
  if (!successes.length || new Set(successes.map(item => item.pid)).size !== 1 || concurrentStarts.some(item => item.status !== 0 && !/another runtime start is active|state.*changed|already failed|projection/i.test(item.stderr))) throw new Error(`concurrent runtime starts were not safely serialized: ${JSON.stringify(concurrentStarts)}`);
  const output = successes[0];
  const receipt = JSON.parse(fs.readFileSync(output.visualSandboxRuntime, 'utf8')); pids.push(receipt.pid);
  const lockPath = path.join(runDir, 'runtime-start-lock.sqlite');
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); process.send('locked'); setInterval(() => {}, 1000);`, lockPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('test lock was not acquired')), 5000); holder.once('message', () => { clearTimeout(timeout); resolve(); }); holder.once('error', error => { clearTimeout(timeout); reject(error); }); });
    const blockedAuth = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'locked runtime authorization');
    const blocked = run(action, ['run', project, 'run-runtime', 'session-runtime', blockedAuth.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]);
    if (blocked.status === 0 || !blocked.stderr.includes('another runtime start is active')) throw new Error('a held runtime lock must prevent another start');
    const exited = new Promise(resolve => holder.once('exit', resolve)); holder.kill('SIGKILL'); await exited;
    const unblocked = expect(run(router, ['status', project, 'run-runtime', 'session-runtime']), 'released runtime lock status');
    if (unblocked.executionDirective?.blockingOperation?.category === 'runtime-start-locked') throw new Error('released runtime lock must not remain a terminal blocker');
    const retryAuth = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'released runtime lock authorization');
    const retried = expect(run(action, ['run', project, 'run-runtime', 'session-runtime', retryAuth.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]), 'retry after lock owner exits');
    if (!retried.reused || retried.pid !== receipt.pid) throw new Error('retry after lock owner exit must reuse the existing service');
  } finally { if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL'); }
  const serviceRegistry = JSON.parse(fs.readFileSync(path.join(runDir, 'runtime-services.json'), 'utf8'));
  if (!output.url || await fetchStatus(output.url) !== 200 || !fs.existsSync(path.join(runDir, 'visual-sandbox-runtime.json')) || JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifacts.visualSandboxRuntime !== 'visual-sandbox-runtime.json' || serviceRegistry.services?.[0]?.record !== 'visual-sandbox-runtime.json' || serviceRegistry.services?.[0]?.pid !== receipt.pid) throw new Error('runtime start must write a reachable, current-run-only Demo URL, artifact, and service registry');
  const sandbox = path.join(runDir, 'visual-sandbox');
  fs.symlinkSync(path.join(project, 'server', 'api.js'), path.join(sandbox, 'outside.js'));
  fs.symlinkSync('index.html', path.join(sandbox, 'local.html'));
  if (await fetchStatus(new URL('outside.js', output.url)) !== 404) throw new Error('Demo server must not serve a file linked outside the sandbox');
  if (await fetchStatus(new URL('local.html', output.url)) !== 200) throw new Error('Demo server should serve an in-sandbox symlink');
  fs.unlinkSync(path.join(sandbox, 'outside.js')); fs.unlinkSync(path.join(sandbox, 'local.html'));
  const afterStart = expect(run(router, ['status', project, 'run-runtime', 'session-runtime']), 'started Demo status');
  if (afterStart.executionDirective?.currentStep?.id !== 'capture-runtime-browser-evidence' || afterStart.terminalResponseContract?.allowed !== false) throw new Error('a started Demo must advance to browser capture automatically instead of ending the chain');
  fs.unlinkSync(path.join(runDir, 'visual-sandbox-runtime.json')); delete JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifacts.visualSandboxRuntime;
  const restartState = JSON.parse(fs.readFileSync(stateFile, 'utf8')); delete restartState.artifacts.visualSandboxRuntime; commitRunState(path.dirname(stateFile), restartState, { reason: 'state-authority-test-fixture' });
  const restoredAuth = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'lost runtime record authorization');
  const restored = expect(run(action, ['run', project, 'run-runtime', 'session-runtime', restoredAuth.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]), 'restore existing runtime');
  if (!restored.reused || restored.pid !== receipt.pid || restored.url !== output.url || JSON.parse(fs.readFileSync(path.join(runDir, 'runtime-services.json'))).services[0].pid !== receipt.pid) throw new Error('missing runtime record must recover the live registered server without starting a duplicate');
  const runtimeFile = path.join(runDir, 'visual-sandbox-runtime.json'), registryFile = path.join(runDir, 'runtime-services.json');
  const savedRuntime = fs.readFileSync(runtimeFile), savedRegistry = fs.readFileSync(registryFile);
  const foreignRuntime = JSON.parse(savedRuntime), foreignRegistry = JSON.parse(savedRegistry); foreignRuntime.pid = process.pid; foreignRegistry.services[0].pid = process.pid;
  fs.writeFileSync(runtimeFile, JSON.stringify(foreignRuntime)); fs.writeFileSync(registryFile, JSON.stringify(foreignRegistry));
  const foreignPidAuth = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'foreign runtime PID authorization');
  const foreignPid = run(action, ['run', project, 'run-runtime', 'session-runtime', foreignPidAuth.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]);
  if (foreignPid.status === 0 || !foreignPid.stderr.includes('runtime process does not match this Run and sandbox')) throw new Error('runtime must not reuse a different live process');
  fs.writeFileSync(runtimeFile, savedRuntime); fs.writeFileSync(registryFile, savedRegistry);
  const formalChangeAuthorization = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'formal-change start authorization');
  // The boundary check surrounds an asynchronous local-server startup. Start
  // a proven-live mutator before the synchronous action begins; a one-shot
  // detached 20ms timer was scheduler-racy and could run only after the action
  // had already finished.
  const mutator = spawn(process.execPath, ['-e', `const fs=require('fs'); const file=${JSON.stringify(path.join(project, 'server', 'api.js'))}; let revision=0; const write=()=>{try{fs.writeFileSync(file, 'export const api = '+(revision++)+';\\n')}catch{}}; write(); const timer=setInterval(write, 2); process.send('ready'); setTimeout(()=>{clearInterval(timer);process.exit(0)}, 1000);`], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('formal-source mutator did not become ready')), 1000); mutator.once('message', () => { clearTimeout(timeout); resolve(); }); mutator.once('error', error => { clearTimeout(timeout); reject(error); }); });
  pids.push(mutator.pid);
  const formalChange = run(action, ['run', project, 'run-runtime', 'session-runtime', formalChangeAuthorization.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]);
  if (formalChange.status === 0) throw new Error('a changed frozen formal source must block run-local Demo generation');
  const formalReceipt = JSON.parse(fs.readFileSync(path.join(runDir, 'operations', `${path.basename(formalChangeAuthorization.authorizationRef, '.json')}.json`), 'utf8'));
  if (formalReceipt.productionBoundary?.snapshotMode !== 'formal-source-discovery' || formalReceipt.productionBoundary?.changedFiles?.[0]?.path !== 'server/api.js' || !String(formalReceipt.stderr).includes('server/api.js')) throw new Error('a formal source boundary failure must identify its protected snapshot mode and exact changed file');
  pids.push(JSON.parse(fs.readFileSync(path.join(runDir, 'visual-sandbox-runtime.json'), 'utf8')).pid);
  if (fs.existsSync(path.join(project, 'index.html'))) throw new Error('runtime start must not materialize files outside the run-local sandbox');
  console.log(JSON.stringify({ status: 'passed', checks: 14 }));
} finally {
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  fs.rmSync(project, { recursive: true, force: true });
}
