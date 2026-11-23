import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoDesignHandoff, assertDemoDesignHandoff } from './demo-design-handoff.mjs';
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-demo-design-'));
try {
  const state = { artifacts: { visualExecutionPlan: 'plan.json' } }, file = path.join(run, 'plan.json');
  const rules = [{ skill: 'taste-skill', rule: 'hierarchy', decision: 'prioritize the task', rationale: 'help users', sourceSelectionIds: ['layout'] }];
  fs.writeFileSync(file, JSON.stringify({ selectionAnalysis: { skillRuleDecisions: rules } }));
  const bound = demoDesignHandoff(run, state); assert.deepEqual(bound.skillRuleDecisions, rules); assert.deepEqual(assertDemoDesignHandoff(run, state, bound), bound);
  assert.throws(() => assertDemoDesignHandoff(run, state, { ...bound, skillRuleDecisions: [] }), /do not match/);
  assert.throws(() => assertDemoDesignHandoff(run, state, null), /do not match/);
  fs.appendFileSync(file, ' '); assert.throws(() => assertDemoDesignHandoff(run, state, bound), /do not match/);
  fs.writeFileSync(file, JSON.stringify({ selectionAnalysis: {} })); assert.equal(assertDemoDesignHandoff(run, state, null), null);
  assert.throws(() => demoDesignHandoff(run, { artifacts: { visualExecutionPlan: '/tmp/elsewhere' } }), /Run-local/);
  console.log(JSON.stringify({ status: 'passed', scope: 'confirmed visual plan to Demo handoff and legacy compatibility' }));
} finally { fs.rmSync(run, { recursive: true, force: true }); }
