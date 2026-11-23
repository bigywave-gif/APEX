import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAgent, enqueueAgentJob, claimAgentJob, settleAgentJob, agentRuntimeStatus } from './run-ledger.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-agent-capacity-'));
try {
  const jobs = Array.from({ length: 6 }, (_, i) => {
    const agentId = `agent-${i}`; registerAgent(root, { agentId, vocation: 'review', stage: 'visual' });
    return enqueueAgentJob(root, { agentId, stage: 'visual', inputHash: `input-${i}` }).jobId;
  });
  const extraJobs = Array.from({ length: 6 }, (_, i) => enqueueAgentJob(root, { agentId: `agent-${i}`, stage: 'other', inputHash: 'another-task' }).jobId);
  const moduleUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-ledger.mjs')).href;
  const code = `import {claimAgentJob} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(claimAgentJob(process.argv[1],process.argv[2])));`;
  const results = await Promise.all(jobs.map(id => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, root, id], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
    child.stdout.on('data', chunk => out += chunk); child.stderr.on('data', chunk => err += chunk); child.on('error', reject); child.on('close', status => status === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  })));
  const active = results.filter(value => value.status === 'running'), waiting = results.filter(value => value.status === 'waiting');
  assert.equal(active.length, 2); assert.equal(waiting.length, 4); assert.ok(waiting.every(value => value.reason === 'agent-concurrency-limit'));
  assert.equal(agentRuntimeStatus(root).counts.queued, 10);
  const extra = extraJobs[Number(active[0].agent_id.split('-')[1])];
  assert.equal(claimAgentJob(root, extra).reason, 'agent-already-running');
  settleAgentJob(root, active[0].job_id, { status: 'succeeded', leaseToken: active[0].leaseToken });
  const next = claimAgentJob(root, waiting[0].jobId); assert.equal(next.status, 'running');
  assert.equal(agentRuntimeStatus(root).counts.running, 2);
  console.log(JSON.stringify({ status: 'passed', checks: 7, scope: 'six-concurrent-processes-single-run' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
