import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// This only observes the local gateway process. Its absence does not prove
// that subprocess descendants or external side effects have stopped.
export function inspectRunningOperations(runDir, activeReceiptRef = '') {
  const directory = path.join(runDir, 'operations');
  if (!fs.existsSync(directory)) return { interrupted: [], deferred: [] };
  const activeReceipt = activeReceiptRef ? path.resolve(runDir, activeReceiptRef) : null;
  const interrupted = [], deferred = [];
  for (const name of fs.readdirSync(directory).filter(item => item.endsWith('.json'))) {
    const file = path.join(directory, name), reference = path.relative(runDir, file);
    if (activeReceipt && path.resolve(file) === activeReceipt) continue;
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('invalid receipt'); }
    catch { deferred.push({ reference, reason: 'unreadable-receipt' }); continue; }
    if (receipt.status !== 'running') continue;
    const owner = receipt.owner;
    if (!owner || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) { deferred.push({ reference, reason: 'owner-unverified' }); continue; }
    try { process.kill(owner.pid, 0); deferred.push({ reference, reason: 'gateway-live', pid: owner.pid }); }
    catch (error) {
      if (error.code === 'ESRCH') interrupted.push({ reference, receipt });
      else deferred.push({ reference, reason: 'gateway-status-unverified', pid: owner.pid, code: error.code || 'unknown' });
    }
  }
  return { interrupted, deferred };
}

export function markInterruptedOperations(runDir, entries) {
  const interrupted = [];
  for (const { reference, receipt } of entries) {
    const file = path.join(runDir, reference);
    // A concurrent finalizer may have replaced the receipt since inspection.
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(receipt)) throw new Error(`operation changed during recovery: ${reference}`);
    const finishedAt = new Date().toISOString();
    const updated = { ...current, status: 'interrupted', finishedAt, recovery: { kind: 'local-gateway-exited', recoveredAt: finishedAt, retryRequires: 'new-router-authorization-and-observed-cause-change', externalSideEffects: 'unverified' }, stderr: `${current.stderr || ''}local gateway exited before completing its receipt; subprocess and external side effects remain unverified\n` };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`); fs.renameSync(temporary, file);
    interrupted.push(reference);
  }
  const indexFile = path.join(runDir, 'operations-index.json');
  if (interrupted.length && fs.existsSync(indexFile)) {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    for (const reference of interrupted) if (index.receipts?.[reference]) index.receipts[reference].status = 'interrupted';
    const temporary = `${indexFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`); fs.renameSync(temporary, indexFile);
  }
  return interrupted;
}
