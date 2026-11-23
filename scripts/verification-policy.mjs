import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function controlledOutput(runDir, reference, scripts, inputReferences = []) {
  try {
    if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) return false;
    const root = fs.realpathSync(runDir), target = fs.realpathSync(path.resolve(root, reference));
    if (!target.startsWith(`${root}${path.sep}`) || !fs.statSync(target).isFile()) return false;
    const inputs = new Map(inputReferences.map(ref => {
      if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) throw new Error('invalid input reference');
      const file = fs.realpathSync(path.resolve(root, ref));
      if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('input outside Run');
      return [ref, hash(file)];
    }));
    const operations = path.join(root, 'operations'), digest = hash(target);
    if (!fs.realpathSync(operations).startsWith(`${root}${path.sep}`)) return false;
    return fs.readdirSync(operations).filter(name => name.endsWith('.json')).some(name => {
      try {
        const receiptPath = fs.realpathSync(path.join(operations, name));
        if (!receiptPath.startsWith(`${fs.realpathSync(operations)}${path.sep}`)) return false;
        const receipt = JSON.parse(fs.readFileSync(receiptPath));
        return receipt.status === 'succeeded' && receipt.action === 'verify' && scripts.includes(path.basename(receipt.script || '')) && receipt.outputFileHashes?.[reference] === digest && [...inputs].every(([ref, digest]) => receipt.inputFileHashes?.[ref] === digest);
      } catch { return false; }
    });
  } catch { return false; }
}
export function declaredVerificationCommand(check, inventory, manifest) {
  const match = /^npm run ([A-Za-z0-9:_-]+)$/.exec(check.command || '');
  if (!match || !manifest?.scripts || typeof manifest.scripts[match[1]] !== 'string') return false;
  if (manifest.scripts[match[1]] !== inventory.scripts?.[match[1]]) return false;
  return (inventory.testCommands || []).some(item => item.id === check.id && item.command === check.command);
}
