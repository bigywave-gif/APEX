#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Contract verification failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function typeOf(value) { if (Array.isArray(value)) return 'array'; if (value === null) return 'null'; return typeof value; }
function validate(value, schema, location = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;
  if (schema.type && typeOf(value) !== schema.type) errors.push(`${location}: expected ${schema.type}, received ${typeOf(value)}`);
  if (Array.isArray(schema.required) && value && typeof value === 'object' && !Array.isArray(value)) for (const key of schema.required) if (!(key in value)) errors.push(`${location}: missing required property ${key}`);
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) for (const [key, child] of Object.entries(schema.properties)) if (key in value) errors.push(...validate(value[key], child, `${location}.${key}`));
  if (schema.items && Array.isArray(value)) value.forEach((item, index) => errors.push(...validate(item, schema.items, `${location}[${index}]`)));
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location}: value is not in enum`);
  return errors;
}
function schemaAt(runDir, reference) { const file = path.resolve(runDir, reference); if (!fs.existsSync(file)) die(`schema does not exist: ${reference}`); return read(file); }

const [command, runArg, samplesArg] = process.argv.slice(2);
canonical();
if (command !== 'verify' || !runArg || !samplesArg) die('usage: verify <run-dir> <samples.json>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const state = read(path.join(runDir, 'state.json'));
const contract = read(path.join(runDir, state.artifacts.apiContract || 'api-contract.json'));
const samples = read(path.resolve(samplesArg));
if (!Array.isArray(samples)) die('samples.json must be an array');
const evidence = [];
for (const endpoint of contract.endpoints) {
  const sample = samples.find(item => item.method === endpoint.method && item.path === endpoint.path);
  if (!sample) { evidence.push({ id: `${endpoint.method} ${endpoint.path}`, status: 'failed', errors: ['sample missing'] }); continue; }
  const errors = [];
  if ('request' in sample) errors.push(...validate(sample.request, schemaAt(runDir, endpoint.requestSchema), 'request'));
  else errors.push('request missing');
  if ('response' in sample) errors.push(...validate(sample.response, schemaAt(runDir, endpoint.responseSchema), 'response'));
  else errors.push('response missing');
  evidence.push({ id: `${endpoint.method} ${endpoint.path}`, status: errors.length ? 'failed' : 'passed', errors });
}
const result = { status: evidence.every(item => item.status === 'passed') ? 'passed' : 'failed', evidence, checkedAt: new Date().toISOString() };
const output = path.join(runDir, 'evidence', 'contract-verification.json');
write(output, result);
console.log(JSON.stringify({ evidence: output, status: result.status, endpoints: evidence.length, failed: evidence.filter(item => item.status !== 'passed').length }));
if (result.status !== 'passed') process.exitCode = 2;
