import { evidenceFor, pass } from './structure-evidence.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
function checkedFile(runDir, item, label) {
  if (!item?.path || !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error(`${label} has no frozen path and hash`);
  const root = fs.realpathSync(runDir), file = path.resolve(runDir, item.path);
  if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || hash(file) !== item.sha256) throw new Error(`${label} is missing, changed, or outside the run`);
  return file;
}
export function bindStitchScreen(runDir, screen, baseline) {
  const binding = screen.demoCapture;
  if (!binding || !['screen', 'journey'].includes(binding.kind) || typeof binding.id !== 'string' || !binding.id) throw new Error(`Stitch screen ${screen.screenId} needs an explicit Demo capture binding`);
  const captures = binding.kind === 'screen' ? baseline.screenCaptures : baseline.journeyCaptures;
  const matches = (captures || []).filter(item => item.id === binding.id);
  if (matches.length !== 1) throw new Error(`Demo capture is missing or ambiguous: ${binding.kind}/${binding.id}`);
  const capture = matches[0];
  if (binding.kind === 'screen' && !['initial', 'default'].includes(screen.state)) throw new Error('initial screen capture cannot prove a post-interaction state');
  if (binding.kind === 'journey' && screen.state !== `journey:${binding.id}`) throw new Error('Stitch state must identify the exact captured journey');
  const actual = new URL(binding.kind === 'journey' ? capture.finalUrl : capture.url);
  const route = new URL(screen.route, actual.origin);
  if (actual.origin !== route.origin || actual.pathname !== route.pathname || actual.search !== route.search || actual.hash !== route.hash) throw new Error('Stitch route does not match the captured Demo state');
  const dimensions = /^(\d+)x(\d+)$/.exec(capture.viewport || '');
  if (!dimensions || Number(dimensions[1]) < 1 || Number(dimensions[2]) < 1) throw new Error('Demo capture viewport is missing or invalid');
  const width = Number(dimensions[1]);
  const viewport = width < 768 ? 'mobile' : width < 1100 ? 'tablet' : 'desktop';
  if (screen.viewport !== viewport) throw new Error('Stitch viewport does not match the captured Demo viewport');
  checkedFile(runDir, baseline.browserCapture, 'Demo browser capture');
  checkedFile(runDir, capture.screenshot, 'Demo screenshot');
  checkedFile(runDir, capture.dom, 'Demo DOM');
  return { kind: binding.kind, id: binding.id, route: `${actual.pathname}${actual.search}${actual.hash}`, viewport: capture.viewport, screenshot: capture.screenshot, dom: capture.dom };
}

export function resolveStitchScreenReference(runDir, state, screen) {
  const localJson = (reference, label) => {
    if (!reference) throw new Error(`${label} is missing`);
    const root = fs.realpathSync(runDir), file = path.resolve(runDir, reference);
    if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error(`${label} is missing or outside the run`);
    return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  const baseline = localJson(state.artifacts?.runtimeVisualBaseline, 'Demo baseline').value;
  const binding = bindStitchScreen(runDir, screen, baseline);
  const index = localJson(state.artifacts?.visualScreenReferences, 'screen reference index').value;
  const entries = (index.entries || []).filter(item => item.kind === binding.kind && item.id === binding.id);
  if (entries.length !== 1) throw new Error('a unique confirmed visual reference is required for this Demo capture');
  const result = localJson(entries[0].path, 'screen visual reference');
  if (hash(result.file) !== entries[0].sha256 || result.value.referenceImage?.sha256 !== binding.screenshot.sha256 || result.value.referenceImage?.path !== binding.screenshot.path || JSON.stringify(result.value.demoEvidence) !== JSON.stringify(binding) || result.value.demoCapture?.kind !== binding.kind || result.value.demoCapture?.id !== binding.id) throw new Error('screen visual reference is changed or does not bind its Demo capture');
  if (!pass(evidenceFor(result.value, fs.readFileSync(path.resolve(runDir, binding.dom.path), 'utf8')))) throw new Error('screen visual reference no longer matches its Demo DOM');
  return { visual: result.value, path: entries[0].path, sha256: entries[0].sha256, binding };
}

// An inferred binding is safe only when the confirmed baseline contains one
// exact route, viewport and state candidate. Never select an arbitrary match.
export function autoBindStitchScreens(runDir, baseline, screens) {
  if (!Array.isArray(screens) || !screens.length) throw new Error('Stitch selection needs screens');
  const ids = screens.map(screen => screen.screenId);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Stitch screen IDs are missing or duplicated');
  return screens.map(screen => {
    if (screen.demoCapture) { bindStitchScreen(runDir, screen, baseline); return screen; }
    const candidates = [
      ...(baseline.screenCaptures || []).map(item => ({ kind: 'screen', id: item.id })),
      ...(baseline.journeyCaptures || []).map(item => ({ kind: 'journey', id: item.id }))
    ].filter(binding => {
      try { bindStitchScreen(runDir, { ...screen, demoCapture: binding }, baseline); return true; } catch { return false; }
    });
    if (candidates.length !== 1) throw new Error(`Stitch screen ${screen.screenId} needs one unambiguous confirmed Demo capture; found ${candidates.length}`);
    return { ...screen, demoCapture: candidates[0] };
  });
}
