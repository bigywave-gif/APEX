import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { pathToFileURL } from 'node:url';
import { initializeLedger, externalSubmissionIntents, appendLedgerEvent, recordExternalSubmissionIntent } from './run-ledger.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-external-concurrency-'));
try {
  const state={runId:'concurrent',revision:1,lifecycle:'active',artifacts:{}}; fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));initializeLedger(dir,state,'fixture');
  const moduleUrl=pathToFileURL(path.join(path.dirname(process.argv[1]),'run-ledger.mjs')).href;
  const code=`import {recordExternalSubmissionIntent} from ${JSON.stringify(moduleUrl)}; try {recordExternalSubmissionIntent(process.argv[1],{intentId:process.argv[2],provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt'});console.log('acquired')} catch(e) {console.log(e.stack);process.exitCode=2}`;
  const invoke=id=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code,dir,id]);let out='';child.stdout.on('data',x=>out+=x);child.on('error',reject);child.on('close',status=>resolve({status,out}));});
  const results=await Promise.all([invoke('first'),invoke('second')]);assert.equal(results.filter(item=>item.status===0).length,1,JSON.stringify(results));assert.equal(results.filter(item=>item.status===2&&item.out.includes('unresolved external upload')).length,1,JSON.stringify(results));
  const upload=externalSubmissionIntents(dir)[0];assert.equal(upload.status,'submission-uncertain');
  assert.throws(()=>recordExternalSubmissionIntent(dir,{intentId:'generation',provider:'stitch',uploadIntentId:upload.intentId,imageHash:'sha256:image',promptHash:'sha256:prompt'}),/completed upload/);
  appendLedgerEvent(dir,{type:'external-submission-observation',intentId:upload.intentId,status:'uploaded'});
  recordExternalSubmissionIntent(dir,{intentId:'generation',provider:'stitch',uploadIntentId:upload.intentId,imageHash:'sha256:image',promptHash:'sha256:prompt'});
  assert.throws(()=>recordExternalSubmissionIntent(dir,{intentId:'third',provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt'}),/unresolved external generation/);
  console.log(JSON.stringify({status:'passed',checks:5,scope:'two concurrent local processes; no external calls'}));
} finally {fs.rmSync(dir,{recursive:true,force:true});}
