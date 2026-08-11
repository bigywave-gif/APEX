#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apexRoot, canonicalApexRoot, codexHome, globalBridge, isCanonicalApexRoot } from './apex-paths.mjs';

function command(name, args = ['--version']) {
  const result = spawnSync(name, args, { encoding: 'utf8', timeout: 10000 });
  return { present: result.status === 0, version: (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || null };
}
function skillCandidates(skill) {
  return [skill.name, ...(skill.aliases || [])].flatMap(name => [path.join(codexHome, 'skills', name, 'SKILL.md'), path.join(path.dirname(codexHome), '.agents', 'skills', name, 'SKILL.md')]);
}
const manifestFile = path.join(apexRoot, 'manifest.yaml');
const manifest = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, 'utf8') : '';
const version = manifest.match(/^version:\s*["']?([^\s"']+)/m)?.[1] || null;
const dependencyFile = path.join(apexRoot, 'registry', 'host-skill-dependencies.json');
const dependencies = fs.existsSync(dependencyFile) ? JSON.parse(fs.readFileSync(dependencyFile, 'utf8')).skills : [];
const required = dependencies.filter(item => item.required).map(item => {
  const installedAt = skillCandidates(item).find(file => fs.existsSync(file)) || null;
  const installedVersion = installedAt ? fs.readFileSync(installedAt, 'utf8').match(/^version:\s*([^\s]+)$/m)?.[1] || null : null;
  const versionStatus = !installedAt ? 'missing' : !item.minimumVersion ? 'not-required' : installedVersion ? 'declared' : 'unverified';
  return { name: item.name, role: item.role, status: installedAt ? 'ready' : 'missing', installedAt, installedVersion, minimumVersion: item.minimumVersion || null, versionStatus, source: item.source, repository: item.repository || null, installCommand: installedAt ? null : item.installCommand || 'npm run install:apex' };
});
const tools = { node: { present: Number(process.versions.node.split('.')[0]) >= 18, version: process.versions.node }, git: command('git'), npm: command('npm') };
const missing = [...required.filter(item => item.status === 'missing').map(item => `skill:${item.name}`), ...Object.entries(tools).filter(([, value]) => !value.present).map(([name]) => `tool:${name}`), ...(!fs.existsSync(manifestFile) ? ['manifest.yaml'] : []), ...(!isCanonicalApexRoot() ? [`canonical-root:${canonicalApexRoot}`] : [])];
const optional = { bridge: fs.existsSync(globalBridge) ? 'ready' : 'missing', browser: fs.existsSync(path.join(codexHome, 'skills', 'playwright', 'SKILL.md')) ? 'ready' : 'missing' };
const status = missing.length ? 'blocked' : Object.values(optional).includes('missing') ? 'ready-with-risks' : 'ready';
const report = { schemaVersion: '1.0', status, host: process.platform, apexRoot, canonicalApexRoot, apexVersion: version, required, tools, optional, missing, nextAction: missing.length ? 'Install the listed dependencies, then rerun npm run preflight.' : 'APEX may enter its normal Router workflow.' };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log('APEX Preflight');
  console.log(`status: ${status}`);
  console.log(`host: ${report.host}`);
  console.log(`apex_root: ${apexRoot}`);
  console.log(`apex_version: ${version || 'unknown'}`);
  console.log(`required: ${required.map(item => `${item.name}=${item.status}`).join(', ') || 'none'}`);
  console.log(`optional: ${Object.entries(optional).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  console.log(`missing: ${missing.join(', ') || 'none'}`);
  console.log(`next_action: ${report.nextAction}`);
}
if (status === 'blocked') process.exitCode = 2;
