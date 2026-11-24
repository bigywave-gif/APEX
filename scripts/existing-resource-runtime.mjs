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
    const verified = new Set();
    for (const screen of capture.evidence || []) {
      if (screen.status !== 'captured' || digest(local(runDir, screen.screenshot)) !== screen.screenshotSha256 || digest(local(runDir, screen.domHtml)) !== screen.domSha256) continue;
      for (const item of screen.resourceChecks || []) {
        const key = JSON.stringify([item.source, item.reference]);
        if (eligible.get(key) === item.kind && item.status === 'passed' && item.screenId === screen.id && typeof item.selector === 'string' && item.selector.trim()) verified.add(key);
      }
    }
    const pending = review.pending.filter(item => !verified.has(JSON.stringify([item.source, item.reference])));
    return { status: pending.length ? 'unverified' : 'verified-visible-images', pending, evidence: ref, scope: 'decoded image or background image on the specified captured screen only' };
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
export const resourceImageProbeCode = checks => `async (page) => JSON.stringify(await page.evaluate(async checks => { const images = ${observeResourceImages.toString()}; const backgrounds = ${observeBackgroundImages.toString()}; const result = []; for (let i = 0; i < checks.length; i += 4) result.push(...await Promise.all(checks.slice(i, i + 4).map(async item => item.kind === 'background-image' ? (await backgrounds([item]))[0] : images([item])[0]))); return result; }, ${JSON.stringify(checks)}))`;
