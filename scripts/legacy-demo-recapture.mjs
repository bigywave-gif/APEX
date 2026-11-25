/** Validate supplemental observations without replacing the user's approved evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { demoHash, interactionSource, observedControlCoverageStatus, verifyDemoInteractions } from './interactive-demo.mjs';

const requireFact = (condition, message) => { if (!condition) throw new Error(`Legacy Demo recapture: ${message}`); };
const location = value => { const url = new URL(value); return `${url.pathname}${url.search}${url.hash}`; };
function localHash(runDir, reference, expected) {
  requireFact(typeof reference === 'string' && reference && !path.isAbsolute(reference), 'invalid evidence reference');
  const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, reference));
  requireFact(file.startsWith(`${root}${path.sep}`) && fs.statSync(file).isFile(), 'evidence is outside the Run');
  requireFact(demoHash(fs.readFileSync(file)) === expected, `evidence changed: ${reference}`);
}

// This checks content compatibility only. Callers must separately verify the
// original approval and the controlled operation receipt before granting authority.
export function validateLegacyDemoRecapture(runDir, original, recapture) {
  const source = interactionSource(runDir), oldDemo = original?.interactiveDemo, nextDemo = recapture?.interactiveDemo;
  requireFact(original?.status === 'passed' && oldDemo?.status === 'passed', 'original capture was not passed');
  requireFact(oldDemo.contractHash === source.contractHash && oldDemo.sourceManifestHash === source.sourceManifestHash, 'original source or interaction contract changed');
  const oldBase = new URL(oldDemo?.url), base = new URL(nextDemo?.url);
  const validBase = url => url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  requireFact(validBase(oldBase) && validBase(base), 'both captures must use a loopback Demo root');
  const verified = verifyDemoInteractions(runDir, recapture, base.href, { requireJourneyLocation: true });
  const coverage = observedControlCoverageStatus(verified.controlCoverage, { requireScreens: true });
  requireFact(coverage.ready, `observed controls are incomplete: ${coverage.reason}`);
  requireFact(Array.isArray(original.evidence) && original.evidence.length > 0 && Array.isArray(recapture.evidence) && recapture.evidence.length === original.evidence.length, 'screen coverage changed');
  const ids = new Set();
  for (const screen of original.evidence) {
    const matches = recapture.evidence.filter(item => item.id === screen.id);
    requireFact(typeof screen.id === 'string' && screen.id && !ids.has(screen.id) && matches.length === 1, 'missing or duplicate screen');
    ids.add(screen.id);
    const next = matches[0];
    requireFact(typeof screen.route === 'string' && screen.route.startsWith('/') && !screen.route.startsWith('//') && !screen.route.includes('\\'), `screen route is unsafe: ${screen.id}`);
    requireFact(screen.status === 'captured' && next.status === 'captured' && screen.route === next.route && screen.viewport === next.viewport && screen.url === new URL(screen.route, oldBase).href && location(screen.url) === location(next.url), `screen route or viewport changed: ${screen.id}`);
    requireFact(new URL(next.url).origin === base.origin, `screen origin changed: ${screen.id}`);
    for (const item of [screen, next]) { localHash(runDir, item.screenshot, item.screenshotSha256); localHash(runDir, item.domHtml, item.domSha256); }
  }
  requireFact(Array.isArray(oldDemo.journeys) && oldDemo.journeys.length === source.contract.journeys.length, 'original journey coverage changed');
  const journeyIds = new Set();
  for (const old of oldDemo.journeys) {
    const matches = nextDemo.journeys.filter(item => item.id === old.id), expected = source.contract.journeys.find(item => item.id === old.id);
    requireFact(expected && !journeyIds.has(old.id) && matches.length === 1, 'missing or duplicate journey');
    journeyIds.add(old.id);
    const next = matches[0];
    requireFact(old.status === 'passed' && old.noticeVisible === true && Array.isArray(old.blockedRequests) && !old.blockedRequests.length && old.url === new URL(expected.route, oldBase).href && new URL(old.finalUrl).origin === oldBase.origin && location(old.url) === location(next.url) && location(old.finalUrl) === location(next.finalUrl) && old.viewport === next.viewport, `journey location or viewport changed: ${old.id}`);
    requireFact(Array.isArray(old.steps) && old.steps.length === expected.steps.length && old.steps.every((item, index) => item.passed === true && item.action === expected.steps[index].action && item.selector === expected.steps[index].selector && item.before === expected.steps[index].before.equals && item.after === expected.steps[index].after.equals), `original journey changed: ${old.id}`);
    for (const item of [old.screenshot, old.dom]) localHash(runDir, item?.path, item?.sha256);
  }
  return { status: 'compatible', contractHash: source.contractHash, sourceManifestHash: source.sourceManifestHash, screens: ids.size, journeys: journeyIds.size, controlCoverage: coverage };
}
