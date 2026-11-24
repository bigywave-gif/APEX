import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { currentResourceReview } from './existing-resource-freshness.mjs';
import { controlledOutput } from './verification-policy.mjs';

const digest = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
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
    const eligible = new Map((reference.unresolvedResources || []).filter(item => Array.isArray(item.contexts) && item.contexts.length === 1 && ['img-src', 'css-background-url'].includes(item.contexts[0])).map(item => [JSON.stringify([item.source, item.reference]), item.contexts[0] === 'img-src' ? 'visible-image' : 'background-image']));
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
    return { status: pending.length ? 'unverified' : 'verified-visible-images', pending, evidence: ref, scope: 'decoded resource on checked screens; explicit non-applicability decisions for remaining screens; captured states only', exemptions: capture.resourceExemptions || [] };
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
export function observeResourceExemptions(checks) {
  const result = (check, status) => ({ ...check, kind: 'not-applicable', status });
  if (!checks.length) return [];
  try {
    const nodes = [...document.querySelectorAll('*')];
    if (nodes.length > 10000) return checks.map(check => result(check, 'unverified'));
    const hiddenCache = new WeakMap();
    const suppressed = node => {
      const path = []; let current = node, value = false;
      while (current) {
        if (hiddenCache.has(current)) { value = hiddenCache.get(current); break; }
        path.push(current);
        const style = getComputedStyle(current);
        if (style.display === 'none' || Number(style.opacity) === 0) { value = true; break; }
        current = current.parentElement;
      }
      for (const item of path) hiddenCache.set(item, value);
      return value;
    };
    // visibility is inherited but can be overridden by a descendant. Its
    // computed value on the element, not an ancestor's value, controls it.
    const hidden = node => { const visibility = getComputedStyle(node).visibility; return visibility === 'hidden' || visibility === 'collapse' || suppressed(node); };
    const images = new Set(), backgrounds = new Set();
    for (const node of nodes) {
      if (hidden(node)) continue;
      if (node instanceof HTMLImageElement && node.currentSrc) images.add(new URL(node.currentSrc, location.href).href);
      for (const pseudo of [null, '::before', '::after']) {
        const value = getComputedStyle(node, pseudo).backgroundImage || '';
        for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) backgrounds.add(new URL((match[1] ?? match[2] ?? match[3]).trim(), location.href).href);
      }
    }
    return checks.map(check => {
      try {
        const expected = new URL(check.reference, location.href);
        const matches = [...document.querySelectorAll(check.selector)];
        const present = check.resourceKind === 'visible-image' ? images.has(expected.href) : check.resourceKind === 'background-image' ? backgrounds.has(expected.href) : true;
        return result(check, expected.origin === location.origin && matches.every(hidden) && !present ? 'not-rendered' : 'unverified');
      } catch { return result(check, 'unverified'); }
    });
  } catch { return checks.map(check => result(check, 'unverified')); }
}
export const resourceImageProbeCode = checks => `async (page) => JSON.stringify(await page.evaluate(async checks => { const images = ${observeResourceImages.toString()}; const backgrounds = ${observeBackgroundImages.toString()}; const exemptions = ${observeResourceExemptions.toString()}; const exemptResults = exemptions(checks.filter(item => item.kind === 'not-applicable')); let nextExemption = 0; const result = []; for (let i = 0; i < checks.length; i += 4) result.push(...await Promise.all(checks.slice(i, i + 4).map(async item => item.kind === 'background-image' ? (await backgrounds([item]))[0] : item.kind === 'not-applicable' ? exemptResults[nextExemption++] : images([item])[0]))); return result; }, ${JSON.stringify(checks)}))`;
