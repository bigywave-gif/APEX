#!/usr/bin/env node
// Real 4.44.1 Core and browser execution; role results and confirmations are fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), legacy = process.env.APEX_LEGACY_CORE;
if (!legacy || !fs.existsSync(path.join(legacy, 'manifest.yaml'))) throw new Error('APEX_LEGACY_CORE must identify the previous Core');
const root = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'apex-old-existing-'));
const home = path.join(root, 'home'), core = path.join(home, 'apex/APEX'), sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const filter = file => !['.git', 'node_modules', '.DS_Store'].includes(path.basename(file));
try {
  fs.mkdirSync(path.dirname(core), { recursive: true }); fs.cpSync(legacy, core, { recursive: true, filter }); fs.cpSync(path.join(sourceHome, 'skills'), path.join(home, 'skills'), { recursive: true, filter });
  const file = path.join(core, 'scripts/sitewide-plan-browser-test.mjs'), source = fs.readFileSync(file, 'utf8'), marker = "assert.equal(approved.nextRequiredAction,'generate_visual');";
  assert.equal(source.split(marker).length, 2, 'legacy injection point must be unique');
  const injection = `
  {
    const approvalName=fs.readdirSync(path.join(dir,'approvals')).find(name=>name.startsWith('visual-plan-')&&name.endsWith('.json'));
    assert.ok(approvalName);const approvalFile=path.join(dir,'approvals',approvalName),approvalBefore=fs.readFileSync(approvalFile);
    const oldRef=fs.readFileSync(path.join(dir,'code-reference.json')),oldBaseline=fs.readFileSync(path.join(dir,'existing-baseline.json')),oldPlan=fs.readFileSync(path.join(dir,'visual-execution-plan.json'));
    fs.renameSync(core,core+'-previous');fs.cpSync(process.env.APEX_CANDIDATE_CORE,core,{recursive:true,filter:file=>!['.git','node_modules','.DS_Store'].includes(path.basename(file))});
    let upgraded=route(['status',project,id,session]);assert.equal(upgraded.executionDirective.currentStep.id,'inspect-legacy-code-reference');assert.ok(!upgraded.allowedActions.includes('revoke_visual'));
    try{fs.appendFileSync(approvalFile,'tamper');const s=route(['status',project,id,session]);assert.equal(s.executionDirective?.blockingOperation?.category,'legacy-baseline-unverified');assert.ok(!s.allowedActions.includes('revoke_visual'));}finally{fs.writeFileSync(approvalFile,approvalBefore)}
    const originalSource=fs.readFileSync(path.join(project,'index.html'));
    try{fs.appendFileSync(path.join(project,'index.html'),'<!-- changed -->');const s=route(['status',project,id,session]);assert.equal(s.executionDirective.blockingOperation?.category,'legacy-baseline-unverified');}finally{fs.writeFileSync(path.join(project,'index.html'),originalSource)}
    upgraded=route(['status',project,id,session]);const input=upgraded.executionDirective.currentStep.legacyInspectionScope;assert.ok(input);
    const scopeCollision=put(input.path,{routes:['/wrong'],codeEntrypoints:input.codeEntrypoints}), collisionBytes=fs.readFileSync(scopeCollision);
    try{const s=route(['status',project,id,session]);assert.equal(s.executionDirective.blockingOperation?.category,'legacy-baseline-unverified');assert.deepEqual(fs.readFileSync(scopeCollision),collisionBytes);}finally{fs.unlinkSync(scopeCollision)}
    const absentTarget=path.join(project,'uncreated-scope-target');fs.symlinkSync(absentTarget,scopeCollision);
    try{const s=route(['status',project,id,session]);assert.equal(s.executionDirective.blockingOperation?.category,'legacy-baseline-unverified');assert.equal(fs.existsSync(absentTarget),false);}finally{fs.unlinkSync(scopeCollision)}
    const inspectionScope=put(input.path,{routes:input.routes,codeEntrypoints:input.codeEntrypoints});
    const delayHook=path.join(dir,'legacy-inspection-delay.cjs'),readyMarker=path.join(dir,'legacy-inspection-started');
    fs.writeFileSync(delayHook,"if(process.argv[1]?.endsWith('existing-code-reference.mjs')&&process.argv[2]==='inspect-imports'){require('fs').writeFileSync(process.env.APEX_LEGACY_TEST_MARKER,'started');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,4000)}");
    const scannerFile=path.join(core,'scripts/existing-code-reference.mjs'),scannerOriginal=fs.readFileSync(scannerFile,'utf8');
    if(process.env.APEX_TEST_LEGACY_OLD_INSPECTION==='1'){const marker='unresolvedImports: missing, unresolvedResources: [...missingResources.values()], limitations:';assert.equal(scannerOriginal.split(marker).length,2);fs.writeFileSync(scannerFile,scannerOriginal.replace(marker,'unresolvedImports: missing, limitations:'));}
    const inspectionAuth=route(['authorize',project,id,session,'collect_existing_baseline']);
    const inspectionChild=spawn(process.execPath,[path.join(core,'scripts/apex-action.mjs'),'run',project,id,session,inspectionAuth.authorizationRef,'collect_existing_baseline','existing-code-reference.mjs','inspect-imports',dir,project,inspectionScope],{env:{...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require='+delayHook].filter(Boolean).join(' '),APEX_LEGACY_TEST_MARKER:readyMarker},stdio:['ignore','pipe','pipe']});
    let inspectOut='',inspectErr='';inspectionChild.stdout.on('data',value=>inspectOut+=value);inspectionChild.stderr.on('data',value=>inspectErr+=value);
    const inspectionDone=new Promise(resolve=>inspectionChild.on('close',resolve)),deadline=Date.now()+30000;
    while(!fs.existsSync(readyMarker)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(fs.existsSync(readyMarker));assert.equal(route(['status',project,id,session]).executionDirective.currentStep.id,'prebaseline-operation-wait');
    assert.equal(await inspectionDone,0,inspectErr||inspectOut);const inspection=JSON.parse(inspectOut);
    if(process.env.APEX_TEST_LEGACY_OLD_INSPECTION==='1'){
      fs.writeFileSync(scannerFile,scannerOriginal);assert.equal(JSON.parse(fs.readFileSync(inspection.inspection)).unresolvedResources,undefined);
      const stale=route(['status',project,id,session]);assert.equal(stale.executionDirective.currentStep.id,'inspect-legacy-code-reference');
      const refreshed=ok(action('existing-code-reference.mjs',['inspect-imports',dir,project,inspectionScope]),'refresh legacy resource coverage');assert.deepEqual(JSON.parse(fs.readFileSync(refreshed.inspection)).unresolvedResources,[]);
      const ready=route(['status',project,id,session]);assert.equal(ready.nextRequiredAction,'generate_visual');assert.deepEqual(fs.readFileSync(approvalFile),approvalBefore);throw new Error('LEGACY_EXPECTED_OLD_INSPECTION_RECOVERY');
    }
    if(process.env.APEX_TEST_LEGACY_UNRESOLVED==='1'){
      assert.ok(inspection.unresolvedCount>0);const blocked=route(['status',project,id,session]);assert.equal(blocked.executionDirective.blockingOperation?.category,'legacy-baseline-unverified');assert.notEqual(blocked.nextRequiredAction,'generate_visual');assert.ok(!blocked.allowedActions.includes('revoke_visual'));assert.deepEqual(fs.readFileSync(approvalFile),approvalBefore);
      fs.writeFileSync(path.join(project,'missing-legacy-module.js'),'module.exports = {};' );
      const repaired=route(['status',project,id,session]);assert.equal(repaired.executionDirective.currentStep.id,'inspect-legacy-code-reference');
      const retried=ok(action('existing-code-reference.mjs',['inspect-imports',dir,project,inspectionScope]),'reinspect changed dependency');assert.equal(retried.unresolvedCount,0);
      const ready=route(['status',project,id,session]);assert.equal(ready.nextRequiredAction,'generate_visual');assert.deepEqual(fs.readFileSync(approvalFile),approvalBefore);throw new Error('LEGACY_EXPECTED_UNRESOLVED_RECOVERY');
    }
    if(process.env.APEX_TEST_LEGACY_MISSING_RESOURCE==='1'){
      assert.ok(JSON.parse(fs.readFileSync(inspection.inspection)).unresolvedResources.length>0);const blocked=route(['status',project,id,session]);assert.equal(blocked.executionDirective.blockingOperation?.category,'legacy-baseline-unverified');assert.notEqual(blocked.nextRequiredAction,'generate_visual');
      fs.mkdirSync(path.join(project,'public'),{recursive:true});fs.writeFileSync(path.join(project,'public/missing-legacy.png'),'fixture');
      const repaired=route(['status',project,id,session]);assert.equal(repaired.executionDirective.currentStep.id,'inspect-legacy-code-reference');
      const retried=ok(action('existing-code-reference.mjs',['inspect-imports',dir,project,inspectionScope]),'reinspect changed resource');assert.equal(JSON.parse(fs.readFileSync(retried.inspection)).unresolvedResources.length,0);
      const ready=route(['status',project,id,session]);assert.equal(ready.nextRequiredAction,'generate_visual');assert.deepEqual(fs.readFileSync(approvalFile),approvalBefore);throw new Error('LEGACY_EXPECTED_RESOURCE_RECOVERY');
    }
    assert.equal(inspection.unresolvedCount,0);
    const scopeBytes=fs.readFileSync(inspectionScope);
    try{fs.appendFileSync(inspectionScope,' ');const s=route(['status',project,id,session]);assert.notEqual(s.nextRequiredAction,'generate_visual');}finally{fs.writeFileSync(inspectionScope,scopeBytes)}
    const inspectedFile=inspection.inspection,inspectedBytes=fs.readFileSync(inspectedFile);
    try{fs.appendFileSync(inspectedFile,'tamper');const s=route(['status',project,id,session]);assert.notEqual(s.nextRequiredAction,'generate_visual');}finally{fs.writeFileSync(inspectedFile,inspectedBytes)}
    const continued=route(['status',project,id,session]);assert.equal(continued.nextRequiredAction,'generate_visual');assert.equal(continued.executionDirective.currentStep.id,'compile-demo-source-manifest');
    assert.deepEqual(fs.readFileSync(approvalFile),approvalBefore);assert.deepEqual(fs.readFileSync(path.join(dir,'code-reference.json')),oldRef);assert.deepEqual(fs.readFileSync(path.join(dir,'existing-baseline.json')),oldBaseline);assert.deepEqual(fs.readFileSync(path.join(dir,'visual-execution-plan.json')),oldPlan);
  }
  `;
  const updatedSource = fs.readFileSync(path.join(candidate, 'scripts/sitewide-plan-browser-test.mjs'), 'utf8');
  assert.equal(updatedSource.split(marker).length, 2, 'candidate continuation point must be unique');
  let legacyPrefix = source.slice(0, source.indexOf(marker) + marker.length).replaceAll("inputTokens:0,outputTokens:0,usageSource:'unknown'", "inputTokens:100,outputTokens:50,usageSource:'estimated'");
  if (process.env.APEX_TEST_LEGACY_UNRESOLVED === '1') {
    const serverMarker = ' server=spawn(process.execPath,';
    assert.equal(legacyPrefix.split(serverMarker).length, 2);
    legacyPrefix = legacyPrefix.replace(serverMarker, ` fs.appendFileSync(path.join(project,'logic.js'),"\\ntry { require('./missing-legacy-module'); } catch (error) {}\\n");\n` + serverMarker);
  }
  if (process.env.APEX_TEST_LEGACY_MISSING_RESOURCE === '1') {
    const serverMarker = ' server=spawn(process.execPath,';
    assert.equal(legacyPrefix.split(serverMarker).length, 2);
    legacyPrefix = legacyPrefix.replace(serverMarker, ` fs.appendFileSync(path.join(project,'index.html'),'<img src="/missing-legacy.png" alt="missing">');\n` + serverMarker);
  }
  let candidateContinuation = updatedSource.slice(updatedSource.indexOf(marker) + marker.length);
  const gate3Marker = "assert.equal(completed.gates.gate3,'passed');";
  assert.equal(candidateContinuation.split(gate3Marker).length, 2);
  const postGateChecks = `
    const locked=ref.files.find(item=>item.path==='style.css');assert.ok(locked);const copyFile=path.join(dir,locked.copyPath),copyBytes=fs.readFileSync(copyFile);
    try{fs.appendFileSync(copyFile,'tamper');const invalid=run('apex-validate.mjs',['gate3',dir]);assert.notEqual(invalid.status,0,'changed original copy must invalidate Gate 3');}finally{fs.writeFileSync(copyFile,copyBytes)}
    const protectedSource=path.join(project,'style.css'),protectedBytes=fs.readFileSync(protectedSource);
    try{fs.appendFileSync(protectedSource,'/* changed */');const invalid=run('apex-validate.mjs',['gate3',dir]);assert.notEqual(invalid.status,0,'unapproved source changes must invalidate Gate 3');}finally{fs.writeFileSync(protectedSource,protectedBytes)}
    const finalCheck=run('apex-validate.mjs',['gate3',dir]);assert.equal(finalCheck.status,0,finalCheck.stderr||finalCheck.stdout);
  `;
  candidateContinuation = candidateContinuation.replace(gate3Marker, gate3Marker + postGateChecks);
  fs.writeFileSync(file, legacyPrefix + injection + candidateContinuation);
  const result = spawnSync(process.execPath, [file], { env: { ...process.env, CODEX_HOME: home, APEX_CANDIDATE_CORE: candidate }, encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024 });
  if (process.env.APEX_TEST_LEGACY_OLD_INSPECTION === '1') {
    if (result.status === 0 || !(result.stderr || '').includes('LEGACY_EXPECTED_OLD_INSPECTION_RECOVERY')) throw new Error((result.stderr || result.stdout || result.error?.message || '').slice(-5000));
    console.log(JSON.stringify({ status: 'passed', scope: 'real legacy Existing site: older import inspection receives one resource-coverage refresh', legacy: '4.44.1' }));
  } else if (process.env.APEX_TEST_LEGACY_MISSING_RESOURCE === '1') {
    if (result.status === 0 || !(result.stderr || '').includes('LEGACY_EXPECTED_RESOURCE_RECOVERY')) throw new Error((result.stderr || result.stdout || result.error?.message || '').slice(-5000));
    console.log(JSON.stringify({ status: 'passed', scope: 'real legacy Existing site: missing resource blocks, changed candidate recovers, visual approval preserved', legacy: '4.44.1' }));
  } else if (process.env.APEX_TEST_LEGACY_UNRESOLVED === '1') {
    if (result.status === 0 || !(result.stderr || '').includes('LEGACY_EXPECTED_UNRESOLVED_RECOVERY')) throw new Error((result.stderr || result.stdout || result.error?.message || '').slice(-5000));
    console.log(JSON.stringify({ status: 'passed', scope: 'real legacy Existing site: unresolved import blocks, changed candidate recovers, visual approval preserved', legacy: '4.44.1' }));
  } else {
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || '').slice(-5000));
    console.log(JSON.stringify({ status: 'passed', scope: 'real legacy Existing site and browser; preserved visual approval, supplementary import inspection, tamper/source drift, Demo, implementation and synthetic-role Gate 3', legacy: '4.44.1' }));
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
