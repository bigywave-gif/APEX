import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const route = value => { const url = new URL(value); return `${url.pathname}${url.search}${url.hash}`; };
export function formalRouteCoverage(runDir, baseline, capture, receipts) {
  try {
    const screens = baseline.screenCaptures || [];
    if (!screens.length) throw new Error('confirmed Demo routes are missing');
    if (screens.length === 1) return { status: 'not-required', routes: [route(screens[0].url)] };
    if (screens.some(item => !/^\d+x\d+$/.test(item.viewport || ''))) throw new Error('confirmed Demo viewport is missing or invalid');
    const expected = new Set(screens.map(item => `${route(item.url)} ${item.viewport}`));
    const captureRef = 'evidence/runtime-browser-capture.json', captureFile = path.join(runDir, captureRef);
    if (!fs.existsSync(captureFile) || capture.status !== 'passed' || capture.kind !== 'runtime' || !Array.isArray(capture.evidence) || !capture.evidence.length) throw new Error('formal browser capture is missing or failed');
    if (!(receipts || []).some(item => item.action === 'verify' && item.status === 'succeeded' && path.basename(item.script || '') === 'browser-capture.mjs' && item.outputFileHashes?.[captureRef] === hash(captureFile))) throw new Error('formal browser capture lacks a current successful verify receipt');
    const seen = new Set(), root = fs.realpathSync(runDir); let origin = null;
    for (const item of capture.evidence) {
      if (item.status !== 'captured') throw new Error('formal browser screen did not capture successfully');
      const url = new URL(item.url); if (origin && origin !== url.origin) throw new Error('formal screens do not share one application origin'); origin = url.origin;
      for (const [ref, digest] of [[item.screenshot, item.screenshotSha256], [item.domHtml, item.domSha256]]) {
        const file = path.resolve(runDir, ref || '');
        if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !/^sha256:[a-f0-9]{64}$/.test(digest || '') || hash(file) !== digest) throw new Error('formal screen screenshot or DOM is missing or changed');
      }
      if (!/^\d+x\d+$/.test(item.viewport || '')) throw new Error('formal screen viewport is missing or invalid');
      seen.add(`${route(item.url)} ${item.viewport}`);
    }
    const missing = [...expected].filter(item => !seen.has(item));
    if (missing.length) throw new Error(`formal browser capture misses confirmed route and viewport: ${missing.join(', ')}`);
    return { status: 'ready', routes: [...expected] };
  } catch (error) { return { status: 'incomplete', reason: error.message }; }
}
