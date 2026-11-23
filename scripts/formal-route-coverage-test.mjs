import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { formalRouteCoverage } from './formal-route-coverage.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-formal-routes-'));
const digest = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
try {
  const baseline = { screenCaptures: [{ id: 'one', url: 'http://demo.local/', viewport: '1440x900' }, { id: 'two', url: 'http://demo.local/reports', viewport: '390x844' }] };
  const evidence = ['/', '/reports'].map((route, i) => {
    const screenshot = `screen-${i}.png`, domHtml = `screen-${i}.html`;
    fs.writeFileSync(path.join(root, screenshot), `image-${i}`); fs.writeFileSync(path.join(root, domHtml), `dom-${i}`);
    return { viewport: i ? '390x844' : '1440x900', status: 'captured', url: `http://formal.local:8080${route}`, screenshot, domHtml, screenshotSha256: digest(path.join(root, screenshot)), domSha256: digest(path.join(root, domHtml)) };
  });
  const capture = { kind: 'runtime', status: 'passed', evidence };
  fs.mkdirSync(path.join(root, 'evidence')); const captureFile = path.join(root, 'evidence/runtime-browser-capture.json'); fs.writeFileSync(captureFile, JSON.stringify(capture));
  const receipt = { action: 'verify', status: 'succeeded', script: 'browser-capture.mjs', outputFileHashes: { 'evidence/runtime-browser-capture.json': digest(captureFile) } };
  assert.equal(formalRouteCoverage(root, baseline, capture, [receipt]).status, 'ready');
  assert.match(formalRouteCoverage(root, baseline, capture, []).reason, /receipt/);
  assert.match(formalRouteCoverage(root, baseline, { ...capture, evidence: [evidence[0]] }, [receipt]).reason, /misses confirmed route and viewport/);
  assert.match(formalRouteCoverage(root, baseline, { ...capture, evidence: [evidence[0], { ...evidence[1], url: 'http://foreign.local/reports' }] }, [receipt]).reason, /one application origin/);
  const sameRoute = { screenCaptures: [baseline.screenCaptures[0], { ...baseline.screenCaptures[1], url: 'http://demo.local/' }] };
  const onlyDesktop = { ...capture, evidence: [evidence[0]] };
  assert.match(formalRouteCoverage(root, sameRoute, onlyDesktop, [receipt]).reason, /route and viewport/);
  fs.writeFileSync(path.join(root, evidence[1].screenshot), 'tampered');
  assert.match(formalRouteCoverage(root, baseline, capture, [receipt]).reason, /missing or changed/);
  assert.equal(formalRouteCoverage(root, { screenCaptures: [baseline.screenCaptures[0]] }, null, []).status, 'not-required');
  console.log(JSON.stringify({ status: 'passed', checks: 7 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
