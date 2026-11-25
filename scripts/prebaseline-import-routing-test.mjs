import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PREBASELINE_REVIEWER_ID } from './prebaseline-import-review.mjs';
const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-prebaseline-route-'));
const run = 'route', session = 'route-session', dir = path.join(project, '.apex/runs', run);
function call(script, args, succeeds = true) {
  const result = spawnSync(process.execPath, [path.join(core, 'scripts', script), ...args], { encoding: 'utf8', timeout: 30000 });
  if (!succeeds) { assert.notEqual(result.status, 0, result.stdout); return result; }
  assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`); return JSON.parse(result.stdout);
}
function action(script, args, succeeds = true) {
  const auth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
  return call('apex-action.mjs', ['run', project, run, session, auth.authorizationRef, 'collect_existing_baseline', script, ...args], succeeds);
}
const status = () => call('apex-router.mjs', ['status', project, run, session]).executionDirective;
try {
  fs.writeFileSync(path.join(project, 'index.html'), '<script src="/main.js"></script>');
  const source = path.join(project, 'main.js'), original = "try { require('./optional-module'); } catch (error) {}\n";
  fs.writeFileSync(source, original);
  call('apex-router.mjs', ['intake', project, run, 'existing', 'standard', 'interactive', session, '确认调用 APEX']);
  action('project-intake.mjs', ['scan', dir, project]);
  const scope = path.join(dir, 'scope.json'); fs.writeFileSync(scope, JSON.stringify({ routes: ['/'], codeEntrypoints: ['index.html'] }));
  assert.match(action('existing-code-reference.mjs', ['capture', dir, project, scope], false).stderr, /APEX_UNRESOLVED_LOCAL_IMPORTS/);
  assert.equal(status().currentStep.id, 'inspect-unresolved-imports');
  assert.equal(status().remediatingFailure.category, 'unresolved-local-import');
  action('existing-code-reference.mjs', ['inspect-imports', dir, project, scope]);
  assert.equal(status().currentStep.id, 'prebaseline-role-select');
  action('role-advisory.mjs', ['select', dir, 'prebaseline']);
  const selection = JSON.parse(fs.readFileSync(path.join(dir, 'advisories/prebaseline/selection.json')));
  const job = selection.agentJobs[PREBASELINE_REVIEWER_ID]; assert.ok(job);
  assert.equal(status().currentStep.id, 'prebaseline-role-record');
  fs.appendFileSync(source, '// changed\n');
  assert.equal(status().currentStep.id, 'prebaseline-role-repair', 'stale queued work must be reconciled before recapture');
  fs.writeFileSync(source, original);
  const claim = action('agent-runtime.mjs', ['claim', dir, job, 'prebaseline', 'route_fixture_claim_01']);
  fs.appendFileSync(source, '// changed while running\n');
  assert.equal(status().currentStep.id, 'prebaseline-role-wait', 'a live stale job must not be duplicated');
  fs.writeFileSync(source, original);
  const inspection = selection.inputBindings.find(item => item.artifact === 'unresolvedImportInspection').path;
  const input = path.join(dir, 'review-input.json');
  const advisory = { schemaVersion: '1.0', roleId: PREBASELINE_REVIEWER_ID, stage: 'prebaseline', adapterVersion: '1.0.0', inputBindings: selection.inputBindings, findings: [{ id: 'fixture', classification: 'unverified', statement: '实际运行条件仍需要验证。', evidence: [inspection] }], recommendations: [], importReviews: [{ source: 'main.js', reference: './optional-module', decision: 'optional-candidate', rationale: '代码存在捕获异常的逻辑，但仍需要运行时证据确认实际影响。', sourceExcerpt: 'not present in source' }], execution: { inputTokens: 100, outputTokens: 50, usageSource: 'provider-reported', model: 'test-fixture', sessionId: claim.payload.agentSessionId, skillBindings: claim.payload.skillBindings, leaseToken: claim.leaseToken }, status: 'ready' };
  fs.writeFileSync(input, JSON.stringify(advisory));
  assert.match(action('role-advisory.mjs', ['record', dir, 'prebaseline', input], false).stderr, /excerpt is not present/);
  action('agent-runtime.mjs', ['status', dir]);
  assert.equal(status().blockingOperation.category, 'prebaseline-review-failed', 'a later status must not hide a failed role attempt');
  advisory.importReviews[0].sourceExcerpt = "require('./optional-module')"; fs.writeFileSync(input, JSON.stringify(advisory));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  assert.equal(status().blockingOperation, null, 'changed input permits an authorized retry');
  const retry = action('agent-runtime.mjs', ['claim', dir, job, 'prebaseline', 'route_fixture_claim_02']);
  advisory.execution.leaseToken = retry.leaseToken; fs.writeFileSync(input, JSON.stringify(advisory));
  action('role-advisory.mjs', ['record', dir, 'prebaseline', input]);
  assert.equal(status().blockingOperation.category, 'unresolved-local-import', 'professional judgment cannot approve the baseline');
  assert.equal(fs.existsSync(path.join(dir, 'code-reference.json')), false);
  console.log(JSON.stringify({ status: 'passed', test: 'prebaseline-import-routing' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
