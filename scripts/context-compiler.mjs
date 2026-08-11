#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';

function die(message) { console.error(`Context compile failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

const [command, runArg, sourceArg, projectArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg || !sourceArg) die('usage: compile <run-dir> <context-sources.json> [project-root]');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'record_context'); } catch (error) { die(error.message); }
const projectRoot = path.resolve(projectArg || path.join(runDir, '..', '..', '..'));
const spec = read(path.resolve(sourceArg));
const previousFile = path.join(runDir, 'context-index.json');
const previous = fs.existsSync(previousFile) ? read(previousFile) : { sources: [] };
const old = new Map((previous.sources || []).map(item => [item.id, item]));
const sources = [];
const changed = [];
for (const source of spec.sources) {
  const file = path.resolve(projectRoot, source.path);
  if (!fs.existsSync(file)) die(`source does not exist: ${source.path}`);
  const content = fs.readFileSync(file);
  const item = { ...source, path: path.relative(projectRoot, file), hash: hash(content), bytes: content.length, summary: source.sensitive ? '[sensitive source omitted]' : content.toString('utf8').replace(/\s+/g, ' ').slice(0, 600) };
  sources.push(item);
  if (old.get(source.id)?.hash !== item.hash) changed.push({ id: source.id, invalidates: source.invalidates });
}
write(previousFile, { schemaVersion: '3.0', compiledAt: new Date().toISOString(), projectRoot, sources, changed });
console.log(JSON.stringify({ indexed: sources.length, changed }));
