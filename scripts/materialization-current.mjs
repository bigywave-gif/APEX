import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
function localFile(root, ref) {
  if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) throw new Error('materialized source path is invalid');
  const target = path.resolve(root, ref);
  if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.realpathSync(target).startsWith(`${root}${path.sep}`) || !fs.statSync(target).isFile()) throw new Error(`materialized source is missing or outside its root: ${ref}`);
  return target;
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const requireHash = (file, expected) => {
  if (!/^sha256:[a-f0-9]{64}$/.test(expected || '') || sha(file) !== expected) throw new Error(`materialized source changed: ${file}`);
};

export function assertMaterializationCurrent(runDir, projectDir, state, plan) {
  const runRoot = fs.realpathSync(runDir), projectRoot = fs.realpathSync(projectDir);
  if (!Array.isArray(plan?.sourceSelections)) throw new Error('visual source selections are missing');
  const selected = plan.sourceSelections;
  const staticSelections = selected.filter(item => ['inline-transfer', 'generated-source'].includes(item.materialization));
  if (staticSelections.length) {
    const manifest = read(localFile(runRoot, state.artifacts?.materializedAssets));
    const visualSources = read(localFile(runRoot, state.artifacts?.visualSourceManifest));
    if (!Array.isArray(manifest.assets)) throw new Error('materialized asset manifest is invalid');
    for (const selection of staticSelections) {
      const assets = manifest.assets.filter(item => item.selectionId === selection.id);
      if (!assets.length) throw new Error(`materialized asset selection is missing: ${selection.id}`);
      if (selection.sourceType === 'approved-candidate') {
        const source = (visualSources.sources || []).find(item => item.planSourceSelectionId === selection.id);
        const expected = (source?.resolvedFiles || []).filter(item => item.role !== 'package-manifest');
        if (!expected.length || assets.length !== expected.length || expected.some(file => !assets.some(asset => asset.sourceHash === file.sha256))) throw new Error(`materialized asset differs from the selected source: ${selection.id}`);
      }
      for (const asset of assets) {
        if (asset.sourceHash !== asset.storedHash) throw new Error(`materialized asset hash binding changed: ${selection.id}`);
        requireHash(localFile(runRoot, asset.storedPath), asset.storedHash);
        requireHash(localFile(projectRoot, asset.projectPath), asset.storedHash);
      }
    }
  }
  const runtimeSelections = selected.filter(item => item.materialization === 'runtime-package');
  if (runtimeSelections.length) {
    const lock = read(localFile(runRoot, state.artifacts?.runtimeSourceLock));
    if (!lock.projectRoot || fs.realpathSync(lock.projectRoot) !== projectRoot || !Array.isArray(lock.patterns)) throw new Error('runtime source lock does not belong to this project');
    for (const selection of runtimeSelections) {
      const patterns = lock.patterns.filter(item => item.sourceSelectionId === selection.id);
      if (!patterns.length) throw new Error(`runtime source selection is missing: ${selection.id}`);
      for (const pattern of patterns) {
        if (pattern.package !== selection.sourceId || pattern.version !== selection.version || !Array.isArray(pattern.files) || !pattern.files.length) throw new Error(`runtime source binding changed: ${selection.id}`);
        for (const file of pattern.files) requireHash(localFile(projectRoot, file.path), file.sha256);
        if (typeof pattern.package !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pattern.package)) throw new Error('runtime package name is invalid');
        const packageJson = read(localFile(projectRoot, `node_modules/${pattern.package}/package.json`));
        if (packageJson.version !== pattern.version) throw new Error(`runtime package version changed: ${pattern.package}`);
      }
    }
  }
}
