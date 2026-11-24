#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { archiveArtifacts, commitRunState, readRunState, visualSkillLoads } from './run-ledger.mjs';
import { agentRuntimeStatus, claimAgentJob, completeAgentAdvisory, enqueueAgentJob, endTraceSpan, rebudgetAgentJobs, registerAgent, settleAgentJob, startTraceSpan, supersedeQueuedAgentJobs } from './run-ledger.mjs';
import { resolveTasteSkill, loadTasteSkill, requiredTasteLoadCurrent, optionalSkillLoadCurrent } from './required-visual-skill.mjs';
import { formalReviewBindings, validateProductTaskReview } from './formal-interaction-evidence.mjs';
import { validateRequirementReview } from './requirement-review.mjs';
import { validateResourceReviews } from './existing-resource-freshness.mjs';
import { visualRevisionBindingCurrent } from './visual-revision-binding.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryFile = path.join(apexRoot, 'registry', 'agency-role-registry.json');
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');
const stageAction = { baseline: 'collect_existing_baseline', gate1: 'analyze_requirement', visual: 'plan_visual', implementation: 'compile_visual_bundle', verify: 'verify' };
const stageArtifacts = {
  baseline: ['projectInventory', 'codeReference', 'pageSkeleton', 'existingBaseline', 'functionalFreeze', 'changeScope'],
  gate1: ['intentBrief', 'deliveryContract', 'domainModel', 'apiContract', 'experienceStrategy'],
  visual: ['deliveryContract', 'experienceStrategy', 'changeScope'],
  implementation: ['visualExecutionPlan', 'visualSourceManifest', 'dependencyLock', 'visualBundle', 'implementationMap'],
  verify: ['implementationMap', 'pageDelta', 'verificationBundle']
};
const stageSkillBindings = {
  baseline: ['andrej-karpathy-skills', 'playwright'],
  gate1: ['doc-coauthoring', 'andrej-karpathy-skills'],
  visual: ['google-design-md', 'ui-ux-pro-max-skill', 'impeccable'],
  implementation: ['react', 'tailwind', 'andrej-karpathy-skills'],
  verify: ['playwright', 'andrej-karpathy-skills']
};
let recordErrorsThrow = false;
function die(message) { if (recordErrorsThrow) throw new Error(message); console.error(`Role advisory failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
// The host may report provider-native tokens when available, but Core must
// reject impossible under-reporting even when no provider meter is exposed.
// This deliberately uses a conservative, deterministic byte floor so the
// budget and audit trail remain reproducible from frozen Run artifacts.
function tokenFloor(value) { return Math.max(1, Math.ceil(Buffer.byteLength(value) / 4)); }
function advisoryTokenFloors(runDir, bindings, advisory) {
  const input = bindings.reduce((total, binding) => {
    const file = path.resolve(runDir, binding.path);
    return total + tokenFloor(fs.readFileSync(file));
  }, 0);
  return { input, output: tokenFloor(JSON.stringify(advisory)) };
}
function assertFindingEvidenceBindings(selection, advisory) {
  const allowed = new Set(selection.inputBindings.flatMap(binding => [binding.artifact, binding.path, `${binding.artifact}:${binding.path}`]));
  for (const finding of advisory.findings || []) {
    for (const evidence of finding.evidence || []) {
      if (!allowed.has(evidence)) die(`role advisory evidence is not a current frozen stage binding: ${advisory.roleId}/${evidence}`);
    }
  }
}
function relative(runDir, file) { return path.relative(runDir, file); }
function stageDirectory(runDir, stage) { return path.join(runDir, 'advisories', stage); }
function stateFor(runDir) { return readRunState(runDir); }
function saveState(runDir, state) { state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'role-advisory-summary' }); }
function assertRoot() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function actionFor(stage) { const action = stageAction[stage]; if (!action) die(`unsupported advisory stage: ${stage}`); return action; }
function validate(schema, file) { const result = spawnSync(process.execPath, [validator, 'validate', schema, file], { encoding: 'utf8' }); if (result.status !== 0) die((result.stderr || result.stdout).trim()); }
function requiredRoleIds(registry, state, stage) {
  const contract = state.artifacts?.deliveryContract && fs.existsSync(path.join(path.resolve(state.__runDir), state.artifacts.deliveryContract)) ? read(path.join(path.resolve(state.__runDir), state.artifacts.deliveryContract)) : {};
  const needsChart = (contract.capabilities || []).includes('chart') || /chart|图表|dashboard|数据展示/i.test(JSON.stringify(contract));
  const needsMotion = (contract.capabilities || []).includes('motion') || /motion|动效|animation/i.test(JSON.stringify(contract));
  const needsBackend = (contract.capabilities || []).some(capability => ['backend', 'api-contract', 'data-intelligence'].includes(capability));
  const matching = registry.roles.filter(role => role.stage === stage && role.activation.some(flag => flag === 'all' || (flag === 'existing' && state.track === 'existing') || (flag === 'requires-chart' && needsChart) || (flag === 'requires-motion' && needsMotion) || (flag === 'requires-backend' && needsBackend)));
  if (stage === 'visual') {
    const core = matching.filter(role => role.class === 'core');
    const conditional = matching.filter(role => role.class === 'conditional');
    // A role becomes mandatory once its activation predicate matches.  A cap
    // that silently drops a required motion/chart reviewer produces an
    // apparently complete but professionally incomplete Gate.
    return [...core, ...conditional].map(role => role.id);
  }
  const ids = matching.map(role => role.id);
  if (stage === 'verify' && state.roleChain?.confirmationModel === 'two-confirmations' && !ids.includes('product-manager')) ids.push('product-manager');
  return ids;
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
function currentSelectionInputs(runDir, stage) {
  const state = stateFor(runDir); state.__runDir = runDir;
  const registry = read(registryFile); const selectedRoles = requiredRoleIds(registry, state, stage); delete state.__runDir;
  if (!selectedRoles.length) die(`no role is eligible for ${stage}/${state.track}`);
  const bindings = (stageArtifacts[stage] || []).flatMap(artifact => {
    const reference = state.artifacts?.[artifact]; const file = reference && path.resolve(runDir, reference);
    return file && file.startsWith(`${path.resolve(runDir)}${path.sep}`) && fs.existsSync(file) ? [{ artifact, path: reference, sha256: hash(file) }] : [];
  });
  if (stage === 'verify' && state.roleChain?.confirmationModel === 'two-confirmations') for (const binding of formalReviewBindings(runDir, state)) if (!bindings.some(item => item.artifact === binding.artifact)) bindings.push(binding);
  // A material visual revision is a first-class Agent input.  Without this
  // binding, a re-selected visual stage can reuse old completed jobs despite
  // the user having changed the visual direction.
  const revisionFile = path.join(runDir, 'prompt-revisions.ndjson');
  if (stage === 'visual' && fs.existsSync(revisionFile)) bindings.push({ artifact: 'visualRevision', path: 'prompt-revisions.ndjson', sha256: hash(revisionFile) });
  if (stage === 'verify' && state.roleChain?.confirmationModel === 'two-confirmations' && fs.existsSync(revisionFile)) {
    if (!fs.realpathSync(revisionFile).startsWith(`${fs.realpathSync(runDir)}${path.sep}`) || !fs.statSync(revisionFile).isFile()) die('verification revision log must be a Run-local file');
    bindings.push({ artifact: 'requirementRevisions', path: 'prompt-revisions.ndjson', sha256: hash(revisionFile) });
  }
  const configuredStageBudget = { lite: 6000, standard: 12000, full: 24000 }[state.scope] || 12000;
  const inputFloor = bindings.reduce((total, binding) => total + tokenFloor(fs.readFileSync(path.resolve(runDir, binding.path))), 0);
  const perAgentBudget = Math.max(1000, Math.floor(configuredStageBudget / selectedRoles.length), inputFloor + 1000);
  const tasteBinding = stage === 'visual' && selectedRoles.includes('ui-designer') ? resolveTasteSkill() : null;
  const requiredSkillFloor = tasteBinding ? tokenFloor(fs.readFileSync(tasteBinding.path)) : 0;
  const perRole = Object.fromEntries(selectedRoles.map(roleId => [roleId, roleId === 'ui-designer' && tasteBinding ? Math.max(perAgentBudget, inputFloor + requiredSkillFloor + 1000) : perAgentBudget]));
  const baseStageBudget = Math.max(configuredStageBudget, Object.values(perRole).reduce((sum, value) => sum + value, 0) + 2500);
  // Archived stage executions already include revisions and repairs. Count
  // each once so a visual revision does not receive two extra allowances.
  const repairEpoch = fs.existsSync(path.join(runDir, 'invalidated'))
    ? fs.readdirSync(path.join(runDir, 'invalidated'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.includes(`role-`) && fs.existsSync(path.join(runDir, 'invalidated', entry.name, 'advisories', stage)))
      .length
    : 0;
  const stageBudget = baseStageBudget * (1 + repairEpoch);
  return { registry, selectedRoles, bindings, tasteBinding, tokenBudget: { stage: stageBudget, perAgent: perAgentBudget, perRole, inputFloor, requiredSkillFloor, policy: 'role-input-and-required-skill-reserve-v2', repairEpoch } };
}
function select(runDir, stage) {
  const { registry, selectedRoles, bindings, tokenBudget, tasteBinding } = currentSelectionInputs(runDir, stage);
  const output = path.join(stageDirectory(runDir, stage), 'selection.json');
  // Selection is an idempotency boundary.  Re-selecting after a transport
  // retry must never enqueue the same profession a second time or consume a
  // second budget.  Recovery resumes the durable job; a changed input needs
  // a new Router authorization and a fresh run stage instead.
  if (fs.existsSync(output)) {
    const existing = read(output);
    if (tasteBinding || existing.tasteSkill) loadTasteSkill(existing.tasteSkill);
    if (existing.stage !== stage || JSON.stringify(existing.selectedRoles) !== JSON.stringify(selectedRoles) || JSON.stringify(existing.inputBindings) !== JSON.stringify(bindings) || existing.registry?.sha256 !== hash(registryFile)) die(`existing role selection is stale for ${stage}; recover or start a newly authorized stage instead of duplicating Agent jobs`);
    const jobs = new Map(agentRuntimeStatus(runDir).jobs.map(job => [job.jobId, job]));
    for (const roleId of selectedRoles) {
      const job = jobs.get(existing.agentJobs?.[roleId]);
      if (!job || job.agentId !== roleId || job.stage !== stage || job.payload?.roleId !== roleId || job.payload?.registrySha256 !== existing.registry.sha256 || JSON.stringify(job.payload?.inputBindings) !== JSON.stringify(bindings)) die(`existing role selection has missing or inconsistent durable job: ${roleId}; recover the ledger before continuing`);
      if (stage === 'visual' && roleId === 'ui-designer' && (JSON.stringify(job.payload.tasteSkill) !== JSON.stringify(existing.tasteSkill) || !job.payload.skillBindings?.includes('taste-skill'))) die('visual UI designer job is missing or has an inconsistent required taste-skill binding');
    }
    console.log(JSON.stringify({ stage, selection: output, selectedRoles, inputBindings: bindings.length, jobs: existing.agentJobs || {}, idempotent: true }));
    return;
  }
  // A token cap must be achievable by the frozen inputs it asks an Agent to
  // read. The old fixed split could assign 6,000 tokens to an Agent whose
  // deterministic input floor was already above 6,000, guaranteeing a false
  // over-budget failure. Reserve a bounded output allowance and a small
  // retry/accounting buffer; the resulting budget is still explicit in the
  // selection and enforced during advisory recording.
  const tasteSkill = tasteBinding;
  const selection = { schemaVersion: '1.1', stage, selectedRoles, inputBindings: bindings, tokenBudget, registry: { sha256: hash(registryFile), upstreamCommit: registry.upstream.commit }, ...(tasteSkill ? { tasteSkill } : {}), createdAt: new Date().toISOString() };
  // A role selection materializes dedicated, durable Agent jobs.  The host
  // may execute them sequentially or with bounded independent concurrency,
  // but it cannot silently turn the professional chain into a prose list.
  const inputHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(selection.inputBindings)).digest('hex')}`;
  const jobs = selectedRoles.map(roleId => {
    const role = registry.roles.find(item => item.id === roleId);
    const productVerification = stage === 'verify' && roleId === 'product-manager' && stateFor(runDir).roleChain?.confirmationModel === 'two-confirmations';
    const skillBindings = [...(stageSkillBindings[stage] || []), ...(roleId === 'ui-designer' && tasteSkill ? ['taste-skill'] : [])];
    const agent = registerAgent(runDir, { agentId: roleId, vocation: roleId, stage, capabilityVersion: registry.upstream.commit, metadata: { standards: role?.standards || [], inputs: productVerification ? ['intentBrief', 'experienceStrategy', 'visualSandboxFiles', 'implementationMap', 'runtimeStateMatrix', 'evidenceProvenance', ...(fs.existsSync(path.join(runDir, 'prompt-revisions.ndjson')) ? ['requirementRevisions'] : [])] : role?.inputs || [], outputs: productVerification ? ['productReview', 'requirementReview', 'requestCoverage'] : role?.outputs || [], skillBindings } });
    const payload = { roleId, stage, agentSessionId: agent.sessionId, skillBindings, ...(roleId === 'ui-designer' && tasteSkill ? { tasteSkill } : {}), ...(tokenBudget.repairEpoch > 0 ? { budgetRecovery: true } : {}), inputBindings: bindings, registrySha256: selection.registry.sha256, tokenBudget: selection.tokenBudget.perRole[roleId], stageTokenBudget: selection.tokenBudget.stage };
    // A deterministic identity lets a replay reconstruct a selection after a
    // crash between durable job creation and the compatibility-file write.
    const jobId = `agent-${crypto.createHash('sha256').update(JSON.stringify({ stage, roleId, inputHash, repairEpoch: tokenBudget.repairEpoch, payload })).digest('hex').slice(0, 32)}`;
    return enqueueAgentJob(runDir, { jobId, agentId: roleId, stage, inputHash, payload, maxAttempts: 3 });
  });
  selection.agentJobs = Object.fromEntries(selectedRoles.map((roleId, index) => [roleId, jobs[index].jobId])); write(output, selection);
  console.log(JSON.stringify({ stage, selection: output, selectedRoles, inputBindings: bindings.length, jobs }));
}
function rebudget(runDir, stage) {
  const selection = loadSelection(runDir, stage);
  const current = currentSelectionInputs(runDir, stage);
  if (JSON.stringify(selection.selectedRoles) !== JSON.stringify(current.selectedRoles) || JSON.stringify(selection.inputBindings) !== JSON.stringify(current.bindings) || selection.registry?.sha256 !== hash(registryFile)) die(`role selection is stale for ${stage}; repair before rebudgeting`);
  const jobIds = current.selectedRoles.map(roleId => selection.agentJobs?.[roleId]);
  if (jobIds.some(jobId => typeof jobId !== 'string')) die(`role selection has no durable job for ${stage}`);
  const runtime = agentRuntimeStatus(runDir);
  const jobs = new Map(runtime.jobs.map(job => [job.jobId, job]));
  const pendingJobIds = [];
  for (const [index, roleId] of current.selectedRoles.entries()) {
    const job = jobs.get(jobIds[index]);
    if (!job || job.agentId !== roleId || job.stage !== stage) die(`role selection job binding is invalid: ${roleId}`);
    if (job.status === 'succeeded') continue;
    if (!['queued', 'running', 'dead-letter'].includes(job.status)) die(`role selection cannot rebudget terminal job: ${roleId}/${job.status}`);
    pendingJobIds.push(jobIds[index]);
  }
  // Completed advisers retain their original budget/result. Only unsettled
  // replacement jobs need the renewed stage allowance after a repair epoch.
  if (pendingJobIds.length) rebudgetAgentJobs(runDir, { stage, jobIds: pendingJobIds, perAgentBudget: current.tokenBudget.perAgent, perJobBudgets: Object.fromEntries(pendingJobIds.map(id => [id, current.tokenBudget.perRole[jobs.get(id).agentId]])), stageBudget: current.tokenBudget.stage });
  selection.schemaVersion = '1.1'; selection.tokenBudget = current.tokenBudget; selection.rebudgetedAt = new Date().toISOString();
  const output = path.join(stageDirectory(runDir, stage), 'selection.json');
  archiveArtifacts(runDir, [relative(runDir, output)], 'role-selection-rebudgeted');
  write(output, selection);
  console.log(JSON.stringify({ stage, selection: path.join(stageDirectory(runDir, stage), 'selection.json'), tokenBudget: selection.tokenBudget, jobs: pendingJobIds, status: 'rebudgeted' }));
}
function recordChecked(runDir, stage, selection, advisory) {
  const current = currentSelectionInputs(runDir, stage);
  const expectedBindings = selection.inputBindings || [];
  const actualBindings = current.bindings.map(binding => {
    const expected = expectedBindings.find(item => item.artifact === binding.artifact);
    return binding.artifact === 'visualRevision' && expected && visualRevisionBindingCurrent(path.resolve(runDir, binding.path), expected.sha256) ? { ...binding, sha256: expected.sha256 } : binding;
  });
  if (JSON.stringify(selection.selectedRoles) !== JSON.stringify(current.selectedRoles) || JSON.stringify(expectedBindings) !== JSON.stringify(actualBindings) || selection.registry?.sha256 !== hash(registryFile)) die(`role selection inputs changed for ${stage}; repair before recording`);
  if (stage === 'verify' && stateFor(runDir).roleChain?.confirmationModel === 'two-confirmations') {
    const file = path.join(runDir, 'prompt-revisions.ndjson'), binding = selection.inputBindings?.find(item => item.artifact === 'requirementRevisions');
    if (fs.existsSync(file) ? !binding || binding.path !== 'prompt-revisions.ndjson' || binding.sha256 !== hash(file) : Boolean(binding)) die('verification role revision input changed; repair the selection before recording');
  }
  if (advisory.stage !== stage) die(`advisory stage ${advisory.stage} does not match ${stage}`);
  if (!selection.selectedRoles.includes(advisory.roleId)) die(`${advisory.roleId} was not selected for ${stage}`);
  const expected = new Map(selection.inputBindings.map(item => [item.artifact, item]));
  for (const binding of advisory.inputBindings) {
    const expectedBinding = expected.get(binding.artifact);
    if (!expectedBinding || expectedBinding.path !== binding.path || expectedBinding.sha256 !== binding.sha256) die(`advisory input binding is not current: ${binding.artifact}`);
  }
  if (selection.inputBindings.some(item => !advisory.inputBindings.some(binding => binding.artifact === item.artifact))) die('advisory must bind every current stage input artifact');
  assertFindingEvidenceBindings(selection, advisory);
  if (stage === 'baseline' && advisory.roleId === 'existing-baseline-analyst' && stateFor(runDir).roleChain?.confirmationModel === 'two-confirmations') {
    const state = stateFor(runDir), baseline = read(path.join(runDir, state.artifacts.existingBaseline));
    if (baseline.codeReference?.resourceReviewProtocol === '1.0') validateResourceReviews(read(path.join(runDir, state.artifacts.codeReference)), advisory.resourceReviews);
  }
  if (stage === 'verify' && advisory.roleId === 'product-manager' && stateFor(runDir).roleChain?.confirmationModel === 'two-confirmations') { validateProductTaskReview(runDir, stateFor(runDir), advisory.productReview); validateRequirementReview(runDir, stateFor(runDir), advisory.requirementReview, advisory.requestCoverage); }
  const floors = advisoryTokenFloors(runDir, selection.inputBindings, advisory);
  const usageSource = advisory.execution.usageSource || 'legacy-unverified';
  if (usageSource === 'unknown' && (advisory.execution.inputTokens !== 0 || advisory.execution.outputTokens !== 0)) die('unknown token usage must use zero placeholders and remain explicitly unmetered');
  // A byte-based heuristic is not a tokenizer and must not reject provider-reported usage.
  if (usageSource === 'legacy-unverified' && Number(advisory.execution.inputTokens) < floors.input) die(`role advisory input token report is below the frozen-input floor: ${advisory.roleId}/${advisory.execution.inputTokens}<${floors.input}`);
  if (usageSource === 'legacy-unverified' && Number(advisory.execution.outputTokens) < floors.output) die(`role advisory output token report is below the serialized-advisory floor: ${advisory.roleId}/${advisory.execution.outputTokens}<${floors.output}`);
  const output = path.join(stageDirectory(runDir, stage), `${advisory.roleId}.json`);
  const jobId = selection.agentJobs?.[advisory.roleId];
  let used = null;
  if (jobId) {
    // A professional Agent must claim its durable job before doing advisory
    // work. Recording then proves that claimed execution against frozen input.
    used = Number(advisory.execution.inputTokens) + Number(advisory.execution.outputTokens);
    const job = agentRuntimeStatus(runDir, jobId).jobs[0];
    if (!job || job.agentId !== advisory.roleId || job.stage !== stage) die(`dedicated Agent job does not match advisory: ${advisory.roleId}`);
    if (job.status !== 'running') die(`dedicated Agent job must be claimed before advisory recording: ${advisory.roleId}/${job.status}`);
    if (JSON.stringify(job.payload?.inputBindings) !== JSON.stringify(expectedBindings) || job.payload?.registrySha256 !== selection.registry?.sha256) die(`dedicated Agent job inputs do not match selection: ${advisory.roleId}`);
    if (stage === 'visual' && advisory.roleId === 'ui-designer' && (!job.payload?.tasteSkill || JSON.stringify(job.payload.tasteSkill) !== JSON.stringify(selection.tasteSkill))) die('visual UI designer job is missing or has an inconsistent required taste-skill binding');
    if (advisory.execution.sessionId !== job.payload?.agentSessionId) die(`advisory session does not match claimed Agent job: ${advisory.roleId}`);
    if (JSON.stringify(advisory.execution.skillBindings || []) !== JSON.stringify(job.payload?.skillBindings || [])) die(`advisory Skill bindings do not match claimed Agent job: ${advisory.roleId}`);
    if (used > Number(job.reservedTokens || selection.tokenBudget?.perAgent || 0)) {
      const reason = `role advisory exceeds its per-Agent token budget: ${advisory.roleId}`;
      settleAgentJob(runDir, jobId, { status: 'failed', leaseToken: advisory.execution.leaseToken || null, error: reason, budgetExceeded: Boolean(job.reservedTokens), retryDelayMs: 0, usage: { inputTokens: advisory.execution.inputTokens, outputTokens: advisory.execution.outputTokens, usageSource } });
      die(reason);
    }
    if (job.payload?.tasteSkill) {
      loadTasteSkill(job.payload.tasteSkill);
      const usage = advisory.execution.tasteSkillUsage;
      if (!usage || usage.sha256 !== job.payload.tasteSkill.sha256 || !Array.isArray(usage.appliedRules) || !usage.appliedRules.some(rule => typeof rule === 'string' && rule.trim())) die('UI designer must report the loaded taste-skill hash and applicable design rules');
      if (readRunState(runDir).roleChain?.confirmationModel === 'two-confirmations' && !requiredTasteLoadCurrent(runDir, jobId, job.attempt, advisory.execution.leaseToken, job.payload.tasteSkill)) {
        if (requiredTasteLoadCurrent(runDir, jobId, job.attempt, null, job.payload.tasteSkill)) die('agent job lease token is stale or missing');
        die('UI designer requires a successful current-attempt controlled taste-skill load receipt');
      }
    }
    if (['visual', 'gate1', 'implementation'].includes(stage)) {
      const events = visualSkillLoads(runDir, jobId, job.attempt);
      const loads = readRunState(runDir).roleChain?.confirmationModel === 'two-confirmations' ? events.filter(event => optionalSkillLoadCurrent(runDir, event, advisory.execution.leaseToken)) : events;
      const unique = new Map(loads.map(item => [`${item.name}:${item.sha256}`, item]));
      const usage = advisory.execution.optionalSkillUsage || [];
      const reported = new Map(usage.map(item => [`${item.name}:${item.sha256}`, item]));
      if (reported.size !== usage.length || reported.size !== unique.size || [...unique.keys()].some(key => !reported.has(key))) die('agent must report each optional skill actually loaded in the current attempt, and may not claim unloaded skills');
      for (const item of usage) if (!item.rationale?.trim() || !['applied', 'not-applicable'].includes(item.decision) || !Array.isArray(item.appliedRules) || (item.decision === 'applied' && !item.appliedRules.some(rule => typeof rule === 'string' && rule.trim()))) die('optional skill usage must state its decision, rationale and applicable rules');
    }
    const staged = `${output}.${crypto.randomUUID()}.pending`;
    write(staged, advisory);
    const validation = spawnSync(process.execPath, [validator, 'validate', 'role-advisory.schema.json', staged], { encoding: 'utf8' });
    if (validation.status !== 0) { fs.rmSync(staged, { force: true }); die((validation.stderr || validation.stdout).trim()); }
    const span = startTraceSpan(runDir, { traceId: jobId, name: `agent.${advisory.roleId}`, kind: 'agent', attributes: { jobId, stage, attempt: job.attempt, advisory: relative(runDir, output) } });
    try {
      completeAgentAdvisory(runDir, jobId, { leaseToken: advisory.execution.leaseToken || null, output, content: fs.readFileSync(staged, 'utf8'), inputTokens: advisory.execution.inputTokens, outputTokens: advisory.execution.outputTokens, limit: selection.tokenBudget?.stage, metadata: { jobId, advisory: relative(runDir, output), estimatedByteHeuristic: floors, usageSource, tokenAccounting: usageSource === 'provider-reported' ? 'reported-by-host' : usageSource === 'unknown' ? 'unmetered-soft-budget' : 'estimated-or-unverified' } });
      endTraceSpan(runDir, span.spanId, { status: 'passed' });
    } catch (error) {
      try { settleAgentJob(runDir, jobId, { status: 'failed', leaseToken: advisory.execution.leaseToken || null, error: error.message, retryDelayMs: 0, usage: { inputTokens: advisory.execution.inputTokens, outputTokens: advisory.execution.outputTokens, usageSource } }); } catch {}
      endTraceSpan(runDir, span.spanId, { status: 'failed', error: error.message });
      throw error;
    } finally { fs.rmSync(staged, { force: true }); }
  } else { write(output, advisory); validate('role-advisory.schema.json', output); }
  console.log(JSON.stringify({ stage, roleId: advisory.roleId, advisory: output }));
}
function record(runDir, stage, input) {
  // An unreadable submission cannot identify an attempt or establish usage.
  const selection = loadSelection(runDir, stage); const advisory = read(path.resolve(input));
  const jobId = selection.agentJobs?.[advisory?.roleId];
  const execution = advisory?.execution;
  recordErrorsThrow = true;
  try {
    recordChecked(runDir, stage, selection, advisory);
  } catch (error) {
    // The ledger fences stale leases and settles each attempt atomically.
    try {
      const job = jobId && agentRuntimeStatus(runDir, jobId).jobs[0];
      if (job && job.agentId === advisory.roleId && job.stage === stage && job.status === 'running' && execution?.sessionId === job.payload?.agentSessionId && typeof execution?.leaseToken === 'string') {
        const source = execution.usageSource || 'legacy-unverified';
        const valid = ['provider-reported', 'estimated', 'unknown', 'legacy-unverified'].includes(source) && [execution.inputTokens, execution.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) && Number.isSafeInteger(execution.inputTokens + execution.outputTokens) && (source !== 'unknown' || (execution.inputTokens === 0 && execution.outputTokens === 0));
        const usage = valid ? { inputTokens: execution.inputTokens, outputTokens: execution.outputTokens, usageSource: source } : { inputTokens: 0, outputTokens: 0, usageSource: 'unknown' };
        settleAgentJob(runDir, jobId, { status: 'failed', leaseToken: execution.leaseToken, error: error.message, usage });
      }
    } catch (settlementError) {
      // A stale lease must not be charged to its replacement; surface all
      // settlement failures so an unaccounted attempt is never hidden.
      console.error(`Role advisory attempt settlement failed: ${settlementError.message}`);
    }
    console.error(`Role advisory failed: ${error.message}`);
    process.exitCode = 1;
  } finally { recordErrorsThrow = false; }
}
function degrade() {
  // A selected role is part of the stage's declared professional evidence.
  // Writing an invented ready advisory after it failed made a Gate look
  // complete even though its required review never occurred.  The guarded
  // action itself must fail and leave its receipt as the single blocking fact.
  die('degrade is prohibited for selected role advisories; record a verified advisory or return the controlled operation failure');
}
function repair(runDir, stage) {
  // A role stage is invalid only when its durable inputs, receipts, or jobs no
  // longer bind the current Run. Preserve the old evidence for audit, then
  // make the standard select -> record -> summarize chain rebuild it.  This
  // is intentionally distinct from `degrade`: no fictional advisory is ever
  // emitted to satisfy a Gate.
  const source = stageDirectory(runDir, stage);
  if (!fs.existsSync(source)) { console.log(JSON.stringify({ stage, status: 'already-clear' })); return; }
  const selectionFile = path.join(source, 'selection.json');
  let supersededJobs = [];
  if (fs.existsSync(selectionFile)) {
    const selection = read(selectionFile);
    if (selection.agentJobs) {
      if (!Array.isArray(selection.selectedRoles) || selection.selectedRoles.some(role => typeof selection.agentJobs[role] !== 'string') || Object.keys(selection.agentJobs).length !== selection.selectedRoles.length) die('role repair has incomplete durable job bindings');
      supersededJobs = supersedeQueuedAgentJobs(runDir, stage, selection.selectedRoles.map(role => selection.agentJobs[role]));
    }
  }
  const archive = path.join(runDir, 'invalidated', `${Date.now()}-role-input-repair`, 'advisories', stage);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.renameSync(source, archive);
  const references = fs.readdirSync(archive).filter(name => fs.statSync(path.join(archive, name)).isFile()).map(name => `advisories/${stage}/${name}`);
  archiveArtifacts(runDir, references, `role-stage-repair:${stage}`);
  const manifestFile = path.join(runDir, 'role-advisory-manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = read(manifestFile);
    if (Object.hasOwn(manifest.stages || {}, stage)) {
      archiveArtifacts(runDir, ['role-advisory-manifest.json'], 'role-stage-repaired');
      delete manifest.stages[stage];
      write(manifestFile, manifest);
    }
  }
  const state = stateFor(runDir);
  if (state.artifacts?.roleDecisionSummaries) delete state.artifacts.roleDecisionSummaries[stage];
  saveState(runDir, state);
  console.log(JSON.stringify({ stage, status: 'repaired', archive: relative(runDir, archive), supersededJobs }));
}
function summarize(runDir, stage) {
  const selection = loadSelection(runDir, stage); const entries = selection.selectedRoles.map(roleId => {
    const file = path.join(stageDirectory(runDir, stage), `${roleId}.json`); if (!fs.existsSync(file)) die(`selected ${stage} role has no recorded advisory: ${roleId}`);
    const advisory = read(file); validate('role-advisory.schema.json', file);
    if (advisory.findings.some(item => item.classification === 'unverified')) die(`selected ${stage} role contains unverified findings: ${roleId}`);
    return { roleId, file, advisory };
  });
  if (selection.agentJobs) {
    const statuses = new Map(agentRuntimeStatus(runDir).jobs.map(job => [job.jobId, job.status]));
    for (const roleId of selection.selectedRoles) if (statuses.get(selection.agentJobs[roleId]) !== 'succeeded') die(`dedicated Agent job is not complete for ${roleId}: ${statuses.get(selection.agentJobs[roleId]) || 'missing'}`);
  }
  const findingLine = (entry, item) => `- ${entry.roleId}: ${item.statement}（依据：${(item.evidence || []).join('、') || '无'}）`;
  const facts = entries.flatMap(entry => entry.advisory.findings.filter(item => item.classification === 'fact').map(item => findingLine(entry, item)));
  const inferences = entries.flatMap(entry => entry.advisory.findings.filter(item => item.classification === 'inference').map(item => findingLine(entry, item)));
  const recommendations = entries.flatMap(entry => entry.advisory.recommendations.map(item => `- ${entry.roleId}/${item.id}: ${item.choice}。${item.rationale}`));
  const skillDecisions = entries.flatMap(entry => {
    const taste = entry.advisory.execution?.tasteSkillUsage;
    const required = taste ? [`- ${entry.roleId}/taste-skill（${taste.sha256}）：采用 ${taste.appliedRules.join('；')}；不适用 ${taste.notApplicableRules.join('；') || '无'}。`] : [];
    const optional = (entry.advisory.execution?.optionalSkillUsage || []).map(item => `- ${entry.roleId}/${item.name}（${item.sha256}）：${item.decision === 'applied' ? '采用' : '不适用'}；理由：${item.rationale}；规则：${item.appliedRules.join('；') || '无'}。`);
    return [...required, ...optional];
  });
  const skillSection = skillDecisions.length ? `\n\n## 技能采用与场景取舍\n${skillDecisions.join('\n')}` : '';
  const productReview = entries.find(entry => entry.roleId === 'product-manager' && stage === 'verify')?.advisory.productReview || [];
  const requirementReview = entries.find(entry => entry.roleId === 'product-manager' && stage === 'verify')?.advisory.requirementReview || [];
  const requestCoverage = entries.find(entry => entry.roleId === 'product-manager' && stage === 'verify')?.advisory.requestCoverage;
  const productSection = productReview.length ? `\n\n## 产品任务复核\n${productReview.map(item => `- ${item.task}：预期 ${item.expectedOutcome}；观察 ${item.observedOutcome}；依据 ${item.evidence}；理由 ${item.rationale}。`).join('\n')}` : '';
  const revisionSection = (requestCoverage?.revisionReviews || []).map(item => `- 调整 ${item.index + 1}：${item.reason}；${item.verdict}；依据 ${item.evidenceIds.join('、')}；${item.rationale}。`).join('\n');
  const requirementSection = requirementReview.length ? `\n\n## 需求与验收逐项复核\n需求记录覆盖判断：${requestCoverage?.rationale || '无'}。\n${requirementReview.map(item => `- ${item.criterion}：${item.verdict}；任务 ${item.productTasks.join('、') || '无'}；实施 ${item.implementationTargets.join('、') || '无'}；证据 ${item.evidenceIds.join('、')}；${item.rationale}；${item.implementationRationale}。`).join('\n')}${revisionSection ? `\n\n### 用户调整复核\n${revisionSection}` : ''}` : '';
  const summary = `# ${stage} 角色决策摘要\n\n## 角色标注的事实与依据\n${facts.length ? facts.join('\n') : '- 无新增事实。'}\n\n这些标注关联当前输入证据，不代表独立事实核验。\n\n## 推断\n${inferences.length ? inferences.join('\n') : '- 无新增推断。'}\n\n## 选择与理由\n${recommendations.length ? recommendations.join('\n') : '- 无新增建议。'}${skillSection}${productSection}${requirementSection}\n\n## 角色边界\n这些结论仅作为 APEX 内部 advisory；Router 仍是唯一状态、Gate 与实施授权方，用户只在当前 Gate 汇总确认。\n`;
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
    for (const advisory of item.advisories) {
      const file = path.resolve(runDir, advisory.path);
      if (!file.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(file) || hash(file) !== advisory.sha256) die(`role advisory hash does not match: ${advisory.roleId}`);
      const content = read(file);
      if (content.findings.some(finding => finding.classification === 'unverified')) die(`selected role advisory is not evidence-complete: ${advisory.roleId}`);
    }
  }
  console.log(JSON.stringify({ status: 'passed', stages }));
}

const [command, runArg, stage, input] = process.argv.slice(2);
assertRoot();
if (!command || !runArg || !stage || !['select', 'record', 'degrade', 'repair', 'rebudget', 'summarize', 'verify'].includes(command)) die('usage: select|record|degrade|repair|rebudget|summarize|verify <run-dir> <baseline|gate1|visual|implementation|verify> [advisory.json]');
const runDir = path.resolve(runArg); const action = actionFor(stage);
try { requireRouterAction(runDir, command === 'rebudget' ? [action, 'recover'] : action); } catch (error) { die(error.message); }
if (command === 'select') select(runDir, stage);
else if (command === 'record') { if (!input) die('record requires an advisory JSON file'); record(runDir, stage, input); }
else if (command === 'degrade') { const [, , , roleId, reason] = process.argv.slice(2); if (!roleId || !reason) die('degrade requires a role id and observed reason'); degrade(runDir, stage, roleId, reason); }
else if (command === 'repair') repair(runDir, stage);
else if (command === 'rebudget') rebudget(runDir, stage);
else if (command === 'summarize') summarize(runDir, stage);
else verify(runDir, stage);
