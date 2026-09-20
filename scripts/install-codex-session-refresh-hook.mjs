#!/usr/bin/env node
/** Installs the non-blocking APEX session freshness guard before tool calls. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot, codexHome } from './apex-paths.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) throw new Error(`APEX must run from canonical root: ${canonicalApexRoot}`);
const hookFile = path.join(codexHome, 'hooks.json');
const command = `${process.execPath} ${JSON.stringify(path.join(apexRoot, 'scripts', 'codex-pretool-session-refresh.mjs'))}`;
const document = fs.existsSync(hookFile) ? JSON.parse(fs.readFileSync(hookFile, 'utf8')) : {};
document.hooks ||= {}; document.hooks.PreToolUse ||= [];
const present = document.hooks.PreToolUse.some(group => (group.hooks || []).some(hook => hook.type === 'command' && hook.command === command));
if (!present) document.hooks.PreToolUse.push({ hooks: [{ type: 'command', command, statusMessage: 'Refreshing APEX session context' }] });
const temporary = `${hookFile}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
fs.renameSync(temporary, hookFile);
console.log(JSON.stringify({ status: present ? 'already-installed' : 'installed', hookFile, command }));
