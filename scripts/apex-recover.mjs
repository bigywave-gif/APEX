#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';

function die(message) { console.error(`APEX recovery failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

const runDir = path.resolve(process.argv[2] || '.');
try { requireRouterAction(runDir, 'recover'); } catch (error) { die(error.message); }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
const refs = state.checkpoints || [];
if (!refs.length) die('no checkpoints');
const latestRef = refs[refs.length - 1];
const checkpoint = read(path.join(runDir, latestRef.path));
const changed = [];
for (const [name, item] of Object.entries(checkpoint.artifacts || {})) {
  const file = path.isAbsolute(item.path) ? item.path : path.join(runDir, item.path);
  if (!fs.existsSync(file)) changed.push({ name, reason: 'missing' });
  else if (hashFile(file) !== item.hash) changed.push({ name, reason: 'hash-changed' });
}
const context = fs.existsSync(path.join(runDir, 'context-index.json')) ? read(path.join(runDir, 'context-index.json')) : { changed: [] };
const invalidates = new Set((context.changed || []).flatMap(item => item.invalidates || []));
if (changed.some(item => ['siteContract', 'functionalFreeze', 'stitchFreeze', 'visualBundle', 'implementationMap', 'dependencyLock'].includes(item.name)) || invalidates.has('gate2')) {
  state.gates.gate2 = { status: 'revoked', at: new Date().toISOString(), evidence: ['recovery-input-changed'] };
  state.locks.implementationAllowed = false;
}
if (changed.length || invalidates.has('gate3')) state.gates.gate3 = { status: 'revoked', at: new Date().toISOString(), evidence: ['recovery-input-changed'] };
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ checkpoint: latestRef.path, changed, invalidates: [...invalidates], gate2: state.gates.gate2.status, gate3: state.gates.gate3.status }));
