#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedInteractionFixture } from './interactive-demo-test-fixture.mjs';
import { validateLegacyDemoRecapture } from './legacy-demo-recapture.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-legacy-recapture-'));
try {
  const interactiveDemo = seedInteractionFixture(root), url = interactiveDemo.url;
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ roleChain: { confirmationModel: 'two-confirmations' } }));
  for (const journey of interactiveDemo.journeys) Object.assign(journey, { controlInventoryVersion: '1.2', observedControls: [], exercisedControls: [], controlIdentityConflicts: [], controlInventoryTruncated: false });
  const proof = interactiveDemo.journeys[0].screenshot;
  const screen = { id: 'desktop', route: '/', url, viewport: '1440x900', status: 'captured', screenshot: proof.path, screenshotSha256: proof.sha256, domHtml: proof.path, domSha256: proof.sha256, resourceObservation: { status: 'passed', url, failedResources: [], blockedRequests: [] }, controlInventory: { version: '1.2', status: 'captured', url, viewport: '1440x900', observedControls: [], identityConflicts: [], truncated: false } };
  const next = { status: 'passed', interactiveDemo, evidence: [screen] }, old = structuredClone(next);
  delete old.evidence[0].resourceObservation; delete old.evidence[0].controlInventory;
  for (const journey of old.interactiveDemo.journeys) { delete journey.failedResources; journey.controlInventoryVersion = '1.1'; }
  assert.equal(validateLegacyDemoRecapture(root, old, next).status, 'compatible');
  const reject = (mutate, target = next) => { const altered = structuredClone(target); mutate(altered); assert.throws(() => target === next ? validateLegacyDemoRecapture(root, old, altered) : validateLegacyDemoRecapture(root, altered, next)); };
  reject(value => { value.evidence[0].viewport = '390x844'; });
  reject(value => { value.evidence[0].route = '/different'; });
  reject(value => { value.evidence[0].resourceObservation.failedResources.push({ path: '/missing.css', status: 404 }); });
  reject(value => { value.evidence[0].controlInventory.observedControls.push({ key: 'id:unvisited', tag: 'button' }); });
  reject(value => { value.interactiveDemo.journeys[0].viewport = '390x844'; });
  reject(value => { value.interactiveDemo.journeys[0].steps[0].after = 'incorrect'; }, old);
  reject(value => { value.interactiveDemo.sourceManifestHash = 'sha256:changed'; }, old);
  reject(value => { value.evidence[0].domSha256 = 'sha256:changed'; }, old);
  reject(value => { value.evidence.push(value.evidence[0]); });
  // Synthetic checks ensure supplemental coverage is tied to an approved
  // transition; real browser behavior is covered by the upgrade integration.
  const withExtra = structuredClone(next), key = 'route:%2F|id:increment';
  withExtra.evidence[0].controlInventory.observedControls.push({ key, tag: 'button', role: null, type: null });
  assert.throws(() => validateLegacyDemoRecapture(root, old, withExtra));
  withExtra.interactiveDemo.supplementalJourneys = [{ ...structuredClone(withExtra.interactiveDemo.journeys[0]), id: 'supplement-0', originalJourneyId: 'add', originalStepIndex: 0, observedControls: [{ key, tag: 'button', role: null, type: null }], exercisedControls: [key] }];
  assert.equal(validateLegacyDemoRecapture(root, old, withExtra).status, 'compatible');
  const prefixed = structuredClone(withExtra), extra = prefixed.interactiveDemo.supplementalJourneys[0];
  extra.originalJourneyId = 'reset'; extra.originalStepIndex = 1; extra.prefixes = [{ journeyId: 'add', stepIndex: 0 }];
  extra.steps = structuredClone(prefixed.interactiveDemo.journeys[1].steps);
  assert.equal(validateLegacyDemoRecapture(root, old, prefixed).status, 'compatible');
  extra.prefixes[0].stepIndex = 99;
  assert.throws(() => validateLegacyDemoRecapture(root, old, prefixed));
  for (const mutate of [v => { v.originalStepIndex = 99; }, v => { v.steps[0].after = 'wrong'; }, v => { v.url = 'http://example.com/'; }, v => { v.failedResources.push({path:'/x',status:404}); }, v => { v.screenshot.sha256 = 'sha256:changed'; }]) {
    const altered = structuredClone(withExtra); mutate(altered.interactiveDemo.supplementalJourneys[0]);
    assert.throws(() => validateLegacyDemoRecapture(root, old, altered));
  }
  fs.appendFileSync(path.join(root, proof.path), 'tampered');
  assert.throws(() => validateLegacyDemoRecapture(root, old, next));
  console.log(JSON.stringify({ status: 'passed', checks: 20, note: 'Synthetic content checks only; no browser observation or authorization is asserted.' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
