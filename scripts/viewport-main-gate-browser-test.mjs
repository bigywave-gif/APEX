#!/usr/bin/env node
/** Real controlled capture proves the responsive consumer rejects an offscreen main. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'apex-main-gate-'));
const home = path.join(root, 'home'), core = path.join(home, 'apex/APEX'), sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const filter = file => !['.git', 'node_modules', '.DS_Store'].includes(path.basename(file));
try {
  fs.mkdirSync(path.dirname(core), { recursive: true });
  fs.cpSync(candidate, core, { recursive: true, filter });
  fs.cpSync(path.join(sourceHome, 'skills'), path.join(home, 'skills'), { recursive: true, filter });
  const file = path.join(core, 'scripts/sitewide-plan-browser-test.mjs');
  let source = fs.readFileSync(file, 'utf8');
  const writeMarker = " for(const file of ['index.html','settings.html'])fs.writeFileSync(path.join(project,file),formalHtml);";
  assert.equal(source.split(writeMarker).length, 2);
  source = source.replace(writeMarker, ` formalHtml=formalHtml.replace('<body>','<body><main class="apex-test-main">').replace('</body>','</main></body>').replace('</head>','<style>@media(max-width:500px){html,body{overflow-x:hidden}.apex-test-main{width:390px;transform:translateX(650px)}}</style></head>');\n${writeMarker}`);
  const specMarker = " const formalSpec=put('sitewide-formal-browser-spec.json'";
  assert.equal(source.split(specMarker).length, 2);
  const index = source.indexOf(specMarker);
  source = source.slice(0, index) + source.slice(index).replace("id:'workbench',route:'/',width:1440,height:900", "id:'workbench',route:'/',width:390,height:900");
  const captureMarker = "assert.ok(formal.evidence.every(screen=>screen.sourceMainViewport?.version==='1.0'),'formal captures must carry the bound-main viewport observation');";
  assert.equal(source.split(captureMarker).length, 2);
  source = source.replace(captureMarker, `${captureMarker}
  assert.equal(formal.evidence[0].sourceMainViewport.status,'offscreen');
  const {responsiveEvidenceFailures}=await import('./responsive-evidence.mjs');
  const receipts=Object.values(JSON.parse(fs.readFileSync(path.join(dir,'operations-index.json'))).receipts||{});
  const faults=responsiveEvidenceFailures(dir,formal,receipts,{rangeChecks:[{class:'mobile',width:390,screenshot:formal.evidence[0].screenshot}],viewports:[],states:[]},{viewports:[{class:'mobile',minWidth:390,maxWidth:390}]});
  assert.ok(faults.some(item=>item.includes('main content is horizontally offscreen')),JSON.stringify(faults));
  throw Error('APEX_BOUND_MAIN_OFFSCREEN_VERIFIED');`);
  fs.writeFileSync(file, source);
  const run = spawnSync(process.execPath, [file], { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024 });
  assert.notEqual(run.status, 0);
  assert.ok((run.stderr || '').includes('APEX_BOUND_MAIN_OFFSCREEN_VERIFIED'), (run.stderr || run.stdout || run.error?.message || '').slice(-4000));
  console.log(JSON.stringify({ status: 'passed', scope: 'controlled real-browser capture and responsive gate reject source-bound main wholly offscreen' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
