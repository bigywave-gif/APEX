/** Shared contract and browser executor for an interactive UI prototype. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertDemoDesignHandoff } from './demo-design-handoff.mjs';

export const demoHash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const objectHash = value => demoHash(JSON.stringify(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const assert = (value, message) => { if (!value) throw new Error(`Interactive Demo: ${message}`); };

export function observedControlCoverageStatus(coverage, { requireScreens = false } = {}) {
  if (!['observed-journey-states-only', 'observed-screens-and-journeys'].includes(coverage?.scope) || (requireScreens && coverage.scope !== 'observed-screens-and-journeys') || !Array.isArray(coverage.observedControls) || !Array.isArray(coverage.exercisedControls) || !Array.isArray(coverage.untestedControls) || typeof coverage.truncated !== 'boolean') return { ready: false, reason: 'browser control inventory is missing', controls: [] };
  if (coverage.truncated) return { ready: false, reason: 'browser control inventory was truncated', controls: [] };
  if (coverage.identityConflicts?.length) return { ready: false, reason: 'browser control identity is ambiguous', controls: coverage.identityConflicts };
  const exemptions = coverage.sharedControlReviews || [];
  if (!Array.isArray(exemptions)) return { ready: false, reason: 'shared control review is invalid', controls: [] };
  const observed = new Map(coverage.observedControls.map(item => [item?.key, item]));
  const untested = new Set(coverage.untestedControls.map(item => item?.key)), exercised = new Set(coverage.exercisedControls || []), reviewed = new Set();
  if (observed.size !== coverage.observedControls.length || [...observed.keys()].some(key => !nonempty(key)) || [...exercised].some(key => !nonempty(key)) || untested.size !== coverage.untestedControls.length || [...untested].some(key => !nonempty(key)) || [...observed.keys()].some(key => untested.has(key) !== !exercised.has(key)) || [...untested].some(key => !observed.has(key))) return { ready: false, reason: 'browser control inventory is inconsistent', controls: [] };
  for (const item of exemptions) {
    const source = observed.get(item?.key), target = observed.get(item?.equivalentTo);
    const sameIdentity = typeof item?.key === 'string' && typeof item?.equivalentTo === 'string' && item.key.includes('|') && item.equivalentTo.includes('|') && item.key.split('|').slice(1).join('|') === item.equivalentTo.split('|').slice(1).join('|');
    if (!sameIdentity || !source || !target || !untested.has(item.key) || !exercised.has(item.equivalentTo) || reviewed.has(item.key) || source.tag !== target.tag || source.role !== target.role || source.type !== target.type || typeof item.rationale !== 'string' || item.rationale.trim().length < 8) return { ready: false, reason: 'shared control review is invalid or not tied to a tested equivalent', controls: [] };
    reviewed.add(item.key);
  }
  const controls = coverage.untestedControls.map(item => item?.key).filter(key => !reviewed.has(key));
  if (controls.some(key => !nonempty(key))) return { ready: false, reason: 'browser control inventory contains invalid identities', controls: [] };
  return controls.length ? { ready: false, reason: 'observed controls have no executed journey', controls } : { ready: true, reason: null, controls: [] };
}

export function validateInteractionContract(contract, tasks = []) {
  assert(contract?.schemaVersion === '1.0' && contract.kind === 'interactive-ui-prototype', 'interactionContract must describe an interactive-ui-prototype');
  assert(contract.dataMode === 'mock', 'the frontend Demo must use isolated mock data');
  assert(nonempty(contract.notice?.selector) && nonempty(contract.notice?.text), 'a visible sample-data notice is required');
  assert(Array.isArray(contract.journeys) && contract.journeys.length > 0, 'executable user journeys are required');
  if (contract.sharedControlReviews !== undefined) {
    assert(Array.isArray(contract.sharedControlReviews), 'shared control reviews must be an array');
    const keys = new Set();
    for (const item of contract.sharedControlReviews) {
      assert(nonempty(item?.key) && nonempty(item?.equivalentTo) && typeof item.rationale === 'string' && item.rationale.trim().length >= 8 && !keys.has(item.key), 'shared control review needs unique keys, a tested equivalent and a concrete rationale');
      keys.add(item.key);
    }
  }
  const ids = new Set();
  for (const journey of contract.journeys) {
    assert(/^[a-zA-Z0-9_-]+$/.test(journey?.id || '') && !ids.has(journey.id), 'journey IDs must be unique safe names');
    ids.add(journey.id);
    assert(['navigation', 'task', 'role', 'state', 'reset'].includes(journey.kind) && nonempty(journey.task), `journey ${journey.id} needs a kind and user task`);
    assert(typeof journey.route === 'string' && journey.route.startsWith('/') && !journey.route.startsWith('//') && !journey.route.includes('\\'), 'journey routes must stay inside the Demo origin');
    assert(Array.isArray(journey.steps) && journey.steps.length > 0, `journey ${journey.id} has no user actions`);
    for (const step of journey.steps) {
      assert(['click', 'fill', 'selectOption', 'check', 'uncheck', 'press'].includes(step.action) && nonempty(step.selector), 'each step needs a supported action and selector');
      if (['fill', 'selectOption', 'press'].includes(step.action)) assert(typeof step.value === 'string', `${step.action} needs a value`);
      for (const probe of [step.before, step.after]) {
        assert(nonempty(probe?.selector) && ['text', 'value', 'visible', 'checked', 'attribute'].includes(probe?.property), 'each step needs before/after observations');
        assert(['string', 'boolean'].includes(typeof probe.equals), 'observations need an exact expected value');
        if (probe.property === 'attribute') assert(nonempty(probe.attribute), 'attribute observations need an attribute name');
      }
      assert(step.before.selector === step.after.selector && step.before.property === step.after.property && step.before.attribute === step.after.attribute && step.before.equals !== step.after.equals, 'each action must change an observable UI value, not just dispatch a click');
    }
  }
  assert(contract.journeys.some(item => item.kind === 'task'), 'at least one primary task must be operable');
  assert(contract.journeys.some(item => item.kind === 'reset'), 'the Demo must include a tested reset action');
  for (const task of tasks) assert(contract.journeys.some(item => item.task === task), `missing confirmed functional task: ${task}`);
  return contract;
}

function localFile(runDir, relative) {
  assert(nonempty(relative) && !path.isAbsolute(relative), 'evidence must be run-local');
  const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(runDir, relative));
  assert(file.startsWith(`${root}${path.sep}`), 'evidence must stay inside the current Run');
  return file;
}

export function interactionSource(runDir) {
  const manifestFile = path.join(runDir, 'visual-sandbox-files.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const stateFile = path.join(runDir, 'state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  assertDemoDesignHandoff(runDir, state, manifest.designHandoff);
  const contract = validateInteractionContract(manifest.interactionContract);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'materialized source files are required');
  for (const item of manifest.files) {
    assert(item.path?.startsWith('visual-sandbox/'), 'source must belong to visual-sandbox');
    assert(demoHash(fs.readFileSync(localFile(runDir, item.path))) === item.sha256, `source changed after materialization: ${item.path}`);
  }
  return { contract, contractHash: objectHash(contract), sourceManifestHash: demoHash(fs.readFileSync(manifestFile)), requireResourceObservation: state.roleChain?.confirmationModel === 'two-confirmations' };
}

export function verifyDemoInteractions(runDir, capture, url, { requireJourneyLocation = false, allowSupplemental = false } = {}) {
  const source = interactionSource(runDir), evidence = capture?.interactiveDemo;
  assert(capture?.status === 'passed' && evidence?.status === 'passed', 'passed real-browser interaction evidence is required');
  assert(evidence.contractHash === source.contractHash && evidence.sourceManifestHash === source.sourceManifestHash, 'interaction evidence is stale for the current source/contract');
  assert(evidence.url === url && Array.isArray(evidence.journeys) && evidence.journeys.length === source.contract.journeys.length, 'interaction evidence must cover this Demo URL and every journey');
  for (const expected of source.contract.journeys) {
    const matches = evidence.journeys.filter(item => item.id === expected.id);
    assert(matches.length === 1, `missing or duplicate journey: ${expected.id}`);
    const actual = matches[0];
    assert(actual.status === 'passed' && actual.url === new URL(expected.route, url).href && actual.noticeVisible === true && actual.blockedRequests?.length === 0, `journey failed or attempted non-Demo requests: ${expected.id}`);
    if (source.requireResourceObservation || actual.failedResources !== undefined) assert(Array.isArray(actual.failedResources) && actual.failedResources.length === 0, `journey has missing or failed browser resource observations: ${expected.id}`);
    if (requireJourneyLocation || actual.finalUrl !== undefined || actual.viewport !== undefined) {
      let finalOrigin = null;
      try { finalOrigin = new URL(actual.finalUrl).origin; } catch {}
      const dimensions = /^(\d+)x(\d+)$/.exec(actual.viewport || '');
      assert(finalOrigin === new URL(url).origin && dimensions && Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0, `journey final URL or viewport is invalid: ${expected.id}`);
    }
    assert(actual.steps?.length === expected.steps.length, `incomplete journey: ${expected.id}`);
    expected.steps.forEach((step, index) => {
      const observed = actual.steps[index];
      assert(observed?.passed === true && observed.action === step.action && observed.selector === step.selector && observed.before === step.before.equals && observed.after === step.after.equals, `unverified UI transition: ${expected.id}/${index}`);
    });
    for (const ref of [actual.screenshot, actual.dom]) assert(ref && demoHash(fs.readFileSync(localFile(runDir, ref.path))) === ref.sha256, `missing or changed browser artifact: ${expected.id}`);
  }
  const supplemental = allowSupplemental ? (evidence.supplementalJourneys || []) : [];
  assert(Array.isArray(supplemental) && supplemental.length <= 200, 'invalid supplemental journeys');
  const screenRoutes = new Set((capture.evidence || []).map(screen => screen.route));
  for (const actual of supplemental) {
    const original = source.contract.journeys.find(item => item.id === actual.originalJourneyId), step = original?.steps?.[actual.originalStepIndex];
    const route = actual.url && new URL(actual.url).pathname + new URL(actual.url).search + new URL(actual.url).hash;
    assert(step && screenRoutes.has(route) && actual.url === new URL(route, url).href && actual.status === 'passed' && actual.noticeVisible === true && Array.isArray(actual.blockedRequests) && !actual.blockedRequests.length && Array.isArray(actual.failedResources) && !actual.failedResources.length && new URL(actual.finalUrl).origin === new URL(url).origin, 'invalid supplemental journey location or resources');
    assert(actual.prefixes === undefined || (Array.isArray(actual.prefixes) && actual.prefixes.length <= 2), 'invalid supplemental prefix count');
    const prefixes = (actual.prefixes || []).map(ref => source.contract.journeys.find(item => item.id === ref.journeyId)?.steps?.[ref.stepIndex]);
    assert(prefixes.every(Boolean), 'supplemental prefix is not an approved transition');
    const expectedSteps = [...prefixes, step];
    assert(Array.isArray(actual.steps) && actual.steps.length === expectedSteps.length && expectedSteps.every((expected, index) => { const observed = actual.steps[index]; return observed?.passed === true && observed.action === expected.action && observed.selector === expected.selector && observed.before === expected.before.equals && observed.after === expected.after.equals; }), 'supplemental journey differs from approved transition');
    for (const ref of [actual.screenshot, actual.dom]) assert(ref && demoHash(fs.readFileSync(localFile(runDir, ref.path))) === ref.sha256, 'supplemental browser artifact changed');
    assert(actual.controlInventoryVersion === '1.2' && Array.isArray(actual.observedControls) && Array.isArray(actual.exercisedControls) && Array.isArray(actual.controlIdentityConflicts) && typeof actual.controlInventoryTruncated === 'boolean', 'supplemental inventory missing');
  }
  const testedActions = source.contract.journeys.flatMap(journey => journey.steps.map(step => ({ journeyId: journey.id, selector: step.selector, action: step.action })));
  const inventoryAvailable = evidence.journeys.every(journey => journey.controlInventoryVersion === '1.2' && Array.isArray(journey.observedControls) && Array.isArray(journey.exercisedControls) && Array.isArray(journey.controlIdentityConflicts) && typeof journey.controlInventoryTruncated === 'boolean');
  const observed = new Map(), exercised = new Set(), identityConflicts = new Set();
  const addObserved = control => { assert(nonempty(control?.key), 'invalid observed control identity'); const old = observed.get(control.key); if (old && ['tag', 'role', 'type'].some(field => (old[field] ?? null) !== (control[field] ?? null))) identityConflicts.add(control.key); observed.set(control.key, control); };
  if (inventoryAvailable) for (const journey of [...evidence.journeys, ...supplemental]) {
    for (const control of journey.observedControls) addObserved(control);
    for (const key of journey.controlIdentityConflicts) { assert(nonempty(key), 'invalid control identity conflict'); identityConflicts.add(key); }
    for (const key of journey.exercisedControls) { assert(nonempty(key), 'invalid exercised control identity'); exercised.add(key); }
  }
  const screens = Array.isArray(capture.evidence) ? capture.evidence : [];
  if (source.requireResourceObservation) for (const screen of screens) assert(screen.resourceObservation?.status === 'passed' && screen.resourceObservation.url === screen.url && Array.isArray(screen.resourceObservation.failedResources) && screen.resourceObservation.failedResources.length === 0 && Array.isArray(screen.resourceObservation.blockedRequests) && screen.resourceObservation.blockedRequests.length === 0, `screen has missing or failed browser resource observations: ${screen.id || '<unknown>'}`);
  const screenInventoryAvailable = screens.length > 0 && screens.every(screen => screen.controlInventory?.version === '1.2' && screen.controlInventory.status === 'captured' && Array.isArray(screen.controlInventory.observedControls) && Array.isArray(screen.controlInventory.identityConflicts) && typeof screen.controlInventory.truncated === 'boolean' && screen.controlInventory.url === screen.url && screen.controlInventory.viewport === screen.viewport);
  if (inventoryAvailable && screenInventoryAvailable) for (const screen of screens) { for (const control of screen.controlInventory.observedControls) addObserved(control); for (const key of screen.controlInventory.identityConflicts) { assert(nonempty(key), 'invalid control identity conflict'); identityConflicts.add(key); } }
  return { kind: 'interactive-ui-prototype', dataMode: 'mock', contractHash: source.contractHash, journeyCount: evidence.journeys.length, controlCoverage: inventoryAvailable ? { scope: screenInventoryAvailable ? 'observed-screens-and-journeys' : 'observed-journey-states-only', testedActions, observedControls: [...observed.values()], exercisedControls: [...exercised], untestedControls: [...observed.values()].filter(control => !exercised.has(control.key)), identityConflicts: [...identityConflicts], sharedControlReviews: source.contract.sharedControlReviews || [], truncated: [...evidence.journeys, ...supplemental].some(journey => journey.controlInventoryTruncated) || (screenInventoryAvailable && screens.some(screen => screen.controlInventory.truncated)), note: 'Inventory recognizes native buttons, links and form fields and selected ARIA roles; shared-control equivalence requires professional judgment. Other custom controls, hidden or unvisited states and semantic correctness are not proven.' } : { scope: 'declared-journeys-only', testedActions, otherVisibleControls: 'not-inventoried' } };
}

// This function is serialized into Playwright CLI run-code. It has no closure
// dependencies; UI actions and assertions execute in the real browser.
export async function runDemoJourney(page, input) {
  const { journey, url, notice, screenshotPath } = input;
  const blockedRequests = [], failedResources = [], steps = [], controls = new Map(), exercisedControls = new Set(), identityConflicts = new Set();
  let controlInventoryTruncated = false;
  const controlInventoryLimit = input.controlInventoryLimit ?? 500;
  if (!Number.isInteger(controlInventoryLimit) || controlInventoryLimit < 1 || controlInventoryLimit > 5000) throw new Error('control inventory limit must be an integer between 1 and 5000');
  const controlSelector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="textbox"], [role="option"]';
  const describeControls = elements => {
    const found = new Map();
    for (const original of elements) {
      const element = original.closest('button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="textbox"], [role="option"]') || original;
      if (!(element instanceof HTMLElement) || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden' || element.matches(':disabled') || element.closest('[aria-disabled="true"], [aria-hidden="true"], [inert]') || element.matches('input[readonly],textarea[readonly]')) continue;
      if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let key;
      if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) key = `id:${encodeURIComponent(element.id)}`;
      else {
        const parts = []; let node = element;
        while (node && node.nodeType === 1) { const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.tagName === node.tagName) : [node]; parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); node = node.parentElement; }
        key = `path:${parts.join('>')}`;
      }
      key = `route:${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}|${key}`;
      found.set(key, { key, tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || null, type: element.getAttribute('type') || null });
    }
    return [...found.values()];
  };
  const collectControls = async () => {
    const items = await page.locator(controlSelector).evaluateAll(describeControls);
    if (items.length > controlInventoryLimit) controlInventoryTruncated = true;
    for (const item of items.slice(0, controlInventoryLimit)) { if (controls.size >= controlInventoryLimit && !controls.has(item.key)) { controlInventoryTruncated = true; continue; } const old = controls.get(item.key); if (old && ['tag', 'role', 'type'].some(field => old[field] !== item[field])) identityConflicts.add(item.key); controls.set(item.key, item); }
  };
  if (input.inventoryOnly) {
    try { await collectControls(); const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })); return { version: '1.2', status: 'captured', url: page.url(), viewport: `${viewport.width}x${viewport.height}`, observedControls: [...controls.values()], identityConflicts: [...identityConflicts], limit: controlInventoryLimit, truncated: controlInventoryTruncated }; }
    catch (cause) { return { version: '1.2', status: 'failed', error: cause.message }; }
  }
  const origin = new URL(url).origin;
  const resourceTypes = new Set(['document', 'stylesheet', 'script', 'image', 'font']);
  const resource = request => { try { const target = new URL(request.url()); return target.origin === origin && resourceTypes.has(request.resourceType()) ? `${target.pathname}` : null; } catch { return null; } };
  const responseFailure = response => { const target = resource(response.request()); if (target && response.status() >= 400) failedResources.push({ path: target, status: response.status() }); };
  const requestFailure = request => { const target = resource(request); if (target && !String(request.failure()?.errorText || '').includes('ERR_ABORTED')) failedResources.push({ path: target, status: 'network-error' }); };
  const guard = async route => {
    const target = new URL(route.request().url());
    if (target.origin === origin || ['data:', 'blob:'].includes(target.protocol)) await route.continue();
    else { blockedRequests.push(target.origin); await route.abort(); }
  };
  const observe = async probe => {
    const locator = page.locator(probe.selector);
    if (probe.property === 'visible') return await locator.isVisible();
    if (probe.property === 'value') return await locator.inputValue();
    if (probe.property === 'checked') return await locator.isChecked();
    if (probe.property === 'attribute') return await locator.getAttribute(probe.attribute);
    return (await locator.innerText()).trim();
  };
  const untilExpected = async probe => {
    const deadline = Date.now() + 3000;
    let actual;
    do {
      actual = await observe(probe);
      if (actual === probe.equals) return actual;
      await page.waitForTimeout(75);
    } while (Date.now() < deadline);
    throw new Error(`Expected ${probe.selector} ${probe.property}=${JSON.stringify(probe.equals)}, observed ${JSON.stringify(actual)}`);
  };
  let noticeVisible = false, error = null;
  page.on('response', responseFailure); page.on('requestfailed', requestFailure);
  await page.route('**/*', guard);
  try {
    const initialUrl = new URL(journey.route, url).href;
    await page.goto(initialUrl);
    if (new URL(page.url()).href !== initialUrl) throw new Error('Demo interaction did not reach the requested route');
    const label = page.locator(notice.selector);
    noticeVisible = await label.isVisible() && (await label.innerText()).includes(notice.text);
    if (!noticeVisible) throw new Error('Sample-data notice is missing');
    await collectControls();
    for (const step of journey.steps) {
      const before = await untilExpected(step.before), target = page.locator(step.selector);
      const targets = await target.evaluateAll(describeControls);
      if (['fill', 'selectOption', 'press'].includes(step.action)) await target[step.action](step.value, { timeout: 3000 });
      else await target[step.action]({ timeout: 3000 });
      const after = await untilExpected(step.after);
      if (new URL(page.url()).origin !== origin) throw new Error('Interaction left the Demo origin');
      steps.push({ action: step.action, selector: step.selector, before, after, passed: true });
      for (const item of targets) exercisedControls.add(item.key);
      await collectControls();
    }
    if (blockedRequests.length) throw new Error('Demo attempted requests outside its isolated origin');
  } catch (cause) { error = cause.message; }
  let html = '';
  try { await page.screenshot({ path: screenshotPath, fullPage: true }); html = await page.content(); }
  catch (cause) { error ||= cause.message; }
  finally { await page.unroute('**/*', guard); page.off('response', responseFailure); page.off('requestfailed', requestFailure); }
  if (failedResources.length) error ||= `Demo failed to load required browser resources: ${failedResources.map(item => `${item.path} (${item.status})`).join(', ')}`;
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  return { id: journey.id, url: new URL(journey.route, url).href, finalUrl: page.url(), viewport: `${viewport.width}x${viewport.height}`, status: error ? 'failed' : 'passed', noticeVisible, steps, blockedRequests, failedResources, controlInventoryVersion: '1.2', observedControls: [...controls.values()], exercisedControls: [...exercisedControls], controlIdentityConflicts: [...identityConflicts], controlInventoryTruncated, error, html };
}

