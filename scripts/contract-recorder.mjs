#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');

function die(message) { console.error(`Contract record failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function assertCanonicalRoot() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function validate(schema, file) {
  const result = spawnSync(process.execPath, [validator, 'validate', schema, file], { encoding: 'utf8' });
  if (result.status !== 0) die((result.stderr || result.stdout).trim());
}

const [command, runArg, inputArg] = process.argv.slice(2);
assertCanonicalRoot();
const contracts = { intent: { target: 'intent-brief.json', schema: 'intent-brief.schema.json', artifact: 'intentBrief' }, delivery: { target: 'delivery-contract.json', schema: 'delivery-contract.schema.json', artifact: 'deliveryContract' }, scope: { target: 'change-scope.json', schema: 'change-scope.schema.json', artifact: 'changeScope' }, domain: { target: 'domain-model.json', schema: 'domain-model.schema.json', artifact: 'domainModel' }, api: { target: 'api-contract.json', schema: 'api-contract.schema.json', artifact: 'apiContract' } };
const gate1PresentationSections = [
  '## 1. 需求方向与成功标准',
  '## 2. 用户、场景与核心任务',
  '## 3. 轨道判断与正式基线',
  '## 4. 产品范围、页面与功能边界',
  '## 5. 信息架构、数据、API 与权限',
  '## 6. 交付路径、技术约束与不包含项',
  '## 7. 质量门槛、验证与验收',
  '## 8. 已知事实、假设、待决项与风险'
];
function sha256(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function completeSections(content, sections) {
  return sections.every((section, index) => {
    const start = content.indexOf(section);
    if (start < 0) return false;
    const next = index + 1 < sections.length ? content.indexOf(sections[index + 1], start + section.length) : content.length;
    return next > start && content.slice(start + section.length, next).replace(/[#*_`>|\-\s]/g, '').length >= 40;
  });
}
if ((!contracts[command] && command !== 'gate1-presentation') || !runArg || !inputArg) die('usage: intent|delivery|scope|domain|api|gate1-presentation <run-dir> <input-file>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'record_context'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
if (state.gates?.gate1?.status === 'passed') die('Gate 1 is frozen; revise the requirement through the Router instead of replacing a contract');
if (command === 'gate1-presentation') {
  const content = fs.readFileSync(path.resolve(inputArg), 'utf8');
  if (!completeSections(content, gate1PresentationSections)) die('Gate 1 presentation must contain substantive content in all eight APEX-defined direction sections');
  const sourceArtifacts = ['intentBrief', 'deliveryContract', 'experienceStrategy'];
  if (state.track === 'existing') {
    sourceArtifacts.push('projectInventory', 'existingBaseline', 'functionalFreeze', 'changeScope');
    for (const heading of ['### 本次变更闭包', '### 明确保留内容']) if (!content.includes(heading)) die(`Existing Gate 1 presentation must include ${heading} and may describe unchanged areas only by baseline reference`);
  }
  const sources = {};
  for (const artifact of sourceArtifacts) {
    const reference = state.artifacts?.[artifact];
    const file = reference && path.resolve(runDir, reference);
    if (!file || !file.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(file)) die(`Gate 1 presentation requires the frozen ${artifact} source artifact`);
    sources[artifact] = { path: reference, sha256: sha256(file) };
  }
  for (const artifact of ['domainModel', 'apiContract']) {
    const reference = state.artifacts?.[artifact], file = reference && path.resolve(runDir, reference);
    if (file && file.startsWith(`${runDir}${path.sep}`) && fs.existsSync(file)) sources[artifact] = { path: reference, sha256: sha256(file) };
  }
  const output = path.join(runDir, 'gate1-presentation.md'); fs.writeFileSync(output, content.endsWith('\n') ? content : `${content}\n`);
  const manifest = { schemaVersion: '3.0', kind: 'gate1-direction-presentation', track: state.track, presentation: 'gate1-presentation.md', presentationSha256: sha256(output), requiredSections: gate1PresentationSections, sources, status: 'ready-for-user-confirmation' };
  write(path.join(runDir, 'gate1-presentation-manifest.json'), manifest);
  state.artifacts.gate1Presentation = 'gate1-presentation.md'; state.artifacts.gate1PresentationManifest = 'gate1-presentation-manifest.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
  console.log(JSON.stringify({ artifact: 'gate1Presentation', path: output, manifest: path.join(runDir, 'gate1-presentation-manifest.json') })); process.exit(0);
}
const { target, schema, artifact } = contracts[command];
if (command === 'scope' && state.track !== 'existing') die('change-scope.json is only valid for an Existing iteration');
if (['domain', 'api'].includes(command)) {
  const deliveryFile = state.artifacts?.deliveryContract && path.resolve(runDir, state.artifacts.deliveryContract);
  if (!deliveryFile || !deliveryFile.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(deliveryFile)) die('record delivery-contract.json before recording a domain model or API contract');
  const delivery = read(deliveryFile), capabilities = new Set(delivery.capabilities || []);
  if (!capabilities.has('backend') && !capabilities.has('api-contract')) die('domain and API contracts are only valid when the delivery contract requires backend or api-contract capability');
}
const value = read(path.resolve(inputArg));
value.schemaVersion = '3.0';
if (command === 'scope') {
  const baselineRef = state.artifacts?.existingBaseline, codeRef = state.artifacts?.codeReference;
  const baselineFile = baselineRef && path.resolve(runDir, baselineRef), codeFile = codeRef && path.resolve(runDir, codeRef);
  if (!baselineFile || !codeFile || !baselineFile.startsWith(`${runDir}${path.sep}`) || !codeFile.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(baselineFile) || !fs.existsSync(codeFile)) die('change scope requires the frozen Existing baseline and code reference');
  const baseline = read(baselineFile), code = read(codeFile);
  const affectedTargets = new Set(value.affected?.runtimeTargets || []), protectedTargets = new Set(value.protected?.runtimeTargets || []);
  if ([...affectedTargets].some(item => protectedTargets.has(item))) die('affected and protected runtime targets must not overlap');
  const scopedFiles = new Map((code.files || []).map(item => [item.path, item.sha256.startsWith('sha256:') ? item.sha256 : `sha256:${item.sha256}`]));
  if ([...affectedTargets].some(item => !scopedFiles.has(item))) die('every affected runtime target must come from the frozen Existing code closure');
  const expectedProtected = [...scopedFiles.keys()].filter(item => !affectedTargets.has(item));
  const protectedFiles = new Map((value.protected?.files || []).map(item => [item.path, item.sha256]));
  if (expectedProtected.some(item => protectedFiles.get(item) !== scopedFiles.get(item)) || [...protectedFiles.keys()].some(item => !expectedProtected.includes(item))) die('protected files must be the exact hashed complement of affected runtime targets in the frozen code closure');
  if ([...(value.affected?.routes || [])].some(item => !(baseline.routes || []).includes(item))) die('affected routes must be part of the frozen Existing baseline');
}
const output = path.join(runDir, target);
write(output, value);
validate(schema, output);
state.artifacts[artifact] = target;
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ artifact, path: output }));
