import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gate1RoleSummaryCurrent, visualRoleSummaryCurrent, approvedRoleSummariesCurrent } from './role-summary-binding.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-role-summary-binding-'));
try {
  const run = path.join(root, 'run'); fs.mkdirSync(run);
  const summary = path.join(run, 'summary.md'); fs.writeFileSync(summary, 'product decision');
  const hash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(summary)).digest('hex')}`;
  const state = { roleChain: { enabled: true }, artifacts: { roleDecisionSummaries: { gate1: 'summary.md' } } };
  const manifest = { sources: { roleDecisionSummary: { path: 'summary.md', sha256: hash } } };
  assert.equal(gate1RoleSummaryCurrent(state, run, manifest), true);
  const visualState = { roleChain: { enabled: true }, artifacts: { roleDecisionSummaries: { visual: 'summary.md' } } };
  const visualManifest = { roleDecisionSummary: 'summary.md', roleDecisionSummarySha256: hash };
  assert.equal(visualRoleSummaryCurrent(visualState, run, visualManifest), true);
  fs.writeFileSync(path.join(run, 'product-manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(run, 'visual-manifest.json'), JSON.stringify(visualManifest));
  const approvedState = { roleChain: { enabled: true }, artifacts: { gate1PresentationManifest: 'product-manifest.json', visualPlanPresentationManifest: 'visual-manifest.json', roleDecisionSummaries: { gate1: 'summary.md', visual: 'summary.md' } } };
  assert.equal(approvedRoleSummariesCurrent(approvedState, run), true);
  fs.writeFileSync(summary, 'changed product decision');
  assert.equal(gate1RoleSummaryCurrent(state, run, manifest), false);
  assert.equal(visualRoleSummaryCurrent(visualState, run, visualManifest), false);
  assert.equal(approvedRoleSummariesCurrent(approvedState, run), false);
  fs.writeFileSync(summary, 'product decision');
  assert.equal(gate1RoleSummaryCurrent({ ...state, artifacts: { roleDecisionSummaries: { gate1: 'new-summary.md' } } }, run, manifest), false);
  assert.equal(gate1RoleSummaryCurrent(state, run, { sources: {} }), false);
  fs.symlinkSync(path.join(root, 'outside.md'), path.join(run, 'link.md')); fs.writeFileSync(path.join(root, 'outside.md'), 'product decision');
  assert.equal(gate1RoleSummaryCurrent({ ...state, artifacts: { roleDecisionSummaries: { gate1: 'link.md' } } }, run, { sources: { roleDecisionSummary: { path: 'link.md', sha256: hash } } }), false);
  assert.equal(gate1RoleSummaryCurrent({}, run, {}), true);
  console.log(JSON.stringify({ status: 'passed', checks: 10 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
