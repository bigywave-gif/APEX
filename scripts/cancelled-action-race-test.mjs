import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=fs.mkdtempSync(path.join(os.tmpdir(),'apex-cancel-action-race-')),run='race',session='race-session',dir=path.join(project,'.apex/runs',run);
const router=path.join(core,'scripts/apex-router.mjs'), action=path.join(core,'scripts/apex-action.mjs');
const route=args=>{const r=spawnSync(process.execPath,[router,...args],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout)};
let processChild, timer;
try {
  fs.writeFileSync(path.join(project,'index.html'),'<main>fixture</main>');
  route(['intake',project,run,'existing','standard','interactive',session,'确认调用 APEX']);
  const auth=route(['authorize',project,run,session,'collect_existing_baseline']);
  const pipe=path.join(project,'package.json');assert.equal(spawnSync('mkfifo',[pipe]).status,0);
  processChild=spawn(process.execPath,[action,'run',project,run,session,auth.authorizationRef,'collect_existing_baseline','project-intake.mjs','scan',dir,project],{stdio:['ignore','pipe','pipe']});
  let out='',err='';processChild.stdout.on('data',x=>out+=x);processChild.stderr.on('data',x=>err+=x);
  const ended=new Promise(resolve=>processChild.on('close',code=>resolve(code)));
  const writer=await Promise.race([new Promise((resolve,reject)=>fs.open(pipe,'w',(error,fd)=>error?reject(error):resolve(fd))),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('project intake did not open the fixture pipe')),15000)),ended.then(code=>{throw new Error(`action ended before pipe opened: ${code} ${err}`)})]);clearTimeout(timer);
  const cancel=route(['cancel',project,run,session,'取消当前执行']);assert.equal(cancel.status,'cancelled');
  const code=await Promise.race([ended,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('cancelled local tool did not stop')),10000))]);clearTimeout(timer);fs.closeSync(writer);assert.notEqual(code,0,`cancelled action returned success: ${out}`);assert.match(err,/operation finished after cancellation/);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));assert.equal(state.lifecycle,'cancelled');
  const db=new DatabaseSync(path.join(dir,'run-ledger.sqlite'),{readOnly:true});const event=db.prepare("SELECT payload_json FROM events WHERE event_type='late-operation-after-cancellation' ORDER BY id DESC LIMIT 1").get();db.close();
  const late=JSON.parse(event.payload_json);assert.equal(late.sideEffects,'unverified');assert.equal(late.interruptionRequested,true);assert.ok(late.signal);
  assert.equal(fs.existsSync(path.join(dir,'operations')),false);
  assert.equal(fs.existsSync(path.join(dir,'project-inventory.json')),false,'cancelled child must not resume and create a late artifact');
  console.log(JSON.stringify({status:'passed',scope:'real concurrent controlled operation and cancellation; no external calls',lateFiles:fs.readdirSync(dir).filter(x=>!['state.json','events.ndjson','run-ledger.sqlite','run-ledger.sqlite-wal','run-ledger.sqlite-shm','cancellation-receipt.json'].includes(x))}));
} finally {clearTimeout(timer);if(processChild&&!processChild.killed)processChild.kill('SIGTERM');fs.rmSync(project,{recursive:true,force:true});}
