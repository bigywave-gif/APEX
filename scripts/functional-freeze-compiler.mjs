#!/usr/bin/env node
/**
 * Materialize the Existing functional freeze from the immutable baseline.
 *
 * This deliberately does not accept free-form user prose.  Its output is a
 * source-bound description of what the current page already renders and which
 * pieces are inside the approved change closure.  That gives Gate 1 a real
 * contract instead of the init-time template that previously leaked through
 * to the approval validator.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { archiveArtifacts, commitRunState, readRunState } from './run-ledger.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, runArg] = process.argv.slice(2);
const fail = message => { console.error(`Functional freeze compile failed: ${message}`); process.exit(1); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const sha256 = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const placeholder = value => typeof value === 'string'
  ? /(^replace$|\breplace[-\w ]*|<[^>]+>)/i.test(value)
  : Array.isArray(value) ? value.some(placeholder)
    : Boolean(value && typeof value === 'object' && Object.values(value).some(placeholder));
const runArtifact = (runDir, reference, label) => {
  const target = path.resolve(runDir, reference || '');
  if (!reference || !target.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(target)) fail(`${label} is missing or outside the Run`);
  return target;
};

if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) fail(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg) fail('usage: compile <run-dir>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'collect_existing_baseline'); } catch (error) { fail(error.message); }
const state = readRunState(runDir);
if (state.track !== 'existing') fail('functional freeze is only valid for an Existing run');
const referenceFile = runArtifact(runDir, state.artifacts?.codeReference, 'complete code reference');
const skeletonFile = runArtifact(runDir, state.artifacts?.pageSkeleton, 'page skeleton');
const baselineFile = runArtifact(runDir, state.artifacts?.existingBaseline, 'Existing baseline');
const scopeFile = runArtifact(runDir, state.artifacts?.changeScope, 'change scope');
const reference = read(referenceFile), skeleton = read(skeletonFile), baseline = read(baselineFile), scope = read(scopeFile);
if (reference.complete !== true || !Array.isArray(reference.files) || !reference.files.length || !skeleton.skeletonHash || !Array.isArray(skeleton.nodes) || !skeleton.nodes.length) fail('current baseline evidence is incomplete');
if (placeholder(baseline) || placeholder(scope)) fail('baseline or change scope contains unresolved template placeholders');
const projectRoot = path.resolve(reference.projectRoot || path.join(runDir, '..', '..', '..'));
const allowedTargets = new Set(scope.affected?.runtimeTargets || []);
const selectedNodes = scope.affected?.visualNodes || [];
if (!allowedTargets.size || !selectedNodes.length) fail('change scope must name affected runtime targets and visual nodes');
const referenceByPath = new Map(reference.files.map(item => [item.path, item]));
if ([...allowedTargets].some(target => !referenceByPath.has(target))) fail('change scope contains a target missing from the immutable code reference');
const sourceText = new Map();
for (const target of allowedTargets) {
  const file = path.resolve(projectRoot, target);
  const snapshot = path.resolve(runDir, referenceByPath.get(target).copyPath || '');
  if (!file.startsWith(`${projectRoot}${path.sep}`) || !snapshot.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(file) || !fs.existsSync(snapshot) || sha256(file) !== referenceByPath.get(target).sha256 || sha256(snapshot) !== referenceByPath.get(target).sha256) fail(`current source does not match immutable reference: ${target}`);
  sourceText.set(target, fs.readFileSync(snapshot, 'utf8'));
}
const closureText = [...sourceText.values()].join('\n');
const stateNames = [...closureText.matchAll(/(?:const|let)\s*\[\s*([A-Za-z_$][\w$]*)\s*,[^\]]+\]\s*=\s*useState\s*\(/g)].map(match => match[1]);
const events = [];
if (/addEventListener\s*\(\s*["']resize["']/.test(closureText)) events.push('窗口 resize 触发既有画布缩放与图表 resize；来源为冻结的运行时代码。');
if (/setInterval\s*\(/.test(closureText)) events.push('既有定时器驱动倒计时或榜单状态更新；来源为冻结的运行时代码。');
const api = /\b(fetch|axios|XMLHttpRequest)\s*\(/.test(closureText) ? ['当前受影响代码闭包中检测到网络调用；实现阶段不得在未批准契约外改变其请求语义。'] : [];
const sourcePaths = [...allowedTargets].sort();
const skeletonPaths = [...new Set((skeleton.nodes || []).filter(node => allowedTargets.has(node.sourcePath)).map(node => node.sourcePath))].sort();
const dispositionFor = node => (scope.requestedChanges || []).some(change => change.kind === 'accessibility' || change.kind === 'responsive') ? 'change-approved' : 'preserve';
const items = selectedNodes.map((name, index) => ({
  id: `existing-${index + 1}`,
  name,
  disposition: dispositionFor(name),
  dom: [`${name} 仅绑定冻结页面骨架中的 ${skeletonPaths.join(', ')}。`],
  event: events,
  api,
  state: stateNames.length ? stateNames.map(value => `既有状态 ${value} 仅按冻结代码语义保留。`) : [],
  permission: [],
  refreshRecovery: events.length ? ['刷新后由既有初始化与定时器恢复展示；本次不新增后台恢复或重试机制。'] : [],
  regression: [`验证 ${name} 在 ${scope.affected?.routes?.join(', ') || '冻结路由'} 上仍可读取，并验证受影响闭包外的保护文件哈希不变。`],
  approvalId: null
}));
const output = {
  schemaVersion: '3.0',
  page: scope.affected?.pages?.join(', ') || scope.affected?.routes?.join(', ') || 'existing-page',
  items,
  sourceBindings: {
    codeReference: { path: state.artifacts.codeReference, sha256: sha256(referenceFile), sourceTreeHash: reference.sourceTreeHash },
    pageSkeleton: { path: state.artifacts.pageSkeleton, sha256: sha256(skeletonFile), skeletonHash: skeleton.skeletonHash },
    existingBaseline: { path: state.artifacts.existingBaseline, sha256: sha256(baselineFile) },
    changeScope: { path: state.artifacts.changeScope, sha256: sha256(scopeFile) },
    runtimeTargets: sourcePaths
  }
};
if (placeholder(output)) fail('compiled output unexpectedly contains a placeholder');
const outputFile = path.join(runDir, 'functional-freeze.json');
const previousHash = fs.existsSync(outputFile) ? sha256(outputFile) : null;
write(outputFile, output);
// The baseline professions consume the functional freeze as an input.  A
// repaired legacy template therefore makes their old conclusions stale.  Do
// not silently retain those conclusions or manufacture replacements: archive
// the stage and let the normal bounded Agent chain select fresh jobs.
if (previousHash && previousHash !== sha256(outputFile)) {
  const stage = 'baseline', advisoryDir = path.join(runDir, 'advisories', stage);
  if (fs.existsSync(advisoryDir)) {
    const archive = path.join(runDir, 'invalidated', `${Date.now()}-functional-freeze-repair`, 'advisories', stage);
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.renameSync(advisoryDir, archive);
    archiveArtifacts(runDir, [
      'advisories/baseline/selection.json',
      'advisories/baseline/codebase-onboarding-engineer.json',
      'advisories/baseline/existing-baseline-analyst.json',
      'advisories/baseline/role-decision-summary.md'
    ], 'functional-freeze-recompiled');
    const manifestFile = path.join(runDir, 'role-advisory-manifest.json');
    if (fs.existsSync(manifestFile)) {
      const manifest = read(manifestFile);
      delete manifest.stages?.[stage];
      write(manifestFile, manifest);
    }
    if (state.artifacts?.roleDecisionSummaries) delete state.artifacts.roleDecisionSummaries[stage];
  }
}
state.artifacts.functionalFreeze = 'functional-freeze.json';
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
commitRunState(runDir, state, { reason: 'functional-freeze-compiled' });
console.log(JSON.stringify({ artifact: 'functionalFreeze', path: outputFile, items: items.length, runtimeTargets: sourcePaths }));
