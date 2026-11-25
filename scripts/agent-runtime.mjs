#!/usr/bin/env node
/** Persistent, evidence-first runtime for dedicated professional agents. */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { agentRuntimeStatus, publicAgentRuntimeStatus, appendLedgerEvent, claimAgentJob, configureRunTokenBudget, enqueueAgentJob, endTraceSpan, reconcileAgentAttemptUsage, reconcileObservedTokenUsage, recordTokenUsage, recordObservedTokenUsage, registerAgent, renewAgentJobLease, settleAgentJob, startTraceSpan } from './run-ledger.mjs';
import { availableAgentSkills, loadTasteSkill, loadAgentSkill, requiredTasteLoadCurrent } from './required-visual-skill.mjs';
import { PREBASELINE_REVIEWER_ID, prebaselineReviewContext, prebaselineReviewBatchPlan } from './prebaseline-import-review.mjs';
import { controlledOutput } from './verification-policy.mjs';

const fail = message => { console.error(`APEX agent runtime failed: ${message}`); process.exit(1); };
const [command, runArg, ...args] = process.argv.slice(2);
const runDir = path.resolve(runArg || '.');
if (!command || !runArg) fail('usage: register|enqueue|claim|skill|renew|succeed|fail|tokens-observed|reconcile-attempt-usage|reconcile-observed-usage|run-budget|trace-start|trace-end|status <run-dir> ... (tokens is for legacy Runs only)');
const stageAction = { prebaseline: 'collect_existing_baseline', baseline: 'collect_existing_baseline', gate1: 'analyze_requirement', visual: 'plan_visual', implementation: 'compile_visual_bundle', verify: 'verify' };
const readJson = value => { try { return JSON.parse(value); } catch { fail('JSON argument is invalid'); } };
const tokenInteger = (value, name) => { if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${name} must be a non-negative safe integer`); return Number(value); };
try {
  if (command === 'status') { requireRouterAction(runDir, Object.values(stageAction)); console.log(JSON.stringify(publicAgentRuntimeStatus(agentRuntimeStatus(runDir)), null, 2)); }
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
    // A replay reconciles a potentially live executor; it must not redispatch
    // or reload its instructions. New claims still validate the Skill first.
    const replaying = pending.status === 'running';
    if (stage === 'prebaseline' && !replaying) {
      const reference = pending.payload?.inputBindings?.find(item => item.artifact === 'unresolvedImportInspection')?.path;
      const batchIndex = pending.payload?.reviewContext?.batch?.index;
      const currentContext = batchIndex === undefined ? prebaselineReviewContext(runDir, path.resolve(runDir, '..', '..', '..'), reference).context : prebaselineReviewBatchPlan(runDir, path.resolve(runDir, '..', '..', '..'), reference).batches[batchIndex - 1];
      const selectionRef = 'advisories/prebaseline/selection.json';
      if (!controlledOutput(runDir, selectionRef, ['role-advisory.mjs'], [], ['collect_existing_baseline'])) throw new Error('prebaseline review selection lacks a controlled ledger-bound receipt');
      const selection = JSON.parse(fs.readFileSync(path.join(runDir, selectionRef), 'utf8'));
      const expectedAgent = batchIndex === undefined ? PREBASELINE_REVIEWER_ID : `${PREBASELINE_REVIEWER_ID}-batch-${batchIndex}`;
      if (!currentContext || pending.agentId !== expectedAgent || pending.payload?.roleId !== pending.agentId || selection.agentJobs?.[pending.agentId] !== jobId || JSON.stringify(selection.inputBindings) !== JSON.stringify(pending.payload?.inputBindings) || pending.payload?.reviewPolicy !== 'judgment-only-no-baseline-exception' || JSON.stringify(pending.payload?.reviewContext) !== JSON.stringify(currentContext)) throw new Error('prebaseline review job is not bound to the current inspection');
    }
    const skillInstructions = !replaying && pending?.payload?.tasteSkill ? loadTasteSkill(pending.payload.tasteSkill) : null;
    const optionalSkills = replaying ? [] : availableAgentSkills(stage, pending.payload?.roleId);
    const claimed = claimAgentJob(runDir, jobId, { claimKey, replayOnly: replaying });
    if (claimed.status === 'budget-exhausted') fail(`${claimed.reason?.startsWith('run-budget-') ? 'run' : 'stage'}-token-budget-exhausted: ${JSON.stringify(claimed)}`);
    if (claimed.status === 'running' && !claimed.idempotent && skillInstructions) appendLedgerEvent(runDir, { type: 'agent-required-skill-loaded', jobId, agentId: pending.agentId, stage, attempt: claimed.attempt, name: skillInstructions.name, sha256: skillInstructions.sha256, path: skillInstructions.path, operationReceipt: process.env.APEX_ROUTER_OPERATION_RECEIPT || null });
    const replaySkill = claimed.idempotent && claimed.payload?.tasteSkill;
    const requiredSkillLoad = replaySkill ? { status: requiredTasteLoadCurrent(runDir, jobId, claimed.attempt, claimed.leaseToken, replaySkill) ? 'verified' : 'unverified', note: 'A replay does not load or dispatch the Skill; reconcile the original executor and receipt before proceeding.' } : undefined;
    const replayReview = stage === 'prebaseline' && claimed.idempotent && claimed.payload?.reviewContext;
    const response = replayReview ? { ...claimed, payload: { ...claimed.payload, reviewContext: undefined }, reviewContextBinding: { sha256: `sha256:${crypto.createHash('sha256').update(JSON.stringify(replayReview)).digest('hex')}`, note: 'Reconcile the existing execution; replay does not resend or redispatch the review context.' } } : claimed;
    console.log(JSON.stringify({ ...response, ...(claimed.status === 'running' && !claimed.idempotent && skillInstructions ? { requiredSkill: skillInstructions } : {}), ...(replaySkill ? { requiredSkillBinding: replaySkill, requiredSkillLoad } : {}), ...(claimed.status === 'running' && !claimed.idempotent && optionalSkills.length ? { optionalSkills } : {}) }));
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
    requireRouterAction(runDir, action); const usage = usageJson ? readJson(usageJson) : null; const value = command === 'succeed' ? { status: 'succeeded', result: readJson(detail), leaseToken, usage } : { status: 'failed', error: detail, leaseToken, usage }; const outcome = settleAgentJob(runDir, jobId, { ...value, expectedStage: stage, directCompletion: command === 'succeed' }); console.log(JSON.stringify(publicAgentRuntimeStatus(outcome))); if (command === 'succeed' && outcome.jobs[0]?.status !== 'succeeded') fail(`agent job was not accepted as succeeded: ${outcome.jobs[0]?.status || 'unknown'}`);
  } else if (command === 'tokens') {
    const [stage, input = '0', output = '0', limit = 'null', agentId = ''] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); console.log(JSON.stringify(recordTokenUsage(runDir, { stage, agentId: agentId || null, inputTokens: Number(input), outputTokens: Number(output), limit: limit === 'null' ? null : Number(limit), legacyOnly: true })));
  } else if (command === 'tokens-observed') {
    const [stage, observationKey, input, output, usageSource, limit = 'null'] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    if (input === undefined || output === undefined) fail('tokens-observed requires input and output counts');
    requireRouterAction(runDir, action); console.log(JSON.stringify(recordObservedTokenUsage(runDir, { stage, observationKey, inputTokens: tokenInteger(input, 'input tokens'), outputTokens: tokenInteger(output, 'output tokens'), usageSource, limit: limit === 'null' ? null : tokenInteger(limit, 'token limit') })));
  } else if (command === 'reconcile-attempt-usage') {
    const [stage, jobId, attempt, usageJson] = args, action = stageAction[stage];
    if (!action || !jobId || !attempt || !usageJson) fail('reconcile-attempt-usage requires current stage, job ID, attempt and usage JSON');
    requireRouterAction(runDir, action); console.log(JSON.stringify(reconcileAgentAttemptUsage(runDir, { ...readJson(usageJson), jobId, attempt: Number(attempt) })));
  } else if (command === 'reconcile-observed-usage') {
    const [currentStage, observationKey, usageJson] = args, action = stageAction[currentStage];
    if (!action || !observationKey || !usageJson) fail('reconcile-observed-usage requires current stage, observation key and usage JSON');
    requireRouterAction(runDir, action); console.log(JSON.stringify(reconcileObservedTokenUsage(runDir, { ...readJson(usageJson), observationKey })));
  } else if (command === 'run-budget') {
    const [stage, limit, verificationReserve, recoveryReserve = '0'] = args, action = stageAction[stage];
    if (!action || limit === undefined || verificationReserve === undefined) fail('run-budget requires stage, total limit, verification reserve and optional recovery reserve');
    requireRouterAction(runDir, action); console.log(JSON.stringify(configureRunTokenBudget(runDir, { limit: tokenInteger(limit, 'run budget'), verificationReserve: tokenInteger(verificationReserve, 'verification reserve'), recoveryReserve: tokenInteger(recoveryReserve, 'recovery reserve') })));
  } else if (command === 'trace-start') {
    const [stage, name, kind = 'agent', attributes = '{}'] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); console.log(JSON.stringify(startTraceSpan(runDir, { name, kind, attributes: readJson(attributes) })));
  } else if (command === 'trace-end') {
    const [stage, spanId, status = 'passed', error = ''] = args; const action = stageAction[stage]; if (!action) fail(`unsupported stage: ${stage}`);
    requireRouterAction(runDir, action); endTraceSpan(runDir, spanId, { status, error: error || null }); console.log(JSON.stringify({ status: 'ended', spanId }));
  } else fail(`unsupported command: ${command}`);
} catch (error) { fail(error.message); }
