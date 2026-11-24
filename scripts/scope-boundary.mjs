import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function exactSet(actual, expected) {
  const left = new Set(actual || []), right = new Set(expected || []);
  return left.size === right.size && [...left].every(item => right.has(item));
}

const unchangedBaselineSentence = '未列入本次变更闭包的内容沿用已冻结 Existing 基线，不重新罗列、不重新设计、不再次确认。';

function presentationTermGroups(values) {
  return (values || []).map(value => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return [];
    const basename = path.basename(raw);
    const stem = basename.replace(/\.[^.]+$/, '');
    // Entry-point stems such as "main" are too generic to establish that a
    // human-readable proposal republishes a protected file. Keep the full
    // path/basename signal, but do not treat generic implementation words as
    // leaked presentation content.
    const genericStems = new Set(['main', 'index', 'app', 'style', 'styles', 'token', 'tokens', 'theme', 'themes', 'variables']);
    return [...new Set([raw, basename, ...(genericStems.has(stem) ? [] : [stem, stem.replace(/[\\/_:.-]+/g, ' ')]), raw.replace(/[\\/_:.-]+/g, ' ')]
      .map(item => item.trim()).filter(item => item.length >= 3))];
  }).filter(group => group.length);
}

function presentationTerms(values) {
  return new Set(presentationTermGroups(values).flat());
}

function boundaryTerms(boundary) {
  return presentationTerms([
    ...(boundary?.routes || []), ...(boundary?.pages || []), ...(boundary?.visualNodes || []),
    ...(boundary?.dataViews || []), ...(boundary?.runtimeTargets || []),
    ...((boundary?.files || []).map(item => item.path))
  ]);
}

/**
 * Enforces the user-readable counterpart of change-scope.json.  This is
 * intentionally checked both when a presentation is recorded and again when
 * Router considers exposing its confirmation, so stale or hand-edited copy
 * cannot republish the protected site.
 */
export function assertAffectedOnlyPresentation(content, scope, { requireBaselineSection = false } = {}) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('affected-only presentation must contain user-readable content');
  if (!scope || scope.presentationPolicy?.confirmationContent !== 'affected-closure-only' || scope.presentationPolicy?.unchangedContent !== 'reference-baseline-without-republication') throw new Error('affected-only presentation requires the frozen localized presentation policy');

  const sitewide = scope.mode === 'sitewide';
  const affected = boundaryTerms(scope.affected);
  const protectedOnly = [...boundaryTerms(scope.protected)].filter(term => !affected.has(term));
  const normalized = content.toLowerCase();
  const leaked = protectedOnly.find(term => normalized.includes(term));
  if (!sitewide && leaked) throw new Error(`presentation republishes protected Existing content: ${leaked}`);

  const affectedNodeGroups = presentationTermGroups(scope.affected?.visualNodes);
  const missing = affectedNodeGroups.filter(group => !group.some(term => normalized.includes(term))).map(group => group[0]);
  if (missing.length) throw new Error(`presentation does not identify every affected visual node: ${missing.join(', ')}`);

  if (requireBaselineSection) {
    const heading = '### 明确保留内容';
    const start = content.indexOf(heading);
    if (start < 0) throw new Error(`affected-only Gate 1 presentation requires ${heading}`);
    const remainder = content.slice(start + heading.length);
    const nextHeading = remainder.search(/^#{2,3}\s/m);
    const block = (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
    if (!sitewide && block !== unchangedBaselineSentence) throw new Error('unchanged Existing content must use the single bounded baseline reference without a list or redesign narrative');
    if (sitewide && !block) throw new Error('site-wide redesign must explain what existing content and behavior are preserved');
  }

  const withoutBaselineReference = normalized.replace(unchangedBaselineSentence.toLowerCase(), '');
  if (!sitewide && /(全站|整站|全部页面|所有页面)/.test(withoutBaselineReference)) throw new Error('localized presentation must not expand into a site-wide proposal');
  return {
    status: 'passed', policy: 'affected-closure-only',
    affectedVisualNodes: scope.affected?.visualNodes || [],
    protectedContent: sitewide ? 'preservation-may-be-described' : 'not-republished', unchangedContent: sitewide ? 'preservation-explained' : 'single-baseline-reference'
  };
}

export { unchangedBaselineSentence };

// Site-wide redesigns must explain every page in the frozen affected set.
// A shared issue may explicitly name several pages; prose is not proof that
// the issue is true, so the existing browser and code baseline remains required.
export function assertSitewideNarrativeCoverage(narrative, scope) {
  if (scope?.mode !== 'sitewide') return;
  const pages = scope.affected?.pages, changes = narrative?.changes;
  if (!Array.isArray(pages) || !pages.length || !Array.isArray(changes) || !changes.length) throw new Error('site-wide redesign needs frozen affected pages and page-specific changes');
  const allowed = new Set(pages), covered = new Set();
  for (const item of changes) {
    const references = item.pages ?? (allowed.has(item.scope) ? [item.scope] : []);
    if (!Array.isArray(references) || !references.length || references.some(page => typeof page !== 'string' || !allowed.has(page))) throw new Error('site-wide change must identify pages in the frozen affected scope');
    if (![item.currentIssue, item.change, item.why, item.resolvedOutcome].every(value => typeof value === 'string' && value.trim())) throw new Error('site-wide change must describe the current issue, change, reason and outcome');
    references.forEach(page => covered.add(page));
  }
  const missing = pages.filter(page => !covered.has(page));
  if (missing.length) throw new Error(`site-wide redesign lacks a current issue, change and outcome for affected pages: ${missing.join(', ')}`);
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
    let current = null;
    try {
      if (typeof item.path === 'string' && !path.isAbsolute(item.path) && target.startsWith(`${root}${path.sep}`) && fs.realpathSync(target).startsWith(`${fs.realpathSync(root)}${path.sep}`) && fs.statSync(target).isFile()) current = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
    } catch { /* A missing or inaccessible file fails the protected baseline check. */ }
    return { path: item.path, passed: /^sha256:[a-f0-9]{64}$/.test(item.sha256 || '') && current === item.sha256, expected: item.sha256, actual: current };
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
