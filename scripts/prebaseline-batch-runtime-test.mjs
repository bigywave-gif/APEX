import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentRuntimeStatus } from './run-ledger.mjs';
const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-batch-runtime-'));
const run = 'batch', session = 'batch-session', dir = path.join(project, '.apex/runs', run);
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
  fs.writeFileSync(path.join(project, 'main.js'), Array.from({ length: 51 }, (_, i) => `import './missing-module-${i}';`).join('\n'));
  call('apex-router.mjs', ['intake', project, run, 'existing', 'standard', 'interactive', session, '确认调用 APEX']);
  action('project-intake.mjs', ['scan', dir, project]);
  const scope = path.join(dir, 'scope.json'); fs.writeFileSync(scope, JSON.stringify({ routes: ['/'], codeEntrypoints: ['index.html'] }));
  action('existing-code-reference.mjs', ['capture', dir, project, scope], false);
  assert.equal(status().currentStep.id, 'inspect-unresolved-imports');
  action('existing-code-reference.mjs', ['inspect-imports', dir, project, scope]);
  assert.equal(status().currentStep.id, 'prebaseline-role-select');
  action('role-advisory.mjs', ['select', dir, 'prebaseline']);
  const selection = JSON.parse(fs.readFileSync(path.join(dir, 'advisories/prebaseline/selection.json')));
  assert.equal(selection.selectedRoles.length, 2);
  assert.equal(action('role-advisory.mjs', ['select', dir, 'prebaseline']).idempotent, true);
  assert.equal(agentRuntimeStatus(dir).jobs.filter(job => job.stage === 'prebaseline').length, 2);
  for (const [i, roleId] of selection.selectedRoles.entries()) {
    const route = status(); assert.equal(route.currentStep.id, 'prebaseline-batch-record'); assert.match(route.currentStep.details, new RegExp(roleId));
    const jobId = selection.agentJobs[roleId];
    let claim = action('agent-runtime.mjs', ['claim', dir, jobId, 'prebaseline', `batch_fixture_claim_0${i + 1}`]);
    assert.equal(claim.payload.reviewContext.batch.index, i + 1);
    const replay = action('agent-runtime.mjs', ['claim', dir, jobId, 'prebaseline', `batch_fixture_claim_0${i + 1}`]);
    assert.equal(replay.idempotent, true); assert.equal(replay.leaseToken, claim.leaseToken); assert.equal(replay.payload.reviewContext, undefined);
    const inspection = selection.inputBindings.find(item => item.artifact === 'unresolvedImportInspection').path;
    const advisory = { schemaVersion: '1.0', roleId, stage: 'prebaseline', adapterVersion: '1.0.0', inputBindings: selection.inputBindings, findings: [{ id: 'fixture', classification: 'unverified', statement: '依赖的实际运行条件仍待验证。', evidence: [inspection] }], recommendations: [], importReviews: claim.payload.reviewContext.unresolvedImports.map(item => ({ source: item.source, reference: item.reference, decision: 'unverified', rationale: '当前证据仅显示源码引用，实际运行条件和影响仍需独立核验。', sourceExcerpt: item.reference })), execution: { inputTokens: 100, outputTokens: 50, usageSource: 'provider-reported', model: 'test-fixture', sessionId: claim.payload.agentSessionId, skillBindings: claim.payload.skillBindings, leaseToken: claim.leaseToken }, status: 'ready' };
    const input = path.join(dir, `batch-input-${i + 1}.json`); fs.writeFileSync(input, JSON.stringify(advisory));
    if (i === 0) {
      const source = path.join(project, 'main.js'), original = fs.readFileSync(source);
      fs.appendFileSync(source, '\n// changed while running\n');
      assert.equal(status().currentStep.id, 'prebaseline-role-wait', 'source drift must not duplicate a running batch');
      fs.writeFileSync(source, original);
      const invalid = structuredClone(advisory); invalid.importReviews[0].sourceExcerpt = 'not present in source'; fs.writeFileSync(input, JSON.stringify(invalid));
      assert.match(action('role-advisory.mjs', ['record', dir, 'prebaseline', input], false).stderr, /excerpt is not present/);
      action('agent-runtime.mjs', ['status', dir]);
      assert.equal(status().blockingOperation.category, 'prebaseline-review-failed', 'status cannot hide a failed batch');
      fs.writeFileSync(input, JSON.stringify(advisory));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
      assert.equal(status().blockingOperation, null);
      const oldLease = claim.leaseToken;
      claim = action('agent-runtime.mjs', ['claim', dir, jobId, 'prebaseline', 'batch_fixture_claim_retry']);
      assert.notEqual(claim.leaseToken, oldLease);
      const stale = structuredClone(advisory); stale.execution.leaseToken = oldLease; fs.writeFileSync(input, JSON.stringify(stale));
      assert.notEqual(action('role-advisory.mjs', ['record', dir, 'prebaseline', input], false).status, 0);
      assert.equal(agentRuntimeStatus(dir).tokenUsage.prebaseline, 150, 'stale leases must not be charged again');
      advisory.execution.leaseToken = claim.leaseToken; fs.writeFileSync(input, JSON.stringify(advisory));
    }
    action('role-advisory.mjs', ['record', dir, 'prebaseline', input]);
    assert.equal(agentRuntimeStatus(dir, jobId).jobs[0].status, 'succeeded');
  }
  assert.equal(agentRuntimeStatus(dir).tokenUsage.prebaseline, 450);
  assert.equal(status().blockingOperation.category, 'unresolved-local-import');
  assert.equal(fs.existsSync(path.join(dir, 'code-reference.json')), false);
  console.log(JSON.stringify({ status: 'passed', test: 'prebaseline-batch-runtime' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
