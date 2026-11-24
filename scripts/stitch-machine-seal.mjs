import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stitchSealRecoveryRecord } from './run-ledger.mjs';

const digest = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function validSeal(runDir, state, bytes) {
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
    const receipt = JSON.parse(bytes);
    if (ref !== `machine-seals/stitch-${digest(bytes).slice(7)}.json` || receipt.schemaVersion !== '3.0' || receipt.type !== 'stitch-machine-seal' || receipt.status !== 'validated' || receipt.runId !== state.runId) return false;
    if (receipt.freeze?.path !== state.artifacts.stitchFreeze || receipt.parity?.path !== state.artifacts.stitchParityEvidence) return false;
    if ([receipt.freeze, receipt.parity].some(item => digest(local(item.path)) !== item.sha256)) return false;
    if (!Array.isArray(receipt.inputs) || !receipt.inputs.length || receipt.inputs.some(item => digest(local(item.path)) !== item.sha256)) return false;
    return !receipt.screens || Array.isArray(receipt.screens) && receipt.screens.every(screen => digest(local(screen.evidence)) === screen.sha256 && digest(local(screen.reference)) === screen.referenceHash);
  } catch { return false; }
}

export function stitchMachineSealCurrent(runDir, state) {
  try {
    const root = fs.realpathSync(runDir), ref = state.artifacts?.stitchMachineSeal;
    if (!/^machine-seals\/stitch-[a-f0-9]{64}\.json$/.test(ref || '')) return false;
    const file = path.join(root, ref);
    if (!fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) return false;
    return validSeal(runDir, state, fs.readFileSync(file));
  }
  catch { return false; }
}

export function recoverStitchMachineSeal(runDir, state) {
  const ref = state.artifacts?.stitchMachineSeal;
  if (!/^machine-seals\/stitch-[a-f0-9]{64}\.json$/.test(ref || '')) return { status: 'refused', reason: 'committed seal reference is missing' };
  const root = fs.realpathSync(runDir), directory = path.join(root, 'machine-seals'), file = path.join(root, ref);
  if (fs.existsSync(file)) return { status: 'refused', reason: 'existing seal is changed or bound evidence is stale' };
  const record = stitchSealRecoveryRecord(runDir, ref);
  if (typeof record?.content !== 'string') return { status: 'refused', reason: 'original seal content is not recorded in the ledger' };
  const bytes = Buffer.from(record.content);
  if (!validSeal(runDir, state, bytes)) return { status: 'refused', reason: 'original seal or bound evidence is missing or changed' };
  if (!fs.existsSync(directory) || fs.realpathSync(directory) !== directory) return { status: 'refused', reason: 'seal directory is missing or unsafe' };
  const temporary = path.join(directory, `.recover-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    try { fs.linkSync(temporary, file); }
    catch (error) { if (error.code !== 'EEXIST' || !fs.readFileSync(file).equals(bytes)) throw error; }
  } finally { fs.rmSync(temporary, { force: true }); }
  if (!stitchMachineSealCurrent(runDir, state)) return { status: 'refused', reason: 'restored seal or bound evidence changed during recovery' };
  return { status: 'recovered', seal: ref };
}

export function stitchMachineSealRequired(state) {
  return state.roleChain?.confirmationModel === 'two-confirmations' && !state.locks?.stitchSkipped && /^evidence\/stitch\/freezes\/stitch-freeze-[a-f0-9]{64}\.json$/.test(state.artifacts?.stitchFreeze || '');
}
