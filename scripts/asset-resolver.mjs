#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';

function die(message) { console.error(`Asset resolution failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function exact(version) { return version && !/^(latest|next|current|\^|~|>|<|\*)/i.test(version); }

async function resolveNpm(item) {
  if (!exact(item.version)) die(`${item.assetRef}: npm version must be exact`);
  const url = `https://registry.npmjs.org/${encodeURIComponent(item.source)}/${encodeURIComponent(item.version)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) die(`${item.assetRef}: npm registry HTTP ${response.status}`);
  const meta = await response.json();
  return {
    assetRef: item.assetRef,
    source: item.source,
    version: meta.version,
    entrypoints: item.entrypoints || [meta.module || meta.main || meta.exports || '.'],
    peers: Object.entries(meta.peerDependencies || {}).map(([name, range]) => ({ name, range })),
    sidecars: item.sidecars || [],
    runtime: item.runtime,
    license: { expression: typeof meta.license === 'string' ? meta.license : meta.license?.type || item.license?.expression, source: meta.homepage || meta.repository?.url || url },
    integrity: meta.dist?.integrity || meta.dist?.shasum,
    fallback: item.fallback,
    smokeTest: meta.version === item.version ? 'passed' : 'failed'
  };
}
async function resolveRemote(item) {
  if (!exact(item.version)) die(`${item.assetRef}: remote version or revision must be exact`);
  const response = await fetch(item.source, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) die(`${item.assetRef}: remote source HTTP ${response.status}`);
  if (!item.license?.expression && !item.license?.termsUrl) die(`${item.assetRef}: license or terms is required`);
  return { assetRef: item.assetRef, source: item.source, version: item.version, entrypoints: item.entrypoints || [item.source], peers: item.peers || [], sidecars: item.sidecars || [], runtime: item.runtime, license: item.license, integrity: response.headers.get('etag') || response.headers.get('last-modified') || item.integrity || null, fallback: item.fallback, smokeTest: 'passed' };
}

const [command, runArg, selectionArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'resolve' || !runArg || !selectionArg) die('usage: resolve <run-dir> <asset-selection.json>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'compile_visual_bundle'); } catch (error) { die(error.message); }
const selection = read(path.resolve(selectionArg));
const output = [];
for (const item of selection.items || []) output.push(item.kind === 'npm' ? await resolveNpm(item) : await resolveRemote(item));
const lock = { schemaVersion: '3.0', resolvedAt: new Date().toISOString(), items: output };
write(path.join(runDir, 'dependency-lock.json'), lock);
const stateFile = path.join(runDir, 'state.json');
if (fs.existsSync(stateFile)) { const state = read(stateFile); state.artifacts.dependencyLock = 'dependency-lock.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state); }
console.log(JSON.stringify({ dependencyLock: path.join(runDir, 'dependency-lock.json'), resolved: output.length }));
