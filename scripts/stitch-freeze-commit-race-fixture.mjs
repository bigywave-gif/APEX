/** Test preload: inject a concurrent ledger commit immediately before freeze publication. */
import fs from 'node:fs';
import { commitRunState, readRunStateForUpdate } from './run-ledger.mjs';

const link = fs.linkSync;
fs.linkSync = function (source, destination, ...args) {
  const flag = process.env.APEX_STITCH_COMMIT_RACE_FLAG;
  if (flag && String(destination).includes('/evidence/stitch/freezes/stitch-freeze-') && fs.existsSync(flag)) {
    fs.unlinkSync(flag);
    const runDir = process.env.APEX_STITCH_COMMIT_RACE_RUN;
    const { state, expectedStateHash } = readRunStateForUpdate(runDir);
    state.artifacts.concurrentFreezeFixture = 'concurrent-freeze-marker.json';
    state.revision += 1;
    commitRunState(runDir, state, { reason: 'stitch-commit-race-fixture', expectedStateHash });
  }
  return link.call(fs, source, destination, ...args);
};
