import { appendLedgerEvent, readRunState } from './run-ledger.mjs';

export function recordLateCancelledOperation(runDir, details) {
  if (readRunState(runDir).lifecycle !== 'cancelled') return false;
  appendLedgerEvent(runDir, { type: 'late-operation-after-cancellation', ...details, sideEffects: 'unverified' });
  return true;
}
