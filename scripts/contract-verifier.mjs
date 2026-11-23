#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { validateApiSample } from './api-sample-schema.mjs';
import { validateApiCaseCoverage, apiEndpointSchemaReferences, apiResponseSchemaReference } from './api-case-coverage.mjs';
import { apiInput, apiContractEvidenceCurrent } from './api-contract-evidence.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Contract verification failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function schemaAt(runDir, reference) { try { apiInput(runDir, reference); return read(path.resolve(runDir, reference)); } catch (error) { die(error.message); } }

const [command, runArg, samplesArg] = process.argv.slice(2);
canonical();
if (command !== 'verify' || !runArg || !samplesArg) die('usage: verify <run-dir> <samples.json>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const state = read(path.join(runDir, 'state.json'));
const contractRef = state.artifacts.apiContract || 'api-contract.json';
const samplesRef = path.relative(runDir, path.resolve(samplesArg));
try { apiInput(runDir, contractRef); apiInput(runDir, samplesRef); } catch (error) { die(error.message); }
const contract = read(path.join(runDir, contractRef));
const samples = read(path.resolve(runDir, samplesRef));
if (!Array.isArray(samples)) die('samples.json must be an array');
try { validateApiCaseCoverage(contract.endpoints, samples); } catch (error) { die(error.message); }
let inputBindings;
try { inputBindings = [...new Set([contractRef, samplesRef, ...contract.endpoints.flatMap(apiEndpointSchemaReferences)])].map(ref => apiInput(runDir, ref)); } catch (error) { die(error.message); }
const evidence = [];
for (const endpoint of contract.endpoints) {
  const matched = samples.filter(item => item.method === endpoint.method && item.path === endpoint.path);
  const requestSchema = schemaAt(runDir, endpoint.requestSchema);
  for (const sample of matched) {
    const errors = [];
    if ('request' in sample) errors.push(...validateApiSample(sample.request, requestSchema, 'request'));
    else errors.push('request missing');
    let responseRef; try { responseRef = apiResponseSchemaReference(endpoint, sample.responseStatus); } catch (error) { errors.push(error.message); }
    if (!('response' in sample)) errors.push('response missing');
    else if (responseRef) errors.push(...validateApiSample(sample.response, schemaAt(runDir, responseRef), 'response'));
    evidence.push({ id: endpoint.method + ' ' + endpoint.path + (sample.caseId ? ' [' + sample.caseId + ']' : ''), status: errors.length ? 'failed' : 'passed', errors });
  }
}
const result = { status: evidence.every(item => item.status === 'passed') ? 'passed' : 'failed', scope: 'supplied-samples-only', contractRef, samplesRef, inputBindings, evidence, checkedAt: new Date().toISOString() };
if (!apiContractEvidenceCurrent(runDir, state, result)) die('API contract, schemas or samples changed during verification');
const output = path.join(runDir, 'evidence', 'contract-verification.json');
write(output, result);
console.log(JSON.stringify({ evidence: output, status: result.status, endpoints: contract.endpoints.length, cases: evidence.length, failed: evidence.filter(item => item.status !== 'passed').length }));
if (result.status !== 'passed') process.exitCode = 2;
