import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
// Legacy Runs retain their original contract; current Runs must bind each
// receipt to the artifact registered by that exact authorized operation.
export function ledgerBoundOutput(runDir, receipt, reference, digest, required = undefined) {
  try {
    const root = fs.realpathSync(runDir);
    const stateFile = path.join(root, 'state.json');
    const projection = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    const ledgerFile = path.join(root, 'run-ledger.sqlite');
    const projectionRequiresLedger = projection?.roleChain?.confirmationModel === 'two-confirmations';
    if (!fs.existsSync(ledgerFile)) return !required && !projectionRequiresLedger;
    const ledger = fs.realpathSync(ledgerFile);
    if (!ledger.startsWith(`${root}${path.sep}`) || !fs.statSync(ledger).isFile()) return false;
    const db = new DatabaseSync(ledger, { readOnly: true });
    try {
      const snapshot = db.prepare('SELECT state_json FROM state_snapshots ORDER BY id DESC LIMIT 1').get();
      if (!snapshot) return false;
      const durable = JSON.parse(snapshot.state_json);
      const needsLedger = required || projectionRequiresLedger || durable?.roleChain?.confirmationModel === 'two-confirmations';
      if (!needsLedger) return true;
      if (!receipt?.authorizationRef || !receipt.action || !receipt.script || !receipt.operationKey) return false;
      return db.prepare("SELECT metadata_json FROM artifacts WHERE reference = ? AND sha256 = ? AND status = 'verified'").all(reference, digest).some(row => {
        try { const metadata = JSON.parse(row.metadata_json); return ['authorizationRef', 'action', 'script', 'operationKey'].every(key => metadata[key] === receipt[key]); } catch { return false; }
      });
    } finally { db.close(); }
  } catch { return false; }
}
export function controlledOutput(runDir, reference, scripts, inputReferences = [], actions = ['verify']) {
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
        return receipt.status === 'succeeded' && actions.includes(receipt.action) && scripts.includes(path.basename(receipt.script || '')) && receipt.outputFileHashes?.[reference] === digest && [...inputs].every(([ref, digest]) => receipt.inputFileHashes?.[ref] === digest) && ledgerBoundOutput(root, receipt, reference, digest);
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
