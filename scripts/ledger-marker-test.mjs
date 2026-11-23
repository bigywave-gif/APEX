import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentRuntimeStatus, appendLedgerEvent, initializeLedger, readRunState } from './run-ledger.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ledger-marker-'));
try {
  const state = { runId: 'fixture', revision: 1, lifecycle: 'active', artifacts: {} };
  const established = path.join(root, 'established'); fs.mkdirSync(established);
  fs.writeFileSync(path.join(established, 'state.json'), JSON.stringify(state)); initializeLedger(established, state, 'fixture');
  const ledger = path.join(established, 'run-ledger.sqlite'), marker = path.join(established, 'ledger-established.json'), backup = path.join(established, 'original.sqlite');
  assert.ok(fs.existsSync(marker));
  fs.renameSync(ledger, backup);
  assert.throws(() => readRunState(established), /restore and investigate the original ledger/);
  assert.throws(() => agentRuntimeStatus(established), /restore and investigate the original ledger/);
  assert.throws(() => appendLedgerEvent(established, { type: 'fixture' }), /restore and investigate the original ledger/);
  assert.equal(fs.existsSync(ledger), false);
  fs.renameSync(backup, ledger); assert.equal(readRunState(established).runId, 'fixture');
  fs.unlinkSync(marker); assert.equal(readRunState(established).runId, 'fixture'); assert.ok(fs.existsSync(marker));
  const legacy = path.join(root, 'legacy'); fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'state.json'), JSON.stringify(state));
  assert.equal(readRunState(legacy).runId, 'fixture');
  assert.ok(fs.existsSync(path.join(legacy, 'run-ledger.sqlite'))); assert.ok(fs.existsSync(path.join(legacy, 'ledger-established.json')));
  console.log(JSON.stringify({ status: 'passed', scope: 'established ledger loss, restoration and legacy migration' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
