#!/usr/bin/env node
/** Start and verify the only HTTP runtime permitted for a run-local visual sandbox. */
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Visual sandbox runtime failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${path.basename(file)}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(root, candidate) { const resolved = path.resolve(root, candidate); return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null; }
function contentType(file) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }
async function availablePort() { return await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const address = probe.address(); probe.close(error => error ? reject(error) : resolve(address.port)); }); }); }
async function reachable(url) { return await new Promise(resolve => { const request = http.get(url, response => { response.resume(); resolve(response.statusCode === 200); }); request.setTimeout(2500, () => { request.destroy(); resolve(false); }); request.on('error', () => resolve(false)); }); }
function assertCurrentRun(runDir) {
  const projectRoot = path.resolve(process.env.APEX_ROUTER_PROJECT_ROOT || '');
  const runId = process.env.APEX_ROUTER_RUN_ID;
  if (!projectRoot || !runId) die('Router project root and run ID are required');
  const expected = fs.realpathSync(path.join(projectRoot, '.apex', 'runs', runId));
  if (fs.realpathSync(runDir) !== expected) die('runtime may only start the current project-local run');
  return { projectRoot: fs.realpathSync(projectRoot), runId };
}
const [command, arg, portArg, serviceFlag, serviceRunId] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command === 'serve') {
  const root = path.resolve(arg || ''); const port = Number(portArg);
  if (!root || !fs.existsSync(root) || !Number.isInteger(port) || port < 1024 || port > 65535 || serviceFlag !== '--apex-run-id' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(serviceRunId || '')) die('serve requires an existing sandbox root, a valid port, and a run identity');
  const realRoot = fs.realpathSync(root);
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = inside(realRoot, relative);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      fs.createReadStream(file).pipe(response);
    } catch { response.writeHead(400); response.end('Bad request'); }
  });
  server.listen(port, '127.0.0.1');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
} else {
  if (command !== 'start' || !arg) die('usage: start <run-dir>');
  const runDir = path.resolve(arg); try { requireRouterAction(runDir, 'generate_visual'); } catch (error) { die(error.message); }
  const { runId } = assertCurrentRun(runDir);
  const stateFile = path.join(runDir, 'state.json'), state = read(stateFile);
  const filesRef = state.artifacts?.visualSandboxFiles;
  const filesManifest = filesRef && inside(runDir, filesRef);
  if (!filesManifest || !fs.existsSync(filesManifest)) die('a materialized visual-sandbox-files.json is required');
  const manifest = read(filesManifest); const entrypoint = inside(runDir, manifest.entrypoint);
  if (manifest.status !== 'materialized' || !entrypoint || !fs.existsSync(entrypoint)) die('visual sandbox materialization is incomplete');
  const sandboxRoot = fs.realpathSync(path.dirname(entrypoint));
  const runtimeFile = path.join(runDir, 'visual-sandbox-runtime.json');
  if (fs.existsSync(runtimeFile)) {
    try {
      const prior = read(runtimeFile);
      if (prior.entrypointHash === hash(entrypoint) && prior.url && await reachable(prior.url)) {
        state.artifacts.visualSandboxRuntime = 'visual-sandbox-runtime.json'; state.updatedAt = new Date().toISOString(); write(stateFile, state);
        console.log(JSON.stringify({ visualSandboxRuntime: runtimeFile, url: prior.url, reused: true })); process.exit(0);
      }
    } catch {}
  }
  const port = await availablePort();
  const child = spawn(process.execPath, [process.argv[1], 'serve', sandboxRoot, String(port), '--apex-run-id', runId], { detached: true, stdio: 'ignore' }); child.unref();
  const url = `http://127.0.0.1:${port}/`;
  let ready = false; for (let attempt = 0; attempt < 20 && !ready; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 100)); ready = await reachable(url); }
  if (!ready) die('run-local Demo server did not become reachable');
  const output = { schemaVersion: '3.0', runId, runtimeRoot: path.relative(runDir, sandboxRoot), entrypoint: manifest.entrypoint, entrypointHash: hash(entrypoint), url, pid: child.pid, startedAt: new Date().toISOString(), status: 'running' };
  write(runtimeFile, output);
  write(path.join(runDir, 'runtime-services.json'), { schemaVersion: '1.0', runId, services: [{ kind: 'visual-sandbox-http', record: 'visual-sandbox-runtime.json', pid: child.pid, url, runtimeRoot: output.runtimeRoot, startedAt: output.startedAt }] });
  state.artifacts.visualSandboxRuntime = 'visual-sandbox-runtime.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
  console.log(JSON.stringify({ visualSandboxRuntime: runtimeFile, url, pid: child.pid, reused: false }));
}
