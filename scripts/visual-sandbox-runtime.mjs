#!/usr/bin/env node
import { commitRunState, readRunStateForUpdate } from './run-ledger.mjs';
/** Start and verify the only HTTP runtime permitted for a run-local visual sandbox. */
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { acquireRuntimeStartLock } from './runtime-start-lock.mjs';
import { readRuntimeLaunchIntent, findRuntimeLaunchProcess } from './runtime-launch-intent.mjs';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Visual sandbox runtime failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${path.basename(file)}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, candidate) { const resolved = path.resolve(root, candidate); return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null; }
function contentType(file) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }
function bindHost(value) {
  const host = value || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) die('runtime may bind only to the loopback addresses 127.0.0.1 or ::1');
  return host;
}
function loopbackUrl(host, port) { return `http://${host.includes(':') ? `[${host}]` : host}:${port}/`; }
async function availablePort(host) { return await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, host, () => { const address = probe.address(); probe.close(error => error ? reject(error) : resolve(address.port)); }); }); }
async function reachable(url, timeoutMs = 2500) { return await new Promise(resolve => { const request = http.get(url, response => { response.resume(); resolve(response.statusCode === 200); }); request.setTimeout(timeoutMs, () => { request.destroy(); resolve(false); }); request.on('error', () => resolve(false)); }); }
async function waitForRecoveredRuntime(url) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await reachable(url, Math.min(250, Math.max(1, deadline - Date.now())))) return true;
    if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  }
  return false;
}
function runtimeProcess(record, runId, sandboxRoot) {
  if (!Number.isSafeInteger(record?.pid) || record.pid <= 1 || record.runId !== runId || record.runtimeRoot !== 'visual-sandbox') throw new Error('runtime record does not identify this Run');
  let url; try { url = new URL(record.url); } catch { throw new Error('runtime URL is invalid'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !/^\d+$/.test(url.port) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('runtime URL is not a loopback Demo URL');
  const inspected = spawnSync('/bin/ps', ['-p', String(record.pid), '-o', 'stat=,command='], { encoding: 'utf8', timeout: 1000 });
  if (inspected.error || (inspected.status !== 0 && !(inspected.status === 1 && !String(inspected.stderr || '').trim()))) throw new Error('runtime process inspection is unavailable');
  const line = String(inspected.stdout || '').trim();
  if (!line || /^Z/.test(line)) return 'stopped';
  if (!line.includes('visual-sandbox-runtime.mjs serve ') || !`${line} `.includes(` serve ${sandboxRoot} ${url.port} --apex-run-id ${runId} `)) throw new Error('runtime process does not match this Run and sandbox');
  return 'running';
}
function assertCurrentRun(runDir) {
  const projectRoot = path.resolve(process.env.APEX_ROUTER_PROJECT_ROOT || '');
  const runId = process.env.APEX_ROUTER_RUN_ID;
  if (!projectRoot || !runId) die('Router project root and run ID are required');
  const expected = fs.realpathSync(path.join(projectRoot, '.apex', 'runs', runId));
  if (fs.realpathSync(runDir) !== expected) die('runtime may only start the current project-local run');
  return { projectRoot: fs.realpathSync(projectRoot), runId };
}
const [command, arg, portArg, serviceFlag, serviceRunId, bindFlag, requestedHost, startFlag, startId] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command === 'serve') {
  const root = path.resolve(arg || ''); const port = Number(portArg); const host = bindHost(bindFlag ? (bindFlag === '--bind-host' ? requestedHost : null) : null);
  if (!root || !fs.existsSync(root) || !Number.isInteger(port) || port < 1024 || port > 65535 || serviceFlag !== '--apex-run-id' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(serviceRunId || '') || (bindFlag && bindFlag !== '--bind-host') || (startFlag && (startFlag !== '--apex-start-id' || !/^[a-f0-9-]{36}$/.test(startId || '')))) die('serve requires an existing sandbox root, a valid port, a run identity, and an optional loopback --bind-host');
  const realRoot = fs.realpathSync(root);
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const manifestFile = path.join(path.dirname(realRoot), 'visual-sandbox-files.json');
      if (!fs.existsSync(manifestFile) || fs.realpathSync(manifestFile) !== manifestFile) { response.writeHead(404); response.end('Not found'); return; }
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const entrypoint = typeof manifest.entrypoint === 'string' ? path.resolve(path.dirname(realRoot), manifest.entrypoint) : '';
      const relative = pathname === '/' ? path.relative(realRoot, entrypoint) : pathname.replace(/^\/+/, '');
      const file = inside(realRoot, relative);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      const realFile = fs.realpathSync(file);
      if (!realFile.startsWith(`${realRoot}${path.sep}`)) { response.writeHead(404); response.end('Not found'); return; }
      const reference = path.relative(path.dirname(realRoot), file);
      const matches = Array.isArray(manifest.files) ? manifest.files.filter(item => item?.path === reference) : [];
      if (matches.length !== 1) { response.writeHead(404); response.end('Not found'); return; }
      const content = fs.readFileSync(realFile);
      if (matches[0].sha256 !== `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`) { response.writeHead(409); response.end('Source changed'); return; }
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(content);
    } catch { response.writeHead(400); response.end('Bad request'); }
  });
  server.listen(port, host);
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
} else {
  const host = bindHost(portArg ? (portArg === '--bind-host' ? serviceFlag : null) : null);
  if (command !== 'start' || !arg || (portArg && portArg !== '--bind-host')) die('usage: start <run-dir> [--bind-host 127.0.0.1|::1]');
  const runDir = path.resolve(arg); try { requireRouterAction(runDir, 'generate_visual'); } catch (error) { die(error.message); }
  const { runId } = assertCurrentRun(runDir);
  let startLock;
  try { startLock = acquireRuntimeStartLock(runDir); }
  catch (error) { die(`another runtime start is active or its lock is unavailable: ${error.message}`); }
  try {
  const stateFile = path.join(runDir, 'state.json'); const { state, expectedStateHash } = readRunStateForUpdate(runDir);
  const filesRef = state.artifacts?.visualSandboxFiles;
  const filesManifest = filesRef && inside(runDir, filesRef);
  const realRun = fs.realpathSync(runDir);
  if (!filesManifest || filesManifest !== path.join(runDir, 'visual-sandbox-files.json') || !fs.existsSync(filesManifest) || fs.realpathSync(filesManifest) !== path.join(realRun, 'visual-sandbox-files.json')) die('a run-local materialized visual-sandbox-files.json is required');
  const manifest = read(filesManifest); const entrypoint = inside(runDir, manifest.entrypoint);
  if (manifest.status !== 'materialized' || !entrypoint || !fs.existsSync(entrypoint)) die('visual sandbox materialization is incomplete');
  const sandboxRoot = fs.realpathSync(path.dirname(entrypoint));
  const expectedRoot = path.join(realRun, 'visual-sandbox');
  if (sandboxRoot !== expectedRoot || !fs.realpathSync(entrypoint).startsWith(`${sandboxRoot}${path.sep}`) || !fs.statSync(entrypoint).isFile()) die('visual sandbox entrypoint must resolve inside the current Run sandbox');
  const runtimeFile = path.join(runDir, 'visual-sandbox-runtime.json');
  const registryFile = path.join(runDir, 'runtime-services.json');
  const intentFile = path.join(runDir, 'runtime-launch-intent.json');
  let intent, launchedPid;
  try { intent = readRuntimeLaunchIntent(runDir, runId); launchedPid = intent ? findRuntimeLaunchProcess(intent) : null; } catch (error) { die(`runtime launch recovery failed: ${error.message}`); }
  let prior = null;
  if (fs.existsSync(runtimeFile)) prior = read(runtimeFile);
  else if (fs.existsSync(registryFile)) {
    const registry = read(registryFile), services = registry.services;
    if (registry.runId !== runId || !Array.isArray(services) || services.length !== 1 || services[0]?.record !== 'visual-sandbox-runtime.json') die('runtime service registry cannot safely restore the missing runtime record');
    prior = { ...services[0], runId };
  }
  if (intent && launchedPid) {
    if (prior && prior.pid !== launchedPid) die('runtime launch intent conflicts with the existing runtime record');
    if (!prior) prior = { runId, runtimeRoot: 'visual-sandbox', pid: launchedPid, url: loopbackUrl(intent.bindHost, intent.port), startedAt: intent.startedAt };
  } else if (intent) fs.unlinkSync(intentFile);
  if (prior) {
    if (fs.existsSync(registryFile)) {
      const registry = read(registryFile), service = registry.services?.[0];
      if (registry.runId !== runId || !Array.isArray(registry.services) || registry.services.length !== 1 || service?.record !== 'visual-sandbox-runtime.json' || (service.pid !== undefined && service.pid !== prior.pid) || (service.url !== undefined && service.url !== prior.url)) die('runtime service registry does not match the existing runtime record');
    }
    let processStatus; try { processStatus = runtimeProcess(prior, runId, sandboxRoot); } catch (error) { die(error.message); }
    if (processStatus === 'running') {
      if (!(intent && launchedPid ? await waitForRecoveredRuntime(prior.url) : await reachable(prior.url))) die('existing run-local Demo process is running but its URL is unavailable; inspect it before retrying');
      const restored = { ...prior, schemaVersion: '3.0', runId, runtimeRoot: 'visual-sandbox', entrypoint: manifest.entrypoint, entrypointHash: hash(entrypoint), status: 'running' };
      write(runtimeFile, restored);
      write(registryFile, { schemaVersion: '1.0', runId, services: [{ kind: 'visual-sandbox-http', record: 'visual-sandbox-runtime.json', pid: prior.pid, url: prior.url, runtimeRoot: 'visual-sandbox', startedAt: prior.startedAt }] });
      state.artifacts.visualSandboxRuntime = 'visual-sandbox-runtime.json'; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'visual-sandbox-runtime-state-update', expectedStateHash });
      if (intent && fs.existsSync(intentFile)) fs.unlinkSync(intentFile);
      console.log(JSON.stringify({ visualSandboxRuntime: runtimeFile, url: prior.url, pid: prior.pid, reused: true })); process.exit(0);
    }
  }
  const port = await availablePort(host);
  const launch = { schemaVersion: '1.0', id: crypto.randomUUID(), runId, host: os.hostname(), bindHost: host, port, runtimeRoot: sandboxRoot, startedAt: new Date().toISOString() };
  const intentFd = fs.openSync(intentFile, 'wx'); try { fs.writeFileSync(intentFd, `${JSON.stringify(launch)}\n`); fs.fsyncSync(intentFd); } finally { fs.closeSync(intentFd); }
  const child = spawn(process.execPath, [process.argv[1], 'serve', sandboxRoot, String(port), '--apex-run-id', runId, '--bind-host', host, '--apex-start-id', launch.id], { detached: true, stdio: 'ignore' }); child.unref();
  const url = loopbackUrl(host, port);
  let ready = false; for (let attempt = 0; attempt < 20 && !ready; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 100)); ready = await reachable(url); }
  if (!ready) { child.kill('SIGTERM'); die('run-local Demo server did not become reachable'); }
  try { if (runtimeProcess({ pid: child.pid, runId, runtimeRoot: 'visual-sandbox', url }, runId, sandboxRoot) !== 'running') throw new Error('spawned Demo process has exited'); }
  catch (error) { child.kill('SIGTERM'); die(`run-local Demo process could not be verified: ${error.message}`); }
  const output = { schemaVersion: '3.0', runId, runtimeRoot: path.relative(fs.realpathSync(runDir), sandboxRoot), entrypoint: manifest.entrypoint, entrypointHash: hash(entrypoint), url, pid: child.pid, startedAt: new Date().toISOString(), status: 'running' };
  write(runtimeFile, output);
  write(path.join(runDir, 'runtime-services.json'), { schemaVersion: '1.0', runId, services: [{ kind: 'visual-sandbox-http', record: 'visual-sandbox-runtime.json', pid: child.pid, url, runtimeRoot: output.runtimeRoot, startedAt: output.startedAt }] });
  state.artifacts.visualSandboxRuntime = 'visual-sandbox-runtime.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString();
  try { commitRunState(runDir, state, { reason: 'visual-sandbox-runtime-state-update', expectedStateHash }); }
  catch (error) { child.kill('SIGTERM'); throw error; }
  fs.unlinkSync(intentFile);
  console.log(JSON.stringify({ visualSandboxRuntime: runtimeFile, url, pid: child.pid, reused: false }));
  } finally { try { startLock.exec('ROLLBACK'); } finally { startLock.close(); } }
}
