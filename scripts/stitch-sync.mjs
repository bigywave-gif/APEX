#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { appendLedgerEvent, commitRunState, readRunState, readRunStateForUpdate, recordExternalSubmissionObservation } from './run-ledger.mjs';
import { availableStitchSkills, loadStitchSkill } from './required-visual-skill.mjs';
import { stitchAdaptationForFreeze } from './stitch-adaptation.mjs';
import { validateMultiStitch } from './stitch-screen-progress.mjs';
import { autoBindStitchScreens } from './stitch-screen-binding.mjs';

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
function saveDownload(artifactDir, name, extension, bytes) {
  const digest = hash(bytes);
  const file = path.join(artifactDir, `${name}-${digest.slice(7)}${extension}`);
  const temporary = path.join(artifactDir, `.download-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST' || !fs.readFileSync(file).equals(bytes)) throw error;
    }
  } finally { fs.rmSync(temporary, { force: true }); }
  return { file, digest };
}
function captureInputs(runDir, references) {
  const root = fs.realpathSync(runDir), logicalRoot = path.resolve(runDir);
  const normalize = ref => {
    const absolute = path.resolve(logicalRoot, ref);
    if (absolute.startsWith(`${logicalRoot}${path.sep}`)) return path.resolve(root, path.relative(logicalRoot, absolute));
    return absolute;
  };
  return [...new Set(references.filter(Boolean).map(normalize))].map(file => {
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Stitch input must remain inside the current Run');
    if (!fs.existsSync(file)) return { file, missing: true };
    const real = fs.realpathSync(file);
    if (!real.startsWith(`${root}${path.sep}`) || !fs.statSync(real).isFile()) throw new Error('Stitch input must be a Run-local file');
    return { file, real, sha256: hash(fs.readFileSync(real)) };
  });
}
function assertInputsUnchanged(runDir, captured) {
  const current = captureInputs(runDir, captured.map(item => item.file));
  if (JSON.stringify(current) !== JSON.stringify(captured)) throw new Error('Stitch input changed during remote read; preserve and re-evaluate the confirmed Demo before retrying');
}
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
function stitchFileResources(metadata) {
  const screen = metadata?.screen || metadata;
  const html = screen?.htmlCode || screen?.html_code;
  const image = screen?.screenshot;
  const valid = item => typeof item?.name === 'string' && /^projects\/[^/]+\/files\/[^/]+$/.test(item.name);
  return valid(html) && valid(image) ? { html: html.name, screenshot: image.name } : null;
}
async function downloadNamedScreen(resources) {
  const htmlResult = await tool('download_file', { name: resources.html });
  const imageResult = await tool('download_file', { name: resources.screenshot });
  if (typeof htmlResult.html !== 'string' || !htmlResult.html.trim()) die('Stitch HTML file resource did not return HTML');
  if (typeof imageResult.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageResult.image)) die('Stitch screenshot file resource did not return base64 image bytes');
  const bytes = Buffer.from(imageResult.image, 'base64');
  const extension = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? '.png' : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? '.jpg' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? '.webp' : null;
  if (!extension) die('Stitch screenshot file resource has an unsupported image format');
  return { html: Buffer.from(htmlResult.html, 'utf8'), screenshot: bytes, extension };
}
async function materializeDownloads(metadata, artifactDir) {
  // Strict parity consumes only the HTML export and rendered screenshot. Do not
  // serially download arbitrary image assets, fonts, or archives returned by MCP.
  const resources = stitchFileResources(metadata);
  const values = [];
  fs.mkdirSync(artifactDir, { recursive: true });
  if (resources) {
    const downloaded = await downloadNamedScreen(resources);
    for (const [kind, bytes, extension] of [['html', downloaded.html, '.html'], ['screenshot', downloaded.screenshot, downloaded.extension]]) {
      const { file, digest } = saveDownload(artifactDir, kind, extension, bytes);
      values.push({ field: kind, resource: resources[kind], hash: digest, kind, path: file });
    }
    return { urls: [], values, combined: hash(values) };
  }
  const downloads = [...new Map(findUrls(metadata).filter(isStrictDownload).map(item => [item.url, item])).values()];
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
    const { file, digest } = saveDownload(artifactDir, String(index).padStart(2, '0') + '-' + kind, extension, bytes);
    values.push({ url: pathname, field: entry.field, hash: digest, kind, path: file });
  }
  return { urls: downloads.map(item => item.url), values, combined: hash(values) };
}
function firstAsset(downloads, kind) {
  return downloads.values.find(item => item.kind === kind) || null;
}
function jobPath(runDir, input) { return path.resolve(input || path.join(runDir, 'stitch-job.json')); }
function readyMetadata(metadata) {
  if (stitchFileResources(metadata)) return true;
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
    latest = await tool('get_screen', { name: `projects/${projectId}/screens/${job.screenId}` });
    job.attempts = Number(job.attempts || 0) + 1; job.lastObservedAt = new Date().toISOString(); job.metadataHash = hash(latest);
    if (readyMetadata(latest)) { job.status = 'ready'; job.readyAt = job.lastObservedAt; write(file, job); if (job.intentId) recordExternalSubmissionObservation(runDir, { intentId: job.intentId, status: 'ready', projectId: job.projectId, screenId: job.screenId, at: job.readyAt }); console.log(JSON.stringify({ status: 'ready', job: file, projectId: job.projectId, screenId: job.screenId, attempts: job.attempts })); return; }
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
    const metadata = await tool('get_screen', { name });
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
function updateState(runDir, reference, current, automatic = false, snapshot, machineSeal = null) {
  const stateFile = path.join(runDir, 'state.json');
  if (!fs.existsSync(stateFile)) return;
  const { state, expectedStateHash } = snapshot;
  state.artifacts.stitchFreeze = reference;
  state.artifacts.stitchMachineSeal = machineSeal;
  state.locks.stitchCurrent = current;
  if (automatic) state.locks.stitchApproved = true;
  if (current && state.locks.visualApproved) state.phase = state.track === 'greenfield' ? 'G-07 COMPILE' : 'E-09 COMPILE';
  state.revision = Number(state.revision || 0) + 1;
  state.updatedAt = new Date().toISOString();
  commitRunState(runDir, state, { reason: 'stitch-freeze-state-update', expectedStateHash });
}

const [command, ...args] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command === 'list-projects') {
  console.log(JSON.stringify(await tool('list_projects', { filter: args[0] || 'view=owned' }), null, 2));
} else if (command === 'probe-screen') {
  const name = args[0];
  if (!/^projects\/[^/]+\/screens\/[^/]+$/.test(name || '')) die('probe-screen requires a complete screen resource name');
  const metadata = await tool('get_screen', { name }); const resources = stitchFileResources(metadata);
  if (!resources) die('screen does not expose both named HTML and screenshot resources');
  const result = await downloadNamedScreen(resources);
  console.log(JSON.stringify({ status: 'passed', htmlBytes: result.html.length, screenshotBytes: result.screenshot.length, screenshotFormat: result.extension, htmlHash: hash(result.html), screenshotHash: hash(result.screenshot) }));
} else if (command === 'skills') {
  const [runArg, subcommand, name, expectedHash] = args;
  if (!runArg || !['list', 'load'].includes(subcommand)) die('usage: skills <run-dir> list | skills <run-dir> load <name> <sha256>');
  const runDir = path.resolve(runArg);
  try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
  const state = readRunState(runDir);
  if (state.deliveryRoute !== 'stitch' || !state.locks?.effectApproved) die('Stitch adaptation skills require the confirmed Demo and selected Stitch route');
  const boundary = 'Only apply rules compatible with the confirmed Demo; never silently change its layout, content, behavior, tokens, or accessibility.';
  if (subcommand === 'list') console.log(JSON.stringify({ status: 'available', skills: availableStitchSkills(), boundary }));
  else {
    let skill; try { skill = loadStitchSkill(name, expectedHash); } catch (error) { die(error.message); }
    const baselineRef = state.artifacts?.runtimeVisualBaseline, root = fs.realpathSync(runDir);
    let demoBaselineHash = null;
    if (baselineRef && !path.isAbsolute(baselineRef)) { const baseline = fs.realpathSync(path.resolve(root, baselineRef)); if (!baseline.startsWith(`${root}${path.sep}`)) die('Demo baseline must remain inside the Run'); demoBaselineHash = hash(fs.readFileSync(baseline)); }
    appendLedgerEvent(runDir, { type: 'stitch-adaptation-skill-loaded', name: skill.name, sha256: skill.sha256, path: skill.path, demoBaselineHash, operationReceipt: process.env.APEX_ROUTER_OPERATION_RECEIPT || null });
    console.log(JSON.stringify({ status: 'loaded', skill, boundary }));
  }
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
  if (!['submission-uncertain', 'submitted', 'pending'].includes(job.status)) die('only an uncertain, submitted or pending Stitch job may bind a Screen');
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
  const stateSnapshot = readRunStateForUpdate(runDir), { state } = stateSnapshot;
  const pendingJob = path.join(runDir, 'stitch-job.json');
  const inputs = captureInputs(runDir, [selectionFile, pendingJob, state.artifacts?.runtimeVisualBaseline, state.artifacts?.runtimeDemo, state.artifacts?.visualReference]);
  const selection = read(selectionFile);
  if (state.roleChain?.confirmationModel === 'two-confirmations' && selection.approvedScreens?.length > 1) {
    const baselineFile = state.artifacts?.runtimeVisualBaseline && path.join(runDir, state.artifacts.runtimeVisualBaseline);
    if (!baselineFile || !fs.existsSync(baselineFile)) die('multi-screen Stitch requires the confirmed Demo baseline');
    try { selection.approvedScreens = autoBindStitchScreens(runDir, read(baselineFile), selection.approvedScreens); } catch (error) { die(error.message); }
  }
  let skillAdaptation = null;
  if (fs.existsSync(pendingJob)) {
    const job = read(pendingJob);
    if (job.status !== 'ready') die('Stitch job is not ready; bind and observe the generated Screen before freezing');
    if (!selection.approvedScreens.some(screen => screen.screenId === job.screenId)) die('canvas selection does not include the ready Stitch job Screen');
    try { skillAdaptation = stitchAdaptationForFreeze(runDir, state, job, selection); } catch (error) { die(error.message); }
  }
  const snap = await snapshot(selection, runDir);
  if (readRunStateForUpdate(runDir).expectedStateHash !== stateSnapshot.expectedStateHash) die('run state changed during Stitch freeze; preserve and re-evaluate the confirmed Demo before retrying');
  try {
    assertInputsUnchanged(runDir, inputs);
    if (state.roleChain?.confirmationModel === 'two-confirmations' && selection.approvedScreens?.length > 1) autoBindStitchScreens(runDir, read(path.join(runDir, state.artifacts.runtimeVisualBaseline)), selection.approvedScreens);
    if (skillAdaptation) stitchAdaptationForFreeze(runDir, state, read(pendingJob), selection);
  } catch (error) { die(error.message); }
  const freeze = { schemaVersion: '3.0', projectId: selection.projectId, canvasUrl: selection.canvasUrl, approval: selection.approval, approvedScreens: snap.approvedScreens, excludedScreens: selection.excludedScreens, ...(selection.generationInput ? { generationInput: selection.generationInput } : {}), ...(skillAdaptation ? { skillAdaptation } : {}), fingerprints: { screenSetHash: hash({ listed: snap.listedHash, approved: snap.approvedScreens }), designSystemHash: snap.designSystemHash }, syncedAt: new Date().toISOString() };
  const freezeDir = path.join(runDir, 'evidence', 'stitch', 'freezes'); fs.mkdirSync(freezeDir, { recursive: true });
  const freezeFile = saveDownload(freezeDir, 'stitch-freeze', '.json', Buffer.from(`${JSON.stringify(freeze, null, 2)}\n`)).file;
  saveDownload(freezeDir, 'stitch-raw', '.json', Buffer.from(`${JSON.stringify({ schemaVersion: '3.0', projectId: selection.projectId, screens: snap.rawScreens, designSystems: snap.designSystems }, null, 2)}\n`));
  updateState(runDir, path.relative(runDir, freezeFile), false, false, stateSnapshot);
  console.log(JSON.stringify({ freeze: freezeFile, status: 'provisional', next: 'run strict-replica.mjs stitch, then seal' }));
} else if (command === 'seal') {
  const runDir = path.resolve(args[0] || '.');
  try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
  const stateFile = path.join(runDir, 'state.json');
  const stateSnapshot = readRunStateForUpdate(runDir), { state } = stateSnapshot;
  if (!state.locks.effectApproved) die('a confirmed runtime Demo is required before sealing Stitch');
  const sealInputs = captureInputs(runDir, [state.artifacts.stitchFreeze, state.artifacts.stitchParityEvidence, state.artifacts.visualReference, state.artifacts.runtimeVisualBaseline, state.artifacts.visualScreenReferences]);
  const automatic = state.roleChain?.confirmationModel === 'two-confirmations';
  if (!automatic && !state.locks.stitchApproved) die('Stitch approval is required before sealing Stitch');
  let machineSeal = null;
  if (automatic) {
    const validation = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-validate.mjs'), 'pre-stitch-machine-seal', runDir], { encoding: 'utf8' });
    if (validation.status !== 0) die((validation.stderr || validation.stdout).trim());
  }
  const evidenceFile = path.join(runDir, state.artifacts.stitchParityEvidence || 'stitch-parity-evidence.json');
  const evidence = read(evidenceFile);
  if (evidence.status !== 'passed' || !evidence.strictPixelMatch || !Array.isArray(evidence.unmatched) || evidence.unmatched.length) die('strict Stitch parity evidence must pass before sealing');
  if (evidence.structuralVerification?.source !== 'stitch-screen-export' || !evidence.structuralVerification.contractHash || !evidence.structuralVerification.contractPath) die('sealed Stitch requires an automatic structure contract');
  const contractFile = path.resolve(runDir, evidence.structuralVerification.contractPath);
  if (!fs.existsSync(contractFile) || hash(fs.readFileSync(contractFile)) !== evidence.structuralVerification.contractHash) die('strict Stitch structure contract is missing or changed');
  const contract = read(contractFile);
  if (contract.source !== 'stitch-screen-export' || contract.sourceImageHash !== evidence.stitchImageHash || contract.verification?.status !== 'passed') die('strict Stitch structure contract is not a passed export of the compared screen');
  try { assertInputsUnchanged(runDir, sealInputs); } catch (error) { die(error.message); }
  if (readRunStateForUpdate(runDir).expectedStateHash !== stateSnapshot.expectedStateHash) die('run state changed during Stitch seal; re-evaluate the current Demo and parity evidence');
  if (automatic) {
    const freeze = read(path.join(runDir, state.artifacts.stitchFreeze));
    const reference = read(path.join(runDir, state.artifacts.visualReference));
    const multi = freeze.approvedScreens.length > 1 ? validateMultiStitch(runDir, state, freeze, reference) : null;
    const screenProofs = (multi?.screens || []).map(screen => read(path.join(runDir, screen.evidence)));
    const sealedInputs = captureInputs(runDir, [...sealInputs.map(item => item.file), contractFile, reference.referenceImage?.path, ...freeze.approvedScreens.flatMap(screen => [screen.imagePath, screen.htmlPath]), ...(multi?.screens || []).flatMap(screen => [screen.evidence, screen.reference]), ...screenProofs.map(proof => proof.structuralVerification?.contractPath)]);
    if (sealedInputs.some(item => item.missing)) die('Stitch seal input is missing');
    const receipt = { schemaVersion: '3.0', type: 'stitch-machine-seal', status: 'validated', runId: state.runId, freeze: { path: state.artifacts.stitchFreeze, sha256: hash(fs.readFileSync(path.join(runDir, state.artifacts.stitchFreeze))) }, parity: { path: state.artifacts.stitchParityEvidence, sha256: hash(fs.readFileSync(evidenceFile)) }, inputs: sealedInputs.map(item => ({ path: path.relative(fs.realpathSync(runDir), item.file), sha256: item.sha256 })), ...(multi ? { screens: multi.screens } : {}), validatedAt: new Date().toISOString() };
    const receiptDir = path.join(runDir, 'machine-seals'); fs.mkdirSync(receiptDir, { recursive: true });
    machineSeal = path.relative(runDir, saveDownload(receiptDir, 'stitch', '.json', Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)).file);
    try { assertInputsUnchanged(runDir, sealedInputs); } catch (error) { die(error.message); }
  }
  updateState(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json', true, automatic, stateSnapshot, machineSeal);
  console.log(JSON.stringify({ sealed: true, stitchFreeze: state.artifacts.stitchFreeze || 'stitch-freeze.json', ...(automatic ? { machineSeal: path.join(runDir, machineSeal) } : {}) }));
} else if (command === 'check') {
  const runDir = path.resolve(args[0] || '.');
  try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
  const state = readRunState(runDir);
  const freeze = read(path.join(runDir, state.artifacts?.stitchFreeze || 'stitch-freeze.json'));
  const selection = { schemaVersion: '3.0', projectId: freeze.projectId, canvasUrl: freeze.canvasUrl, approval: freeze.approval, approvedScreens: freeze.approvedScreens.map(({ htmlHash, imageHash, htmlPath, imagePath, ...item }) => item), excludedScreens: freeze.excludedScreens };
  const snap = await snapshot(selection, runDir);
  const approved = snap.approvedScreens.map(screen => {
    const frozen = freeze.approvedScreens.find(item => item.screenId === screen.screenId);
    return frozen ? { ...screen, htmlPath: frozen.htmlPath, imagePath: frozen.imagePath } : screen;
  });
  const currentHash = hash({ listed: snap.listedHash, approved });
  const changed = currentHash !== freeze.fingerprints.screenSetHash || snap.designSystemHash !== freeze.fingerprints.designSystemHash;
  if (changed) {
    const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts/apex-router.mjs'), 'transition', process.env.APEX_ROUTER_PROJECT_ROOT, process.env.APEX_ROUTER_RUN_ID, process.env.APEX_ROUTER_SESSION_ID, process.env.APEX_ROUTER_AUTHORIZATION_REF, 'revoke-stitch', 'remote-canvas-changed'], { encoding: 'utf8' });
    if (result.status !== 0) die(result.stderr || result.stdout);
    console.log(JSON.stringify({ current: false, changed: true }));
    process.exitCode = 2;
  } else console.log(JSON.stringify({ current: true, changed: false }));
} else die('commands: list-projects | probe-screen | capabilities | bind-screen | await-screen | freeze | seal | check');
