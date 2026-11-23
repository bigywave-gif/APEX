import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { agentRuntimeStatus, readRunState, visualSkillLoads } from './run-ledger.mjs';
import { requiredTasteLoadCurrent, optionalSkillLoadCurrent } from './required-visual-skill.mjs';

export function assertVisualCapabilityEvidence(runDir, capabilities) {
  const selection = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories/visual/selection.json'), 'utf8'));
  const advisoryPath = path.join(runDir, 'advisories/visual/ui-designer.json');
  const bytes = fs.readFileSync(advisoryPath), advisory = JSON.parse(bytes);
  const id = selection.agentJobs?.['ui-designer'];
  const job = agentRuntimeStatus(runDir, id).jobs.find(item => item.jobId === id);
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  const taste = advisory.execution?.tasteSkillUsage;
  if (!selection.selectedRoles?.includes('ui-designer') || !id || job?.status !== 'succeeded' || job.agentId !== 'ui-designer' || job.stage !== 'visual' || job.result?.sha256 !== digest || job.payload?.tasteSkill?.sha256 !== selection.tasteSkill?.sha256 || !taste?.sha256 || taste.sha256 !== selection.tasteSkill?.sha256 || !taste.appliedRules?.some(rule => typeof rule === 'string' && rule.trim())) throw new Error('visual plan requires a current completed designer job with the loaded taste-skill and applicable rules');
  if (readRunState(runDir).roleChain?.confirmationModel === 'two-confirmations') {
    if (!requiredTasteLoadCurrent(runDir, id, job.attempt, advisory.execution?.leaseToken, job.payload.tasteSkill)) throw new Error('visual plan requires the current successful taste-skill load receipt');
    const loads = visualSkillLoads(runDir, id, job.attempt).filter(event => optionalSkillLoadCurrent(runDir, event, advisory.execution?.leaseToken));
    if ((advisory.execution?.optionalSkillUsage || []).some(usage => !loads.some(event => event.name === usage.name && event.sha256 === usage.sha256))) throw new Error('visual plan requires current successful receipts for cited optional Skills');
  }
  if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length || !capabilities.includes('taste-skill')) throw new Error('visual plan must cite the mandatory taste-skill exactly once');
  const applied = new Set(['taste-skill']);
  for (const usage of advisory.execution?.optionalSkillUsage || []) if (usage.decision === 'applied') applied.add(usage.name);
  const missing = [...applied].filter(name => !capabilities.includes(name));
  const unproven = capabilities.filter(name => !applied.has(name));
  if (missing.length || unproven.length) throw new Error(`visual plan capability claims differ from the designer advisory: missing=${missing.join(',')} unproven=${unproven.join(',')}`);
  return { tasteHash: taste.sha256, applied: [...applied].sort(), designerAdvisoryHash: digest };
}

/** Structural traceability only; a designer still judges whether the mapping is appropriate. */
export function assertVisualSkillDecisions(runDir, plan) {
  const advisory = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories/visual/ui-designer.json'), 'utf8'));
  const required = [{ skill: 'taste-skill', rules: advisory.execution?.tasteSkillUsage?.appliedRules || [] }, ...(advisory.execution?.optionalSkillUsage || []).filter(item => item.decision === 'applied').map(item => ({ skill: item.name, rules: item.appliedRules || [] }))];
  const mappings = plan.selectionAnalysis?.skillRuleDecisions, selections = new Set((plan.sourceSelections || []).map(item => item.id));
  if (!Array.isArray(mappings) || !mappings.length) throw new Error('visual plan must map applied designer Skill rules to concrete design decisions');
  const expected = new Set(required.flatMap(item => item.rules.map(rule => JSON.stringify([item.skill, rule])))), seen = new Set();
  for (const item of mappings) {
    const key = JSON.stringify([item?.skill, item?.rule]);
    if (!expected.has(key) || seen.has(key) || typeof item.decision !== 'string' || !item.decision.trim() || typeof item.rationale !== 'string' || !item.rationale.trim() || !Array.isArray(item.sourceSelectionIds) || !item.sourceSelectionIds.length || item.sourceSelectionIds.some(id => !selections.has(id))) throw new Error('visual Skill decision must bind one applied rule to a concrete decision and selected sources');
    seen.add(key);
  }
  if ([...expected].some(key => !seen.has(key))) throw new Error('visual plan is missing a decision for an applied designer Skill rule');
  return { status: 'mapped', rules: seen.size };
}
