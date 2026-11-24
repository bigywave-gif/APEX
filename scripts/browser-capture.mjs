#!/usr/bin/env node
import { canonicalApexRoot, playwrightBridge as pwcli, npmCacheRoot as npxCacheRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import { interactionSource, journeyCode } from './interactive-demo.mjs';
import { validateFormalJourneys, formalJourneyCode, formalAuthenticationCode } from './formal-interaction.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { newlyAvailableResources } from './existing-resource-freshness.mjs';
import { currentResourceReview } from './existing-resource-freshness.mjs';
import { resourceImageProbeCode, resourceVerificationBinding } from './existing-resource-runtime.mjs';
import { archiveArtifacts } from './run-ledger.mjs';

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
const controlInventoryLimit = spec.controlInventoryLimit ?? 500;
if (!Number.isInteger(controlInventoryLimit) || controlInventoryLimit < 1 || controlInventoryLimit > 5000) die('controlInventoryLimit must be an integer between 1 and 5000');
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
  const newResources = newlyAvailableResources(reference, process.env.APEX_ROUTER_PROJECT_ROOT);
  if (newResources.length) die(`project code changed after complete reference capture: previously unavailable resource ${newResources[0]}`);
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
let resourceChecks = [], resourceReviewBinding = null;
if (spec.resourceChecks !== undefined) {
  if (captureAction !== 'verify' || !Array.isArray(spec.resourceChecks) || !spec.resourceChecks.length || spec.resourceChecks.length > 1000) die('resourceChecks require a bounded nonempty formal verification list');
  const state = read(path.join(runDir, 'state.json'));
  let review; try { review = currentResourceReview(runDir, state); resourceReviewBinding = resourceVerificationBinding(runDir, state); } catch (error) { die(error.message); }
  if (review.status !== 'unverified') die('resourceChecks require current in-scope unresolved resources');
  const reference = read(path.join(runDir, state.artifacts.codeReference));
  const eligible = new Set((reference.unresolvedResources || []).filter(item => Array.isArray(item.contexts) && item.contexts.length === 1 && item.contexts[0] === 'img-src').map(item => JSON.stringify([item.source, item.reference])));
  const pending = new Set(review.pending.map(item => JSON.stringify([item.source, item.reference]))), covered = new Set(), screens = new Set(spec.screens.map(item => item.id));
  if (screens.size !== spec.screens.length) die('resourceChecks require unique screen IDs');
  resourceChecks = spec.resourceChecks.map(item => {
    const key = JSON.stringify([item?.source, item?.reference]);
    if (!pending.has(key) || !eligible.has(key) || !screens.has(item.screenId) || typeof item.selector !== 'string' || !item.selector.trim() || typeof item.reference !== 'string' || !item.reference.startsWith('/') || item.reference.startsWith('//')) die('resourceChecks require an in-scope img-src-only reference, a current screen, an image selector and a same-origin root path');
    covered.add(key); return { source: item.source, reference: item.reference, screenId: item.screenId, selector: item.selector };
  });
  if ([...pending].some(key => !covered.has(key))) die('resourceChecks must cover every in-scope unresolved resource');
}
const authentication = spec.authentication || null;
if (authentication && (!authentication.usernameEnv || !authentication.passwordEnv || !authentication.usernameSelector || !authentication.passwordSelector || !authentication.submitSelector || !authentication.successSelector)) die('authentication requires usernameEnv, passwordEnv, usernameSelector, passwordSelector, submitSelector, and successSelector');
const authCredentials = authentication ? { username: process.env[authentication.usernameEnv], password: process.env[authentication.passwordEnv] } : null;
if (authentication && (!authCredentials.username || !authCredentials.password)) die(`authentication credentials are unavailable from ${authentication.usernameEnv}/${authentication.passwordEnv}`);
let demoSource = null;
if (captureAction === 'generate_visual') {
  try { demoSource = interactionSource(runDir); } catch (error) { die(error.message); }
  if (authentication) die('interactive prototypes use sample data, not real authentication credentials');
}
const derivedFormalBindings = formalSourceBindings(runDir, captureAction);
const suppliedBindings = spec.requiredSourceBindings || [];
if (!Array.isArray(suppliedBindings) || suppliedBindings.some(binding => !binding?.visualNode || !binding?.selector || !binding?.sourceMarker || !Array.isArray(binding?.sourceSelectionIds) || !binding.sourceSelectionIds.length)) die('requiredSourceBindings must contain visualNode, selector, sourceMarker, and sourceSelectionIds');
const requiredSourceBindings = suppliedBindings.length ? suppliedBindings : derivedFormalBindings;
const requiredSourceSelectionIds = [...new Set([...(spec.requiredSourceSelectionIds || []), ...requiredSourceBindings.flatMap(binding => binding.sourceSelectionIds)])].sort();
if (!Array.isArray(requiredSourceSelectionIds) || requiredSourceSelectionIds.some(item => typeof item !== 'string' || !item)) die('requiredSourceSelectionIds must be an array of concrete visual-plan selection IDs');
const requiredSourceFiles = spec.requiredSourceFiles || [];
if (!Array.isArray(requiredSourceFiles) || requiredSourceFiles.some(item => !item?.selectionId || !item?.path || !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || ''))) die('requiredSourceFiles must contain concrete selectionId, path, and sha256 values');
const artifactDir = path.join(runDir, 'evidence', captureAction === 'generate_visual' ? 'demo' : evidenceKind, 'browser'); fs.mkdirSync(artifactDir, { recursive: true });
const captured = [];
const motionSamples = [];
for (const screen of spec.screens) {
  if (!screen.id || !screen.route || !Number.isInteger(screen.width) || !Number.isInteger(screen.height)) die('each screen requires id, route, width and height');
  const session = `apex-${crypto.createHash('sha1').update(`${runDir}:${screen.id}`).digest('hex').slice(0, 12)}`;
  const before = new Set(images(artifactDir)); const url = routeUrl(baseUrl, screen.route);
  const open = call(session, artifactDir, ['open', url], runDir);
  const priorCaptureCount = captured.length;
  try {
  const authenticate = open.ok && authentication ? call(session, artifactDir, ['run-code', formalAuthenticationCode({ authentication, credentials: authCredentials, url: baseUrl })], runDir, 2000000) : { ok: true, output: 'not-required' };
  const authenticated = !authentication || resultValueFrom(authenticate.output)?.authenticated === true;
  const resize = open.ok && authenticate.ok && authenticated ? call(session, artifactDir, ['resize', String(screen.width), String(screen.height)], runDir) : { ok: false, output: authentication && !authenticated ? 'authentication did not expose the required authenticated selector' : 'open or authentication failed' };
  const snapshot = resize.ok ? call(session, artifactDir, ['snapshot'], runDir) : { ok: false, output: 'resize failed' };
  const shot = snapshot.ok ? call(session, artifactDir, ['screenshot'], runDir) : { ok: false, output: 'snapshot failed' };
  const dom = snapshot.ok ? call(session, artifactDir, ['run-code', 'async (page) => JSON.stringify({ html: await page.content(), url: page.url(), viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })), layoutMetrics: await page.evaluate(() => ({ documentScrollWidth: document.documentElement.scrollWidth, documentClientWidth: document.documentElement.clientWidth })), sourceAttributes: await page.evaluate(() => Object.fromEntries(["data-apex-source-selection", "data-apex-source", "data-apex-source-file"].map(name => [name, Array.from(document.querySelectorAll("[" + name + "]"), node => node.getAttribute(name))]))) })'], runDir, 2000000) : { ok: false, output: 'snapshot failed' };
  const sourceBindingProbe = snapshot.ok && requiredSourceBindings.length
    ? call(session, artifactDir, ['run-code', `async (page) => JSON.stringify(await page.evaluate((bindings) => bindings.map(binding => ({ ...binding, rendered: Array.from(document.querySelectorAll(binding.selector)).some(node => node.getAttribute('data-apex-source') === binding.sourceMarker) })), ${JSON.stringify(requiredSourceBindings)}))`], runDir, 2000000)
    : { ok: true, output: 'not-required' };
  const screenResourceChecks = resourceChecks.filter(item => item.screenId === screen.id);
  const resourceProbe = snapshot.ok && screenResourceChecks.length ? call(session, artifactDir, ['run-code', resourceImageProbeCode(screenResourceChecks)], runDir, 2000000) : { ok: true, output: 'not-required' };
  const resourceObservations = screenResourceChecks.length ? resultValueFrom(resourceProbe.output) : [];
  const resourceMatches = Array.isArray(resourceObservations) && resourceObservations.length === screenResourceChecks.length && resourceObservations.every((item, index) => item.status === 'passed' && item.kind === 'visible-image' && ['source', 'reference', 'screenId', 'selector'].every(key => item[key] === screenResourceChecks[index][key]));
  const consoleLog = snapshot.ok ? call(session, artifactDir, ['console', 'error'], runDir) : { ok: false, output: 'snapshot failed' };
  const created = images(artifactDir).filter(file => !before.has(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const browserView = dom.ok ? resultValueFrom(dom.output) : null;
  const html = typeof browserView?.html === 'string' ? browserView.html : null;
  const actualViewport = browserView?.viewport;
  const viewportMatches = actualViewport?.width === screen.width && actualViewport?.height === screen.height;
  let actualUrl = null;
  try { if (new URL(browserView?.url).origin === new URL(url).origin) actualUrl = browserView.url; } catch {}

  const domFile = html ? path.join(artifactDir, screen.id + '.dom.html') : null;
  if (domFile) fs.writeFileSync(domFile, html);
  const sourceAttributes = browserView?.sourceAttributes || {};
  const declaredSourceSelections = [...new Set((sourceAttributes['data-apex-source-selection'] || []).flatMap(value => String(value || '').trim().split(/\s+/).filter(Boolean)))];
  const sourceMarkers = sourceAttributes['data-apex-source'] || [];
  const probedBindings = resultValueFrom(sourceBindingProbe.output);
  const formalBindingEvidence = Array.isArray(probedBindings)
    ? probedBindings
    : requiredSourceBindings.map(binding => ({ ...binding, rendered: false }));
  const sourceSelections = [...new Set([...declaredSourceSelections, ...formalBindingEvidence.filter(binding => binding.rendered).flatMap(binding => binding.sourceSelectionIds)])].sort();
  const sourceFiles = sourceAttributes['data-apex-source-file'] || [];
  // A package-backed motion library can be materially present as a local
  // script module rather than a component DOM attribute. Bind that actual
  // script tag to the selected runtime package and hash the served file.
  try {
    const state = read(path.join(runDir, 'state.json')); const plan = read(path.join(runDir, state.artifacts.visualExecutionPlan));
    for (const selection of plan.sourceSelections || []) {
      if (selection.materialization !== 'runtime-package') continue;
      const packagePrefix = `./node_modules/${selection.sourceId}/`;
      const scriptRefs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
      // Package imports are commonly reached through the app entry module
      // rather than a direct package script tag.  Treat a local app module's
      // explicit static import as file-level runtime evidence as well.
      const importedPackageFiles = scriptRefs.flatMap(ref => {
        if (!ref.startsWith('./')) return [];
        const entry = path.join(runDir, 'visual-sandbox', ref.replace(/^\.\//, ''));
        if (!fs.existsSync(entry)) return [];
        const text = fs.readFileSync(entry, 'utf8');
        return [...text.matchAll(new RegExp(`from\\s*["'](${packagePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']+)["']`, 'g'))].map(match => match[1]);
      });
      const scriptFound = scriptRefs.some(ref => ref.startsWith(packagePrefix)) || importedPackageFiles.length > 0;
      const packageRoot = path.join(runDir, 'visual-sandbox', 'node_modules', ...String(selection.sourceId).split('/'));
      const packageJson = path.join(packageRoot, 'package.json');
      if (scriptFound && fs.existsSync(packageJson)) {
        for (const ref of [...scriptRefs.filter(ref => ref.startsWith(packagePrefix)), ...importedPackageFiles]) {
          const file = path.join(runDir, 'visual-sandbox', ref.replace(/^\.\//, ''));
          if (fs.existsSync(file)) sourceFiles.push(`${selection.id}:sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
        }
      }
    }
  } catch {}
  // Existing component reuse is proved by its frozen source binding and the
  // run-local manifest, even when a shared visible root carries only the
  // composite selection marker.  Other selection kinds remain DOM-proven.
  const componentSelections = (() => { try { const state = read(path.join(runDir, 'state.json')); const plan = read(path.join(runDir, state.artifacts.visualExecutionPlan)); return new Set((plan.sourceSelections || []).filter(item => item.kind === 'component').map(item => item.id)); } catch { return new Set(); } })();
  const sourceSelectionMatches = requiredSourceSelectionIds.every(id => sourceSelections.includes(id) || componentSelections.has(id));
  const sourceBindingMatches = formalBindingEvidence.every(binding => binding.rendered);
  const sourceFileMatches = requiredSourceFiles.every(file => sourceFiles.includes(`${file.selectionId}:${file.sha256}`));
  const controlProbe = demoSource && snapshot.ok ? call(session, artifactDir, ['run-code', journeyCode({ inventoryOnly: true, controlInventoryLimit })], runDir, 2000000) : null;
  const controlInventory = controlProbe?.ok ? resultValueFrom(controlProbe.output) : null;
  const controlInventoryMatches = !demoSource || (controlInventory?.status === 'captured' && controlInventory.url === actualUrl && controlInventory.viewport === `${screen.width}x${screen.height}`);
  let elapsedMs = 0;
  for (const sample of screen.motionSamples || []) {
    if (!sample.id || !Number.isInteger(sample.timestampMs) || sample.timestampMs < elapsedMs) throw new Error(`motion sample for ${screen.id} requires an id and ascending timestampMs`);
    const wait = call(session, artifactDir, ['run-code', `async (page) => { await page.waitForTimeout(${sample.timestampMs - elapsedMs}); return 'waited'; }`], runDir);
    const beforeSample = new Set(images(artifactDir)); const sampleShot = wait.ok ? call(session, artifactDir, ['screenshot'], runDir) : { ok: false, output: 'motion wait failed' };
    const screenshot = images(artifactDir).filter(file => !beforeSample.has(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    motionSamples.push({ id: sample.id, screenId: screen.id, timestampMs: sample.timestampMs, screenshot: screenshot ? path.relative(runDir, screenshot) : null, frameSha256: screenshot ? fileHash(screenshot) : null, status: sampleShot.ok && Boolean(screenshot) ? 'captured' : 'failed', logs: { wait: wait.output, screenshot: sampleShot.output } }); elapsedMs = sample.timestampMs;
  }
  captured.push({ id: screen.id, route: screen.route, url: actualUrl, viewport: actualViewport ? String(actualViewport.width) + 'x' + String(actualViewport.height) : null, layoutMetrics: browserView?.layoutMetrics || null, ...(demoSource ? { controlInventory } : {}), screenshot: created ? path.relative(runDir, created) : null, screenshotSha256: created ? fileHash(created) : null, domHtml: domFile ? path.relative(runDir, domFile) : null, domSha256: domFile ? fileHash(domFile) : null, sourceSelections, sourceMarkers, sourceBindings: formalBindingEvidence, sourceFiles, ...(screenResourceChecks.length ? { resourceChecks: resourceObservations || [] } : {}), status: shot.ok && Boolean(created) && Boolean(domFile) && Boolean(actualUrl) && viewportMatches && authenticated && sourceSelectionMatches && sourceBindingMatches && sourceFileMatches && controlInventoryMatches && resourceProbe.ok && resourceMatches ? 'captured' : 'failed', approved: false, runner: open.runner, logs: { open: open.output, authentication: authentication ? (authenticated ? 'authenticated' : 'authentication failed') : 'not-required', resize: resize.output, snapshot: snapshot.output, screenshot: shot.output, dom: dom.ok ? 'captured' : dom.output, viewport: viewportMatches ? 'matched' : `expected ${screen.width}x${screen.height}, observed ${actualViewport?.width || '?'}x${actualViewport?.height || '?'}`, finalUrl: actualUrl || 'missing or outside requested origin', controlInventory: controlInventoryMatches ? 'matched' : 'missing or different URL/viewport', resourceChecks: resourceMatches ? 'matched-or-not-requested' : 'visible decoded image was not observed', sourceSelections: sourceSelectionMatches ? 'matched' : `missing: ${requiredSourceSelectionIds.filter(id => !sourceSelections.includes(id)).join(', ')}`, sourceBindings: sourceBindingMatches ? 'matched' : `missing selector-bound markers: ${formalBindingEvidence.filter(binding => !binding.rendered).map(binding => `${binding.selector}=${binding.sourceMarker}`).join(', ')}`, sourceBindingProbe: sourceBindingProbe.ok ? 'captured' : sourceBindingProbe.output, sourceFiles: sourceFileMatches ? 'matched' : `missing exact rendered source files`, console: consoleLog.output } });
  } finally {
    const close = call(session, artifactDir, ['close'], runDir);
    const entry = captured.length > priorCaptureCount ? captured[captured.length - 1] : null;
    if (entry) { entry.sessionClosed = close.ok; if (open.ok && !close.ok) entry.status = 'failed'; }
  }
}
let interactiveDemo = null;
if (demoSource) {
  const journeys = [], session = `apex-interactive-${crypto.createHash('sha1').update(runDir).digest('hex').slice(0, 12)}`;
  const opened = call(session, artifactDir, ['open', baseUrl], runDir);
  try {
    for (const journey of demoSource.contract.journeys) {
      const screenshot = path.join(artifactDir, `journey-${journey.id}.png`);
      const probe = opened.ok ? call(session, artifactDir, ['run-code', journeyCode({ journey, url: baseUrl, notice: demoSource.contract.notice, screenshotPath: screenshot, controlInventoryLimit })], runDir, 2000000) : opened;
      const observed = resultValueFrom(probe.output);
      if (!probe.ok || !observed || typeof observed.html !== 'string') { journeys.push({ id: journey.id, status: 'failed', error: probe.output }); continue; }
      const { html, ...record } = observed;
      const domFile = path.join(artifactDir, `journey-${journey.id}.dom.html`); fs.writeFileSync(domFile, html);
      journeys.push({ ...record, screenshot: fs.existsSync(screenshot) ? { path: path.relative(runDir, screenshot), sha256: fileHash(screenshot) } : null, dom: { path: path.relative(runDir, domFile), sha256: fileHash(domFile) } });
    }
  } finally { call(session, artifactDir, ['close'], runDir); }
  interactiveDemo = { kind: 'interactive-ui-prototype', url: baseUrl, contractHash: demoSource.contractHash, sourceManifestHash: demoSource.sourceManifestHash, journeys, status: journeys.length === demoSource.contract.journeys.length && journeys.every(item => item.status === 'passed' && item.screenshot && item.dom) ? 'passed' : 'failed' };
}
let formalInteractions = null;
if (captureAction === 'verify' && spec.formalJourneys !== undefined) {
  try { validateFormalJourneys(spec.formalJourneys); } catch (error) { die(error.message); }
  const journeys = [], session = `apex-formal-${crypto.createHash('sha1').update(runDir).digest('hex').slice(0, 12)}`;
  const opened = call(session, artifactDir, ['open', baseUrl], runDir);
  const login = opened.ok && authentication ? call(session, artifactDir, ['run-code', formalAuthenticationCode({ authentication, credentials: authCredentials, url: baseUrl })], runDir, 2000000) : null;
  const authenticated = !authentication || (login?.ok && resultValueFrom(login.output)?.authenticated === true);
  try {
    for (const journey of spec.formalJourneys) {
      const traceFile = path.join(artifactDir, `formal-${journey.id}.json`);
      const screenshot = path.join(artifactDir, `formal-${journey.id}.png`);
      const probe = opened.ok && authenticated ? call(session, artifactDir, ['run-code', formalJourneyCode({ journey, url: baseUrl, screenshotPath: screenshot })], runDir, 2000000) : { ok: false, output: authentication && !authenticated ? 'formal authentication failed' : 'formal browser open failed' };
      const observed = resultValueFrom(probe.output);
      if (!probe.ok || !observed || typeof observed.html !== 'string') { journeys.push({ id: journey.id, status: 'failed', error: probe.output }); continue; }
      const { html, ...record } = observed, domFile = path.join(artifactDir, `formal-${journey.id}.dom.html`);
      fs.writeFileSync(domFile, html);
      const entry = { ...record, screenshot: fs.existsSync(screenshot) ? { path: path.relative(runDir, screenshot), sha256: fileHash(screenshot) } : null, dom: { path: path.relative(runDir, domFile), sha256: fileHash(domFile) } };
      const nextTraceHash = sha(`${JSON.stringify(entry, null, 2)}\n`);
      if (fs.existsSync(traceFile) && fileHash(traceFile) !== nextTraceHash) archiveArtifacts(runDir, [path.relative(runDir, traceFile)], 'formal-interaction-recaptured');
      write(traceFile, entry);
      journeys.push({ ...entry, evidence: path.relative(runDir, traceFile), evidenceSha256: fileHash(traceFile) });
    }
  } finally { call(session, artifactDir, ['close'], runDir); }
  formalInteractions = { status: journeys.length === spec.formalJourneys.length && journeys.every(item => item.status === 'passed' && item.screenshot && item.dom) ? 'passed' : 'failed', journeys };
}
const result = { interactiveDemo, formalInteractions, status: (!interactiveDemo || interactiveDemo.status === 'passed') && (!formalInteractions || formalInteractions.status === 'passed') && captured.every(item => item.status === 'captured') && motionSamples.every(item => item.status === 'captured') ? 'passed' : 'failed', kind: evidenceKind, ...(existingSourceSnapshot ? { sourceSnapshot: existingSourceSnapshot } : {}), ...(resourceReviewBinding ? { resourceReviewBinding } : {}), sourceSelectionIds: requiredSourceSelectionIds, sourceBindings: requiredSourceBindings, evidence: captured, motionSamples, capturedAt: new Date().toISOString(), note: 'Captured screenshots and motion samples are evidence only. Visual approval must be recorded against the frozen Stitch/design baseline.' };
if (fs.existsSync(evidenceFile)) archiveArtifacts(runDir, [path.relative(runDir, evidenceFile)], 'browser-capture-superseded');
write(evidenceFile, result); console.log(JSON.stringify({ evidence: evidenceFile, kind: evidenceKind, status: result.status, captured: captured.filter(item => item.status === 'captured').length, total: captured.length, ...(formalInteractions ? { interactionEvidence: formalInteractions.journeys.filter(item => item.evidence).map(item => path.resolve(runDir, item.evidence)) } : {}) })); if (result.status !== 'passed') process.exitCode = 2;
