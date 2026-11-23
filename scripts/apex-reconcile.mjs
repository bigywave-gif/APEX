#!/usr/bin/env node
import path from 'node:path';
import { reconcileRun } from './run-ledger.mjs';

const [command, runArg] = process.argv.slice(2);
if (command !== 'status' || !runArg) {
  console.error('usage: apex-reconcile.mjs status <run-dir>');
  process.exit(1);
}
try {
  console.log(JSON.stringify(reconcileRun(path.resolve(runArg)), null, 2));
} catch (error) {
  console.error(`APEX reconciliation failed: ${error.message}`);
  process.exit(1);
}
