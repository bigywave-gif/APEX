#!/usr/bin/env node
/**
 * Best-effort Codex PreToolUse guard.
 *
 * Codex may retain a Skill snapshot for a running conversation. Before a
 * tool is used, refresh only an already-bound APEX session from the canonical
 * Core. This is intentionally side-effect free for project state: it updates
 * session binding metadata only when the Core/Bridge hash changed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';
import { recordHostSessionBridge, sessionBridge } from './codex-session-bridge.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const output = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const sessionFileName = sessionId => `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`;
function firstString(source, keys) {
  for (const key of keys) if (typeof source[key] === 'string' && source[key].trim()) return source[key];
  return null;
}

function boundProjectRoot(start, sessionId) {
  let cursor = path.resolve(start);
  const marker = sessionFileName(sessionId);
  while (true) {
    if (fs.existsSync(path.join(cursor, '.apex', 'sessions', marker))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const sessionId = firstString(input, ['session_id', 'sessionId', 'thread_id', 'threadId']);
  const cwd = firstString(input, ['cwd', 'workspace_path', 'workspacePath', 'project_root', 'projectRoot']);
  if (!sessionId || !cwd || fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) { output({}); process.exit(0); }
  recordHostSessionBridge(input);
  const root = boundProjectRoot(cwd, sessionId);
  const bridge = root ? null : sessionBridge(path.resolve(cwd), sessionId);
  const target = root ? { root, sessionId } : bridge ? { root: bridge.projectRoot, sessionId: bridge.apexSessionId } : null;
  if (!target) { output({}); process.exit(0); }
  // Never block an unrelated tool call if the local run was removed or the
  // Router is transiently unavailable. The Stop hook remains the enforcement
  // boundary for an active automatic chain.
  spawnSync(process.execPath, [router, 'refresh-session', target.root, target.sessionId], { encoding: 'utf8', timeout: 10000 });
  output({});
} catch {
  output({});
}
