#!/usr/bin/env node
/**
 * Verifies lifecycle guards against the payload aliases used by Codex hosts
 * and nested workspace CWDs. Hooks may refresh bindings, but may never move a
 * Gate or mutate formal project files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const preTool = path.join(apexRoot, 'scripts', 'codex-pretool-session-refresh.mjs');
const stop = path.join(apexRoot, 'scripts', 'codex-stop-continuation.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-lifecycle-hook-'));
const nested = path.join(root, 'src', 'features');
const sessionId = 'hook-contract-session';
function execute(file, payload) { return spawnSync(process.execPath, [file], { input: JSON.stringify(payload), encoding: 'utf8', env: process.env, timeout: 15000 }); }
function executeRouter(args) { return spawnSync(process.execPath, [router, ...args], { encoding: 'utf8', env: process.env, timeout: 15000 }); }
try {
  fs.mkdirSync(nested, { recursive: true });
  const intake = executeRouter(['intake', root, 'hook-contract-run', 'greenfield', 'standard', 'interactive', sessionId, '确认调用 APEX']);
  if (intake.status !== 0) throw new Error((intake.stderr || intake.stdout).trim());
  const bindingPath = path.join(root, '.apex', 'sessions', `${crypto.createHash('sha256').update(sessionId).digest('hex')}.json`);
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  binding.apexVersion = 'stale'; binding.bridgeHash = 'stale'; fs.writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  const pre = execute(preTool, { workspacePath: nested, threadId: sessionId });
  if (pre.status !== 0 || pre.stdout.trim() !== '{}') throw new Error(`PreTool refresh guard failed: ${(pre.stderr || pre.stdout).trim()}`);
  const refreshed = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  if (refreshed.apexVersion === 'stale' || refreshed.bridgeHash === 'stale') throw new Error('PreTool refresh guard did not refresh a nested bound session');
  const stopping = execute(stop, { project_root: nested, sessionId });
  const decision = JSON.parse(stopping.stdout || '{}');
  if (stopping.status !== 0 || decision.decision !== 'block' || !String(decision.reason || '').includes('APEX 当前自动步骤尚未产生完成回执') || String(decision.reason || '').includes('Current concrete step')) throw new Error(`Stop guard did not block automatic APEX work without leaking a technical command chain: ${(stopping.stderr || stopping.stdout).trim()}`);
  const repeatedStopping = execute(stop, { project_root: nested, sessionId });
  const repeatedDecision = JSON.parse(repeatedStopping.stdout || '{}');
  if (repeatedStopping.status !== 0 || repeatedDecision.decision !== 'block') throw new Error(`Stop guard must keep an unchanged automatic node blocked until it has a Router receipt: ${(repeatedStopping.stderr || repeatedStopping.stdout).trim()}`);
  const state = JSON.parse(fs.readFileSync(path.join(root, '.apex', 'runs', 'hook-contract-run', 'state.json'), 'utf8'));
  if (state.phase !== 'G-01 PRODUCT') throw new Error('lifecycle hooks must not advance the run state');
  // A failed controlled action is a terminal blocking report, never a reason
  // for the Stop hook to inject the same automatic continuation indefinitely.
  const operations = path.join(root, '.apex', 'runs', 'hook-contract-run', 'operations'); fs.mkdirSync(operations, { recursive: true });
  fs.writeFileSync(path.join(operations, 'policy-failure.json'), JSON.stringify({ schemaVersion: '3.0', action: 'analyze_requirement', script: 'context-compiler.mjs', status: 'failed', startedAt: '2026-09-14T00:00:00.000Z', finishedAt: '2026-09-14T00:00:01.000Z', exitCode: 1, stderr: 'PROJECT_DELETION_POLICY' }) + '\n');
  // Operations-index is only a cache. It may omit stderr/exitCode, but the
  // durable receipt must still classify the real failure correctly.
  fs.writeFileSync(path.join(root, '.apex', 'runs', 'hook-contract-run', 'operations-index.json'), JSON.stringify({ receipts: { 'operations/policy-failure.json': { action: 'analyze_requirement', status: 'failed', finishedAt: '2026-09-14T00:00:01.000Z' } } }) + '\n');
  const blockedStatus = JSON.parse(executeRouter(['status', root, 'hook-contract-run', sessionId]).stdout);
  if (blockedStatus.terminalResponseContract?.allowed !== true || blockedStatus.terminalResponseContract?.allowedKinds?.[0] !== 'blocking-report' || blockedStatus.terminalResponseContract?.blockingOperation?.category !== 'policy-denied' || blockedStatus.userInteraction?.mode !== 'blocking-report') throw new Error('a failed controlled action must surface one typed blocking report instead of an automatic continuation');
  const failedStop = execute(stop, { project_root: nested, sessionId });
  if (failedStop.status !== 0 || failedStop.stdout.trim() !== '{}') throw new Error(`Stop guard must release a receipt-backed block instead of looping: ${(failedStop.stderr || failedStop.stdout).trim()}`);
  const opaqueAlias = 'codex-root-opaque-session-alias'; const opaqueRun = 'opaque-alias-run'; const hostThread = '019fc7b2-83b9-71b1-a627-05de8967cd64';
  const bridgePre = execute(preTool, { workspacePath: nested, threadId: hostThread, tool_input: { cmd: `node ${router} intake ${root} ${opaqueRun} greenfield standard interactive ${opaqueAlias} "确认调用 APEX"` } });
  if (bridgePre.status !== 0 || bridgePre.stdout.trim() !== '{}') throw new Error(`PreTool bridge registration failed: ${(bridgePre.stderr || bridgePre.stdout).trim()}`);
  const opaqueIntake = executeRouter(['intake', root, opaqueRun, 'greenfield', 'standard', 'interactive', opaqueAlias, '确认调用 APEX']);
  if (opaqueIntake.status !== 0) throw new Error((opaqueIntake.stderr || opaqueIntake.stdout).trim());
  const recoveredStop = execute(stop, { project_root: nested, threadId: hostThread });
  const recoveredDecision = JSON.parse(recoveredStop.stdout || '{}');
  if (recoveredStop.status !== 0 || recoveredDecision.decision !== 'block') throw new Error(`Stop guard did not use exact host bridge: ${(recoveredStop.stderr || recoveredStop.stdout).trim()}`);
  console.log(JSON.stringify({ status: 'passed', checks: 8 }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
