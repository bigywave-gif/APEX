#!/usr/bin/env node
/** Persistent, evidence-first runtime for dedicated professional agents. */
import path from 'node:path';
import crypto from 'node:crypto';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { agentRuntimeStatus, appendLedgerEvent, claimAgentJob, configureRunTokenBudget, enqueueAgentJob, endTraceSpan, reconcileAgentAttemptUsage, recordTokenUsage, recordObservedTokenUsage, registerAgent, renewAgentJobLease, settleAgentJob, startTraceSpan } from './run-ledger.mjs';
import { availableAgentSkills, loadTasteSkill, loadAgentSkill } from './required-visual-skill.mjs';

const fail = message => { console.error(`APEX agent runtime failed: ${message}`); process.exit(1); };
const [command, runArg, ...args] = process.argv.slice(2);
const runDir = path.resolve(runArg || '.');
if (!command || !runArg) fail('usage: register|enqueue|claim|succeed|fail|tokens|trace-start|trace-end|status <run-dir> ...');
const stageAction = { baseline: 'collect_existing_baseline', gate1: 'analyze_requirement', visual: 'plan_visual', implementation: 'compile_visual_bundle', verify: 'verify' };
const readJson = value => { try { return JSON.parse(value); } catch { fail('JSON argument is invalid'); } };
try {
  if (command === 'status') { requireRouterAction(runDir, Object.values(stageAction)); console.log(JSON.stringify(agentRuntimeStatus(runDir), null, 2)); }
  else if (command === 'register') {
    const [agentId, vocation, stage, capabilityVersion = '1.0', metadata = '{}'] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); registerAgent(runDir, { agentId, vocation, stage, capabilityVersion, metadata: readJson(metadata) }); console.log(JSON.stringify({ status: 'registered', agentId, vocation, stage }));
  } else if (command === 'enqueue') {
    const [agentId, stage, inputHash, payload = '{}', maxAttempts = '3'] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); console.log(JSON.stringify(enqueueAgentJob(runDir, { agentId, stage, inputHash, payload: readJson(payload), maxAttempts: Number(maxAttempts) })));
  } else if (command === 'claim') {
    const [jobId, stage, claimKey = null] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action);
    const pending = agentRuntimeStatus(runDir, jobId).jobs[0];
    if (!pending || pending.stage !== stage) throw new Error(`agent job does not belong to the authorized stage: ${jobId}/${stage}`);
    if (stage === 'visual' && pending.agentId === 'ui-designer' && !pending.payload?.tasteSkill) throw new Error('visual UI designer job is missing required taste-skill binding');
    const skillInstructions = pending?.payload?.tasteSkill ? loadTasteSkill(pending.payload.tasteSkill) : null;
    const optionalSkills = availableAgentSkills(stage, pending.payload?.roleId);
    const claimed = claimAgentJob(runDir, jobId, { claimKey });
    if (claimed.status === 'budget-exhausted') fail(`${claimed.reason?.startsWith('run-budget-') ? 'run' : 'stage'}-token-budget-exhausted: ${JSON.stringify(claimed)}`);
    if (claimed.status === 'running' && skillInstructions) appendLedgerEvent(runDir, { type: 'agent-required-skill-loaded', jobId, agentId: pending.agentId, stage, attempt: claimed.attempt, name: skillInstructions.name, sha256: skillInstructions.sha256, path: skillInstructions.path, operationReceipt: process.env.APEX_ROUTER_OPERATION_RECEIPT || null });
    console.log(JSON.stringify({ ...claimed, ...(claimed.status === 'running' && skillInstructions ? { requiredSkill: skillInstructions } : {}), ...(claimed.status === 'running' && optionalSkills.length ? { optionalSkills } : {}) }));
  } else if (command === 'skill') {
    const [jobId, stage, leaseToken, name, expectedSha256] = args;
    if (!stageAction[stage] || !jobId || !leaseToken || !name || !expectedSha256) fail('skill requires a valid agent job, stage, lease token, skill name and expected hash');
    requireRouterAction(runDir, stageAction[stage]);
    const job = agentRuntimeStatus(runDir, jobId).jobs[0];
    if (!job || job.stage !== stage) fail('optional skills require a job belonging to the current stage');
    // Renewal validates the current fenced lease before any skill is provided.
    renewAgentJobLease(runDir, jobId, leaseToken);
    const skill = loadAgentSkill(stage, job.payload?.roleId, name, expectedSha256);
    appendLedgerEvent(runDir, { type: stage === 'visual' ? 'agent-visual-skill-loaded' : 'agent-skill-loaded', jobId, agentId: job.agentId, stage, attempt: job.attempt, name: skill.name, sha256: skill.sha256, path: skill.path, leaseTokenHash: `sha256:${crypto.createHash('sha256').update(leaseToken).digest('hex')}`, operationReceipt: process.env.APEX_ROUTER_OPERATION_RECEIPT || null });
    console.log(JSON.stringify({ status: 'loaded', jobId, skill }));
  } else if (command === 'renew') {
    const [jobId, stage, leaseToken] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action);
    const job = agentRuntimeStatus(runDir, jobId).jobs[0];
    if (!job || job.stage !== stage) fail(`agent job does not belong to the authorized stage: ${jobId}/${stage}`);
    console.log(JSON.stringify(renewAgentJobLease(runDir, jobId, leaseToken)));
  } else if (command === 'succeed' || command === 'fail') {
    const [jobId, stage, detail = '{}', leaseToken = null, usageJson = null] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); const usage = usageJson ? readJson(usageJson) : null; const value = command === 'succeed' ? { status: 'succeeded', result: readJson(detail), leaseToken, usage } : { status: 'failed', error: detail, leaseToken, usage }; const outcome = settleAgentJob(runDir, jobId, { ...value, expectedStage: stage, directCompletion: command === 'succeed' }); console.log(JSON.stringify(outcome)); if (command === 'succeed' && outcome.jobs[0]?.status !== 'succeeded') fail(`agent job was not accepted as succeeded: ${outcome.jobs[0]?.status || 'unknown'}`);
  } else if (command === 'tokens') {
    const [stage, input = '0', output = '0', limit = 'null', agentId = ''] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); console.log(JSON.stringify(recordTokenUsage(runDir, { stage, agentId: agentId || null, inputTokens: Number(input), outputTokens: Number(output), limit: limit === 'null' ? null : Number(limit) })));
  } else if (command === 'tokens-observed') {
    const [stage, observationKey, input, output, usageSource, limit = 'null'] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    if (input === undefined || output === undefined) fail('tokens-observed requires input and output counts');
    requireRouterAction(runDir, action); console.log(JSON.stringify(recordObservedTokenUsage(runDir, { stage, observationKey, inputTokens: Number(input), outputTokens: Number(output), usageSource, limit: limit === 'null' ? null : Number(limit) })));
  } else if (command === 'reconcile-attempt-usage') {
    const [stage, jobId, attempt, usageJson] = args, action = stageAction[stage];
    if (!action || !jobId || !attempt || !usageJson) fail('reconcile-attempt-usage requires current stage, job ID, attempt and usage JSON');
    requireRouterAction(runDir, action); console.log(JSON.stringify(reconcileAgentAttemptUsage(runDir, { ...readJson(usageJson), jobId, attempt: Number(attempt) })));
  } else if (command === 'run-budget') {
    const [stage, limit, verificationReserve, recoveryReserve = '0'] = args, action = stageAction[stage];
    if (!action || limit === undefined || verificationReserve === undefined) fail('run-budget requires stage, total limit, verification reserve and optional recovery reserve');
    requireRouterAction(runDir, action); console.log(JSON.stringify(configureRunTokenBudget(runDir, { limit: Number(limit), verificationReserve: Number(verificationReserve), recoveryReserve: Number(recoveryReserve) })));
  } else if (command === 'trace-start') {
    const [stage, name, kind = 'agent', attributes = '{}'] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); console.log(JSON.stringify(startTraceSpan(runDir, { name, kind, attributes: readJson(attributes) })));
  } else if (command === 'trace-end') {
    const [stage, spanId, status = 'passed', error = ''] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); endTraceSpan(runDir, spanId, { status, error: error || null }); console.log(JSON.stringify({ status: 'ended', spanId }));
  } else fail(`unsupported command: ${command}`);
} catch (error) { fail(error.message); }
