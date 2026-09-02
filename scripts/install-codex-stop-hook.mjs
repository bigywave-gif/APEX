#!/usr/bin/env node
/** Safely merges the APEX Stop hook into the current user's Codex hook file. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot, codexHome } from './apex-paths.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) throw new Error(`APEX must run from canonical root: ${canonicalApexRoot}`);
const hookFile = path.join(codexHome, 'hooks.json');
const command = `${process.execPath} ${JSON.stringify(path.join(apexRoot, 'scripts', 'codex-stop-continuation.mjs'))}`;
const document = fs.existsSync(hookFile) ? JSON.parse(fs.readFileSync(hookFile, 'utf8')) : {};
document.hooks ||= {}; document.hooks.Stop ||= [];
const present = document.hooks.Stop.some(group => (group.hooks || []).some(hook => hook.type === 'command' && hook.command === command));
if (!present) document.hooks.Stop.push({ hooks: [{ type: 'command', command, statusMessage: 'Checking required APEX continuation' }] });
const temporary = `${hookFile}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
fs.renameSync(temporary, hookFile);
console.log(JSON.stringify({ status: present ? 'already-installed' : 'installed', hookFile, command }));
