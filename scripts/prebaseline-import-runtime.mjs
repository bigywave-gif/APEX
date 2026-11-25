#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot, npmCacheRoot, playwrightBridge } from './apex-paths.mjs';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { prebaselineObservationBinding } from './prebaseline-import-review.mjs';
import { prebaselineRuntimeProbeCode } from './prebaseline-runtime-probe.mjs';
import { runControlledSubprocess } from './controlled-subprocess.mjs';

const apex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, runArg, originArg] = process.argv.slice(2);
const die = message => { throw new Error(`Prebaseline runtime observation failed: ${message}`); };
const sha = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const parse = output => { const match = output.match(/### Result\s*\n([\s\S]*?)\n### /); if (!match) return null; try { let value = JSON.parse(match[1]); return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
if (command !== 'observe' || !runArg || !originArg) die('usage: observe <run-dir> <loopback-http-origin>');
if (fs.realpathSync(apex) !== fs.realpathSync(canonicalApexRoot)) die('the canonical Core is required');
const runDir = path.resolve(runArg), snapshot = (() => { try { return requireRouterAction(runDir, 'collect_existing_baseline'); } catch (error) { die(error.message); } })();
const step = snapshot.executionDirective?.currentStep;
if (step?.id !== 'prebaseline-runtime-observe' || !step.observationBinding) die('current Router step does not authorize this observation');
const project = fs.realpathSync(process.env.APEX_ROUTER_PROJECT_ROOT || ''), root = fs.realpathSync(runDir), binding = step.observationBinding;
let origin; try { origin = new URL(originArg); } catch { die('invalid origin'); }
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) die('origin must be an explicit 127.0.0.1 HTTP service root');
const stateFile = path.join(root, 'state.json'), stateHash = sha(fs.readFileSync(stateFile));
const checkBinding = () => JSON.stringify(prebaselineObservationBinding(root, project, binding.inspection)) === JSON.stringify(binding);
if (!checkBinding()) die('inspection or role evidence changed');
const inspectionPath = fs.realpathSync(path.resolve(root, binding.inspection));
if (!inspectionPath.startsWith(`${root}${path.sep}`)) die('inspection is outside the Run');
const inspection = JSON.parse(fs.readFileSync(inspectionPath, 'utf8'));
const declaredRoutes = inspection.scope?.routes;
if (!Array.isArray(declaredRoutes) || !declaredRoutes.length || declaredRoutes.length > 1000 || declaredRoutes.some(route => typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('\\') || new URL(route, origin).origin !== origin.origin)) die('inspection routes are invalid');
const routes = [...new Set(declaredRoutes)];
const sourceHashes = new Map(inspection.sourceObservations.map(item => [item.path, item.sha256]));
const sources = [...new Set(inspection.unresolvedImports.map(item => item.source))].map(source => ({ source, sha256: sourceHashes.get(source) }));
if (!sources.length || sources.length > 10000 || sources.some(item => !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || ''))) die('candidate source hashes are invalid');
const cached = (() => { try { return fs.readdirSync(npmCacheRoot).map(name => path.join(npmCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file)); } catch { return null; } })();
if (!cached && !fs.existsSync(playwrightBridge)) die('Playwright bridge is unavailable');
const session = `apex-prebaseline-${crypto.createHash('sha1').update(root).digest('hex').slice(0, 12)}`;
const daemon = path.join(root, 'cache', 'playwright-daemon'); fs.mkdirSync(daemon, { recursive: true });
const executable = cached ? process.execPath : playwrightBridge;
const argumentsFor = args => cached ? [cached, '--session', session, ...args] : ['--session', session, ...args];
const env = { ...process.env, PWTEST_DAEMON_SESSION_DIR: daemon };
process.chdir(root);
let childGroup = null, daemonPid = null, interrupted = false;
const stopDaemon = () => {
  if (!Number.isSafeInteger(daemonPid) || daemonPid < 2 || process.platform === 'win32') return;
  const inspected = spawnSync('/bin/ps', ['-p', String(daemonPid), '-o', 'command='], { encoding: 'utf8', timeout: 2000 });
  const command = (inspected.stdout || '').trim();
  if (inspected.status === 0 && command.includes('/playwright-core/lib/entry/cliDaemon.js ') && command.endsWith(` ${session}`)) {
    try { process.kill(daemonPid, 'SIGTERM'); } catch {}
  }
};
const forward = () => { interrupted = true; if (childGroup && process.platform !== 'win32') { try { process.kill(-childGroup, 'SIGTERM'); } catch {} } stopDaemon(); };
process.on('SIGTERM', forward); process.on('SIGINT', forward);
const invoke = async args => {
  if (interrupted) die('observation interrupted');
  const result = await runControlledSubprocess(executable, argumentsFor(args), { env, runDir: root, timeoutMs: 90000, maxBuffer: 8 * 1024 * 1024, onSpawn: identity => { childGroup = identity.processGroup; } });
  childGroup = null;
  if (interrupted || result.cancelled || result.error) die(interrupted || result.cancelled ? 'observation cancelled or interrupted' : `browser process failed: ${result.error.message}`);
  return result;
};
const results = []; let observationFinished = false;
try {
  const opened = await invoke(['open', 'about:blank']); if (opened.status !== 0) die('could not open browser');
  const daemonMatch = (opened.stdout || '').match(new RegExp('Browser `'+session+'` opened with pid (\\d+)\\.'));
  if (daemonMatch) daemonPid = Number(daemonMatch[1]);
  for (const route of routes) {
    const result = await invoke(['run-code', prebaselineRuntimeProbeCode({ origin: origin.href, routes: [route] })]);
    const observed = parse(result.stdout || '');
    if (result.status !== 0 || observed?.routes?.length !== 1 || observed.routes[0].route !== route) die(`browser observation failed for ${route}`);
    results.push(observed.routes[0]);
  }
  observationFinished = true;
} finally {
  process.removeListener('SIGTERM', forward); process.removeListener('SIGINT', forward);
  // Cleanup must still run after cancellation, when the monitored subprocess
  // helper correctly refuses to launch more work.
  if (!observationFinished) stopDaemon();
  spawnSync(executable, argumentsFor(['close']), { cwd: root, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
}
if (sha(fs.readFileSync(stateFile)) !== stateHash || !checkBinding()) die('inspection, roles, or Run state changed during browser observation');
const matchingHashes = new Set(sources.map(item => item.sha256)), loadedByHash = new Map();
for (const route of results) for (const item of route.responses) if (matchingHashes.has(item.sha256)) { const loaded = loadedByHash.get(item.sha256) || []; loaded.push({ route: route.route, path: item.path, resourceType: item.resourceType }); loadedByHash.set(item.sha256, loaded); }
const observations = sources.map(source => ({ ...source, loadedAt: loadedByHash.get(source.sha256) || [] }));
const sanitizedRoutes = results.map(({ responses, ...route }) => ({ ...route, matchedResponses: responses.filter(item => matchingHashes.has(item.sha256)) }));
const token = path.basename(process.env.APEX_ROUTER_AUTHORIZATION_REF || '', '.json');
if (!/^[a-f0-9-]{36}$/.test(token)) die('invalid authorization identity');
const directory = path.join(root, 'evidence', 'prebaseline-runtime'); fs.mkdirSync(directory, { recursive: true });
if (fs.realpathSync(directory) !== directory) die('observation directory must be inside the Run without symlinks');
const output = path.join(directory, `${token}.json`);
const value = { schemaVersion: '1.0', type: 'prebaseline-runtime-observation', status: 'observed', runId: snapshot.runId, binding, origin: origin.origin, serviceOwnership: 'unverified', routes: sanitizedRoutes, sources: observations, observedAt: new Date().toISOString(), limitations: ['loaded-source-hash-does-not-prove-execution-or-all-interactions', 'not-a-build-result-or-an-import-exception', 'route-interception-does-not-prove-complete-network-isolation'] };
const serialized = `${JSON.stringify(value, null, 2)}\n`;
if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) die('observation exceeds the bounded evidence size');
fs.writeFileSync(output, serialized, { flag: 'wx' });
console.log(JSON.stringify({ observation: output, status: value.status, routes: routes.length, sources: sources.length, unobservedSources: observations.filter(item => !item.loadedAt.length).length, permitsBaseline: false }));
