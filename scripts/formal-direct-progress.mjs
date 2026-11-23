import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { directDemoCapture, resolveDirectImplementationReference } from './implementation-reference.mjs';
import { evidenceFor, pass } from './structure-evidence.mjs';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const route = text => { const url = new URL(text); return `${url.pathname}${url.search}${url.hash}`; };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'hash').sort().map(key => [key, canonical(value[key])])) : value;
export function formalDirectProgress(runDir, state, receipts) {
  try {
    if (state.roleChain?.confirmationModel !== 'two-confirmations' || !state.locks?.stitchSkipped) return { status: 'not-required' };
    const baseline = JSON.parse(fs.readFileSync(path.join(runDir, state.artifacts.runtimeVisualBaseline), 'utf8'));
    const expected = baseline.screenCaptures || [];
    if (expected.length < 2) return { status: 'not-required' };
    const captureRef = 'evidence/runtime-browser-capture.json', captureFile = path.join(runDir, captureRef);
    if (!fs.existsSync(captureFile)) return { status: 'missing-capture', reason: 'formal browser capture is missing' };
    const capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
    if (capture.status !== 'passed' || !(receipts || []).some(item => item.action === 'verify' && item.status === 'succeeded' && path.basename(item.script || '') === 'browser-capture.mjs' && item.outputFileHashes?.[captureRef] === hash(captureFile))) return { status: 'missing-capture', reason: 'formal capture lacks a current successful verify receipt' };
    const root = fs.realpathSync(runDir), inside = file => fs.existsSync(file) && fs.realpathSync(file).startsWith(`${root}${path.sep}`);
    for (const confirmed of expected) {
      const expectedRoute = route(confirmed.url);
      const matches = (capture.evidence || []).filter(item => { try { return item.status === 'captured' && route(item.url) === expectedRoute && item.viewport === confirmed.viewport && directDemoCapture(runDir, state, item).id === confirmed.id; } catch { return false; } });
      if (!matches.length) return { status: 'missing-capture', reason: `no formal capture matches confirmed route and viewport: ${expectedRoute} ${confirmed.viewport}` };
      const item = matches[0], demo = directDemoCapture(runDir, state, item), image = path.resolve(runDir, item.screenshot || ''), html = path.resolve(runDir, item.domHtml || '');
      if (!inside(image) || !inside(html) || hash(image) !== item.screenshotSha256 || hash(html) !== item.domSha256) return { status: 'missing-capture', reason: `formal screenshot or DOM changed: ${expectedRoute}` };
      let selected; try { selected = resolveDirectImplementationReference(runDir, state, item); } catch (error) { return { status: 'missing-reference', captureId: item.id, demoCaptureId: demo.id, reason: error.message }; }
      const key = crypto.createHash('sha256').update(demo.id).digest('hex'), ref = `evidence/parity/implementation-result-${key}.json`, file = path.join(runDir, ref);
      if (!inside(file)) return { status: 'pending', captureId: item.id, demoCaptureId: demo.id };
      try {
        const proof = JSON.parse(fs.readFileSync(file, 'utf8')), contractFile = path.resolve(runDir, proof.structuralVerification?.contractPath || '');
        if (!inside(contractFile) || hash(contractFile) !== proof.structuralVerification?.contractHash) throw new Error('formal structure evidence changed');
        const structure = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
        if (proof.status !== 'passed' || !proof.strictPixelMatch || !Array.isArray(proof.unmatched) || proof.unmatched.length || !['content', 'layout', 'analytics', 'style'].every(key => proof.checks?.[key] === 'passed') || proof.captureId !== item.id || proof.screenId !== demo.id || proof.runtimeImageHash !== item.screenshotSha256 || proof.baseline?.kind !== 'effect-image' || proof.baseline?.screenId !== demo.id || proof.baseline?.imageHash !== demo.screenshot.sha256 || proof.structuralVerification?.source !== 'runtime-dom-export' || structure.source !== 'runtime-dom-export' || structure.sourceImageHash !== item.screenshotSha256 || structure.verification?.status !== 'passed' || structure.verification?.inputs?.htmlHash !== item.domSha256) throw new Error('formal page comparison is stale or incomplete');
        if (!pass(evidenceFor(selected.visual, fs.readFileSync(html, 'utf8'))) || !['contentLock', 'layoutLock', 'analyticsLock', 'designTokens', 'componentContracts'].every(key => JSON.stringify(canonical(structure[key])) === JSON.stringify(canonical(selected.visual[key])))) throw new Error('formal DOM no longer satisfies the page reference');
        if (!(receipts || []).some(record => record.status === 'succeeded' && record.action === 'verify' && path.basename(record.script || '') === 'strict-replica.mjs' && record.outputFileHashes?.[ref] === hash(file))) throw new Error('formal comparison has no current successful receipt');
      } catch (error) { return { status: 'pending', captureId: item.id, demoCaptureId: demo.id, reason: error.message }; }
    }
    return { status: 'ready', count: expected.length };
  } catch (error) { return { status: 'incomplete', reason: error.message }; }
}
