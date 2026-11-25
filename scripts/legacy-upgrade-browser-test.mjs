#!/usr/bin/env node
// Runs an actual previous Core in isolation, then checks its Run on this Core.
// User confirmations and role judgments in the old fixture are simulated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacy = process.env.APEX_LEGACY_CORE;
if (!legacy || !fs.existsSync(path.join(legacy, 'manifest.yaml'))) throw new Error('APEX_LEGACY_CORE must point to a readable previous Core');
const tempParent = process.platform === 'darwin' && fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
const root = fs.mkdtempSync(path.join(tempParent, 'axu-')), home = path.join(root, 'home'), core = path.join(home, 'apex/APEX');
const currentHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
fs.mkdirSync(path.dirname(core), { recursive:true });
const filter = file => !['.git','node_modules','.DS_Store'].includes(path.basename(file));
fs.cpSync(legacy, core, { recursive:true, filter });
fs.cpSync(path.join(currentHome, 'skills'), path.join(home, 'skills'), { recursive:true, filter });
const env = { ...process.env, CODEX_HOME:home, TMPDIR:root, APEX_KEEP_HANDOFF_FIXTURE:'1' };
const run = (file, args, timeout=90000) => spawnSync(process.execPath, [path.join(core,'scripts',file), ...args], { encoding:'utf8', env, timeout, maxBuffer:8*1024*1024 });
const ok = (result, label) => { assert.equal(result.status,0,`${label}: ${(result.stderr||result.stdout||'').slice(-1800)}`);return JSON.parse(result.stdout); };
try {
 const oldRun = run('product-to-demo-browser-test.mjs', [], 600000);
 assert.equal(oldRun.status, 0, `legacy fixture: ${(oldRun.stderr||oldRun.stdout).slice(-1800)}`);
 const match = oldRun.stderr.match(/fixture=(.+)/); assert.ok(match, 'legacy fixture path is required');
 const project = fs.realpathSync(match[1].trim()), realRoot = fs.realpathSync(root);
 assert.ok(project.startsWith(`${realRoot}${path.sep}`), 'legacy fixture must remain in the isolated root');
 const id='handoff', session='handoff-session', dir=path.join(project,'.apex/runs',id), approval=path.join(dir,'approvals/demo-demo-approved.json');
 const receiptBefore=fs.readFileSync(approval), before=ok(run('apex-router.mjs',['status',project,id,session]),'legacy status');
 assert.equal(before.apexVersion,'4.44.1'); assert.equal(before.gates.gate2,'passed');
 const staged=path.join(home,'apex/APEX-candidate'), backup=path.join(home,'apex/APEX-legacy-backup');
 fs.cpSync(source, staged, { recursive:true, filter }); fs.renameSync(core, backup); fs.renameSync(staged, core);
 const after=ok(run('apex-router.mjs',['status',project,id,session]),'upgraded status');
 assert.equal(after.apexVersion,'4.45.0'); assert.deepEqual(after.gates,before.gates);
 assert.equal(after.nextRequiredAction,'recover'); assert.ok(!after.allowedActions.includes('revoke_visual'));
 assert.ok(!after.allowedActions.includes('verify')); assert.deepEqual(fs.readFileSync(approval),receiptBefore);
 const authorization=ok(run('apex-router.mjs',['authorize',project,id,session,'recover']),'authorize recovery');
 ok(run('apex-action.mjs',['run',project,id,session,authorization.authorizationRef,'recover','apex-recover.mjs',dir]),'recover');
 const blocked=ok(run('apex-router.mjs',['status',project,id,session]),'recovery status');
 assert.equal(blocked.executionDirective?.blockingOperation?.category,'post-gate-evidence-migration');
 assert.match(blocked.executionDirective.blockingOperation.verificationGap, /resource observations/);
 assert.equal(blocked.executionDirective.blockingOperation.exitCode,0); assert.equal(blocked.terminalResponseContract.allowed,true);
 assert.deepEqual(fs.readFileSync(approval),receiptBefore); assert.equal(blocked.gates.gate2,'passed');
 const repeated=run('apex-router.mjs',['authorize',project,id,session,'recover']);
 assert.notEqual(repeated.status,0,'unchanged migration recovery must not receive another authorization');
 const record=JSON.parse(receiptBefore), screenshot=record.artifactHashes.find(item=>item.path.endsWith('.png'));
 assert.ok(screenshot);const target=path.join(dir,screenshot.path), bytes=fs.readFileSync(target);
 try {
  fs.appendFileSync(target,'fixture-tampering');
  const changed=ok(run('apex-router.mjs',['status',project,id,session]),'changed evidence status');
  assert.ok(!changed.allowedActions.includes('verify'));assert.notEqual(changed.executionDirective?.blockingOperation?.category,'post-gate-evidence-migration');
 } finally { fs.writeFileSync(target,bytes); }
 console.log(JSON.stringify({status:'passed',scope:'4.44.1 fixture through Gate 2; preserved confirmed Demo, controlled recovery, no unchanged retry, changed evidence blocks verification',legacyVersion:before.apexVersion,candidateVersion:after.apexVersion}));
} finally { if (process.env.APEX_KEEP_LEGACY_TEST_FIXTURE === '1') console.error(`legacy-test-root=${root}`); else fs.rmSync(root,{recursive:true,force:true}); }
