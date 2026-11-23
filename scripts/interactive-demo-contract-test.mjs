#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { observedControlCoverageStatus, validateInteractionContract, verifyDemoInteractions } from './interactive-demo.mjs';
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
  const verified = verifyDemoInteractions(runDir, capture, url); checks++;
  assert.equal(verified.controlCoverage.scope, 'declared-journeys-only'); checks++;
  assert.equal(verified.controlCoverage.otherVisibleControls, 'not-inventoried'); checks++;
  assert.deepEqual(verified.controlCoverage.testedActions.map(item => item.selector), ['#increment', '#increment', '#reset']); checks++;
  const inventoried = structuredClone(capture);
  for (const journey of inventoried.interactiveDemo.journeys) { journey.controlInventoryVersion = '1.1'; journey.observedControls = [{ key: 'id:increment', tag: 'button' }, { key: 'id:settings', tag: 'button' }]; journey.exercisedControls = ['id:increment']; journey.controlInventoryTruncated = false; }
  const coverage = verifyDemoInteractions(runDir, inventoried, url).controlCoverage;
  assert.equal(coverage.scope, 'observed-journey-states-only'); checks++;
  assert.deepEqual(coverage.untestedControls.map(item => item.key), ['id:settings']); checks++;
  assert.equal(observedControlCoverageStatus(coverage).ready, false); checks++;
  assert.deepEqual(observedControlCoverageStatus(coverage).controls, ['id:settings']); checks++;
  assert.equal(observedControlCoverageStatus({ ...coverage, untestedControls: [] }).ready, true); checks++;
  assert.equal(observedControlCoverageStatus(verified.controlCoverage).ready, false); checks++;
  const oldInventory = structuredClone(inventoried); delete oldInventory.interactiveDemo.journeys[0].controlInventoryVersion;
  assert.equal(verifyDemoInteractions(runDir, oldInventory, url).controlCoverage.otherVisibleControls, 'not-inventoried'); checks++;
  const shared = { scope: 'observed-journey-states-only', truncated: false, observedControls: [{ key: 'route:/|id:home', tag: 'button', role: null, type: 'button' }, { key: 'route:/settings|id:home', tag: 'button', role: null, type: 'button' }], exercisedControls: ['route:/|id:home'], untestedControls: [{ key: 'route:/settings|id:home' }], sharedControlReviews: [{ key: 'route:/settings|id:home', equivalentTo: 'route:/|id:home', rationale: '同一导航组件在两个路由保持相同行为' }] };
  assert.equal(observedControlCoverageStatus(shared).ready, true); checks++;
  assert.equal(observedControlCoverageStatus({ ...shared, exercisedControls: [] }).ready, false); checks++;
  assert.equal(observedControlCoverageStatus({ ...shared, sharedControlReviews: [{ ...shared.sharedControlReviews[0], equivalentTo: 'route:/|id:other' }] }).ready, false); checks++;
  assert.equal(observedControlCoverageStatus({ ...shared, sharedControlReviews: [{ ...shared.sharedControlReviews[0], rationale: '一样' }] }).ready, false); checks++;
  inventoried.interactiveDemo.journeys[0].controlInventoryTruncated = true;
  assert.equal(verifyDemoInteractions(runDir, inventoried, url).controlCoverage.truncated, true); checks++;
  assert.equal(observedControlCoverageStatus(verifyDemoInteractions(runDir, inventoried, url).controlCoverage).ready, false); checks++;
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
