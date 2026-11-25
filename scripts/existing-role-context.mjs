import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

// Match a concrete captured route to common single and catch-all dynamic route
// segments; the query must match when the affected scope specifies one.
export function existingRouteMatches(pattern, actual) {
  if (typeof pattern !== 'string' || typeof actual !== 'string' || !pattern.startsWith('/') || !actual.startsWith('/') || pattern.startsWith('//') || actual.startsWith('//') || pattern.includes('\\') || actual.includes('\\') || pattern.includes('#') || actual.includes('#')) return false;
  if (pattern === actual) return true;
  const [patternPath, ...patternQuery] = pattern.split('?'), [actualPath, ...actualQuery] = actual.split('?');
  if (patternQuery.length && patternQuery.join('?') !== actualQuery.join('?')) return false;
  const parts = patternPath.split('/'), values = actualPath.split('/'); let index = 0;
  for (const part of parts) {
    if (/^\[\[\.\.\.[A-Za-z_][\w-]*\]\]$/.test(part)) return index === parts.length - 1;
    if (/^\[\.\.\.[A-Za-z_][\w-]*\]$/.test(part)) return index === parts.length - 1 && values.length > index && values.slice(index).every(Boolean);
    if (index >= values.length) return false;
    if (/^(?::[A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*\])$/.test(part)) { if (!values[index]) return false; }
    else if (part !== values[index]) return false;
    index++;
  }
  return index === values.length;
}

// Bind the actual Existing screenshots and DOM snapshots without putting their
// binary content or full DOM in every role payload. These are evidence of the
// current state, not a finding that its appearance or interactions are good.
export function existingRoleContext(runDir, state) {
  const root = fs.realpathSync(runDir), project = fs.realpathSync(path.resolve(root, '..', '..', '..'));
  const inside = (base, file) => file.startsWith(`${base}${path.sep}`);
  const local = reference => {
    if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new Error('invalid Existing evidence reference');
    const file = fs.realpathSync(path.resolve(root, reference));
    if (!inside(root, file) || !fs.statSync(file).isFile()) throw new Error('Existing evidence is outside the current Run');
    return file;
  };
  const reference = state.artifacts?.existingBaseline, baselineFile = local(reference), baselineBytes = fs.readFileSync(baselineFile), baseline = JSON.parse(baselineBytes);
  const captureRef = baseline.displayEvidence?.path, captureFile = local(captureRef), captureBytes = fs.readFileSync(captureFile), capture = JSON.parse(captureBytes);
  if (baseline.displayEvidence?.hash !== hash(captureBytes) || capture.kind !== 'existing' || capture.status !== 'passed' || !Array.isArray(capture.evidence) || !capture.evidence.length || capture.evidence.length > 1000) throw new Error('Existing browser capture is missing or does not match the baseline');
  const screens = capture.evidence.map(item => {
    if (item.status !== 'captured' || typeof item.route !== 'string' || typeof item.viewport !== 'string') throw new Error('Existing screen capture is incomplete');
    const screenshot = local(item.screenshot), dom = local(item.domHtml);
    if (hash(fs.readFileSync(screenshot)) !== item.screenshotSha256 || hash(fs.readFileSync(dom)) !== item.domSha256) throw new Error('Existing screenshot or DOM changed after capture');
    return { route: item.route, viewport: item.viewport, screenshot: item.screenshot, screenshotSha256: item.screenshotSha256, dom: item.domHtml, domSha256: item.domSha256 };
  });
  if (!Array.isArray(baseline.screens) || !baseline.screens.length || baseline.screens.some(screen => {
    try { const actual = fs.realpathSync(path.resolve(project, screen.path)); return !inside(root, actual) || !screens.some(item => item.viewport === screen.viewport && local(item.screenshot) === actual); } catch { return true; }
  })) throw new Error('Existing baseline screens do not match the captured evidence');
  let scope = null;
  if (state.artifacts?.changeScope) {
    const scopeRef = state.artifacts.changeScope, scopeBytes = fs.readFileSync(local(scopeRef)), value = JSON.parse(scopeBytes);
    if (!['localized', 'page', 'page-family', 'sitewide'].includes(value.mode) || !Array.isArray(value.affected?.routes)) throw new Error('Existing change scope is invalid');
    const routes = [...new Set(value.affected.routes)];
    if (routes.some(route => typeof route !== 'string' || !route.startsWith('/'))) throw new Error('Existing change scope routes are invalid');
    if (value.mode === 'sitewide' && (!routes.length || routes.some(route => !screens.some(item => existingRouteMatches(route, item.route))))) throw new Error('sitewide scope has a route without a captured screen');
    scope = { path: scopeRef, sha256: hash(scopeBytes), mode: value.mode, affectedRoutes: routes };
  }
  return { schemaVersion: '1.0', baseline: { path: reference, sha256: hash(baselineBytes) }, capture: { path: captureRef, sha256: hash(captureBytes) }, scope, screens, instruction: 'Review the relevant actual screenshots and DOM for the requested pages and viewports; distinguish observed existing problems from proposals. The product manager must cite a screenshot or DOM path and the UI designer must cite a screenshot path in a factual finding. For sitewide work cite evidence for each affected route. Capture is not a quality judgment.' };
}

// Validate references and require the two responsible professions to cite
// at least one actual captured screen or DOM as a factual observation.
export function validateExistingRoleFindings(selection, advisory) {
  const allowed = new Set(selection.inputBindings.flatMap(binding => [binding.artifact, binding.path, `${binding.artifact}:${binding.path}`]));
  const observed = new Set((selection.existingContext?.screens || []).flatMap(screen => [screen.screenshot, screen.dom]));
  for (const reference of observed) allowed.add(reference);
  for (const finding of advisory.findings || []) for (const evidence of finding.evidence || []) if (!allowed.has(evidence)) throw new Error(`role advisory evidence is not a current frozen stage binding: ${advisory.roleId}/${evidence}`);
  const designer = selection.existingContext && advisory.stage === 'visual' && advisory.roleId === 'ui-designer';
  const required = designer || (selection.existingContext && advisory.stage === 'gate1' && advisory.roleId === 'product-manager');
  const acceptable = designer ? new Set(selection.existingContext.screens.map(screen => screen.screenshot)) : observed;
  const facts = (advisory.findings || []).filter(finding => finding.classification === 'fact');
  if (required && !facts.some(finding => (finding.evidence || []).some(reference => acceptable.has(reference)))) throw new Error(`Existing product/design review must cite an actual current screenshot${designer ? '' : ' or DOM'} observation: ${advisory.roleId}`);
  if (required && selection.existingContext.scope?.mode === 'sitewide') for (const route of selection.existingContext.scope.affectedRoutes) {
    const routeEvidence = new Set(selection.existingContext.screens.filter(screen => existingRouteMatches(route, screen.route)).flatMap(screen => designer ? [screen.screenshot] : [screen.screenshot, screen.dom]));
    if (!facts.some(finding => (finding.evidence || []).some(reference => routeEvidence.has(reference)))) throw new Error(`Existing sitewide review must cite captured evidence for each affected route: ${advisory.roleId}/${route}`);
  }
}
