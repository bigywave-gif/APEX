import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function lstatIfExists(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function projectLayout(runDir) {
  const requested = path.resolve(runDir), requestedRuns = path.dirname(requested), requestedApex = path.dirname(requestedRuns);
  if (path.basename(requestedRuns) !== 'runs' || path.basename(requestedApex) !== '.apex') return null;
  const project = fs.realpathSync(path.dirname(requestedApex)), apex = path.join(project, '.apex'), runs = path.join(apex, 'runs');
  const real = fs.realpathSync(requested);
  if (fs.realpathSync(requestedRuns) !== runs || real !== path.join(runs, path.basename(requested))) throw new Error('project Run directory must not use a symlink');
  return { runDir: real, runs, database: path.join(apex, 'external-submissions.sqlite') };
}
function pendingStatus(item) { return item.operation === 'upload' ? !['consumed', 'not-submitted'].includes(item.status) : !['ready', 'not-submitted'].includes(item.status); }
function projectId(value) { return typeof value === 'string' && value ? value.replace(/^projects\//, '') : null; }
function conflicts(existing, candidate) {
  const left = projectId(existing.projectId), right = projectId(candidate.projectId);
  return existing.provider === candidate.provider && pendingStatus(existing)
    && (!existing.imageHash || existing.imageHash === candidate.imageHash)
    && (!existing.promptHash || existing.promptHash === candidate.promptHash)
    && (!left || !right || left === right);
}
function previousRunIntents(layout, includeCurrent = false) {
  const results = [];
  for (const entry of fs.readdirSync(layout.runs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(layout.runs, entry.name);
    if (!includeCurrent && fs.realpathSync(dir) === layout.runDir) continue;
    const ledger = path.join(dir, 'run-ledger.sqlite');
    let intents = [];
    const ledgerStat = lstatIfExists(ledger);
    if (ledgerStat) {
      if (ledgerStat.isSymbolicLink()) throw new Error('previous Run ledger must not be a symlink');
      const db = new DatabaseSync(ledger, { readOnly: true });
      try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").get()) {
          const indexed = new Map();
          for (const row of db.prepare("SELECT event_type, payload_json FROM events WHERE event_type IN ('external-submission-intent','external-submission-observation') ORDER BY id").all()) {
            let value; try { value = JSON.parse(row.payload_json); } catch { throw new Error('cannot verify previous Run external-submission evidence'); }
            if (!value?.intentId) continue;
            if (row.event_type === 'external-submission-intent') indexed.set(value.intentId, value);
            else if (indexed.has(value.intentId)) indexed.set(value.intentId, { ...indexed.get(value.intentId), ...value });
          }
          intents = [...indexed.values()];
        }
      } finally { db.close(); }
    }
    results.push(...intents.map(item => ({ ...item, runId: entry.name })));
    const jobFile = path.join(dir, 'stitch-job.json');
    const jobStat = lstatIfExists(jobFile);
    if (jobStat) {
      if (jobStat.isSymbolicLink()) throw new Error('previous Run Stitch job must not be a symlink');
      let job; try { job = JSON.parse(fs.readFileSync(jobFile, 'utf8')); } catch { throw new Error('cannot verify previous Run Stitch job'); }
      if (job.status !== 'ready' && (!job.intentId || !intents.some(item => item.intentId === job.intentId))) results.push({ runId: entry.name, intentId: job.intentId || null, provider: 'stitch', status: job.status || 'unknown', imageHash: job.imageHash || null, promptHash: job.promptHash || null, projectId: job.projectId || null, source: 'job-without-ledger-intent' });
    }
  }
  return results;
}
function openRegistry(layout) {
  if (lstatIfExists(layout.database)?.isSymbolicLink()) throw new Error('project external-submission registry must not be a symlink');
  const db = new DatabaseSync(layout.database);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS submissions (intent_id TEXT PRIMARY KEY, run_dir TEXT NOT NULL, provider TEXT NOT NULL, operation TEXT NOT NULL, image_hash TEXT NOT NULL, prompt_hash TEXT NOT NULL, project_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  return db;
}
export function inspectProjectExternalIntents(runDir) {
  const layout = projectLayout(runDir);
  if (!layout) throw new Error('a project-local Run directory is required');
  const history = previousRunIntents(layout, true);
  const stat = lstatIfExists(layout.database);
  if (stat?.isSymbolicLink()) throw new Error('project external-submission registry must not be a symlink');
  let reservations = [];
  if (stat) {
    const db = new DatabaseSync(layout.database, { readOnly: true });
    try { reservations = db.prepare("SELECT intent_id AS intentId, run_dir AS runDir, provider, operation, image_hash AS imageHash, prompt_hash AS promptHash, project_id AS projectId, status, created_at AS createdAt, updated_at AS updatedAt FROM submissions WHERE status NOT IN ('ready','consumed','not-submitted') ORDER BY created_at").all(); }
    finally { db.close(); }
  }
  return {
    schemaVersion: '1.0', status: 'inspected', registryPresent: Boolean(stat),
    reservations: reservations.map(({ runDir: owner, ...item }) => ({ ...item, runId: path.basename(owner), ledgerIntent: history.some(entry => entry.runId === path.basename(owner) && entry.intentId === item.intentId && entry.source !== 'job-without-ledger-intent') ? 'present' : 'not-found' })),
    pendingRunIntents: history.filter(pendingStatus).map(item => ({ runId: item.runId, intentId: item.intentId || null, provider: item.provider || null, operation: item.operation || 'generation', status: item.status || 'unknown', projectId: item.projectId || null, imageHash: item.imageHash || null, promptHash: item.promptHash || null, source: item.source || 'run-ledger' })),
    note: 'Read-only. A missing ledger intent does not prove that a remote request was not sent; no reservation was released.'
  };
}
export function reserveProjectExternalIntent(runDir, intent) {
  const layout = projectLayout(runDir); if (!layout) return;
  const db = openRegistry(layout), now = new Date().toISOString();
  try {
    db.exec('BEGIN IMMEDIATE');
    const rows = db.prepare("SELECT intent_id AS intentId, run_dir AS runDir, provider, operation, image_hash AS imageHash, prompt_hash AS promptHash, project_id AS projectId, status FROM submissions WHERE status NOT IN ('ready','consumed','not-submitted')").all();
    const ownUpload = item => intent.operation !== 'upload' && item.runDir === layout.runDir && item.intentId === intent.uploadIntentId && item.operation === 'upload' && item.status === 'uploaded';
    if (rows.some(item => item.runDir === layout.runDir && !ownUpload(item))) throw new Error('an unresolved external submission already exists in this Run');
    const conflict = rows.find(item => !ownUpload(item) && conflicts(item, intent)) || previousRunIntents(layout).find(item => conflicts(item, intent));
    if (conflict) throw new Error(`an unresolved matching external submission exists in another Run; run=${conflict.runId || path.basename(conflict.runDir || 'unknown')} intent=${conflict.intentId || 'legacy'} status=${conflict.status || 'unknown'}; use project-external-inspect.mjs inspect <current-run-dir> before any retry`);
    db.prepare('INSERT INTO submissions (intent_id,run_dir,provider,operation,image_hash,prompt_hash,project_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(intent.intentId, layout.runDir, intent.provider, intent.operation === 'upload' ? 'upload' : 'generation', intent.imageHash, intent.promptHash, intent.projectId || null, 'submission-uncertain', now, now);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; } finally { db.close(); }
}
export function releaseUnsubmittedProjectIntent(runDir, intentId) {
  const layout = projectLayout(runDir); if (!layout) return;
  const db = openRegistry(layout);
  try { db.prepare("UPDATE submissions SET status='not-submitted', updated_at=? WHERE intent_id=? AND run_dir=? AND status='submission-uncertain'").run(new Date().toISOString(), intentId, layout.runDir); }
  finally { db.close(); }
}
export function updateProjectExternalObservation(runDir, observation) {
  const layout = projectLayout(runDir); if (!layout) return;
  const db = openRegistry(layout);
  try { db.prepare('UPDATE submissions SET status=?, updated_at=? WHERE intent_id=? AND run_dir=?').run(observation.status, new Date().toISOString(), observation.intentId, layout.runDir); }
  finally { db.close(); }
}
