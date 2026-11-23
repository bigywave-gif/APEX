/** Shared contract and browser executor for an interactive UI prototype. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const demoHash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const objectHash = value => demoHash(JSON.stringify(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const assert = (value, message) => { if (!value) throw new Error(`Interactive Demo: ${message}`); };

export function validateInteractionContract(contract, tasks = []) {
  assert(contract?.schemaVersion === '1.0' && contract.kind === 'interactive-ui-prototype', 'interactionContract must describe an interactive-ui-prototype');
  assert(contract.dataMode === 'mock', 'the frontend Demo must use isolated mock data');
  assert(nonempty(contract.notice?.selector) && nonempty(contract.notice?.text), 'a visible sample-data notice is required');
  assert(Array.isArray(contract.journeys) && contract.journeys.length > 0, 'executable user journeys are required');
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
  const contract = validateInteractionContract(manifest.interactionContract);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'materialized source files are required');
  for (const item of manifest.files) {
    assert(item.path?.startsWith('visual-sandbox/'), 'source must belong to visual-sandbox');
    assert(demoHash(fs.readFileSync(localFile(runDir, item.path))) === item.sha256, `source changed after materialization: ${item.path}`);
  }
  return { contract, contractHash: objectHash(contract), sourceManifestHash: demoHash(fs.readFileSync(manifestFile)) };
}

export function verifyDemoInteractions(runDir, capture, url, { requireJourneyLocation = false } = {}) {
  const source = interactionSource(runDir), evidence = capture?.interactiveDemo;
  assert(capture?.status === 'passed' && evidence?.status === 'passed', 'passed real-browser interaction evidence is required');
  assert(evidence.contractHash === source.contractHash && evidence.sourceManifestHash === source.sourceManifestHash, 'interaction evidence is stale for the current source/contract');
  assert(evidence.url === url && Array.isArray(evidence.journeys) && evidence.journeys.length === source.contract.journeys.length, 'interaction evidence must cover this Demo URL and every journey');
  for (const expected of source.contract.journeys) {
    const matches = evidence.journeys.filter(item => item.id === expected.id);
    assert(matches.length === 1, `missing or duplicate journey: ${expected.id}`);
    const actual = matches[0];
    assert(actual.status === 'passed' && actual.url === new URL(expected.route, url).href && actual.noticeVisible === true && actual.blockedRequests?.length === 0, `journey failed or attempted non-Demo requests: ${expected.id}`);
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
  const testedActions = source.contract.journeys.flatMap(journey => journey.steps.map(step => ({ journeyId: journey.id, selector: step.selector, action: step.action })));
  const inventoryAvailable = evidence.journeys.every(journey => Array.isArray(journey.observedControls) && Array.isArray(journey.exercisedControls) && typeof journey.controlInventoryTruncated === 'boolean');
  const observed = new Map(), exercised = new Set();
  if (inventoryAvailable) for (const journey of evidence.journeys) {
    for (const control of journey.observedControls) { assert(nonempty(control?.key), 'invalid observed control identity'); observed.set(control.key, control); }
    for (const key of journey.exercisedControls) { assert(nonempty(key), 'invalid exercised control identity'); exercised.add(key); }
  }
  return { kind: 'interactive-ui-prototype', dataMode: 'mock', contractHash: source.contractHash, journeyCount: evidence.journeys.length, controlCoverage: inventoryAvailable ? { scope: 'observed-journey-states-only', testedActions, observedControls: [...observed.values()], untestedControls: [...observed.values()].filter(control => !exercised.has(control.key)), truncated: evidence.journeys.some(journey => journey.controlInventoryTruncated), note: 'Inventory recognizes native buttons, links and form fields and selected ARIA roles; other custom controls, hidden or unvisited states and semantic correctness are not proven.' } : { scope: 'declared-journeys-only', testedActions, otherVisibleControls: 'not-inventoried' } };
}

// This function is serialized into Playwright CLI run-code. It has no closure
// dependencies; UI actions and assertions execute in the real browser.
export async function runDemoJourney(page, input) {
  const { journey, url, notice, screenshotPath } = input;
  const blockedRequests = [], steps = [], controls = new Map(), exercisedControls = new Set();
  let controlInventoryTruncated = false;
  const controlSelector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="textbox"], [role="option"]';
  const describeControls = elements => {
    const found = new Map();
    for (const original of elements) {
      const element = original.closest('button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="textbox"], [role="option"]') || original;
      if (!(element instanceof HTMLElement) || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden' || element.matches(':disabled') || element.closest('[aria-disabled="true"], [aria-hidden="true"], [inert]') || element.matches('input[readonly],textarea[readonly]')) continue;
      if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let key;
      if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) key = `id:${element.id}`;
      else {
        const parts = []; let node = element;
        while (node && node.nodeType === 1) { const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.tagName === node.tagName) : [node]; parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); node = node.parentElement; }
        key = `path:${parts.join('>')}`;
      }
      key = `route:${location.pathname}${location.search}${location.hash}|${key}`;
      found.set(key, { key, tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || null, type: element.getAttribute('type') || null });
    }
    return [...found.values()];
  };
  const collectControls = async () => {
    const items = await page.locator(controlSelector).evaluateAll(describeControls);
    if (items.length > 500) controlInventoryTruncated = true;
    for (const item of items.slice(0, 500)) { if (controls.size >= 500 && !controls.has(item.key)) { controlInventoryTruncated = true; continue; } controls.set(item.key, item); }
  };
  const origin = new URL(url).origin;
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
  await page.route('**/*', guard);
  try {
    await page.goto(new URL(journey.route, url).href);
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
  finally { await page.unroute('**/*', guard); }
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  return { id: journey.id, url: new URL(journey.route, url).href, finalUrl: page.url(), viewport: `${viewport.width}x${viewport.height}`, status: error ? 'failed' : 'passed', noticeVisible, steps, blockedRequests, observedControls: [...controls.values()], exercisedControls: [...exercisedControls], controlInventoryTruncated, error, html };
}

export function journeyCode(input) {
  return `async (page) => await (${runDemoJourney.toString()})(page, ${JSON.stringify(input)})`;
}
