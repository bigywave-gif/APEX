import assert from 'node:assert/strict'; import crypto from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { responsiveEvidenceFailures } from './responsive-evidence.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apex-responsive-evidence-'));fs.mkdirSync(path.join(root,'evidence'));
const hash=data=>`sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
try {
 const ranges=[{class:'mobile',minWidth:320,maxWidth:322},{class:'tablet',minWidth:768,maxWidth:770},{class:'desktop',minWidth:1024,maxWidth:1026}], evidence=[], checks=[];
 for(const range of ranges)for(const width of [range.minWidth,range.minWidth+1,range.maxWidth]){const file=`evidence/${range.class}-${width}.png`,data=`screen-${width}`;fs.writeFileSync(path.join(root,file),data);evidence.push({status:'captured',viewport:`${width}x800`,layoutMetrics:{documentScrollWidth:width,documentClientWidth:width},screenshot:file,screenshotSha256:hash(data)});checks.push({class:range.class,width,screenshot:file});}
 const capture={status:'passed',evidence};const capturePath=path.join(root,'evidence/runtime-browser-capture.json');fs.writeFileSync(capturePath,JSON.stringify(capture));
 const receipts=[{status:'succeeded',action:'verify',script:'browser-capture.mjs',outputFileHashes:{'evidence/runtime-browser-capture.json':hash(JSON.stringify(capture))}}];
 const matrix={rangeChecks:checks,viewports:ranges.map(x=>({name:x.class,class:x.class,width:x.minWidth,height:800,screenshot:`evidence/${x.class}-${x.minWidth}.png`})),states:[{name:'default',applicable:true,screenshot:checks[0].screenshot}]};
 assert.deepEqual(responsiveEvidenceFailures(root,capture,receipts,matrix,{viewports:ranges}),[]);
 const overflow=structuredClone(capture);overflow.evidence[0].layoutMetrics.documentScrollWidth=400;fs.writeFileSync(capturePath,JSON.stringify(overflow));
 const overflowReceipts=[{...receipts[0],outputFileHashes:{'evidence/runtime-browser-capture.json':hash(JSON.stringify(overflow))}}];
 assert.ok(responsiveEvidenceFailures(root,overflow,overflowReceipts,matrix,{viewports:ranges}).some(x=>x.includes('horizontal overflow observed')));
 const missingMetrics=structuredClone(capture);delete missingMetrics.evidence[0].layoutMetrics;fs.writeFileSync(capturePath,JSON.stringify(missingMetrics));
 const missingReceipts=[{...receipts[0],outputFileHashes:{'evidence/runtime-browser-capture.json':hash(JSON.stringify(missingMetrics))}}];
 assert.ok(responsiveEvidenceFailures(root,missingMetrics,missingReceipts,matrix,{viewports:ranges}).some(x=>x.includes('measurement is missing')));
 fs.writeFileSync(capturePath,JSON.stringify(capture));
 const wrong={...matrix,rangeChecks:checks.map((item,i)=>i===1?{...item,width:322}:item)};assert.ok(responsiveEvidenceFailures(root,capture,receipts,wrong,{viewports:ranges}).some(x=>x.includes('mobile:321')));
 const mismatch={...matrix,rangeChecks:checks.map((item,i)=>i===0?{...item,screenshot:checks[1].screenshot}:item)};assert.ok(responsiveEvidenceFailures(root,capture,receipts,mismatch,{viewports:ranges}).some(x=>x.includes('captured width')));
 fs.writeFileSync(path.join(root,checks[0].screenshot),'changed');assert.ok(responsiveEvidenceFailures(root,capture,receipts,matrix,{viewports:ranges}).length);fs.writeFileSync(path.join(root,checks[0].screenshot),'screen-320');
 assert.ok(responsiveEvidenceFailures(root,capture,[],matrix,{viewports:ranges})[0].includes('controlled formal browser capture'));
 const outside=path.join(root,'evidence/outside.png');fs.symlinkSync('/etc/hosts',outside);assert.ok(responsiveEvidenceFailures(root,capture,receipts,{...matrix,viewports:[{name:'escaped',width:320,height:800,screenshot:'evidence/outside.png'}]},{viewports:ranges}).some(x=>x.includes('viewport screenshot')));
 console.log(JSON.stringify({status:'passed',scope:'screenshot binding and observed horizontal overflow'}));
}finally{fs.rmSync(root,{recursive:true,force:true})}
