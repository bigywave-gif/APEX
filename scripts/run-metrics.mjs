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
    let projection = 'unreadable';
    try {
      const diskState = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      const diskHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(diskState)).digest('hex')}`;
      projection = diskHash === snapshot.state_hash ? 'consistent' : 'diverged';
    } catch {}
    const start = db.prepare('SELECT created_at FROM state_snapshots ORDER BY id LIMIT 1').get()?.created_at || null;
    const rows = db.prepare('SELECT stage, agent_id, input_tokens, output_tokens, total_tokens, metadata_json FROM token_usage').all();
    const jobRows = db.prepare('SELECT status, attempt FROM agent_jobs').all();
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
      if (typeof metadata?.jobId === 'string' && Number.isInteger(metadata?.attempt) && metadata.attempt > 0) attemptUsage.push({ jobId: metadata.jobId, attempt: metadata.attempt, agentId: row.agent_id, stage: row.stage, outcome: typeof metadata.outcome === 'string' ? metadata.outcome : null, source: key, input: key === 'unknown' ? null : Number(row.input_tokens), output: key === 'unknown' ? null : Number(row.output_tokens), total: key === 'unknown' ? null : Number(row.total_tokens) });
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
    const opsDir = path.join(root, 'operations'), receipts = [], unreadable = [];
    const operationsPresent = fs.existsSync(opsDir) && fs.statSync(opsDir).isDirectory();
    if (operationsPresent) for (const name of fs.readdirSync(opsDir).filter(name => name.endsWith('.json'))) {
      try {
        const receipt = JSON.parse(fs.readFileSync(path.join(opsDir, name), 'utf8'));
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !['running', 'succeeded', 'failed'].includes(receipt.status)) throw new Error('invalid operation receipt');
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
      runId: state.runId, track: state.track, scope: state.scope, lifecycle: state.lifecycle, gate3: state.gates?.gate3?.status || 'unknown', stateSource: 'ledger-snapshot', stateProjection: projection,
      contractIntegrity, capabilities: Array.isArray(contract?.capabilities) ? [...new Set(contract.capabilities)].sort() : null,
      elapsedWallMs: elapsed, elapsedBasis: 'first-ledger-snapshot-to-passed-gate3-including-user-wait',
      operations: { receiptDirectory: operationsPresent ? 'present' : 'missing', recorded: operationsPresent ? receipts.length : null, failed: operationsPresent ? receipts.filter(x => x.status === 'failed').length : null, running: operationsPresent ? receipts.filter(x => x.status === 'running').length : null, totalDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null, durationMissing: operationsPresent ? receipts.length - durations.length : null, unreadable: operationsPresent ? unreadable.length : null, completeness: 'unverified' },
      manualInterventions: null, // No complete host/user-intervention counter is available.
      agents: { jobs: jobRows.length, retries: jobRows.reduce((n, x) => n + Math.max(0, Number(x.attempt) - 1), 0), running: jobRows.filter(x => x.status === 'running').length, deadLetters: jobRows.filter(x => x.status === 'dead-letter').length },
      tokens: { recordedTotal: Object.values(sourceTotals).some(x => x !== null) ? Object.values(sourceTotals).reduce((n, x) => n + (x ?? 0), 0) : null, sourceTotals, attribution, byStage, byAgent: [...agentTotals.values()], attemptUsage, attemptAttribution: { attributedRecords: attemptUsage.length, unattributedRecords: rows.length - attemptUsage.length }, coverage, scope: 'recorded-agent-and-independent-host-usage', completeHostUsage: false, note: 'Recorded total combines sources and is not total actual usage. Unknown and unrecorded host calls are not represented by a zero.' }
    };
  } finally { db.close(); }
}
export function compareRuns(before, after) {
  const reasons = [];
  if (before.gate3 !== 'passed' || after.gate3 !== 'passed') reasons.push('both runs need passed Gate 3');
  if (before.track !== after.track || before.scope !== after.scope) reasons.push('track or scope differs');
  if (!before.capabilities || !after.capabilities || JSON.stringify(before.capabilities) !== JSON.stringify(after.capabilities)) reasons.push('capability sets are missing or differ');
  if (before.contractIntegrity !== 'verified' || after.contractIntegrity !== 'verified') reasons.push('delivery contract is missing, unregistered, stale or unreadable');
  if (before.operations.unreadable || after.operations.unreadable) reasons.push('operation receipts are unreadable');
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
