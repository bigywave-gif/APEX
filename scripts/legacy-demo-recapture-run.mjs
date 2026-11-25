#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { canonicalApexRoot } from './apex-paths.mjs';
import { validateLegacyDemoRecapture } from './legacy-demo-recapture.mjs';

const apex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || '.');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const fail = message => { throw new Error(`Legacy Demo recapture failed: ${message}`); };
let server;
try {
  if (fs.realpathSync(apex) !== fs.realpathSync(canonicalApexRoot)) fail('not the canonical Core');
  const snapshot = requireRouterAction(dir, 'recapture_legacy_demo');
  if (snapshot.gates?.gate1 !== 'passed') fail('the original visual plan must be approved');
  const state = read(path.join(dir, 'state.json')), demoFile = path.join(dir, state.artifacts.runtimeDemo), demo = read(demoFile);
  if (!state.locks?.effectApproved) fail('the original Demo decision must exist');
  const captureFile = path.resolve(dir, demo.interactionEvidence?.path || '');
  if (!captureFile.startsWith(`${dir}${path.sep}`) || hash(captureFile) !== demo.interactionEvidence.sha256) fail('original capture changed');
  const original = read(captureFile), approvalRef = snapshot.executionDirective?.currentStep?.legacyApprovalRef, approvalKind = snapshot.executionDirective?.currentStep?.legacyApprovalKind;
  if (!['demo', 'visual-plan'].includes(approvalKind) || typeof approvalRef !== 'string' || !new RegExp(`^approvals/${approvalKind}-[^/]+\\.json$`).test(approvalRef.split(path.sep).join('/'))) fail('original approval is missing or invalid');
  const approval = fs.realpathSync(path.resolve(dir, approvalRef));
  if (!approval.startsWith(`${fs.realpathSync(dir)}${path.sep}`)) fail('original approval is outside the Run');
  const approvalHash = hash(approval), originalHash = hash(captureFile), demoHash = hash(demoFile);
  const token = path.basename(process.env.APEX_ROUTER_AUTHORIZATION_REF || '', '.json');
  if (!/^[a-f0-9-]{36}$/.test(token)) fail('invalid authorization identity');
  const output = path.join(dir, 'evidence', 'legacy-demo-recapture', token);
  fs.mkdirSync(output, { recursive: true });
  const screens = original.evidence.map(item => { const match = /^(\d+)x(\d+)$/.exec(item.viewport || ''); if (!match) fail('original screen viewport is missing'); return { id: item.id, route: item.route, width: Number(match[1]), height: Number(match[2]) }; });
  const spec = path.join(output, 'browser-spec.json'); fs.writeFileSync(spec, `${JSON.stringify({ screens }, null, 2)}\n`, { flag: 'wx' });
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const number = probe.address().port; probe.close(error => error ? reject(error) : resolve(number)); }); });
  const url = `http://127.0.0.1:${port}/`;
  server = spawn(process.execPath, [path.join(apex, 'scripts', 'visual-sandbox-runtime.mjs'), 'serve', path.join(dir, 'visual-sandbox'), String(port), '--apex-run-id', state.runId], { env: { ...process.env, APEX_LEGACY_CAPTURE_SERVER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('sandbox server did not become ready')), 5000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', () => { clearTimeout(timeout); reject(new Error('sandbox server exited before capture')); });
    server.stdout.on('data', chunk => { if (String(chunk).includes('APEX_LEGACY_CAPTURE_SERVER_READY')) { clearTimeout(timeout); resolve(); } });
  });
  const capture = spawnSync(process.execPath, [path.join(apex, 'scripts', 'browser-capture.mjs'), 'capture', dir, url, spec], { env: process.env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  if (capture.status !== 0) fail(`browser capture failed: ${(capture.stderr || capture.stdout || capture.error?.message || '').slice(-1200)}`);
  const capturePath = path.join(output, 'capture.json'), recaptured = read(capturePath);
  const result = validateLegacyDemoRecapture(dir, original, recaptured);
  if (hash(approval) !== approvalHash || hash(captureFile) !== originalHash || hash(demoFile) !== demoHash) fail('original confirmation evidence changed during capture');
  const binding = path.join(output, 'binding.json');
  fs.writeFileSync(binding, `${JSON.stringify({ schemaVersion: '1.0', type: 'legacy-demo-recapture', status: 'captured', runId: state.runId, approvalKind, approval: { path: approvalRef, sha256: approvalHash }, originalDemo: { path: state.artifacts.runtimeDemo, sha256: demoHash }, originalCapture: { path: path.relative(dir, captureFile), sha256: originalHash }, recapture: { path: path.relative(dir, capturePath), sha256: hash(capturePath) }, result }, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'captured', binding, capture: capturePath }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (server) server.kill('SIGTERM'); }
