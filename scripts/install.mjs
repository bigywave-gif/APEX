#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apexRoot, canonicalApexRoot, codexHome, globalBridge, isCanonicalApexRoot } from './apex-paths.mjs';

function fail(message) { console.error(`APEX install failed: ${message}`); process.exit(1); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true, filter: value => !['.git', 'node_modules', '.DS_Store'].includes(path.basename(value)) });
}
if (!isCanonicalApexRoot()) {
  if (fs.existsSync(canonicalApexRoot) && fs.readdirSync(canonicalApexRoot).length) fail(`target is not empty: ${canonicalApexRoot}`);
  fs.mkdirSync(path.dirname(canonicalApexRoot), { recursive: true });
  copyTree(apexRoot, canonicalApexRoot);
}
const installedRoot = canonicalApexRoot;
const bundledSkill = path.join(installedRoot, 'skills', 'google-design-md');
const bundledTarget = path.join(codexHome, 'skills', 'google-design-md');
if (!fs.existsSync(bundledTarget)) { fs.mkdirSync(path.dirname(bundledTarget), { recursive: true }); copyTree(bundledSkill, bundledTarget); }
const bridgeSource = path.join(installedRoot, 'runtime', 'host-bridges', 'codex-skill', 'SKILL.md');
fs.mkdirSync(path.dirname(globalBridge), { recursive: true });
fs.copyFileSync(bridgeSource, globalBridge);
if (hash(bridgeSource) !== hash(globalBridge)) fail('bridge hash verification failed');
const marker = { schemaVersion: '1.0', apexRoot: installedRoot, installedAt: new Date().toISOString(), sourceRoot: apexRoot, bridgeHash: hash(globalBridge) };
fs.writeFileSync(path.join(installedRoot, '.apex-install.json'), `${JSON.stringify(marker, null, 2)}\n`);
const preflight = spawnSync(process.execPath, [path.join(installedRoot, 'scripts', 'preflight.mjs'), '--json'], { encoding: 'utf8', env: { ...process.env, APEX_ROOT: installedRoot } });
console.log(JSON.stringify({ installed: true, apexRoot: installedRoot, bridge: globalBridge, preflight: preflight.status === 0 ? 'ready' : 'blocked', detail: (preflight.stdout || preflight.stderr).trim() }, null, 2));
if (preflight.status !== 0) process.exitCode = 2;
