#!/usr/bin/env node
/** A new formal capture must invalidate the prior responsive screenshot matrix. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'apex-main-recapture-'));
const home = path.join(root, 'home'), core = path.join(home, 'apex/APEX'), sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const filter = file => !['.git', 'node_modules', '.DS_Store'].includes(path.basename(file));
try {
  fs.mkdirSync(path.dirname(core), { recursive: true });
  fs.cpSync(candidate, core, { recursive: true, filter });
  fs.cpSync(path.join(sourceHome, 'skills'), path.join(home, 'skills'), { recursive: true, filter });
  const file = path.join(core, 'scripts/sitewide-plan-browser-test.mjs');
  let source = fs.readFileSync(file, 'utf8');
  const marker = "assert.equal(invoke('verify','stability-evidence.mjs',['verify',dir,put('sitewide-matrix-input.json',matrix)]).status,'passed');";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, `${marker}
  const savedApprovals=Object.fromEntries(fs.readdirSync(path.join(dir,'approvals')).filter(name=>name.endsWith('.json')).map(name=>[name,fs.readFileSync(path.join(dir,'approvals',name)).toString('base64')]));
  const previousCapture=JSON.parse(fs.readFileSync(path.join(dir,'evidence/runtime-browser-capture.json')));
  for(const reference of [previousCapture.evidence[0].screenshot,previousCapture.evidence[0].domHtml]) {
    const artifact=path.join(dir,reference),original=fs.readFileSync(artifact);
    try {fs.appendFileSync(artifact,'tampered');const damaged=route(['status',project,id,session]);assert.equal(damaged.executionDirective.currentStep.id,'capture-formal-runtime-source-provenance');}
    finally {fs.writeFileSync(artifact,original);}
  }
  invoke('verify','browser-capture.mjs',['capture',dir,\`http://127.0.0.1:\${port}/\`,rangeSpec]);
  const afterRecapture=route(['status',project,id,session]);
  assert.equal(afterRecapture.nextRequiredAction,'verify');
  assert.equal(afterRecapture.executionDirective.currentStep.id,'capture-runtime-state-matrix');
  assert.ok(afterRecapture.executionDirective.currentStep.details.includes('responsive'));
  assert.ok(Object.entries(savedApprovals).every(([name,bytes])=>fs.readFileSync(path.join(dir,'approvals',name)).toString('base64')===bytes));
  throw Error('APEX_FORMAL_RECAPTURE_REQUIRES_CURRENT_MATRIX');`);
  fs.writeFileSync(file, source);
  const run = spawnSync(process.execPath, [file], { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', timeout: 1200000, maxBuffer: 8 * 1024 * 1024 });
  assert.notEqual(run.status, 0);
  assert.ok((run.stderr || '').includes('APEX_FORMAL_RECAPTURE_REQUIRES_CURRENT_MATRIX'), (run.stderr || run.stdout || run.error?.message || '').slice(-4000));
  console.log(JSON.stringify({ status: 'passed', scope: 'controlled formal recapture routes back to current responsive matrix and preserves approvals' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
