import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { initializeLedger, fenceRunCancellation } from './run-ledger.mjs';
import { runControlledSubprocess } from './controlled-subprocess.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-subprocess-'));
try {
  const state={runId:'subprocess',revision:1,lifecycle:'active',artifacts:{}};fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));initializeLedger(dir,state,'fixture');
  const options={env:process.env,runDir:dir,timeoutMs:5000,pollMs:50};
  const ok=await runControlledSubprocess(process.execPath,['-e','process.stdout.write("ok")'],options);assert.equal(ok.status,0);assert.equal(ok.stdout,'ok');
  const missing=await runControlledSubprocess(path.join(dir,'missing-executable'),[],options);assert.equal(missing.error?.code,'ENOENT');
  const monitorDir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-monitor-'));
  try {
    const noLedger=await runControlledSubprocess(process.execPath,['-e','process.exit(0)'],{...options,runDir:monitorDir});
    assert.equal(noLedger.error?.code,'APEX_MONITOR_UNAVAILABLE');
    const monitorState={runId:'monitor',revision:1,lifecycle:'active',artifacts:{}};fs.writeFileSync(path.join(monitorDir,'state.json'),JSON.stringify(monitorState));initializeLedger(monitorDir,monitorState,'fixture');
    const ledger=path.join(monitorDir,'run-ledger.sqlite'), backup=path.join(monitorDir,'ledger.backup');
    const transient=runControlledSubprocess(process.execPath,['-e','setTimeout(()=>process.exit(0),600)'],{...options,runDir:monitorDir,pollMs:25,monitorFailureGraceMs:250});
    setTimeout(()=>fs.renameSync(ledger,backup),100);setTimeout(()=>fs.renameSync(backup,ledger),175);
    const recovered=await transient;assert.equal(recovered.status,0);assert.equal(recovered.error,null);
    const completion=runControlledSubprocess(process.execPath,['-e','setTimeout(()=>process.exit(0),150)'],{...options,runDir:monitorDir,pollMs:25,monitorFailureGraceMs:1000});
    setTimeout(()=>fs.renameSync(ledger,backup),100);
    const unverifiedCompletion=await completion;assert.equal(unverifiedCompletion.status,0);assert.equal(unverifiedCompletion.error?.code,'APEX_MONITOR_UNAVAILABLE');
    fs.renameSync(backup,ledger);
    const unavailable=runControlledSubprocess(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,runDir:monitorDir,pollMs:25,monitorFailureGraceMs:100});
    setTimeout(()=>fs.renameSync(ledger,backup),100);
    const interrupted=await unavailable;assert.equal(interrupted.error?.code,'APEX_MONITOR_UNAVAILABLE');assert.equal(interrupted.cancelled,false);assert.ok(interrupted.signal);
    fs.renameSync(backup,ledger);
  } finally {fs.rmSync(monitorDir,{recursive:true,force:true});}
  const timed=await runControlledSubprocess(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,timeoutMs:150});assert.equal(timed.error?.code,'ETIMEDOUT');assert.ok(timed.signal);
  const excess=await runControlledSubprocess(process.execPath,['-e','process.stdout.write("x".repeat(4096))'],{...options,maxBuffer:100});assert.equal(excess.error?.code,'ENOBUFS');
  if (process.platform !== 'win32') {
    const ready=path.join(dir,'grandchild-ready');
    const grandchild=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
    const nested=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    const began=Date.now();
    const tree=await Promise.race([runControlledSubprocess(process.execPath,['-e',nested],{...options,timeoutMs:1000}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('process tree did not stop')),6000).unref())]);
    assert.ok(fs.existsSync(ready),'the signal-ignoring child must start before timeout');assert.equal(tree.error?.code,'ETIMEDOUT');assert.ok(Date.now()-began>=2800,'the child must require escalation after ignoring SIGTERM');
  }
  const pending=runControlledSubprocess(process.execPath,['-e','setInterval(()=>{},1000)'],options);setTimeout(()=>fenceRunCancellation(dir,'session','fixture'),150);const stopped=await pending;assert.equal(stopped.cancelled,true);assert.ok(stopped.signal);
  console.log(JSON.stringify({status:'passed',checks:process.platform==='win32'?16:19,scope:'local-subprocess-success-timeout-output-limit-cancellation-and-monitor-recovery'}));
} finally {fs.rmSync(dir,{recursive:true,force:true});}
