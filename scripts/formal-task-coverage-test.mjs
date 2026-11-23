import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { formalReviewBindings, requiredFormalTasks, validateFormalInteractionEvidence } from './formal-interaction-evidence.mjs';
import { runFormalJourney, runFormalAuthentication } from './formal-interaction.mjs';
const manifest = { interactionContract: { journeys: [{ kind: 'task', task: '添加项目' }, { kind: 'reset', task: '重置演示' }] } };
assert.deepEqual([...requiredFormalTasks(manifest, { functionalPlan: [{ task: '添加项目' }] })], ['添加项目']);
assert.deepEqual([...requiredFormalTasks(manifest, { functionalPlan: [{ task: '添加项目' }, { task: '重置演示' }] })], ['添加项目', '重置演示']);
assert.deepEqual([...requiredFormalTasks(manifest)], ['添加项目']);
assert.deepEqual([...requiredFormalTasks(manifest, { functionalPlan: [{ task: '添加项目' }, { task: '删除项目' }] })], ['添加项目', '删除项目']);
assert.throws(() => requiredFormalTasks(manifest, {}, { requireProductPlan: true }), /product plan/);
assert.throws(() => requiredFormalTasks(manifest, { functionalPlan: [{ task: ' ' }] }, { requireProductPlan: true }), /product plan/);
let touched = false;
const redirectedPage = { goto: async () => {}, url: () => 'https://outside.invalid/', locator: () => { touched = true; throw new Error('external page must not be touched'); } };
const result = await runFormalJourney(redirectedPage, { url: 'https://app.invalid/', screenshotPath: '/unused', journey: { id: 'redirect', task: '操作', route: '/', steps: [{ action: 'click', selector: '#submit' }] } });
assert.equal(result.status, 'failed'); assert.match(result.error, /left the application origin/); assert.equal(touched, false);
let count = '0';
const page = {
  goto: async () => {}, url: () => 'https://app.invalid/', waitForTimeout: async () => {},
  locator: selector => selector === '#add' ? { click: async () => { count = '1'; } } : { innerText: async () => count },
  screenshot: async () => {}, content: async () => '<main>fixture</main>'
};
const observed = await runFormalJourney(page, { url: 'https://app.invalid/', screenshotPath: '/unused', journey: { id: 'add', task: '添加项目', route: '/', steps: [{ action: 'click', selector: '#add', before: { selector: '#count', property: 'text', equals: '0' }, after: { selector: '#count', property: 'text', equals: '1' } }] } });
assert.equal(observed.status, 'passed');
assert.deepEqual(observed.steps[0], { action: 'click', selector: '#add', observation: { selector: '#count', property: 'text' }, before: '0', after: '1', passed: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-formal-observation-'));
try {
  fs.mkdirSync(path.join(dir, 'evidence')); fs.mkdirSync(path.join(dir, 'operations'));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  const digest = name => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')}`;
  write('manifest.json', { interactionContract: { journeys: [{ task: '添加项目' }] } });
  write('plan.json', { functionalPlan: [{ task: '添加项目' }] });
  write('screen.png', 'screen'); write('dom.html', '<main/>');
  const trace = { ...observed, screenshot: { path: 'screen.png', sha256: digest('screen.png') }, dom: { path: 'dom.html', sha256: digest('dom.html') } };
  const capture = () => {
    write('trace.json', trace);
    write('evidence/runtime-browser-capture.json', { status: 'passed', formalInteractions: { status: 'passed', journeys: [{ id: 'add', task: '添加项目', evidence: 'trace.json', evidenceSha256: digest('trace.json') }] } });
    write('operations/capture.json', { action: 'verify', status: 'succeeded', script: 'browser-capture.mjs', outputFileHashes: { 'trace.json': digest('trace.json'), 'evidence/runtime-browser-capture.json': digest('evidence/runtime-browser-capture.json') } });
  };
  const state = { artifacts: { visualSandboxFiles: 'manifest.json', experienceStrategy: 'plan.json' }, roleChain: { confirmationModel: 'two-confirmations' } };
  const interactions = [{ id: 'add', result: 'passed', evidence: 'trace.json' }];
  assert.throws(() => formalReviewBindings(dir, state), /runtimeStateMatrix/);
  write('matrix.json', { interactions }); state.artifacts.runtimeStateMatrix = 'matrix.json';
  const bound = formalReviewBindings(dir, state);
  assert.deepEqual(bound.map(item => item.artifact), ['experienceStrategy', 'visualSandboxFiles', 'runtimeStateMatrix']);
  assert.equal(bound[2].sha256, digest('matrix.json'));
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'outside'));
  state.artifacts.runtimeStateMatrix = 'outside';
  assert.throws(() => formalReviewBindings(dir, state), /outside the run/);
  state.artifacts.runtimeStateMatrix = 'matrix.json';
  capture(); assert.equal(validateFormalInteractionEvidence(dir, state, interactions).status, 'passed');
  delete trace.steps[0].observation; capture();
  assert.throws(() => validateFormalInteractionEvidence(dir, state, interactions), /not an observed confirmed task/);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
const selectors = [], auth = { usernameSelector: '#user', passwordSelector: '#pass', submitSelector: '#submit', successSelector: '#ready' };
const authenticatedPage = { url: () => 'https://app.invalid/', waitForTimeout: async () => {}, locator: selector => ({ fill: async () => selectors.push(selector), click: async () => selectors.push(selector), first: () => ({ isVisible: async () => true }) }) };
assert.deepEqual(await runFormalAuthentication(authenticatedPage, { authentication: auth, credentials: { username: 'fixture-user', password: 'fixture-password' }, url: 'https://app.invalid/' }), { authenticated: true });
assert.deepEqual(selectors, ['#user', '#pass', '#submit']);
const hiddenSuccessPage = { ...authenticatedPage, locator: selector => selector === '#ready' ? { first: () => ({ isVisible: async () => false }) } : authenticatedPage.locator(selector) };
assert.deepEqual(await runFormalAuthentication(hiddenSuccessPage, { authentication: auth, credentials: { username: 'fixture-user', password: 'fixture-password' }, url: 'https://app.invalid/' }), { authenticated: false });
let leaked = false;
await assert.rejects(runFormalAuthentication({ url: () => 'https://outside.invalid/', locator: () => { leaked = true; } }, { authentication: auth, credentials: { username: 'fixture-user', password: 'fixture-password' }, url: 'https://app.invalid/' }), /outside the application origin/);
assert.equal(leaked, false);
console.log(JSON.stringify({ status: 'passed', checks: 22 }));
