import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function acquireRuntimeStartLock(runDir) {
  const file = path.join(runDir, 'runtime-start-lock.sqlite');
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('runtime start lock must not be a symlink');
  const db = new DatabaseSync(file);
  try { db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE'); return db; }
  catch (error) { db.close(); throw error; }
}

export function runtimeStartLockAvailable(runDir) {
  try { const db = acquireRuntimeStartLock(runDir); try { db.exec('ROLLBACK'); } finally { db.close(); } return true; }
  catch { return false; }
}
