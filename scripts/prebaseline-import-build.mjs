#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { prebaselineObservationBinding } from './prebaseline-import-review.mjs';
import { controlledOutput, declaredVerificationCommand } from './verification-policy.mjs';
import { runControlledSubprocess } from './controlled-subprocess.mjs';

const apex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, runArg] = process.argv.slice(2), sha = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const die = message => { throw new Error(`Prebaseline build observation failed: ${message}`); };
let scratch, canary;
try {
  if (command !== 'observe' || !runArg) die('usage: observe <run-dir>');
  if (fs.realpathSync(apex) !== fs.realpathSync(canonicalApexRoot)) die('the canonical Core is required');
  const runDir = path.resolve(runArg), snapshot = requireRouterAction(runDir, 'collect_existing_baseline'), step = snapshot.executionDirective?.currentStep;
  if (step?.id !== 'prebaseline-build-observe' || !step.observationBinding || !step.runtimeObservation || !step.buildBinding) die('current Router step does not authorize this observation');
  const root = fs.realpathSync(runDir), project = fs.realpathSync(process.env.APEX_ROUTER_PROJECT_ROOT || ''), binding = step.observationBinding, runtime = step.runtimeObservation, build = step.buildBinding;
  const stateFile = path.join(root, 'state.json'), stateHash = sha(fs.readFileSync(stateFile));
  const local = ref => { const target = fs.realpathSync(path.resolve(root, ref)); if (!target.startsWith(`${root}${path.sep}`) || !fs.statSync(target).isFile()) die('Run evidence is outside the Run'); return target; };
  const check = () => {
    if (sha(fs.readFileSync(stateFile)) !== stateHash || JSON.stringify(prebaselineObservationBinding(root, project, binding.inspection)) !== JSON.stringify(binding)) return false;
    const manifest = path.join(project, 'package.json'), inventory = local(build.inventory), runtimeFile = local(runtime.reference);
    return sha(fs.readFileSync(manifest)) === build.manifestSha256 && sha(fs.readFileSync(inventory)) === build.inventorySha256 && sha(fs.readFileSync(runtimeFile)) === runtime.sha256 && controlledOutput(root, runtime.reference, ['prebaseline-import-runtime.mjs'], [], ['collect_existing_baseline']) && controlledOutput(root, build.inventory, ['project-intake.mjs'], [], ['collect_existing_baseline']) && declaredVerificationCommand({ id: 'package-build', command: build.command }, JSON.parse(fs.readFileSync(inventory)), JSON.parse(fs.readFileSync(manifest)));
  };
  if (!check()) die('inspection, roles, runtime, or build declaration changed');
  const inspection = JSON.parse(fs.readFileSync(local(binding.inspection))), token = path.basename(process.env.APEX_ROUTER_AUTHORIZATION_REF || '', '.json');
  if (!/^[a-f0-9-]{36}$/.test(token)) die('invalid authorization identity');
  const cache = path.join(root, 'cache', 'prebaseline-build'); fs.mkdirSync(cache, { recursive: true });
  if (fs.realpathSync(cache) !== cache) die('build cache must remain inside the Run');
  scratch = path.join(cache, token); fs.mkdirSync(scratch, { recursive: false });
  const workspace = path.join(scratch, 'workspace'), temporary = path.join(scratch, 'tmp'); fs.mkdirSync(workspace); fs.mkdirSync(temporary);
  let bytes = 0; const copied = [];
  for (const item of inspection.sourceObservations || []) {
    if (typeof item.path !== 'string' || !item.path || path.isAbsolute(item.path)) die('invalid source path');
    const source = fs.realpathSync(path.resolve(project, item.path)), target = path.resolve(workspace, item.path);
    if (!source.startsWith(`${project}${path.sep}`) || !target.startsWith(`${workspace}${path.sep}`) || !fs.statSync(source).isFile()) die('source escapes the scoped project');
    const content = fs.readFileSync(source); bytes += content.length;
    if (content.length > 16 * 1024 * 1024 || bytes > 256 * 1024 * 1024 || sha(content) !== item.sha256) die('source is oversized or changed');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, { flag: 'wx' });
    copied.push({ path: item.path, sha256: item.sha256, bytes: content.length });
  }
  if (!copied.some(item => item.path === 'package.json') || !fs.existsSync(path.join(workspace, 'package.json'))) die('the scoped inspection does not include the build manifest');
  let dependencyRoot = null;
  const dependencies = path.join(project, 'node_modules');
  if (fs.existsSync(dependencies)) {
    dependencyRoot = fs.realpathSync(dependencies);
    if (!dependencyRoot.startsWith(`${project}${path.sep}`) || !fs.statSync(dependencyRoot).isDirectory()) die('installed dependencies escape the project');
    fs.symlinkSync(dependencyRoot, path.join(workspace, 'node_modules'), 'dir');
  }
  let buildStatus = 'unavailable', exitCode = null, outputSha256 = null, reason = 'supported isolated build sandbox is unavailable';
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) {
    const cacheCanary = path.join(cache, `${token}.canary`); canary = cacheCanary; fs.writeFileSync(canary, 'isolation-canary', { flag: 'wx' });
    const literal = value => JSON.stringify(value), ancestors = new Set();
    for (const item of [scratch, dependencyRoot].filter(Boolean)) { let parent = path.dirname(item); while (parent !== path.dirname(parent)) { ancestors.add(parent); parent = path.dirname(parent); } }
    const policy = path.join(scratch, 'sandbox.sb');
    const allowedReads = [scratch, dependencyRoot].filter(Boolean).map(item => `(subpath ${literal(item)})`).join(' ');
    const metadata = [...ancestors].map(item => `(literal ${literal(item)})`).join(' ');
    fs.writeFileSync(policy, `(version 1)\n(allow default)\n(deny network*)\n(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))\n(allow file-read-metadata ${metadata})\n(allow file-read* ${allowedReads})\n(deny file-write*)\n(allow file-write* (subpath ${literal(scratch)}))\n`);
    const env = { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', HOME: workspace, TMPDIR: temporary, CI: '1', npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_audit: 'false', NO_COLOR: '1' };
    const guard = `const fs=require('fs'),net=require('net'),p=process.argv[1];let read=false,write=false;try{fs.readFileSync(p)}catch(e){read=e.code==='EPERM'||e.code==='EACCES'}try{fs.writeFileSync(p,'changed')}catch(e){write=e.code==='EPERM'||e.code==='EACCES'}const s=net.connect({host:'127.0.0.1',port:9});s.setTimeout(2000,()=>process.exit(4));s.on('connect',()=>process.exit(3));s.on('error',e=>process.exit(read&&write&&['EPERM','EACCES'].includes(e.code)?0:2));`;
    const preflight = spawnSync('/usr/bin/sandbox-exec', ['-f', policy, process.execPath, '-e', guard, canary], { cwd: workspace, env, encoding: 'utf8', timeout: 10000 });
    if (preflight.status === 0 && fs.readFileSync(canary, 'utf8') === 'isolation-canary') {
      const npm = spawnSync('/usr/bin/which', ['npm'], { env, encoding: 'utf8', timeout: 5000 }).stdout.trim();
      if (!npm || !path.isAbsolute(npm)) reason = 'npm is unavailable in the restricted PATH';
      else {
        process.chdir(workspace); let group = null;
        const forward = () => { if (group && process.platform !== 'win32') { try { process.kill(-group, 'SIGTERM'); } catch {} } };
        process.once('SIGTERM', forward); process.once('SIGINT', forward);
        let result;
        try { result = await runControlledSubprocess('/usr/bin/sandbox-exec', ['-f', policy, npm, 'run', 'build'], { env, runDir: root, timeoutMs: 120000, maxBuffer: 1024 * 1024, onSpawn: identity => { group = identity.processGroup; } }); }
        finally { process.removeListener('SIGTERM', forward); process.removeListener('SIGINT', forward); process.chdir(root); }
        exitCode = result.status; outputSha256 = sha(`${result.stdout || ''}${result.stderr || ''}`);
        buildStatus = result.status === 0 && !result.error && !result.cancelled ? 'passed' : 'failed-or-incomplete';
        reason = result.error?.code || (result.cancelled ? 'cancelled' : result.signal ? `signal:${result.signal}` : result.status === 0 ? null : `exit:${result.status}`);
        process.chdir(root);
      }
    } else reason = 'sandbox self-check did not verify file and network restrictions';
  }
  if (!check()) die('inspection, roles, runtime, or build declaration changed during build');
  const outputDir = path.join(root, 'evidence', 'prebaseline-build'); fs.mkdirSync(outputDir, { recursive: true });
  if (fs.realpathSync(outputDir) !== outputDir) die('build evidence directory is unsafe');
  const output = path.join(outputDir, `${token}.json`);
  const evidence = { schemaVersion: '1.0', type: 'prebaseline-build-observation', status: 'observed', runId: snapshot.runId, binding, runtime: { reference: runtime.reference, sha256: runtime.sha256 }, build, buildStatus, exitCode, reason, outputSha256, copiedSources: copied, copiedBytes: bytes, installedDependencies: dependencyRoot ? 'read-only-unverified' : 'absent', observedAt: new Date().toISOString(), limitations: ['scoped-snapshot-may-omit-build-inputs', 'installed-dependency-content-not-frozen', 'sandbox-self-check-is-not-a-complete-security-proof', 'build-result-does-not-authorize-import-exception'] };
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ observation: output, status: evidence.status, buildStatus, exitCode, permitsBaseline: false }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (canary) fs.rmSync(canary, { force: true }); if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); }
