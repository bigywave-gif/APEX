#!/usr/bin/env node
/** Regression test: only a confirmed selected source file may be transferred and must remain byte-identical. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
function run(script, args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
function expect(result, message) { if (result.status !== 0) throw new Error(`${message}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); }
function reject(result, message) { if (result.status === 0) throw new Error(`${message}: expected rejection`); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-materializer-'));
try {
  expect(run(router, ['intake', root, 'run-assets', 'greenfield', 'standard', 'interactive', 'asset-session']), 'intake');
  const runDir = path.join(root, '.apex', 'runs', 'run-assets');
  const stateFile = path.join(runDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.gates.gate1 = { status: 'passed', at: '2026-08-03T00:00:00.000Z', evidence: ['test'] };
  state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.locks.effectApproved = true; state.locks.visualApproved = true; state.locks.stitchSkipped = true; state.phase = 'G-07 COMPILE'; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json'; state.artifacts.visualSourceManifest = 'visual-source-manifest.json'; state.artifacts.runtimeSourceLock = 'runtime-source-lock.json';
  fs.writeFileSync(path.join(runDir, 'visual-execution-plan.json'), JSON.stringify({ sourceSelections: [{ id: 'lucide-alert', visualNodes: ['alert-icon'], kind: 'icon', sourceType: 'approved-candidate', sourceId: 'lucide', resourceId: 'triangle-alert.svg', version: '0.468.0', materialization: 'inline-transfer', parameters: {} }] }));
  fs.mkdirSync(path.join(runDir, 'visual-sandbox', 'node_modules', 'lucide', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'visual-sandbox', 'node_modules', 'lucide', 'icons', 'triangle-alert.svg'), '<svg data-lucide="triangle-alert"/>');
  const icon = path.join(runDir, 'visual-sandbox', 'node_modules', 'lucide', 'icons', 'triangle-alert.svg');
  const iconHash = `sha256:${(await import('node:crypto')).createHash('sha256').update(fs.readFileSync(icon)).digest('hex')}`;
  fs.writeFileSync(path.join(runDir, 'runtime-source-lock.json'), JSON.stringify({ schemaVersion: '3.0', projectRoot: root, runtimeRoot: 'visual-sandbox', sourceKind: 'visual-sandbox', patterns: [{ id: 'lucide-alert-pattern', sourceSelectionId: 'lucide-alert', visualNodes: ['alert-icon'], package: 'lucide', version: '0.468.0', componentPath: 'node_modules/lucide/icons/triangle-alert.svg', stylePaths: ['node_modules/lucide/icons/triangle-alert.svg'], props: {}, completeStyle: true, noCssPatch: true, files: [{ path: 'node_modules/lucide/icons/triangle-alert.svg', sha256: iconHash }] }] }));
  fs.writeFileSync(path.join(runDir, 'visual-source-manifest.json'), JSON.stringify({ schemaVersion: '3.0', sources: [{ id: 'lucide-alert-source', planSourceSelectionId: 'lucide-alert', materialization: 'inline-transfer', resolvedFiles: [{ path: 'node_modules/lucide/icons/triangle-alert.svg', sha256: iconHash }] }] }));
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const selections = path.join(root, 'materialization-selection.json');
  fs.writeFileSync(selections, JSON.stringify({ items: [{ selectionId: 'lucide-alert', sourcePath: icon, projectPath: 'src/icons/triangle-alert.svg', license: 'ISC' }] }));
  const collectAuth = expect(run(router, ['authorize', root, 'run-assets', 'asset-session', 'compile_visual_bundle']), 'collect authorization');
  expect(run(action, ['run', root, 'run-assets', 'asset-session', collectAuth.authorizationRef, 'compile_visual_bundle', 'asset-materializer.mjs', 'collect', runDir, selections]), 'collect selected asset');
  const collected = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!collected.artifacts.materializedAssets) throw new Error('materialized asset manifest was not registered');
  collected.gates.gate2 = { status: 'passed', at: '2026-08-03T00:00:00.000Z', evidence: ['test'] }; collected.locks.implementationAllowed = true;
  fs.writeFileSync(stateFile, `${JSON.stringify(collected, null, 2)}\n`);
  const lease = expect(run(router, ['lease', root, 'run-assets', 'asset-session']), 'lease');
  const applyAuth = expect(run(router, ['authorize', root, 'run-assets', 'asset-session', 'implement', lease.lease.leaseId]), 'apply authorization');
  expect(run(action, ['run', root, 'run-assets', 'asset-session', applyAuth.authorizationRef, 'implement', 'asset-materializer.mjs', 'apply', runDir, root]), 'apply selected asset');
  const auditAuth = expect(run(router, ['authorize', root, 'run-assets', 'asset-session', 'verify']), 'audit authorization');
  expect(run(action, ['run', root, 'run-assets', 'asset-session', auditAuth.authorizationRef, 'verify', 'asset-materializer.mjs', 'audit', runDir, root]), 'audit selected asset');
  fs.writeFileSync(path.join(root, 'src', 'icons', 'triangle-alert.svg'), '<svg data-lucide="substitute"/>');
  const changedAuditAuth = expect(run(router, ['authorize', root, 'run-assets', 'asset-session', 'verify']), 'changed audit authorization');
  reject(run(action, ['run', root, 'run-assets', 'asset-session', changedAuditAuth.authorizationRef, 'verify', 'asset-materializer.mjs', 'audit', runDir, root]), 'audit must reject a substituted selected asset');
  console.log(JSON.stringify({ status: 'passed', checks: 4 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
