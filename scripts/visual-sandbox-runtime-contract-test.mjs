#!/usr/bin/env node
/** Proves a materialized Demo receives a real run-local URL rather than a status-only handoff. */
import fs from 'node:fs';
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
  expect(run(router, ['intake', project, 'run-runtime', 'greenfield', 'standard', 'interactive', 'session-runtime']), 'intake');
  const runDir = path.join(project, '.apex', 'runs', 'run-runtime'); const stateFile = path.join(runDir, 'state.json'); const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.gates.gate1 = { status: 'passed', at: new Date().toISOString(), evidence: ['test'] }; state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.phase = 'G-05 VISUAL'; state.artifacts.demoSourceManifest = 'demo-source-manifest.json'; state.artifacts.visualSandboxFiles = 'visual-sandbox-files.json'; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json';
  fs.writeFileSync(path.join(runDir, 'visual-execution-plan.json'), JSON.stringify({ sourceSelections: [
    { id: 'native-layout', kind: 'layout', visualNodes: ['demo-root'] }, { id: 'component', kind: 'component', visualNodes: ['demo-root'] },
    { id: 'style', kind: 'style', visualNodes: ['demo-root'] }, { id: 'font', kind: 'font', visualNodes: ['demo-root'] },
    { id: 'content', kind: 'content', visualNodes: ['demo-root'], parameters: { origin: 'test.intent', fields: ['title'], implementation: 'render title' } }
  ] }));
  fs.mkdirSync(path.join(project, 'data'), { recursive: true }); fs.mkdirSync(path.join(project, 'logs'), { recursive: true }); fs.writeFileSync(path.join(project, 'data', 'runtime.json'), '{"revision":0}\n'); fs.writeFileSync(path.join(project, 'logs', 'output.log'), 'runtime started\n');
  fs.mkdirSync(path.join(runDir, 'visual-sandbox'), { recursive: true }); fs.writeFileSync(path.join(runDir, 'visual-sandbox', 'index.html'), '<main data-apex-source-selection="native-layout">Runtime Demo</main>');
  fs.writeFileSync(path.join(runDir, 'demo-source-manifest.json'), JSON.stringify({ schemaVersion: '3.0', entrypoint: 'index.html', files: [{ path: 'index.html', encoding: 'utf8', content: '<main data-apex-source-selection="native-layout">Runtime Demo</main>' }], sourceBindings: [{ sourceSelectionId: 'native-layout', files: ['index.html'] }] }));
  fs.writeFileSync(path.join(runDir, 'visual-sandbox-files.json'), JSON.stringify({ schemaVersion: '3.0', status: 'materialized', entrypoint: 'visual-sandbox/index.html' })); fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const beforeStart = expect(run(router, ['status', project, 'run-runtime', 'session-runtime']), 'materialized Demo status');
  if (beforeStart.executionDirective?.currentStep?.id !== 'start-run-local-demo' || beforeStart.terminalResponseContract?.allowed !== false) throw new Error('a materialized but unstarted Demo must expose the exact automatic start step, never a null step or user prompt');
  const authorization = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'runtime start authorization');
  // PM2-style runtime writes are deliberately outside the frozen formal source
  // closure. They must not make a run-local Demo look like it edited production
  // code while the action is in flight.
  spawn(process.execPath, ['-e', `const fs=require('fs'); const data=${JSON.stringify(path.join(project, 'data', 'runtime.json'))}; const log=${JSON.stringify(path.join(project, 'logs', 'output.log'))}; setTimeout(()=>fs.writeFileSync(data, '{"revision":1}\\n'), 20); setTimeout(()=>fs.appendFileSync(log, 'tick\\n'), 60);`], { detached: true, stdio: 'ignore' }).unref();
  const output = expect(run(action, ['run', project, 'run-runtime', 'session-runtime', authorization.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]), 'run-local runtime start');
  const receipt = JSON.parse(fs.readFileSync(output.visualSandboxRuntime, 'utf8')); pids.push(receipt.pid);
  if (!output.url || await fetchStatus(output.url) !== 200 || !fs.existsSync(path.join(runDir, 'visual-sandbox-runtime.json')) || JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifacts.visualSandboxRuntime !== 'visual-sandbox-runtime.json') throw new Error('runtime start must write a reachable, current-run-only Demo URL and artifact');
  const afterStart = expect(run(router, ['status', project, 'run-runtime', 'session-runtime']), 'started Demo status');
  if (afterStart.executionDirective?.currentStep?.id !== 'capture-runtime-browser-evidence' || afterStart.terminalResponseContract?.allowed !== false) throw new Error('a started Demo must advance to browser capture automatically instead of ending the chain');
  fs.unlinkSync(path.join(runDir, 'visual-sandbox-runtime.json')); delete JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifacts.visualSandboxRuntime;
  const restartState = JSON.parse(fs.readFileSync(stateFile, 'utf8')); delete restartState.artifacts.visualSandboxRuntime; fs.writeFileSync(stateFile, `${JSON.stringify(restartState, null, 2)}\n`);
  const formalChangeAuthorization = expect(run(router, ['authorize', project, 'run-runtime', 'session-runtime', 'generate_visual']), 'formal-change start authorization');
  spawn(process.execPath, ['-e', `const fs=require('fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(path.join(project, 'server', 'api.js'))}, 'export const api = false;\\n'), 20);`], { detached: true, stdio: 'ignore' }).unref();
  const formalChange = run(action, ['run', project, 'run-runtime', 'session-runtime', formalChangeAuthorization.authorizationRef, 'generate_visual', 'visual-sandbox-runtime.mjs', 'start', runDir]);
  if (formalChange.status === 0) throw new Error('a changed frozen formal source must block run-local Demo generation');
  const formalReceipt = JSON.parse(fs.readFileSync(path.join(runDir, 'operations', `${path.basename(formalChangeAuthorization.authorizationRef, '.json')}.json`), 'utf8'));
  if (formalReceipt.productionBoundary?.snapshotMode !== 'formal-source-discovery' || formalReceipt.productionBoundary?.changedFiles?.[0]?.path !== 'server/api.js' || !String(formalReceipt.stderr).includes('server/api.js')) throw new Error('a formal source boundary failure must identify its protected snapshot mode and exact changed file');
  pids.push(JSON.parse(fs.readFileSync(path.join(runDir, 'visual-sandbox-runtime.json'), 'utf8')).pid);
  if (fs.existsSync(path.join(project, 'index.html'))) throw new Error('runtime start must not materialize files outside the run-local sandbox');
  console.log(JSON.stringify({ status: 'passed', checks: 6 }));
} finally {
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  fs.rmSync(project, { recursive: true, force: true });
}
