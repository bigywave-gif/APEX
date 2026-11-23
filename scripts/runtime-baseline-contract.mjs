import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function validateVisualOutputSource(runDir, state, output, reference, baseline) {
  const runtimeSource = state.roleChain?.confirmationModel === 'two-confirmations' && output.source === 'runtime-visual-baseline';
  if (output.source !== 'gate1-visual' && !runtimeSource) throw new Error('visual output source is not valid for this confirmation model');
  const root = fs.realpathSync(runDir);
  const image = value => {
    if (typeof value !== 'string' || !value) return null;
    const file = path.resolve(runDir, value);
    if (!fs.existsSync(file)) return null;
    const actual = fs.realpathSync(file);
    return actual.startsWith(`${root}${path.sep}`) && fs.statSync(actual).isFile() ? actual : null;
  };
  const referenceImage = image(reference.referenceImage?.path);
  if (!referenceImage || image(output.referenceImage?.path) !== referenceImage) throw new Error('visual output image does not match Visual Reference');
  if (runtimeSource && (baseline.referenceImage?.sha256 !== reference.referenceImage.sha256 || image(baseline.referenceImage?.path) !== referenceImage)) throw new Error('runtime visual output does not match the frozen Demo baseline');
}
export function validateRuntimeMotionSamples(runDir, baseline, visualPlan) {
  const samples = baseline.motionSamples || [];
  const required = (visualPlan.motion || []).length > 0 || (visualPlan.sourceSelections || []).some(item => item.kind === 'motion');
  if (!required && samples.length === 0) return;
  if (samples.length < 2) throw new Error('runtime motion needs at least two captured frames');
  const root = fs.realpathSync(runDir), seen = new Set();
  for (const sample of samples) {
    const file = path.resolve(runDir, sample.screenshot || '');
    if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error('runtime motion frame is missing or outside the run');
    const hash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
    if (hash !== sample.frameSha256) throw new Error('runtime motion frame hash does not match its captured bytes');
    seen.add(hash);
  }
  if (seen.size < 2) throw new Error('runtime motion frames are identical');
}
