#!/usr/bin/env node
/** Verifies that recorded Router events obey the APEX phase and authorization order. */
import fs from 'node:fs';
import path from 'node:path';
import { requireRouterAction } from './apex-runtime-guard.mjs';

function die(message) { console.error(`APEX trajectory evaluation failed: ${message}`); process.exit(1); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
const runDir = path.resolve(process.argv[2] || '.');
try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const file = path.join(runDir, 'events.ndjson'); const events = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, index) => ({ index: index + 1, ...JSON.parse(line) })) : [];
const errors = []; const authorized = new Set(); let gate1 = false; let gate2 = false;
for (const event of events) {
  if (event.type === 'run-created') continue;
  if (event.type === 'approval-recorded' && event.gate === 'gate1') gate1 = true;
  if (event.type === 'approval-recorded' && event.gate === 'visual' && !gate1) errors.push(`event ${event.index}: visual approval precedes Gate 1 approval`);
  if (event.type === 'state-transition' && event.transition === 'open-gate2') { if (!gate1) errors.push(`event ${event.index}: Gate 2 opened before Gate 1`); gate2 = true; }
  if (event.type === 'state-transition' && ['pass-proof', 'open-gate3'].includes(event.transition) && !gate2) errors.push(`event ${event.index}: ${event.transition} precedes Gate 2`);
  if (event.type === 'action-authorized') authorized.add(event.tokenId);
  if (event.type === 'action-verified' && !authorized.has(event.tokenId)) errors.push(`event ${event.index}: action verification has no prior authorization`);
  if (event.type === 'run-cancelled' && event.releasedLease !== true && event.releasedLease !== false) errors.push(`event ${event.index}: cancellation lacks lease release result`);
}
const result = { schemaVersion: '3.0', status: errors.length ? 'failed' : 'passed', evaluatedAt: new Date().toISOString(), eventCount: events.length, errors };
const output = path.join(runDir, 'evidence', 'trajectory-evaluation.json'); write(output, result); console.log(JSON.stringify({ status: result.status, evidence: output, errors })); if (errors.length) process.exitCode = 2;
