import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** Persist intent before an isolated test write; unknown outcomes are never replayed. */
export function openApiMutationJournal(projectRoot) {
  const project = fs.realpathSync(projectRoot), directory = path.join(project, '.apex');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.realpathSync(directory) !== directory) throw new Error('project API journal directory must not be a symlink');
  const file = path.join(directory, 'api-mutation-journal.sqlite');
  if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile())) throw new Error('invalid project API journal');
  const db = new DatabaseSync(file); fs.chmodSync(file, 0o600);
  db.exec('PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS api_mutations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL, sample_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    credentialFingerprint(credential) {
      if (typeof credential !== 'string' || !credential) throw new Error('API credential is missing');
      const keyFile = path.join(directory, 'api-mutation-key');
      try { const fd = fs.openSync(keyFile, 'wx', 0o600); try { fs.writeFileSync(fd, crypto.randomBytes(32)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const stat = fs.lstatSync(keyFile);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('API credential binding key is invalid or not private');
      const key = fs.readFileSync(keyFile); if (key.length !== 32) throw new Error('API credential binding key is invalid');
      return crypto.createHmac('sha256', key).update('APEX API credential binding\0').update(credential).digest('hex');
    },
    async execute(executionId, request, dispatch) {
      if (typeof executionId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(executionId)) throw new Error('write case requires a stable executionId of 16–128 safe characters');
      const fingerprint = digest(request), now = new Date().toISOString();
      let row;
      db.exec('BEGIN IMMEDIATE');
      try {
        row = db.prepare('SELECT fingerprint, status, sample_json FROM api_mutations WHERE id = ?').get(executionId);
        if (!row) db.prepare('INSERT INTO api_mutations VALUES (?, ?, ?, ?, ?, ?)').run(executionId, fingerprint, 'uncertain', null, now, now);
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      if (row) {
        if (row.fingerprint !== fingerprint) throw new Error('write executionId belongs to different input');
        if (row.status !== 'complete' || !row.sample_json) throw new Error('write outcome is uncertain; inspect the test service before any retry');
        return JSON.parse(row.sample_json);
      }
      const sample = await dispatch();
      const result = db.prepare("UPDATE api_mutations SET status = 'complete', sample_json = ?, updated_at = ? WHERE id = ? AND fingerprint = ? AND status = 'uncertain'").run(JSON.stringify(sample), new Date().toISOString(), executionId, fingerprint);
      if (Number(result.changes) !== 1) throw new Error('write outcome could not be durably recorded; inspect before retrying');
      return sample;
    },
    close() { db.close(); }
  };
}
