import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stitchAdaptationSkillLoads } from './run-ledger.mjs';
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

export function buildStitchPrompt(runDir, state, plan) {
  if (typeof plan.prompt !== 'string' || !plan.prompt.trim()) throw new Error('Stitch prompt must be nonempty text');
  if (!plan.skillUse) return { prompt: plan.prompt, adaptation: null };
  const use = plan.skillUse;
  if (use.name !== 'stitch-design-taste' || typeof use.sha256 !== 'string' || !Array.isArray(use.appliedRules) || !use.appliedRules.length || use.appliedRules.length > 8 || use.appliedRules.some(rule => typeof rule !== 'string' || !rule.trim() || rule.length > 500) || typeof use.rationale !== 'string' || !use.rationale.trim() || use.rationale.length > 1000 || !Array.isArray(use.excludedRules) || use.excludedRules.length > 8 || use.excludedRules.some(item => !item || typeof item.rule !== 'string' || !item.rule.trim() || item.rule.length > 500 || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 500)) throw new Error('Stitch skill use requires bounded applied rules, rationale, and excluded-rule reasons');
  const root = fs.realpathSync(runDir), baseline = state.artifacts?.runtimeVisualBaseline;
  if (typeof baseline !== 'string' || path.isAbsolute(baseline)) throw new Error('Stitch skill use requires the confirmed Demo baseline');
  const baselineFile = fs.realpathSync(path.resolve(root, baseline));
  if (!baselineFile.startsWith(`${root}${path.sep}`)) throw new Error('Stitch Demo baseline must remain inside the Run');
  const baselineHash = hash(fs.readFileSync(baselineFile)), operations = fs.realpathSync(path.join(root, 'operations'));
  const verified = stitchAdaptationSkillLoads(root).find(event => {
    try {
      if (event.name !== use.name || event.sha256 !== use.sha256 || event.demoBaselineHash !== baselineHash || typeof event.operationReceipt !== 'string' || path.isAbsolute(event.operationReceipt)) return false;
      const file = fs.realpathSync(path.resolve(root, event.operationReceipt));
      if (!file.startsWith(`${operations}${path.sep}`)) return false;
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (receipt.status !== 'succeeded' || receipt.action !== 'sync_stitch' || receipt.script !== 'stitch-sync.mjs') return false;
      const result = JSON.parse(receipt.stdout || '{}');
      return result.status === 'loaded' && result.skill?.name === use.name && result.skill?.sha256 === use.sha256 && result.skill?.path === event.path && hash(result.skill?.content || '') === use.sha256;
    } catch { return false; }
  });
  if (!verified) throw new Error('Stitch skill use requires a successful load receipt bound to the current confirmed Demo');
  const adaptation = { name: use.name, sha256: use.sha256, demoBaselineHash: baselineHash, loadReceipt: verified.operationReceipt, appliedRules: use.appliedRules, excludedRules: use.excludedRules, rationale: use.rationale };
  const prompt = `${plan.prompt}\n\nPreserve the confirmed Demo exactly; do not change its layout, content, interaction, tokens, or accessibility. Apply only these compatible adaptation rules:\n${use.appliedRules.map(rule => `- ${rule}`).join('\n')}`;
  return { prompt, adaptation };
}

export function stitchAdaptationForFreeze(runDir, state, job, selection) {
  if (!job?.skillAdaptation) return null;
  if (!job.promptHash || selection?.generationInput?.promptHash !== job.promptHash) throw new Error('Stitch skill adaptation requires the actual submitted prompt hash');
  const checked = buildStitchPrompt(runDir, state, { prompt: 'confirmed Demo', skillUse: job.skillAdaptation }).adaptation;
  if (JSON.stringify(checked) !== JSON.stringify(job.skillAdaptation)) throw new Error('Stitch skill adaptation changed after submission');
  return checked;
}
