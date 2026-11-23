import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {initializeLedger,recordExternalSubmissionIntent,recordExternalSubmissionObservation,externalSubmissionIntents,fenceRunCancellation} from './run-ledger.mjs';
import {reserveProjectExternalIntent,inspectProjectExternalIntents} from './project-external-registry.mjs';
import crypto from 'node:crypto';
const project=fs.mkdtempSync(path.join(os.tmpdir(),'apex-cross-run-')),runs=path.join(project,'.apex','runs');
function run(id){const dir=path.join(runs,id);fs.mkdirSync(dir,{recursive:true});const state={runId:id,revision:1,lifecycle:'active',artifacts:{}};fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));initializeLedger(dir,state,'fixture');return dir;}
try {
 const a=run('a'),b=run('b'),c=run('c'),d=run('d'),moduleUrl=pathToFileURL(path.join(path.dirname(process.argv[1]),'run-ledger.mjs')).href;
 const code=`import {recordExternalSubmissionIntent} from ${JSON.stringify(moduleUrl)};try{recordExternalSubmissionIntent(process.argv[1],{intentId:process.argv[2],provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt',projectId:'stitch-project'});console.log('acquired')}catch(e){console.log(e.message);process.exitCode=2}`;
 const invoke=(dir,id)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code,dir,id]);let out='';p.stdout.on('data',x=>out+=x);p.on('error',reject);p.on('close',status=>resolve({status,out,dir,id}));});
 const results=await Promise.all([invoke(a,'first'),invoke(b,'second')]);assert.equal(results.filter(x=>x.status===0).length,1,JSON.stringify(results));assert.equal(results.filter(x=>x.status===2&&x.out.includes('unresolved matching external submission')).length,1,JSON.stringify(results));
 const winner=results.find(x=>x.status===0),loser=results.find(x=>x.status!==0);
 const aliasCheck=run('alias-check');assert.throws(()=>recordExternalSubmissionIntent(aliasCheck,{intentId:'alias',provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt',projectId:'projects/stitch-project'}),/unresolved matching external submission/);
 recordExternalSubmissionIntent(c,{intentId:'different',provider:'stitch',operation:'upload',imageHash:'sha256:other',promptHash:'sha256:prompt',projectId:'stitch-project'});
 assert.equal(externalSubmissionIntents(c).length,1);
 recordExternalSubmissionIntent(d,{intentId:'different-project',provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt',projectId:'other-stitch-project'});assert.equal(externalSubmissionIntents(d).length,1);
 recordExternalSubmissionObservation(winner.dir,{intentId:winner.id,status:'uploaded'});
 recordExternalSubmissionIntent(winner.dir,{intentId:'generation',provider:'stitch',uploadIntentId:winner.id,imageHash:'sha256:image',promptHash:'sha256:prompt',projectId:'stitch-project'});
 recordExternalSubmissionObservation(winner.dir,{intentId:winner.id,status:'consumed'});
 fenceRunCancellation(winner.dir,'session','fixture');
 assert.throws(()=>recordExternalSubmissionIntent(loser.dir,{intentId:'retry',provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt',projectId:'stitch-project'}),/unresolved matching external submission/);
 recordExternalSubmissionObservation(winner.dir,{intentId:'generation',status:'ready'});
 assert.throws(()=>recordExternalSubmissionObservation(winner.dir,{intentId:'generation',status:'submitted'}),/invalid external submission transition/);
 recordExternalSubmissionIntent(loser.dir,{intentId:'resolved-retry',provider:'stitch',operation:'upload',imageHash:'sha256:image',promptHash:'sha256:prompt',projectId:'stitch-project'});
 assert.equal(externalSubmissionIntents(loser.dir).length,1);
 if(process.platform!=='win32'){
  const alias=path.join(runs,'alias');fs.symlinkSync(a,alias);assert.throws(()=>reserveProjectExternalIntent(alias,{intentId:'symlink',provider:'stitch',operation:'upload',imageHash:'sha256:sym',promptHash:'sha256:sym'}),/must not use a symlink/);fs.rmSync(alias);
  const alternate=path.join(project,'alternate','.apex'),alternateRun=path.join(alternate,'runs','x'),outside=path.join(project,'outside-dangling');fs.mkdirSync(alternateRun,{recursive:true});fs.symlinkSync(outside,path.join(alternate,'external-submissions.sqlite'));assert.throws(()=>reserveProjectExternalIntent(alternateRun,{intentId:'registry-symlink',provider:'stitch',operation:'upload',imageHash:'sha256:sym',promptHash:'sha256:sym'}),/registry must not be a symlink/);assert.equal(fs.existsSync(outside),false);
 }
 const legacy=run('legacy'),legacyCheck=run('legacy-check');fs.writeFileSync(path.join(legacy,'stitch-job.json'),JSON.stringify({status:'submission-uncertain',imageHash:'sha256:legacy',promptHash:'sha256:legacy-prompt'}));
 assert.throws(()=>recordExternalSubmissionIntent(legacyCheck,{intentId:'legacy-retry',provider:'stitch',operation:'upload',imageHash:'sha256:legacy',promptHash:'sha256:legacy-prompt'}),/unresolved matching external submission/);
 fs.writeFileSync(path.join(legacy,'stitch-job.json'),JSON.stringify({intentId:'lost-ledger-intent',status:'submission-uncertain',imageHash:'sha256:legacy',promptHash:'sha256:legacy-prompt'}));
 assert.throws(()=>recordExternalSubmissionIntent(legacyCheck,{intentId:'legacy-retry-2',provider:'stitch',operation:'upload',imageHash:'sha256:legacy',promptHash:'sha256:legacy-prompt'}),/unresolved matching external submission/);
 fs.rmSync(path.join(legacy,'stitch-job.json'));
 const noState=path.join(runs,'no-state');fs.mkdirSync(noState,{recursive:true});const cleanRetry=run('clean-retry');
 assert.throws(()=>recordExternalSubmissionIntent(noState,{intentId:'not-sent',provider:'stitch',operation:'upload',imageHash:'sha256:clean',promptHash:'sha256:clean-prompt'}),/cancelled run/);
 recordExternalSubmissionIntent(cleanRetry,{intentId:'clean-retry',provider:'stitch',operation:'upload',imageHash:'sha256:clean',promptHash:'sha256:clean-prompt'});assert.equal(externalSubmissionIntents(cleanRetry).length,1);
 const orphanOwner=run('orphan-owner'),orphanCheck=run('orphan-check');
 reserveProjectExternalIntent(orphanOwner,{intentId:'orphan',provider:'stitch',operation:'upload',imageHash:'sha256:orphan',promptHash:'sha256:orphan-prompt'});
 assert.throws(()=>recordExternalSubmissionIntent(orphanCheck,{intentId:'orphan-retry',provider:'stitch',operation:'upload',imageHash:'sha256:orphan',promptHash:'sha256:orphan-prompt'}),/unresolved matching external submission/);
 const registryFile=path.join(project,'.apex','external-submissions.sqlite'),digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),beforeInspect=digest(registryFile);
 const inspection=inspectProjectExternalIntents(orphanCheck), orphan=inspection.reservations.find(item=>item.intentId==='orphan');assert.equal(orphan.ledgerIntent,'not-found');assert.match(inspection.note,/does not prove/);assert.equal(digest(registryFile),beforeInspect);
 const cli=spawnSync(process.execPath,[path.join(path.dirname(process.argv[1]),'project-external-inspect.mjs'),'inspect',orphanCheck],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).reservations.find(item=>item.intentId==='orphan').ledgerIntent,'not-found');assert.equal(digest(registryFile),beforeInspect);
 const otherProject=path.join(project,'empty'),emptyRun=path.join(otherProject,'.apex','runs','empty');fs.mkdirSync(emptyRun,{recursive:true});const empty=inspectProjectExternalIntents(emptyRun);assert.equal(empty.registryPresent,false);assert.equal(fs.existsSync(path.join(otherProject,'.apex','external-submissions.sqlite')),false);

 const bad=run('bad');fs.writeFileSync(path.join(bad,'stitch-job.json'),'{');const badCheck=run('bad-check');assert.throws(()=>recordExternalSubmissionIntent(badCheck,{intentId:'bad-retry',provider:'stitch',operation:'upload',imageHash:'sha256:bad',promptHash:'sha256:bad-prompt'}),/cannot verify previous Run Stitch job/);
 console.log(JSON.stringify({status:'passed',checks:process.platform==='win32'?22:25,scope:'two concurrent Runs, cancellation, ready observation, independent inputs, legacy job, orphan reservation; no remote calls'}));
} finally {fs.rmSync(project,{recursive:true,force:true});}
