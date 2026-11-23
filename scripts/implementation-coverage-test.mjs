import assert from 'node:assert/strict';
import { validateImplementationCoverage } from './implementation-coverage.mjs';
const baseline = { screenCaptures: [
  { id: 'home-desktop', url: 'http://localhost:4173/' },
  { id: 'home-mobile', url: 'http://localhost:4173/' },
  { id: 'reports', url: 'http://localhost:4173/reports' }
] };
const entries = (...ids) => ids.map(screenId => ({ screenId }));
validateImplementationCoverage({ baseline, entries: entries('home-desktop', 'reports') });
assert.throws(() => validateImplementationCoverage({ baseline, entries: entries('home-mobile') }), /route is not mapped/);
assert.throws(() => validateImplementationCoverage({ baseline, entries: entries('home-desktop', 'reports', 'other') }), /unconfirmed/);
assert.throws(() => validateImplementationCoverage({ baseline: { screenCaptures: [baseline.screenCaptures[0], baseline.screenCaptures[0]] }, entries: entries('home-desktop') }), /duplicated/);
assert.throws(() => validateImplementationCoverage({ baseline: { screenCaptures: [{ id: 'bad', url: 'not-url' }] }, entries: entries('bad') }), /invalid/);
const stitch = { approvedScreens: [{ screenId: 'one' }, { screenId: 'two' }] };
validateImplementationCoverage({ stitch, entries: entries('one', 'two') });
assert.throws(() => validateImplementationCoverage({ stitch, entries: entries('one') }), /not mapped/);
assert.throws(() => validateImplementationCoverage({ stitch, entries: entries('one', 'two', 'three') }), /unapproved/);
assert.throws(() => validateImplementationCoverage({ stitch: { approvedScreens: [{ screenId: 'one' }, { screenId: 'one' }] }, entries: entries('one') }), /invalid/);
console.log(JSON.stringify({ status: 'passed', checks: 9 }));
