import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiInput, apiContractEvidenceCurrent } from './api-contract-evidence.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-api-evidence-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-api-outside-'));
fs.writeFileSync(path.join(outside, 'schema.json'), '{}');
try {
  const put = (ref, value) => fs.writeFileSync(path.join(root, ref), JSON.stringify(value));
  const contract = { endpoints: [{ method: 'GET', path: '/fixture', requestSchema: 'request.json', responseSchema: 'response.json' }] };
  put('contract.json', contract); put('request.json', { type: 'object' }); put('response.json', { type: 'object' }); put('samples.json', []);
  const state = { artifacts: { apiContract: 'contract.json' } }, refs = ['contract.json', 'request.json', 'response.json', 'samples.json'];
  const evidence = { scope: 'supplied-samples-only', contractRef: 'contract.json', samplesRef: 'samples.json', inputBindings: refs.map(ref => apiInput(root, ref)) };
  assert.equal(apiContractEvidenceCurrent(root, state, evidence), true);
  for (const ref of refs) {
    const file = path.join(root, ref), previous = fs.readFileSync(file);
    fs.appendFileSync(file, ' '); assert.equal(apiContractEvidenceCurrent(root, state, evidence), false, `changed ${ref} must invalidate evidence`); fs.writeFileSync(file, previous);
  }
  assert.equal(apiContractEvidenceCurrent(root, state, { ...evidence, inputBindings: evidence.inputBindings.slice(1) }), false);
  assert.equal(apiContractEvidenceCurrent(root, { artifacts: { apiContract: 'other.json' } }, evidence), false);
  assert.throws(() => apiInput(root, path.relative(root, path.join(outside, 'schema.json'))));
  fs.symlinkSync(outside, path.join(root, 'outside')); assert.throws(() => apiInput(root, 'outside/schema.json'));
  console.log(JSON.stringify({ status: 'passed', scope: 'API contract, schema, and sample invalidation' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
