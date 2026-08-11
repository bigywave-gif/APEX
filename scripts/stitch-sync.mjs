#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = process.env.STITCH_HOST || 'https://stitch.googleapis.com/mcp';
const RPC_TIMEOUT_MS = Number(process.env.APEX_STITCH_RPC_TIMEOUT_MS || 20000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.APEX_STITCH_DOWNLOAD_TIMEOUT_MS || 15000);
const RETRY_ATTEMPTS = Math.max(1, Math.min(Number(process.env.APEX_STITCH_RETRY_ATTEMPTS || 2), 3));

function die(message) { console.error(`Stitch sync failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function hash(value) { return 'sha256:' + crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex'); }
function apiKey() {
  if (process.env.STITCH_API_KEY) return process.env.STITCH_API_KEY;
  try { return execFileSync('/bin/launchctl', ['getenv', 'STITCH_API_KEY'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}
async function fetchWithRetry(url, options, timeoutMs, label) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === RETRY_ATTEMPTS) return response;
      lastError = new Error(`${label} HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    finally { clearTimeout(timeout); }
    await new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
  }
  throw lastError || new Error(`${label} failed`);
}
async function rpc(method, params = {}) {
  const key = apiKey();
  if (!key) die('STITCH_API_KEY is not available');
  let response;
  try { response = await fetchWithRetry(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-goog-api-key': key }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) }, RPC_TIMEOUT_MS, method); }
  catch (error) { die(`${method} timed out or failed after retry: ${error.message}`); }
  let payload;
  try { payload = await response.json(); } catch (error) { die(`${method} returned a non-JSON response: ${error.message}`); }
  if (!response.ok || payload.error) die(payload.error?.message || `HTTP ${response.status}`);
  return payload.result;
}
async function tool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result?.isError) die(result.content?.map(item => item.text).join('\n') || `${name} failed`);
  if (result?.structuredContent && Object.keys(result.structuredContent).length) return result.structuredContent;
  const text = result?.content?.find(item => item.type === 'text')?.text;
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { text }; }
}
function bareProject(value) { return value.replace(/^projects\//, ''); }
function findUrls(value, output = [], field = '') {
  if (Array.isArray(value)) value.forEach(item => findUrls(item, output, field));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (/downloadUrl$/i.test(key) && typeof child === 'string') output.push({ url: child, field: field ? field + '.' + key : key });
    else findUrls(child, output, field ? field + '.' + key : key);
  }
  return output;
}
function isStrictDownload(item) {
  const value = `${item.field} ${item.url}`.toLowerCase();
  return /\.html?(?:$|[?#])/.test(value) || /(?:screenshot|preview|render)/.test(value) && /\.(?:png|jpe?g|webp)(?:$|[?#])/.test(value);
}
async function materializeDownloads(metadata, artifactDir) {
  // Strict parity consumes only the HTML export and rendered screenshot. Do not
  // serially download arbitrary image assets, fonts, or archives returned by MCP.
  const downloads = [...new Map(findUrls(metadata).filter(isStrictDownload).map(item => [item.url, item])).values()];
  const values = [];
  fs.mkdirSync(artifactDir, { recursive: true });
  for (let index = 0; index < downloads.length; index += 1) {
    const entry = downloads[index];
    const url = entry.url;
    let response;
    try { response = await fetchWithRetry(url, {}, DOWNLOAD_TIMEOUT_MS, 'download'); }
    catch (error) { die(`download failed after retry: ${error.message}`); }
    if (!response.ok) die('download failed: HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    const pathname = new URL(url).pathname;
    const extension = path.extname(pathname).toLowerCase() || '.bin';
    const kind = /\.html?$/i.test(extension) ? 'html' : /\.(png|jpe?g|webp|gif)$/i.test(extension) ? (/screenshot|preview|render/i.test(entry.field + ' ' + pathname) ? 'screenshot' : 'image') : 'asset';
    const file = path.join(artifactDir, String(index).padStart(2, '0') + '-' + kind + extension);
    fs.writeFileSync(file, bytes);
    values.push({ url: pathname, field: entry.field, hash: hash(bytes), kind, path: file });
  }
  return { urls: downloads.map(item => item.url), values, combined: hash(values) };
}
function firstAsset(downloads, kind) {
  return downloads.values.find(item => item.kind === kind) || null;
}
function jobPath(runDir, input) { return path.resolve(input || path.join(runDir, 'stitch-job.json')); }
function readyMetadata(metadata) {
  const downloads = findUrls(metadata).filter(isStrictDownload);
  const hasHtml = downloads.some(item => /\.html?(?:$|[?#])/.test(`${item.field} ${item.url}`.toLowerCase()));
  const hasScreenshot = downloads.some(item => /(?:screenshot|preview|render)/.test(`${item.field} ${item.url}`.toLowerCase()) && /\.(?:png|jpe?g|webp)(?:$|[?#])/.test(`${item.field} ${item.url}`.toLowerCase()));
  return hasHtml && hasScreenshot;
}
async function observeScreen(runDir, file, attemptsArg) {
  const job = read(file);
  if (!job.projectId || !job.screenId) die('Stitch job needs projectId and screenId; bind the actual generated Screen before polling');
  const attempts = Math.max(1, Math.min(Number(attemptsArg || 1), 3));
  const projectId = bareProject(job.projectId);
  let latest = null;
  for (let index = 0; index < attempts; index += 1) {
    latest = await tool('get_screen', { name: `projects/${projectId}/screens/${job.screenId}`, projectId, screenId: job.screenId });
    job.attempts = Number(job.attempts || 0) + 1; job.lastObservedAt = new Date().toISOString(); job.metadataHash = hash(latest);
    if (readyMetadata(latest)) { job.status = 'ready'; job.readyAt = job.lastObservedAt; write(file, job); console.log(JSON.stringify({ status: 'ready', job: file, projectId: job.projectId, screenId: job.screenId, attempts: job.attempts })); return; }
    job.status = 'pending'; write(file, job);
    if (index < attempts - 1) await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** index)));
  }
  console.log(JSON.stringify({ status: 'pending', job: file, projectId: job.projectId, screenId: job.screenId, attempts: job.attempts, next: 'resume observe_stitch; do not submit again' })); process.exitCode = 2;
}
async function snapshot(selection, runDir) {
  const projectId = bareProject(selection.projectId);
  const listed = await tool('list_screens', { projectId });
  const listedHash = hash(listed);
  const approvedScreens = [];
  const rawScreens = [];
  for (const chosen of selection.approvedScreens) {
    const name = `projects/${projectId}/screens/${chosen.screenId}`;
    const metadata = await tool('get_screen', { name, projectId, screenId: chosen.screenId });
    const downloads = await materializeDownloads(metadata, path.join(runDir, 'evidence', 'stitch', 'screens', chosen.screenId));
    const html = firstAsset(downloads, 'html');
    const image = firstAsset(downloads, 'screenshot');
    if (!html || !image) die('screen ' + chosen.screenId + ' must expose explicitly labeled downloadable HTML and screenshot for strict parity');
    rawScreens.push({ screenId: chosen.screenId, metadata, downloads });
    approvedScreens.push({ ...chosen, htmlHash: html.hash, imageHash: image.hash, htmlPath: path.relative(runDir, html.path), imagePath: path.relative(runDir, image.path) });
  }
  const designSystems = await tool('list_design_systems', { projectId });
  return { listed, listedHash, approvedScreens, rawScreens, designSystems, designSystemHash: hash(designSystems) };
}
function imageInputTools(tools) {
  return tools.filter(item => {
    const name = String(item.name || '');
    const description = String(item.description || '');
    // DESIGN.md upload and design-system creation are text/design-token operations,
    // not image-reference input. Require an explicit image-bearing operation.
    return /(?:upload|attach|add)[_-]?(?:reference[_-]?)?(?:image|screenshot|wireframe)|(?:reference|source)[_-]?(?:image|screenshot|wireframe)|image[_-]?(?:upload|input|reference)|wireframe[_-]?upload/i.test(`${name} ${description}`);
  });
}
function updateState(runDir, reference, current) {
  const stateFile = path.join(runDir, 'state.json');
  if (!fs.existsSync(stateFile)) return;
  const state = read(stateFile);
  state.artifacts.stitchFreeze = reference;
  state.locks.stitchCurrent = current;
  if (current && state.locks.visualApproved) state.phase = state.track === 'greenfield' ? 'G-07 COMPILE' : 'E-09 COMPILE';
  state.revision = Number(state.revision || 0) + 1;
  state.updatedAt = new Date().toISOString();
  write(stateFile, state);
}

const [command, ...args] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command === 'list-projects') {
  console.log(JSON.stringify(await tool('list_projects', { filter: args[0] || 'view=owned' }), null, 2));
} else if (command === 'capabilities') {
  const result = await rpc('tools/list');
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  const imageTools = imageInputTools(tools);
  console.log(JSON.stringify({ imageReferenceInput: imageTools.length > 0, imageTools: imageTools.map(item => item.name), fallback: imageTools.length ? 'mcp-native' : 'stitch-ui-automation' }, null, 2));
} else if (command === 'bind-screen') {
  const [runDirArg, jobArg, projectId, screenId] = args;
  if (!runDirArg || !jobArg || !projectId || !screenId) die('usage: bind-screen <run-dir> <stitch-job.json> <project-id> <screen-id>');
  const runDir = path.resolve(runDirArg); try { requireRouterAction(runDir, 'observe_stitch'); } catch (error) { die(error.message); }
  const file = jobPath(runDir, jobArg); const job = read(file);
  if (!['submitted', 'pending'].includes(job.status)) die('only a submitted or pending Stitch job may bind a Screen');
  job.projectId = projectId; job.screenId = screenId; job.status = 'bound'; job.boundAt = new Date().toISOString(); write(file, job);
  console.log(JSON.stringify({ status: 'bound', job: file, projectId, screenId }));
} else if (command === 'await-screen') {
  const [runDirArg, jobArg, attempts] = args;
  if (!runDirArg || !jobArg) die('usage: await-screen <run-dir> <stitch-job.json> [attempts]');
  const runDir = path.resolve(runDirArg); try { requireRouterAction(runDir, 'observe_stitch'); } catch (error) { die(error.message); }
  await observeScreen(runDir, jobPath(runDir, jobArg), attempts);
} else if (command === 'freeze') {
  const [runDirArg, selectionArg] = args;
  if (!runDirArg || !selectionArg) die('usage: freeze <run-dir> <canvas-selection.json>');
  const runDir = path.resolve(runDirArg);
  try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
  const selectionFile = path.resolve(selectionArg);
  const selection = read(selectionFile);
  const pendingJob = path.join(runDir, 'stitch-job.json');
  if (fs.existsSync(pendingJob)) {
    const job = read(pendingJob);
    if (job.status !== 'ready') die('Stitch job is not ready; bind and observe the generated Screen before freezing');
    if (!selection.approvedScreens.some(screen => screen.screenId === job.screenId)) die('canvas selection does not include the ready Stitch job Screen');
  }
  const snap = await snapshot(selection, runDir);
  const freeze = { schemaVersion: '3.0', projectId: selection.projectId, canvasUrl: selection.canvasUrl, approval: selection.approval, approvedScreens: snap.approvedScreens, excludedScreens: selection.excludedScreens, ...(selection.generationInput ? { generationInput: selection.generationInput } : {}), fingerprints: { screenSetHash: hash({ listed: snap.listedHash, approved: snap.approvedScreens }), designSystemHash: snap.designSystemHash }, syncedAt: new Date().toISOString() };
  const freezeFile = path.join(runDir, 'stitch-freeze.json');
  write(freezeFile, freeze);
  write(path.join(runDir, 'stitch-raw.json'), { schemaVersion: '3.0', projectId: selection.projectId, screens: snap.rawScreens, designSystems: snap.designSystems });
  updateState(runDir, 'stitch-freeze.json', false);
  console.log(JSON.stringify({ freeze: freezeFile, status: 'provisional', next: 'run strict-replica.mjs stitch, then seal' }));
} else if (command === 'seal') {
  const runDir = path.resolve(args[0] || '.');
  try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
  const stateFile = path.join(runDir, 'state.json');
  const state = read(stateFile);
  if (!state.locks.effectApproved || !state.locks.stitchApproved) die('effect-image approval and Stitch approval are required before sealing Stitch');
  const evidenceFile = path.join(runDir, state.artifacts.stitchParityEvidence || 'stitch-parity-evidence.json');
  const evidence = read(evidenceFile);
  if (evidence.status !== 'passed' || !evidence.strictPixelMatch || !Array.isArray(evidence.unmatched) || evidence.unmatched.length) die('strict Stitch parity evidence must pass before sealing');
  if (evidence.structuralVerification?.source !== 'stitch-screen-export' || !evidence.structuralVerification.contractHash || !evidence.structuralVerification.contractPath) die('sealed Stitch requires an automatic structure contract');
  const contractFile = path.resolve(runDir, evidence.structuralVerification.contractPath);
  if (!fs.existsSync(contractFile) || hash(fs.readFileSync(contractFile)) !== evidence.structuralVerification.contractHash) die('strict Stitch structure contract is missing or changed');
  const contract = read(contractFile);
  if (contract.source !== 'stitch-screen-export' || contract.sourceImageHash !== evidence.stitchImageHash || contract.verification?.status !== 'passed') die('strict Stitch structure contract is not a passed export of the compared screen');
  updateState(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json', true);
  console.log(JSON.stringify({ sealed: true, stitchFreeze: state.artifacts.stitchFreeze || 'stitch-freeze.json' }));
} else if (command === 'check') {
  const runDir = path.resolve(args[0] || '.');
  try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
  const freeze = read(path.join(runDir, 'stitch-freeze.json'));
  const selection = { schemaVersion: '3.0', projectId: freeze.projectId, canvasUrl: freeze.canvasUrl, approval: freeze.approval, approvedScreens: freeze.approvedScreens.map(({ htmlHash, imageHash, htmlPath, imagePath, ...item }) => item), excludedScreens: freeze.excludedScreens };
  const snap = await snapshot(selection, runDir);
  const currentHash = hash({ listed: snap.listedHash, approved: snap.approvedScreens });
  const changed = currentHash !== freeze.fingerprints.screenSetHash || snap.designSystemHash !== freeze.fingerprints.designSystemHash;
  if (changed) {
    const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts/apex-router.mjs'), 'transition', process.env.APEX_ROUTER_PROJECT_ROOT, process.env.APEX_ROUTER_RUN_ID, process.env.APEX_ROUTER_SESSION_ID, process.env.APEX_ROUTER_AUTHORIZATION_REF, 'revoke-stitch', 'remote-canvas-changed'], { encoding: 'utf8' });
    if (result.status !== 0) die(result.stderr || result.stdout);
    console.log(JSON.stringify({ current: false, changed: true }));
    process.exitCode = 2;
  } else console.log(JSON.stringify({ current: true, changed: false }));
} else die('commands: list-projects | capabilities | bind-screen | await-screen | freeze | seal | check');
