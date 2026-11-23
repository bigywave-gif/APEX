import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiInput } from './api-contract-evidence.mjs';
import { apiBrowserRef, apiSamplesRef, apiObservationRef, observeHttpCases, observedRuntimeOrigin, apiObservationCurrent } from './api-http-observation.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-api-http-'));
const server = http.createServer((req, res) => { if (req.url === '/auth' && req.headers.authorization !== 'Bearer ' + process.env.APEX_API_TEST_TOKEN) { res.writeHead(401); res.end(); return; } if (req.url === '/leak') { res.end(JSON.stringify({secret:process.env.APEX_API_TEST_TOKEN})); return; } if (req.url === '/redirect') { res.writeHead(302, { location: 'http://example.org/' }); res.end(); return; } let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: req.method, body: body ? JSON.parse(body) : {} })); }); });
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.APEX_API_TEST_TOKEN = 'isolated-fixture-token-5267';
  const authenticated = await observeHttpCases(origin, [{ method: 'GET', path: '/auth', route: '/auth', request: {}, expectedStatus: 200, auth: { bearerEnv: 'APEX_API_TEST_TOKEN' } }]);
  assert.equal(authenticated.length, 1);
  await assert.rejects(observeHttpCases(origin, [{ method: 'GET', path: '/auth', route: '/auth', request: {}, expectedStatus: 200, auth: { bearerEnv: 'MISSING_API_TEST_TOKEN' } }]), /missing or invalid/);
  await assert.rejects(observeHttpCases(origin, [{ method: 'GET', path: '/leak', route: '/leak', request: {}, expectedStatus: 200, auth: { bearerEnv: 'APEX_API_TEST_TOKEN' } }]), /contains the authentication secret/);
  const samples = await observeHttpCases(origin, [{ method: 'GET', path: '/items', route: '/items', request: {}, expectedStatus: 200 }]);
  assert.deepEqual(samples.map(item => item.response), [{ method: 'GET', body: {} }]);
  await assert.rejects(observeHttpCases(origin, [{ method: 'POST', path: '/items', route: '/items', request: {}, expectedStatus: 200 }]), /invalid/);
  await assert.rejects(observeHttpCases(origin, [{ method: 'GET', path: '/redirect', route: '/redirect', request: {}, expectedStatus: 200 }]), /status 302/);
  await assert.rejects(observeHttpCases('http://example.org', [{ method: 'GET', path: '/', route: '/', request: {}, expectedStatus: 200 }]), /loopback/);
  await assert.rejects(observeHttpCases(origin, [{ method: 'GET', path: '/', route: '//example.org/', request: {}, expectedStatus: 200 }]), /invalid/);
  const put = (ref, value) => { const f = path.join(root, ref); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(value)); };
  const state = { artifacts: { implementationRegistration: 'registration.json', apiContract: 'contract.json' } };
  put('registration.json', {}); put('contract.json', {}); put('cases.json', {}); put(apiSamplesRef, samples);
  put(apiBrowserRef, { kind: 'runtime', status: 'passed', evidence: [{ status: 'captured', url: `${origin}/` }] });
  const registration = apiInput(root, 'registration.json'), browserCapture = apiInput(root, apiBrowserRef);
  put('operations/browser.json', { action: 'verify', status: 'succeeded', script: 'browser-capture.mjs', outputFileHashes: { [apiBrowserRef]: browserCapture.sha256 }, runInputHashes: { [registration.reference]: registration.sha256 } });
  assert.equal(observedRuntimeOrigin(root, state), origin);
  put(apiObservationRef, { kind: 'controlled-http-observation', status: 'captured', origin, projectRoot: fs.realpathSync(root), contract: apiInput(root, 'contract.json'), implementationRegistration: registration, browserCapture, cases: apiInput(root, 'cases.json'), samples: apiInput(root, apiSamplesRef) });
  put('operations/api.json', { action: 'verify', status: 'succeeded', script: 'api-contract-capture.mjs', outputFileHashes: { [apiSamplesRef]: apiInput(root, apiSamplesRef).sha256, [apiObservationRef]: apiInput(root, apiObservationRef).sha256 } });
  assert.equal(apiObservationCurrent(root, state, root, apiSamplesRef), true);
  for (const ref of ['registration.json', 'contract.json', 'cases.json', apiBrowserRef, apiSamplesRef, apiObservationRef]) { const file = path.join(root, ref), old = fs.readFileSync(file); fs.appendFileSync(file, ' '); assert.equal(apiObservationCurrent(root, state, root, apiSamplesRef), false, ref); fs.writeFileSync(file, old); }
  assert.equal(apiObservationCurrent(root, state, root, 'fake.json'), false);
  console.log(JSON.stringify({ status: 'passed', scope: 'real local HTTP and synthetic operation receipts' }));
} finally { delete process.env.APEX_API_TEST_TOKEN; await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
