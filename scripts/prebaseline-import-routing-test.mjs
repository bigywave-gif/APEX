import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PREBASELINE_REVIEWER_ID } from './prebaseline-import-review.mjs';
const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-prebaseline-route-'));
const run = 'route', session = 'route-session', dir = path.join(project, '.apex/runs', run);
function call(script, args, succeeds = true) {
  const result = spawnSync(process.execPath, [path.join(core, 'scripts', script), ...args], { encoding: 'utf8', timeout: 30000 });
  if (!succeeds) { assert.notEqual(result.status, 0, result.stdout); return result; }
  assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`); return JSON.parse(result.stdout);
}
function action(script, args, succeeds = true) {
  const auth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
  return call('apex-action.mjs', ['run', project, run, session, auth.authorizationRef, 'collect_existing_baseline', script, ...args], succeeds);
}
const status = () => call('apex-router.mjs', ['status', project, run, session]).executionDirective;
try {
  if (process.env.APEX_TEST_PREBASELINE_BUILD === '1') fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { build: 'node main.js' } }));
  fs.writeFileSync(path.join(project, 'index.html'), '<script src="/main.js"></script>');
  const source = path.join(project, 'main.js'), original = "try { require('./optional-module'); } catch (error) {}\n" + (process.env.APEX_TEST_PREBASELINE_BUILD_FAIL === '1' ? "if(typeof process !== 'undefined' && process.env.CI) process.exit(7);\n" : '') + (process.env.APEX_TEST_PREBASELINE_BUILD_ISOLATION === '1' ? `if(typeof process !== 'undefined' && process.env.CI){try{require('fs').writeFileSync(${JSON.stringify(path.join(project, 'forbidden.txt'))},'x');process.exitCode=9}catch(e){if(!['EPERM','EACCES'].includes(e.code))process.exitCode=8}}\n` : '') + (process.env.APEX_TEST_PREBASELINE_POST === '1' ? "fetch('/write',{method:'POST'}).catch(()=>{});\n" : '') + (process.env.APEX_TEST_PREBASELINE_JSERROR === '1' ? "throw new Error('fixture failure');\n" : '') + (process.env.APEX_TEST_PREBASELINE_BIG === '1' ? `/*${'x'.repeat(4 * 1024 * 1024)}*/` : '');
  fs.writeFileSync(source, original);
  call('apex-router.mjs', ['intake', project, run, 'existing', 'standard', 'interactive', session, '确认调用 APEX']);
  action('project-intake.mjs', ['scan', dir, project]);
  const scope = path.join(dir, 'scope.json'); fs.writeFileSync(scope, JSON.stringify({ routes: process.env.APEX_TEST_PREBASELINE_DUPLICATE === '1' ? ['/', '/'] : ['/'], codeEntrypoints: ['index.html'] }));
  assert.match(action('existing-code-reference.mjs', ['capture', dir, project, scope], false).stderr, /APEX_UNRESOLVED_LOCAL_IMPORTS/);
  assert.equal(status().currentStep.id, 'inspect-unresolved-imports');
  assert.equal(status().remediatingFailure.category, 'unresolved-local-import');
  action('existing-code-reference.mjs', ['inspect-imports', dir, project, scope]);
  assert.equal(status().currentStep.id, 'prebaseline-role-select');
  action('role-advisory.mjs', ['select', dir, 'prebaseline']);
  const selection = JSON.parse(fs.readFileSync(path.join(dir, 'advisories/prebaseline/selection.json')));
  const job = selection.agentJobs[PREBASELINE_REVIEWER_ID]; assert.ok(job);
  assert.equal(status().currentStep.id, 'prebaseline-role-record');
  fs.appendFileSync(source, '// changed\n');
  assert.equal(status().currentStep.id, 'prebaseline-role-repair', 'stale queued work must be reconciled before recapture');
  fs.writeFileSync(source, original);
  const claim = action('agent-runtime.mjs', ['claim', dir, job, 'prebaseline', 'route_fixture_claim_01']);
  fs.appendFileSync(source, '// changed while running\n');
  assert.equal(status().currentStep.id, 'prebaseline-role-wait', 'a live stale job must not be duplicated');
  fs.writeFileSync(source, original);
  const inspection = selection.inputBindings.find(item => item.artifact === 'unresolvedImportInspection').path;
  const input = path.join(dir, 'review-input.json');
  const advisory = { schemaVersion: '1.0', roleId: PREBASELINE_REVIEWER_ID, stage: 'prebaseline', adapterVersion: '1.0.0', inputBindings: selection.inputBindings, findings: [{ id: 'fixture', classification: 'unverified', statement: '实际运行条件仍需要验证。', evidence: [inspection] }], recommendations: [], importReviews: [{ source: 'main.js', reference: './optional-module', decision: 'optional-candidate', rationale: '代码存在捕获异常的逻辑，但仍需要运行时证据确认实际影响。', sourceExcerpt: 'not present in source' }], execution: { inputTokens: 100, outputTokens: 50, usageSource: 'provider-reported', model: 'test-fixture', sessionId: claim.payload.agentSessionId, skillBindings: claim.payload.skillBindings, leaseToken: claim.leaseToken }, status: 'ready' };
  fs.writeFileSync(input, JSON.stringify(advisory));
  assert.match(action('role-advisory.mjs', ['record', dir, 'prebaseline', input], false).stderr, /excerpt is not present/);
  action('agent-runtime.mjs', ['status', dir]);
  assert.equal(status().blockingOperation.category, 'prebaseline-review-failed', 'a later status must not hide a failed role attempt');
  advisory.importReviews[0].sourceExcerpt = "require('./optional-module')"; fs.writeFileSync(input, JSON.stringify(advisory));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  assert.equal(status().blockingOperation, null, 'changed input permits an authorized retry');
  const retry = action('agent-runtime.mjs', ['claim', dir, job, 'prebaseline', 'route_fixture_claim_02']);
  advisory.execution.leaseToken = retry.leaseToken; fs.writeFileSync(input, JSON.stringify(advisory));
  action('role-advisory.mjs', ['record', dir, 'prebaseline', input]);
  assert.equal(status().currentStep.id, 'prebaseline-runtime-observe', 'candidate judgments require independent observations');
  assert.equal(status().blockingOperation, null);
  if (process.env.APEX_TEST_PREBASELINE_BROWSER === '1') {
    const serverCode = `const http=require('http'),fs=require('fs'),path=require('path');const root=process.argv[1],broken=process.argv[2]==='1',different=process.argv[3]==='1';http.createServer((req,res)=>{if(req.method==='POST'){fs.writeFileSync(path.join(root,'unexpected-post.txt'),'write');res.end('written');return}if(req.url==='/main.js'&&broken){res.writeHead(404);res.end('missing');return}if(req.url==='/main.js'&&different){res.setHeader('content-type','text/javascript');res.end('console.log("different source")');return}if(req.url==='/main.js'&&process.argv[4]==='1'){fs.writeFileSync(path.join(root,'request-started'),'yes');setTimeout(()=>res.end(fs.readFileSync(path.join(root,'main.js'))),15000);return}const file=req.url==='/main.js'?'main.js':'index.html';res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,file)))}).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port+'/')});`;
    const server = spawn(process.execPath, ['-e', serverCode, project, process.env.APEX_TEST_PREBASELINE_BROKEN || '0', process.env.APEX_TEST_PREBASELINE_WRONG_SOURCE || '0', process.env.APEX_TEST_PREBASELINE_CANCEL || '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const url = await new Promise((resolve, reject) => { let value = ''; server.stdout.on('data', chunk => { value += chunk; if (value.includes('\n')) resolve(value.trim()); }); server.on('error', reject); server.on('exit', code => reject(new Error(`fixture server exited: ${code}`))); });
      if (process.env.APEX_TEST_PREBASELINE_CANCEL === '1') {
        const auth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
        const child = spawn(process.execPath, [path.join(core, 'scripts/apex-action.mjs'), 'run', project, run, session, auth.authorizationRef, 'collect_existing_baseline', 'prebaseline-import-runtime.mjs', 'observe', dir, url], { stdio: ['ignore', 'pipe', 'pipe'] });
        const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
        const deadline = Date.now() + 30000;
        while (!fs.existsSync(path.join(project, 'request-started')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(fs.existsSync(path.join(project, 'request-started')), 'browser must reach the delayed response before cancellation');
        call('apex-router.mjs', ['cancel', project, run, session, '取消当前执行']);
        const result = await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('cancelled browser observation did not stop')), 15000))]);
        assert.notEqual(result.code, 0);
        if (process.platform === 'darwin') {
          const browserSession = `apex-prebaseline-${crypto.createHash('sha1').update(fs.realpathSync(dir)).digest('hex').slice(0, 12)}`;
          const daemonPids = () => spawnSync('/bin/ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter(line => line.includes('cliDaemon.js') && line.includes(browserSession)).map(line => Number(line.trim().split(/\s+/)[0]));
          const stopDeadline = Date.now() + 35000;
          while (daemonPids().length && Date.now() < stopDeadline) await new Promise(resolve => setTimeout(resolve, 200));
          const remaining = daemonPids();
          for (const pid of remaining) { try { process.kill(pid, 'SIGTERM'); } catch {} }
          assert.deepEqual(remaining, [], 'cancelled observation must close its browser daemon');
        }
        const evidenceDir = path.join(dir, 'evidence/prebaseline-runtime');
        assert.ok(!fs.existsSync(evidenceDir) || !fs.readdirSync(evidenceDir).some(name => name.endsWith('.json')), 'cancelled observation must not produce evidence');
      } else {
      const observed = action('prebaseline-import-runtime.mjs', ['observe', dir, url]);
      assert.equal(observed.status, 'observed'); assert.equal(observed.permitsBaseline, false);
      const evidence = JSON.parse(fs.readFileSync(observed.observation)), sourceResult = evidence.sources.find(item => item.source === 'main.js');
      assert.equal(evidence.routes.length, 1, 'duplicate target routes must be observed once');
      assert.equal(evidence.serviceOwnership, 'unverified'); assert.ok(evidence.limitations.includes('not-a-build-result-or-an-import-exception'));
      const expectedLoaded = process.env.APEX_TEST_PREBASELINE_BROKEN !== '1' && process.env.APEX_TEST_PREBASELINE_BIG !== '1' && process.env.APEX_TEST_PREBASELINE_WRONG_SOURCE !== '1';
      assert.ok(sourceResult); assert.equal(Boolean(sourceResult.loadedAt.length), expectedLoaded);
      if (process.env.APEX_TEST_PREBASELINE_BROKEN === '1') assert.ok(evidence.routes[0].failedResources.some(item => item.status === 404));
      if (process.env.APEX_TEST_PREBASELINE_POST === '1') { assert.ok(evidence.routes[0].blockedRequests.some(item => item.method === 'POST')); assert.equal(fs.existsSync(path.join(project, 'unexpected-post.txt')), false); }
      if (process.env.APEX_TEST_PREBASELINE_JSERROR === '1') assert.ok(evidence.routes[0].pageErrors > 0, 'uncaught page errors must be observed');
      if (process.env.APEX_TEST_PREBASELINE_BIG === '1') { assert.equal(evidence.routes[0].overflow, true); assert.equal(evidence.routes[0].status, 'incomplete'); }
      if (process.env.APEX_TEST_PREBASELINE_BUILD === '1') {
        assert.equal(status().currentStep.id, 'prebaseline-build-observe');
        const built = action('prebaseline-import-build.mjs', ['observe', dir]);
        assert.equal(built.permitsBaseline, false);
        assert.equal(built.buildStatus, process.platform === 'darwin' ? (process.env.APEX_TEST_PREBASELINE_BUILD_FAIL === '1' ? 'failed-or-incomplete' : 'passed') : 'unavailable');
        if (process.env.APEX_TEST_PREBASELINE_BUILD_FAIL === '1' && process.platform === 'darwin') assert.equal(built.exitCode, 7);
        assert.equal(fs.existsSync(path.join(project, 'forbidden.txt')), false);
        assert.equal(status().blockingOperation.professionalReview.buildObservation.permitsBaseline, false);
        const buildBytes = fs.readFileSync(built.observation);
        try { fs.appendFileSync(built.observation, 'tamper'); assert.notEqual(status().blockingOperation?.professionalReview?.buildObservation?.status, 'observed-not-authorized'); }
        finally { fs.writeFileSync(built.observation, buildBytes); }
        assert.equal(status().blockingOperation.professionalReview.buildObservation.status, 'observed-not-authorized');
      }
      const blocked = status().blockingOperation;
      assert.equal(blocked.category, 'unresolved-local-import'); assert.equal(blocked.professionalReview.runtimeObservation.status, 'observed-not-authorized');
      assert.equal(blocked.professionalReview.runtimeObservation.permitsBaseline, false);
      assert.equal(blocked.professionalReview.runtimeObservation.unobservedSources, expectedLoaded ? 0 : 1);
      const bytes = fs.readFileSync(observed.observation);
      try { fs.appendFileSync(observed.observation, 'tamper'); assert.equal(status()?.blockingOperation?.professionalReview?.runtimeObservation, undefined); }
      finally { fs.writeFileSync(observed.observation, bytes); }
      assert.equal(status().blockingOperation.professionalReview.runtimeObservation.status, 'observed-not-authorized');
      try { fs.appendFileSync(source, '\n// source changed\n'); assert.equal(status()?.blockingOperation?.professionalReview?.runtimeObservation, undefined); }
      finally { fs.writeFileSync(source, original); }
      }
    } finally { server.kill('SIGTERM'); }
  }
  assert.equal(fs.existsSync(path.join(dir, 'code-reference.json')), false);
  console.log(JSON.stringify({ status: 'passed', test: 'prebaseline-import-routing' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
