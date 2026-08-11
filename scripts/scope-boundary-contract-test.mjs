#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertExistingPlanScope, protectedFileChecks, protectedVisualEvidenceChecks } from './scope-boundary.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-scope-boundary-'));
function digest(value) { return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`; }
function expectFailure(fn, message) { try { fn(); } catch { return; } throw new Error(message); }
try {
  const affectedFile = 'src/widgets/RevenueChart.tsx', protectedFile = 'src/layout/AppShell.tsx';
  fs.mkdirSync(path.join(root, 'src', 'widgets'), { recursive: true }); fs.mkdirSync(path.join(root, 'src', 'layout'), { recursive: true });
  fs.writeFileSync(path.join(root, affectedFile), 'export const RevenueChart = true;\n');
  fs.writeFileSync(path.join(root, protectedFile), 'export const AppShell = true;\n');
  const scopeHash = digest('scope-contract');
  const frozen = {
    schemaVersion: '3.0', mode: 'localized',
    requestedChanges: [{ target: 'revenue-chart', kind: 'data-display', change: 'adjust chart labels', reason: 'improve readability' }],
    affected: { routes: ['/report'], pages: ['report'], visualNodes: ['revenue-chart'], dataViews: ['revenue'], runtimeTargets: [affectedFile] },
    protected: { policy: 'preserve-unless-explicitly-in-change-closure', routes: ['/report'], pages: ['report'], visualNodes: ['app-shell'], runtimeTargets: [protectedFile], files: [{ path: protectedFile, sha256: digest('export const AppShell = true;\n') }] },
    impactAnalysis: { closureMethod: 'target-plus-transitive-runtime-dependencies', crossCuttingChanges: [], outOfScopeImpact: 'none' },
    presentationPolicy: { confirmationContent: 'affected-closure-only', unchangedContent: 'reference-baseline-without-republication' }, status: 'frozen'
  };
  const scopeFile = path.join(root, 'change-scope.json'); fs.writeFileSync(scopeFile, JSON.stringify(frozen));
  const validSchema = spawnSync(process.execPath, [validator, 'validate', 'change-scope.schema.json', scopeFile], { encoding: 'utf8' });
  if (validSchema.status !== 0) throw new Error(`valid localized scope was rejected: ${validSchema.stderr || validSchema.stdout}`);
  const basePlan = {
    scopeControl: { mode: 'localized', changeScopeHash: scopeHash, affectedVisualNodes: ['revenue-chart'], affectedRuntimeTargets: [affectedFile], protectedVisualNodes: ['app-shell'], protectedRuntimeTargets: [protectedFile], presentationPolicy: 'affected-closure-only', implementationPolicy: 'deny-outside-change-closure', tokenPolicy: 'inherit-existing-except-listed-deltas', tokenDeltas: [], unchangedSummary: 'App shell and other report content retain the Existing baseline.', regressionPolicy: 'verify-protected-baseline-without-redesign' },
    components: [{ visualNode: 'revenue-chart', runtimeTarget: [affectedFile] }],
    sourceSelections: [{ visualNodes: ['revenue-chart'] }],
    deliveryNarrative: { changes: [{ scope: 'revenue-chart' }] }
  };
  assertExistingPlanScope(basePlan, frozen, scopeHash);
  expectFailure(() => assertExistingPlanScope({ ...basePlan, components: [{ visualNode: 'app-shell', runtimeTarget: [protectedFile] }] }, frozen, scopeHash), 'out-of-scope visual nodes must be rejected');
  expectFailure(() => assertExistingPlanScope({ ...basePlan, sourceSelections: [{ visualNodes: ['revenue-chart', 'app-shell'] }] }, frozen, scopeHash), 'out-of-scope source selections must be rejected');
  if (!protectedFileChecks(root, frozen.protected.files).every(item => item.passed)) throw new Error('unchanged protected file must pass');
  const baselineShot = 'baseline-shell.png', runtimeShot = 'runtime-shell.png', pixels = Buffer.from('same-rendered-region');
  fs.writeFileSync(path.join(root, baselineShot), pixels); fs.writeFileSync(path.join(root, runtimeShot), pixels);
  const visualEvidencePath = 'protected-shell.json';
  fs.writeFileSync(path.join(root, visualEvidencePath), JSON.stringify({ visualNode: 'app-shell', changeScopeHash: scopeHash, selector: '[data-testid=app-shell]', baselineScreenshot: baselineShot, runtimeScreenshot: runtimeShot, baselineHash: digest(pixels), runtimeHash: digest(pixels), pixelDifferenceRatio: 0, status: 'passed' }));
  const interaction = [{ id: 'protected:app-shell', result: 'passed', evidence: visualEvidencePath }];
  if (!protectedVisualEvidenceChecks(root, scopeHash, ['app-shell'], interaction).every(item => item.passed)) throw new Error('unchanged protected visual node must pass zero-diff evidence');
  const changedEvidence = JSON.parse(fs.readFileSync(path.join(root, visualEvidencePath))); changedEvidence.pixelDifferenceRatio = 0.01; fs.writeFileSync(path.join(root, visualEvidencePath), JSON.stringify(changedEvidence));
  if (protectedVisualEvidenceChecks(root, scopeHash, ['app-shell'], interaction).every(item => item.passed)) throw new Error('changed protected visual node must fail');
  fs.writeFileSync(path.join(root, protectedFile), 'export const AppShell = false;\n');
  if (protectedFileChecks(root, frozen.protected.files).every(item => item.passed)) throw new Error('changed protected file must fail');
  console.log(JSON.stringify({ status: 'passed', cases: ['localized-schema', 'affected-node-closure', 'source-selection-closure', 'protected-file-hash', 'protected-visual-zero-diff'] }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
