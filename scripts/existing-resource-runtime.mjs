import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { currentResourceReview } from './existing-resource-freshness.mjs';
import { controlledOutput } from './verification-policy.mjs';

const digest = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function eligibleResourceKinds(reference) {
  const kinds = { 'img-src': 'visible-image', 'css-background-url': 'background-image', 'script-src': 'loaded-script', 'link-href': 'loaded-stylesheet' };
  return new Map((reference.unresolvedResources || []).filter(item => Array.isArray(item.contexts) && item.contexts.length === 1 && kinds[item.contexts[0]]).map(item => [JSON.stringify([item.source, item.reference]), kinds[item.contexts[0]]]));
}
function local(runDir, ref) {
  if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) throw new Error('resource verification artifact must be Run-local');
  const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, ref));
  if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('resource verification artifact escapes the Run');
  return file;
}
export function resourceVerificationBinding(runDir, state) {
  const bindings = {};
  for (const key of ['codeReference', 'existingBaseline', 'changeScope', 'implementationRegistration']) {
    const ref = state.artifacts?.[key]; bindings[key] = { path: ref, sha256: digest(local(runDir, ref)) };
  }
  const manifest = JSON.parse(fs.readFileSync(local(runDir, state.artifacts?.roleAdvisoryManifest), 'utf8'));
  const entry = manifest.stages?.baseline?.advisories?.find(item => item.roleId === 'existing-baseline-analyst');
  if (!entry || digest(local(runDir, entry.path)) !== entry.sha256) throw new Error('baseline analyst review changed');
  bindings.baselineAnalyst = { path: entry.path, sha256: entry.sha256 };
  return bindings;
}
export function assessResourceVerification(runDir, state) {
  const review = currentResourceReview(runDir, state);
  if (review.status !== 'unverified') return review;
  try {
    const ref = 'evidence/runtime-browser-capture.json';
    if (!controlledOutput(runDir, ref, ['browser-capture.mjs'])) throw new Error('current controlled formal browser capture is missing');
    const capture = JSON.parse(fs.readFileSync(local(runDir, ref), 'utf8'));
    if (capture.kind !== 'runtime' || capture.status !== 'passed' || JSON.stringify(capture.resourceReviewBinding) !== JSON.stringify(resourceVerificationBinding(runDir, state))) throw new Error('formal resource capture does not bind the current review and implementation');
    const reference = JSON.parse(fs.readFileSync(local(runDir, state.artifacts.codeReference), 'utf8'));
    const eligible = eligibleResourceKinds(reference);
    const screens = capture.evidence || [], screenIds = new Set(screens.map(screen => screen.id));
    if (!screens.length || screenIds.size !== screens.length || screens.some(screen => typeof screen.id !== 'string' || !screen.id)) throw new Error('resource coverage requires uniquely identified captured screens');
    const required = new Set(review.pending.map(item => JSON.stringify([item.source, item.reference]))), pairs = new Set(), verified = new Set();
    if (required.size * screenIds.size > 1000) throw new Error('resource screen coverage exceeds the bounded verification limit');
    for (const screen of screens) {
      if (screen.status !== 'captured' || digest(local(runDir, screen.screenshot)) !== screen.screenshotSha256 || digest(local(runDir, screen.domHtml)) !== screen.domSha256) throw new Error('resource screen evidence is missing or changed');
      for (const item of screen.resourceChecks || []) {
        const key = JSON.stringify([item.source, item.reference]), pair = JSON.stringify([key, screen.id]);
        if (!required.has(key) || pairs.has(pair) || eligible.get(key) !== item.kind || item.status !== 'passed' || item.screenId !== screen.id || typeof item.selector !== 'string' || !item.selector.trim()) throw new Error('resource check is invalid or duplicated');
        pairs.add(pair); verified.add(key);
      }
    }
    if (capture.resourceExemptions !== undefined && !Array.isArray(capture.resourceExemptions)) throw new Error('resource screen exemptions are invalid');
    for (const item of capture.resourceExemptions || []) {
      const key = JSON.stringify([item?.source, item?.reference]), pair = JSON.stringify([key, item?.screenId]);
      const screen = screens.find(value => value.id === item?.screenId);
      if (!required.has(key) || !screen || pairs.has(pair) || item.resourceKind !== eligible.get(key) || typeof item.rationale !== 'string' || item.rationale.trim().length < 12 || typeof item.selector !== 'string' || !item.selector.trim() || item.kind !== 'not-applicable' || item.status !== 'not-rendered' || !(screen.resourceExemptions || []).some(observation => JSON.stringify(observation) === JSON.stringify(item))) throw new Error('resource screen exemption is invalid, unobserved or duplicated');
      pairs.add(pair);
    }
    const pending = review.pending.filter(item => { const key = JSON.stringify([item.source, item.reference]); return !verified.has(key) || [...screenIds].some(id => !pairs.has(JSON.stringify([key, id]))); });
    const hasLoadedCode = [...required].some(key => ['loaded-script', 'loaded-stylesheet'].includes(eligible.get(key)));
    return { status: pending.length ? 'unverified' : hasLoadedCode ? 'verified-loaded-resources' : 'verified-visible-images', pending, evidence: ref, scope: 'decoded images or same-origin observed successful resource loads on checked screens; script execution and all runtime states are not established', exemptions: capture.resourceExemptions || [] };
  } catch (error) { return { status: 'unverified', pending: review.pending, reason: error.message }; }
}

