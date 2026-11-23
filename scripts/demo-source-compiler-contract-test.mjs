#!/usr/bin/env node
/** Proves the visual-confirmation chain compiles a source manifest before sandbox materialization. */
import fs from 'node:fs';
import { demoContract, demoFragment, seedDesignContract } from './interactive-demo-test-fixture.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
const run = (file, args) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
const expect = (result, label) => { if (result.status !== 0) throw new Error(`${label}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); };
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-demo-source-'));
try {
  fs.mkdirSync(path.join(project, 'server'), { recursive: true }); fs.writeFileSync(path.join(project, 'server', 'api.js'), 'export const api = true;\n');
  expect(run(router, ['intake', project, 'run-demo-source', 'greenfield', 'standard', 'interactive', 'session-demo-source', '确认调用 APEX']), 'intake');
  const runDir = path.join(project, '.apex', 'runs', 'run-demo-source'); const stateFile = path.join(runDir, 'state.json'); const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.writeFileSync(path.join(runDir, 'fixture-product-strategy.json'), JSON.stringify({ functionalPlan: demoContract.journeys.filter(item => item.kind === 'task').map(item => ({ task: item.task })) }));
  state.artifacts.experienceStrategy = 'fixture-product-strategy.json';
  state.gates.gate1 = { status: 'passed', at: new Date().toISOString(), evidence: ['test'] }; state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.phase = 'G-05 VISUAL'; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json';
  fs.writeFileSync(path.join(runDir, 'visual-execution-plan.json'), JSON.stringify({ schemaVersion: '3.0', selectionAnalysis: seedDesignContract(runDir), sourceSelections: [
    { id: 'layout-a', kind: 'layout', visualNodes: ['demo-root'] }, { id: 'chart-b', kind: 'component', visualNodes: ['demo-root'] },
    { id: 'style-a', kind: 'style', visualNodes: ['demo-root'] }, { id: 'font-a', kind: 'font', visualNodes: ['demo-root'] },
    { id: 'content-a', kind: 'content', visualNodes: ['demo-root'], parameters: { origin: 'test.intent', fields: ['title'], implementation: 'render title' } }
  ] })); fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const input = path.join(runDir, 'demo-source-input.json');
  fs.writeFileSync(input, JSON.stringify({ schemaVersion: '3.0', interactionContract: demoContract, entrypoint: 'src/App.tsx', files: [{ path: 'src/App.tsx', encoding: 'utf8', content: 'export const App = () => <main><div data-apex-source-selection="layout-a"/><div data-apex-source-selection="chart-b"/><div data-apex-source-selection="style-a"/><div data-apex-source-selection="font-a"/><div data-apex-source-selection="content-a"/>Demo</main>;\n' }, { path: 'package.json', encoding: 'utf8', content: '{"private":true}' }], sourceBindings: [{ sourceSelectionId: 'layout-a', files: ['src/App.tsx'] }, { sourceSelectionId: 'chart-b', files: ['src/App.tsx'] }, { sourceSelectionId: 'style-a', files: ['src/App.tsx'] }, { sourceSelectionId: 'font-a', files: ['src/App.tsx'] }, { sourceSelectionId: 'content-a', files: ['src/App.tsx'] }] }));
  const invalidInput = path.join(runDir, 'invalid-demo-source-input.json');
  fs.writeFileSync(invalidInput, JSON.stringify({ schemaVersion: '3.0', entrypoint: 'src/App.tsx', files: [{ path: 'src/App.tsx', encoding: 'utf8', content: 'x' }], sourceBindings: [{ sourceSelectionId: 'layout-a', files: ['src/App.tsx'] }] }));
  const invalidAuth = expect(run(router, ['authorize', project, 'run-demo-source', 'session-demo-source', 'generate_visual']), 'authorize invalid compiler');
  const invalid = run(action, ['run', project, 'run-demo-source', 'session-demo-source', invalidAuth.authorizationRef, 'generate_visual', 'demo-source-compiler.mjs', 'compile', runDir, invalidInput]);
  if (invalid.status === 0 || !String(invalid.stderr).includes('cover every confirmed visual source selection')) throw new Error('compiler accepted an incomplete selected-source binding');
  const strategyPath = path.join(runDir, 'fixture-product-strategy.json'), strategyBytes = fs.readFileSync(strategyPath);
  fs.unlinkSync(strategyPath);
  try {
    const missingStatus = expect(run(router, ['status', project, 'run-demo-source', 'session-demo-source']), 'inspect missing product plan');
    if (missingStatus.executionDirective?.currentStep?.id !== 'restore-product-plan-before-demo' && missingStatus.nextRequiredAction !== 'recover') throw new Error('missing product plan must request restoration before Demo compilation');
    const missingInput = path.join(runDir, 'missing-product-demo-input.json'); fs.copyFileSync(input, missingInput);
    const missingAuth = expect(run(router, ['authorize', project, 'run-demo-source', 'session-demo-source', 'generate_visual']), 'authorize missing plan check');
    const missingResult = run(action, ['run', project, 'run-demo-source', 'session-demo-source', missingAuth.authorizationRef, 'generate_visual', 'demo-source-compiler.mjs', 'compile', runDir, missingInput]);
    if (missingResult.status === 0 || !String(missingResult.stderr).includes('current product plan with valid functional tasks is required')) throw new Error('compiler accepted Demo without a product plan');
  } finally { fs.writeFileSync(strategyPath, strategyBytes); }
  const compileAuth = expect(run(router, ['authorize', project, 'run-demo-source', 'session-demo-source', 'generate_visual']), 'authorize source compiler');
  expect(run(action, ['run', project, 'run-demo-source', 'session-demo-source', compileAuth.authorizationRef, 'generate_visual', 'demo-source-compiler.mjs', 'compile', runDir, input]), 'compile source manifest');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'demo-source-manifest.json'), 'utf8'));
  if (manifest.sourceBindings.length !== 5 || JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifacts.demoSourceManifest !== 'demo-source-manifest.json') throw new Error('compiler did not register a complete run-local Demo source manifest');
  const writerAuth = expect(run(router, ['authorize', project, 'run-demo-source', 'session-demo-source', 'generate_visual']), 'authorize writer');
  expect(run(action, ['run', project, 'run-demo-source', 'session-demo-source', writerAuth.authorizationRef, 'generate_visual', 'visual-sandbox-writer.mjs', 'materialize', runDir, path.join(runDir, 'demo-source-manifest.json')]), 'materialize compiled manifest');
  const chatInput = path.join(runDir, 'chat-demo-source-input.json');
  fs.writeFileSync(chatInput, JSON.stringify({ schemaVersion: '3.0', interactionContract: demoContract, entrypoint: 'index.html', chatPreview: { fragment: 'preview.html' }, files: [{ path: 'preview.html', content: demoFragment }], sourceBindings: manifest.sourceBindings.map(item => ({ ...item, files: ['preview.html'] })) }));
  const chatCompile = expect(run(router, ['authorize', project, 'run-demo-source', 'session-demo-source', 'generate_visual']), 'authorize chat compiler');
  expect(run(action, ['run', project, 'run-demo-source', 'session-demo-source', chatCompile.authorizationRef, 'generate_visual', 'demo-source-compiler.mjs', 'compile', runDir, chatInput]), 'compile chat Demo');
  const chatWrite = expect(run(router, ['authorize', project, 'run-demo-source', 'session-demo-source', 'generate_visual']), 'authorize chat writer');
  expect(run(action, ['run', project, 'run-demo-source', 'session-demo-source', chatWrite.authorizationRef, 'generate_visual', 'visual-sandbox-writer.mjs', 'materialize', runDir, path.join(runDir, 'demo-source-manifest.json')]), 'materialize chat Demo');
  const chatManifest = JSON.parse(fs.readFileSync(path.join(runDir, 'visual-sandbox-files.json')));
  if (chatManifest.chatPreview?.fragment !== 'preview.html' || !fs.readFileSync(path.join(runDir, 'visual-sandbox/index.html'), 'utf8').includes(demoFragment)) throw new Error('chat and HTTP must use the same source');
  console.log(JSON.stringify({ status: 'passed', checks: 10 }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
