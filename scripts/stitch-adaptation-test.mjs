import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {initializeLedger,appendLedgerEvent} from './run-ledger.mjs';import {buildStitchPrompt,stitchAdaptationForFreeze} from './stitch-adaptation.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-stitch-adaptation-')),hash=x=>'sha256:'+crypto.createHash('sha256').update(x).digest('hex');
try {
 const state={runId:'fixture',revision:1,lifecycle:'active',artifacts:{runtimeVisualBaseline:'baseline.json'}};fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));initializeLedger(dir,state,'fixture');fs.writeFileSync(path.join(dir,'baseline.json'),'confirmed baseline');fs.mkdirSync(path.join(dir,'operations'));
 const content='fixture stitch instructions',skill={name:'stitch-design-taste',path:'/fixture/SKILL.md',sha256:hash(content),content};
 const plan={prompt:'Preserve the task',skillUse:{name:skill.name,sha256:skill.sha256,appliedRules:['Keep the confirmed hierarchy'],excludedRules:[{rule:'Unbounded motion',reason:'The Demo does not use it'}],rationale:'Reflect the approved interface'}};
 assert.throws(()=>buildStitchPrompt(dir,state,plan),/successful load receipt/);
 const receipt={status:'succeeded',action:'sync_stitch',script:'stitch-sync.mjs',stdout:JSON.stringify({status:'loaded',skill})},file=path.join(dir,'operations/load.json');fs.writeFileSync(file,JSON.stringify(receipt));appendLedgerEvent(dir,{type:'stitch-adaptation-skill-loaded',name:skill.name,path:skill.path,sha256:skill.sha256,demoBaselineHash:hash('confirmed baseline'),operationReceipt:'operations/load.json'});
 const result=buildStitchPrompt(dir,state,plan);assert.match(result.prompt,/Keep the confirmed hierarchy/);assert.equal(result.adaptation.demoBaselineHash,hash('confirmed baseline'));assert.deepEqual(result.adaptation.excludedRules,plan.skillUse.excludedRules);
 const job={promptHash:hash(result.prompt),skillAdaptation:result.adaptation},selection={generationInput:{promptHash:job.promptHash}};assert.deepEqual(stitchAdaptationForFreeze(dir,state,job,selection),result.adaptation);assert.throws(()=>stitchAdaptationForFreeze(dir,state,job,{generationInput:{promptHash:'wrong'}}),/actual submitted prompt hash/);
 const changed={...receipt,status:'failed'};fs.writeFileSync(file,JSON.stringify(changed));assert.throws(()=>buildStitchPrompt(dir,state,plan),/successful load receipt/);fs.writeFileSync(file,JSON.stringify(receipt));
 fs.writeFileSync(path.join(dir,'baseline.json'),'changed baseline');assert.throws(()=>buildStitchPrompt(dir,state,plan),/successful load receipt/);
 assert.equal(buildStitchPrompt(dir,state,{prompt:'plain'}).prompt,'plain');assert.throws(()=>buildStitchPrompt(dir,state,{...plan,skillUse:{...plan.skillUse,excludedRules:[{rule:'motion',reason:''}]}}),/excluded-rule reasons/);
 console.log(JSON.stringify({status:'passed',checks:10,scope:'synthetic receipt and confirmed-Demo binding'}));
} finally {fs.rmSync(dir,{recursive:true,force:true});}
