#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-portable-install-'));
const codexHome = path.join(root, 'new-user', '.codex');
const apexRoot = path.join(codexHome, 'apex', 'APEX');
const env = { ...process.env, HOME: path.join(root, 'new-user'), CODEX_HOME: codexHome, APEX_ROOT: apexRoot };
const install = spawnSync(process.execPath, [path.join(source, 'scripts', 'install.mjs')], { encoding: 'utf8', env });
if (![0, 2].includes(install.status)) throw new Error((install.stderr || install.stdout || 'portable install failed').trim());
for (const file of ['manifest.yaml', 'scripts/apex-router.mjs', 'scripts/preflight.mjs', 'runtime/host-bridges/codex-skill/SKILL.md']) if (!fs.existsSync(path.join(apexRoot, file))) throw new Error(`portable install missing ${file}`);
if (!fs.existsSync(path.join(codexHome, 'skills', 'apex', 'SKILL.md'))) throw new Error('portable install did not publish the bridge');
const maintainerHome = path.join(path.sep, 'Users', 'fredyw');
for (const name of fs.readdirSync(path.join(apexRoot, 'scripts')).filter(value => value.endsWith('.mjs'))) if (fs.readFileSync(path.join(apexRoot, 'scripts', name), 'utf8').includes(maintainerHome)) throw new Error(`hard-coded maintainer path remains in scripts/${name}`);
const preflight = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'preflight.mjs'), '--json'], { encoding: 'utf8', env });
const report = JSON.parse(preflight.stdout);
if (!['ready', 'ready-with-risks', 'blocked'].includes(report.status) || fs.realpathSync(report.apexRoot) !== fs.realpathSync(apexRoot)) throw new Error(`portable preflight contract failed: expected ${apexRoot}, received ${report.apexRoot}, status ${report.status}`);
const router = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'router-contract-test.mjs')], { encoding: 'utf8', env, timeout: 120000 });
if (router.status !== 0) throw new Error((router.stderr || router.stdout || 'portable Router contract failed').trim());
const routerReport = JSON.parse(router.stdout);
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ passed: true, preflightStatus: report.status, routerChecks: routerReport.checks }));
