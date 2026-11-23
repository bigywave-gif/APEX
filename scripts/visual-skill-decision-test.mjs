import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertVisualSkillDecisions } from './design-capability-contract.mjs';
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-skill-decisions-'));
try {
  fs.mkdirSync(path.join(run, 'advisories/visual'), { recursive: true });
  fs.writeFileSync(path.join(run, 'advisories/visual/ui-designer.json'), JSON.stringify({ execution: { tasteSkillUsage: { appliedRules: ['Establish a task hierarchy'] }, optionalSkillUsage: [{ name: 'impeccable', decision: 'applied', appliedRules: ['Keep state feedback clear'] }, { name: 'minimalist-ui', decision: 'not-applicable', appliedRules: [] }] } }));
  const mapping = (skill, rule) => ({ skill, rule, decision: 'Prioritize the main task', rationale: 'The task is the primary user goal', sourceSelectionIds: ['layout'] });
  const decisions = [mapping('taste-skill', 'Establish a task hierarchy'), mapping('impeccable', 'Keep state feedback clear')];
  const plan = { selectionAnalysis: { skillRuleDecisions: decisions }, sourceSelections: [{ id: 'layout' }] };
  assert.deepEqual(assertVisualSkillDecisions(run, plan), { status: 'mapped', rules: 2 });
  assert.throws(() => assertVisualSkillDecisions(run, { ...plan, selectionAnalysis: { skillRuleDecisions: [decisions[0]] } }), /missing a decision/);
  assert.throws(() => assertVisualSkillDecisions(run, { ...plan, selectionAnalysis: { skillRuleDecisions: [decisions[0], { ...decisions[1], sourceSelectionIds: ['unknown'] }] } }), /selected sources/);
  assert.throws(() => assertVisualSkillDecisions(run, { ...plan, selectionAnalysis: { skillRuleDecisions: [...decisions, decisions[0]] } }), /concrete decision/);
  assert.throws(() => assertVisualSkillDecisions(run, { ...plan, selectionAnalysis: { skillRuleDecisions: [decisions[0], { ...decisions[1], rule: 'invented' }] } }), /concrete decision/);
  console.log(JSON.stringify({ status: 'passed', scope: 'Skill rule to selected design decisions; semantic judgment remains human' }));
} finally { fs.rmSync(run, { recursive: true, force: true }); }
