#!/usr/bin/env node
import { canonicalApexRoot, playwrightBridge as pwcli, npmCacheRoot as npxCacheRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Browser capture failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha(content) { return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`; }
function fileHash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function cachedCli() { try { return fs.readdirSync(npxCacheRoot).map(name => path.join(npxCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file)); } catch { return null; } }
function playwrightEnv(runDir) {
  const daemonDirectory = path.join(runDir, 'cache', 'playwright-daemon');
  fs.mkdirSync(daemonDirectory, { recursive: true });
  // @playwright/cli defaults to ~/Library/Caches/ms-playwright/daemon on macOS.
  // Run-local daemon state prevents permission failures and cross-project session reuse;
  // the installed browser binaries remain read-only shared tool dependencies.
  return { ...process.env, PWTEST_DAEMON_SESSION_DIR: daemonDirectory };
}
function call(session, cwd, args, runDir, outputLimit = 4000) {
  const cached = cachedCli();
  const command = cached ? process.execPath : pwcli;
  const commandArgs = cached ? [cached, '--session', session, ...args] : ['--session', session, ...args];
  const result = spawnSync(command, commandArgs, { cwd, env: playwrightEnv(runDir), encoding: 'utf8', timeout: 120000 });
  const output = (result.stdout || '') + (result.stderr || '');
  return { ok: result.status === 0, output: output.slice(-outputLimit), status: result.status, runner: cached ? 'cached-playwright-cli' : 'bridge-playwright-cli' };
}
function images(dir, output = []) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) images(file, output); else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) output.push(file); } return output; }
function routeUrl(baseUrl, route) { return new URL(route, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString(); }
function domFrom(output) {
  const match = output.match(/### Result\s*\n([\s\S]*?)\n### /);
  if (!match) return null;
  try {
    let value = JSON.parse(match[1].trim());
    if (typeof value === 'string') value = JSON.parse(value);
    return typeof value?.html === 'string' ? value.html : null;
  } catch { return null; }
}
function resultValueFrom(output) {
  const match = output.match(/### Result\s*\n([\s\S]*?)\n### /);
  if (!match) return null;
  try {
    let value = JSON.parse(match[1].trim());
    if (typeof value === 'string') value = JSON.parse(value);
    return value;
  } catch { return null; }
}

function formalSourceBindings(runDir, captureAction) {
  // A formal-page capture cannot rely on a hand-authored browser spec to carry
  // provenance.  The frozen Visual Source Manifest is the authority for the
  // relationship between a DOM marker and the visual-plan selections it proves.
  if (captureAction !== 'verify') return [];
  try {
    const state = read(path.join(runDir, 'state.json'));
    const manifestPath = state.artifacts?.visualSourceManifest && path.join(runDir, state.artifacts.visualSourceManifest);
    const planPath = state.artifacts?.visualExecutionPlan && path.join(runDir, state.artifacts.visualExecutionPlan);
    if (!manifestPath || !planPath) return [];
    const manifest = read(manifestPath), plan = read(planPath);
    const selections = Array.isArray(plan.sourceSelections) ? plan.sourceSelections : [];
    const seen = new Set();
    return (manifest.bindings || []).map(binding => {
      const sourceSelectionIds = selections.filter(selection => (selection.visualNodes || []).includes(binding.visualNode)).map(selection => selection.id).filter(Boolean);
      if (!binding?.visualNode || !binding?.selector || !binding?.sourceMarker || !sourceSelectionIds.length) die(`formal runtime source binding is incomplete: ${binding?.visualNode || '<unknown>'}`);
      if (seen.has(binding.sourceMarker)) die(`formal runtime source marker is duplicated: ${binding.sourceMarker}`);
      seen.add(binding.sourceMarker);
      return { visualNode: binding.visualNode, selector: binding.selector, sourceMarker: binding.sourceMarker, sourceSelectionIds: [...new Set(sourceSelectionIds)].sort() };
    });
  } catch (error) {
    die(`cannot derive formal runtime source bindings: ${error.message}`);
  }
}

const [command, runArg, baseUrl, specArg] = process.argv.slice(2);
canonical();
if (command !== 'capture' || !runArg || !baseUrl || !specArg) die('usage: capture <run-dir> <base-url> <browser-spec.json>');
try { new URL(baseUrl); } catch { die(`invalid base URL: ${baseUrl}`); }
if (!fs.existsSync(pwcli) && !cachedCli()) die(`Playwright bridge is unavailable: ${pwcli}; install the Playwright Skill or provide a valid npm cache`);
const runDir = path.resolve(runArg); const spec = read(path.resolve(specArg));
try { requireRouterAction(runDir, ['verify', 'collect_existing_baseline', 'generate_visual']); } catch (error) { die(error.message); }
// A captured Existing baseline must remain immutable while later Demo and
// verification captures are produced.  Keeping all captures in one generic
// file silently overwrote the evidence that Gate 1 was bound to.
const captureAction = process.env.APEX_ROUTER_ACTION;
const evidenceKind = captureAction === 'collect_existing_baseline' ? 'existing' : 'runtime';
const evidenceFile = path.join(runDir, 'evidence', `${evidenceKind}-browser-capture.json`);
// Existing browser evidence must identify the exact frozen source snapshot it
// was captured for.  Without this binding a changed code reference could be
// paired with an earlier screenshot/DOM capture and appear internally valid.
const existingSourceSnapshot = (() => {
  if (evidenceKind !== 'existing') return null;
  const referencePath = path.join(runDir, 'code-reference.json');
  const skeletonPath = path.join(runDir, 'page-skeleton.json');
  if (!fs.existsSync(referencePath) || !fs.existsSync(skeletonPath)) die('Existing browser capture requires the current code reference and page skeleton');
  const reference = read(referencePath), skeleton = read(skeletonPath);
  if (reference.complete !== true || !reference.sourceTreeHash || skeleton.sourceTreeHash !== reference.sourceTreeHash || !skeleton.skeletonHash) die('Existing browser capture requires a mutually bound code reference and page skeleton');
  return {
    codeReference: 'code-reference.json',
    codeReferenceSha256: sha(fs.readFileSync(referencePath)),
    sourceTreeHash: reference.sourceTreeHash,
    pageSkeleton: 'page-skeleton.json',
    pageSkeletonSha256: sha(fs.readFileSync(skeletonPath)),
    pageSkeletonHash: skeleton.skeletonHash
  };
})();
if (!Array.isArray(spec.screens) || !spec.screens.length) die('browser spec requires non-empty screens');
const authentication = spec.authentication || null;
if (authentication && (!authentication.usernameEnv || !authentication.passwordEnv || !authentication.usernameSelector || !authentication.passwordSelector || !authentication.submitSelector || !authentication.successSelector)) die('authentication requires usernameEnv, passwordEnv, usernameSelector, passwordSelector, submitSelector, and successSelector');
const authCredentials = authentication ? { username: process.env[authentication.usernameEnv], password: process.env[authentication.passwordEnv] } : null;
if (authentication && (!authCredentials.username || !authCredentials.password)) die(`authentication credentials are unavailable from ${authentication.usernameEnv}/${authentication.passwordEnv}`);
const derivedFormalBindings = formalSourceBindings(runDir, captureAction);
const suppliedBindings = spec.requiredSourceBindings || [];
if (!Array.isArray(suppliedBindings) || suppliedBindings.some(binding => !binding?.visualNode || !binding?.selector || !binding?.sourceMarker || !Array.isArray(binding?.sourceSelectionIds) || !binding.sourceSelectionIds.length)) die('requiredSourceBindings must contain visualNode, selector, sourceMarker, and sourceSelectionIds');
const requiredSourceBindings = suppliedBindings.length ? suppliedBindings : derivedFormalBindings;
const requiredSourceSelectionIds = [...new Set([...(spec.requiredSourceSelectionIds || []), ...requiredSourceBindings.flatMap(binding => binding.sourceSelectionIds)])].sort();
if (!Array.isArray(requiredSourceSelectionIds) || requiredSourceSelectionIds.some(item => typeof item !== 'string' || !item)) die('requiredSourceSelectionIds must be an array of concrete visual-plan selection IDs');
const requiredSourceFiles = spec.requiredSourceFiles || [];
if (!Array.isArray(requiredSourceFiles) || requiredSourceFiles.some(item => !item?.selectionId || !item?.path || !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || ''))) die('requiredSourceFiles must contain concrete selectionId, path, and sha256 values');
const artifactDir = path.join(runDir, 'evidence', evidenceKind, 'browser'); fs.mkdirSync(artifactDir, { recursive: true });
const captured = [];
const motionSamples = [];
for (const screen of spec.screens) {
  if (!screen.id || !screen.route || !Number.isInteger(screen.width) || !Number.isInteger(screen.height)) die('each screen requires id, route, width and height');
  const session = `apex-${crypto.createHash('sha1').update(`${runDir}:${screen.id}`).digest('hex').slice(0, 12)}`;
  const before = new Set(images(artifactDir)); const url = routeUrl(baseUrl, screen.route);
  const open = call(session, artifactDir, ['open', url], runDir);
  const authenticate = open.ok && authentication ? call(session, artifactDir, ['run-code', `async (page) => { await page.locator(${JSON.stringify(authentication.usernameSelector)}).fill(${JSON.stringify(authCredentials.username)}); await page.locator(${JSON.stringify(authentication.passwordSelector)}).fill(${JSON.stringify(authCredentials.password)}); await page.locator(${JSON.stringify(authentication.submitSelector)}).click(); await page.waitForTimeout(350); return JSON.stringify({ authenticated: await page.locator(${JSON.stringify(authentication.successSelector)}).count() > 0 }); }`], runDir, 2000000) : { ok: true, output: 'not-required' };
  const authenticated = !authentication || resultValueFrom(authenticate.output)?.authenticated === true;
  const resize = open.ok && authenticate.ok && authenticated ? call(session, artifactDir, ['resize', String(screen.width), String(screen.height)], runDir) : { ok: false, output: authentication && !authenticated ? 'authentication did not expose the required authenticated selector' : 'open or authentication failed' };
  const snapshot = resize.ok ? call(session, artifactDir, ['snapshot'], runDir) : { ok: false, output: 'resize failed' };
  const shot = snapshot.ok ? call(session, artifactDir, ['screenshot'], runDir) : { ok: false, output: 'snapshot failed' };
  const dom = snapshot.ok ? call(session, artifactDir, ['run-code', 'async (page) => JSON.stringify({ html: await page.content() })'], runDir, 2000000) : { ok: false, output: 'snapshot failed' };
  const sourceBindingProbe = snapshot.ok && requiredSourceBindings.length
    ? call(session, artifactDir, ['run-code', `async (page) => JSON.stringify(await page.evaluate((bindings) => bindings.map(binding => ({ ...binding, rendered: Array.from(document.querySelectorAll(binding.selector)).some(node => node.getAttribute('data-apex-source') === binding.sourceMarker) })), ${JSON.stringify(requiredSourceBindings)}))`], runDir, 2000000)
    : { ok: true, output: 'not-required' };
  const consoleLog = snapshot.ok ? call(session, artifactDir, ['console', 'error'], runDir) : { ok: false, output: 'snapshot failed' };
  const created = images(artifactDir).filter(file => !before.has(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const html = dom.ok ? domFrom(dom.output) : null;
  const domFile = html ? path.join(artifactDir, screen.id + '.dom.html') : null;
  if (domFile) fs.writeFileSync(domFile, html);
  const declaredSourceSelections = html ? [...html.matchAll(/data-apex-source-selection=["']([^"']+)["']/g)].map(match => match[1]) : [];
  const sourceMarkers = html ? [...html.matchAll(/data-apex-source=["']([^"']+)["']/g)].map(match => match[1]) : [];
  const probedBindings = resultValueFrom(sourceBindingProbe.output);
  const formalBindingEvidence = Array.isArray(probedBindings)
    ? probedBindings
    : requiredSourceBindings.map(binding => ({ ...binding, rendered: false }));
  const sourceSelections = [...new Set([...declaredSourceSelections, ...formalBindingEvidence.filter(binding => binding.rendered).flatMap(binding => binding.sourceSelectionIds)])].sort();
  const sourceFiles = html ? [...html.matchAll(/data-apex-source-file=["']([^"']+)["']/g)].map(match => match[1]) : [];
  const sourceSelectionMatches = requiredSourceSelectionIds.every(id => sourceSelections.includes(id));
  const sourceBindingMatches = formalBindingEvidence.every(binding => binding.rendered);
  const sourceFileMatches = requiredSourceFiles.every(file => sourceFiles.includes(`${file.selectionId}:${file.sha256}`));
  let elapsedMs = 0;
  for (const sample of screen.motionSamples || []) {
    if (!sample.id || !Number.isInteger(sample.timestampMs) || sample.timestampMs < elapsedMs) die(`motion sample for ${screen.id} requires an id and ascending timestampMs`);
    const wait = call(session, artifactDir, ['run-code', `async (page) => { await page.waitForTimeout(${sample.timestampMs - elapsedMs}); return 'waited'; }`], runDir);
    const beforeSample = new Set(images(artifactDir)); const sampleShot = wait.ok ? call(session, artifactDir, ['screenshot'], runDir) : { ok: false, output: 'motion wait failed' };
    const screenshot = images(artifactDir).filter(file => !beforeSample.has(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    motionSamples.push({ id: sample.id, screenId: screen.id, timestampMs: sample.timestampMs, screenshot: screenshot ? path.relative(runDir, screenshot) : null, frameSha256: screenshot ? fileHash(screenshot) : null, status: sampleShot.ok && Boolean(screenshot) ? 'captured' : 'failed', logs: { wait: wait.output, screenshot: sampleShot.output } }); elapsedMs = sample.timestampMs;
  }
  captured.push({ id: screen.id, route: screen.route, url, viewport: String(screen.width) + 'x' + String(screen.height), screenshot: created ? path.relative(runDir, created) : null, domHtml: domFile ? path.relative(runDir, domFile) : null, sourceSelections, sourceMarkers, sourceBindings: formalBindingEvidence, sourceFiles, status: shot.ok && Boolean(created) && Boolean(domFile) && authenticated && sourceSelectionMatches && sourceBindingMatches && sourceFileMatches ? 'captured' : 'failed', approved: false, runner: open.runner, logs: { open: open.output, authentication: authentication ? (authenticated ? 'authenticated' : authenticate.output) : 'not-required', resize: resize.output, snapshot: snapshot.output, screenshot: shot.output, dom: dom.ok ? 'captured' : dom.output, sourceSelections: sourceSelectionMatches ? 'matched' : `missing: ${requiredSourceSelectionIds.filter(id => !sourceSelections.includes(id)).join(', ')}`, sourceBindings: sourceBindingMatches ? 'matched' : `missing selector-bound markers: ${formalBindingEvidence.filter(binding => !binding.rendered).map(binding => `${binding.selector}=${binding.sourceMarker}`).join(', ')}`, sourceBindingProbe: sourceBindingProbe.ok ? 'captured' : sourceBindingProbe.output, sourceFiles: sourceFileMatches ? 'matched' : `missing exact rendered source files`, console: consoleLog.output } });
}
const result = { status: captured.every(item => item.status === 'captured') && motionSamples.every(item => item.status === 'captured') ? 'passed' : 'failed', kind: evidenceKind, ...(existingSourceSnapshot ? { sourceSnapshot: existingSourceSnapshot } : {}), sourceSelectionIds: requiredSourceSelectionIds, sourceBindings: requiredSourceBindings, evidence: captured, motionSamples, capturedAt: new Date().toISOString(), note: 'Captured screenshots and motion samples are evidence only. Visual approval must be recorded against the frozen Stitch/design baseline.' };
write(evidenceFile, result); console.log(JSON.stringify({ evidence: evidenceFile, kind: evidenceKind, status: result.status, captured: captured.filter(item => item.status === 'captured').length, total: captured.length })); if (result.status !== 'passed') process.exitCode = 2;
