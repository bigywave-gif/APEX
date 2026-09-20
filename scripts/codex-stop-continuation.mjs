#!/usr/bin/env node
/**
 * Codex Stop hook for APEX.
 *
 * Skills can describe a continuation rule, but a skill cannot prevent the host
 * from ending a turn.  This hook closes that gap: when the current Codex
 * session is bound to an active APEX run and Router says a user response is
 * forbidden, Codex receives a continuation prompt instead of ending the turn.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';
import { sessionBridge } from './codex-session-bridge.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function sessionFile(projectRoot, sessionId) {
  const hash = crypto.createHash('sha256').update(sessionId).digest('hex');
  return path.join(projectRoot, '.apex', 'sessions', `${hash}.json`);
}
function firstString(source, keys) {
  for (const key of keys) if (typeof source[key] === 'string' && source[key].trim()) return source[key];
  return null;
}
function comparableSessionId(value) {
  return String(value || '').trim().replace(/^codex-root-/, '');
}
function sameCodexThread(left, right) {
  const a = comparableSessionId(left);
  const b = comparableSessionId(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // APEX historically stored `codex-root-<thread-prefix>`, while current
  // desktop hooks supply the full host thread UUID. Accept only the shared
  // UUID prefix (minimum eight characters), never a loose substring.
  const min = Math.min(a.length, b.length);
  return min >= 8 && (a.startsWith(b) || b.startsWith(a));
}
function boundSession(start, incomingSessionId) {
  let cursor = path.resolve(start);
  while (true) {
    const exact = sessionFile(cursor, incomingSessionId);
    if (fs.existsSync(exact)) {
      const binding = JSON.parse(fs.readFileSync(exact, 'utf8'));
      return { projectRoot: cursor, binding };
    }
    const bridge = sessionBridge(cursor, incomingSessionId);
    if (bridge) {
      const mapped = sessionFile(cursor, bridge.apexSessionId);
      if (fs.existsSync(mapped)) return { projectRoot: cursor, binding: JSON.parse(fs.readFileSync(mapped, 'utf8')) };
    }
    const sessionsRoot = path.join(cursor, '.apex', 'sessions');
    if (fs.existsSync(sessionsRoot)) {
      for (const entry of fs.readdirSync(sessionsRoot)) {
        if (!entry.endsWith('.json')) continue;
        try {
          const binding = JSON.parse(fs.readFileSync(path.join(sessionsRoot, entry), 'utf8'));
          if (sameCodexThread(binding.sessionId, incomingSessionId)) return { projectRoot: cursor, binding };
        } catch {
          // Ignore a transient or malformed unrelated session record.
        }
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const cwd = firstString(input, ['cwd', 'workspace_path', 'workspacePath', 'project_root', 'projectRoot']);
  const sessionId = firstString(input, ['session_id', 'sessionId', 'thread_id', 'threadId']);
  if (!cwd || !sessionId || fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) { output({}); process.exit(0); }
  const bound = boundSession(cwd, sessionId);
  if (!bound) { output({}); process.exit(0); }
  const { projectRoot, binding } = bound;
  if (!binding.runId || binding.lifecycle === 'closed') { output({}); process.exit(0); }
  const result = spawnSync(process.execPath, [router, 'status', projectRoot, binding.runId, binding.sessionId], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) { output({}); process.exit(0); }
  const status = JSON.parse(result.stdout);
  const contract = status.terminalResponseContract || {};
  // A real failed controlled action is a valid terminal blocking report. Do
  // not convert it into an infinite Stop-hook continuation loop; the Router
  // has already classified it and supplied its immutable operation receipt.
  if (contract.allowed !== false || !contract.mustContinueAction || contract.blockingOperation) { output({}); process.exit(0); }
  // A repeated Stop event with an unchanged automatic node means the required
  // action did not produce a Router receipt. The former one-shot de-duplication
  // treated that as permission to end the turn, stranding every automatic
  // chain after one progress message. Keep the turn blocked until Router state
  // advances. Receipt-backed failures above remain the sole terminal exception.
  output({
    decision: 'block',
    reason: 'APEX 当前自动步骤尚未产生完成回执。请继续执行 Router 已授权的具体工作；不要向用户显示“继续”、阶段性结论或文件卡片。仅在明确确认点、Demo 路线选择、交付证据或带实际操作回执的阻断报告处结束。'
  });
} catch {
  // A hook must never block unrelated Codex work merely because an APEX run
  // directory or transient router status is unavailable.
  output({});
}
