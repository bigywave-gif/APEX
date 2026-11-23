import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveStitchScreenReference } from './stitch-screen-binding.mjs';
import { evidenceFor, pass } from './structure-evidence.mjs';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function stitchScreenProgress(runDir, state, freeze, records) {
  const screens = freeze.approvedScreens || [];
  const ids = screens.map(screen => screen.screenId);
  if (!ids.length || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return { status: 'invalid', reason: 'Stitch screen IDs are missing or duplicated' };
  const verified = [];
  for (const screen of screens) {
    let reference;
    try { reference = resolveStitchScreenReference(runDir, state, screen); }
    catch (error) { return { status: 'missing-reference', screenId: screen.screenId, reason: error.message }; }
    const key = crypto.createHash('sha256').update(screen.screenId).digest('hex');
    const ref = `evidence/parity/stitch-result-${key}.json`, file = path.join(runDir, ref);
    if (!fs.existsSync(file)) return { status: 'pending', screenId: screen.screenId, evidence: ref };
    let proof;
    try {
      proof = JSON.parse(fs.readFileSync(file, 'utf8'));
      const image = path.resolve(runDir, screen.imagePath), html = path.resolve(runDir, screen.htmlPath), contract = path.resolve(runDir, proof.structuralVerification?.contractPath || '');
      const inRun = file => fs.existsSync(file) && fs.realpathSync(file).startsWith(`${fs.realpathSync(runDir)}${path.sep}`);
      if (!inRun(image) || !inRun(html) || !inRun(contract) || hash(image) !== screen.imageHash || hash(html) !== screen.htmlHash || hash(contract) !== proof.structuralVerification?.contractHash) throw new Error('screen evidence changed');
      const structure = JSON.parse(fs.readFileSync(contract, 'utf8'));
      if (proof.screenId !== screen.screenId || proof.referenceScope !== 'confirmed-demo-screen' || proof.referenceImageHash !== reference.visual.referenceImage.sha256 || proof.stitchImageHash !== screen.imageHash || proof.visualReference?.sha256 !== reference.sha256 || proof.visualReference?.path !== reference.path || JSON.stringify(proof.demoBinding) !== JSON.stringify(reference.binding) || structure.source !== 'stitch-screen-export' || structure.sourceImageHash !== screen.imageHash || structure.verification?.inputs?.screenId !== screen.screenId || structure.verification?.inputs?.htmlHash !== screen.htmlHash) throw new Error('screen evidence binding is stale');
      if (!(records || []).some(record => record.status === 'succeeded' && record.action === 'sync_stitch' && path.basename(record.script || '') === 'strict-replica.mjs' && record.outputFileHashes?.[ref] === hash(file))) throw new Error('controlled screen comparison receipt is missing');
      if (proof.status !== 'passed' || !proof.strictPixelMatch || !Array.isArray(proof.unmatched) || proof.unmatched.length || !['content', 'layout', 'analytics', 'style'].every(key => proof.checks?.[key] === 'passed') || structure.verification?.status !== 'passed') throw new Error('screen comparison has not passed');
      if (!pass(evidenceFor(reference.visual, fs.readFileSync(html, 'utf8')))) throw new Error('Stitch HTML no longer satisfies the page reference');
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'hash').sort().map(key => [key, canonical(value[key])])) : value;
      if (!['contentLock', 'layoutLock', 'analyticsLock', 'designTokens', 'componentContracts'].every(key => JSON.stringify(canonical(structure[key])) === JSON.stringify(canonical(reference.visual[key])))) throw new Error('Stitch structure contract differs from the page reference');
      verified.push({ screenId: screen.screenId, evidence: ref, sha256: hash(file), reference: reference.path, referenceHash: reference.sha256, imageHash: reference.visual.referenceImage.sha256 });
    } catch (error) { return { status: 'pending', screenId: screen.screenId, evidence: ref, reason: error.message }; }
  }
  return { status: 'ready', count: screens.length, screens: verified };
}

export function validateMultiStitch(runDir, state, freeze, reference) {
  const operations = path.join(runDir, 'operations');
  const records = fs.existsSync(operations) ? fs.readdirSync(operations).filter(name => name.endsWith('.json')).flatMap(name => { try { return [JSON.parse(fs.readFileSync(path.join(operations, name), 'utf8'))]; } catch { return []; } }) : [];
  const progress = stitchScreenProgress(runDir, state, freeze, records);
  if (progress.status !== 'ready') throw new Error(`multi-screen Stitch evidence incomplete: ${progress.screenId || ''} ${progress.reason || progress.status}`);
  const input = freeze.generationInput;
  if (input?.origin !== 'apex-visual' || !input.references?.some(item => item.sha256 === reference.referenceImage.sha256) || input.contentLock?.sourceHash !== reference.contentLock.hash || input.layoutLock?.sourceHash !== reference.layoutLock.hash || input.analyticsLock?.sourceHash !== reference.analyticsLock.hash || progress.screens.some(screen => !input.references.some(item => item.sha256 === screen.imageHash))) throw new Error('Stitch input does not bind every confirmed Demo screen and global visual locks');
  return progress;
}
