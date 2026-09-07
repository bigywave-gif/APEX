#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryFile = path.join(apexRoot, 'registry', 'agency-role-registry.json');
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');
const stageAction = { baseline: 'collect_existing_baseline', gate1: 'analyze_requirement', visual: 'plan_visual', implementation: 'compile_visual_bundle', verify: 'verify' };
const stageArtifacts = {
  baseline: ['projectInventory', 'codeReference', 'pageSkeleton', 'existingBaseline', 'functionalFreeze', 'changeScope'],
  gate1: ['intentBrief', 'deliveryContract', 'domainModel', 'apiContract', 'experienceStrategy'],
  visual: ['deliveryContract', 'experienceStrategy', 'changeScope'],
  implementation: ['visualExecutionPlan', 'visualSourceManifest'],
  verify: ['implementationMap', 'pageDelta', 'verificationBundle']
};
function die(message) { console.error(`Role advisory failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function relative(runDir, file) { return path.relative(runDir, file); }
function stageDirectory(runDir, stage) { return path.join(runDir, 'advisories', stage); }
function stateFor(runDir) { return read(path.join(runDir, 'state.json')); }
function saveState(runDir, state) { state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(path.join(runDir, 'state.json'), state); }
function assertRoot() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function actionFor(stage) { const action = stageAction[stage]; if (!action) die(`unsupported advisory stage: ${stage}`); return action; }
function validate(schema, file) { const result = spawnSync(process.execPath, [validator, 'validate', schema, file], { encoding: 'utf8' }); if (result.status !== 0) die((result.stderr || result.stdout).trim()); }
function requiredRoleIds(registry, state, stage) {
  const contract = state.artifacts?.deliveryContract && fs.existsSync(path.join(path.resolve(state.__runDir), state.artifacts.deliveryContract)) ? read(path.join(path.resolve(state.__runDir), state.artifacts.deliveryContract)) : {};
  const needsChart = (contract.capabilities || []).includes('chart') || /chart|图表|dashboard|数据展示/i.test(JSON.stringify(contract));
  const needsMotion = (contract.capabilities || []).includes('motion') || /motion|动效|animation/i.test(JSON.stringify(contract));
  const matching = registry.roles.filter(role => role.stage === stage && role.activation.some(flag => flag === 'all' || (flag === 'existing' && state.track === 'existing') || (flag === 'requires-chart' && needsChart) || (flag === 'requires-motion' && needsMotion)));
  if (stage === 'visual') {
    const core = matching.filter(role => role.class === 'core');
    const conditional = matching.filter(role => role.class === 'conditional');
    return [...core, ...conditional].slice(0, registry.policy.maxDefaultRolesPerStage).map(role => role.id);
  }
  return matching.slice(0, registry.policy.maxDefaultRolesPerStage).map(role => role.id);
}
function currentManifest(runDir) {
  const file = path.join(runDir, 'role-advisory-manifest.json');
  return fs.existsSync(file) ? read(file) : { schemaVersion: '1.0', registry: { path: 'registry/agency-role-registry.json', sha256: hash(registryFile), upstreamCommit: read(registryFile).upstream.commit }, stages: {}, status: 'ready' };
}
function outputReceipt(runDir, file) {
  const indexFile = path.join(runDir, 'operations-index.json');
  if (!fs.existsSync(indexFile)) return null;
  const relativeFile = relative(runDir, file);
  const receipts = read(indexFile).receipts || {};
  const found = Object.entries(receipts).find(([receipt, record]) => record.status === 'succeeded' && record.script === 'role-advisory.mjs' && record.outputFileHashes?.[relativeFile] === hash(file));
  return found ? found[0] : null;
}
function loadSelection(runDir, stage) { const file = path.join(stageDirectory(runDir, stage), 'selection.json'); if (!fs.existsSync(file)) die(`select roles for ${stage} before recording an advisory`); return read(file); }
function select(runDir, stage) {
  const state = stateFor(runDir); state.__runDir = runDir; const registry = read(registryFile); const selectedRoles = requiredRoleIds(registry, state, stage); delete state.__runDir;
  if (!selectedRoles.length) die(`no role is eligible for ${stage}/${state.track}`);
  const bindings = (stageArtifacts[stage] || []).flatMap(artifact => {
    const reference = state.artifacts?.[artifact]; const file = reference && path.resolve(runDir, reference);
    return file && file.startsWith(`${path.resolve(runDir)}${path.sep}`) && fs.existsSync(file) ? [{ artifact, path: reference, sha256: hash(file) }] : [];
  });
  const selection = { schemaVersion: '1.0', stage, selectedRoles, inputBindings: bindings, registry: { sha256: hash(registryFile), upstreamCommit: registry.upstream.commit }, createdAt: new Date().toISOString() };
  const output = path.join(stageDirectory(runDir, stage), 'selection.json'); write(output, selection);
  console.log(JSON.stringify({ stage, selection: output, selectedRoles, inputBindings: bindings.length }));
}
function record(runDir, stage, input) {
  const selection = loadSelection(runDir, stage); const advisory = read(path.resolve(input));
  if (advisory.stage !== stage) die(`advisory stage ${advisory.stage} does not match ${stage}`);
  if (!selection.selectedRoles.includes(advisory.roleId)) die(`${advisory.roleId} was not selected for ${stage}`);
  const expected = new Map(selection.inputBindings.map(item => [item.artifact, item]));
  for (const binding of advisory.inputBindings) {
    const expectedBinding = expected.get(binding.artifact);
    if (!expectedBinding || expectedBinding.path !== binding.path || expectedBinding.sha256 !== binding.sha256) die(`advisory input binding is not current: ${binding.artifact}`);
  }
  if (selection.inputBindings.some(item => !advisory.inputBindings.some(binding => binding.artifact === item.artifact))) die('advisory must bind every current stage input artifact');
  const output = path.join(stageDirectory(runDir, stage), `${advisory.roleId}.json`); write(output, advisory); validate('role-advisory.schema.json', output);
  console.log(JSON.stringify({ stage, roleId: advisory.roleId, advisory: output }));
}
function degrade(runDir, stage, roleId, reason) {
  const selection = loadSelection(runDir, stage);
  if (!selection.selectedRoles.includes(roleId)) die(`${roleId} was not selected for ${stage}`);
  if (!reason || reason.length < 3) die('degrade requires a concrete observed failure reason');
  const advisory = {
    schemaVersion: '1.0', roleId, stage, adapterVersion: '1.0.0', inputBindings: selection.inputBindings,
    findings: [{ id: `${roleId}-degraded`, classification: 'unverified', statement: `The role advisory could not complete: ${reason}`, evidence: [`controlled-role-fallback:${reason}`] }],
    recommendations: [{ id: `${roleId}-fallback`, choice: 'Continue with the existing APEX evidence-bound chain.', rationale: 'This role is advisory-only; the Router, frozen contracts and required machine validators remain authoritative.', alternatives: ['Treat the advisory failure as a user confirmation'], acceptance: ['The final Gate and required machine validators remain complete.'] }],
    status: 'ready'
  };
  const output = path.join(stageDirectory(runDir, stage), `${roleId}.json`); write(output, advisory); validate('role-advisory.schema.json', output);
  console.log(JSON.stringify({ stage, roleId, advisory: output, degraded: true, reason }));
}
function summarize(runDir, stage) {
  const selection = loadSelection(runDir, stage); const entries = selection.selectedRoles.map(roleId => {
    const file = path.join(stageDirectory(runDir, stage), `${roleId}.json`); if (!fs.existsSync(file)) die(`selected ${stage} role has no recorded advisory: ${roleId}`);
    const advisory = read(file); validate('role-advisory.schema.json', file); return { roleId, file, advisory };
  });
  const facts = entries.flatMap(entry => entry.advisory.findings.filter(item => item.classification === 'fact').map(item => `- ${entry.roleId}: ${item.statement}`));
  const recommendations = entries.flatMap(entry => entry.advisory.recommendations.map(item => `- ${entry.roleId}/${item.id}: ${item.choice}。${item.rationale}`));
  const summary = `# ${stage} 角色决策摘要\n\n## 已验证事实\n${facts.length ? facts.join('\n') : '- 无新增事实。'}\n\n## 选择与理由\n${recommendations.length ? recommendations.join('\n') : '- 无新增建议。'}\n\n## 角色边界\n这些结论仅作为 APEX 内部 advisory；Router 仍是唯一状态、Gate 与实施授权方，用户只在当前 Gate 汇总确认。\n`;
  const summaryFile = path.join(stageDirectory(runDir, stage), 'role-decision-summary.md');
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.writeFileSync(summaryFile, summary);
  const manifest = currentManifest(runDir);
  const advisoryEntries = entries.map(entry => {
    const operationReceipt = outputReceipt(runDir, entry.file); if (!operationReceipt) die(`role advisory must be a successful controlled action output: ${entry.roleId}`);
    return { roleId: entry.roleId, path: relative(runDir, entry.file), sha256: hash(entry.file), operationReceipt };
  });
  manifest.stages[stage] = { selectedRoles: selection.selectedRoles, advisories: advisoryEntries, summary: relative(runDir, summaryFile), summarySha256: hash(summaryFile), status: 'ready' };
  manifest.registry = { path: 'registry/agency-role-registry.json', sha256: hash(registryFile), upstreamCommit: read(registryFile).upstream.commit };
  write(path.join(runDir, 'role-advisory-manifest.json'), manifest); validate('role-advisory-manifest.schema.json', path.join(runDir, 'role-advisory-manifest.json'));
  const state = stateFor(runDir); state.artifacts.roleAdvisoryManifest = 'role-advisory-manifest.json'; state.artifacts.roleDecisionSummaries ||= {}; state.artifacts.roleDecisionSummaries[stage] = relative(runDir, summaryFile); saveState(runDir, state);
  console.log(JSON.stringify({ stage, summary: summaryFile, manifest: path.join(runDir, 'role-advisory-manifest.json'), roles: selection.selectedRoles }));
}
function verify(runDir, stage) {
  const manifest = currentManifest(runDir); const stages = stage ? [stage] : Object.keys(manifest.stages || {});
  if (!stages.length) die('no role advisory stage has been summarized');
  for (const name of stages) {
    const item = manifest.stages?.[name]; if (!item || item.status !== 'ready' || !item.selectedRoles.length || item.selectedRoles.length !== item.advisories.length) die(`role manifest stage is incomplete: ${name}`);
    const summary = path.resolve(runDir, item.summary); if (!summary.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(summary)) die(`role summary is missing: ${name}`);
    for (const advisory of item.advisories) { const file = path.resolve(runDir, advisory.path); if (!file.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(file) || hash(file) !== advisory.sha256) die(`role advisory hash does not match: ${advisory.roleId}`); }
  }
  console.log(JSON.stringify({ status: 'passed', stages }));
}

const [command, runArg, stage, input] = process.argv.slice(2);
assertRoot();
if (!command || !runArg || !stage || !['select', 'record', 'degrade', 'summarize', 'verify'].includes(command)) die('usage: select|record|degrade|summarize|verify <run-dir> <baseline|gate1|visual|implementation|verify> [advisory.json|role-id reason]');
const runDir = path.resolve(runArg); const action = actionFor(stage);
try { requireRouterAction(runDir, action); } catch (error) { die(error.message); }
if (command === 'select') select(runDir, stage);
else if (command === 'record') { if (!input) die('record requires an advisory JSON file'); record(runDir, stage, input); }
else if (command === 'degrade') { const [, , , roleId, reason] = process.argv.slice(2); if (!roleId || !reason) die('degrade requires a role id and observed reason'); degrade(runDir, stage, roleId, reason); }
else if (command === 'summarize') summarize(runDir, stage);
else verify(runDir, stage);