// Executed inside the real page. No additional network request is made.
export function observeResourceImages(checks) {
  return checks.map(check => {
    try {
      const expected = new URL(check.reference, location.href);
      const node = document.querySelector(check.selector), rect = node?.getBoundingClientRect(), style = node && getComputedStyle(node);
      const ok = expected.origin === location.origin && node instanceof HTMLImageElement && node.currentSrc === expected.href && node.complete && node.naturalWidth > 0 && node.naturalHeight > 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 && (typeof node.checkVisibility !== 'function' || node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
      return { ...check, kind: 'visible-image', status: ok ? 'passed' : 'unverified' };
    } catch { return { ...check, kind: 'visible-image', status: 'unverified' }; }
  });
}

// The image decoder may fetch the same-origin URL if it is not cached. This
// verifies the bytes, not whether an overlay obscures the background.
export async function observeBackgroundImages(checks) {
  return Promise.all(checks.map(async check => {
    const result = status => ({ ...check, kind: 'background-image', status });
    try {
      const expected = new URL(check.reference, location.href);
      const node = document.querySelector(check.selector), rect = node?.getBoundingClientRect(), style = node && getComputedStyle(node);
      if (expected.origin !== location.origin || !node || !rect || !style || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) <= 0 || (typeof node.checkVisibility === 'function' && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) return result('unverified');
      const urls = [...style.backgroundImage.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)].map(match => new URL((match[1] ?? match[2] ?? match[3]).trim(), location.href).href);
      if (!urls.includes(expected.href)) return result('unverified');
      const image = new Image(); image.src = expected.href;
      let timer;
      const decoded = await Promise.race([image.decode().then(() => image.naturalWidth > 0 && image.naturalHeight > 0, () => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
      clearTimeout(timer);
      return result(decoded ? 'passed' : 'unverified');
    } catch { return result('unverified'); }
  }));
}

// A direct same-origin recheck rejects redirects, which resource timing alone
// cannot reliably distinguish. Loading does not establish script execution.
export function observeLoadedResources(checks) {
  return checks.map(check => {
    try {
      const expected = new URL(check.reference, location.href), node = document.querySelector(check.selector);
      const script = check.kind === 'loaded-script';
      const matches = script ? node instanceof HTMLScriptElement && node.src === expected.href : node instanceof HTMLLinkElement && node.relList.contains('stylesheet') && node.href === expected.href && !node.disabled && Boolean(node.sheet);
      const entries = performance.getEntriesByName(expected.href, 'resource').filter(entry => entry.initiatorType === (script ? 'script' : 'link'));
      const loaded = entries.length > 0 && entries.every(entry => Number.isInteger(entry.responseStatus) && entry.responseStatus >= 200 && entry.responseStatus < 300);
      return { ...check, status: expected.origin === location.origin && matches && loaded ? 'passed' : 'unverified' };
    } catch { return { ...check, status: 'unverified' }; }
  });
}
export function observeResourceExemptions(checks) {
  const result = (check, status) => ({ ...check, kind: 'not-applicable', status });
  if (!checks.length) return [];
  try {
    const nodes = [], roots = [document];
    for (let i = 0; i < roots.length; i++) {
      for (const node of roots[i].querySelectorAll('*')) {
        nodes.push(node);
        if (nodes.length > 10000) return checks.map(check => result(check, 'unverified'));
        if (node.shadowRoot) roots.push(node.shadowRoot);
      }
    }
    const hiddenCache = new WeakMap();
    const suppressed = node => {
      const path = []; let current = node, value = false;
      while (current) {
        if (hiddenCache.has(current)) { value = hiddenCache.get(current); break; }
        path.push(current);
        const style = getComputedStyle(current);
        if (style.display === 'none' || Number(style.opacity) === 0) { value = true; break; }
        current = current.parentElement || current.getRootNode?.()?.host || null;
      }
      for (const item of path) hiddenCache.set(item, value);
      return value;
    };
    // visibility is inherited but can be overridden by a descendant. Its
    // computed value on the element, not an ancestor's value, controls it.
    const hidden = node => { const visibility = getComputedStyle(node).visibility; return visibility === 'hidden' || visibility === 'collapse' || suppressed(node); };
    const images = new Set(), backgrounds = new Set(), scripts = new Set(), stylesheets = new Set(); let unknownImageCandidates = false;
    for (const node of nodes) {
      if (typeof HTMLScriptElement !== 'undefined' && node instanceof HTMLScriptElement && node.src) scripts.add(new URL(node.src, location.href).href);
      if (typeof HTMLLinkElement !== 'undefined' && node instanceof HTMLLinkElement && node.relList.contains('stylesheet') && node.href) stylesheets.add(new URL(node.href, location.href).href);
      if (hidden(node)) continue;
      if (node instanceof HTMLImageElement) {
        for (const source of [node.currentSrc, node.src]) if (source) images.add(new URL(source, location.href).href);
        if (!node.currentSrc && (node.srcset || node.closest?.('picture')?.querySelector('source[srcset]'))) unknownImageCandidates = true;
      }
      for (const pseudo of [null, '::before', '::after']) {
        const value = getComputedStyle(node, pseudo).backgroundImage || '';
        for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) backgrounds.add(new URL((match[1] ?? match[2] ?? match[3]).trim(), location.href).href);
      }
    }
    const loadedURLs = new Set(), resourceEntries = performance.getEntriesByType('resource');
    const resourceTimingMayBeTruncated = resourceEntries.length >= 250;
    for (const entry of resourceEntries) {
      loadedURLs.add(entry.name);
      if (entry.initiatorType === 'script') scripts.add(entry.name);
      if (entry.initiatorType === 'link') stylesheets.add(entry.name);
    }
    return checks.map(check => {
      try {
        const expected = new URL(check.reference, location.href);
        const matches = roots.flatMap(root => [...root.querySelectorAll(check.selector)]);
        const present = check.resourceKind === 'visible-image' ? unknownImageCandidates || images.has(expected.href) : check.resourceKind === 'background-image' ? backgrounds.has(expected.href) : check.resourceKind === 'loaded-script' ? resourceTimingMayBeTruncated || scripts.has(expected.href) || loadedURLs.has(expected.href) : check.resourceKind === 'loaded-stylesheet' ? resourceTimingMayBeTruncated || stylesheets.has(expected.href) || loadedURLs.has(expected.href) : true;
        return result(check, expected.origin === location.origin && matches.every(hidden) && !present ? 'not-rendered' : 'unverified');
      } catch { return result(check, 'unverified'); }
    });
  } catch { return checks.map(check => result(check, 'unverified')); }
}
export const resourceImageProbeCode = checks => `async (page) => { const checks = ${JSON.stringify(checks)}; let topologySafe = true; if (checks.some(item => item.kind === 'not-applicable')) { let cdp; try { cdp = await page.context().newCDPSession(page); const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); const pending = [root]; let count = 0; while (pending.length) { const node = pending.pop(); if (++count > 10000 || ['IFRAME', 'FRAME'].includes(node.nodeName) || (node.shadowRoots || []).some(root => root.shadowRootType === 'closed')) { topologySafe = false; break; } pending.push(...(node.children || []), ...(node.shadowRoots || []).filter(root => root.shadowRootType !== 'user-agent')); } } catch { topologySafe = false; } finally { if (cdp) await cdp.detach().catch(() => {}); } } const observations = await page.evaluate(async ({ checks, topologySafe }) => { const images = ${observeResourceImages.toString()}; const backgrounds = ${observeBackgroundImages.toString()}; const loaded = ${observeLoadedResources.toString()}; const exemptions = ${observeResourceExemptions.toString()}; const exemptChecks = checks.filter(item => item.kind === 'not-applicable'); const exemptResults = topologySafe ? exemptions(exemptChecks) : exemptChecks.map(item => ({ ...item, status: 'unverified' })); let nextExemption = 0; const result = []; for (let i = 0; i < checks.length; i += 4) result.push(...await Promise.all(checks.slice(i, i + 4).map(async item => item.kind === 'background-image' ? (await backgrounds([item]))[0] : item.kind === 'not-applicable' ? exemptResults[nextExemption++] : ['loaded-script', 'loaded-stylesheet'].includes(item.kind) ? loaded([item])[0] : images([item])[0]))); return result; }, { checks, topologySafe }); for (let i = 0; i < observations.length; i += 4) await Promise.all(observations.slice(i, i + 4).map(async item => { if (!['loaded-script', 'loaded-stylesheet'].includes(item.kind) || item.status !== 'passed') return; try { const target = new URL(item.reference, page.url()); if (target.origin !== new URL(page.url()).origin) throw new Error('cross origin'); const response = await page.context().request.get(target.href, { maxRedirects: 0, timeout: 5000, headers: { 'Cache-Control': 'no-cache' } }); const valid = response.status() >= 200 && response.status() < 300 && response.url() === target.href; await response.dispose(); if (!valid) item.status = 'unverified'; } catch { item.status = 'unverified'; } })); return JSON.stringify(observations); }`;
