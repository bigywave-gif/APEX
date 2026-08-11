#!/usr/bin/env node
import { canonicalApexRoot, globalBridge as target } from './apex-paths.mjs';
/** Publishes the canonical APEX Bridge Skill to Codex's global skill location. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(apexRoot, 'runtime', 'host-bridges', 'codex-skill', 'SKILL.md');
function fail(message) { console.error(`APEX bridge sync failed: ${message}`); process.exit(1); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) fail(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (!fs.existsSync(source)) fail(`canonical bridge is missing: ${source}`);
fs.mkdirSync(path.dirname(target), { recursive: true });
const before = fs.existsSync(target) ? hash(target) : null;
const current = hash(source);
if (before !== current) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, target);
}
console.log(JSON.stringify({ status: before === current ? 'current' : 'synchronized', source, target, hash: current }));
