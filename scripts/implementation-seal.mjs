import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export function visualSourceCurrent(runDir, state) {
  if (state.roleChain?.confirmationModel !== 'two-confirmations') return true;
  try {
    const root = fs.realpathSync(runDir);
    const localFile = ref => {
      if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) throw new Error('invalid reference');
      const file = path.resolve(root, ref);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('unsafe reference');
      return file;
    };
    const bundle = JSON.parse(fs.readFileSync(localFile(state.artifacts?.visualBundle), 'utf8'));
    const source = bundle.visualSourceManifest;
    return source?.path === state.artifacts?.visualSourceManifest && /^sha256:[a-f0-9]{64}$/.test(source?.hash || '') && source.hash === `sha256:${sha(fs.readFileSync(localFile(source.path)))}`;
  } catch { return false; }
}
export function implementationSealCurrent(runDir, state, demoApproval) {
  try {
    if (!visualSourceCurrent(runDir, state)) return false;
    const refs = [demoApproval, state.artifacts?.visualBundle, state.artifacts?.implementationMap, state.artifacts?.implementationPresentation, state.artifacts?.implementationPresentationManifest];
    if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) return false;
    const seals = (state.gates?.gate2?.evidence || []).filter(ref => typeof ref === 'string' && /^machine-seals\/implementation-[a-f0-9]{64}\.json$/.test(ref));
    if (seals.length !== 1) return false;
    const root = fs.realpathSync(runDir);
    const localFile = ref => { const file = path.resolve(root, ref); if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('unsafe or missing artifact'); return file; };
    const seal = JSON.parse(fs.readFileSync(localFile(seals[0]), 'utf8'));
    if (seal.schemaVersion !== '3.0' || seal.type !== 'implementation-machine-seal' || seal.status !== 'validated' || seal.runId !== state.runId || seal.demoApproval !== demoApproval || !Array.isArray(seal.artifactHashes)) return false;
    if (seals[0] !== `machine-seals/implementation-${sha(JSON.stringify(seal.artifactHashes))}.json`) return false;
    if (seal.artifactHashes.length !== refs.length || new Set(seal.artifactHashes.map(item => item?.path)).size !== refs.length) return false;
    return refs.every(ref => { const item = seal.artifactHashes.find(record => record?.path === ref); return item && /^[a-f0-9]{64}$/.test(item.sha256 || '') && item.sha256 === sha(fs.readFileSync(localFile(ref))); });
  } catch { return false; }
}

// Recreate only the exact previously sealed artifact set; a changed input must
// be rebuilt and revalidated rather than silently receiving a new authority.
export function recoverImplementationSeal(runDir, state, demoApproval) {
  try {
    if (!visualSourceCurrent(runDir, state)) throw new Error('sealed visual source manifest is missing or changed');
    const refs = [demoApproval, state.artifacts?.visualBundle, state.artifacts?.implementationMap, state.artifacts?.implementationPresentation, state.artifacts?.implementationPresentationManifest];
    if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) throw new Error('implementation seal references are incomplete');
    const seals = (state.gates?.gate2?.evidence || []).filter(ref => typeof ref === 'string' && /^machine-seals\/implementation-[a-f0-9]{64}\.json$/.test(ref));
    if (seals.length !== 1) throw new Error('original implementation seal identity is missing or ambiguous');
    const root = fs.realpathSync(runDir);
    const hashes = refs.map(ref => {
      const file = path.resolve(root, ref);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error(`sealed artifact is missing or outside the run: ${ref}`);
      return { path: ref, sha256: sha(fs.readFileSync(file)) };
    });
    if (seals[0] !== `machine-seals/implementation-${sha(JSON.stringify(hashes))}.json`) throw new Error('sealed implementation artifacts have changed; restore or rebuild and revalidate them');
    const directory = path.join(root, 'machine-seals');
    if (!fs.existsSync(directory) || fs.realpathSync(directory) !== directory) throw new Error('machine seal directory is missing or unsafe');
    const file = path.join(root, seals[0]);
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file)) throw new Error('machine seal path is unsafe');
    const temp = path.join(directory, `.recover-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schemaVersion: '3.0', type: 'implementation-machine-seal', status: 'validated', runId: state.runId, demoApproval, artifactHashes: hashes, recoveredAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
      fs.renameSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
    if (!implementationSealCurrent(runDir, state, demoApproval)) throw new Error('recovered implementation seal failed verification');
    return { status: 'recovered', seal: seals[0] };
  } catch (error) { return { status: 'failed', reason: error.message }; }
}
