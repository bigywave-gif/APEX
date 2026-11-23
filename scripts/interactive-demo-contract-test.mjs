#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateInteractionContract, verifyDemoInteractions } from './interactive-demo.mjs';
import { demoContract, seedInteractionFixture } from './interactive-demo-test-fixture.mjs';

let checks = 0;
const reject = fn => { assert.throws(fn); checks++; };
validateInteractionContract(demoContract, ['添加示例项目']); checks++;
reject(() => validateInteractionContract(null));
reject(() => validateInteractionContract({ ...demoContract, journeys: [] }));
reject(() => validateInteractionContract({ ...demoContract, dataMode: 'production' }));
reject(() => validateInteractionContract(demoContract, ['未实现的任务']));
reject(() => validateInteractionContract({ ...demoContract, journeys: [demoContract.journeys[0]] }));
const unchanged = structuredClone(demoContract); unchanged.journeys[0].steps[0].after.equals = '0';
reject(() => validateInteractionContract(unchanged));
const external = structuredClone(demoContract); external.journeys[0].route = '//example.com/';
reject(() => validateInteractionContract(external));
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-interactive-contract-'));
try {
  const interactiveDemo = seedInteractionFixture(runDir), url = interactiveDemo.url;
  const capture = { status: 'passed', interactiveDemo };
  verifyDemoInteractions(runDir, capture, url); checks++;
  const legacyCapture = structuredClone(capture);
  for (const journey of legacyCapture.interactiveDemo.journeys) { delete journey.finalUrl; delete journey.viewport; }
  verifyDemoInteractions(runDir, legacyCapture, url); checks++;
  reject(() => verifyDemoInteractions(runDir, legacyCapture, url, { requireJourneyLocation: true }));
  const located = structuredClone(capture);
  for (const journey of located.interactiveDemo.journeys) { journey.finalUrl = journey.url; journey.viewport = '1440x900'; }
  verifyDemoInteractions(runDir, located, url, { requireJourneyLocation: true }); checks++;
  delete located.interactiveDemo.journeys[0].viewport;
  reject(() => verifyDemoInteractions(runDir, located, url, { requireJourneyLocation: true }));
  reject(() => verifyDemoInteractions(runDir, { status: 'passed' }, url));
  const wrongResult = structuredClone(capture); wrongResult.interactiveDemo.journeys[0].steps[0].after = '0';
  reject(() => verifyDemoInteractions(runDir, wrongResult, url));
  const stale = structuredClone(capture); stale.interactiveDemo.contractHash = 'sha256:old';
  reject(() => verifyDemoInteractions(runDir, stale, url));
  const network = structuredClone(capture); network.interactiveDemo.journeys[0].blockedRequests = ['https://production.invalid'];
  reject(() => verifyDemoInteractions(runDir, network, url));
  const noNotice = structuredClone(capture); noNotice.interactiveDemo.journeys[0].noticeVisible = false;
  reject(() => verifyDemoInteractions(runDir, noNotice, url));
  const foreignFinalUrl = structuredClone(capture); foreignFinalUrl.interactiveDemo.journeys[0].finalUrl = 'https://outside.invalid/';
  reject(() => verifyDemoInteractions(runDir, foreignFinalUrl, url));
  const invalidViewport = structuredClone(capture); invalidViewport.interactiveDemo.journeys[0].viewport = '0x900';
  reject(() => verifyDemoInteractions(runDir, invalidViewport, url));
  const duplicate = structuredClone(capture); duplicate.interactiveDemo.journeys[1] = duplicate.interactiveDemo.journeys[0];
  reject(() => verifyDemoInteractions(runDir, duplicate, url));
  fs.appendFileSync(path.join(runDir, 'evidence/fixture.txt'), 'tampered');
  reject(() => verifyDemoInteractions(runDir, capture, url));
  const fresh = { status: 'passed', interactiveDemo: seedInteractionFixture(runDir) };
  fs.appendFileSync(path.join(runDir, 'visual-sandbox/index.html'), '<!-- changed -->');
  reject(() => verifyDemoInteractions(runDir, fresh, url));
  console.log(JSON.stringify({ status: 'passed', checks }));
} finally { fs.rmSync(runDir, { recursive: true, force: true }); }
