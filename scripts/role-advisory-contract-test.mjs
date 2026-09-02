#!/usr/bin/env node
/** Contract test for the controlled, non-interactive professional role chain. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
const roleScript = 'role-advisory.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-role-advisory-'));
function run(script, args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
function expect(result, message) { if (result.status !== 0) throw new Error(`${message}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); }
try {
  const intake = expect(run(router, ['intake', root, 'role-run', 'greenfield', 'full', 'interactive', 'role-session']), 'new role-chain run intake must succeed');
  if (intake.nextRequiredAction !== 'analyze_requirement') throw new Error('new role-chain run must retain the normal Gate 1 automatic action');
  const runDir = path.join(root, '.apex', 'runs', 'role-run');
  const authorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'role selection must receive a normal analyze_requirement authorization');
  const selected = expect(run(action, ['run', root, 'role-run', 'role-session', authorization.authorizationRef, 'analyze_requirement', roleScript, 'select', runDir, 'gate1']), 'role selector must run through the action gateway');
  if (!selected.selectedRoles.includes('product-manager') || !selected.selectedRoles.includes('senior-project-manager')) throw new Error('Gate 1 role selector must activate product and delivery professionals');
  const selection = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories', 'gate1', 'selection.json'), 'utf8'));
  for (const roleId of selection.selectedRoles) {
    const advisory = {
      schemaVersion: '1.0', roleId, stage: 'gate1', adapterVersion: '1.0.0', inputBindings: selection.inputBindings,
      findings: [{ id: `${roleId}-fact`, classification: 'fact', statement: 'The current requirement and delivery artifacts are bound for review.', evidence: selection.inputBindings.map(item => item.path) }],
      recommendations: [{ id: `${roleId}-choice`, choice: 'Keep the approved delivery boundary explicit.', rationale: 'It provides a testable handoff to the visual stage.', alternatives: ['Expand the scope without a new Gate'], acceptance: ['The Gate 1 presentation names scope, risks, and acceptance.'] }], status: 'ready'
    };
    const input = path.join(runDir, `${roleId}-input.json`); fs.writeFileSync(input, `${JSON.stringify(advisory, null, 2)}\n`);
    const recordAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), `role ${roleId} record authorization must be current`);
    expect(run(action, ['run', root, 'role-run', 'role-session', recordAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'record', runDir, 'gate1', input]), `role ${roleId} advisory must be recorded through the action gateway`);
  }
  const summarizeAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'role summary authorization must be current');
  const summary = expect(run(action, ['run', root, 'role-run', 'role-session', summarizeAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'summarize', runDir, 'gate1']), 'role summary must be generated through the action gateway');
  const manifest = JSON.parse(fs.readFileSync(summary.manifest, 'utf8'));
  if (manifest.status !== 'ready' || manifest.stages.gate1.advisories.length !== selection.selectedRoles.length || !manifest.stages.gate1.advisories.every(item => item.operationReceipt) || !manifest.stages.gate1.summarySha256 || !fs.readFileSync(summary.summary, 'utf8').includes('角色决策摘要')) throw new Error('role manifest must retain selected roles, controlled receipts, hashes, and a human-readable synthesis');
  const verifyAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'role verification authorization must be current after summary state registration');
  const verified = expect(run(action, ['run', root, 'role-run', 'role-session', verifyAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'verify', runDir, 'gate1']), 'role manifest verification must run through the action gateway');
  if (verified.status !== 'passed') throw new Error('role verification must produce a passed receipt');
  console.log(JSON.stringify({ status: 'passed', selectedRoles: selection.selectedRoles }));
} catch (error) {
  console.error(`APEX role advisory contract test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
