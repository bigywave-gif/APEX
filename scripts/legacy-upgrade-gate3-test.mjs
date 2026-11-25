#!/usr/bin/env node
// Synthetic roles and confirmations, real previous Core and browser operations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacy = process.env.APEX_LEGACY_CORE;
if (!legacy || !fs.existsSync(path.join(legacy, 'manifest.yaml'))) throw new Error('APEX_LEGACY_CORE must identify the previous Core');
const parent = process.platform === 'darwin' && fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
const root = fs.mkdtempSync(path.join(parent, 'axg-')), home = path.join(root, 'home'), core = path.join(home, 'apex/APEX');
const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const filter = file => !['.git', 'node_modules', '.DS_Store'].includes(path.basename(file));
fs.mkdirSync(path.dirname(core), { recursive: true });
fs.cpSync(legacy, core, { recursive: true, filter });
fs.cpSync(path.join(sourceHome, 'skills'), path.join(home, 'skills'), { recursive: true, filter });
try {
  const previous = fs.readFileSync(path.join(core, 'scripts/product-to-demo-browser-test.mjs'), 'utf8');
  const current = fs.readFileSync(path.join(candidate, 'scripts/product-to-demo-browser-test.mjs'), 'utf8');
  const marker = ' // A malformed matrix must not be committed as a successful verification.';
  assert.equal(previous.split(marker).length, 2); assert.equal(current.split(marker).length, 2);
  const before = previous.split(marker)[0].replace("const invoke=(kind,script,args)=>{const auth=", "let upgraded=false;\nconst invoke=(kind,script,args)=>{if(upgraded&&script==='agent-runtime.mjs'&&args[0]==='claim'&&args.length===4)args=[...args,crypto.randomUUID()];const auth=");
  assert.ok(before.includes('let upgraded=false;'), 'previous fixture invocation hook changed');
  const upgrade = `
 const approvalBefore=fs.readFileSync(path.join(dir,'approvals/demo-demo-approved.json'));
 fs.renameSync(core,core+'-previous');
 fs.cpSync(process.env.APEX_CANDIDATE_CORE,core,{recursive:true,filter:file=>!['.git','node_modules','.DS_Store'].includes(path.basename(file))});
 upgraded=true;
 const candidateState=route(['status',project,id,session]);
 assert.equal(candidateState.apexVersion,'4.45.0'); assert.equal(candidateState.nextRequiredAction,'recover');
 invoke('recover','apex-recover.mjs',[dir]);
 const pending=route(['status',project,id,session]); assert.equal(pending.nextRequiredAction,'recapture_legacy_demo');
 invoke('recapture_legacy_demo','legacy-demo-recapture-run.mjs',[dir]);
 const resumed=route(['status',project,id,session]); assert.equal(resumed.gates.gate2,'passed'); assert.ok(resumed.allowedActions.includes('verify'));
 assert.deepEqual(fs.readFileSync(path.join(dir,'approvals/demo-demo-approved.json')),approvalBefore);
 const withApi=false, restoredOptionalStages=new Set();
 const {npmCacheRoot}=await import('./apex-paths.mjs');
`;
  const test = path.join(core, 'scripts/legacy-upgrade-gate3-fixture.mjs');
  fs.writeFileSync(test, before + upgrade + marker + current.split(marker)[1]);
  const result = spawnSync(process.execPath, [test, '--greenfield-gate3'], { encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CODEX_HOME: home, TMPDIR: root, APEX_CANDIDATE_CORE: candidate, APEX_KEEP_HANDOFF_FIXTURE: '1' } });
  if (result.status !== 0) throw new Error(`legacy Gate 3 fixture failed: ${(result.stderr || result.stdout || result.error?.message || '').slice(-5000)}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'passed');
  console.log(JSON.stringify({ status: 'passed', scope: 'previous Core through formal browser capture, upgraded Core through simulated-role Gate 3', output }));
} finally {
  if (process.env.APEX_KEEP_LEGACY_GATE3_FIXTURE === '1') console.error(`legacy-gate3-root=${root}`);
  else fs.rmSync(root, { recursive: true, force: true });
}
