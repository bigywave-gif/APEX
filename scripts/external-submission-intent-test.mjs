import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { initializeLedger, fenceRunCancellation, recordExternalSubmissionIntent, externalSubmissionIntents, appendLedgerEvent } from './run-ledger.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apex-external-intent-'));
try {
  const state={runId:'external',revision:1,lifecycle:'active',artifacts:{}};fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));initializeLedger(dir,state,'fixture');
  const first={intentId:'first',provider:'stitch',projectId:'test',imageHash:'sha256:image',promptHash:'sha256:prompt'};
  assert.throws(()=>recordExternalSubmissionIntent(dir,{...first,imageHash:null}),/incomplete/);
  recordExternalSubmissionIntent(dir,first);assert.equal(externalSubmissionIntents(dir)[0].status,'submission-uncertain');
  appendLedgerEvent(dir,{type:'external-submission-observation',intentId:'first',status:'submitted'});assert.equal(externalSubmissionIntents(dir)[0].status,'submitted');
  appendLedgerEvent(dir,{type:'external-submission-observation',intentId:'first',status:'ready',screenId:'screen'});assert.equal(externalSubmissionIntents(dir)[0].screenId,'screen');
  fenceRunCancellation(dir,'session','fixture');assert.throws(()=>recordExternalSubmissionIntent(dir,{...first,intentId:'second'}),/cancelled run/);assert.equal(externalSubmissionIntents(dir).length,1);
  console.log(JSON.stringify({status:'passed',checks:6}));
} finally {fs.rmSync(dir,{recursive:true,force:true});}
