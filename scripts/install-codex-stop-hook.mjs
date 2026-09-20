#!/usr/bin/env node
/** Safely merges the APEX Stop hook into the current user's Codex hook file. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot, codexHome } from './apex-paths.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) throw new Error(`APEX must run from canonical root: ${canonicalApexRoot}`);
const hookFile = path.join(codexHome, 'hooks.json');
const configFile = path.join(codexHome, 'config.toml');
const command = `${process.execPath} ${JSON.stringify(path.join(apexRoot, 'scripts', 'codex-stop-continuation.mjs'))}`;
const document = fs.existsSync(hookFile) ? JSON.parse(fs.readFileSync(hookFile, 'utf8')) : {};
document.hooks ||= {}; document.hooks.Stop ||= [];
const present = document.hooks.Stop.some(group => (group.hooks || []).some(hook => hook.type === 'command' && hook.command === command));
if (!present) document.hooks.Stop.push({ hooks: [{ type: 'command', command, statusMessage: 'Checking required APEX continuation' }] });
const temporary = `${hookFile}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
fs.renameSync(temporary, hookFile);
const groupIndex = document.hooks.Stop.findIndex(group => (group.hooks || []).some(hook => hook.type === 'command' && hook.command === command));
const identity = {
  event_name: 'stop',
  hooks: [{ type: 'command', command, timeout: 600, async: false, statusMessage: 'Checking required APEX continuation' }],
};
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}
const trustedHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonicalize(identity))).digest('hex')}`;
const key = `${hookFile}:stop:${groupIndex}:0`;
const section = `[hooks.state."${key.replaceAll('"', '\\"')}"]\ntrusted_hash = "${trustedHash}"\n`;
const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('"', '\\"');
const statePattern = new RegExp(`\\n?\\[hooks\\.state\\."${escapedKey}"\\]\\n(?:[^\\[]|\\n(?!\\[))*`, 'm');
const config = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
fs.writeFileSync(configFile, statePattern.test(config) ? config.replace(statePattern, `\n${section}`) : `${config.trimEnd()}\n\n${section}`);
console.log(JSON.stringify({ status: present ? 'already-installed' : 'installed', hookFile, command, trustState: 'installed', trustedHash }));
