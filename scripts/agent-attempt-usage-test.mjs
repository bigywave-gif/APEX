import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registerAgent, enqueueAgentJob, claimAgentJob, settleAgentJob, recoverAgentJobs, completeAgentAdvisory, agentRuntimeStatus, rebudgetAgentJobs, reconcileAgentAttemptUsage, recordObservedTokenUsage } from './run-ledger.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-attempt-usage-'));
try {
  registerAgent(root, { agentId: 'reviewer', vocation: 'review', stage: 'visual' });
  const job = enqueueAgentJob(root, { agentId: 'reviewer', stage: 'visual', inputHash: 'fixture', maxAttempts: 3 });
  let claim = claimAgentJob(root, job.jobId);
  for (const [inputTokens, outputTokens] of [[Number.MAX_SAFE_INTEGER + 1, 0], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => settleAgentJob(root, job.jobId, { status: 'failed', leaseToken: claim.leaseToken, usage: { inputTokens, outputTokens, usageSource: 'provider-reported' } }), /invalid Agent attempt usage/);
    assert.throws(() => completeAgentAdvisory(root, job.jobId, { leaseToken: claim.leaseToken, output: path.join(root, 'unsafe.json'), content: '{}', inputTokens, outputTokens }), /safe integer/);
  }
  assert.throws(() => completeAgentAdvisory(root, job.jobId, { leaseToken: claim.leaseToken, output: path.join(root, 'unsafe.json'), content: '{}', inputTokens: 1, outputTokens: 0, metadata: { usageSource: 'unknown' } }), /unknown token usage/);
  assert.equal(agentRuntimeStatus(root, job.jobId).jobs[0].status, 'running');
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, undefined);
  settleAgentJob(root, job.jobId, { status: 'failed', error: 'provider error after usage', leaseToken: claim.leaseToken, retryDelayMs: 0, usage: { inputTokens: 40, outputTokens: 30, usageSource: 'provider-reported' } });
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 70);
  claim = claimAgentJob(root, job.jobId); recoverAgentJobs(root, { force: true });
  assert.equal(agentRuntimeStatus(root).tokenUsageCoverage.visual.unknown, 1);
  claim = claimAgentJob(root, job.jobId);
  const output = path.join(root, 'advisories/visual/reviewer.json');
  assert.throws(() => completeAgentAdvisory(root, job.jobId, { leaseToken: claim.leaseToken, output, content: '{}', inputTokens: 1, outputTokens: 0, limit: 70, metadata: { usageSource: 'provider-reported' } }), /budget exceeded/);
  assert.equal(agentRuntimeStatus(root, job.jobId).jobs[0].status, 'dead-letter');
  assert.equal(fs.existsSync(output), false, 'over-budget advisory must not be published');
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 71);
  const db = new DatabaseSync(path.join(root, 'run-ledger.sqlite'), { readOnly: true });
  const attempts = db.prepare('SELECT metadata_json FROM token_usage ORDER BY id').all().map(row => JSON.parse(row.metadata_json)); db.close();
  assert.deepEqual(attempts.map(value => [value.attempt, value.outcome, value.usageSource]), [[1, 'failed', 'provider-reported'], [2, 'interrupted', 'unknown'], [3, 'budget-exceeded', 'provider-reported']]);
  assert.throws(() => settleAgentJob(root, job.jobId, { status: 'failed', leaseToken: claim.leaseToken }), /not running/);
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 71);
  reconcileAgentAttemptUsage(root, { jobId: job.jobId, attempt: 2, inputTokens: 0, outputTokens: 0, usageSource: 'estimated', evidence: 'isolated test fixture' });
  registerAgent(root, { agentId: 'designer', vocation: 'design', stage: 'visual' });
  const limited = enqueueAgentJob(root, { agentId: 'designer', stage: 'visual', inputHash: 'reserved-fixture', payload: { tokenBudget: 10, stageTokenBudget: 100 } });
  const reserved = claimAgentJob(root, limited.jobId);
  const limitedOutput = path.join(root, 'advisories/visual/designer.json');
  assert.throws(() => completeAgentAdvisory(root, limited.jobId, { leaseToken: reserved.leaseToken, output: limitedOutput, content: '{}', inputTokens: 8, outputTokens: 3, limit: 100, metadata: { usageSource: 'provider-reported' } }), /exceeds its reserved token budget/);
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 82);
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].status, 'dead-letter');
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].reservedTokens, 0);
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].leaseExpiresAt, null);
  assert.throws(() => completeAgentAdvisory(root, limited.jobId, { leaseToken: reserved.leaseToken, output: limitedOutput, content: '{}', inputTokens: 8, outputTokens: 3, limit: 100 }), /not running/);
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 82, 'repeated rejection must not charge twice');
  assert.throws(() => rebudgetAgentJobs(root, { stage: 'visual', jobIds: [limited.jobId], perAgentBudget: 10, stageBudget: 100 }), /changed allowance/);
  assert.throws(() => rebudgetAgentJobs(root, { stage: 'visual', jobIds: [limited.jobId], perAgentBudget: 20, stageBudget: 100 }), /lacks capacity/);
  rebudgetAgentJobs(root, { stage: 'visual', jobIds: [limited.jobId], perAgentBudget: 20, stageBudget: 110 });
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].status, 'queued');
  const resumed = claimAgentJob(root, limited.jobId);
  assert.throws(() => settleAgentJob(root, limited.jobId, { status: 'succeeded', leaseToken: reserved.leaseToken }), /stale or missing/);
  settleAgentJob(root, limited.jobId, { status: 'succeeded', leaseToken: resumed.leaseToken, usage: { inputTokens: 2, outputTokens: 1, usageSource: 'provider-reported' } });
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 85);
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].attempt, 2);
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].reservedTokens, 0);
  assert.equal(agentRuntimeStatus(root, limited.jobId).jobs[0].leaseExpiresAt, null);
  // Old ledgers may still contain reservation fields on a completed job.
  // Reporting normalizes them without mutating historical evidence.
  const legacy = new DatabaseSync(path.join(root, 'run-ledger.sqlite'));
  legacy.prepare('UPDATE agent_jobs SET reserved_tokens = 20, lease_expires_at = ? WHERE job_id = ?').run('2099-01-01T00:00:00.000Z', limited.jobId); legacy.close();
  const legacyStatus = agentRuntimeStatus(root, limited.jobId).jobs[0];
  assert.equal(legacyStatus.reservedTokens, 0); assert.equal(legacyStatus.leaseExpiresAt, null);
  const unchanged = new DatabaseSync(path.join(root, 'run-ledger.sqlite'), { readOnly: true });
  assert.equal(unchanged.prepare('SELECT reserved_tokens FROM agent_jobs WHERE job_id = ?').get(limited.jobId).reserved_tokens, 20); unchanged.close();
  for (const [agentId, status, used] of [['over-success', 'succeeded', 11], ['over-failure', 'failed', 12]]) {
    registerAgent(root, { agentId, vocation: 'review', stage: 'gate1' });
    const item = enqueueAgentJob(root, { agentId, stage: 'gate1', inputHash: agentId, payload: { tokenBudget: 10, stageTokenBudget: 100 } });
    const lease = claimAgentJob(root, item.jobId);
    const settled = settleAgentJob(root, item.jobId, { status, result: { shouldNotPublish: true }, leaseToken: lease.leaseToken, usage: { inputTokens: used, outputTokens: 0, usageSource: 'provider-reported' } });
    assert.equal(settled.jobs[0].status, 'dead-letter'); assert.equal(settled.jobs[0].result, null);
    assert.equal(settled.sessions.find(session => session.agentId === agentId).status, 'failed');
    assert.throws(() => settleAgentJob(root, item.jobId, { status, leaseToken: lease.leaseToken }), /not running/);
  }
  assert.equal(agentRuntimeStatus(root).tokenUsage.gate1, 23);
  registerAgent(root, { agentId: 'stage-over', vocation: 'review', stage: 'baseline' });
  const stageJob = enqueueAgentJob(root, { agentId: 'stage-over', stage: 'baseline', inputHash: 'stage-over', payload: { tokenBudget: 10, stageTokenBudget: 15 } });
  const stageLease = claimAgentJob(root, stageJob.jobId);
  recordObservedTokenUsage(root, { stage: 'baseline', observationKey: 'stage_over_host_call_1', inputTokens: 10, outputTokens: 0, usageSource: 'provider-reported' });
  const stageResult = settleAgentJob(root, stageJob.jobId, { status: 'succeeded', leaseToken: stageLease.leaseToken, usage: { inputTokens: 6, outputTokens: 0, usageSource: 'provider-reported' } });
  assert.equal(stageResult.jobs[0].status, 'dead-letter'); assert.equal(stageResult.tokenUsage.baseline, 16);
  console.log(JSON.stringify({ status: 'passed', scope: 'failed, interrupted, over-budget accounting, controlled recovery and legacy status' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
