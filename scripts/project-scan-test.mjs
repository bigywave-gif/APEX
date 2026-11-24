import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanProjectSources, projectScanOptions, expandedProjectScanOptions } from './project-scan.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-scan-'));
try {
  for (const file of ['src/pages/App.tsx', 'src/pages/index.ts', 'src/pages/other.ts', 'node_modules/ignored/index.js', '.worktrees/other/index.js', '.venv-custom/pyvenv.cfg', '.venv-custom/lib/index.py']) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  }
  const partial = scanProjectSources(root, { maxSourceFiles: 2, maxEntrypoints: 1, maxRoutes: 1 });
  assert.equal(partial.coverage.sourceTruncated, true);
  assert.equal(partial.coverage.entrypointsTruncated, true);
  assert.equal(partial.coverage.routesTruncated, true);
  assert.equal(partial.coverage.complete, false);
  assert.deepEqual(expandedProjectScanOptions(partial.coverage), { maxSourceFiles: 4, maxEntrypoints: 2, maxRoutes: 2 });
  assert.throws(() => expandedProjectScanOptions({ ...partial.coverage, sourceLimit: 1000000 }), /limit reached/);
  const complete = scanProjectSources(root, { maxSourceFiles: 3, maxEntrypoints: 2, maxRoutes: 3 });
  assert.equal(complete.coverage.sourceCount, 3);
  assert.equal(complete.coverage.entrypointCount, 2);
  assert.equal(complete.coverage.routeCount, 3);
  assert.equal(complete.coverage.complete, true);
  assert.deepEqual(complete.excludedVirtualEnvironments, ['.venv-custom']);
  assert.throws(() => expandedProjectScanOptions(complete.coverage), /no truncated/);
  assert.throws(() => projectScanOptions({ maxSourceFiles: 0 }));
  assert.throws(() => projectScanOptions({ maxRoutes: 1000001 }));
  assert.throws(() => projectScanOptions({ unknown: 1 }));
  const packageOnly = path.join(root, 'package-only'); fs.mkdirSync(path.join(packageOnly, 'a'), { recursive: true }); fs.mkdirSync(path.join(packageOnly, 'b'));
  fs.writeFileSync(path.join(packageOnly, 'a/package.json'), '{}'); fs.writeFileSync(path.join(packageOnly, 'b/package.json'), '{}');
  const limitedPackages = scanProjectSources(packageOnly, { maxSourceFiles: 1 });
  assert.equal(limitedPackages.coverage.sourceTruncated, true); assert.equal(limitedPackages.packageManifests.length, 1);
  const completePackages = scanProjectSources(packageOnly, expandedProjectScanOptions(limitedPackages.coverage));
  assert.equal(completePackages.coverage.complete, true); assert.equal(completePackages.packageManifests.length, 2);
  console.log(JSON.stringify({ status: 'passed', scope: 'scan limits, exact boundaries and ignored directories' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
