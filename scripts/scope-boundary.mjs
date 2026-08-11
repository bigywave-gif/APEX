import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function exactSet(actual, expected) {
  const left = new Set(actual || []), right = new Set(expected || []);
  return left.size === right.size && [...left].every(item => right.has(item));
}

export function assertComponentsWithinScope(components, scope) {
  const nodes = new Set(scope?.affectedVisualNodes || []), targets = new Set(scope?.affectedRuntimeTargets || scope?.allowedRuntimeTargets || []);
  if (!nodes.size || !targets.size) throw new Error('change closure must contain affected visual nodes and runtime targets');
  for (const component of components || []) {
    if (!component?.visualNode || !nodes.has(component.visualNode)) throw new Error(`visual node is outside the confirmed change closure: ${component?.visualNode || '<unknown>'}`);
    for (const target of component.runtimeTarget || []) if (!targets.has(target)) throw new Error(`runtime target is outside the confirmed change closure: ${target}`);
  }
}

export function assertExistingPlanScope(plan, frozenScope, frozenHash) {
  const scope = plan?.scopeControl;
  if (!scope || scope.changeScopeHash !== frozenHash || scope.mode !== frozenScope?.mode || scope.presentationPolicy !== 'affected-closure-only' || scope.implementationPolicy !== 'deny-outside-change-closure' || scope.tokenPolicy !== 'inherit-existing-except-listed-deltas' || scope.regressionPolicy !== 'verify-protected-baseline-without-redesign') throw new Error('Existing visual plan must bind the frozen affected-only scope policies');
  if (!exactSet(scope.affectedVisualNodes, frozenScope.affected?.visualNodes) || !exactSet(scope.affectedRuntimeTargets, frozenScope.affected?.runtimeTargets)) throw new Error('visual plan change closure must exactly match the frozen affected boundary');
  const affectedNodes = new Set(scope.affectedVisualNodes), affectedTargets = new Set(scope.affectedRuntimeTargets);
  if ((scope.protectedVisualNodes || []).some(item => affectedNodes.has(item)) || (scope.protectedRuntimeTargets || []).some(item => affectedTargets.has(item))) throw new Error('affected and protected scope boundaries must not overlap');
  assertComponentsWithinScope(plan.components, scope);
  if ((plan.sourceSelections || []).some(item => (item.visualNodes || []).some(node => !affectedNodes.has(node)))) throw new Error('visual source selections may only describe affected visual nodes');
  if ((plan.deliveryNarrative?.changes || []).some(item => !affectedNodes.has(item.scope))) throw new Error('Existing decision narrative may only describe affected visual nodes');
  return scope;
}

export function protectedFileChecks(projectRoot, protectedFiles) {
  const root = path.resolve(projectRoot);
  return (protectedFiles || []).map(item => {
    const target = path.resolve(root, item.path || '');
    const inside = target.startsWith(`${root}${path.sep}`);
    const current = inside && fs.existsSync(target) && fs.statSync(target).isFile() ? `sha256:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}` : null;
    return { path: item.path, passed: current === item.sha256, expected: item.sha256, actual: current };
  });
}

export function protectedVisualEvidenceChecks(runDir, scopeHash, visualNodes, interactions) {
  const root = path.resolve(runDir);
  const interactionById = new Map((interactions || []).map(item => [item.id, item]));
  const artifact = value => { const target = path.resolve(root, value || ''); return target.startsWith(`${root}${path.sep}`) ? target : null; };
  const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  return (visualNodes || []).map(visualNode => {
    const evidenceFile = artifact(interactionById.get(`protected:${visualNode}`)?.evidence);
    if (!evidenceFile || !fs.existsSync(evidenceFile) || !fs.statSync(evidenceFile).isFile()) return { visualNode, passed: false, reason: 'missing-evidence' };
    let evidence;
    try { evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8')); } catch { return { visualNode, passed: false, reason: 'invalid-evidence' }; }
    const baseline = artifact(evidence.baselineScreenshot), runtime = artifact(evidence.runtimeScreenshot);
    const passed = evidence.visualNode === visualNode && evidence.changeScopeHash === scopeHash && Boolean(evidence.selector) && baseline && runtime && fs.existsSync(baseline) && fs.statSync(baseline).isFile() && fs.existsSync(runtime) && fs.statSync(runtime).isFile() && evidence.baselineHash === hash(baseline) && evidence.runtimeHash === hash(runtime) && evidence.pixelDifferenceRatio === 0 && evidence.status === 'passed';
    return { visualNode, passed: Boolean(passed), reason: passed ? null : 'changed-or-invalid-zero-diff-evidence', evidence: interactionById.get(`protected:${visualNode}`)?.evidence };
  });
}
