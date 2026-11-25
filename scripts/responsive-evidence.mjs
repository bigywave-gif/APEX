import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validBoundMainViewport } from './viewport-main-evidence.mjs';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function responsiveEvidenceFailures(runDir, capture, receipts, matrix, responsive) {
  const failures = [], root = fs.realpathSync(runDir), captureFile = path.join(root, 'evidence/runtime-browser-capture.json');
  if (Array.isArray(capture?.sourceBindings) && capture.sourceBindings.length && capture.sourceMainViewportProtocol !== '1.0') failures.push('responsive source-bound main viewport observation is missing; recapture the formal pages');
  if (!fs.existsSync(captureFile) || !receipts.some(item => item.status === 'succeeded' && item.action === 'verify' && path.basename(item.script || '') === 'browser-capture.mjs' && item.outputFileHashes?.['evidence/runtime-browser-capture.json'] === hash(captureFile))) return ['responsive evidence lacks a current controlled formal browser capture'];
  const proof = (reference, width, height) => {
    if (typeof reference !== 'string' || !reference) return false;
    const file = path.resolve(root, reference); if (!fs.existsSync(file)) return false;
    const actual = fs.realpathSync(file); if (!actual.startsWith(`${root}${path.sep}`) || !fs.statSync(actual).isFile()) return false;
    return (capture.evidence || []).find(item => {
      if (item.status !== 'captured' || !item.screenshot || !item.screenshotSha256) return false;
      const capturedFile = path.resolve(root, item.screenshot);
      if (!fs.existsSync(capturedFile) || fs.realpathSync(capturedFile) !== actual || item.screenshotSha256 !== hash(actual)) return false;
      const match = /^(\d+)x(\d+)$/.exec(item.viewport || '');
      return Boolean(match && Number(match[1]) === width && (height === undefined || Number(match[2]) === height));
    });
  };
  const checkMain = (observed, label) => {
    const main = observed.sourceMainViewport;
    if (capture.sourceMainViewportProtocol !== undefined && (capture.sourceMainViewportProtocol !== '1.0' || main === undefined)) failures.push(`responsive source-bound main viewport observation is missing: ${label}`);
    if (main !== undefined && !validBoundMainViewport(main)) failures.push(`responsive source-bound main viewport observation is invalid: ${label}`);
    else if (main?.status === 'offscreen') failures.push(`responsive source-bound main content is horizontally offscreen: ${label}`);
    else if (main?.status === 'unverified') failures.push(`responsive source-bound main viewport observation was truncated: ${label}`);
  };
  const ranges = new Map((responsive?.viewports || []).map(item => [item.class, item]));
  for (const viewport of matrix.viewports || []) {
    const observed = proof(viewport.screenshot, viewport.width, viewport.height);
    if (!observed) failures.push(`viewport screenshot is not the current captured viewport: ${viewport.name || viewport.class}`);
    else checkMain(observed, `viewport:${viewport.name || viewport.class}`);
  }
  for (const sample of matrix.rangeChecks || []) {
    const observed = proof(sample.screenshot, sample.width);
    if (!observed) { failures.push(`responsive range screenshot is not the current captured width: ${sample.class}:${sample.width}`); continue; }
    checkMain(observed, `${sample.class}:${sample.width}`);
    const metrics = observed.layoutMetrics;
    if (!Number.isFinite(metrics?.documentScrollWidth) || !Number.isFinite(metrics?.documentClientWidth) || metrics.documentClientWidth < 1) failures.push(`responsive horizontal overflow measurement is missing: ${sample.class}:${sample.width}`);
    else if (metrics.documentScrollWidth > metrics.documentClientWidth + 1) failures.push(`responsive horizontal overflow observed: ${sample.class}:${sample.width}`);
  }
  for (const kind of ['mobile', 'tablet', 'desktop']) {
    const range = ranges.get(kind);
    if (!range || !Number.isInteger(range.minWidth) || !Number.isInteger(range.maxWidth)) { failures.push(`responsive range is missing: ${kind}`); continue; }
    const widths = new Set((matrix.rangeChecks || []).filter(item => item.class === kind).map(item => item.width));
    for (const required of [range.minWidth, Math.floor((range.minWidth + range.maxWidth) / 2), range.maxWidth]) if (!widths.has(required)) failures.push(`responsive range lacks min/mid/max width: ${kind}:${required}`);
  }
  for (const item of matrix.states || []) if (item.applicable) {
    let observed = null;
    for (const screen of capture.evidence || []) {
      const match = /^(\d+)x(\d+)$/.exec(screen.viewport || '');
      if (match) observed = proof(item.screenshot, Number(match[1]), Number(match[2]));
      if (observed) break;
    }
    if (!observed) failures.push(`state screenshot is not from the current formal capture: ${item.name}`);
    else if (item.name === 'default') checkMain(observed, `state:${item.name}`);
  }
  return failures;
}
