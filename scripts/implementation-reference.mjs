import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveStitchScreenReference } from './stitch-screen-binding.mjs';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function resolveImplementationReference(runDir, state, baseline, capture = null) {
  if (baseline?.kind !== 'stitch') throw new Error('a frozen Stitch baseline is required');
  const freezeFile = path.resolve(runDir, state.artifacts?.stitchFreeze || 'stitch-freeze.json');
  const freeze = JSON.parse(fs.readFileSync(freezeFile, 'utf8'));
  const screens = (freeze.approvedScreens || []).filter(item => item.imageHash === baseline.imageHash && (!baseline.screenId || item.screenId === baseline.screenId));
  if (screens.length !== 1) throw new Error('Stitch implementation baseline must identify exactly one frozen screen');
  const screen = screens[0], file = path.resolve(runDir, screen.imagePath || ''), root = fs.realpathSync(runDir);
  if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || hash(file) !== screen.imageHash) throw new Error('frozen Stitch implementation image is missing or changed');
  let visual = null;
  if (freeze.approvedScreens.length > 1) {
    visual = resolveStitchScreenReference(runDir, state, screen).visual;
    if (capture) {
      const actual = new URL(capture.url), expected = new URL(screen.route, actual.origin);
      const width = Number(String(capture.viewport || '').split('x')[0]);
      const viewport = width < 768 ? 'mobile' : width < 1100 ? 'tablet' : 'desktop';
      if (!width || actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search || actual.hash !== expected.hash || viewport !== screen.viewport) throw new Error('formal capture does not match the selected Stitch screen route and viewport');
    }
  }
  return { screen, image: file, visual };
}

export function directDemoCapture(runDir, state, formalCapture) {
  const baseline = JSON.parse(fs.readFileSync(path.join(runDir, state.artifacts.runtimeVisualBaseline), 'utf8'));
  const actual = new URL(formalCapture.url);
  const route = url => `${url.pathname}${url.search}${url.hash}`;
  const matches = (baseline.screenCaptures || []).filter(item => {
    try { return route(new URL(item.url)) === route(actual) && item.viewport === formalCapture.viewport; } catch { return false; }
  });
  if (matches.length !== 1) throw new Error(`formal page needs one confirmed Demo capture with the same route and exact viewport; found ${matches.length}`);
  return matches[0];
}
export function resolveDirectImplementationReference(runDir, state, formalCapture) {
  const capture = directDemoCapture(runDir, state, formalCapture);
  const url = new URL(capture.url), width = Number(capture.viewport.split('x')[0]);
  const screen = { screenId: capture.id, route: `${url.pathname}${url.search}${url.hash}`, viewport: width < 768 ? 'mobile' : width < 1100 ? 'tablet' : 'desktop', state: 'initial', demoCapture: { kind: 'screen', id: capture.id } };
  const reference = resolveStitchScreenReference(runDir, state, screen);
  return { ...reference, image: path.resolve(runDir, capture.screenshot.path), capture };
}
