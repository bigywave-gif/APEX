import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAgent, enqueueAgentJob, claimAgentJob, settleAgentJob, agentRuntimeStatus, rebudgetAgentJobs, recordObservedTokenUsage } from './run-ledger.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-agent-budget-'));
try {
  const jobs = Array.from({ length: 4 }, (_, i) => {
    const agentId = `budget-${i}`; registerAgent(root, { agentId, vocation: 'review', stage: 'visual' });
    return enqueueAgentJob(root, { agentId, stage: 'visual', inputHash: `input-${i}`, payload: { tokenBudget: 60, stageTokenBudget: 100 } }).jobId;
  });
  const url = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-ledger.mjs')).href;
  const code = `import {claimAgentJob} from ${JSON.stringify(url)}; console.log(JSON.stringify(claimAgentJob(process.argv[1],process.argv[2])));`;
  const results = await Promise.all(jobs.map(id => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, root, id], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
    p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x); p.on('error', reject); p.on('close', c => c === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  })));
  const active = results.filter(x => x.status === 'running'), waiting = results.filter(x => x.status === 'waiting');
  assert.equal(active.length, 1); assert.equal(active[0].reservedTokens, 60); assert.ok(waiting.every(x => x.reason === 'stage-budget-reserved'));
  const observation = { stage: 'visual', observationKey: 'host_call_0000000001', inputTokens: 30, outputTokens: 20, usageSource: 'provider-reported', limit: 100 };
  const actual = recordObservedTokenUsage(root, observation);
  assert.equal(actual.used, 50); assert.equal(actual.reserved, 60); assert.equal(actual.overcommitted, true);
  assert.equal(recordObservedTokenUsage(root, observation).idempotent, true);
  const legacyDb = new DatabaseSync(path.join(root, 'run-ledger.sqlite'));
  legacyDb.prepare('UPDATE token_observations SET fingerprint = ? WHERE observation_key = ?').run('legacy-budget-bound-fingerprint', observation.observationKey); legacyDb.close();
  const rebudgetReplay = recordObservedTokenUsage(root, { ...observation, limit: 150 });
  assert.equal(rebudgetReplay.idempotent, true); assert.equal(rebudgetReplay.used, 50); assert.equal(rebudgetReplay.overcommitted, false);
  assert.throws(() => recordObservedTokenUsage(root, { ...observation, inputTokens: 31 }), /identity conflict/);
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 50);
  settleAgentJob(root, active[0].job_id, { status: 'failed', error: 'fixture', leaseToken: active[0].leaseToken, retryDelayMs: 0, usage: { inputTokens: 20, outputTokens: 10, usageSource: 'provider-reported' } });
  assert.equal(claimAgentJob(root, waiting[0].jobId).status, 'budget-exhausted');
  rebudgetAgentJobs(root, { stage: 'visual', jobIds: waiting.map(item => item.jobId), perAgentBudget: 60, stageBudget: 150 });
  const second = claimAgentJob(root, waiting[0].jobId); assert.equal(second.status, 'running');
  settleAgentJob(root, second.job_id, { status: 'succeeded', leaseToken: second.leaseToken, usage: { inputTokens: 15, outputTokens: 35, usageSource: 'provider-reported' } });
  const exhausted = claimAgentJob(root, waiting[1].jobId); assert.equal(exhausted.status, 'budget-exhausted'); assert.equal(exhausted.available, 20);
  assert.equal(agentRuntimeStatus(root).tokenUsage.visual, 130); assert.equal(exhausted.budgetScope, 'reported-usage-only');
  rebudgetAgentJobs(root, { stage: 'visual', jobIds: [waiting[1].jobId], perAgentBudget: 60, stageBudget: 200 });
  assert.equal(claimAgentJob(root, waiting[1].jobId).status, 'running', 'authorized rebudget must update the pending stage allowance');
  const observationCode = `import {recordObservedTokenUsage} from ${JSON.stringify(url)}; console.log(JSON.stringify(recordObservedTokenUsage(process.argv[1],{stage:'gate1',observationKey:'parallel_host_call_0001',inputTokens:4,outputTokens:3,usageSource:'provider-reported',limit:100})));`;
  const observed = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', observationCode, root], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
    p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x); p.on('error', reject); p.on('close', c => c === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  })));
  assert.equal(observed.filter(item => !item.idempotent).length, 1);
  assert.equal(observed.filter(item => item.idempotent).length, 5);
  assert.equal(agentRuntimeStatus(root).tokenUsage.gate1, 7);
  assert.throws(() => recordObservedTokenUsage(root, { ...observation, observationKey: 'unknown_usage_00001', usageSource: 'unknown' }), /invalid observed token usage/);
  const unknown = recordObservedTokenUsage(root, { stage: 'baseline', observationKey: 'unknown_usage_00001', inputTokens: 0, outputTokens: 0, usageSource: 'unknown', limit: 100 });
  assert.equal(unknown.available, null); assert.equal(unknown.overcommitted, null); assert.equal(unknown.incompleteUsage, true);
  registerAgent(root, { agentId: 'unknown-budget', vocation: 'review', stage: 'baseline' });
  const unknownJob = enqueueAgentJob(root, { agentId: 'unknown-budget', stage: 'baseline', inputHash: 'unknown', payload: { tokenBudget: 101, stageTokenBudget: 100 } });
  const unknownClaim = claimAgentJob(root, unknownJob.jobId);
  assert.equal(unknownClaim.status, 'budget-exhausted'); assert.equal(unknownClaim.available, null);
  assert.equal(unknownClaim.reportedAvailable, 100); assert.equal(unknownClaim.incompleteUsage, true);

  console.log(JSON.stringify({ status: 'passed', checks: 26, scope: 'concurrent-claims-and-failed-attempts' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
