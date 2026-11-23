import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertDesignContractCurrent } from './design-contract-evidence.mjs';
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-design-contract-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-design-outside-'));
try {
  const run = path.join(project, '.apex/runs/run'); fs.mkdirSync(run, { recursive: true });
  const digest = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
  const file = path.join(run, 'DESIGN.md'); fs.writeFileSync(file, 'confirmed design');
  const contract = { path: 'DESIGN.md', sha256: digest('confirmed design') };
  assert.equal(assertDesignContractCurrent(run, project, contract).sha256, contract.sha256);
  fs.writeFileSync(path.join(project, 'DESIGN.md'), 'other design');
  assert.throws(() => assertDesignContractCurrent(run, project, contract), /changed or ambiguous/);
  fs.rmSync(path.join(project, 'DESIGN.md')); fs.writeFileSync(file, 'modified');
  assert.throws(() => assertDesignContractCurrent(run, project, contract), /changed or ambiguous/);
  fs.rmSync(file); assert.throws(() => assertDesignContractCurrent(run, project, contract), /missing/);
  const foreign = path.join(outside, 'DESIGN.md'); fs.writeFileSync(foreign, 'confirmed design'); fs.symlinkSync(foreign, file);
  assert.throws(() => assertDesignContractCurrent(run, project, contract), /outside/);
  assert.throws(() => assertDesignContractCurrent(run, project, { ...contract, path: foreign }), /outside/);
  console.log(JSON.stringify({ status: 'passed', checks: 6, scope: 'design-contract-source-integrity' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
