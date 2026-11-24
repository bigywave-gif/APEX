/**
 * Durable, run-local state ledger.
 *
 * APEX used to treat state.json as both its public projection and the only
 * source of truth.  This module keeps the projection for compatibility while
 * persisting append-only snapshots and events in SQLite first.  A crash after
 * the ledger transaction but before the projection write is therefore
 * recoverable on the next Router invocation.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { reserveProjectExternalIntent, releaseUnsubmittedProjectIntent, updateProjectExternalObservation } from './project-external-registry.mjs';
import { visualRevisionBindingCurrent } from './visual-revision-binding.mjs';

const STATE_FILE = 'state.json';
const LEDGER_FILE = 'run-ledger.sqlite';
const LEDGER_MARKER = 'ledger-established.json';
// A freshly claimed job is normal execution, not corruption.  Only an
// expired lease is eligible for automatic recovery.
export const AGENT_JOB_LEASE_MS = 15 * 60 * 1000;
const now = () => new Date().toISOString();
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const statePath = runDir => path.join(runDir, STATE_FILE);
const ledgerPath = runDir => path.join(runDir, LEDGER_FILE);
const stateHash = state => hash(JSON.stringify(state));

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}

function open(runDir) {
  fs.mkdirSync(runDir, { recursive: true });
  if (!fs.existsSync(ledgerPath(runDir)) && ['ledger-integrity-incident.json', LEDGER_MARKER].some(name => fs.existsSync(path.join(runDir, name)))) throw new Error('run ledger is missing after it was established or a monitoring incident; restore and investigate the original ledger before recovery');
  const database = new DatabaseSync(ledgerPath(runDir));
  database.exec('PRAGMA busy_timeout = 5000;');
  // Reasserting journal_mode while another connection writes can fail even
  // when the database is already in WAL mode. Switch only when necessary.
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') database.exec('PRAGMA journal_mode = WAL;');
      break;
    } catch (error) {
      if (attempt >= 49 || !/locked|busy/i.test(error.message)) { database.close(); throw error; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  database.exec('PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS state_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision INTEGER NOT NULL,
      state_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      state_json TEXT NOT NULL,
      UNIQUE(revision, state_hash)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      revision INTEGER NOT NULL,
      state_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY,
      reference TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifact_edges (
      parent_artifact_id TEXT NOT NULL,
      child_artifact_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(parent_artifact_id, child_artifact_id, relation),
      FOREIGN KEY(parent_artifact_id) REFERENCES artifacts(artifact_id),
      FOREIGN KEY(child_artifact_id) REFERENCES artifacts(artifact_id)
    );
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      vocation TEXT NOT NULL,
      stage TEXT NOT NULL,
      capability_version TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      skill_bindings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_job_id TEXT,
      FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
    );
    CREATE TABLE IF NOT EXISTS agent_jobs (
      job_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      claim_key TEXT,
      reserved_tokens INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
    );
    CREATE TABLE IF NOT EXISTS agent_claim_keys (job_id TEXT NOT NULL, claim_key TEXT NOT NULL, attempt INTEGER NOT NULL, PRIMARY KEY(job_id, claim_key), FOREIGN KEY(job_id) REFERENCES agent_jobs(job_id));
    CREATE INDEX IF NOT EXISTS agent_jobs_runnable ON agent_jobs(status, available_at, created_at);
    CREATE TABLE IF NOT EXISTS dead_letters (
      job_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trace_spans (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      attributes_json TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS trace_spans_trace ON trace_spans(trace_id, started_at);
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage TEXT NOT NULL,
      agent_id TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS token_observations (
      observation_key TEXT PRIMARY KEY,
      usage_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL
    );
  `);
  // Existing runs predate lease fencing. Serialize and recheck the additive migration.
  if (['lease_token', 'lease_expires_at', 'claim_key', 'reserved_tokens'].some(name => !database.prepare('PRAGMA table_info(agent_jobs)').all().some(column => column.name === name))) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const columns = new Set(database.prepare('PRAGMA table_info(agent_jobs)').all().map(column => column.name));
      if (!columns.has('lease_token')) database.exec('ALTER TABLE agent_jobs ADD COLUMN lease_token TEXT');
      if (!columns.has('lease_expires_at')) database.exec('ALTER TABLE agent_jobs ADD COLUMN lease_expires_at TEXT');
      if (!columns.has('claim_key')) database.exec('ALTER TABLE agent_jobs ADD COLUMN claim_key TEXT');
      if (!columns.has('reserved_tokens')) database.exec('ALTER TABLE agent_jobs ADD COLUMN reserved_tokens INTEGER NOT NULL DEFAULT 0');
      database.exec('COMMIT');
    } catch (error) { try { database.exec('ROLLBACK'); } catch {} database.close(); throw error; }
  }
  return database;
}

function latestSnapshot(database) {
  return database.prepare('SELECT revision, state_hash, state_json, created_at FROM state_snapshots ORDER BY id DESC LIMIT 1').get();
}

function parseState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function appendSnapshot(database, state, reason) {
  const serialized = JSON.stringify(state);
  database.prepare('INSERT OR IGNORE INTO state_snapshots (revision, state_hash, reason, created_at, state_json) VALUES (?, ?, ?, ?, ?)')
    .run(Number(state.revision || 0), hash(serialized), reason, now(), serialized);
}
function ensureLedgerMarker(runDir) {
  const marker = path.join(runDir, LEDGER_MARKER);
  try { fs.writeFileSync(marker, '{"schemaVersion":"1.0","kind":"established-ledger"}\n', { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export function initializeLedger(runDir, state, reason = 'run-initialized') {
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const currentSnapshot = latestSnapshot(database);
    if (currentSnapshot && JSON.parse(currentSnapshot.state_json).lifecycle === 'cancelled' && state.lifecycle !== 'cancelled') throw new Error('cannot import an active state to a cancelled run');
    if (!currentSnapshot && reason === 'run-initialized') database.prepare('INSERT OR REPLACE INTO ledger_meta (key, value) VALUES (?, ?)').run('projectionPolicy', 'ledger-authoritative');
    appendSnapshot(database, state, reason);
    database.prepare('INSERT OR REPLACE INTO ledger_meta (key, value) VALUES (?, ?)').run('schemaVersion', '1.0');
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
  ensureLedgerMarker(runDir);
}

export function commitRunState(runDir, state, { reason = 'state-transition', event = null, checkpoint = null, expectedStateHash = null } = {}) {
  const database = open(runDir);
  const fingerprint = hash(JSON.stringify(state));
  try {
    database.exec('BEGIN IMMEDIATE');
    const currentSnapshot = latestSnapshot(database);
    if (currentSnapshot && JSON.parse(currentSnapshot.state_json).lifecycle === 'cancelled' && state.lifecycle !== 'cancelled') throw new Error('cannot commit an active state to a cancelled run');
    if (expectedStateHash) {
      const latest = latestSnapshot(database);
      const projected = parseState(statePath(runDir));
      if (!latest || latest.state_hash !== expectedStateHash || !projected || stateHash(projected) !== expectedStateHash) throw new Error('run state changed before atomic commit');
    }
    appendSnapshot(database, state, reason);
    if (event) database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)')
      .run(String(event.type || 'state-event'), now(), JSON.stringify(event));
    if (checkpoint) database.prepare('INSERT INTO checkpoints (label, revision, state_hash, created_at, state_json) VALUES (?, ?, ?, ?, ?)')
      .run(String(checkpoint), Number(state.revision || 0), fingerprint, now(), JSON.stringify(state));
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
  // Serialize projection writes with state commits and always project the
  // latest snapshot, even when another writer committed after this one.
  const projectionDb = open(runDir);
  try {
    projectionDb.exec('BEGIN IMMEDIATE');
    const latest = latestSnapshot(projectionDb);
    atomicWrite(statePath(runDir), `${JSON.stringify(JSON.parse(latest.state_json), null, 2)}\n`);
    projectionDb.exec('COMMIT');
  } catch (error) {
    try { projectionDb.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { projectionDb.close(); }
  return { revision: Number(state.revision || 0), stateHash: fingerprint };
}

export function runCancellationRequested(runDir, { busyTimeoutMs = 5000, requireLedger = false } = {}) {
  const file = ledgerPath(runDir);
  if (!fs.existsSync(file)) { if (requireLedger) throw new Error('run ledger is unavailable for cancellation monitoring'); return false; }
  const database = new DatabaseSync(file, { readOnly: true });
  try { database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.min(5000, Math.trunc(busyTimeoutMs) || 0))}`); const snapshot = latestSnapshot(database); if (!snapshot && requireLedger) throw new Error('run ledger has no cancellation state'); return Boolean(snapshot && JSON.parse(snapshot.state_json).lifecycle === 'cancelled'); }
  finally { database.close(); }
}

export function fenceRunCancellation(runDir, sessionId, reason) {
  const database = open(runDir), timestamp = now();
  const operations = path.join(runDir, 'operations'), operationReceipts = [];
  try {
    if (fs.existsSync(operations) && fs.lstatSync(operations).isDirectory()) for (const entry of fs.readdirSync(operations, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      let digest = null;
      try {
        const bytes = fs.readFileSync(path.join(operations, entry.name)); digest = hash(bytes);
        const receipt = JSON.parse(bytes.toString('utf8'));
        operationReceipts.push({ name: entry.name, sha256: digest, action: receipt.action || null, script: receipt.script || null, status: receipt.status || null, startedAt: receipt.startedAt || null, finishedAt: receipt.finishedAt || null, exitCode: receipt.exitCode ?? null, inputFileHashes: receipt.inputFileHashes || {}, outputFileHashes: receipt.outputFileHashes || {} });
      } catch { operationReceipts.push({ name: entry.name, sha256: digest, status: 'unreadable' }); }
    }
  } catch (error) { operationReceipts.push({ status: 'scan-failed', reason: error.code || 'read-error' }); }
  let cancelledJobs;
  try {
    database.exec('BEGIN IMMEDIATE');
    const latest = latestSnapshot(database);
    if (!latest) throw new Error('cannot cancel a run without a durable state');
    const state = JSON.parse(latest.state_json);
    if (state.lifecycle === 'cancelled') { database.exec('COMMIT'); return { alreadyCancelled: true }; }
    database.prepare("UPDATE artifacts SET status = 'archived' WHERE status != 'archived'").run();
    cancelledJobs = database.prepare("SELECT job_id, agent_id, stage, status, attempt FROM agent_jobs WHERE status IN ('queued', 'running')").all();
    const runningJobs = database.prepare("SELECT * FROM agent_jobs WHERE status = 'running'").all();
    for (const job of runningJobs) recordSettledAttemptUsage(database, job, null, 'cancelled', timestamp);
    database.prepare("UPDATE agent_jobs SET status = 'cancelled', finished_at = ?, last_error = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE status IN ('queued', 'running')").run(timestamp, 'run cancelled');
    database.prepare("UPDATE agent_sessions SET status = 'cancelled', updated_at = ? WHERE status IN ('ready', 'working')").run(timestamp);
    database.prepare("UPDATE agents SET status = 'cancelled', updated_at = ? WHERE status = 'ready'").run(timestamp);
    state.lifecycle = 'cancelled'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = timestamp;
    state.cancellation = { at: timestamp, reason, sessionId, temporaryArtifactsReclaimed: false };
    appendSnapshot(database, state, 'run-cancellation-fenced');
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('run-cancellation-fenced', timestamp, JSON.stringify({ sessionId, reason, jobs: cancelledJobs }));
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('cancelled-operation-receipts-retained', timestamp, JSON.stringify({ receipts: operationReceipts }));
    database.exec('COMMIT');
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
  const projection = open(runDir);
  try {
    projection.exec('BEGIN IMMEDIATE');
    atomicWrite(statePath(runDir), `${JSON.stringify(JSON.parse(latestSnapshot(projection).state_json), null, 2)}\n`);
    projection.exec('COMMIT');
  } catch (error) { try { projection.exec('ROLLBACK'); } catch {} throw error; } finally { projection.close(); }
  return { alreadyCancelled: false, cancelledJobs };
}

function externalIntentsFromDatabase(database) {
  const intents = new Map();
  for (const row of database.prepare("SELECT event_type, payload_json FROM events WHERE event_type IN ('external-submission-intent', 'external-submission-observation') ORDER BY id").all()) {
    let value; try { value = JSON.parse(row.payload_json); } catch { continue; }
    if (!value?.intentId) continue;
    if (row.event_type === 'external-submission-intent') intents.set(value.intentId, value);
    else if (intents.has(value.intentId)) intents.set(value.intentId, { ...intents.get(value.intentId), ...value });
  }
  return [...intents.values()];
}
function assertExternalIntentAllowed(existing, intent) {
  existing = existing.filter(item => item.provider === intent.provider);
  if (existing.some(item => item.intentId === intent.intentId)) throw new Error('external submission intent already exists');
  if (existing.some(item => item.operation !== 'upload' && !['ready', 'not-submitted'].includes(item.status))) throw new Error('an unresolved external generation already exists');
  const uploads = existing.filter(item => item.operation === 'upload' && !['consumed', 'not-submitted'].includes(item.status));
  if (intent.operation === 'upload' && uploads.length) throw new Error('an unresolved external upload already exists');
  if (intent.operation !== 'upload' && uploads.length && (uploads.length !== 1 || uploads[0].intentId !== intent.uploadIntentId || uploads[0].status !== 'uploaded')) throw new Error('external generation must bind its completed upload');
}
export function recordExternalSubmissionIntent(runDir, intent) {
  if (!intent?.intentId || intent.provider !== 'stitch' || !intent.imageHash || !intent.promptHash) throw new Error('external submission intent is incomplete');
  if (runCancellationRequested(runDir)) throw new Error('cannot submit an external job for a cancelled run');
  assertExternalIntentAllowed(externalSubmissionIntents(runDir), intent);
  reserveProjectExternalIntent(runDir, intent);
  let database;
  try {
    database = open(runDir); const timestamp = now();
    database.exec('BEGIN IMMEDIATE');
    const snapshot = latestSnapshot(database);
    if (!snapshot || JSON.parse(snapshot.state_json).lifecycle === 'cancelled') throw new Error('cannot submit an external job for a cancelled run');
    assertExternalIntentAllowed(externalIntentsFromDatabase(database), intent);
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('external-submission-intent', timestamp, JSON.stringify({ ...intent, status: 'submission-uncertain', at: timestamp }));
    database.exec('COMMIT');
  } catch (error) {
    try { database?.exec('ROLLBACK'); } catch {}
    try { releaseUnsubmittedProjectIntent(runDir, intent.intentId); } catch (releaseError) { error.message += `; project reservation remains unresolved: ${releaseError.message}`; }
    throw error;
  } finally { database?.close(); }
}
export function externalSubmissionIntents(runDir) {
  const database = open(runDir);
  try { return externalIntentsFromDatabase(database); }
  finally { database.close(); }
}

export function recordExternalSubmissionObservation(runDir, event) {
  if (!event?.intentId || !event?.status) throw new Error('external submission observation is incomplete');
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const current = externalIntentsFromDatabase(database).find(item => item.intentId === event.intentId);
    if (!current) throw new Error('external submission intent is missing');
    const transitions = current.operation === 'upload'
      ? { 'submission-uncertain': ['submission-uncertain', 'uploaded', 'not-submitted'], uploaded: ['uploaded', 'consumed'], consumed: ['consumed'], 'not-submitted': ['not-submitted'] }
      : { 'submission-uncertain': ['submission-uncertain', 'submitted', 'ready', 'not-submitted'], submitted: ['submitted', 'ready'], ready: ['ready'], 'not-submitted': ['not-submitted'] };
    if (!transitions[current.status]?.includes(event.status)) throw new Error(`invalid external submission transition: ${current.status} to ${event.status}`);
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('external-submission-observation', now(), JSON.stringify({ ...event, type: 'external-submission-observation' }));
    database.exec('COMMIT');
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
  updateProjectExternalObservation(runDir, event);
}

export function appendLedgerEvent(runDir, event) {
  const database = open(runDir);
  try {
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)')
      .run(String(event.type || 'event'), now(), JSON.stringify(event));
  } finally { database.close(); }
}

export function invalidationEvents(runDir) {
  const database = open(runDir);
  try {
    return database.prepare("SELECT created_at, payload_json FROM events WHERE event_type IN ('visual-intermediates-invalidated', 'role-advisories-invalidated') ORDER BY id").all().map(row => ({ ...parseJson(row.payload_json), recordedAt: row.created_at }));
  } finally { database.close(); }
}

export function stitchSealRecoveryRecord(runDir, reference) {
  const database = open(runDir);
  try {
    return database.prepare("SELECT payload_json FROM events WHERE event_type = 'stitch-machine-seal-committed' ORDER BY id DESC").all()
      .map(row => parseJson(row.payload_json)).find(event => event?.reference === reference) || null;
  } finally { database.close(); }
}

export function revisionInvalidationEvents(runDir, transactionId) {
  const database = open(runDir);
  try {
    return database.prepare("SELECT event_type, payload_json FROM events WHERE event_type IN ('visual-intermediates-invalidation-started', 'visual-intermediates-invalidated', 'role-advisories-invalidation-started', 'role-advisories-invalidated') ORDER BY id").all().map(row => ({ ...parseJson(row.payload_json), type: row.event_type })).filter(event => event.transactionId === transactionId);
  } finally { database.close(); }
}

function pendingRevisionsFromDatabase(database) {
    const rows = database.prepare("SELECT event_type, payload_json FROM events WHERE event_type IN ('prompt-revision-transaction-started', 'prompt-revision-replay-claimed', 'prompt-revision-transaction-completed') ORDER BY id").all();
    const pending = new Map(), seen = new Set();
    for (const row of rows) {
      const event = parseJson(row.payload_json);
      if (!event?.transactionId) throw new Error('revision transaction event is missing its identity');
      if (row.event_type === 'prompt-revision-transaction-started') {
        if (seen.has(event.transactionId)) throw new Error('duplicate revision transaction identity');
        seen.add(event.transactionId); pending.set(event.transactionId, event);
      } else if (row.event_type === 'prompt-revision-replay-claimed') {
        if (!pending.has(event.transactionId)) throw new Error('revision replay claim has no active transaction');
        const previous = pending.get(event.transactionId);
        pending.set(event.transactionId, { ...previous, ownerPid: event.ownerPid, ownerHost: event.ownerHost, replayClaimId: event.claimId, replayAttempts: Number(previous.replayAttempts || 0) + 1 });
      } else {
        if (!pending.has(event.transactionId)) throw new Error('revision completion has no active transaction');
        pending.delete(event.transactionId);
      }
    }
    return [...pending.values()];
}
export function claimRevisionReplay(runDir, transactionId, ownerPid = process.pid) {
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const transaction = pendingRevisionsFromDatabase(database).find(item => item.transactionId === transactionId);
    if (!transaction || transaction.protocol !== 2) throw new Error('revision transaction lacks replayable provenance');
    if (Number(transaction.replayAttempts || 0) >= 3) throw new Error('revision replay attempt limit reached; investigate before further recovery');
    if (transaction.ownerHost !== os.hostname() || !Number.isSafeInteger(transaction.ownerPid) || transaction.ownerPid <= 0) throw new Error('revision owner cannot be verified locally');
    try { process.kill(transaction.ownerPid, 0); throw new Error('revision owner may still be running'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const snapshot = latestSnapshot(database);
    if (!snapshot || snapshot.state_hash !== transaction.baseStateHash || Number(snapshot.revision) !== transaction.stateRevision || JSON.parse(snapshot.state_json).lifecycle === 'cancelled') throw new Error('revision base state changed; replay requires investigation');
    const claimId = crypto.randomUUID();
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('prompt-revision-replay-claimed', now(), JSON.stringify({ type: 'prompt-revision-replay-claimed', transactionId, claimId, ownerPid, ownerHost: os.hostname() }));
    database.exec('COMMIT'); return { ...transaction, ownerPid, ownerHost: os.hostname(), replayClaimId: claimId };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function pendingRevisionTransactions(runDir) {
  const database = open(runDir);
  try { return pendingRevisionsFromDatabase(database); } finally { database.close(); }
}
export function beginRevisionTransaction(runDir, event) {
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    if (pendingRevisionsFromDatabase(database).length) throw new Error('an earlier prompt revision must be recovered before another revision');
    const snapshot = latestSnapshot(database), state = JSON.parse(snapshot?.state_json || '{}');
    if (state.lifecycle === 'cancelled') throw new Error('cannot revise a cancelled run');
    if (!snapshot || Number(snapshot.revision) !== event.stateRevision) throw new Error('revision base state changed before transaction began');
    if (event.baseStateHash && event.baseStateHash !== snapshot.state_hash) throw new Error('revision base state hash changed before transaction began');
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('prompt-revision-transaction-started', now(), JSON.stringify({ ...event, baseStateHash: snapshot.state_hash }));
    database.exec('COMMIT');
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}

export function finalizeCommittedRevision(runDir, transactionId) {
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const pending = pendingRevisionsFromDatabase(database).find(item => item.transactionId === transactionId);
    if (!pending) {
      const completed = database.prepare("SELECT payload_json FROM events WHERE event_type = 'prompt-revision-transaction-completed'").all().some(row => parseJson(row.payload_json)?.transactionId === transactionId);
      if (!completed) throw new Error('revision transaction is not pending');
      database.exec('COMMIT'); return { status: 'already-completed', transactionId };
    }
    const records = database.prepare("SELECT payload_json FROM events WHERE event_type = 'prompt-revision-state-committed' ORDER BY id").all().map(row => parseJson(row.payload_json)).filter(item => item?.transactionId === transactionId);
    if (!records.length) { database.exec('COMMIT'); return { status: 'state-not-committed', transactionId }; }
    if (records.length !== 1) throw new Error('revision state commit is ambiguous');
    const committed = records[0], revision = committed.revision, snapshot = latestSnapshot(database);
    if (!revision || revision.transactionId !== transactionId || revision.sessionId !== pending.sessionId || revision.checkpoint !== pending.checkpoint || revision.impact !== pending.impact || revision.reason !== pending.reason || revision.stateRevision !== Number(snapshot?.revision) || committed.stateHash !== snapshot?.state_hash) throw new Error('revision state commit does not match its original request and current state');
    const file = path.join(runDir, 'prompt-revisions.ndjson');
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || !fs.realpathSync(file).startsWith(`${fs.realpathSync(runDir)}${path.sep}`))) throw new Error('revision log must be a Run-local regular file');
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    let entries;
    try { entries = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch { throw new Error('revision log is unreadable; preserve it for investigation'); }
    const matching = entries.filter(entry => entry.transactionId === transactionId);
    if (matching.length > 1 || (matching.length && JSON.stringify(matching[0]) !== JSON.stringify(revision))) throw new Error('revision log conflicts with the committed transaction');
    if (!matching.length) atomicWrite(file, `${content}${content && !content.endsWith('\n') ? '\n' : ''}${JSON.stringify(revision)}\n`);
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('prompt-revision-transaction-completed', now(), JSON.stringify({ type: 'prompt-revision-transaction-completed', transactionId, at: now(), stateRevision: revision.stateRevision }));
    database.exec('COMMIT'); return { status: 'completed', transactionId, recoveredLog: !matching.length };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}

export function stitchAdaptationSkillLoads(runDir) {
  const database = open(runDir);
  try { return database.prepare("SELECT payload_json FROM events WHERE event_type = 'stitch-adaptation-skill-loaded' ORDER BY id").all().map(row => parseJson(row.payload_json)); }
  finally { database.close(); }
}

export function requiredSkillLoads(runDir, jobId, attempt) {
  const database = open(runDir);
  try {
    return database.prepare("SELECT payload_json FROM events WHERE event_type = 'agent-required-skill-loaded' ORDER BY id").all()
      .map(row => parseJson(row.payload_json)).filter(event => event?.jobId === jobId && event?.attempt === attempt);
  } finally { database.close(); }
}

export function visualSkillLoads(runDir, jobId, attempt) {
  const database = open(runDir);
  try {
    return database.prepare("SELECT payload_json FROM events WHERE event_type IN ('agent-visual-skill-loaded', 'agent-skill-loaded') ORDER BY id").all()
      .map(row => parseJson(row.payload_json)).filter(event => event?.jobId === jobId && event?.attempt === attempt);
  } finally { database.close(); }
}

export function recordArtifact(runDir, { artifactId, reference, sha256, status = 'verified', metadata = {}, parentArtifactIds = [] }) {
  if (!artifactId || !reference || !sha256) throw new Error('artifactId, reference, and sha256 are required');
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const currentSnapshot = latestSnapshot(database);
    if (currentSnapshot && JSON.parse(currentSnapshot.state_json).lifecycle === 'cancelled') throw new Error('cannot register an artifact for a cancelled run');
    const existing = database.prepare('SELECT reference, sha256, status FROM artifacts WHERE artifact_id = ?').get(artifactId);
    if (existing && (existing.reference !== reference || existing.sha256 !== sha256 || existing.status !== status)) throw new Error(`artifact identity conflict: ${artifactId}`);
    if (!existing) database.prepare('INSERT INTO artifacts (artifact_id, reference, sha256, status, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(artifactId, reference, sha256, status, now(), JSON.stringify(metadata));
    for (const parentArtifactId of parentArtifactIds) {
      if (parentArtifactId === artifactId) throw new Error(`artifact cannot depend on itself: ${artifactId}`);
      if (!database.prepare('SELECT artifact_id FROM artifacts WHERE artifact_id = ?').get(parentArtifactId)) throw new Error(`artifact dependency does not exist: ${parentArtifactId}`);
      database.prepare('INSERT OR IGNORE INTO artifact_edges (parent_artifact_id, child_artifact_id, relation, created_at) VALUES (?, ?, ?, ?)').run(parentArtifactId, artifactId, 'derived-from', now());
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
}

// Archived artifacts remain in the ledger and keep their lineage edges, but
// are no longer the current materialization for a reference. This is needed
// when an authorized repair preserves stale evidence under invalidated/.
export function archiveArtifacts(runDir, references, reason = 'superseded-by-controlled-repair', { expectedHashes = null, onlyStatus = null } = {}) {
  const unique = [...new Set((references || []).filter(Boolean))];
  if (!unique.length) return 0;
  if (onlyStatus !== null && onlyStatus !== 'input') throw new Error('unsupported restricted archival status');
  const database = open(runDir);
  let changes = 0;
  try {
    database.exec('BEGIN IMMEDIATE');
    const statement = database.prepare(`UPDATE artifacts SET status = 'archived', metadata_json = ? WHERE reference = ? AND ${onlyStatus === 'input' ? "status = 'input'" : "status != 'archived'"}`);
    for (const reference of unique) {
      if (expectedHashes && Object.hasOwn(expectedHashes, reference)) {
        const current = database.prepare("SELECT sha256 FROM artifacts WHERE reference = ? AND status != 'archived' ORDER BY rowid DESC LIMIT 1").get(reference);
        if (current && current.sha256 !== expectedHashes[reference]) throw new Error(`artifact changed before archival: ${reference}`);
      }
      changes += statement.run(JSON.stringify({ archivedAt: now(), reason }), reference).changes;
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
  if (changes) appendLedgerEvent(runDir, { type: 'artifacts-archived', references: unique, reason, changes });
  return changes;
}

const requireNonEmpty = (value, name) => { if (!value || typeof value !== 'string') throw new Error(`${name} is required`); };
const parseJson = value => value ? JSON.parse(value) : null;
export function registerAgent(runDir, { agentId, vocation, stage, capabilityVersion = '1.0', metadata = {} }) {
  requireNonEmpty(agentId, 'agentId'); requireNonEmpty(vocation, 'vocation'); requireNonEmpty(stage, 'stage');
  const database = open(runDir), timestamp = now();
  try {
    database.exec('BEGIN IMMEDIATE');
    if (JSON.parse(latestSnapshot(database)?.state_json || '{}').lifecycle === 'cancelled') throw new Error('cannot register an Agent for a cancelled run');
    const active = database.prepare("SELECT 1 FROM agent_jobs WHERE agent_id = ? AND status IN ('queued', 'running')").get(agentId);
    if (active) {
      const existing = database.prepare('SELECT vocation, stage, capability_version, metadata_json FROM agents WHERE agent_id = ?').get(agentId);
      const session = database.prepare('SELECT session_id, context_hash FROM agent_sessions WHERE agent_id = ?').get(agentId);
      if (!existing || !session || existing.vocation !== vocation || existing.stage !== stage || existing.capability_version !== capabilityVersion || existing.metadata_json !== JSON.stringify(metadata)) throw new Error(`cannot change an Agent registration while its job is queued or running: ${agentId}`);
      database.exec('COMMIT');
      return { agentId, sessionId: session.session_id, contextHash: session.context_hash };
    }
    database.prepare("INSERT INTO agents (agent_id, vocation, stage, capability_version, status, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET vocation = excluded.vocation, stage = excluded.stage, capability_version = excluded.capability_version, status = 'ready', updated_at = excluded.updated_at, metadata_json = excluded.metadata_json")
      .run(agentId, vocation, stage, capabilityVersion, timestamp, timestamp, JSON.stringify(metadata));
    const sessionId = metadata.sessionId || `agent-${hash(`${agentId}:${capabilityVersion}`).slice('sha256:'.length, 'sha256:'.length + 24)}`;
    const contextHash = metadata.contextHash || hash(JSON.stringify({ agentId, stage, standards: metadata.standards || [], inputs: metadata.inputs || [], outputs: metadata.outputs || [] }));
    const skillBindings = metadata.skillBindings || [];
    database.prepare("INSERT INTO agent_sessions (session_id, agent_id, status, context_hash, skill_bindings_json, created_at, updated_at) VALUES (?, ?, 'ready', ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET status = 'ready', context_hash = excluded.context_hash, skill_bindings_json = excluded.skill_bindings_json, updated_at = excluded.updated_at")
      .run(sessionId, agentId, contextHash, JSON.stringify(skillBindings), timestamp, timestamp);
    database.exec('COMMIT');
    return { agentId, sessionId, contextHash };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function enqueueAgentJob(runDir, { jobId = crypto.randomUUID(), agentId, stage, inputHash, payload = {}, maxAttempts = 3 }) {
  requireNonEmpty(agentId, 'agentId'); requireNonEmpty(stage, 'stage'); requireNonEmpty(inputHash, 'inputHash');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('maxAttempts must be an integer from 1 to 5');
  const database = open(runDir), timestamp = now();
  try {
    database.exec('BEGIN IMMEDIATE');
    if (JSON.parse(latestSnapshot(database)?.state_json || '{}').lifecycle === 'cancelled') throw new Error('cannot enqueue an Agent job for a cancelled run');
    const agent = database.prepare('SELECT agent_id, stage, status FROM agents WHERE agent_id = ?').get(agentId);
    if (!agent) throw new Error(`agent is not ready: ${agentId}`);
    const session = database.prepare('SELECT session_id, status FROM agent_sessions WHERE agent_id = ?').get(agentId);
    if (!session) throw new Error(`agent session is not ready: ${agentId}`);
    const normalizedPayload = { ...payload, agentSessionId: payload.agentSessionId || session.session_id };
    if (normalizedPayload.agentSessionId !== session.session_id) throw new Error(`agent job session does not match agent: ${agentId}`);
    const existing = database.prepare('SELECT agent_id, stage, status, input_hash, payload_json, max_attempts, available_at FROM agent_jobs WHERE job_id = ?').get(jobId);
    if (existing) {
      if (existing.agent_id !== agentId || existing.stage !== stage || existing.input_hash !== inputHash || existing.payload_json !== JSON.stringify(normalizedPayload) || Number(existing.max_attempts) !== maxAttempts) throw new Error(`agent job identity conflict: ${jobId}`);
      database.exec('COMMIT');
      return { jobId, status: existing.status, availableAt: existing.available_at, idempotent: true };
    }
    if (agent.stage !== stage) throw new Error(`agent job stage does not match its registration: ${agentId}/${stage}/${agent.stage}`);
    if (agent.status !== 'ready') throw new Error(`agent is not ready: ${agentId}`);
    if (session.status !== 'ready') throw new Error(`agent session is not ready: ${agentId}`);
    database.prepare('INSERT INTO agent_jobs (job_id, agent_id, stage, status, attempt, max_attempts, available_at, input_hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, agentId, stage, 'queued', 0, maxAttempts, timestamp, inputHash, JSON.stringify(normalizedPayload), timestamp);
    database.exec('COMMIT');
    return { jobId, status: 'queued', availableAt: timestamp };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function supersedeQueuedAgentJobs(runDir, stage, jobIds) {
  requireNonEmpty(stage, 'stage');
  if (!Array.isArray(jobIds) || !jobIds.length || new Set(jobIds).size !== jobIds.length || jobIds.some(id => typeof id !== 'string' || !id)) throw new Error('role repair needs unique durable job IDs');
  const database = open(runDir), timestamp = now();
  try {
    database.exec('BEGIN IMMEDIATE');
    const jobs = jobIds.map(id => database.prepare('SELECT job_id, stage, status FROM agent_jobs WHERE job_id = ?').get(id));
    if (jobs.some(job => !job || job.stage !== stage)) throw new Error('role repair job binding is missing or belongs to another stage');
    const running = jobs.filter(job => job.status === 'running');
    if (running.length) throw new Error(`role repair must wait for running jobs or recover expired leases: ${running.map(job => job.job_id).join(', ')}`);
    const queued = jobs.filter(job => job.status === 'queued');
    for (const job of queued) database.prepare("UPDATE agent_jobs SET status = 'cancelled', finished_at = ?, last_error = ?, reserved_tokens = 0 WHERE job_id = ? AND status = 'queued'").run(timestamp, 'superseded by role input repair', job.job_id);
    if (queued.length) database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('role-jobs-superseded', timestamp, JSON.stringify({ stage, jobIds: queued.map(job => job.job_id) }));
    database.exec('COMMIT');
    return queued.map(job => job.job_id);
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
function stageUsageIncomplete(database, stage) {
  return database.prepare('SELECT metadata_json FROM token_usage WHERE stage = ?').all(stage).some(row => {
    try { return !['provider-reported', 'estimated'].includes(JSON.parse(row.metadata_json)?.usageSource); } catch { return true; }
  });
}
function runBudgetConfig(database) {
  const row = database.prepare("SELECT value FROM ledger_meta WHERE key = 'run_token_budget'").get();
  if (!row) return null;
  const config = JSON.parse(row.value);
  const recoveryReserve = config.recoveryReserve ?? 0;
  if (!Number.isSafeInteger(config.limit) || config.limit < 1 || !Number.isSafeInteger(config.verificationReserve) || config.verificationReserve < 0 || !Number.isSafeInteger(recoveryReserve) || recoveryReserve < 0 || config.verificationReserve + recoveryReserve > config.limit) throw new Error('run token budget configuration is invalid');
  return { limit: config.limit, verificationReserve: config.verificationReserve, recoveryReserve };
}
function isRecoveryJob(database, job) {
  if (Number(job.attempt) > (job.status === 'running' ? 1 : 0)) return true;
  if (parseJson(job.payload_json)?.budgetRecovery !== true) return false;
  return Boolean(database.prepare('SELECT 1 FROM agent_jobs WHERE agent_id = ? AND stage = ? AND job_id != ? AND attempt > 0 LIMIT 1').get(job.agent_id, job.stage, job.job_id));
}
function unknownAttemptReservations(database, stage = null) {
  const rows = stage ? database.prepare('SELECT stage, total_tokens, metadata_json FROM token_usage WHERE agent_id IS NOT NULL AND stage = ?').all(stage) : database.prepare('SELECT stage, total_tokens, metadata_json FROM token_usage WHERE agent_id IS NOT NULL').all();
  let held = 0, unbounded = 0, attempts = 0, verificationHeld = 0, recoveryHeld = 0;
  const identities = [];
  for (const row of rows) {
    const meta = parseJson(row.metadata_json);
    if (!meta?.jobId || !['unknown', 'legacy-unverified'].includes(meta.usageSource)) continue;
    attempts += 1;
    identities.push({ jobId: meta.jobId, attempt: meta.attempt, stage: row.stage });
    const remainder = Math.max(0, Number(meta.reservedTokens) - Number(row.total_tokens));
    if (Number.isSafeInteger(meta.reservedTokens) && meta.reservedTokens > 0 && Number.isSafeInteger(remainder) && Number.isSafeInteger(held + remainder)) {
      held += remainder;
      if (row.stage === 'verify') verificationHeld += remainder;
      else if (meta.budgetRecovery === true || Number(meta.attempt) > 1) recoveryHeld += remainder;
    }
    else unbounded += 1;
  }
  return { held, unbounded, attempts, verificationHeld, recoveryHeld, identities };
}
function unboundedOtherUsage(database, stage = null) {
  const rows = stage ? database.prepare('SELECT agent_id, metadata_json FROM token_usage WHERE stage = ?').all(stage) : database.prepare('SELECT agent_id, metadata_json FROM token_usage').all();
  return rows.filter(row => {
    let meta; try { meta = parseJson(row.metadata_json); } catch { return true; }
    if (['provider-reported', 'estimated'].includes(meta?.usageSource)) return false;
    return !(row.agent_id && meta?.jobId && ['unknown', 'legacy-unverified'].includes(meta.usageSource));
  }).length;
}
function runBudgetSnapshot(database, stage, recovery = false) {
  const config = runBudgetConfig(database);
  if (!config) return null;
  const used = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage').get().total);
  const reserved = Number(database.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running'").get().total);
  const verificationUsed = Number(database.prepare("SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = 'verify'").get().total);
  const verificationReserved = Number(database.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running' AND stage = 'verify'").get().total);
  const usageRows = database.prepare('SELECT stage, total_tokens, metadata_json FROM token_usage').all();
  const recoveryUsed = usageRows.reduce((sum, row) => { try { const meta = JSON.parse(row.metadata_json); return sum + (row.stage !== 'verify' && (meta?.budgetRecovery === true || Number(meta?.attempt) > 1) ? Number(row.total_tokens) : 0); } catch { return sum; } }, 0);
  const recoveryReserved = database.prepare("SELECT job_id, agent_id, stage, attempt, status, payload_json, reserved_tokens FROM agent_jobs WHERE status = 'running'").all().reduce((sum, job) => sum + (job.stage !== 'verify' && isRecoveryJob(database, job) ? Number(job.reserved_tokens) : 0), 0);
  const incompleteUsage = usageRows.some(row => { try { return !['provider-reported', 'estimated'].includes(JSON.parse(row.metadata_json)?.usageSource); } catch { return true; } });
  const estimatedUsage = usageRows.some(row => { try { return JSON.parse(row.metadata_json)?.usageSource === 'estimated'; } catch { return false; } });
  const unknownAttempts = unknownAttemptReservations(database);
  const unboundedOther = unboundedOtherUsage(database);
  const remainingVerificationReserve = Math.max(0, config.verificationReserve - verificationUsed - verificationReserved - unknownAttempts.verificationHeld);
  const remainingRecoveryReserve = Math.max(0, config.recoveryReserve - recoveryUsed - recoveryReserved - unknownAttempts.recoveryHeld);
  const effectiveLimit = stage === 'verify' ? config.limit : config.limit - remainingVerificationReserve - (recovery ? 0 : remainingRecoveryReserve);
  const reportedAvailable = Math.max(0, effectiveLimit - used - reserved);
  const admissionAvailable = unknownAttempts.unbounded || unboundedOther ? 0 : Math.max(0, reportedAvailable - unknownAttempts.held);
  const reserveShortfall = Math.max(0, used + reserved + remainingVerificationReserve + remainingRecoveryReserve - config.limit);
  const reportedOvercommitted = used + reserved > config.limit;
  return { ...config, used, reserved, verificationUsed, verificationReserved, recoveryUsed, recoveryReserved, remainingVerificationReserve, remainingRecoveryReserve, reserveShortfall: null, reportedReserveShortfall: reserveShortfall, effectiveLimit, incompleteUsage, estimatedUsage, completeHostUsage: false, available: null, reportedAvailable, unknownAttempts, unboundedOtherUsage: unboundedOther, admissionAvailable, overcommitted: null, reportedOvercommitted, budgetScope: 'reported-and-estimated-usage-only' };
}
export function configureRunTokenBudget(runDir, { limit, verificationReserve, recoveryReserve = 0 }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(verificationReserve) || verificationReserve < 0 || !Number.isSafeInteger(recoveryReserve) || recoveryReserve < 0 || verificationReserve + recoveryReserve > limit) throw new Error('run token budget requires a positive limit and reserves within it');
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const previous = runBudgetConfig(database), config = { limit, verificationReserve, recoveryReserve };
    database.prepare("INSERT INTO ledger_meta(key, value) VALUES ('run_token_budget', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(config));
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('run-token-budget-configured', now(), JSON.stringify({ previous, config }));
    const snapshot = runBudgetSnapshot(database, 'verify'); database.exec('COMMIT');
    return { status: 'configured', ...snapshot };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
function agentBudgetSnapshot(database, job) {
  const payload = parseJson(job.payload_json), limit = payload?.stageTokenBudget;
  const used = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(job.stage).total);
  const reserved = Number(database.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running' AND stage = ?").get(job.stage).total);
  const incompleteUsage = stageUsageIncomplete(database, job.stage);
  const ownReserved = Number(database.prepare('SELECT reserved_tokens FROM agent_jobs WHERE job_id = ?').get(job.job_id)?.reserved_tokens || 0);
  const validLimit = Number.isInteger(limit) && limit > 0;
  const reportedAvailable = validLimit ? Math.max(0, limit - used - reserved) : null;
  return { used, reserved, stageBudget: validLimit ? limit : null, incompleteUsage, available: incompleteUsage ? null : reportedAvailable, reportedAvailable, overcommitted: !validLimit ? null : used + reserved > limit ? true : incompleteUsage ? null : false, budgetScope: validLimit && ownReserved > 0 ? 'reported-usage-only' : 'not-reserved', runBudget: runBudgetSnapshot(database, job.stage, isRecoveryJob(database, job)) };
}
export function claimAgentJob(runDir, jobId, { claimKey = null, replayOnly = false } = {}) {
  requireNonEmpty(jobId, 'jobId');
  if (claimKey !== null && (typeof claimKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(claimKey))) throw new Error('claim key must be a durable random identifier of 16 to 128 safe characters');
  const database = open(runDir), timestamp = now();
  try {
    database.exec('BEGIN IMMEDIATE');
    const job = database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').get(jobId);
    if (!job) throw new Error(`agent job does not exist: ${jobId}`);
    const payload = parseJson(job.payload_json);
    const policy = database.prepare("SELECT value FROM ledger_meta WHERE key = 'projectionPolicy'").get()?.value;
    if (policy === 'ledger-authoritative' && payload?.roleId && !claimKey) throw new Error('a durable claim key is required for a new Run professional role');
    if (job.status === 'running' && claimKey && job.claim_key === claimKey) {
      assertCurrentAgentLease(job, jobId, job.lease_token);
      const budget = agentBudgetSnapshot(database, job);
      database.exec('COMMIT');
      return { ...job, leaseToken: job.lease_token, leaseExpiresAt: job.lease_expires_at, reservedTokens: Number(job.reserved_tokens || 0), ...budget, payload: parseJson(job.payload_json), idempotent: true, dispatchDirective: 'reconcile-existing-execution-before-start' };
    }
    if (replayOnly) throw new Error(`agent replay no longer identifies the active claim: ${jobId}`);
    if (job.status !== 'queued') throw new Error(`agent job is not queued: ${jobId}/${job.status}`);
    const registration = database.prepare('SELECT stage FROM agents WHERE agent_id = ?').get(job.agent_id);
    if (!registration || registration.stage !== job.stage) throw new Error(`queued agent job stage does not match its registration; controlled role repair is required: ${jobId}`);
    if (claimKey && database.prepare('SELECT 1 FROM agent_claim_keys WHERE job_id = ? AND claim_key = ?').get(jobId, claimKey)) throw new Error(`claim key belongs to a prior agent attempt: ${jobId}`);
    const availableAt = Date.parse(job.available_at);
    if (!Number.isFinite(availableAt)) throw new Error(`invalid Agent job backoff timestamp requires investigation: ${jobId}`);
    if (availableAt > Date.now()) throw new Error(`agent job backoff has not elapsed: ${jobId}`);
    // Reserve capacity in the same write transaction as the claim. Expired
    // leases continue occupying a slot until controlled recovery fences them.
    const activeForAgent = database.prepare("SELECT COUNT(*) AS count FROM agent_jobs WHERE status = 'running' AND agent_id = ?").get(job.agent_id).count;
    const activeTotal = database.prepare("SELECT COUNT(*) AS count FROM agent_jobs WHERE status = 'running'").get().count;
    if (activeForAgent || activeTotal >= 2) {
      database.exec('COMMIT');
      return { jobId, status: 'waiting', reason: activeForAgent ? 'agent-already-running' : 'agent-concurrency-limit', activeJobs: Number(activeTotal), maxConcurrency: 2 };
    }
    let reservedTokens = 0;
    const runBudget = runBudgetSnapshot(database, job.stage, isRecoveryJob(database, job));
    if (runBudget) {
      if (!Number.isSafeInteger(payload.tokenBudget) || payload.tokenBudget < 1) throw new Error('run budget requires an explicit positive attempt reservation');
      if (runBudget.admissionAvailable < payload.tokenBudget) {
        const waiting = runBudget.reserved > 0 && !runBudget.unknownAttempts.unbounded && !runBudget.unboundedOtherUsage && runBudget.effectiveLimit - runBudget.used - runBudget.unknownAttempts.held >= payload.tokenBudget;
        database.exec('COMMIT');
        return { jobId, status: waiting ? 'waiting' : 'budget-exhausted', reason: waiting ? 'run-budget-reserved' : (runBudget.unknownAttempts.attempts || runBudget.unboundedOtherUsage) && runBudget.reportedAvailable >= payload.tokenBudget ? 'run-budget-unknown-usage' : 'run-budget-insufficient', requested: payload.tokenBudget, runBudget };
      }
    }
    if (payload.stageTokenBudget !== undefined) {
      if (!Number.isInteger(payload.stageTokenBudget) || payload.stageTokenBudget < 1 || !Number.isInteger(payload.tokenBudget) || payload.tokenBudget < 1) throw new Error('agent job has invalid stage or attempt budget');
      const used = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(job.stage).total);
      const reserved = Number(database.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running' AND stage = ?").get(job.stage).total);
      const available = Math.max(0, payload.stageTokenBudget - used - reserved);
      const unknownAttempts = unknownAttemptReservations(database, job.stage);
      const unboundedOther = unboundedOtherUsage(database, job.stage);
      const admissionAvailable = unknownAttempts.unbounded || unboundedOther ? 0 : Math.max(0, available - unknownAttempts.held);
      if (admissionAvailable < payload.tokenBudget) {
        const incompleteUsage = stageUsageIncomplete(database, job.stage);
        const waiting = reserved > 0 && !unknownAttempts.unbounded && !unboundedOther && payload.stageTokenBudget - used - unknownAttempts.held >= payload.tokenBudget;
        database.exec('COMMIT');
        return { jobId, status: waiting ? 'waiting' : 'budget-exhausted', reason: waiting ? 'stage-budget-reserved' : (unknownAttempts.attempts || unboundedOther) && available >= payload.tokenBudget ? 'stage-budget-unknown-usage' : 'stage-budget-insufficient', used, reserved, available: incompleteUsage ? null : available, reportedAvailable: available, admissionAvailable, unknownAttempts, unboundedOtherUsage: unboundedOther, incompleteUsage, requested: payload.tokenBudget, stageBudget: payload.stageTokenBudget, budgetScope: 'reported-usage-only', runBudget };
      }
      reservedTokens = payload.tokenBudget;
    }
    if (runBudget && !reservedTokens) reservedTokens = payload.tokenBudget;
    if (claimKey) database.prepare('INSERT INTO agent_claim_keys(job_id, claim_key, attempt) VALUES (?, ?, ?)').run(jobId, claimKey, Number(job.attempt) + 1);
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + AGENT_JOB_LEASE_MS).toISOString();
    database.prepare("UPDATE agent_jobs SET status = 'running', attempt = attempt + 1, started_at = ?, lease_token = ?, lease_expires_at = ?, claim_key = ?, reserved_tokens = ? WHERE job_id = ? AND status = 'queued'").run(timestamp, leaseToken, leaseExpiresAt, claimKey, reservedTokens, jobId);
    database.prepare("UPDATE agent_sessions SET status = 'working', updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(timestamp, jobId, job.agent_id);
    const budget = agentBudgetSnapshot(database, job);
    database.exec('COMMIT');
    return { ...job, status: 'running', attempt: Number(job.attempt) + 1, leaseToken, leaseExpiresAt, reservedTokens, ...budget, payload, idempotent: false, dispatchDirective: 'start-once' };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
function assertCurrentAgentLease(job, jobId, leaseToken) {
  if (!job || job.status !== 'running') throw new Error(`agent job is not running: ${jobId}`);
  // Pre-lease running jobs have no identity to fence. Recover them after
  // their legacy timeout and issue a new lease instead of accepting output.
  if (!job.lease_token) throw new Error(`legacy agent job has no fenced lease; controlled recovery is required: ${jobId}`);
  if (job.lease_token !== leaseToken) throw new Error(`agent job lease token is stale or missing: ${jobId}`);
  if (!job.lease_expires_at) throw new Error(`agent job lease expiry is missing: ${jobId}`);
  const expiry = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error(`agent job lease has expired: ${jobId}`);
}
function recordSettledAttemptUsage(database, job, usage, outcome, timestamp) {
  const report = usage || { inputTokens: 0, outputTokens: 0, usageSource: 'unknown' };
  if (![report.inputTokens, report.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(report.inputTokens + report.outputTokens) || !['provider-reported', 'estimated', 'unknown', 'legacy-unverified'].includes(report.usageSource)) throw new Error('invalid Agent attempt usage');
  if (report.usageSource === 'unknown' && (report.inputTokens !== 0 || report.outputTokens !== 0)) throw new Error('unknown Agent attempt usage requires zero placeholders');
  database.prepare('INSERT INTO token_usage (stage, agent_id, input_tokens, output_tokens, total_tokens, recorded_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(job.stage, job.agent_id, report.inputTokens, report.outputTokens, report.inputTokens + report.outputTokens, timestamp, JSON.stringify({ jobId: job.job_id, attempt: Number(job.attempt), budgetRecovery: isRecoveryJob(database, job), outcome, usageSource: report.usageSource, reservedTokens: Number(job.reserved_tokens || 0) }));
}
function earlierBudgetOverruns(database, job) {
  return database.prepare('SELECT id, metadata_json FROM token_usage WHERE stage = ? AND agent_id = ?').all(job.stage, job.agent_id).filter(row => {
    const meta = parseJson(row.metadata_json);
    return meta?.jobId === job.job_id && Number(meta.attempt) < Number(job.attempt) && meta.overReservation === true && meta.budgetOverrunHandled !== true;
  });
}
export function reconcileAgentAttemptUsage(runDir, { jobId, attempt, inputTokens, outputTokens, usageSource, evidence }) {
  requireNonEmpty(jobId, 'jobId');
  if (!Number.isSafeInteger(attempt) || attempt < 1 || ![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(inputTokens + outputTokens) || !['provider-reported', 'estimated'].includes(usageSource) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 1024) throw new Error('attempt usage reconciliation requires a valid attempt, usage source, counts and evidence');
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const job = database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').get(jobId);
    if (!job) throw new Error('attempt job does not exist');
    const matches = database.prepare('SELECT * FROM token_usage WHERE stage = ? AND agent_id = ?').all(job.stage, job.agent_id).filter(row => { const meta = parseJson(row.metadata_json); return meta?.jobId === jobId && Number(meta.attempt) === attempt; });
    if (matches.length !== 1) throw new Error('attempt usage record is missing or ambiguous');
    const row = matches[0], previous = parseJson(row.metadata_json);
    if (!['unknown', 'legacy-unverified'].includes(previous.usageSource)) {
      if (previous.reconciled && previous.usageSource === usageSource && Number(row.input_tokens) === inputTokens && Number(row.output_tokens) === outputTokens && previous.reconciliationEvidence === evidence) { database.exec('COMMIT'); return { status: 'already-reconciled', jobId, attempt, overReservation: Boolean(previous.overReservation), pendingRunning: previous.overReservation === true && previous.budgetOverrunHandled !== true && job.status === 'running' && Number(job.attempt) > attempt }; }
      throw new Error('attempt usage has already been recorded with different values');
    }
    const overReservation = Number(previous.reservedTokens || 0) > 0 && inputTokens + outputTokens > Number(previous.reservedTokens);
    const fenceJob = overReservation && ['succeeded', 'queued'].includes(job.status);
    const pendingRunning = overReservation && Number(job.attempt) > attempt && job.status === 'running';
    const metadata = { ...previous, ...(fenceJob && Number(job.attempt) === attempt ? { outcome: 'budget-exceeded', priorOutcome: previous.outcome } : {}), usageSource, reconciled: true, previousUsageSource: previous.usageSource, reconciliationEvidence: evidence, reconciledAt: now(), overReservation };
    database.prepare('UPDATE token_usage SET input_tokens = ?, output_tokens = ?, total_tokens = ?, metadata_json = ? WHERE id = ?').run(inputTokens, outputTokens, inputTokens + outputTokens, JSON.stringify(metadata), row.id);
    if (fenceJob) {
      if (Number(job.attempt) !== attempt) {
        const latest = database.prepare('SELECT id, metadata_json FROM token_usage WHERE stage = ? AND agent_id = ?').all(job.stage, job.agent_id).filter(item => { const meta = parseJson(item.metadata_json); return meta?.jobId === jobId && Number(meta.attempt) === Number(job.attempt); });
        if (latest.length !== 1) throw new Error('latest settled attempt is missing or ambiguous');
        const old = parseJson(latest[0].metadata_json);
        database.prepare('UPDATE token_usage SET metadata_json = ? WHERE id = ?').run(JSON.stringify({ ...old, priorOutcome: old.outcome, outcome: 'budget-exceeded', earlierOverrunAttempt: attempt }), latest[0].id);
      }
      const reason = 'late-reconciled agent attempt exceeded its recorded token budget', timestamp = now();
      database.prepare("UPDATE agent_jobs SET status = 'dead-letter', last_error = ?, finished_at = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(reason, timestamp, jobId);
      database.prepare('INSERT OR REPLACE INTO dead_letters (job_id, agent_id, stage, attempts, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(jobId, job.agent_id, job.stage, job.attempt, reason, job.payload_json, timestamp);
      database.prepare("UPDATE agent_sessions SET status = 'failed', updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(timestamp, jobId, job.agent_id);
    }
    const previousUsage = { inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), totalTokens: Number(row.total_tokens), recordedAt: row.recorded_at, metadata: previous };
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('agent-attempt-usage-reconciled', now(), JSON.stringify({ jobId, attempt, previousUsage, inputTokens, outputTokens, usageSource, evidence, overReservation, fenced: fenceJob, pendingRunning }));
    const runBudget = runBudgetSnapshot(database, job.stage);
    database.exec('COMMIT'); return { status: 'reconciled', jobId, attempt, overReservation, fenced: fenceJob, pendingRunning, runBudget };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function settleAgentJob(runDir, jobId, { status, result = null, error = null, retryDelayMs = null, leaseToken = null, usage = null, budgetExceeded = false, expectedStage = null, directCompletion = false } = {}) {
  if (!['succeeded', 'failed'].includes(status)) throw new Error('agent job settlement status must be succeeded or failed');
  const database = open(runDir), timestamp = now();
  try {
    database.exec('BEGIN IMMEDIATE'); const job = database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').get(jobId);
    assertCurrentAgentLease(job, jobId, leaseToken);
    if (expectedStage !== null && job.stage !== expectedStage) throw new Error(`agent job does not belong to the authorized stage: ${jobId}/${expectedStage}`);
    if (directCompletion && status === 'succeeded' && parseJson(job.payload_json)?.roleId) throw new Error(`selected role must complete through role-advisory record: ${jobId}`);
    if (budgetExceeded && (status !== 'failed' || !usage || !Number(job.reserved_tokens || 0) || !Number.isInteger(usage.inputTokens) || !Number.isInteger(usage.outputTokens) || usage.inputTokens + usage.outputTokens <= Number(job.reserved_tokens))) throw new Error('budget-exceeded settlement requires actual usage above the active reservation');
    const payload = parseJson(job.payload_json), reported = usage && Number.isInteger(usage.inputTokens) && Number.isInteger(usage.outputTokens) ? usage.inputTokens + usage.outputTokens : 0;
    const prior = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(job.stage).total);
    const runBudget = runBudgetSnapshot(database, job.stage, isRecoveryJob(database, job));
    const priorOverrun = earlierBudgetOverruns(database, job).length > 0;
    const exceeded = priorOverrun || budgetExceeded || (Number(job.reserved_tokens || 0) > 0 && reported > Number(job.reserved_tokens)) || (Number.isInteger(payload.stageTokenBudget) && prior + reported > payload.stageTokenBudget) || (runBudget && runBudget.used + reported > runBudget.effectiveLimit);
    const reason = exceeded ? (priorOverrun ? 'earlier agent attempt exceeded its recorded token budget' : 'agent attempt exceeded its recorded token budget') : String(error || 'agent job failed');
    recordSettledAttemptUsage(database, job, usage, exceeded ? 'budget-exceeded' : status, timestamp);
    if (status === 'succeeded' && !exceeded) database.prepare("UPDATE agent_jobs SET status = 'succeeded', result_json = ?, finished_at = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(JSON.stringify(result || {}), timestamp, jobId);
    else if (exceeded || Number(job.attempt) >= Number(job.max_attempts)) {
      database.prepare("UPDATE agent_jobs SET status = 'dead-letter', last_error = ?, finished_at = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(reason, timestamp, jobId);
      database.prepare('INSERT OR REPLACE INTO dead_letters (job_id, agent_id, stage, attempts, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(jobId, job.agent_id, job.stage, job.attempt, reason, job.payload_json, timestamp);
    } else {
      const calculatedDelay = Math.min(60_000, 1000 * (2 ** (Number(job.attempt) - 1)));
      const delayMs = retryDelayMs === null ? calculatedDelay : retryDelayMs;
      if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new Error('retry delay must be an integer from 0 to 60000ms');
      database.prepare("UPDATE agent_jobs SET status = 'queued', available_at = ?, last_error = ?, started_at = NULL, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(new Date(Date.now() + delayMs).toISOString(), String(error || 'agent job failed'), jobId);
    }
    database.prepare("UPDATE agent_sessions SET status = CASE WHEN (SELECT status FROM agent_jobs WHERE job_id = ?) = 'dead-letter' THEN 'failed' ELSE 'ready' END, updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(jobId, timestamp, jobId, job.agent_id);
    database.exec('COMMIT');
    return agentRuntimeStatus(runDir, jobId);
  } catch (failure) { try { database.exec('ROLLBACK'); } catch {} throw failure; } finally { database.close(); }
}
// A selection's frozen inputs can reveal that a legacy fixed token split is
// mathematically impossible after durable jobs have been enqueued.  Permit a
// tightly-scoped budget migration for only active jobs; completed jobs and
// their accounting are immutable.  The selection file remains the human
// readable source, while this transaction keeps each live job's payload in
// lock-step with it.
export function rebudgetAgentJobs(runDir, { stage, jobIds, perAgentBudget, perJobBudgets = null, stageBudget = null }) {
  requireNonEmpty(stage, 'stage');
  if (!Array.isArray(jobIds) || !jobIds.length) throw new Error('rebudget requires one or more agent jobs');
  if (!Number.isInteger(perAgentBudget) || perAgentBudget < 1) throw new Error('rebudget per-Agent budget must be a positive integer');
  if (stageBudget !== null && (!Number.isInteger(stageBudget) || stageBudget < 1)) throw new Error('rebudget stage budget must be a positive integer');
  const database = open(runDir), timestamp = now();
  try {
    database.exec('BEGIN IMMEDIATE');
    if (JSON.parse(latestSnapshot(database)?.state_json || '{}').lifecycle === 'cancelled') throw new Error('cannot rebudget a cancelled run');
    for (const jobId of jobIds) {
      const job = database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').get(jobId);
      if (!job || job.stage !== stage) throw new Error(`rebudget job does not belong to ${stage}: ${jobId}`);
      const payload = parseJson(job.payload_json);
      const nextBudget = perJobBudgets ? perJobBudgets[jobId] : perAgentBudget;
      if (!Number.isInteger(nextBudget) || nextBudget < 1) throw new Error(`rebudget per-job budget is invalid: ${jobId}`);
      const budgetFailure = job.status === 'dead-letter' && database.prepare('SELECT metadata_json FROM token_usage WHERE stage = ? AND agent_id = ? ORDER BY id DESC').all(job.stage, job.agent_id).find(row => parseJson(row.metadata_json)?.jobId === jobId);
      const failure = budgetFailure && parseJson(budgetFailure.metadata_json);
      if (!['queued', 'running'].includes(job.status) && !(failure?.jobId === jobId && failure.attempt === Number(job.attempt) && failure.outcome === 'budget-exceeded')) throw new Error(`rebudget only permits active or budget-exceeded jobs: ${jobId}/${job.status}`);
      if (failure?.outcome === 'budget-exceeded') {
        const priorStageBudget = Number(payload.stageTokenBudget || 0), priorJobBudget = Number(payload.tokenBudget || 0);
        const nextStageBudget = stageBudget ?? priorStageBudget;
        if (nextBudget <= priorJobBudget && nextStageBudget <= priorStageBudget) throw new Error(`budget recovery requires a changed allowance: ${jobId}`);
        const used = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(stage).total);
        const reserved = Number(database.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running' AND stage = ?").get(stage).total);
        if (nextStageBudget < used + reserved + nextBudget) throw new Error(`budget recovery lacks capacity after recorded usage: ${jobId}`);
        if (Number(job.attempt) >= 5) throw new Error(`budget recovery exhausted maximum attempts: ${jobId}`);
        for (const row of database.prepare('SELECT id, metadata_json FROM token_usage WHERE stage = ? AND agent_id = ?').all(job.stage, job.agent_id)) {
          const meta = parseJson(row.metadata_json);
          if (meta?.jobId === jobId && meta.overReservation === true && meta.budgetOverrunHandled !== true) database.prepare('UPDATE token_usage SET metadata_json = ? WHERE id = ?').run(JSON.stringify({ ...meta, budgetOverrunHandled: true, budgetRecoveryAt: timestamp }), row.id);
        }
        database.prepare("UPDATE agent_jobs SET status = 'queued', available_at = ?, started_at = NULL, finished_at = NULL, last_error = NULL, max_attempts = MAX(max_attempts, ?), claim_key = NULL WHERE job_id = ?").run(timestamp, Number(job.attempt) + 1, jobId);
        database.prepare("UPDATE agent_sessions SET status = 'ready', updated_at = ? WHERE agent_id = ?").run(timestamp, job.agent_id);
      }
      payload.tokenBudget = nextBudget;
      if (stageBudget !== null) payload.stageTokenBudget = stageBudget;
      database.prepare('UPDATE agent_jobs SET payload_json = ? WHERE job_id = ?').run(JSON.stringify(payload), jobId);
    }
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('agent-jobs-rebudgeted', timestamp, JSON.stringify({ stage, jobIds, perAgentBudget, perJobBudgets, stageBudget }));
    database.exec('COMMIT');
    return agentRuntimeStatus(runDir);
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function renewAgentJobLease(runDir, jobId, leaseToken) {
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const job = database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').get(jobId);
    assertCurrentAgentLease(job, jobId, leaseToken);
    const leaseExpiresAt = new Date(Date.now() + AGENT_JOB_LEASE_MS).toISOString();
    database.prepare('UPDATE agent_jobs SET lease_expires_at = ? WHERE job_id = ?').run(leaseExpiresAt, jobId);
    database.exec('COMMIT');
    return { jobId, leaseExpiresAt };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function recordTokenUsage(runDir, { stage, agentId = null, inputTokens = 0, outputTokens = 0, limit = null, metadata = {}, legacyOnly = false }) {
  requireNonEmpty(stage, 'stage');
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(inputTokens + outputTokens)) throw new Error('token usage must be non-negative safe integers with a safe total');
  if (metadata.usageSource === 'unknown' && (inputTokens !== 0 || outputTokens !== 0)) throw new Error('unknown token usage requires zero placeholders');
  const database = open(runDir); const total = inputTokens + outputTokens;
  try {
    database.exec('BEGIN IMMEDIATE');
    if (legacyOnly && database.prepare("SELECT value FROM ledger_meta WHERE key = 'projectionPolicy'").get()?.value === 'ledger-authoritative') throw new Error('legacy tokens command is unavailable for new Runs; use tokens-observed for independent host usage or the Agent attempt settlement');
    const prior = database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(stage).total;
    if (limit !== null && (!Number.isInteger(limit) || limit < total || Number(prior) + total > limit)) throw new Error(`token budget exceeded for ${stage}: used=${prior}, requested=${total}, limit=${limit}`);
    database.prepare('INSERT INTO token_usage (stage, agent_id, input_tokens, output_tokens, total_tokens, recorded_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(stage, agentId, inputTokens, outputTokens, total, now(), JSON.stringify(metadata));
    database.exec('COMMIT');
    return { stage, used: Number(prior) + total, limit };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
// Independent host calls must use a stable observation key; Agent attempts
// settle separately and must never also be registered through this path.
export function recordObservedTokenUsage(runDir, { stage, observationKey, inputTokens, outputTokens, usageSource, limit = null }) {
  requireNonEmpty(stage, 'stage');
  if (typeof observationKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(observationKey)) throw new Error('observation key must be a stable identifier of 16 to 128 safe characters');
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !['provider-reported', 'estimated', 'unknown'].includes(usageSource) || (usageSource === 'unknown' && (inputTokens || outputTokens))) throw new Error('invalid observed token usage');
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('token budget limit must be a non-negative integer or null');
  const total = inputTokens + outputTokens;
  if (!Number.isSafeInteger(total)) throw new Error('observed token usage exceeds safe integer range');
  const fingerprint = hash(JSON.stringify({ stage, inputTokens, outputTokens, usageSource }));
  const database = open(runDir);
  try {
    database.exec('BEGIN IMMEDIATE');
    const existing = database.prepare('SELECT usage_id, fingerprint FROM token_observations WHERE observation_key = ?').get(observationKey);
    if (existing) {
      const row = database.prepare('SELECT stage, agent_id, input_tokens, output_tokens, total_tokens, metadata_json FROM token_usage WHERE id = ?').get(existing.usage_id);
      let metadata; try { metadata = JSON.parse(row?.metadata_json || '{}'); } catch { metadata = {}; }
      const reconciledUnknownReplay = metadata.reconciled === true && metadata.previousUsageSource === 'unknown' && usageSource === 'unknown' && inputTokens === 0 && outputTokens === 0;
      const sameUsage = Number(row?.input_tokens) === inputTokens && Number(row?.output_tokens) === outputTokens && Number(row?.total_tokens) === total && metadata.usageSource === usageSource;
      if (!row || row.stage !== stage || row.agent_id !== null || (!sameUsage && !reconciledUnknownReplay) || metadata.observationKey !== observationKey || metadata.kind !== 'independent-host-call') throw new Error('observed token usage identity conflict');
    }
    if (!existing) {
      const result = database.prepare('INSERT INTO token_usage (stage, agent_id, input_tokens, output_tokens, total_tokens, recorded_at, metadata_json) VALUES (?, NULL, ?, ?, ?, ?, ?)').run(stage, inputTokens, outputTokens, total, now(), JSON.stringify({ usageSource, observationKey, kind: 'independent-host-call' }));
      database.prepare('INSERT INTO token_observations (observation_key, usage_id, fingerprint) VALUES (?, ?, ?)').run(observationKey, result.lastInsertRowid, fingerprint);
    }
    const used = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(stage).total);
    const reserved = Number(database.prepare("SELECT COALESCE(SUM(reserved_tokens), 0) AS total FROM agent_jobs WHERE status = 'running' AND stage = ?").get(stage).total);
    const incomplete = stageUsageIncomplete(database, stage);
    const runBudget = runBudgetSnapshot(database, stage);
    database.exec('COMMIT');
    return { stage, used, reserved, limit, available: limit === null || incomplete ? null : Math.max(0, limit - used - reserved), overcommitted: limit === null ? null : used + reserved > limit ? true : incomplete ? null : false, incompleteUsage: incomplete, idempotent: Boolean(existing), budgetScope: 'reported-usage-only', runBudget };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
export function reconcileObservedTokenUsage(runDir, { stage, observationKey, inputTokens, outputTokens, usageSource, evidence }) {
  requireNonEmpty(stage, 'stage');
  if (typeof observationKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(observationKey) || ![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(inputTokens + outputTokens) || !['provider-reported', 'estimated'].includes(usageSource) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 1024) throw new Error('observed usage reconciliation requires stage, stable key, counts, source and evidence');
  const database = open(runDir), total = inputTokens + outputTokens;
  try {
    database.exec('BEGIN IMMEDIATE');
    const observation = database.prepare('SELECT usage_id FROM token_observations WHERE observation_key = ?').get(observationKey);
    const row = observation && database.prepare('SELECT * FROM token_usage WHERE id = ?').get(observation.usage_id);
    const metadata = row && parseJson(row.metadata_json);
    if (!row || row.agent_id !== null || row.stage !== stage || metadata?.kind !== 'independent-host-call' || metadata.observationKey !== observationKey) throw new Error('observed usage identity does not match the original host call');
    if (metadata.usageSource !== 'unknown') {
      if (metadata.reconciled && metadata.usageSource === usageSource && Number(row.input_tokens) === inputTokens && Number(row.output_tokens) === outputTokens && metadata.reconciliationEvidence === evidence) { database.exec('COMMIT'); return { status: 'already-reconciled', observationKey }; }
      throw new Error('observed usage was already reconciled or is not unknown');
    }
    const updated = { ...metadata, usageSource, reconciled: true, previousUsageSource: 'unknown', reconciliationEvidence: evidence, reconciledAt: now() };
    database.prepare('UPDATE token_usage SET input_tokens = ?, output_tokens = ?, total_tokens = ?, metadata_json = ? WHERE id = ?').run(inputTokens, outputTokens, total, JSON.stringify(updated), row.id);
    database.prepare('UPDATE token_observations SET fingerprint = ? WHERE observation_key = ?').run(hash(JSON.stringify({ stage, inputTokens, outputTokens, usageSource })), observationKey);
    database.prepare('INSERT INTO events (event_type, created_at, payload_json) VALUES (?, ?, ?)').run('host-observed-usage-reconciled', now(), JSON.stringify({ stage, observationKey, inputTokens, outputTokens, usageSource, evidence }));
    const runBudget = runBudgetSnapshot(database, stage); database.exec('COMMIT');
    return { status: 'reconciled', stage, observationKey, inputTokens, outputTokens, usageSource, runBudget };
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}
// Hold the ledger write lock while checking the lease and publishing an advisory.
// A crash can leave an uncommitted file, but never a successful job or action receipt.
export function completeAgentAdvisory(runDir, jobId, { leaseToken, output, content, inputTokens, outputTokens, limit, metadata = {} }) {
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(inputTokens + outputTokens)) throw new Error('token usage must be non-negative safe integers with a safe total');
  if (metadata.usageSource === 'unknown' && (inputTokens !== 0 || outputTokens !== 0)) throw new Error('unknown token usage requires zero placeholders');
  const database = open(runDir), timestamp = now(); let wrote = false, previous = null;
  try {
    database.exec('BEGIN IMMEDIATE');
    const job = database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').get(jobId);
    assertCurrentAgentLease(job, jobId, leaseToken);
    const jobPayload = parseJson(job.payload_json), bindings = jobPayload?.inputBindings;
    if (bindings !== undefined) {
      if (!Array.isArray(bindings) || hash(JSON.stringify(bindings)) !== job.input_hash) throw new Error('agent job frozen input identity is invalid');
      const root = fs.realpathSync(runDir), state = JSON.parse(latestSnapshot(database)?.state_json || '{}');
      if (jobPayload.registrySha256 && hash(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'registry', 'agency-role-registry.json'))) !== jobPayload.registrySha256) throw new Error('agent job role registry changed before advisory completion');
      const revisionArtifact = job.stage === 'visual' ? 'visualRevision' : job.stage === 'verify' && state.roleChain?.confirmationModel === 'two-confirmations' ? 'requirementRevisions' : null;
      if (revisionArtifact && fs.existsSync(path.join(root, 'prompt-revisions.ndjson')) && !bindings.some(binding => binding.artifact === revisionArtifact)) throw new Error(`agent job input appeared before advisory completion: ${revisionArtifact}`);
      for (const binding of bindings) {
        const file = typeof binding?.path === 'string' && !path.isAbsolute(binding.path) ? path.resolve(root, binding.path) : null;
        if (!file || !file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error(`agent job input is missing or outside the run: ${binding?.artifact || 'unknown'}`);
        if (!['visualRevision', 'requirementRevisions'].includes(binding.artifact) && state.artifacts && state.artifacts[binding.artifact] !== binding.path) throw new Error(`agent job input reference changed: ${binding.artifact}`);
        const current = binding.artifact === 'visualRevision' ? visualRevisionBindingCurrent(file, binding.sha256) : hash(fs.readFileSync(file)) === binding.sha256;
        if (!current) throw new Error(`agent job input changed before advisory completion: ${binding.artifact}`);
      }
    }
    const destination = path.resolve(output);
    const expected = path.resolve(runDir, 'advisories', job.stage, `${job.agent_id}.json`);
    if (destination !== expected || !destination.startsWith(`${path.resolve(runDir)}${path.sep}`)) throw new Error('advisory output does not match its job');
    const used = inputTokens + outputTokens;
    const prior = Number(database.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE stage = ?').get(job.stage).total);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error('token budget limit must be a non-negative integer or null');
    const overAttempt = Number(job.reserved_tokens || 0) && used > Number(job.reserved_tokens);
    const overPriorAttempt = earlierBudgetOverruns(database, job).length > 0;
    const overStage = limit !== null && prior + used > limit;
    const runBudget = runBudgetSnapshot(database, job.stage, isRecoveryJob(database, job));
    const overRun = runBudget && runBudget.used + used > runBudget.effectiveLimit;
    if (overPriorAttempt || overAttempt || overStage || overRun) {
      // Usage has already occurred. Persist it atomically with a terminal job
      // outcome before rejecting the advisory; retries cannot charge it twice.
      const reason = overPriorAttempt ? `earlier agent attempt exceeded its recorded token budget: ${jobId}` : overAttempt ? `agent attempt exceeds its reserved token budget: ${jobId}` : overStage ? `token budget exceeded for ${job.stage}: used=${prior}, requested=${used}, limit=${limit}` : `run token budget exceeded for ${job.stage}: used=${runBudget.used}, requested=${used}, limit=${runBudget.effectiveLimit}`;
      database.prepare('INSERT INTO token_usage (stage, agent_id, input_tokens, output_tokens, total_tokens, recorded_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(job.stage, job.agent_id, inputTokens, outputTokens, used, timestamp, JSON.stringify({ ...metadata, jobId, attempt: Number(job.attempt), budgetRecovery: isRecoveryJob(database, job), outcome: 'budget-exceeded', reservedTokens: Number(job.reserved_tokens || 0) }));
      database.prepare("UPDATE agent_jobs SET status = 'dead-letter', last_error = ?, finished_at = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(reason, timestamp, jobId);
      database.prepare('INSERT OR REPLACE INTO dead_letters (job_id, agent_id, stage, attempts, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(jobId, job.agent_id, job.stage, job.attempt, reason, job.payload_json, timestamp);
      database.prepare("UPDATE agent_sessions SET status = 'failed', updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(timestamp, jobId, job.agent_id);
      database.exec('COMMIT');
      throw new Error(reason);
    }
    previous = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
    database.prepare('INSERT INTO token_usage (stage, agent_id, input_tokens, output_tokens, total_tokens, recorded_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(job.stage, job.agent_id, inputTokens, outputTokens, used, timestamp, JSON.stringify({ ...metadata, jobId, attempt: Number(job.attempt), budgetRecovery: isRecoveryJob(database, job), outcome: 'succeeded', reservedTokens: Number(job.reserved_tokens || 0) }));
    atomicWrite(destination, content); wrote = true;
    const result = { advisory: path.relative(runDir, destination), sha256: hash(content), tokenUsage: used };
    database.prepare("UPDATE agent_jobs SET status = 'succeeded', result_json = ?, finished_at = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(JSON.stringify(result), timestamp, jobId);
    database.prepare("UPDATE agent_sessions SET status = 'ready', updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(timestamp, jobId, job.agent_id);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (wrote) { try { if (previous === null) fs.rmSync(output, { force: true }); else atomicWrite(output, previous); } catch {} }
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
}
export function startTraceSpan(runDir, { traceId = crypto.randomUUID(), spanId = crypto.randomUUID(), parentSpanId = null, name, kind = 'internal', attributes = {} }) {
  requireNonEmpty(name, 'name'); const database = open(runDir), timestamp = now();
  try { database.prepare('INSERT INTO trace_spans (span_id, trace_id, parent_span_id, name, kind, status, started_at, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(spanId, traceId, parentSpanId, name, kind, 'running', timestamp, JSON.stringify(attributes)); return { traceId, spanId, startedAt: timestamp }; } finally { database.close(); }
}
export function endTraceSpan(runDir, spanId, { status = 'passed', error = null, attributes = null } = {}) {
  if (!['passed', 'failed', 'cancelled'].includes(status)) throw new Error('trace span status is invalid'); const database = open(runDir);
  try { const current = database.prepare('SELECT attributes_json FROM trace_spans WHERE span_id = ?').get(spanId); if (!current) throw new Error(`trace span does not exist: ${spanId}`); database.prepare('UPDATE trace_spans SET status = ?, ended_at = ?, error = ?, attributes_json = ? WHERE span_id = ?').run(status, now(), error, JSON.stringify(attributes || parseJson(current.attributes_json)), spanId); } finally { database.close(); }
}
export function agentRuntimeStatus(runDir, jobId = null) {
  const database = open(runDir);
  try {
    const jobs = jobId ? database.prepare('SELECT * FROM agent_jobs WHERE job_id = ?').all(jobId) : database.prepare('SELECT * FROM agent_jobs ORDER BY created_at').all();
    const counts = database.prepare('SELECT status, COUNT(*) AS count FROM agent_jobs GROUP BY status').all();
    const tokens = database.prepare('SELECT stage, COALESCE(SUM(total_tokens), 0) AS total FROM token_usage GROUP BY stage').all();
    const traces = database.prepare('SELECT status, COUNT(*) AS count FROM trace_spans GROUP BY status').all();
    const tokenUsageCoverage = {};
    for (const row of database.prepare('SELECT stage, metadata_json FROM token_usage').all()) {
      const source = parseJson(row.metadata_json)?.usageSource || 'unspecified';
      const stage = tokenUsageCoverage[row.stage] ||= { providerReported: 0, estimated: 0, unknown: 0, unverified: 0 };
      if (source === 'provider-reported') stage.providerReported += 1;
      else if (source === 'estimated') stage.estimated += 1;
      else if (source === 'unknown') stage.unknown += 1;
      else stage.unverified += 1;
    }
    const deadLetters = database.prepare('SELECT job_id, agent_id, stage, attempts, reason, created_at FROM dead_letters ORDER BY created_at DESC LIMIT 20').all();
    const sessions = database.prepare('SELECT s.session_id, s.agent_id, s.status, s.context_hash, s.skill_bindings_json, s.last_job_id, s.updated_at, a.stage AS registration_stage FROM agent_sessions s LEFT JOIN agents a ON a.agent_id = s.agent_id ORDER BY s.agent_id').all();
    return { jobs: jobs.map(job => ({ jobId: job.job_id, agentId: job.agent_id, stage: job.stage, status: job.status, attempt: job.attempt, maxAttempts: job.max_attempts, reservedTokens: job.status === 'running' ? Number(job.reserved_tokens || 0) : 0, availableAt: job.available_at, leaseExpiresAt: job.status === 'running' ? job.lease_expires_at || null : null, error: job.last_error, payload: parseJson(job.payload_json), result: parseJson(job.result_json) })), counts: Object.fromEntries(counts.map(item => [item.status, item.count])), tokenUsage: Object.fromEntries(tokens.map(item => [item.stage, Number(item.total)])), tokenUsageCoverage, runBudget: runBudgetSnapshot(database, 'verify'), tokenUsageScope: 'recorded-agent-and-independent-host-usage; unknown-or-unrecorded-host-calls-are-not-included', traces: Object.fromEntries(traces.map(item => [item.status, item.count])), sessions: sessions.map(item => ({ sessionId: item.session_id, agentId: item.agent_id, registrationStage: item.registration_stage, status: item.status, contextHash: item.context_hash, skillBindings: parseJson(item.skill_bindings_json), lastJobId: item.last_job_id, updatedAt: item.updated_at })), deadLetters: deadLetters.map(item => ({ jobId: item.job_id, agentId: item.agent_id, stage: item.stage, attempts: item.attempts, reason: item.reason, createdAt: item.created_at })) };
  } finally { database.close(); }
}

export function recoverAgentJobs(runDir, { force = false } = {}) {
  const database = open(runDir), timestamp = now(), recovered = [];
  try {
    database.exec('BEGIN IMMEDIATE');
    const candidates = database.prepare("SELECT * FROM agent_jobs WHERE status = 'running'").all();
    if (!force) for (const job of candidates) {
      if ((!job.lease_expires_at && job.lease_token) || !(job.lease_expires_at || job.started_at)) throw new Error(`missing Agent lease timestamp requires investigation before recovery: ${job.job_id}`);
      const leaseTime = job.lease_expires_at || job.started_at;
      if (leaseTime && !Number.isFinite(Date.parse(leaseTime))) throw new Error(`invalid Agent lease timestamp requires investigation before recovery: ${job.job_id}`);
    }
    const running = candidates.filter(job => force || (job.lease_expires_at ? Date.parse(job.lease_expires_at) : Date.parse(job.started_at) + AGENT_JOB_LEASE_MS) <= Date.now());
    for (const job of running) {
      const priorOverrun = earlierBudgetOverruns(database, job).length > 0;
      recordSettledAttemptUsage(database, job, null, priorOverrun ? 'budget-exceeded' : 'interrupted', timestamp);
      if (priorOverrun || Number(job.attempt) >= Number(job.max_attempts)) {
        const reason = priorOverrun ? 'earlier agent attempt exceeded its recorded token budget' : 'agent process interrupted after final attempt';
        database.prepare("UPDATE agent_jobs SET status = 'dead-letter', last_error = ?, finished_at = ?, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0 WHERE job_id = ?").run(reason, timestamp, job.job_id);
        database.prepare('INSERT OR REPLACE INTO dead_letters (job_id, agent_id, stage, attempts, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(job.job_id, job.agent_id, job.stage, job.attempt, reason, job.payload_json, timestamp);
        database.prepare("UPDATE agent_sessions SET status = 'failed', updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(timestamp, job.job_id, job.agent_id);
        recovered.push({ jobId: job.job_id, status: 'dead-letter' });
      } else {
        database.prepare("UPDATE agent_jobs SET status = 'queued', available_at = ?, started_at = NULL, lease_token = NULL, lease_expires_at = NULL, reserved_tokens = 0, last_error = ? WHERE job_id = ?").run(timestamp, 'agent process interrupted; queued for controlled retry', job.job_id);
        database.prepare("UPDATE agent_sessions SET status = 'ready', updated_at = ?, last_job_id = ? WHERE agent_id = ?").run(timestamp, job.job_id, job.agent_id);
        recovered.push({ jobId: job.job_id, status: 'queued' });
      }
    }
    database.exec('COMMIT'); return recovered;
  } catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; } finally { database.close(); }
}

export function readRunStateForUpdate(runDir) {
  const state = readRunState(runDir);
  return { state, expectedStateHash: stateHash(state) };
}

export function readRunState(runDir) {
  const file = statePath(runDir);
  const disk = fs.existsSync(file) ? parseState(file) : null;
  if (!fs.existsSync(ledgerPath(runDir))) {
    if (['ledger-integrity-incident.json', LEDGER_MARKER].some(name => fs.existsSync(path.join(runDir, name)))) throw new Error('run ledger is missing after it was established or a monitoring incident; restore and investigate the original ledger before recovery');
    if (!disk) throw new Error(`run state does not exist: ${file}`);
    initializeLedger(runDir, disk, 'legacy-state-import');
    return disk;
  }
  const database = open(runDir);
  let snapshot, projectionPolicy, recovered = null;
  try {
    database.exec('BEGIN IMMEDIATE');
    snapshot = latestSnapshot(database);
    projectionPolicy = database.prepare("SELECT value FROM ledger_meta WHERE key = 'projectionPolicy'").get()?.value || null;
    const currentProjection = parseState(file);
    // A previously committed projection can remain after a crash between the
    // next ledger commit and projection write. Never import it as a new edit.
    if (snapshot && currentProjection && stateHash(currentProjection) !== snapshot.state_hash && database.prepare('SELECT 1 FROM state_snapshots WHERE state_hash = ? LIMIT 1').get(stateHash(currentProjection))) {
      recovered = JSON.parse(snapshot.state_json);
      atomicWrite(file, `${JSON.stringify(recovered, null, 2)}\n`);
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
  if (snapshot) ensureLedgerMarker(runDir);
  if (recovered) return recovered;
  if (!snapshot) {
    if (!disk) throw new Error(`run ledger has no state and projection is missing: ${file}`);
    initializeLedger(runDir, disk, 'projection-recovered-ledger');
    return disk;
  }
  const durable = JSON.parse(snapshot.state_json);
  if (durable.lifecycle === 'cancelled' && (!disk || stateHash(disk) !== snapshot.state_hash)) {
    atomicWrite(file, `${JSON.stringify(durable, null, 2)}\n`);
    return durable;
  }
  const authorityFields = ['runId', 'track', 'scope', 'authorization', 'lifecycle', 'phase', 'gates', 'locks', 'roleChain', 'confirmationEpochs', 'deliveryRoute', 'pendingDeliveryRoute', 'pendingDeliveryRouteReceipt', 'handoff'];
  if (disk && stateHash(disk) !== snapshot.state_hash) {
    const changed = authorityFields.filter(key => !isDeepStrictEqual(disk[key], durable[key]));
    if (changed.length) throw new Error(`uncommitted state projection changes protected authority fields: ${changed.join(', ')}; preserve and investigate the projection`);
    if (projectionPolicy === 'ledger-authoritative') throw new Error('uncommitted state projection differs from the durable ledger; preserve and investigate the projection');
  }
  const durableRevision = Number(durable.revision || 0);
  const diskRevision = Number(disk?.revision || -1);
  const diskIsNewerThanSnapshot = Boolean(disk && fs.statSync(file).mtimeMs >= Date.parse(snapshot.created_at));
  // Legacy writers did not consistently increment `revision`.  While they
  // remain in the compatibility window, a complete projection that was
  // written after the durable snapshot must be imported even if it retained
  // the same (or an older) revision; otherwise a Router restart silently
  // rewinds a valid Gate transition.
  if (disk && stateHash(disk) !== snapshot.state_hash && diskIsNewerThanSnapshot) {
    initializeLedger(runDir, disk, 'compatibility-projection-import');
    return disk;
  }
  if (!disk || diskRevision < durableRevision) {
    atomicWrite(file, `${JSON.stringify(durable, null, 2)}\n`);
    return durable;
  }
  // During the compatibility migration a few guarded scripts still write the
  // projection directly.  Preserve that complete newer projection and import
  // it into the ledger instead of silently rolling it back.  Router-owned
  // writes always commit the ledger first, so this branch disappears as the
  // remaining writers are migrated.
  if (stateHash(disk) !== snapshot.state_hash && diskRevision === durableRevision) {
    initializeLedger(runDir, disk, 'compatibility-projection-import');
    return disk;
  }
  if (diskRevision > durableRevision) {
    initializeLedger(runDir, disk, 'legacy-projection-ahead-of-ledger');
    return disk;
  }
  return disk;
}

export function reconcileRun(runDir) {
  const state = readRunState(runDir);
  const issues = [];
  const root = path.resolve(runDir);
  // State stores both materialized artifacts and planned workflow slots. A
  // planned slot may deliberately name a future file before its action runs;
  // it becomes integrity-bearing once the ledger has a committed artifact
  // record. Keep external references invalid immediately, but defer missing
  // local-file decisions until that durable evidence is loaded below.
  const stateReferences = Object.entries(state.artifacts || {}).filter(([, reference]) => typeof reference === 'string' && reference);
  const database = open(runDir);
  let running = []; let registered = []; let edges = [];
  try {
    running = database.prepare("SELECT job_id, agent_id, stage, started_at, lease_expires_at FROM agent_jobs WHERE status = 'running'").all();
    registered = database.prepare('SELECT artifact_id, reference, sha256, status, created_at FROM artifacts').all();
    edges = database.prepare('SELECT parent_artifact_id, child_artifact_id FROM artifact_edges').all();
  } finally { database.close(); }
  for (const [name, reference] of stateReferences) {
    if (path.isAbsolute(reference)) { issues.push({ type: 'external-artifact-reference', artifact: name, reference }); continue; }
    const candidate = path.resolve(root, reference);
    const committed = registered.some(item => item.reference === reference && item.status !== 'archived');
    if ((!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) && committed) issues.push({ type: 'missing-artifact', artifact: name, reference });
  }
  // A reference may be regenerated by a later authorized operation. Keep all
  // versions for provenance, but validate only the most recently committed
  // version as the current materialization contract.
  const latestByReference = new Map();
  for (const artifact of registered.filter(artifact => artifact.status !== 'archived')) latestByReference.set(artifact.reference, artifact);
  for (const artifact of latestByReference.values()) {
    // The HTTP sandbox runtime record is deliberately ephemeral: cancelling
    // or stopping the local process removes it, after which Router's normal
    // generate_visual chain recreates a fresh run-local service. It is not a
    // persisted business artifact and must not turn a valid restart into an
    // unrecoverable data-integrity fault.
    if (artifact.reference === 'visual-sandbox-runtime.json') continue;
    const candidate = path.resolve(root, artifact.reference);
    if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) issues.push({ type: 'registered-artifact-missing', artifactId: artifact.artifact_id, reference: artifact.reference, expectedSha256: artifact.sha256, registeredAt: artifact.created_at });
    else if (`sha256:${crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex')}` !== artifact.sha256) issues.push({ type: 'registered-artifact-hash-mismatch', artifactId: artifact.artifact_id, artifactStatus: artifact.status, reference: artifact.reference });
  }
  for (const edge of edges) if (!registered.some(item => item.artifact_id === edge.parent_artifact_id) || !registered.some(item => item.artifact_id === edge.child_artifact_id)) issues.push({ type: 'artifact-lineage-broken', parentArtifactId: edge.parent_artifact_id, childArtifactId: edge.child_artifact_id });
  const agentRuntime = agentRuntimeStatus(runDir);
  if (state.lifecycle !== 'cancelled') for (const transaction of pendingRevisionTransactions(runDir)) issues.push({ type: 'prompt-revision-pending', transactionId: transaction.transactionId, checkpoint: transaction.checkpoint, startedAt: transaction.at });
  for (const job of agentRuntime.jobs.filter(item => item.status === 'dead-letter')) issues.push({ type: 'agent-job-dead-letter', jobId: job.jobId, agentId: job.agentId, stage: job.stage, error: job.error || null });
  for (const job of running) {
    const expiry = job.lease_expires_at ? Date.parse(job.lease_expires_at) : job.started_at ? Date.parse(job.started_at) + AGENT_JOB_LEASE_MS : NaN;
    if (!Number.isFinite(expiry) || expiry <= Date.now()) issues.push({ type: 'agent-job-lease-expired', jobId: job.job_id, agentId: job.agent_id, stage: job.stage, startedAt: job.started_at || null, leaseMs: AGENT_JOB_LEASE_MS });
  }
  return { status: issues.length ? 'repair-required' : 'consistent', revision: Number(state.revision || 0), issues, runningEvents: running.length, artifactLineage: { registered: registered.length, edges: edges.length }, agentRuntime };
}

export const runLedgerPaths = runDir => ({ state: statePath(runDir), ledger: ledgerPath(runDir) });
