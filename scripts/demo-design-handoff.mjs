import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function demoDesignHandoff(runDir, state) {
  const ref = state?.artifacts?.visualExecutionPlan;
  if (!ref) return null;
  if (typeof ref !== 'string' || path.isAbsolute(ref)) throw new Error('Demo visual plan must be Run-local');
  const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, ref));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Demo visual plan must be Run-local');
  const bytes = fs.readFileSync(file), plan = JSON.parse(bytes), rules = plan.selectionAnalysis?.skillRuleDecisions;
  if (rules === undefined) return null; // Existing confirmed plans predate the mapping.
  if (!Array.isArray(rules) || !rules.length) throw new Error('Demo visual plan has invalid Skill decisions');
  return { visualPlanRef: ref, visualPlanSha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, skillRuleDecisions: rules };
}
export function assertDemoDesignHandoff(runDir, state, actual) {
  const expected = demoDesignHandoff(runDir, state);
  if (JSON.stringify(actual || null) !== JSON.stringify(expected)) throw new Error('Demo Skill decisions do not match the current confirmed visual plan');
  return expected;
}
