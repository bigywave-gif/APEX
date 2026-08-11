import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');

export function requireRouterAction(runDir, expectedActions) {
  const { APEX_ROUTER_PROJECT_ROOT: projectRoot, APEX_ROUTER_RUN_ID: runId, APEX_ROUTER_SESSION_ID: sessionId, APEX_ROUTER_AUTHORIZATION_REF: reference, APEX_ROUTER_ACTION: issuedAction } = process.env;
  const allowed = Array.isArray(expectedActions) ? expectedActions : [expectedActions];
  if (!projectRoot || !runId || !sessionId || !reference || !allowed.includes(issuedAction)) throw new Error(`Router authorization is required for ${allowed.join(' or ')}`);
  const expectedRun = path.resolve(projectRoot, '.apex', 'runs', runId);
  if (!fs.existsSync(expectedRun) || path.resolve(runDir) !== expectedRun) throw new Error('Router authorization run does not match this runtime invocation');
  const verification = spawnSync(process.execPath, [router, 'verify-authorization', projectRoot, runId, sessionId, reference, issuedAction], { encoding: 'utf8' });
  if (verification.status !== 0) throw new Error((verification.stderr || verification.stdout).trim());
}
