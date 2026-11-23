import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function assertDesignContractCurrent(runDir, projectDir, contract) {
  if (!contract || typeof contract.path !== 'string' || !contract.path.trim() || !/^sha256:[a-f0-9]{64}$/.test(contract.sha256 || '')) throw new Error('design contract needs a path and SHA-256');
  const roots = [...new Set([fs.realpathSync(runDir), fs.realpathSync(projectDir)])];
  const requested = path.isAbsolute(contract.path) ? [path.resolve(contract.path)] : roots.map(root => path.resolve(root, contract.path));
  const files = [...new Set(requested)].filter(file => fs.existsSync(file));
  if (!files.length) throw new Error('design contract file is missing');
  const hashes = files.map(file => {
    const real = fs.realpathSync(file);
    if (!roots.some(root => file.startsWith(`${root}${path.sep}`) && real.startsWith(`${root}${path.sep}`)) || !fs.statSync(file).isFile()) throw new Error('design contract is outside the current run or project');
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  });
  if (hashes.some(value => value !== contract.sha256)) throw new Error('design contract file is changed or ambiguous');
  return { sha256: contract.sha256 };
}
