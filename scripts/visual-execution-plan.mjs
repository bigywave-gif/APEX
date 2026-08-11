#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
/** Freezes the pre-image visual, motion, and dependency plan for user review. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { assertExistingPlanScope } from './scope-boundary.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Visual execution plan failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha256(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
const labels = {
  track: '场景轨道', deliveryNarrative: '方案决策叙事', userNeedFit: '用户需求适配', informationArchitecture: '信息架构', grid: '栅格与布局', responsive: '响应式合同', styleDirection: '风格方向', colors: '颜色系统', typography: '字体与字号', effects: '边框、圆角、阴影与特效', designContract: '设计规范依据', components: '组件与状态', contentHierarchy: '内容层级', dataExpression: '数据表达', iconSystem: '图标系统', chartSystem: '图表系统', selectedResources: '选定素材', motion: '动效方案', threeD: '3D 方案', reducedMotion: '减少动效降级', performanceRisks: '性能与风险', responsiveContract: '响应式合同', loadingEmptyErrorPermissionStates: '加载、空、错误与权限状态', sourceSelections: '真实来源选择', dependencies: '最小依赖计划', libraryComparisons: '候选库比较', alternatives: '备选与拒绝理由', aestheticAssessment: '整体审美与一致性判断', industryBenchmark: '行业基准', trackNarrative: '轨道专属落地说明', responsiveAcceptance: '响应式验收', risks: '风险', status: '状态'
};
function scalar(value) { return typeof value === 'string' ? value : value === null ? '不适用' : String(value); }
function readable(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}- 无（已明确为不适用）\n`;
    return value.map(item => {
      if (item && typeof item === 'object') return `${pad}-\n${readable(item, depth + 1)}`;
      return `${pad}- ${scalar(item)}\n`;
    }).join('');
  }
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => {
    const title = labels[key] || key;
    if (item && typeof item === 'object') return `${pad}- **${title}**\n${readable(item, depth + 1)}`;
    return `${pad}- **${title}**：${scalar(item)}\n`;
  }).join('');
  return `${pad}- ${scalar(value)}\n`;
}
function block(value) { return `\n${readable(value)}\n`; }
function renderVisualPresentation(plan, track) {
  const selected = plan.sourceSelections.map(item => ({ id: item.id, visualNodes: item.visualNodes, kind: item.kind, sourceType: item.sourceType, sourceId: item.sourceId, resourceId: item.resourceId, version: item.version, materialization: item.materialization, parameters: item.parameters }));
  const states = plan.content.states;
  const responsive = plan.layout.responsive;
  const narrative = track === 'existing' ? plan.deliveryNarrative.changes : plan.deliveryNarrative.selections;
  return [
    '# APEX 完整视觉实施方案',
    '',
    '> **你当前确认的是页面将如何被设计和实现。** 请重点检查页面结构、整体风格、真实库来源、关键交互与动效是否符合预期。确认后 APEX 会自动生成可访问的运行时 Demo；如果你提出修改，APEX 会留在本阶段修订方案，不会进入 Demo。',
    '',
    '下面是由已通过 APEX 校验的视觉执行计划自动编译的完整方案。正文采用可读说明与清单；内部哈希仅保存在审计清单中，不要求用户阅读。',
    '',
    '## 1. 目标与范围', block({ track, ...(track === 'existing' ? { scopeControl: plan.scopeControl, note: '本确认仅覆盖上述变更闭包；未调整内容沿用已冻结 Existing 基线，不在本方案中重新设计或重复确认。' } : {}), deliveryNarrative: plan.deliveryNarrative, userNeedFit: plan.selectionAnalysis.userNeedFit }),
    '## 2. 信息架构与布局', block({ informationArchitecture: plan.layout.informationArchitecture, grid: plan.layout.grid, responsive }),
    '## 3. 视觉 Token', block(track === 'existing' ? { tokenPolicy: plan.scopeControl.tokenPolicy, tokenDeltas: plan.scopeControl.tokenDeltas, unchangedSummary: plan.scopeControl.unchangedSummary, designContract: plan.selectionAnalysis.designContract } : { styleDirection: plan.visualSystem.styleDirection, colors: plan.visualSystem.colors, typography: plan.visualSystem.typography, effects: plan.visualSystem.effects, designContract: plan.selectionAnalysis.designContract }),
    '## 4. 组件与交互', block({ components: plan.components, contentHierarchy: plan.content.hierarchy, dataExpression: plan.content.dataExpression }),
    '## 5. 图标、图表与素材', block({ iconSystem: plan.visualSystem.iconSystem || null, chartSystem: plan.visualSystem.chartSystem || null, selectedResources: selected.filter(item => ['icon', 'chart', 'asset', 'diagram'].includes(item.kind)) }),
    '## 6. 动效与可访问性', block({ motion: plan.motion, threeD: plan.threeD || [], reducedMotion: plan.motion.map(item => ({ id: item.id, reducedMotion: item.reducedMotion })), performanceRisks: plan.risks }),
    '## 7. 响应式与状态', block({ responsiveContract: responsive, loadingEmptyErrorPermissionStates: states }),
    '## 8. 真实来源与物化', block({ sourceSelections: selected, dependencies: plan.dependencies }),
    '## 9. 候选比较与取舍', block({ libraryComparisons: plan.selectionAnalysis.libraryComparisons, alternatives: plan.selectionAnalysis.alternatives, aestheticAssessment: plan.selectionAnalysis.aestheticAssessment, industryBenchmark: plan.selectionAnalysis.industryBenchmark }),
    '## 10. 实施影响与验收', block({ trackNarrative: narrative, dependencies: plan.dependencies, responsiveAcceptance: responsive.acceptance, risks: plan.risks, status: plan.status }),
    ''
  ].join('\n');
}
function validateIndustryBenchmark(plan) {
  const assessment = plan?.selectionAnalysis?.industryBenchmark;
  const registry = read(path.join(apexRoot, 'registry', 'industry-design-benchmarks.json'));
  const benchmark = (registry.benchmarks || []).find(item => item.id === assessment?.id);
  const scores = new Map((assessment?.scores || []).map(item => [item.criterion, item]));
  if (!benchmark || benchmark.criteria.some(id => !Number.isInteger(scores.get(id)?.score) || scores.get(id).score < 0 || scores.get(id).score > 5 || !Array.isArray(scores.get(id).sourceSelectionIds) || !scores.get(id).sourceSelectionIds.length || !scores.get(id).rationale)) die('visual plan must score every industry criterion from 0 to 5 with selected-source evidence and rationale');
  const average = benchmark.criteria.reduce((sum, id) => sum + scores.get(id).score, 0) / benchmark.criteria.length;
  if (average < 4) die(`industry benchmark ${benchmark.id} score ${average.toFixed(2)} is below the required 4.00`);
}
function validateResponsive(contract) {
  if (!contract || !contract.contractId || !Array.isArray(contract.viewports) || !Array.isArray(contract.reflowRules) || contract.reflowRules.length < 3 || !contract.overflowPolicy?.noUnintendedHorizontalOverflow || !Array.isArray(contract.overflowPolicy.exceptions) || !contract.typographyScale || !contract.mediaBehavior || !Array.isArray(contract.acceptance) || contract.acceptance.length < 3) die('responsive contract must define viewports, reflow, overflow, type, media, and acceptance');
  const classes = new Set(contract.viewports.map(item => item.class));
  if (!['mobile', 'tablet', 'desktop'].every(item => classes.has(item)) || contract.viewports.some(item => !Number.isInteger(item.minWidth) || !Number.isInteger(item.maxWidth) || item.minWidth > item.maxWidth || !item.layoutMode)) die('responsive contract must cover mobile, tablet, desktop with valid ranges and layout modes');
}
const [command, runArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compile' || !runArg || !inputArg) die('usage: compile <run-dir> <visual-execution-plan.json>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'plan_visual'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile);
if (state.gates?.gate1?.status !== 'passed' || state.locks?.visualPlanApproved) die('a current post-Gate-1 visual plan must be awaiting user confirmation');
const plan = read(path.resolve(inputArg));
validateIndustryBenchmark(plan);
for (const key of ['layout', 'visualSystem', 'content']) if (!plan[key] || typeof plan[key] !== 'object') die(`plan misses ${key}`);
const narrative = plan.deliveryNarrative;
if (!narrative || (state.track === 'greenfield' && (narrative.mode !== 'greenfield-selection' || !Array.isArray(narrative.selections) || !narrative.selections.length || narrative.selections.some(item => !item?.category || !Array.isArray(item.sourceSelectionIds) || !item.sourceSelectionIds.length || !item.selectionBasis))) || (state.track === 'existing' && (narrative.mode !== 'existing-iteration' || !Array.isArray(narrative.changes) || !narrative.changes.length || narrative.changes.some(item => !item?.scope || !item.currentIssue || !item.change || !item.why || !Array.isArray(item.sourceSelectionIds) || !item.sourceSelectionIds.length || !item.resolvedOutcome)))) die(state.track === 'existing' ? 'existing iteration plan must state what changes, the current issue, why, selected sources, and resolved outcome' : 'greenfield plan must state selected sources and the basis for each selection');
validateResponsive(plan.layout.responsive);
if (state.track === 'existing') {
  const scopeRef = state.artifacts?.changeScope;
  const scopeFile = scopeRef && path.resolve(runDir, scopeRef);
  if (!scopeFile || !scopeFile.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(scopeFile)) die('Existing visual planning requires a frozen change-scope.json');
  const frozenScope = read(scopeFile);
  try { assertExistingPlanScope(plan, frozenScope, sha256(scopeFile)); } catch (error) { die(error.message); }
}
if (!Array.isArray(plan.components) || !plan.components.length || !Array.isArray(plan.motion) || !Array.isArray(plan.dependencies) || !plan.selectionAnalysis || !Array.isArray(plan.sourceSelections) || plan.sourceSelections.length < 3 || plan.status !== 'ready-for-user-confirmation') die('plan must include components, motion, dependencies, requirement-driven selection analysis, concrete source selections, and ready-for-user-confirmation status');
const supportedDesignCapabilities = new Set(['ui-ux-pro-max-skill', 'impeccable', 'taste-skill', 'motion-ai-kit', 'better-icons', 'google-design-md']);
const analysis = plan.selectionAnalysis; const aestheticSkills = new Set(['ui-ux-pro-max-skill', 'impeccable', 'taste-skill']); if (!Array.isArray(analysis.designCapabilities) || analysis.designCapabilities.length < 2 || analysis.designCapabilities.some(item => !supportedDesignCapabilities.has(item)) || !analysis.designCapabilities.includes('google-design-md') || !analysis.designCapabilities.some(item => aestheticSkills.has(item)) || !analysis.designContract?.path || !/^sha256:[a-f0-9]{64}$/.test(analysis.designContract.sha256 || '') || !Array.isArray(analysis.designContract.rules) || analysis.designContract.rules.length < 4 || !analysis.aestheticAssessment?.qualityRationale || !Array.isArray(analysis.aestheticAssessment.coherenceChecks) || analysis.aestheticAssessment.coherenceChecks.length < 5 || !Array.isArray(analysis.aestheticAssessment.rejectedPatterns) || analysis.aestheticAssessment.rejectedPatterns.length < 2 || !Array.isArray(analysis.userNeedFit) || !analysis.userNeedFit.length || analysis.userNeedFit.some(item => !item?.need || !Array.isArray(item.selectedSourceIds) || !item.selectedSourceIds.length || !item.rationale) || !Array.isArray(analysis.alternatives) || !analysis.alternatives.length || analysis.alternatives.some(item => !item?.candidate || !item.decision)) die('selection analysis must bind a hashed DESIGN.md, google-design-md, an aesthetic skill, coherence checks, user-need fit, and considered alternatives');
const selectionIds = new Set(); const selectionKinds = new Set(); for (const selection of plan.sourceSelections) { if (!selection?.id || selectionIds.has(selection.id) || !Array.isArray(selection.visualNodes) || !selection.visualNodes.length || !['layout','component','style','icon','font','content','motion','asset','chart','diagram'].includes(selection.kind) || !['existing-project','approved-candidate','native-web','user-provided'].includes(selection.sourceType) || !selection.sourceId || !selection.resourceId || !selection.version || !['existing-project','inline-transfer','generated-source','runtime-package','native-web'].includes(selection.materialization) || !selection.parameters || typeof selection.parameters !== 'object') die(`invalid concrete source selection: ${selection?.id || '<unknown>'}`); if (selection.sourceType === 'native-web' && selection.materialization !== 'native-web') die(`native-web source selection must use native-web materialization: ${selection.id}`); if (selection.sourceType === 'approved-candidate' && (!selection.parameters.pattern || !selection.parameters.implementation)) die(`library selection must name its exact complete pattern and implementation API: ${selection.id}`); if (['layout', 'style'].includes(selection.kind) && (!selection.parameters.pattern || !Array.isArray(selection.parameters.tokens) || !selection.parameters.tokens.length)) die(`layout or color/style selection must lock a real pattern and token set: ${selection.id}`); if (selection.kind === 'icon' && (!selection.parameters.iconName || selection.parameters.size === undefined || !selection.parameters.colorToken || !selection.parameters.implementation)) die(`icon selection must lock icon name, size, color token, and implementation API: ${selection.id}`); if (selection.kind === 'chart' && (!selection.parameters.chartType || !selection.parameters.renderer || !selection.parameters.implementation)) die(`chart selection must lock chart type, renderer, and implementation API: ${selection.id}`); if (selection.kind === 'motion' && !selection.parameters.implementation) die(`motion selection must lock an implementation API: ${selection.id}`); selectionIds.add(selection.id); selectionKinds.add(selection.kind); }
const comparisonKinds = new Set(['layout', 'style', 'component', ...plan.sourceSelections.filter(selection => ['icon', 'chart', 'motion', 'font'].includes(selection.kind)).map(selection => selection.kind)]);
const comparisons = analysis.libraryComparisons;
if (!Array.isArray(comparisons) || comparisons.length < 3 || comparisons.some(item => !item?.category || !Array.isArray(item.candidates) || item.candidates.length < 2 || item.candidates.filter(candidate => candidate?.decision === 'selected').length !== 1 || item.candidates.some(candidate => !candidate?.sourceId || !candidate.resourceId || !candidate.version || !candidate.platformFit || !candidate.visualFit || !candidate.deliveryFit || !['selected', 'rejected'].includes(candidate.decision)) || !item.decisionRationale)) die('library comparisons must compare at least two concrete candidates and choose exactly one using platform, visual, and delivery fit');
const comparisonByKind = new Map(); for (const comparison of comparisons) { if (comparisonByKind.has(comparison.category)) die(`library comparison category is duplicated: ${comparison.category}`); comparisonByKind.set(comparison.category, comparison); }
for (const kind of comparisonKinds) { const comparison = comparisonByKind.get(kind); const selectedSources = plan.sourceSelections.filter(selection => selection.kind === kind); if (!comparison || !selectedSources.some(selection => comparison.candidates.some(candidate => candidate.decision === 'selected' && candidate.sourceId === selection.sourceId && candidate.resourceId === selection.resourceId && candidate.version === selection.version))) die(`selected ${kind} source must be the selected result of a concrete multi-library comparison`); }
const iconSelections = plan.sourceSelections.filter(selection => selection.kind === 'icon');
if (iconSelections.length) {
  const system = plan.visualSystem.iconSystem;
  if (!system?.sourceSelectionId || !system.family || !system.variant || !Array.isArray(system.sizeScale) || !system.sizeScale.length || !Array.isArray(system.colorTokens) || !system.colorTokens.length) die('icon selections require a complete iconSystem: source, family, variant, size scale, and token colors');
  const selected = plan.sourceSelections.find(selection => selection.id === system.sourceSelectionId);
  if (!selected || selected.kind !== 'icon' || selected.sourceId !== system.family) die('iconSystem must bind the selected icon-library source and family');
  for (const icon of iconSelections) if (icon.sourceId !== system.family || icon.parameters.variant !== system.variant || !system.sizeScale.includes(icon.parameters.size) || !system.colorTokens.includes(icon.parameters.colorToken)) die(`icon selection diverges from the frozen icon visual language: ${icon.id}`);
}
const chartSelections = plan.sourceSelections.filter(selection => selection.kind === 'chart');
if (chartSelections.length) {
  const system = plan.visualSystem.chartSystem;
  const composition = system?.composition;
  if (!system?.sourceSelectionId || !system.themeSourceId || !system.themeId || !Array.isArray(system.paletteTokens) || !system.paletteTokens.length || !system.typographyToken || !system.axisAndGridTreatment || !system.tooltipTreatment || !composition?.layoutSourceSelectionId || !composition?.styleSourceSelectionId || !composition?.containerPattern || !composition?.hierarchy || !Array.isArray(composition?.spacingTokens) || !composition.spacingTokens.length || !Array.isArray(composition?.responsiveReflow) || composition.responsiveReflow.length < 2 || !composition?.emptyStateTreatment) die('chart selections require a complete chartSystem: engine, theme, palette, typography, axis/grid, tooltip, and layout/style composition');
  const selected = plan.sourceSelections.find(selection => selection.id === system.sourceSelectionId);
  if (!selected || selected.kind !== 'chart') die('chartSystem must bind a selected chart engine');
  if (plan.sourceSelections.find(selection => selection.id === composition.layoutSourceSelectionId)?.kind !== 'layout' || plan.sourceSelections.find(selection => selection.id === composition.styleSourceSelectionId)?.kind !== 'style') die('chart composition must bind the confirmed layout and style source selections');
  for (const chart of chartSelections) { const theme = chart.parameters.theme; if (chart.sourceId !== selected.sourceId) die(`chart selection diverges from the frozen chart engine: ${chart.id}`); if (!theme || theme.sourceId !== system.themeSourceId || theme.id !== system.themeId || JSON.stringify(theme.paletteTokens) !== JSON.stringify(system.paletteTokens) || theme.typographyToken !== system.typographyToken || theme.axisAndGridTreatment !== system.axisAndGridTreatment || theme.tooltipTreatment !== system.tooltipTreatment || JSON.stringify(chart.parameters.composition) !== JSON.stringify(composition)) die(`chart selection must lock the frozen chart theme and layout/style composition: ${chart.id}`); }
}
if (!['layout', 'component', 'style'].every(kind => selectionKinds.has(kind)) || !selectionKinds.has('font')) die('source selections must explicitly lock layout, component, style, and font choices before the effect image is generated');
for (const score of analysis.industryBenchmark?.scores || []) for (const id of score.sourceSelectionIds || []) if (!selectionIds.has(id)) die(`industry benchmark score refers to an unknown selected source: ${id}`);
for (const fit of analysis.userNeedFit) for (const id of fit.selectedSourceIds) if (!selectionIds.has(id)) die(`selection analysis refers to an unknown source selection: ${id}`);
for (const item of [...(narrative.selections || []), ...(narrative.changes || [])]) for (const id of item.sourceSelectionIds || []) if (!selectionIds.has(id)) die(`delivery narrative refers to an unknown source selection: ${id}`);
for (const dependency of plan.dependencies) if (!dependency.package || !dependency.version || !['installed', 'planned', 'not-required'].includes(dependency.status) || typeof dependency.installAfterGate2 !== 'boolean' || (dependency.status === 'planned' && dependency.installAfterGate2 !== true)) die(`invalid dependency plan: ${dependency.package || '<unknown>'}`);
for (const motion of plan.motion) { const selection = selectionIds.has(motion.sourceSelectionId) && plan.sourceSelections.find(item => item.id === motion.sourceSelectionId); if (!motion.id || !motion.engine || !motion.sourceId || !motion.sourceSelectionId || !motion.api || !motion.reducedMotion || !selection || selection.kind !== 'motion' || selection.sourceId !== motion.sourceId) die(`motion plan is not bound to an exact selected motion source: ${motion.id || '<unknown>'}`); }
for (const scene of plan.threeD || []) { if (!scene.id || !['three-js', 'babylon-js'].includes(scene.engine) || !['webgl', 'webgpu'].includes(scene.renderer) || !scene.dependency?.package || !scene.dependency?.version || !Array.isArray(scene.assets) || !scene.assets.length || !scene.assets.every(asset => plan.sourceSelections.find(selection => selection.id === asset.sourceSelectionId && selection.kind === 'asset')) || !scene.performanceBudget || !scene.fallback || !scene.reducedMotion) die(`3D plan is not bound to exact selected model, texture, or environment sources: ${scene.id || '<unknown>'}`); const dependency = plan.dependencies.find(item => item.package === scene.dependency.package && item.version === scene.dependency.version); if (!dependency || !['installed', 'planned'].includes(dependency.status)) die(`3D runtime is not declared as an installed or planned dependency: ${scene.id}`); }
const planFile = path.join(runDir, 'visual-execution-plan.json');
write(planFile, plan);
const presentationFile = path.join(runDir, 'visual-plan-presentation.md');
fs.writeFileSync(presentationFile, renderVisualPresentation(plan, state.track));
const manifestFile = path.join(runDir, 'visual-plan-presentation-manifest.json');
write(manifestFile, {
  schemaVersion: '3.0',
  kind: 'visual-plan-presentation',
  presentation: 'visual-plan-presentation.md',
  presentationSha256: sha256(presentationFile),
  visualExecutionPlan: 'visual-execution-plan.json',
  visualExecutionPlanSha256: sha256(planFile),
  ...(state.track === 'existing' ? { changeScope: state.artifacts.changeScope, changeScopeSha256: plan.scopeControl.changeScopeHash } : {}),
  requiredSections: ['目标与范围', '信息架构与布局', '视觉 Token', '组件与交互', '图标、图表与素材', '动效与可访问性', '响应式与状态', '真实来源与物化', '候选比较与取舍', '实施影响与验收'],
  status: 'ready-for-user-confirmation'
});
state.artifacts.visualExecutionPlan = 'visual-execution-plan.json';
state.artifacts.visualPlanPresentation = 'visual-plan-presentation.md';
state.artifacts.visualPlanPresentationManifest = 'visual-plan-presentation-manifest.json';
state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ visualExecutionPlan: planFile, visualPlanPresentation: presentationFile, visualPlanPresentationManifest: manifestFile, motions: plan.motion.length, plannedDependencies: plan.dependencies.filter(item => item.status === 'planned').length }));
