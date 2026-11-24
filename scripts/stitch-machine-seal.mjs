import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const digest = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

export function stitchMachineSealCurrent(runDir, state) {
  try {
    const root = fs.realpathSync(runDir);
    const local = ref => {
      if (typeof ref !== 'string' || !ref) throw new Error('missing reference');
      const file = path.resolve(root, ref);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('unsafe reference');
      return fs.readFileSync(file);
    };
    const ref = state.artifacts?.stitchMachineSeal;
    if (!/^machine-seals\/stitch-[a-f0-9]{64}\.json$/.test(ref || '')) return false;
    const bytes = local(ref), receipt = JSON.parse(bytes);
    if (ref !== `machine-seals/stitch-${digest(bytes).slice(7)}.json` || receipt.schemaVersion !== '3.0' || receipt.type !== 'stitch-machine-seal' || receipt.status !== 'validated' || receipt.runId !== state.runId) return false;
    if (receipt.freeze?.path !== state.artifacts.stitchFreeze || receipt.parity?.path !== state.artifacts.stitchParityEvidence) return false;
    if ([receipt.freeze, receipt.parity].some(item => digest(local(item.path)) !== item.sha256)) return false;
    if (!Array.isArray(receipt.inputs) || !receipt.inputs.length || receipt.inputs.some(item => digest(local(item.path)) !== item.sha256)) return false;
    return !receipt.screens || Array.isArray(receipt.screens) && receipt.screens.every(screen => digest(local(screen.evidence)) === screen.sha256 && digest(local(screen.reference)) === screen.referenceHash);
  } catch { return false; }
}

export function stitchMachineSealRequired(state) {
  return state.roleChain?.confirmationModel === 'two-confirmations' && !state.locks?.stitchSkipped && /^evidence\/stitch\/freezes\/stitch-freeze-[a-f0-9]{64}\.json$/.test(state.artifacts?.stitchFreeze || '');
}
