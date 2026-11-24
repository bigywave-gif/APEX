import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendLedgerEvent, archiveArtifacts } from './run-ledger.mjs';

// Preserve the exact previous bytes before retiring the ledger registration.
export function preserveRoleManifest(runDir, reference, epochDirectory, reason) {
  const root = fs.realpathSync(runDir), source = path.resolve(root, reference || ''), relativeEpoch = path.relative(path.resolve(runDir), path.resolve(epochDirectory)), epoch = path.resolve(root, relativeEpoch);
  if (!reference || path.isAbsolute(reference) || !source.startsWith(`${root}${path.sep}`) || !fs.existsSync(source) || !fs.realpathSync(source).startsWith(`${root}${path.sep}`) || !fs.statSync(source).isFile()) throw new Error('role manifest must be a Run-local regular file');
  if (path.dirname(epoch) !== path.join(root, 'invalidated')) throw new Error('role manifest archive must be a Run-local invalidation epoch');
  fs.mkdirSync(epoch, { recursive: true });
  const archiveRoot = fs.realpathSync(path.join(root, 'invalidated'));
  if (!archiveRoot.startsWith(`${root}${path.sep}`) || !fs.realpathSync(epoch).startsWith(`${archiveRoot}${path.sep}`)) throw new Error('role manifest archive escapes the Run');
  const target = path.join(epoch, 'role-advisory-manifest.json'), content = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    if (!fs.lstatSync(target).isFile() || !fs.readFileSync(target).equals(content)) throw new Error('role manifest archive conflicts with the current version');
  } else {
    const fd = fs.openSync(target, 'wx');
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  if (!fs.readFileSync(source).equals(content)) throw new Error('role manifest changed while being archived');
  const sha256 = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  appendLedgerEvent(runDir, { type: 'role-manifest-preserved', reference, archive: path.relative(root, target), sha256, reason });
  archiveArtifacts(runDir, [reference], reason, { expectedHashes: { [reference]: sha256 } });
  return { archive: path.relative(root, target), sha256 };
}
