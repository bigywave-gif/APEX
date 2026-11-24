import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeLedger, configureRunTokenBudget, registerAgent, enqueueAgentJob, claimAgentJob, settleAgentJob, reconcileAgentAttemptUsage, recordObservedTokenUsage, agentRuntimeStatus } from './run-ledger.mjs';
import { readRunMetrics } from './run-metrics.mjs';

const run = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-run-token-budget-'));
try {
  const state = { runId: 'budget-test', revision: 1, track: 'greenfield', scope: 'standard', gates: { gate3: { status: 'pending' } }, artifacts: {} };
  fs.writeFileSync(path.join(run, 'state.json'), JSON.stringify(state)); initializeLedger(run, state, 'budget-test');
  assert.throws(() => configureRunTokenBudget(run, { limit: 100, verificationReserve: 101 }), /reserve/);
  assert.equal(configureRunTokenBudget(run, { limit: 120, verificationReserve: 40 }).reportedAvailable, 120);
  const job = (agentId, stage, tokenBudget) => { registerAgent(run, { agentId, vocation: 'review', stage }); return enqueueAgentJob(run, { agentId, stage, inputHash: agentId, payload: { tokenBudget, stageTokenBudget: 200 } }).jobId; };
  const visual = job('visual-agent', 'visual', 60), implementation = job('implementation-agent', 'implementation', 30), verify = job('verify-agent', 'verify', 40);
  const first = claimAgentJob(run, visual); assert.equal(first.status, 'running'); assert.equal(first.runBudget.reportedAvailable, 20);
  const blocked = claimAgentJob(run, implementation); assert.equal(blocked.status, 'waiting'); assert.equal(blocked.reason, 'run-budget-reserved');
  const checking = claimAgentJob(run, verify); assert.equal(checking.status, 'running'); assert.equal(checking.runBudget.remainingVerificationReserve, 0);
  settleAgentJob(run, visual, { status: 'succeeded', leaseToken: first.leaseToken, usage: { inputTokens: 20, outputTokens: 30, usageSource: 'provider-reported' } });
  const implementing = claimAgentJob(run, implementation); assert.equal(implementing.status, 'running');
  settleAgentJob(run, verify, { status: 'succeeded', leaseToken: checking.leaseToken, usage: { inputTokens: 10, outputTokens: 10, usageSource: 'provider-reported' } });
  settleAgentJob(run, implementation, { status: 'succeeded', leaseToken: implementing.leaseToken, usage: { inputTokens: 10, outputTokens: 15, usageSource: 'provider-reported' } });
  const extra = job('extra-agent', 'visual', 10), noRoom = claimAgentJob(run, extra);
  assert.equal(noRoom.status, 'budget-exhausted'); assert.equal(noRoom.reason, 'run-budget-insufficient'); assert.equal(noRoom.runBudget.remainingVerificationReserve, 20);
  const finalCheck = job('second-check', 'verify', 25), finalLease = claimAgentJob(run, finalCheck); assert.equal(finalLease.status, 'running');
  settleAgentJob(run, finalCheck, { status: 'succeeded', leaseToken: finalLease.leaseToken, usage: { inputTokens: 10, outputTokens: 15, usageSource: 'provider-reported' } });
  assert.equal(agentRuntimeStatus(run).runBudget.used, 120);
  assert.equal(readRunMetrics(run).tokens.runBudget.used, 120);
  const uncertain = recordObservedTokenUsage(run, { stage: 'gate1', observationKey: 'unknown_run_usage_0001', inputTokens: 0, outputTokens: 0, usageSource: 'unknown' });
  assert.equal(uncertain.runBudget.available, null); assert.equal(uncertain.runBudget.incompleteUsage, true);
  assert.equal(readRunMetrics(run).tokens.runBudget.available, null);
  const estimated = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-run-budget-estimate-'));
  try {
    configureRunTokenBudget(estimated, { limit: 100, verificationReserve: 20 });
    const observed = recordObservedTokenUsage(estimated, { stage: 'gate1', observationKey: 'estimated_usage_0001', inputTokens: 110, outputTokens: 0, usageSource: 'estimated' });
    assert.equal(observed.runBudget.estimatedUsage, true); assert.equal(observed.runBudget.available, null);
    assert.equal(observed.runBudget.overcommitted, null); assert.equal(observed.runBudget.reportedOvercommitted, true);
    assert.equal(observed.runBudget.reserveShortfall, null); assert.equal(observed.runBudget.reportedReserveShortfall, 30);
  } finally { fs.rmSync(estimated, { recursive: true, force: true }); }
  const concurrent = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-run-budget-concurrent-'));
  try {
    configureRunTokenBudget(concurrent, { limit: 100, verificationReserve: 0 });
    const ids = ['gate1', 'visual', 'implementation'].map((stage, index) => { const agentId = `parallel-${index}`; registerAgent(concurrent, { agentId, vocation: 'review', stage }); return enqueueAgentJob(concurrent, { agentId, stage, inputHash: agentId, payload: { tokenBudget: 60, stageTokenBudget: 100 } }).jobId; });
    const ledger = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-ledger.mjs')).href;
    const code = `import {claimAgentJob} from ${JSON.stringify(ledger)}; console.log(JSON.stringify(claimAgentJob(process.argv[1],process.argv[2])));`;
    const claims = await Promise.all(ids.map(id => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', code, concurrent, id], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; child.stdout.on('data', data => out += data); child.stderr.on('data', data => err += data); child.on('error', reject); child.on('close', status => status === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))); })));
    assert.equal(claims.filter(item => item.status === 'running').length, 1, 'concurrent stages must share one atomic Run budget');
    assert.ok(claims.filter(item => item.status === 'waiting').every(item => item.reason === 'run-budget-reserved'));
  } finally { fs.rmSync(concurrent, { recursive: true, force: true }); }
  const overrun = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-run-budget-overrun-'));
  try {
    configureRunTokenBudget(overrun, { limit: 100, verificationReserve: 20 });
    registerAgent(overrun, { agentId: 'overrun', vocation: 'review', stage: 'visual' });
    const jobId = enqueueAgentJob(overrun, { agentId: 'overrun', stage: 'visual', inputHash: 'overrun', payload: { tokenBudget: 50, stageTokenBudget: 100 } }).jobId;
    const lease = claimAgentJob(overrun, jobId);
    const observed = recordObservedTokenUsage(overrun, { stage: 'gate1', observationKey: 'overcommit_host_0001', inputTokens: 60, outputTokens: 0, usageSource: 'provider-reported' });
    assert.equal(observed.runBudget.reportedOvercommitted, true, 'already incurred host usage must be recorded even when it exceeds reservations');
    const result = settleAgentJob(overrun, jobId, { status: 'succeeded', leaseToken: lease.leaseToken, usage: { inputTokens: 10, outputTokens: 20, usageSource: 'provider-reported' } });
    assert.equal(result.jobs[0].status, 'dead-letter', 'an attempt cannot silently consume the protected verification reserve');
    assert.equal(result.runBudget.used, 90, 'actual over-budget use must remain recorded');
    assert.equal(result.runBudget.reportedReserveShortfall, 10, 'depleted verification reserve must be visible even below the total limit');
  } finally { fs.rmSync(overrun, { recursive: true, force: true }); }
  const recovery = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-run-budget-recovery-'));
  try {
    configureRunTokenBudget(recovery, { limit: 150, verificationReserve: 30, recoveryReserve: 30 });
    registerAgent(recovery, { agentId: 'retry-agent', vocation: 'review', stage: 'visual' });
    const id = enqueueAgentJob(recovery, { agentId: 'retry-agent', stage: 'visual', inputHash: 'retry', payload: { tokenBudget: 80, stageTokenBudget: 200 } }).jobId;
    const attempt = claimAgentJob(recovery, id);
    settleAgentJob(recovery, id, { status: 'failed', leaseToken: attempt.leaseToken, error: 'fixture', retryDelayMs: 0, usage: { inputTokens: 20, outputTokens: 20, usageSource: 'provider-reported' } });
    const retried = claimAgentJob(recovery, id); assert.equal(retried.status, 'running', 'a retry may use the protected recovery reserve');
    assert.equal(retried.runBudget.recoveryReserved, 80);
    settleAgentJob(recovery, id, { status: 'succeeded', leaseToken: retried.leaseToken, usage: { inputTokens: 30, outputTokens: 30, usageSource: 'provider-reported' } });
    const summary = agentRuntimeStatus(recovery).runBudget; assert.equal(summary.recoveryUsed, 60); assert.equal(summary.remainingVerificationReserve, 30);
    registerAgent(recovery, { agentId: 'regular-agent', vocation: 'review', stage: 'implementation' });
    const regular = enqueueAgentJob(recovery, { agentId: 'regular-agent', stage: 'implementation', inputHash: 'regular', payload: { tokenBudget: 30, stageTokenBudget: 200 } });
    assert.equal(claimAgentJob(recovery, regular.jobId).reason, 'run-budget-insufficient', 'normal work cannot spend the remaining verification reserve');
    registerAgent(recovery, { agentId: 'verify-after-retry', vocation: 'review', stage: 'verify' });
    const verifyJob = enqueueAgentJob(recovery, { agentId: 'verify-after-retry', stage: 'verify', inputHash: 'verify', payload: { tokenBudget: 30, stageTokenBudget: 200 } });
    assert.equal(claimAgentJob(recovery, verifyJob.jobId).status, 'running');
  } finally { fs.rmSync(recovery, { recursive: true, force: true }); }
  const repair = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-run-budget-repair-'));
  try {
    configureRunTokenBudget(repair, { limit: 120, verificationReserve: 20, recoveryReserve: 20 });
    registerAgent(repair, { agentId: 'repair-role', vocation: 'review', stage: 'visual' });
    const firstJob = enqueueAgentJob(repair, { agentId: 'repair-role', stage: 'visual', inputHash: 'old', payload: { tokenBudget: 80, stageTokenBudget: 200 } });
    const firstLease = claimAgentJob(repair, firstJob.jobId);
    settleAgentJob(repair, firstJob.jobId, { status: 'succeeded', leaseToken: firstLease.leaseToken, usage: { inputTokens: 40, outputTokens: 40, usageSource: 'provider-reported' } });
    registerAgent(repair, { agentId: 'unrelated-role', vocation: 'review', stage: 'visual' });
    const fake = enqueueAgentJob(repair, { agentId: 'unrelated-role', stage: 'visual', inputHash: 'fake', payload: { tokenBudget: 20, stageTokenBudget: 200, budgetRecovery: true } });
    assert.equal(claimAgentJob(repair, fake.jobId).reason, 'run-budget-insufficient', 'a new role cannot self-declare itself a recovery');
    const replacement = enqueueAgentJob(repair, { agentId: 'repair-role', stage: 'visual', inputHash: 'new', payload: { tokenBudget: 20, stageTokenBudget: 200, budgetRecovery: true } });
    const lease = claimAgentJob(repair, replacement.jobId); assert.equal(lease.status, 'running', 'a replacement for an executed role may use recovery reserve');
    settleAgentJob(repair, replacement.jobId, { status: 'succeeded', leaseToken: lease.leaseToken, usage: { inputTokens: 10, outputTokens: 10, usageSource: 'provider-reported' } });
    assert.equal(agentRuntimeStatus(repair).runBudget.recoveryUsed, 20);
  } finally { fs.rmSync(repair, { recursive: true, force: true }); }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-stage-budget-wait-'));
  try {
    recordObservedTokenUsage(stage, { stage: 'visual', observationKey: 'stage_usage_fixture_01', inputTokens: 80, outputTokens: 0, usageSource: 'provider-reported' });
    for (const id of ['running', 'too-large']) registerAgent(stage, { agentId: id, vocation: 'review', stage: 'visual' });
    const running = enqueueAgentJob(stage, { agentId: 'running', stage: 'visual', inputHash: 'running', payload: { tokenBudget: 10, stageTokenBudget: 100 } });
    const large = enqueueAgentJob(stage, { agentId: 'too-large', stage: 'visual', inputHash: 'large', payload: { tokenBudget: 30, stageTokenBudget: 100 } });
    assert.equal(claimAgentJob(stage, running.jobId).status, 'running');
    assert.equal(claimAgentJob(stage, large.jobId).status, 'budget-exhausted', 'waiting cannot resolve an already impossible stage budget');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  const unknownAttempt = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-unknown-attempt-budget-'));
  try {
    const unknownState = { runId: 'unknown-budget-test', revision: 1, track: 'greenfield', scope: 'standard', gates: { gate3: { status: 'pending' } }, artifacts: {} };
    fs.writeFileSync(path.join(unknownAttempt, 'state.json'), JSON.stringify(unknownState)); initializeLedger(unknownAttempt, unknownState, 'budget-test');
    configureRunTokenBudget(unknownAttempt, { limit: 100, verificationReserve: 0 });
    for (const id of ['unknown-first', 'unknown-next']) registerAgent(unknownAttempt, { agentId: id, vocation: 'review', stage: 'visual' });
    const first = enqueueAgentJob(unknownAttempt, { agentId: 'unknown-first', stage: 'visual', inputHash: 'first', payload: { tokenBudget: 70, stageTokenBudget: 100 } });
    const next = enqueueAgentJob(unknownAttempt, { agentId: 'unknown-next', stage: 'visual', inputHash: 'next', payload: { tokenBudget: 50, stageTokenBudget: 100 } });
    const lease = claimAgentJob(unknownAttempt, first.jobId);
    settleAgentJob(unknownAttempt, first.jobId, { status: 'succeeded', leaseToken: lease.leaseToken });
    const blocked = claimAgentJob(unknownAttempt, next.jobId);
    assert.equal(blocked.reason, 'run-budget-unknown-usage'); assert.equal(blocked.runBudget.unknownAttempts.held, 70);
    assert.equal(blocked.runBudget.used, 0, 'held uncertainty must not be recorded as actual usage');
    assert.equal(readRunMetrics(unknownAttempt).tokens.runBudget.unknownAttempts.held, 70);
    const observation = { jobId: first.jobId, attempt: 1, inputTokens: 10, outputTokens: 10, usageSource: 'provider-reported', evidence: 'provider usage record fixture' };
    assert.equal(reconcileAgentAttemptUsage(unknownAttempt, observation).status, 'reconciled');
    assert.equal(reconcileAgentAttemptUsage(unknownAttempt, observation).status, 'already-reconciled');
    assert.throws(() => reconcileAgentAttemptUsage(unknownAttempt, { ...observation, inputTokens: 11 }), /different values/);
    assert.equal(claimAgentJob(unknownAttempt, next.jobId).status, 'running');
  } finally { fs.rmSync(unknownAttempt, { recursive: true, force: true }); }
  const unknownVerification = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-unknown-verification-budget-'));
  try {
    configureRunTokenBudget(unknownVerification, { limit: 100, verificationReserve: 40 });
    registerAgent(unknownVerification, { agentId: 'verify-unknown', vocation: 'review', stage: 'verify' });
    registerAgent(unknownVerification, { agentId: 'normal-after-verify', vocation: 'review', stage: 'visual' });
    const verifyJob = enqueueAgentJob(unknownVerification, { agentId: 'verify-unknown', stage: 'verify', inputHash: 'verify', payload: { tokenBudget: 40 } });
    const lease = claimAgentJob(unknownVerification, verifyJob.jobId);
    settleAgentJob(unknownVerification, verifyJob.jobId, { status: 'succeeded', leaseToken: lease.leaseToken });
    const normal = enqueueAgentJob(unknownVerification, { agentId: 'normal-after-verify', stage: 'visual', inputHash: 'normal', payload: { tokenBudget: 60 } });
    const admitted = claimAgentJob(unknownVerification, normal.jobId);
    assert.equal(admitted.status, 'running', 'unknown verification reservation must not be protected twice');
    assert.equal(admitted.runBudget.unknownAttempts.verificationHeld, 40);
  } finally { fs.rmSync(unknownVerification, { recursive: true, force: true }); }
  const unverified = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-unverified-attempt-budget-'));
  try {
    configureRunTokenBudget(unverified, { limit: 100, verificationReserve: 0 });
    registerAgent(unverified, { agentId: 'legacy-values', vocation: 'review', stage: 'visual' });
    const job = enqueueAgentJob(unverified, { agentId: 'legacy-values', stage: 'visual', inputHash: 'unverified', payload: { tokenBudget: 70 } });
    const lease = claimAgentJob(unverified, job.jobId);
    settleAgentJob(unverified, job.jobId, { status: 'succeeded', leaseToken: lease.leaseToken, usage: { inputTokens: 10, outputTokens: 20, usageSource: 'legacy-unverified' } });
    const budget = agentRuntimeStatus(unverified).runBudget;
    assert.equal(budget.used, 30); assert.equal(budget.unknownAttempts.held, 40); assert.equal(budget.admissionAvailable, 30, 'unverified recorded usage must not consume the original reservation twice');
  } finally { fs.rmSync(unverified, { recursive: true, force: true }); }
  const historical = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-unknown-historical-budget-'));
  try {
    registerAgent(historical, { agentId: 'historical', vocation: 'review', stage: 'visual' });
    const old = enqueueAgentJob(historical, { agentId: 'historical', stage: 'visual', inputHash: 'old' });
    const lease = claimAgentJob(historical, old.jobId); settleAgentJob(historical, old.jobId, { status: 'succeeded', leaseToken: lease.leaseToken });
    configureRunTokenBudget(historical, { limit: 100, verificationReserve: 0 });
    const next = enqueueAgentJob(historical, { agentId: 'historical', stage: 'visual', inputHash: 'next', payload: { tokenBudget: 10 } });
    const blocked = claimAgentJob(historical, next.jobId);
    assert.equal(blocked.reason, 'run-budget-unknown-usage'); assert.equal(blocked.runBudget.unknownAttempts.unbounded, 1);
    reconcileAgentAttemptUsage(historical, { jobId: old.jobId, attempt: 1, inputTokens: 2, outputTokens: 3, usageSource: 'estimated', evidence: 'historical fixture estimate' });
    assert.equal(claimAgentJob(historical, next.jobId).status, 'running');
  } finally { fs.rmSync(historical, { recursive: true, force: true }); }
  console.log(JSON.stringify({ status: 'passed', scope: 'cross-stage reservations, protected verification, settlement, metrics and unknown usage' }));
} finally { fs.rmSync(run, { recursive: true, force: true }); }
