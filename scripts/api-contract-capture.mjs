#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { implementationRegistrationCurrent } from './implementation-registration.mjs';
import { apiInput } from './api-contract-evidence.mjs';
import { validateApiCaseCoverage, apiEndpointSchemaReferences, apiResponseSchemaReference } from './api-case-coverage.mjs';
import { openApiMutationJournal } from './api-mutation-journal.mjs';
import { runCancellationRequested } from './run-ledger.mjs';
import { apiSamplesRef, apiObservationRef, apiBrowserRef, observedRuntimeOrigin, observeHttpCases } from './api-http-observation.mjs';
const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, runArg, casesArg] = process.argv.slice(2);
try {
  if (fs.realpathSync(core) !== fs.realpathSync(canonicalApexRoot)) throw new Error('APEX must run from canonical root');
  if (command !== 'capture' || !runArg || !casesArg) throw new Error('usage: capture <run-dir> <cases.json>');
  const runDir = path.resolve(runArg); requireRouterAction(runDir, 'verify');
  const project = fs.realpathSync(process.env.APEX_ROUTER_PROJECT_ROOT || ''), state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json')));
  if (!implementationRegistrationCurrent(runDir, state, project) || !state.artifacts?.implementationRegistration) throw new Error('current registered implementation is required');
  const contractRef = state.artifacts?.apiContract || 'api-contract.json', casesRef = path.relative(runDir, path.resolve(casesArg));
  const contractBinding = apiInput(runDir, contractRef), casesBinding = apiInput(runDir, casesRef), registration = apiInput(runDir, state.artifacts.implementationRegistration), browser = apiInput(runDir, apiBrowserRef);
  const contract = JSON.parse(fs.readFileSync(path.join(runDir, contractRef))), input = JSON.parse(fs.readFileSync(path.join(runDir, casesRef)));
  validateApiCaseCoverage(contract.endpoints, input.cases);
  const schemaBindings = [...new Set(contract.endpoints.flatMap(apiEndpointSchemaReferences))].map(ref => apiInput(runDir, ref));
  for (const item of input.cases) {
    const endpoint = contract.endpoints.find(entry => entry.method === item.method && entry.path === item.path);
    apiResponseSchemaReference(endpoint, item.expectedStatus);
    const pattern = '^' + item.path.split('/').map(part => part.startsWith(':') && part.length > 1 ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$';
    const url = new URL(item.route, 'http://127.0.0.1');
    if (!new RegExp(pattern).test(url.pathname)) throw new Error('observation route does not match the contract endpoint');
  }
  const origin = observedRuntimeOrigin(runDir, state), journal = openApiMutationJournal(project);
  let samples, authBindings; try {
    const names = [...new Set(input.cases.map(item => item.auth?.bearerEnv).filter(Boolean))].sort();
    authBindings = names.map(name => ({ name, fingerprint: journal.credentialFingerprint(process.env[name]) }));
    samples = await observeHttpCases(origin, input.cases, { journal, writeContext: { registration: registration.sha256, contract: contractBinding.sha256, browserCapture: browser.sha256 }, cancelled: () => runCancellationRequested(runDir) });
    if (authBindings.some(binding => journal.credentialFingerprint(process.env[binding.name]) !== binding.fingerprint)) throw new Error('API credentials changed during capture');
  } finally { journal.close(); }
  if ([contractBinding, casesBinding, registration, browser, ...schemaBindings].some(binding => apiInput(runDir, binding.reference).sha256 !== binding.sha256) || !implementationRegistrationCurrent(runDir, state, project)) throw new Error('observation input or implementation changed during capture');
  const output = path.join(runDir, apiSamplesRef); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(samples, null, 2)}\n`);
  const observation = { kind: 'controlled-http-observation', status: 'captured', projectRoot: project, origin, contract: contractBinding, implementationRegistration: registration, browserCapture: browser, cases: casesBinding, authBindings, samples: apiInput(runDir, apiSamplesRef), capturedAt: new Date().toISOString(), limitations: ['Captures configured JSON requests and responses on the local runtime; does not prove untested cases or remote deployment behavior.'] };
  fs.writeFileSync(path.join(runDir, apiObservationRef), `${JSON.stringify(observation, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'captured', samples: path.join(runDir, apiSamplesRef), observation: path.join(runDir, apiObservationRef), count: samples.length }));
} catch (error) { console.error(`API capture failed: ${error.message}`); process.exitCode = 1; }
