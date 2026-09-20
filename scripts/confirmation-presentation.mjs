#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const textHash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { console.error(`Confirmation presentation failed: ${message}`); process.exit(1); };
const hasPlaceholder = value => {
  if (typeof value === 'string') return /(^replace$|\breplace[-\w ]*|<[^>]+>)/i.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(hasPlaceholder));
};
const [command, runArg, checkpoint] = process.argv.slice(2);
if (command !== 'compile' || !runArg || !['stitch', 'implementation'].includes(checkpoint)) fail('usage: confirmation-presentation.mjs compile <run-dir> <stitch|implementation>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, checkpoint === 'stitch' ? 'sync_stitch' : 'compile_visual_bundle'); } catch (error) { fail(error.message); }
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile), artifacts = state.artifacts || {};
const resolve = reference => { const file = path.resolve(runDir, reference || ''); if (!file.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(file)) fail(`required current-run artifact is missing: ${reference || '<unset>'}`); return file; };
const list = (items, fallback) => (items || []).filter(Boolean).map(item => `- ${typeof item === 'string' ? item : item.id || item.path || item.visualNode || item.name}`).join('\n') || `- ${fallback}`;
let body, sources, headings, sectionContracts, requiredFacts;
if (checkpoint === 'stitch') {
  const freezeRef = artifacts.stitchFreeze, parityRef = artifacts.stitchParityEvidence;
  const freezeFile = resolve(freezeRef), parityFile = resolve(parityRef), freeze = read(freezeFile), parity = read(parityFile);
  if (hasPlaceholder(freeze) || hasPlaceholder(parity)) fail('Stitch confirmation source artifacts still contain template placeholders');
  if (!freeze.canvasUrl || !Array.isArray(freeze.approvedScreens) || !freeze.approvedScreens.length || parity.status !== 'passed') fail('Stitch confirmation requires a current canvas URL, approved screens, and passed parity evidence');
  if (!freeze.generationInput?.contentLock || !freeze.generationInput?.layoutLock || !freeze.generationInput?.analyticsLock) fail('Stitch confirmation requires current content, layout, and analytics locks');
  headings = ['候选范围与入口', '已冻结页面与视口', '差异与一致性证据', '真实来源与锁定内容', '风险、限制与可调整项', '确认后的实施影响'];
  sectionContracts = ['## 1. 候选范围与入口', '## 2. 已冻结页面与视口', '## 3. 差异与一致性证据', '## 4. 真实来源与锁定内容', '## 5. 风险、限制与可调整项', '## 6. 确认后的实施影响'];
  requiredFacts = ['canvasUrl', 'approvedScreens', 'parity.status', 'generationInput.locks', 'excludedScreens', 'implementationImpact'];
  body = [
    '## 1. 候选范围与入口', `本次确认的 Stitch 候选入口：${freeze.canvasUrl}。仅覆盖当前 Run 已冻结的页面与状态；候选使用已确认的信息结构、视觉 Token 和交互边界，未冻结区域不在本轮审核和后续实施范围内。`,
    '## 2. 已冻结页面与视口', freeze.approvedScreens.map(item => `- ${item.screenId}：${item.route || '/'}，${item.viewport}，${item.state}，截图 ${item.imagePath}`).join('\n'),
    '## 3. 差异与一致性证据', `严格一致性验证状态：${parity.status}。候选、运行时 Demo 与本次证据均绑定当前 Run；证据覆盖入口、页面结构、目标视口与可见内容，发现差异会使候选失效并回到本节点重建。`,
    '## 4. 真实来源与锁定内容', '- 内容锁、布局锁、数据口径锁均已绑定至当前视觉引用与冻结候选。\n- 后续实现只能使用此处冻结的来源和范围。',
    '## 5. 风险、限制与可调整项', `排除项：\n${list(freeze.excludedScreens, '无')}\n未确认时，任何调整都会重建候选与一致性证据，不会修改正式项目代码；如调整影响内容、布局或数据口径，将同步说明影响范围并重新生成本次确认正文。`,
    '## 6. 确认后的实施影响', '确认后自动生成实施包、Implementation Map 和完整实施冻结正文；不会跳过下一确认门，也不会直接写入正式代码。'
  ].join('\n\n');
  sources = { stitchFreeze: { path: freezeRef, sha256: hash(freezeFile) }, stitchParityEvidence: { path: parityRef, sha256: hash(parityFile) } };
} else {
  const bundleRef = artifacts.visualBundle, mapRef = artifacts.implementationMap;
  const bundleFile = resolve(bundleRef), mapFile = resolve(mapRef), bundle = read(bundleFile), map = read(mapFile);
  if (hasPlaceholder(bundle) || hasPlaceholder(map)) fail('Implementation confirmation source artifacts still contain template placeholders');
  if (!bundle.visualSourceManifest?.path || !bundle.implementationBaseline?.kind || !Array.isArray(map.entries) || !map.entries.length) fail('Implementation confirmation requires frozen source, baseline, and at least one implementation target');
  if (map.entries.some(item => !Array.isArray(item.runtimeTarget) || !item.runtimeTarget.length || !Array.isArray(item.acceptance) || !item.acceptance.length)) fail('Every implementation target requires formal runtime targets and acceptance criteria');
  headings = ['实施目标与范围', '正式代码目标', '来源物化与依赖', '数据、交互与响应式约束', '验证、风险与保护边界', '确认后的执行链'];
  sectionContracts = ['## 1. 实施目标与范围', '## 2. 正式代码目标', '## 3. 来源物化与依赖', '## 4. 数据、交互与响应式约束', '## 5. 验证、风险与保护边界', '## 6. 确认后的执行链'];
  requiredFacts = ['scopeControl', 'runtimeTargetsAndAcceptance', 'visualSourceAndBaseline', 'dataEventsResponsive', 'verificationAndProtection', 'postApprovalExecution'];
  body = [
    '## 1. 实施目标与范围', map.scopeControl ? `仅允许改动：\n${list(map.scopeControl.allowedRuntimeTargets, '无')}\n保护策略：${map.scopeControl.implementationPolicy}。任何未列入映射的页面、组件、接口和数据展示均保持冻结现状，不能借本次实施扩展范围。` : '实施范围严格限于下列 Implementation Map 正式代码目标；未映射的页面、组件、接口和数据展示均保持冻结现状。',
    '## 2. 正式代码目标', `${map.entries.map(item => `- ${item.visualNode} → ${item.runtimeTarget.join(', ')}；验收：${item.acceptance.join('；')}`).join('\n')}\n每个目标均为正式项目路径，运行时 Demo、.apex 工件和临时预览不构成正式代码目标。`,
    '## 3. 来源物化与依赖', `来源清单：${bundle.visualSourceManifest.path}\n实施基线：${bundle.implementationBaseline.kind}\n依赖：\n${list((bundle.assets || []).map(item => item.assetRef || item.source || item.package), '未新增')}\n来源只会按已冻结版本物化到上述正式目标，不会以截图、静态近似或未锁定资产替代。`,
    '## 4. 数据、交互与响应式约束', `${map.entries.map(item => `- ${item.visualNode}：数据 ${(item.data || []).join('、') || '沿用现有'}；交互 ${(item.events || []).join('、') || '无新增'}；响应式 ${item.responsive ? '按映射实现' : '未声明'}`).join('\n')}\n所有状态必须保持真实数据、加载、空、错误和权限语义，不得将未知状态伪造成零值或成功状态。`,
    '## 5. 验证、风险与保护边界', `${map.entries.flatMap(item => item.acceptance).map(item => `- ${item}`).join('\n')}\n验证将覆盖正式路由、关键交互、目标视口与回归边界；任何超出映射的变更、无来源依赖或验收失败都会阻止交付声明。`,
    '## 6. 确认后的执行链', '确认后才取得当前 Run 的项目修改租约，并依次执行正式代码物化、服务重启、真实页面/DOM/多视口验证、Proof Gate 与 Gate 3。失败只会返回带操作回执的真实阻断报告。'
  ].join('\n\n');
  sources = { visualBundle: { path: bundleRef, sha256: hash(bundleFile) }, implementationMap: { path: mapRef, sha256: hash(mapFile) } };
}
const sectionProof = headings.map((heading, index) => {
  const marker = sectionContracts[index];
  const start = body.indexOf(marker), next = index + 1 < headings.length ? body.indexOf(sectionContracts[index + 1], start + marker.length) : body.length;
  const content = start >= 0 && next > start ? body.slice(start + marker.length, next).trim() : '';
  return { id: index + 1, heading: marker, requiredFact: requiredFacts[index], substantiveChars: content.replace(/[#*_`>|\-\s]/g, '').length, sha256: textHash(content) };
});
const completeSections = sectionProof.every(section => section.substantiveChars >= 40)
  && new Set(sectionProof.map(section => section.sha256)).size === sectionProof.length
  && !/TO_REPLACE|\[object Object\]|(^|\n)\s*(replace|<[^>]+>)/im.test(body);
if (!completeSections) fail('generated confirmation body has an empty or incomplete section');
const presentationRef = `${checkpoint}-presentation.md`, manifestRef = `${checkpoint}-presentation-manifest.json`;
const writeAtomically = (file, value) => {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
};
// Commit order matters: a state reference is only published after the complete
// body and its manifest have been atomically finalized. A crash can therefore
// leave recoverable unreferenced files, never an active half-presentation.
const presentationFile = path.join(runDir, presentationRef);
writeAtomically(presentationFile, `${body}\n`);
const manifest = { schemaVersion: '1.1', checkpoint, status: 'ready-for-user-confirmation', presentation: presentationRef, presentationSha256: hash(presentationFile), sources, sections: sectionContracts, sectionProof };
writeAtomically(path.join(runDir, manifestRef), `${JSON.stringify(manifest, null, 2)}\n`);
state.artifacts[`${checkpoint}Presentation`] = presentationRef;
state.artifacts[`${checkpoint}PresentationManifest`] = manifestRef;
state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString();
writeAtomically(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify({ presentation: path.join(runDir, presentationRef), manifest: path.join(runDir, manifestRef), checkpoint }));
