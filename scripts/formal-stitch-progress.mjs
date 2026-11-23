import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveImplementationReference } from './implementation-reference.mjs';
import { evidenceFor, pass } from './structure-evidence.mjs';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'hash').sort().map(key => [key, canonical(value[key])])) : value;
export function formalStitchProgress(runDir, state, receipts) {
  try {
    if (state.roleChain?.confirmationModel !== 'two-confirmations' || state.locks?.stitchSkipped) return { status: 'not-required' };
    const freeze = JSON.parse(fs.readFileSync(path.join(runDir, state.artifacts.stitchFreeze), 'utf8'));
    if (freeze.approvedScreens.length < 2) return { status: 'not-required' };
    const captureRef = 'evidence/runtime-browser-capture.json', captureFile = path.join(runDir, captureRef);
    if (!fs.existsSync(captureFile)) return { status: 'missing-capture', reason: 'formal browser capture is missing' };
    const capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
    if (capture.status !== 'passed' || !(receipts || []).some(item => item.action === 'verify' && item.status === 'succeeded' && path.basename(item.script || '') === 'browser-capture.mjs' && item.outputFileHashes?.[captureRef] === hash(captureFile))) return { status: 'missing-capture', reason: 'current formal browser capture has no successful verify receipt' };
    const root = fs.realpathSync(runDir), inside = file => fs.existsSync(file) && fs.realpathSync(file).startsWith(`${root}${path.sep}`);
    for (const screen of freeze.approvedScreens) {
      const matches = (capture.evidence || []).filter(item => {
        if (item.status !== 'captured') return false;
        try { resolveImplementationReference(runDir, state, { kind: 'stitch', screenId: screen.screenId, imageHash: screen.imageHash }, item); return true; } catch { return false; }
      });
      if (matches.length !== 1) return { status: 'missing-capture', screenId: screen.screenId, reason: `expected one matching formal capture, found ${matches.length}` };
      const item = matches[0], image = path.resolve(runDir, item.screenshot || ''), html = path.resolve(runDir, item.domHtml || '');
      if (!inside(image) || !inside(html) || hash(image) !== item.screenshotSha256 || hash(html) !== item.domSha256) return { status: 'missing-capture', screenId: screen.screenId, reason: 'formal screenshot or DOM changed' };
      const key = crypto.createHash('sha256').update(screen.screenId).digest('hex'), ref = `evidence/parity/implementation-result-${key}.json`, file = path.join(runDir, ref);
      if (!inside(file)) return { status: 'pending', screenId: screen.screenId, captureId: item.id };
      try {
        const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
        const contractFile = path.resolve(runDir, proof.structuralVerification?.contractPath || '');
        if (!inside(contractFile) || hash(contractFile) !== proof.structuralVerification?.contractHash) throw new Error('formal structure evidence changed');
        const structure = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
        const selected = resolveImplementationReference(runDir, state, { kind: 'stitch', screenId: screen.screenId, imageHash: screen.imageHash }, item);
        if (proof.status !== 'passed' || !proof.strictPixelMatch || !Array.isArray(proof.unmatched) || proof.unmatched.length || !['content', 'layout', 'analytics', 'style'].every(key => proof.checks?.[key] === 'passed') || proof.captureId !== item.id || proof.screenId !== screen.screenId || proof.runtimeImageHash !== item.screenshotSha256 || proof.baseline?.screenId !== screen.screenId || proof.baseline?.imageHash !== screen.imageHash || proof.structuralVerification?.source !== 'runtime-dom-export' || structure.source !== 'runtime-dom-export' || structure.sourceImageHash !== item.screenshotSha256 || structure.verification?.status !== 'passed' || structure.verification?.inputs?.htmlHash !== item.domSha256) throw new Error('formal page comparison is stale or incomplete');
        if (!pass(evidenceFor(selected.visual, fs.readFileSync(html, 'utf8'))) || !['contentLock', 'layoutLock', 'analyticsLock', 'designTokens', 'componentContracts'].every(key => JSON.stringify(canonical(structure[key])) === JSON.stringify(canonical(selected.visual[key])))) throw new Error('formal DOM no longer satisfies the page reference');
        if (!(receipts || []).some(record => record.status === 'succeeded' && record.action === 'verify' && path.basename(record.script || '') === 'strict-replica.mjs' && record.outputFileHashes?.[ref] === hash(file))) throw new Error('formal comparison has no current successful receipt');
      } catch (error) { return { status: 'pending', screenId: screen.screenId, captureId: item.id, reason: error.message }; }
    }
    return { status: 'ready', count: freeze.approvedScreens.length };
  } catch (error) { return { status: 'incomplete', reason: error.message }; }
}
