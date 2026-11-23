import fs from 'node:fs';
import path from 'node:path';
import { apiInput } from './api-contract-evidence.mjs';
import { controlledOutput } from './verification-policy.mjs';
import { implementationRegistrationCurrent } from './implementation-registration.mjs';
import { apiCredentialFingerprint } from './api-mutation-journal.mjs';

export const apiSamplesRef = 'evidence/api-observed-samples.json';
export const apiObservationRef = 'evidence/api-http-observation.json';
export const apiBrowserRef = 'evidence/runtime-browser-capture.json';
const loopback = url => url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
export function observedRuntimeOrigin(runDir, state) {
  if (!controlledOutput(runDir, apiBrowserRef, ['browser-capture.mjs'])) throw new Error('current controlled runtime browser capture is required');
  const registration = apiInput(runDir, state.artifacts?.implementationRegistration);
  const captureHash = apiInput(runDir, apiBrowserRef).sha256;
  const operations = path.join(runDir, 'operations');
  const current = fs.readdirSync(operations).filter(name => name.endsWith('.json')).some(name => { try { const receipt = JSON.parse(fs.readFileSync(path.join(operations, name), 'utf8')); return receipt.status === 'succeeded' && receipt.action === 'verify' && path.basename(receipt.script || '') === 'browser-capture.mjs' && receipt.outputFileHashes?.[apiBrowserRef] === captureHash && receipt.runInputHashes?.[registration.reference] === registration.sha256; } catch { return false; } });
  if (!current) throw new Error('runtime browser capture is not bound to the current implementation');
  const capture = JSON.parse(fs.readFileSync(path.join(runDir, apiBrowserRef), 'utf8'));
  if (capture.kind !== 'runtime' || capture.status !== 'passed' || !Array.isArray(capture.evidence) || !capture.evidence.length) throw new Error('runtime browser capture is missing or failed');
  const urls = capture.evidence.map(item => { if (item.status !== 'captured') throw new Error('runtime screen capture failed'); return new URL(item.url); });
  if (urls.some(url => !loopback(url) || url.origin !== urls[0].origin)) throw new Error('API observation requires one loopback runtime origin');
  return urls[0].origin;
}
export async function observeHttpCases(origin, cases, { journal = null, writeContext = null, cancelled = () => false } = {}) {
  const base = new URL(origin);
  if (!loopback(base) || base.origin !== origin || !Array.isArray(cases) || !cases.length) throw new Error('nonempty cases and a loopback origin are required');
  const samples = [], prepared = [], writeIds = new Set();
  for (const item of cases) {
    if (!item || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(item.method) || typeof item.path !== 'string' || !item.path.startsWith('/') || item.path.startsWith('//') || typeof item.route !== 'string' || !item.route.startsWith('/') || item.route.startsWith('//') || item.route.includes('\\') || !Number.isInteger(item.expectedStatus) || item.expectedStatus < 100 || item.expectedStatus > 599 || !('request' in item)) throw new Error('invalid API observation case');
    let bearer = null;
    if (item.auth !== undefined) {
      if (!item.auth || Object.keys(item.auth).length !== 1 || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(item.auth.bearerEnv || '')) throw new Error('invalid API authentication configuration');
      bearer = process.env[item.auth.bearerEnv];
      if (typeof bearer !== 'string' || !bearer.trim() || /[\r\n]/.test(bearer)) throw new Error('API authentication environment variable is missing or invalid');
      if (JSON.stringify(item).includes(bearer)) throw new Error('API case must not contain authentication secret');
    }
    if (item.method !== 'GET') {
      if (!journal || !writeContext || typeof item.executionId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(item.executionId)) throw new Error('write observation requires a journal and stable executionId');
      if (writeIds.has(item.executionId)) throw new Error('write executionId must be unique within the capture');
      writeIds.add(item.executionId);
    }
    const target = new URL(item.route, origin);
    if (target.origin !== origin || target.username || target.password || target.hash) throw new Error('API observation route must remain on the runtime origin');
    const body = JSON.stringify(item.request);
    if (body === undefined || Buffer.byteLength(body) > 1024 * 1024) throw new Error('request JSON is invalid or too large');
    if (item.method === 'GET' && body !== '{}') throw new Error('GET request must use an empty JSON object');
    prepared.push({ item, target, body, bearer });
  }
  const secrets = prepared.map(entry => entry.bearer).filter(Boolean);
  if (secrets.some(secret => JSON.stringify(cases).includes(secret))) throw new Error('API cases must not contain authentication secrets');
  for (const { item, target, body, bearer } of prepared) {
    if (cancelled()) throw new Error('run cancelled before API observation');
    const dispatch = async () => {
    if (cancelled()) throw new Error('run cancelled before API request; write outcome remains uncertain');
    const headers = { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(item.method === 'GET' ? {} : { 'content-type': 'application/json' }) };
    const response = await fetch(target, { method: item.method, redirect: 'manual', signal: AbortSignal.timeout(10000), headers, ...(item.method === 'GET' ? {} : { body }) });
    if (response.status !== item.expectedStatus) throw new Error(`API response status ${response.status} does not match ${item.expectedStatus}`);
    const responseText = await response.text();
    if (secrets.some(secret => responseText.includes(secret))) throw new Error('API response contains the authentication secret');
    if (Buffer.byteLength(responseText) > 1024 * 1024) throw new Error('response JSON is too large');
    let responseBody; try { responseBody = JSON.parse(responseText); } catch { throw new Error('API response is not JSON'); }
    const containsSecret = value => typeof value === 'string' ? secrets.some(secret => value.includes(secret)) : Array.isArray(value) ? value.some(containsSecret) : value && typeof value === 'object' ? Object.entries(value).some(([key, child]) => containsSecret(key) || containsSecret(child)) : false;
    if (containsSecret(responseBody)) throw new Error('API response contains the authentication secret');
    return { ...(item.caseId ? { caseId: item.caseId } : {}), method: item.method, path: item.path, request: item.request, response: responseBody };
    };
    const sample = item.method === 'GET' ? await dispatch() : await journal.execute(item.executionId, { origin, writeContext, credential: bearer ? journal.credentialFingerprint(bearer) : null, method: item.method, path: item.path, route: item.route, request: item.request, expectedStatus: item.expectedStatus }, dispatch);
    samples.push(sample);
  }
  return samples;
}
export function apiObservationCurrent(runDir, state, projectRoot, samplesRef) {
  try {
    if (samplesRef !== apiSamplesRef || !implementationRegistrationCurrent(runDir, state, projectRoot)) return false;
    if (!controlledOutput(runDir, apiObservationRef, ['api-contract-capture.mjs']) || !controlledOutput(runDir, apiSamplesRef, ['api-contract-capture.mjs'])) return false;
    const observation = JSON.parse(fs.readFileSync(path.join(runDir, apiObservationRef), 'utf8'));
    if (observation.kind !== 'controlled-http-observation' || observation.status !== 'captured' || observation.origin !== observedRuntimeOrigin(runDir, state) || observation.projectRoot !== fs.realpathSync(projectRoot)) return false;
    if (observation.contract?.reference !== (state.artifacts?.apiContract || 'api-contract.json') || observation.implementationRegistration?.reference !== state.artifacts?.implementationRegistration || observation.browserCapture?.reference !== apiBrowserRef || observation.samples?.reference !== apiSamplesRef) return false;
    if (![observation.contract, observation.implementationRegistration, observation.browserCapture, observation.samples, observation.cases].every(item => item?.sha256 && apiInput(runDir, item.reference).sha256 === item.sha256)) return false;
    const cases = JSON.parse(fs.readFileSync(path.resolve(runDir, observation.cases.reference), 'utf8')).cases;
    if (!Array.isArray(cases)) return false;
    const names = [...new Set(cases.map(item => item.auth?.bearerEnv).filter(Boolean))].sort();
    const bindings = observation.authBindings || [];
    if (!Array.isArray(bindings) || bindings.length !== names.length || bindings.some((item, index) => item.name !== names[index])) return false;
    return bindings.every(item => typeof process.env[item.name] === 'string' && apiCredentialFingerprint(projectRoot, process.env[item.name]) === item.fingerprint);
  } catch { return false; }
}
