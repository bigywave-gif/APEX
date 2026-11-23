import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateVisualOutputSource, validateRuntimeMotionSamples } from './runtime-baseline-contract.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-baseline-contract-'));
try {
  const ref = { referenceImage: { path: 'demo.png', sha256: 'sha256:demo' } }, baseline = { referenceImage: ref.referenceImage, motionSamples: [] };
  const modern = { roleChain: { confirmationModel: 'two-confirmations' } }, legacy = { roleChain: { confirmationModel: 'gate-summary-only' } };
  fs.writeFileSync(path.join(root, 'demo.png'), 'demo');
  validateVisualOutputSource(root, modern, { source: 'runtime-visual-baseline', referenceImage: { path: path.join(fs.realpathSync(root), 'demo.png') } }, ref, baseline);
  validateVisualOutputSource(root, modern, { source: 'runtime-visual-baseline', referenceImage: { path: 'demo.png' } }, ref, baseline);
  validateVisualOutputSource(root, legacy, { source: 'gate1-visual', referenceImage: { path: 'demo.png' } }, ref, baseline);
  assert.throws(() => validateVisualOutputSource(root, legacy, { source: 'runtime-visual-baseline', referenceImage: { path: 'demo.png' } }, ref, baseline), /source/);
  assert.throws(() => validateVisualOutputSource(root, modern, { source: 'runtime-visual-baseline', referenceImage: { path: 'other.png' } }, ref, baseline), /image/);
  assert.throws(() => validateVisualOutputSource(root, modern, { source: 'runtime-visual-baseline', referenceImage: { path: 'demo.png' } }, ref, { referenceImage: { path: 'demo.png', sha256: 'sha256:changed' } }), /baseline/);
  validateRuntimeMotionSamples(root, baseline, { sourceSelections: [], motion: [] });
  assert.throws(() => validateRuntimeMotionSamples(root, baseline, { sourceSelections: [{ kind: 'motion' }] }), /two captured frames/);
  const sample = (name, bytes) => { fs.writeFileSync(path.join(root, name), bytes); return { screenshot: name, frameSha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` }; };
  const first = sample('a.png', 'frame a'), second = sample('b.png', 'frame b');
  validateRuntimeMotionSamples(root, { motionSamples: [first, second] }, { motion: [{ id: 'intro' }] });
  assert.throws(() => validateRuntimeMotionSamples(root, { motionSamples: [first, first] }, { motion: [{ id: 'intro' }] }), /identical/);
  fs.writeFileSync(path.join(root, 'b.png'), 'changed');
  assert.throws(() => validateRuntimeMotionSamples(root, { motionSamples: [first, second] }, { motion: [{ id: 'intro' }] }), /hash/);
  console.log(JSON.stringify({ status: 'passed', checks: 10 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
