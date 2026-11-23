import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-confirmation-default-'));
const invoke = (args, legacy = false) => {
  const env = { ...process.env }; delete env.APEX_TEST_LEGACY_ROLE_CHAIN;
  if (legacy) env.APEX_TEST_LEGACY_ROLE_CHAIN = '1';
  const result = spawnSync(process.execPath, [path.join(core, 'scripts/apex-router.mjs'), ...args], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
try {
  const modern = invoke(['intake', project, 'modern', 'greenfield', 'standard', 'interactive', 'modern-session', '确认调用 APEX']);
  assert.equal(modern.confirmationModel, 'two-confirmations');
  assert.equal(modern.nextRequiredAction, 'analyze_requirement');
  assert.match(modern.operatingConstraints.strictFlow, /interactive Demo/);
  const state = JSON.parse(fs.readFileSync(path.join(project, '.apex/runs/modern/state.json')));
  assert.equal(state.roleChain.enabled, true);
  const legacy = invoke(['intake', project, 'legacy', 'greenfield', 'standard', 'interactive', 'legacy-session', '确认调用 APEX'], true);
  assert.equal(legacy.confirmationModel, 'gate-summary-only');
  const resumed = invoke(['status', project, 'legacy', 'legacy-session']);
  assert.equal(resumed.confirmationModel, 'gate-summary-only');
  console.log(JSON.stringify({ status: 'passed', checks: 6, scope: 'new-default-and-legacy-resume' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
