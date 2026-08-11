#!/usr/bin/env node
/** Resolves an approved visual dependency in a run-local sandbox, never in the project. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
function die(message) { console.error(`Visual sandbox dependency failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return fs.existsSync(file) ? `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}` : null; }
function packageFile(root, name) { return path.join(root, 'node_modules', ...name.split('/'), 'package.json'); }
function projectDependencySnapshot(root) { return Object.fromEntries(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'].map(file => [file, hash(path.join(root, file))])); }

const [command, runArg, packageName, version] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'prepare' || !runArg || !packageName || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version || '')) die('usage: prepare <run-dir> <package-name> <exact-version>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'generate_visual'); } catch (error) { die(error.message); }
const projectRoot = path.resolve(process.env.APEX_ROUTER_PROJECT_ROOT || ''); if (!projectRoot || !fs.existsSync(projectRoot)) die('Router project root is required');
const sandboxRoot = path.join(runDir, 'visual-sandbox'); const before = projectDependencySnapshot(projectRoot); const installed = packageFile(sandboxRoot, packageName);
if (!fs.existsSync(installed) || read(installed).version !== version) {
  const result = spawnSync('npm', ['install', '--prefix', sandboxRoot, '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', `${packageName}@${version}`], { encoding: 'utf8' });
  if (result.status !== 0) die(`sandbox resolution failed: ${(result.stderr || result.stdout).trim()}`);
}
const after = projectDependencySnapshot(projectRoot); if (JSON.stringify(before) !== JSON.stringify(after)) die('visual sandbox must not modify project package.json or lockfiles');
if (!fs.existsSync(installed) || read(installed).version !== version) die(`sandbox package version is not exact: ${packageName}`);
const manifest = { schemaVersion: '3.0', sourceKind: 'visual-sandbox', runtimeRoot: 'visual-sandbox', projectDependencySnapshot: before, packages: [{ name: packageName, version, packageJson: path.relative(runDir, installed), sha256: hash(installed) }] };
write(path.join(runDir, 'visual-sandbox-dependency.json'), manifest);
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile); state.artifacts.visualSandboxDependency = 'visual-sandbox-dependency.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ sandbox: sandboxRoot, package: `${packageName}@${version}`, projectDependencyFilesChanged: false }));
