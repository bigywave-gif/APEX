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

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function sessionFile(projectRoot, sessionId) {
  const hash = crypto.createHash('sha256').update(sessionId).digest('hex');
  return path.join(projectRoot, '.apex', 'sessions', `${hash}.json`);
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const projectRoot = typeof input.cwd === 'string' ? path.resolve(input.cwd) : null;
  const sessionId = typeof input.session_id === 'string' ? input.session_id : null;
  if (!projectRoot || !sessionId || fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) { output({}); process.exit(0); }
  const bindingFile = sessionFile(projectRoot, sessionId);
  if (!fs.existsSync(bindingFile)) { output({}); process.exit(0); }
  const binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  if (!binding.runId || binding.lifecycle === 'closed') { output({}); process.exit(0); }
  const result = spawnSync(process.execPath, [router, 'status', projectRoot, binding.runId, sessionId], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) { output({}); process.exit(0); }
  const status = JSON.parse(result.stdout);
  const contract = status.terminalResponseContract || {};
  if (contract.allowed !== false || !contract.mustContinueAction) { output({}); process.exit(0); }
  output({
    decision: 'block',
    reason: `APEX continuation is mandatory: execute the authorized ${contract.mustContinueAction} chain now. Do not emit a progress-only final response. Re-read Router after each operation; end only at its exact named confirmation, Demo route choice, delivery evidence, or an observed blocking report with an operation receipt.`
  });
} catch {
  // A hook must never block unrelated Codex work merely because an APEX run
  // directory or transient router status is unavailable.
  output({});
}
