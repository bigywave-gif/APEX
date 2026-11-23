import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apex-ledger-init-race-'));
try {
 const moduleUrl=pathToFileURL(path.join(path.dirname(process.argv[1]),'run-ledger.mjs')).href;
 const code=`import {initializeLedger} from ${JSON.stringify(moduleUrl)};try{initializeLedger(process.argv[1],{runId:'fixture',revision:1,lifecycle:'active',artifacts:{}},'concurrent-init');}catch(e){console.error(e.stack);process.exitCode=1}`;
 const invoke=dir=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code,dir]);let err='';p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',status=>resolve({status,err}));});
 for(let i=0;i<10;i++){const dir=path.join(root,String(i));fs.mkdirSync(dir);const results=await Promise.all([invoke(dir),invoke(dir)]);assert.ok(results.every(x=>x.status===0),JSON.stringify({iteration:i,results}));}
 console.log(JSON.stringify({status:'passed',checks:10,scope:'concurrent initial ledger creation'}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
