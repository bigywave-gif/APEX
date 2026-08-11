#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
function run(file, args) { return spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' }); }
function expect(result, label) { if (result.status !== 0) throw new Error(`${label}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); }

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-demo-writer-'));
try {
  fs.mkdirSync(path.join(project, 'server'), { recursive: true });
  fs.writeFileSync(path.join(project, 'server', 'api.js'), 'export const api = true;\n');
  expect(run(router, ['intake', project, 'run-demo', 'greenfield', 'standard', 'interactive', 'session-demo']), 'intake');
  const runDir = path.join(project, '.apex', 'runs', 'run-demo'), stateFile = path.join(runDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.gates.gate1 = { status: 'passed', at: new Date().toISOString(), evidence: ['test'] };
  state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.phase = 'G-05 VISUAL';
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const input = path.join(runDir, 'demo-source.json');
  fs.writeFileSync(input, JSON.stringify({ schemaVersion: '3.0', entrypoint: 'src/App.tsx', files: [{ path: 'src/App.tsx', encoding: 'utf8', content: 'export const App = () => <main>Demo</main>;\n' }, { path: 'package.json', encoding: 'utf8', content: '{"private":true}' }] }));
  const authorization = expect(run(router, ['authorize', project, 'run-demo', 'session-demo', 'generate_visual']), 'authorize writer');
  expect(run(action, ['run', project, 'run-demo', 'session-demo', authorization.authorizationRef, 'generate_visual', 'visual-sandbox-writer.mjs', 'materialize', runDir, input]), 'materialize sandbox Demo');
  if (!fs.existsSync(path.join(runDir, 'visual-sandbox', 'src', 'App.tsx')) || fs.existsSync(path.join(project, 'src', 'App.tsx')) || fs.readFileSync(path.join(project, 'server', 'api.js'), 'utf8') !== 'export const api = true;\n') throw new Error('Demo source escaped the project-local run sandbox or changed formal source');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'visual-sandbox-files.json'), 'utf8'));
  if (manifest.runtimeRoot !== 'visual-sandbox' || manifest.projectRoot !== fs.realpathSync(project) || manifest.files.length !== 2) throw new Error('sandbox materialization manifest is incomplete');
  const badInput = path.join(runDir, 'bad-demo-source.json');
  fs.writeFileSync(badInput, JSON.stringify({ schemaVersion: '3.0', entrypoint: '../src/App.tsx', files: [{ path: '../src/App.tsx', content: 'escape' }] }));
  const badAuthorization = expect(run(router, ['authorize', project, 'run-demo', 'session-demo', 'generate_visual']), 'authorize invalid writer');
  const rejected = run(action, ['run', project, 'run-demo', 'session-demo', badAuthorization.authorizationRef, 'generate_visual', 'visual-sandbox-writer.mjs', 'materialize', runDir, badInput]);
  if (rejected.status === 0 || fs.existsSync(path.join(runDir, 'src', 'App.tsx'))) throw new Error('sandbox traversal was not rejected');
  console.log(JSON.stringify({ status: 'passed', checks: 5 }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