export function journeyCode(input) {
  return `async (page) => await (${runDemoJourney.toString()})(page, ${JSON.stringify(input)})`;
}

export async function observeDemoScreenResources(page, input) {
  const origin = new URL(input.url).origin, failedResources = [], blockedRequests = [];
  const types = new Set(['document', 'stylesheet', 'script', 'image', 'font']);
  const resource = request => { try { const target = new URL(request.url()); return target.origin === origin && types.has(request.resourceType()) ? target.pathname : null; } catch { return null; } };
  const responseFailure = response => { const target = resource(response.request()); if (target && response.status() >= 400) failedResources.push({ path: target, status: response.status() }); };
  const requestFailure = request => { const target = resource(request); if (target && !String(request.failure()?.errorText || '').includes('ERR_ABORTED')) failedResources.push({ path: target, status: 'network-error' }); };
  const guard = async route => { const target = new URL(route.request().url()); if (target.origin === origin || ['data:', 'blob:'].includes(target.protocol)) await route.continue(); else { blockedRequests.push(target.origin); await route.abort(); } };
  let error = null;
  page.on('response', responseFailure); page.on('requestfailed', requestFailure);
  try { await page.route('**/*', guard); await page.goto(input.url); if (page.url() !== input.url) throw new Error('Demo screen did not reach the requested route'); }
  catch (cause) { error = cause.message; }
  finally { await page.unroute('**/*', guard); page.off('response', responseFailure); page.off('requestfailed', requestFailure); }
  return { status: error || failedResources.length || blockedRequests.length ? 'failed' : 'passed', url: page.url(), failedResources, blockedRequests, error };
}
export const demoScreenResourceCode = input => `async (page) => await (${observeDemoScreenResources.toString()})(page, ${JSON.stringify(input)})`;
