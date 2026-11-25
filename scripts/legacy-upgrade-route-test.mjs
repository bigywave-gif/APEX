#!/usr/bin/env node
// Synthetic confirmations; the previous Core and browser execution are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), legacy = process.env.APEX_LEGACY_CORE;
if (!legacy || !fs.existsSync(path.join(legacy, 'manifest.yaml'))) throw new Error('APEX_LEGACY_CORE must identify the previous Core');
const parent = process.platform === 'darwin' && fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
const root = fs.mkdtempSync(path.join(parent, 'axr-')), home = path.join(root, 'home'), core = path.join(home, 'apex/APEX');
const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const filter = file => !['.git', 'node_modules', '.DS_Store'].includes(path.basename(file));
fs.mkdirSync(path.dirname(core), { recursive: true }); fs.cpSync(legacy, core, { recursive: true, filter }); fs.cpSync(path.join(sourceHome, 'skills'), path.join(home, 'skills'), { recursive: true, filter });
try {
  const file = path.join(core, 'scripts/product-to-demo-browser-test.mjs');
  const mode = process.env.APEX_LEGACY_ROUTE || 'stitch';
  if (!['stitch', 'direct-code', 'unselected', 'unconfirmed'].includes(mode)) throw new Error('invalid APEX_LEGACY_ROUTE');
  const source = fs.readFileSync(file, 'utf8'), marker = mode === 'stitch' ? "  assert.equal(selected.executionDirective.currentStep.id,'create-stitch-candidate');" : mode === 'direct-code' ? " assert.equal(selectedRoute.nextRequiredAction,'compile_visual_bundle');" : mode === 'unselected' ? " assert.equal(confirmed.nextRequiredDecision?.id,'delivery-route');" : " assert.equal(route(['status',project,id,session]).nextRequiredDecision?.id,'demo-confirmation');";
  assert.equal(source.split(marker).length, 2);
  const inject = mode === 'unconfirmed' ? `
  {
  const planBefore=fs.readFileSync(path.join(dir,'approvals/visual-plan-visual-confirmation.json'));
  fs.renameSync(core,core+'-previous'); fs.cpSync(process.env.APEX_CANDIDATE_CORE,core,{recursive:true,filter:file=>!['.git','node_modules','.DS_Store'].includes(path.basename(file))});
  const state=route(['status',project,id,session]);
  assert.equal(state.nextRequiredAction,'recapture_legacy_demo'); assert.ok(!state.allowedActions.includes('revoke_visual')&&!state.allowedActions.includes('select_delivery_route'));
  assert.ok(!fs.existsSync(path.join(dir,'approvals/demo-demo-approved.json')));
  const planFile=path.join(dir,'approvals/visual-plan-visual-confirmation.json');
  try{fs.appendFileSync(planFile,'tamper');const stale=route(['status',project,id,session]);assert.ok(!stale.allowedActions.includes('recapture_legacy_demo')&&!stale.allowedActions.includes('select_delivery_route'));}finally{fs.writeFileSync(planFile,planBefore)}
  const supplement=invoke('recapture_legacy_demo','legacy-demo-recapture-run.mjs',[dir]);
  const presented=route(['status',project,id,session]); assert.equal(presented.nextRequiredDecision?.id,'demo-confirmation');
  assert.ok(!presented.allowedActions.includes('select_delivery_route')); assert.deepEqual(fs.readFileSync(path.join(dir,'approvals/visual-plan-visual-confirmation.json')),planBefore);
  const recaptured=JSON.parse(fs.readFileSync(supplement.capture)), screenshot=path.join(dir,recaptured.evidence[0].screenshot), screenshotBytes=fs.readFileSync(screenshot);
  try{fs.appendFileSync(screenshot,'tamper');const stale=route(['status',project,id,session]);assert.notEqual(stale.nextRequiredDecision?.id,'demo-confirmation');}finally{fs.writeFileSync(screenshot,screenshotBytes)}
  const confirmed=route(['confirm-demo',project,id,session,'after-upgrade','确认交互式 Demo']); assert.equal(confirmed.nextRequiredDecision?.id,'delivery-route');
  const selected=route(['select-route',project,id,session,'direct-code','after-upgrade-route','用户选择直接代码']); assert.equal(selected.nextRequiredAction,'compile_visual_bundle');
  console.log(JSON.stringify({status:'passed',mode:'unconfirmed',after:'demo-confirmation-then-direct-code',gate2:state.gates.gate2}));
  if(runtimePid){try{process.kill(runtimePid,'SIGTERM')}catch{}} process.exit(0);
  }
` : `
  {
  const receiptBefore=fs.readFileSync(path.join(dir,'approvals/demo-demo-approved.json'));
  fs.renameSync(core,core+'-previous'); fs.cpSync(process.env.APEX_CANDIDATE_CORE,core,{recursive:true,filter:file=>!['.git','node_modules','.DS_Store'].includes(path.basename(file))});
  const migrated=route(['status',project,id,session]);
  assert.equal(migrated.nextRequiredAction,'recapture_legacy_demo'); assert.ok(!migrated.allowedActions.includes('revoke_visual'));
  const supplemental=invoke('recapture_legacy_demo','legacy-demo-recapture-run.mjs',[dir]);
  const resumed=route(['status',project,id,session]), state=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))), expected=process.env.APEX_LEGACY_ROUTE||'stitch';
  assert.equal(state.deliveryRoute,expected==='unselected'?null:expected);
  if(expected==='unselected') assert.equal(resumed.nextRequiredDecision?.id,'delivery-route');
  else assert.equal(resumed.nextRequiredAction,expected==='stitch'?'sync_stitch':'compile_visual_bundle');
  assert.deepEqual(fs.readFileSync(path.join(dir,'approvals/demo-demo-approved.json')),receiptBefore);
  const capture=JSON.parse(fs.readFileSync(supplemental.capture)), target=path.join(dir,capture.evidence[0].screenshot), bytes=fs.readFileSync(target);
  try{fs.appendFileSync(target,'tamper');const stale=route(['status',project,id,session]);assert.ok(!stale.allowedActions.includes('sync_stitch')&&!stale.allowedActions.includes('compile_visual_bundle')&&!stale.allowedActions.includes('select_delivery_route'));}finally{fs.writeFileSync(target,bytes)}
  console.log(JSON.stringify({status:'passed',mode:expected,after:resumed.nextRequiredAction||resumed.nextRequiredDecision?.id,gate2:resumed.gates.gate2,receiptPreserved:true}));
  if(runtimePid){try{process.kill(runtimePid,'SIGTERM')}catch{}} process.exit(0);
  }
`;
  fs.writeFileSync(file, source.replace(marker, marker + inject));
  const result = spawnSync(process.execPath, [file, ...(mode === 'stitch' ? ['--stitch-route'] : [])], { encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CODEX_HOME: home, TMPDIR: root, APEX_CANDIDATE_CORE: candidate, APEX_LEGACY_ROUTE: mode, APEX_KEEP_HANDOFF_FIXTURE: '1' } });
  if (result.status !== 0) throw new Error(`legacy route fixture failed: ${(result.stderr || result.stdout || result.error?.message || '').slice(-3000)}`);
  const output = JSON.parse(result.stdout); assert.equal(output.status, 'passed'); console.log(JSON.stringify(output));
} finally { if (process.env.APEX_KEEP_LEGACY_ROUTE_FIXTURE === '1') console.error(`legacy-route-root=${root}`); else fs.rmSync(root, { recursive: true, force: true }); }
