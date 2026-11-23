import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeLedger, fenceRunCancellation } from './run-ledger.mjs';
import { recordLateCancelledOperation } from './cancelled-operation-finalizer.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-late-cancel-'));
try {
  const state = { runId: 'fixture', revision: 1, lifecycle: 'active', artifacts: {} };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  initializeLedger(dir, state, 'fixture');
  assert.equal(recordLateCancelledOperation(dir, { action: 'verify', script: 'fixture.mjs' }), false);
  fenceRunCancellation(dir, 'fixture-session', 'fixture');
  assert.equal(recordLateCancelledOperation(dir, { action: 'verify', script: 'fixture.mjs', exitCode: 0 }), true);
  assert.equal(fs.existsSync(path.join(dir, 'operations')), false);
  const db = new DatabaseSync(path.join(dir, 'run-ledger.sqlite'), { readOnly: true });
  const event = JSON.parse(db.prepare("SELECT payload_json FROM events WHERE event_type = 'late-operation-after-cancellation'").get().payload_json);
  db.close();
  assert.equal(event.action, 'verify');
  assert.equal(event.sideEffects, 'unverified');
  assert.equal(event.exitCode, 0);
  console.log(JSON.stringify({ status: 'passed', checks: 6 }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
