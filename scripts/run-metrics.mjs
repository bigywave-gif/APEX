#!/usr/bin/env node
/** Read-only run metrics. Recorded Agent use is not whole-host token usage. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function readRunMetrics(runDirectory) {
  const root = fs.realpathSync(runDirectory);
  const ledgerFile = path.join(root, 'run-ledger.sqlite');
  if (!fs.existsSync(ledgerFile)) throw new Error('run ledger is missing');
  const db = new DatabaseSync(ledgerFile, { readOnly: true });
  try {
    db.exec('BEGIN');
    const snapshot = db.prepare('SELECT state_json, state_hash FROM state_snapshots ORDER BY id DESC LIMIT 1').get();
    if (!snapshot) throw new Error('run ledger has no durable state snapshot');
    const state = JSON.parse(snapshot.state_json);
    if (`sha256:${crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex')}` !== snapshot.state_hash) throw new Error('latest run ledger state snapshot is corrupt');
    let projection = 'unreadable';
    try {
      const diskState = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      const diskHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(diskState)).digest('hex')}`;
      projection = diskHash === snapshot.state_hash ? 'consistent' : 'diverged';
    } catch {}
    const firstSnapshot = db.prepare('SELECT created_at, state_hash, state_json FROM state_snapshots ORDER BY id LIMIT 1').get();
    const start = firstSnapshot?.created_at || null;
    let ledgerOrigin = null;
    try {
      const initialHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(JSON.parse(firstSnapshot.state_json))).digest('hex')}`;
      if (initialHash === firstSnapshot.state_hash && Number.isFinite(Date.parse(start))) ledgerOrigin = `sha256:${crypto.createHash('sha256').update(JSON.stringify([initialHash, start])).digest('hex')}`;
    } catch {}
    const rows = db.prepare('SELECT stage, agent_id, input_tokens, output_tokens, total_tokens, metadata_json FROM token_usage').all();
    const jobRows = db.prepare('SELECT status, attempt FROM agent_jobs').all();
    const artifactRows = db.prepare('SELECT artifact_id, reference, sha256, status FROM artifacts ORDER BY rowid').all();
    const activeArtifacts = new Map();
    for (const item of artifactRows) if (item.status !== 'archived') activeArtifacts.set(item.reference, item);
    const artifactIssues = [];
    for (const item of activeArtifacts.values()) {
      if (item.reference === 'visual-sandbox-runtime.json') continue;
      try {
        if (typeof item.reference !== 'string' || path.isAbsolute(item.reference)) throw new Error('invalid reference');
        const file = path.resolve(root, item.reference);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('outside run or not a file');
        if (`sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}` !== item.sha256) throw new Error('hash mismatch');
      } catch (error) { artifactIssues.push({ reference: item.reference, reason: error.message }); }
    }
    const knownArtifacts = new Set(artifactRows.map(item => item.artifact_id));
    for (const edge of db.prepare('SELECT parent_artifact_id, child_artifact_id FROM artifact_edges').all()) if (!knownArtifacts.has(edge.parent_artifact_id) || !knownArtifacts.has(edge.child_artifact_id)) artifactIssues.push({ reference: null, reason: 'artifact lineage is broken' });
    const artifactIntegrity = { status: artifactIssues.length ? 'inconsistent' : 'consistent', checked: [...activeArtifacts.keys()].filter(ref => ref !== 'visual-sandbox-runtime.json').length, issues: artifactIssues, note: 'Only registered, non-archived artifacts are checked; this does not prove that required delivery evidence exists or is sufficient.' };
    const coverage = { providerReported: 0, estimated: 0, unknown: 0, unverified: 0 };
    const byStage = {};
    const sourceTotals = { providerReported: null, estimated: null, unverified: null };
    const attribution = Object.fromEntries(['agent', 'independentHost', 'unattributed'].map(name => [name, { recordedTotal: null, unknownRecords: 0 }]));
    const agentTotals = new Map(), attemptUsage = [];
    for (const row of rows) {
      let metadata; try { metadata = JSON.parse(row.metadata_json || '{}'); } catch { metadata = {}; }
      const source = metadata?.usageSource;
      const key = source === 'provider-reported' ? 'providerReported' : source === 'estimated' ? 'estimated' : source === 'unknown' ? 'unknown' : 'unverified'; coverage[key]++;
      const category = metadata?.kind === 'independent-host-call' && !row.agent_id ? 'independentHost' : row.agent_id ? 'agent' : 'unattributed';
      if (key === 'unknown') attribution[category].unknownRecords++;
      else attribution[category].recordedTotal = (attribution[category].recordedTotal ?? 0) + Number(row.total_tokens);
      if (row.agent_id) {
        const agent = agentTotals.get(row.agent_id) || { agentId: row.agent_id, sourceTotals: { providerReported: null, estimated: null, unverified: null }, unknownRecords: 0 };
        if (key === 'unknown') agent.unknownRecords++;
        else agent.sourceTotals[key] = (agent.sourceTotals[key] ?? 0) + Number(row.total_tokens);
        agentTotals.set(row.agent_id, agent);
      }
      if (typeof metadata?.jobId === 'string' && Number.isInteger(metadata?.attempt) && metadata.attempt > 0) attemptUsage.push({ jobId: metadata.jobId, attempt: metadata.attempt, agentId: row.agent_id, stage: row.stage, outcome: typeof metadata.outcome === 'string' ? metadata.outcome : null, source: key, input: key === 'unknown' ? null : Number(row.input_tokens), output: key === 'unknown' ? null : Number(row.output_tokens), total: key === 'unknown' ? null : Number(row.total_tokens), overReservation: metadata.overReservation === true });
      if (key !== 'unknown') sourceTotals[key] = (sourceTotals[key] ?? 0) + Number(row.total_tokens);
      const entry = byStage[row.stage] ||= { input: null, output: null, total: null, records: 0, unknownRecords: 0 };
      entry.records++;
      if (key === 'unknown') entry.unknownRecords++;
      else {
        entry.input = (entry.input ?? 0) + Number(row.input_tokens);
        entry.output = (entry.output ?? 0) + Number(row.output_tokens);
        entry.total = (entry.total ?? 0) + Number(row.total_tokens);
      }
    }
    let runBudget = null;
    const budgetRow = db.prepare("SELECT value FROM ledger_meta WHERE key = 'run_token_budget'").get();
    if (budgetRow) {
      const config = JSON.parse(budgetRow.value);
      const recoveryReserve = config.recoveryReserve ?? 0;
      if (!Number.isSafeInteger(config.limit) || config.limit < 1 || !Number.isSafeInteger(config.verificationReserve) || config.verificationReserve < 0 || !Number.isSafeInteger(recoveryReserve) || recoveryReserve < 0 || config.verificationReserve + recoveryReserve > config.limit) throw new Error('run token budget configuration is invalid');
      const used = rows.reduce((sum, row) => sum + Number(row.total_tokens), 0);
      const reserved = Number(db.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running'").get().total);
      const verificationUsed = rows.filter(row => row.stage === 'verify').reduce((sum, row) => sum + Number(row.total_tokens), 0);
      const verificationReserved = Number(db.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running' AND stage = 'verify'").get().total);
      const recoveryUsed = rows.reduce((sum, row) => { try { const meta = JSON.parse(row.metadata_json || '{}'); return sum + (row.stage !== 'verify' && (meta.budgetRecovery === true || Number(meta.attempt) > 1) ? Number(row.total_tokens) : 0); } catch { return sum; } }, 0);
      const priorAttempt = db.prepare('SELECT 1 FROM agent_jobs WHERE agent_id = ? AND stage = ? AND job_id != ? AND attempt > 0 LIMIT 1');
      const recoveryReserved = db.prepare("SELECT job_id, agent_id, stage, attempt, payload_json, reserved_tokens FROM agent_jobs WHERE status = 'running'").all().reduce((sum, row) => { const payload = JSON.parse(row.payload_json || '{}'); const recovery = Number(row.attempt) > 1 || (payload.budgetRecovery === true && Boolean(priorAttempt.get(row.agent_id, row.stage, row.job_id))); return sum + (row.stage !== 'verify' && recovery ? Number(row.reserved_tokens) : 0); }, 0);
      const incompleteUsage = coverage.unknown > 0 || coverage.unverified > 0;
      const estimatedUsage = coverage.estimated > 0;
      const reportedAvailable = Math.max(0, config.limit - used - reserved);
      const unknownAttempts = { held: 0, unbounded: 0, attempts: 0, verificationHeld: 0, recoveryHeld: 0, identities: [] };
      let unboundedOtherUsage = 0;
      for (const row of rows) {
        let meta; try { meta = JSON.parse(row.metadata_json || '{}'); } catch { unboundedOtherUsage += 1; continue; }
        if (['provider-reported', 'estimated'].includes(meta?.usageSource)) continue;
        if (!row.agent_id || !meta?.jobId || !['unknown', 'legacy-unverified'].includes(meta.usageSource)) { unboundedOtherUsage += 1; continue; }
        unknownAttempts.attempts += 1;
        unknownAttempts.identities.push({ jobId: meta.jobId, attempt: meta.attempt, stage: row.stage });
        const remainder = Math.max(0, Number(meta.reservedTokens) - Number(row.total_tokens));
        if (Number.isSafeInteger(meta.reservedTokens) && meta.reservedTokens > 0 && Number.isSafeInteger(remainder) && Number.isSafeInteger(unknownAttempts.held + remainder)) {
          unknownAttempts.held += remainder;
          if (row.stage === 'verify') unknownAttempts.verificationHeld += remainder;
          else if (meta.budgetRecovery === true || Number(meta.attempt) > 1) unknownAttempts.recoveryHeld += remainder;
        }
        else unknownAttempts.unbounded += 1;
      }
      const admissionAvailable = unknownAttempts.unbounded || unboundedOtherUsage ? 0 : Math.max(0, reportedAvailable - unknownAttempts.held);
      const remainingVerificationReserve = Math.max(0, config.verificationReserve - verificationUsed - verificationReserved - unknownAttempts.verificationHeld);
      const remainingRecoveryReserve = Math.max(0, recoveryReserve - recoveryUsed - recoveryReserved - unknownAttempts.recoveryHeld);
      const reserveShortfall = Math.max(0, used + reserved + remainingVerificationReserve + remainingRecoveryReserve - config.limit);
      const reportedOvercommitted = used + reserved > config.limit;
      runBudget = { ...config, recoveryReserve, used, reserved, verificationUsed, verificationReserved, recoveryUsed, recoveryReserved, remainingVerificationReserve, remainingRecoveryReserve, reserveShortfall: null, reportedReserveShortfall: reserveShortfall, incompleteUsage, estimatedUsage, completeHostUsage: false, available: null, reportedAvailable, unknownAttempts, unboundedOtherUsage, admissionAvailable, overcommitted: null, reportedOvercommitted, budgetScope: 'reported-and-estimated-usage-only' };
    }
    const opsDir = path.join(root, 'operations'), receipts = [], unreadable = [];
    const operationsPresent = fs.existsSync(opsDir) && fs.statSync(opsDir).isDirectory();
    if (operationsPresent) for (const name of fs.readdirSync(opsDir).filter(name => name.endsWith('.json'))) {
      try {
        const receipt = JSON.parse(fs.readFileSync(path.join(opsDir, name), 'utf8'));
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !['running', 'succeeded', 'failed', 'interrupted'].includes(receipt.status)) throw new Error('invalid operation receipt');
        receipts.push(receipt);
      } catch { unreadable.push(name); }
    }
    const durations = receipts.map(receipt => receipt.durationMs).filter(value => Number.isFinite(value) && value >= 0);
    let contract = null, contractIntegrity = 'missing';
    if (state.artifacts?.deliveryContract) {
      try {
        const reference = state.artifacts.deliveryContract, file = path.resolve(root, reference);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error('contract outside run');
        const bytes = fs.readFileSync(file);
        const sha256 = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
        const artifact = db.prepare("SELECT sha256 FROM artifacts WHERE reference = ? AND status = 'verified' ORDER BY rowid DESC LIMIT 1").get(reference);
        if (!artifact) contractIntegrity = 'unregistered';
        else if (artifact.sha256 !== sha256) contractIntegrity = 'stale';
        else { contract = JSON.parse(bytes.toString('utf8')); contractIntegrity = 'verified'; }
      } catch { contractIntegrity = 'unreadable'; }
    }
    const finished = state.gates?.gate3?.status === 'passed' ? state.gates.gate3.at : null;
    const elapsed = start && finished && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(finished)) && Date.parse(finished) >= Date.parse(start) && Date.parse(finished) <= Date.now() ? Date.parse(finished) - Date.parse(start) : null;
    return {
      runId: state.runId, runIdentity: `sha256:${crypto.createHash('sha256').update(root).digest('hex')}`, ledgerOrigin, track: state.track, scope: state.scope, lifecycle: state.lifecycle, gate3: state.gates?.gate3?.status || 'unknown', stateSource: 'ledger-snapshot', stateProjection: projection,
      contractIntegrity, artifactIntegrity, capabilities: Array.isArray(contract?.capabilities) ? [...new Set(contract.capabilities)].sort() : null,
      elapsedWallMs: elapsed, elapsedBasis: 'first-ledger-snapshot-to-passed-gate3-including-user-wait',
      operations: { receiptDirectory: operationsPresent ? 'present' : 'missing', recorded: operationsPresent ? receipts.length : null, failed: operationsPresent ? receipts.filter(x => x.status === 'failed').length : null, interrupted: operationsPresent ? receipts.filter(x => x.status === 'interrupted').length : null, running: operationsPresent ? receipts.filter(x => x.status === 'running').length : null, totalDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null, durationMissing: operationsPresent ? receipts.length - durations.length : null, unreadable: operationsPresent ? unreadable.length : null, completeness: 'unverified' },
      manualInterventions: null, // No complete host/user-intervention counter is available.
      agents: { jobs: jobRows.length, retries: jobRows.reduce((n, x) => n + Math.max(0, Number(x.attempt) - 1), 0), running: jobRows.filter(x => x.status === 'running').length, deadLetters: jobRows.filter(x => x.status === 'dead-letter').length },
      tokens: { recordedTotal: Object.values(sourceTotals).some(x => x !== null) ? Object.values(sourceTotals).reduce((n, x) => n + (x ?? 0), 0) : null, sourceTotals, attribution, byStage, byAgent: [...agentTotals.values()], attemptUsage, attemptAttribution: { attributedRecords: attemptUsage.length, unattributedRecords: rows.length - attemptUsage.length }, coverage, runBudget, scope: 'recorded-agent-and-independent-host-usage', completeHostUsage: false, note: 'Recorded total combines sources and is not total actual usage. Unknown and unrecorded host calls are not represented by a zero.' }
    };
  } finally { db.close(); }
}
export function compareRuns(before, after) {
  const reasons = [];
  if (!before.runIdentity || !after.runIdentity) reasons.push('Run identity is missing');
  else if (before.runIdentity === after.runIdentity) reasons.push('before and after refer to the same Run');
  if (!before.ledgerOrigin || !after.ledgerOrigin) reasons.push('initial ledger identity is missing or invalid');
  else if (before.ledgerOrigin === after.ledgerOrigin && before.runIdentity !== after.runIdentity) reasons.push('Runs may be copies of the same ledger');
  if (before.gate3 !== 'passed' || after.gate3 !== 'passed') reasons.push('both runs need passed Gate 3');
  if (before.track !== after.track || before.scope !== after.scope) reasons.push('track or scope differs');
  if (!before.capabilities || !after.capabilities || JSON.stringify(before.capabilities) !== JSON.stringify(after.capabilities)) reasons.push('capability sets are missing or differ');
  if (before.contractIntegrity !== 'verified' || after.contractIntegrity !== 'verified') reasons.push('delivery contract is missing, unregistered, stale or unreadable');
  if (before.artifactIntegrity?.status !== 'consistent' || after.artifactIntegrity?.status !== 'consistent') reasons.push('registered artifact integrity is inconsistent or unverified');
  if (before.operations.unreadable || after.operations.unreadable) reasons.push('operation receipts are unreadable');
  if (before.operations.interrupted || after.operations.interrupted) reasons.push('interrupted operation outcomes require review');
  if (before.operations.running || after.operations.running || before.agents.running || after.agents.running) reasons.push('operations or Agent jobs are still running');
  if (before.stateProjection !== 'consistent' || after.stateProjection !== 'consistent') reasons.push('state projection is missing, unreadable or diverged from the durable ledger');
  const eligible = reasons.length === 0;
  const coverageKeys = ['providerReported', 'estimated', 'unknown', 'unverified'];
  const coverageAvailable = [before, after].every(run => coverageKeys.every(key => Number.isInteger(run.tokens?.coverage?.[key]) && run.tokens.coverage[key] >= 0));
  const matchingCoverage = coverageAvailable && coverageKeys.every(key => before.tokens.coverage[key] === after.tokens.coverage[key]);
  const tokenReasons = [];
  if (!coverageAvailable) tokenReasons.push('token coverage is missing or invalid');
  else {
    if (!matchingCoverage) tokenReasons.push('token measurement coverage differs');
    if (before.tokens.coverage.unknown || after.tokens.coverage.unknown) tokenReasons.push('some recorded calls have unknown usage');
    if (before.tokens.coverage.unverified || after.tokens.coverage.unverified) tokenReasons.push('some recorded usage has an unverified source');
  }
  if (!before.tokens?.completeHostUsage || !after.tokens?.completeHostUsage) tokenReasons.push('whole-host usage is not completely measured');
  const delta = (a, b) => a == null || b == null ? null : b - a;
  const partial = eligible ? {
    recordedTotalTokens: delta(before.tokens.recordedTotal, after.tokens.recordedTotal),
    recordedAgentTokens: delta(before.tokens.attribution?.agent?.recordedTotal, after.tokens.attribution?.agent?.recordedTotal),
    recordedIndependentHostTokens: delta(before.tokens.attribution?.independentHost?.recordedTotal, after.tokens.attribution?.independentHost?.recordedTotal),
    providerReportedTokens: delta(before.tokens.sourceTotals?.providerReported, after.tokens.sourceTotals?.providerReported),
    estimatedTokens: delta(before.tokens.sourceTotals?.estimated, after.tokens.sourceTotals?.estimated)
  } : null;
  const comparableTokens = eligible && tokenReasons.length === 0;
  const operationDataAvailable = [before, after].every(run => run.operations.receiptDirectory === 'present' && Number.isInteger(run.operations.failed) && run.operations.unreadable === 0);
  return { status: eligible ? 'eligible-for-review' : 'not-comparable', reasons, note: 'Matching metadata does not prove task, content, quality or host conditions are equivalent; review before drawing conclusions.', changes: eligible ? { elapsedWallMs: delta(before.elapsedWallMs, after.elapsedWallMs), recordedTotalTokens: comparableTokens ? partial.recordedTotalTokens : null, recordedAgentTokens: comparableTokens ? partial.recordedAgentTokens : null, recordedIndependentHostTokens: comparableTokens ? partial.recordedIndependentHostTokens : null, providerReportedTokens: comparableTokens ? partial.providerReportedTokens : null, estimatedTokens: comparableTokens ? partial.estimatedTokens : null, agentRetries: after.agents.retries - before.agents.retries, failedOperations: null } : null, operationAssessment: { status: 'not-comparable', reason: 'operation receipt completeness is not verified', partialRecordedFailedDelta: eligible && operationDataAvailable ? delta(before.operations.failed, after.operations.failed) : null }, tokenAssessment: { status: comparableTokens ? 'eligible-for-review' : 'not-comparable', reasons: eligible ? tokenReasons : [...reasons, ...tokenReasons], partialRecordedDeltas: partial, note: 'Partial recorded deltas are descriptive only and cannot establish a change in total host cost.' }, tokenComparisonScope: 'partial recorded Agent, independent host, and unattributed usage; not total host tokens' };
}
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'inspect' && args.length === 1) console.log(JSON.stringify(readRunMetrics(args[0]), null, 2));
    else if (command === 'compare' && args.length === 2) { const before = readRunMetrics(args[0]), after = readRunMetrics(args[1]); console.log(JSON.stringify({ before, after, comparison: compareRuns(before, after) }, null, 2)); }
    else throw new Error('usage: inspect <run-dir> | compare <before-run-dir> <after-run-dir>');
  } catch (error) { console.error(`APEX run metrics failed: ${error.message}`); process.exitCode = 1; }
}
