import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { implementationRegistrationCurrent } from './implementation-registration.mjs';
const project=fs.mkdtempSync(path.join(os.tmpdir(),'apex-implementation-registration-')),run=path.join(project,'.apex/runs/run');fs.mkdirSync(run,{recursive:true});
const hash=data=>`sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
try {
 const file=path.join(project,'index.html');put(file,'formal source');
 const map={entries:[{runtimeTarget:['index.html']}]},delta={page:'main'};put(path.join(run,'map.json'),map);put(path.join(run,'delta.json'),delta);
 const receipt={schemaVersion:'3.0',type:'implementation-registration',projectId:`project_${crypto.createHash('sha256').update(fs.realpathSync(project)).digest('hex').slice(0,24)}`,runId:'run',sessionId:'session',authorizationRef:'authorizations/test.json',leaseId:'lease',pageDelta:{path:'delta.json',sha256:hash(JSON.stringify(delta))},implementationMap:{path:'map.json',sha256:hash(JSON.stringify(map))},files:[{path:'index.html',sha256:hash('formal source')}]};put(path.join(run,'receipt.json'),receipt);
 const state={runId:'run',roleChain:{confirmationModel:'two-confirmations',enabled:true},artifacts:{pageDelta:'delta.json',implementationMap:'map.json',implementationRegistration:'receipt.json'}};
 assert.equal(implementationRegistrationCurrent(run,state,project),true);
 put(path.join(run,'receipt.json'),{...receipt,projectId:'project_other'});assert.equal(implementationRegistrationCurrent(run,state,project),false);put(path.join(run,'receipt.json'),receipt);
 put(file,'changed');assert.equal(implementationRegistrationCurrent(run,state,project),false);put(file,'formal source');
 put(path.join(run,'delta.json'),{page:'other'});assert.equal(implementationRegistrationCurrent(run,state,project),false);put(path.join(run,'delta.json'),delta);
 const hidden=path.join(project,'.apex','fake.js');put(hidden,'fake');const badMap={entries:[{runtimeTarget:['.apex/fake.js']}]};put(path.join(run,'map.json'),badMap);put(path.join(run,'receipt.json'),{...receipt,implementationMap:{path:'map.json',sha256:hash(JSON.stringify(badMap))},files:[{path:'.apex/fake.js',sha256:hash('fake')}]});assert.equal(implementationRegistrationCurrent(run,state,project),false);
 put(path.join(run,'map.json'),map);put(path.join(run,'receipt.json'),receipt);fs.unlinkSync(file);fs.symlinkSync('/etc/hosts',file);assert.equal(implementationRegistrationCurrent(run,state,project),false);
 assert.equal(implementationRegistrationCurrent(run,{roleChain:{enabled:false}},project),true);
 console.log(JSON.stringify({status:'passed',checks:7}));
} finally {fs.rmSync(project,{recursive:true,force:true})}
