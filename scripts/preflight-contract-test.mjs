#!/usr/bin/env node
/** Ensures required host Skill provenance cannot silently drift. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-preflight-contract-'));
const codexHome = path.join(fixtureRoot, '.codex');
const apexRoot = path.join(codexHome, 'apex', 'APEX');

function copy(relative) {
  const source = path.join(sourceRoot, relative), target = path.join(apexRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function run({ allowBlocked = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'preflight.mjs'), '--json'], {
    encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome }
  });
  assert.ok(result.status === 0 || (allowBlocked && result.status === 2), result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

try {
  copy('scripts/preflight.mjs');
  copy('scripts/apex-paths.mjs');
  copy('manifest.yaml');
  copy('registry/host-skill-dependencies.json');
  const dependencies = JSON.parse(fs.readFileSync(path.join(apexRoot, 'registry', 'host-skill-dependencies.json'), 'utf8')).skills;
  for (const dependency of dependencies.filter(item => item.required)) {
    const source = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', dependency.name, 'SKILL.md');
    const target = path.join(codexHome, 'skills', dependency.name, 'SKILL.md');
    assert.ok(fs.existsSync(source), `fixture requires installed Skill: ${dependency.name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  const baseline = run();
  assert.ok(['ready', 'ready-with-risks'].includes(baseline.status));
  assert.ok(baseline.required.every(item => item.status === 'ready' && item.sourceHashStatus === 'matched'));
  for (const name of ['google-design-md', 'impeccable', 'ui-ux-pro-max-skill']) assert.equal(dependencies.find(item => item.name === name)?.required, false, `${name} must remain optional`);
  assert.equal(dependencies.find(item => item.name === 'taste-skill')?.required, true, 'taste-skill must remain required');
  const target = path.join(codexHome, 'skills', 'taste-skill', 'SKILL.md');
  fs.appendFileSync(target, '\n<!-- tampered-for-contract-test -->\n');
  const drifted = run({ allowBlocked: true });
  assert.equal(drifted.status, 'blocked');
  const changed = drifted.required.find(item => item.name === 'taste-skill');
  assert.equal(changed.status, 'blocked');
  assert.equal(changed.sourceHashStatus, 'mismatched');
  assert.ok(drifted.missing.includes('skill:taste-skill:source-hash-mismatch'));
  console.log(JSON.stringify({ status: 'passed', scope: 'optional design skills absent and mandatory taste provenance' }));
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
