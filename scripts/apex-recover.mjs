#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { appendLedgerEvent, archiveArtifacts, claimRevisionReplay, commitRunState, finalizeCommittedRevision, invalidationEvents, pendingRevisionTransactions, readRunState, recoverAgentJobs, reconcileRun } from './run-ledger.mjs';
import { implementationSealCurrent, recoverImplementationSeal } from './implementation-seal.mjs';
import { inspectRunningOperations, markInterruptedOperations } from './operation-recovery.mjs';
import { archivedMissingReferences } from './recovery-archive.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function die(message) { console.error(`APEX recovery failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const runDir = path.resolve(process.argv[2] || '.');
try { requireRouterAction(runDir, 'recover'); } catch (error) { die(error.message); }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
const state = readRunState(runDir);
const operationInspection = inspectRunningOperations(runDir, process.env.APEX_ROUTER_OPERATION_RECEIPT || '');
if (operationInspection.deferred.length) {
  console.log(JSON.stringify({ status: 'waiting', deferredOperations: operationInspection.deferred, note: 'Existing operations may still be running or cannot be verified; no interrupted status or remote outcome was inferred.' }));
  process.exit(0);
}
const pendingRevisions = pendingRevisionTransactions(runDir);
let revisionRecovery = null;
if (pendingRevisions.length) {
  const active = pendingRevisions.some(item => {
    if (item.ownerHost !== os.hostname() || !Number.isInteger(item.ownerPid) || item.ownerPid <= 0) return true;
    try { process.kill(item.ownerPid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
  });
  if (active) {
    console.log(JSON.stringify({ status: 'waiting', transactions: pendingRevisions.map(item => ({ transactionId: item.transactionId, checkpoint: item.checkpoint, startedAt: item.at })), note: 'The revision owner may still be running; its state and files are not modified.' }));
    process.exit(0);
  }
  if (pendingRevisions.length !== 1) die('multiple pending revision transactions require investigation');
  try { revisionRecovery = finalizeCommittedRevision(runDir, pendingRevisions[0].transactionId); }
  catch (error) { die(`revision recovery refused: ${error.message}`); }
  if (revisionRecovery.status === 'state-not-committed') {
    const interruptedBeforeReplay = markInterruptedOperations(runDir, operationInspection.interrupted);
    if (interruptedBeforeReplay.length) appendLedgerEvent(runDir, { type: 'revision-replay-interrupted-operations-reconciled', transactionId: pendingRevisions[0].transactionId, operations: interruptedBeforeReplay });
    let claim;
    try { claim = claimRevisionReplay(runDir, pendingRevisions[0].transactionId); }
    catch (error) { die(`revision replay refused: ${error.message}`); }
    const replay = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-router.mjs'), 'resume-revision', process.env.APEX_ROUTER_PROJECT_ROOT, process.env.APEX_ROUTER_RUN_ID, process.env.APEX_ROUTER_SESSION_ID, claim.transactionId, claim.replayClaimId], { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    if (replay.status !== 0) die(`revision replay failed: ${(replay.stderr || replay.stdout || replay.error?.message || 'unknown failure').trim()}`);
    process.stdout.write(replay.stdout); process.exit(0);
  }
}
let implementationSealRecovery = null;
if (state.roleChain?.confirmationModel === 'two-confirmations' && state.gates?.gate2?.status === 'passed' && state.locks?.implementationAllowed) {
  const evidence = (state.gates.gate2.evidence || []).find(ref => typeof ref === 'string' && /^machine-seals\/implementation-[a-f0-9]{64}\.json$/.test(ref));
  let demoApproval = null;
  try { demoApproval = read(path.join(runDir, evidence)).demoApproval; } catch {}
  if (!demoApproval) {
    const dir = path.join(runDir, 'approvals');
    const candidates = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.startsWith('demo-') && name.endsWith('.json')).map(name => `approvals/${name}`) : [];
    // Exactly one confirmation can match the content-addressed seal.
    for (const candidate of candidates) { const result = recoverImplementationSeal(runDir, state, candidate); if (result.status === 'recovered') { demoApproval = candidate; implementationSealRecovery = result; break; } }
  }
  if (!implementationSealCurrent(runDir, state, demoApproval)) {
    implementationSealRecovery = recoverImplementationSeal(runDir, state, demoApproval);
    if (implementationSealRecovery.status !== 'recovered') die(`implementation seal recovery refused: ${implementationSealRecovery.reason}`);
  }
}
const interruptedOperations = markInterruptedOperations(runDir, operationInspection.interrupted);
const recoveredAgentJobs = recoverAgentJobs(runDir);
// A guarded compiler may reject a newly corrected input before it can emit a
// replacement receipt.  The old input registration then has an intentionally
// stale hash and used to keep recovery permanently repair-required.  Inputs
// are immutable audit evidence, not current materialization; archive only
// mismatched input registrations so the next authorized action can register
// the new hash. Never archive a mismatched output/state artifact here.
const preRecoveryReconciliation = reconcileRun(runDir);
const staleInputReferences = (preRecoveryReconciliation.issues || [])
  .filter(issue => issue.type === 'registered-artifact-hash-mismatch' && (String(issue.reference || '').endsWith('-input.json') || String(issue.reference || '').endsWith('-spec.json') || String(issue.reference || '').includes('/inputs/')))
  .map(issue => issue.reference);
// A user-approved visual revision deliberately moves prior outputs into the
// run-local invalidated archive. Their original operation registrations must
// be retired too; otherwise a correct revision is permanently repair-required.
const staleArchivedOutputReferences = archivedMissingReferences(runDir, preRecoveryReconciliation.issues, invalidationEvents(runDir), state);
// A changed browser capture has no proven replacement until a controlled
// capture archives the old registration before writing the new evidence.
const mismatchedRuntimeEvidenceReferences = (preRecoveryReconciliation.issues || [])
  .filter(issue => issue.type === 'registered-artifact-hash-mismatch' && String(issue.reference || '') === 'evidence/runtime-browser-capture.json')
  .map(issue => issue.reference);
const archivedArtifacts = archiveArtifacts(runDir, [...staleInputReferences, ...staleArchivedOutputReferences], 'recovery-recognized-invalidated-artifacts');
const refs = state.checkpoints || [];
const changed = [];
const latestRef = refs[refs.length - 1] || null;
if (latestRef) {
  const checkpoint = read(path.join(runDir, latestRef.path));
  for (const [name, item] of Object.entries(checkpoint.artifacts || {})) {
    const file = path.isAbsolute(item.path) ? item.path : path.join(runDir, item.path);
    if (!fs.existsSync(file)) changed.push({ name, reason: 'missing' });
    else if (hashFile(file) !== item.hash) changed.push({ name, reason: 'hash-changed' });
  }
}
const context = fs.existsSync(path.join(runDir, 'context-index.json')) ? read(path.join(runDir, 'context-index.json')) : { changed: [] };
const invalidates = new Set((context.changed || []).flatMap(item => item.invalidates || []));
if (changed.some(item => ['siteContract', 'functionalFreeze', 'stitchFreeze', 'visualBundle', 'implementationMap', 'dependencyLock'].includes(item.name)) || invalidates.has('gate2')) {
  state.gates.gate2 = { status: 'revoked', at: new Date().toISOString(), evidence: ['recovery-input-changed'] };
  state.locks.implementationAllowed = false;
  state.gates.proof = { status: 'revoked', at: new Date().toISOString(), evidence: ['upstream-gate2-revoked'] };
  state.gates.gate3 = { status: 'revoked', at: new Date().toISOString(), evidence: ['upstream-gate2-revoked'] };
  for (const artifact of ['runtimeStateMatrix', 'verificationPlan', 'verificationBundle', 'industryBenchmarkEvidence', 'evidenceProvenance']) state.artifacts[artifact] = null;
}
if (changed.length || invalidates.has('gate3')) state.gates.gate3 = { status: 'revoked', at: new Date().toISOString(), evidence: ['recovery-input-changed'] };
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
commitRunState(runDir, state, { reason: 'controlled-recovery', event: { type: 'run-recovered', changed, invalidates: [...invalidates], interruptedOperations, recoveredAgentJobs } });
appendLedgerEvent(runDir, { type: 'recovery-complete', interruptedOperations, recoveredAgentJobs, archivedArtifacts, staleInputReferences, mismatchedRuntimeEvidenceReferences, implementationSealRecovery });
const reconciliation = reconcileRun(runDir);
console.log(JSON.stringify({ checkpoint: latestRef?.path || null, changed, invalidates: [...invalidates], interruptedOperations, recoveredAgentJobs, archivedArtifacts, revisionRecovery, reconciliation, gate2: state.gates.gate2.status, gate3: state.gates.gate3.status }));
if (reconciliation.status !== 'consistent') process.exitCode = 2;
