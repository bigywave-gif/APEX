import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {controlledOutput} from './verification-policy.mjs';import {formalRouteCoverage} from './formal-route-coverage.mjs';import {formalDirectProgress} from './formal-direct-progress.mjs';import {formalStitchProgress} from './formal-stitch-progress.mjs';
export function visualQualityEvidence(runDir,state) {
  try {
    const parityRef=state.artifacts?.implementationParityEvidence, captureRef='evidence/runtime-browser-capture.json';
    if(!parityRef||!controlledOutput(runDir,parityRef,['strict-replica.mjs'])||!controlledOutput(runDir,captureRef,['browser-capture.mjs'])) throw new Error('current controlled parity and browser capture are required');
    const read=ref=>JSON.parse(fs.readFileSync(path.resolve(runDir,ref),'utf8')),parity=read(parityRef),capture=read(captureRef),baseline=read(state.artifacts.runtimeVisualBaseline);
    if(parity.status!=='passed'||parity.strictPixelMatch!==true||!Array.isArray(parity.unmatched)||parity.unmatched.length) throw new Error('strict current parity is missing or failed');
    const root=fs.realpathSync(runDir),hash=file=>`sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
    const current=(capture.evidence||[]).some(item=>{try{const file=fs.realpathSync(path.resolve(root,item.screenshot));return item.status==='captured'&&file.startsWith(`${root}${path.sep}`)&&item.screenshotSha256===parity.runtimeImageHash&&hash(file)===item.screenshotSha256}catch{return false}});
    if(!current) throw new Error('parity does not bind an unchanged current formal screenshot');
    if(state.locks?.stitchSkipped){const images=(baseline.screenCaptures||[]).map(item=>item.screenshot?.sha256);if(!images.includes(parity.baseline?.imageHash)&&parity.baseline?.imageHash!==baseline.referenceImage?.sha256)throw new Error('parity baseline is not a confirmed Demo screen');}
    else {const freeze=read(state.artifacts.stitchFreeze);if(!(freeze.approvedScreens||[]).some(item=>item.imageHash===parity.baseline?.imageHash))throw new Error('parity baseline is not a frozen Stitch screen');}
    const operations=path.join(runDir,'operations'),receipts=fs.readdirSync(operations).filter(name=>name.endsWith('.json')).map(name=>{try{return read(path.join('operations',name))}catch{return null}}).filter(Boolean);
    const coverage=formalRouteCoverage(runDir,baseline,capture,receipts),direct=formalDirectProgress(runDir,state,receipts),stitch=formalStitchProgress(runDir,state,receipts);
    if(!['ready','not-required'].includes(coverage.status)||!['ready','not-required'].includes(direct.status)||!['ready','not-required'].includes(stitch.status)) throw new Error('confirmed page or viewport parity is incomplete');
    if(state.locks?.stitchSkipped && parity.baseline?.kind!=='effect-image') throw new Error('parity baseline is not the confirmed Demo');
    if(!state.locks?.stitchSkipped && parity.baseline?.kind!=='stitch') throw new Error('parity baseline is not the frozen Stitch design');
    return {status:'passed',scope:'design-fidelity-only',evidence:[{kind:'visual',status:'passed',parityPath:parityRef,coverage,direct,stitch}],limitations:['Fidelity checks do not replace the user aesthetic decision.'],checkedAt:new Date().toISOString()};
  } catch(error) {return {status:'unverified',scope:'design-fidelity-only',evidence:[],reason:error.message,checkedAt:new Date().toISOString()};}
}
