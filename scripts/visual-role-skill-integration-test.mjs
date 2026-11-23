#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRunState, commitRunState, agentRuntimeStatus, archiveArtifacts, recoverAgentJobs, recordTokenUsage, runLedgerPaths } from './run-ledger.mjs';
import { assertVisualCapabilityEvidence } from './design-capability-contract.mjs';
import { requiredTasteLoadCurrent, optionalSkillLoadCurrent } from './required-visual-skill.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-visual-role-skill-'));
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30000 });
function expect(result, context) { assert.equal(result.status, 0, `${context}: ${result.stderr || result.stdout}`); return JSON.parse(result.stdout); }
try {
  expect(run(router, ['intake', root, 'visual-skill-run', 'greenfield', 'full', 'interactive', 'visual-skill-session', '确认调用 APEX']), 'intake');
  const runDir = path.join(root, '.apex', 'runs', 'visual-skill-run');
  // The test seeds the already-passed product gate so it isolates the visual-role handoff.
  const state = readRunState(runDir);
  state.gates.gate1 = { status: 'passed', at: new Date().toISOString(), evidence: ['test-fixture'] };
  state.locks.requirementsApproved = true;
  state.revision += 1;
  commitRunState(runDir, state, { reason: 'visual-skill-integration-fixture' });
  const authorize = () => expect(run(router, ['authorize', root, 'visual-skill-run', 'visual-skill-session', 'plan_visual']), 'authorize visual').authorizationRef;
  const invoke = (ref, script, args) => run(action, ['run', root, 'visual-skill-run', 'visual-skill-session', ref, 'plan_visual', script, ...args]);
  const selection = expect(invoke(authorize(), 'role-advisory.mjs', ['select', runDir, 'visual']), 'select visual roles');
  assert.ok(selection.selectedRoles.includes('ui-designer'));
  const selectionPath = path.join(runDir, 'advisories', 'visual', 'selection.json');
  const firstSelection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  const countBeforeReplay = agentRuntimeStatus(runDir).jobs.length;
  // Simulate a crash after Job enqueue but before selection was registered.
  archiveArtifacts(runDir, ['advisories/visual/selection.json'], 'simulate-uncommitted-selection');
  fs.rmSync(selectionPath);
  expect(invoke(authorize(), 'role-advisory.mjs', ['select', runDir, 'visual']), 'replay interrupted visual selection');
  const savedSelection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  assert.deepEqual(savedSelection.agentJobs, firstSelection.agentJobs);
  assert.equal(agentRuntimeStatus(runDir).jobs.length, countBeforeReplay);
  const jobId = savedSelection.agentJobs['ui-designer'];
  const queued = agentRuntimeStatus(runDir, jobId).jobs[0];
  const hostUsage = expect(invoke(authorize(), 'agent-runtime.mjs', ['tokens-observed', runDir, 'visual', 'independent_host_0001', '0', '0', 'unknown']), 'record independent host usage');
  assert.equal(hostUsage.budgetScope, 'reported-usage-only');
  assert.equal(hostUsage.idempotent, false);
  const inconsistentDb = new DatabaseSync(runLedgerPaths(runDir).ledger);
  const originalPayload = inconsistentDb.prepare('SELECT payload_json FROM agent_jobs WHERE job_id = ?').get(jobId).payload_json;
  inconsistentDb.prepare('UPDATE agent_jobs SET payload_json = ? WHERE job_id = ?').run(JSON.stringify({ ...queued.payload, roleId: 'wrong-role' }), jobId); inconsistentDb.close();
  const inconsistentSelection = invoke(authorize(), 'role-advisory.mjs', ['select', runDir, 'visual']);
  assert.notEqual(inconsistentSelection.status, 0);
  assert.match(inconsistentSelection.stderr, /missing or inconsistent durable job/);
  const restoreDb = new DatabaseSync(runLedgerPaths(runDir).ledger);
  restoreDb.prepare('UPDATE agent_jobs SET payload_json = ? WHERE job_id = ?').run(originalPayload, jobId); restoreDb.close();
  assert.equal(agentRuntimeStatus(runDir).jobs.length, countBeforeReplay);
  const missingTaste = { ...queued.payload }; delete missingTaste.tasteSkill;
  const missingTasteDb = new DatabaseSync(runLedgerPaths(runDir).ledger);
  missingTasteDb.prepare('UPDATE agent_jobs SET payload_json = ? WHERE job_id = ?').run(JSON.stringify(missingTaste), jobId); missingTasteDb.close();
  const claimWithoutTaste = invoke(authorize(), 'agent-runtime.mjs', ['claim', runDir, jobId, 'visual']);
  assert.notEqual(claimWithoutTaste.status, 0); assert.match(claimWithoutTaste.stderr, /missing required taste-skill binding/);
  assert.equal(agentRuntimeStatus(runDir, jobId).jobs[0].status, 'queued');
  const tasteRestoreDb = new DatabaseSync(runLedgerPaths(runDir).ledger);
  tasteRestoreDb.prepare('UPDATE agent_jobs SET payload_json = ? WHERE job_id = ?').run(originalPayload, jobId); tasteRestoreDb.close();
  assert.ok(queued.payload.skillBindings.includes('taste-skill'));
  assert.ok(savedSelection.tokenBudget.requiredSkillFloor > 0);
  assert.ok(savedSelection.tokenBudget.perRole['ui-designer'] >= savedSelection.tokenBudget.inputFloor + savedSelection.tokenBudget.requiredSkillFloor + 1000, 'designer budget must include the mandatory taste instructions');
  assert.equal(queued.payload.tokenBudget, savedSelection.tokenBudget.perRole['ui-designer']);
  assert.equal(savedSelection.tokenBudget.perRole['ux-architect'], savedSelection.tokenBudget.perAgent, 'unrelated roles must not inherit the full taste budget');

  // Simulate an older persisted job with a stale stage cap. Router must
  // direct the host to rebudget rather than verify or repeat a claim.
  const staleBudgetDb = new DatabaseSync(runLedgerPaths(runDir).ledger);
  const stalePayload = { ...queued.payload, stageTokenBudget: queued.payload.stageTokenBudget - 1 };
  staleBudgetDb.prepare('UPDATE agent_jobs SET payload_json = ? WHERE job_id = ?').run(JSON.stringify(stalePayload), jobId); staleBudgetDb.close();
  const budgetStatus = expect(run(router, ['status', root, 'visual-skill-run', 'visual-skill-session']), 'inspect stale stage budget');
  assert.equal(budgetStatus.executionDirective?.currentStep?.id, 'visual-role-rebudget');
  assert.match(budgetStatus.executionDirective.currentStep.details, /role-advisory\.mjs rebudget/);
  expect(invoke(authorize(), 'role-advisory.mjs', ['rebudget', runDir, 'visual']), 'repair stage budget');
  assert.equal(agentRuntimeStatus(runDir, jobId).jobs[0].payload.stageTokenBudget, savedSelection.tokenBudget.stage);
  assert.equal(expect(run(router, ['status', root, 'visual-skill-run', 'visual-skill-session']), 'inspect repaired budget').integrity.status, 'consistent');

  const claimKey = 'designer_claim_key_2026';
  const claimAuth = authorize();
  const claimed = expect(invoke(claimAuth, 'agent-runtime.mjs', ['claim', runDir, jobId, 'visual', claimKey]), 'claim design role');
  // Recover a lost selection projection while an already-claimed designer is running.
  archiveArtifacts(runDir, ['advisories/visual/selection.json'], 'simulate-selection-projection-loss');
  fs.rmSync(selectionPath);
  expect(invoke(authorize(), 'role-advisory.mjs', ['select', runDir, 'visual']), 'recover selection with running designer');
  assert.deepEqual(JSON.parse(fs.readFileSync(selectionPath, 'utf8')).agentJobs, savedSelection.agentJobs);
  assert.equal(agentRuntimeStatus(runDir).jobs.length, countBeforeReplay);
  assert.equal(agentRuntimeStatus(runDir).sessions.find(session => session.agentId === 'ui-designer').status, 'working');
  const cachedClaim = invoke(claimAuth, 'agent-runtime.mjs', ['claim', runDir, jobId, 'visual', claimKey]);
  assert.notEqual(cachedClaim.status, 0); assert.match(cachedClaim.stderr, /fresh Router authorization/);
  const replayedClaim = expect(invoke(authorize(), 'agent-runtime.mjs', ['claim', runDir, jobId, 'visual', claimKey]), 'recover a lost claim response with a current authorization');
  assert.equal(replayedClaim.leaseToken, claimed.leaseToken); assert.equal(replayedClaim.attempt, claimed.attempt); assert.equal(replayedClaim.idempotent, true);
  assert.equal(claimed.requiredSkill.sha256, queued.payload.tasteSkill.sha256);
  assert.match(claimed.requiredSkill.content, /tasteskill/i);
  const optional = claimed.optionalSkills.find(item => item.name === 'impeccable');
  assert.ok(optional && optional.sha256, 'designer must discover installed optional visual skills without loading all instructions');
  const loaded = expect(invoke(authorize(), 'agent-runtime.mjs', ['skill', runDir, jobId, 'visual', claimed.leaseToken, optional.name, optional.sha256]), 'load applicable visual skill');
  assert.equal(loaded.skill.sha256, optional.sha256);
  assert.match(loaded.skill.content, /impeccable/i);
  const ledger = new DatabaseSync(runLedgerPaths(runDir).ledger, { readOnly: true });
  const loadedEvents = ledger.prepare("SELECT payload_json FROM events WHERE event_type = 'agent-visual-skill-loaded'").all().map(row => JSON.parse(row.payload_json)); ledger.close();
  assert.ok(loadedEvents.some(event => event.jobId === jobId && event.name === optional.name && event.sha256 === optional.sha256), 'actual optional skill loading must be auditable');
  const optionalEvent = loadedEvents.find(event => event.jobId === jobId && event.name === optional.name && event.sha256 === optional.sha256);
  assert.equal(optionalSkillLoadCurrent(runDir, optionalEvent, claimed.leaseToken), true);
  assert.equal(optionalSkillLoadCurrent(runDir, optionalEvent, 'wrong-lease'), false);
  const optionalReceiptPath = path.join(runDir, optionalEvent.operationReceipt), optionalReceiptBytes = fs.readFileSync(optionalReceiptPath);
  const changedOptionalReceipt = JSON.parse(optionalReceiptBytes), changedOptional = JSON.parse(changedOptionalReceipt.stdout); changedOptional.skill.content += ' tampered'; changedOptionalReceipt.stdout = JSON.stringify(changedOptional); fs.writeFileSync(optionalReceiptPath, JSON.stringify(changedOptionalReceipt));
  assert.equal(optionalSkillLoadCurrent(runDir, optionalEvent, claimed.leaseToken), false, 'changed optional Skill content must invalidate the receipt'); fs.writeFileSync(optionalReceiptPath, optionalReceiptBytes);

  const deniedSkill = invoke(authorize(), 'agent-runtime.mjs', ['skill', runDir, jobId, 'visual', claimed.leaseToken, optional.name, 'sha256:changed']);
  assert.notEqual(deniedSkill.status, 0);
  assert.match(deniedSkill.stderr, /missing or changed/);
  const advisory = {
    schemaVersion: '1.0', roleId: 'ui-designer', stage: 'visual', adapterVersion: '1.0.0', inputBindings: savedSelection.inputBindings,
    findings: [{ id: 'visual-fact', classification: 'fact', statement: 'The delivery contract is bound to this role.', evidence: savedSelection.inputBindings.map(item => item.path) }],
    recommendations: [{ id: 'visual-choice', choice: 'Choose a context-appropriate hierarchy.', rationale: 'The hierarchy follows the product task.', acceptance: ['The selected direction reflects the task.'] }],
    execution: { inputTokens: 1, outputTokens: 1, usageSource: 'provider-reported', model: 'integration-fixture', sessionId: queued.payload.agentSessionId, skillBindings: queued.payload.skillBindings, leaseToken: claimed.leaseToken }, status: 'ready'
  };
  const input = path.join(runDir, 'designer-advisory.json');
  fs.writeFileSync(input, JSON.stringify(advisory));
  const missing = invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', input]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /must report the loaded taste-skill hash/);
  advisory.execution.tasteSkillUsage = { sha256: queued.payload.tasteSkill.sha256, appliedRules: ['Use task-appropriate visual hierarchy.'], notApplicableRules: ['Do not impose landing-page motion on a dashboard.'] };
  assert.equal(recoverAgentJobs(runDir, { force: true }).find(item => item.jobId === jobId)?.status, 'queued');
  const replacementAuthorization = authorize();
  const replacement = expect(invoke(replacementAuthorization, 'agent-runtime.mjs', ['claim', runDir, jobId, 'visual']), 'claim replacement designer');
  assert.notEqual(replacement.leaseToken, claimed.leaseToken);
  assert.equal(requiredTasteLoadCurrent(runDir, jobId, replacement.attempt, replacement.leaseToken, queued.payload.tasteSkill), true);
  assert.equal(requiredTasteLoadCurrent(runDir, jobId, replacement.attempt + 1, replacement.leaseToken, queued.payload.tasteSkill), false);
  assert.equal(requiredTasteLoadCurrent(runDir, jobId, replacement.attempt, claimed.leaseToken, queued.payload.tasteSkill), false);
  const requiredReceiptPath = path.join(runDir, 'operations', `${path.basename(replacementAuthorization, '.json')}.json`), requiredReceiptBytes = fs.readFileSync(requiredReceiptPath);
  const alteredReceipt = JSON.parse(requiredReceiptBytes); const alteredClaim = JSON.parse(alteredReceipt.stdout); alteredClaim.requiredSkill.content += ' tampered'; alteredReceipt.stdout = JSON.stringify(alteredClaim); fs.writeFileSync(requiredReceiptPath, JSON.stringify(alteredReceipt));
  assert.equal(requiredTasteLoadCurrent(runDir, jobId, replacement.attempt, replacement.leaseToken, queued.payload.tasteSkill), false, 'changed Skill content must invalidate the receipt');
  fs.writeFileSync(requiredReceiptPath, requiredReceiptBytes);

  fs.writeFileSync(input, JSON.stringify(advisory));
  const stale = invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', input]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /lease token is stale or missing/);
  assert.equal(fs.existsSync(path.join(runDir, 'advisories', 'visual', 'ui-designer.json')), false);
  advisory.execution.leaseToken = replacement.leaseToken;
  const failedRequiredReceipt = JSON.parse(requiredReceiptBytes); failedRequiredReceipt.status = 'failed'; fs.writeFileSync(requiredReceiptPath, JSON.stringify(failedRequiredReceipt)); fs.writeFileSync(input, JSON.stringify(advisory));
  const missingControlledReceipt = invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', input]); assert.notEqual(missingControlledReceipt.status, 0); assert.match(missingControlledReceipt.stderr, /successful current-attempt controlled taste-skill load receipt/);
  fs.writeFileSync(requiredReceiptPath, requiredReceiptBytes);
  expect(invoke(authorize(), 'agent-runtime.mjs', ['skill', runDir, jobId, 'visual', replacement.leaseToken, optional.name, optional.sha256]), 'reload applicable skill for the new attempt');
  fs.writeFileSync(input, JSON.stringify(advisory));
  const unreported = invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', input]);
  assert.notEqual(unreported.status, 0);
  assert.match(unreported.stderr, /report each optional skill actually loaded/);
  const designMd = replacement.optionalSkills.find(item => item.name === 'google-design-md'); assert.ok(designMd);
  expect(invoke(authorize(), 'agent-runtime.mjs', ['skill', runDir, jobId, 'visual', replacement.leaseToken, designMd.name, designMd.sha256]), 'load design contract skill');
  advisory.execution.optionalSkillUsage = [{ name: optional.name, sha256: optional.sha256, decision: 'applied', rationale: 'The task needs clear interaction hierarchy.', appliedRules: ['Check hierarchy and task feedback.'] }, { name: designMd.name, sha256: designMd.sha256, decision: 'applied', rationale: 'The design needs a stable implementation contract.', appliedRules: ['Bind design decisions to the design contract.'] }];
  fs.writeFileSync(input, JSON.stringify(advisory));
  expect(invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', input]), 'record designer advisory');
  assert.equal(agentRuntimeStatus(runDir, jobId).jobs[0].status, 'succeeded');
  assert.deepEqual(assertVisualCapabilityEvidence(runDir, ['taste-skill', 'impeccable', 'google-design-md']).applied, ['google-design-md', 'impeccable', 'taste-skill']);
  fs.writeFileSync(requiredReceiptPath, JSON.stringify(failedRequiredReceipt)); assert.throws(() => assertVisualCapabilityEvidence(runDir, ['taste-skill', 'impeccable', 'google-design-md']), /current successful taste-skill load receipt/); fs.writeFileSync(requiredReceiptPath, requiredReceiptBytes);
  const currentSkillDb = new DatabaseSync(runLedgerPaths(runDir).ledger, { readOnly: true }); const currentSkillEvents = currentSkillDb.prepare("SELECT payload_json FROM events WHERE event_type='agent-visual-skill-loaded' ORDER BY id DESC").all().map(row => JSON.parse(row.payload_json)); currentSkillDb.close();
  const currentOptional = currentSkillEvents.find(event => event.jobId === jobId && event.attempt === replacement.attempt && event.name === optional.name), currentOptionalPath = path.join(runDir, currentOptional.operationReceipt), currentOptionalBytes = fs.readFileSync(currentOptionalPath), failedOptional = JSON.parse(currentOptionalBytes); failedOptional.status = 'failed'; fs.writeFileSync(currentOptionalPath, JSON.stringify(failedOptional));
  assert.throws(() => assertVisualCapabilityEvidence(runDir, ['taste-skill', 'impeccable', 'google-design-md']), /current successful receipts for cited optional Skills/); fs.writeFileSync(currentOptionalPath, currentOptionalBytes);

  assert.throws(() => assertVisualCapabilityEvidence(runDir, ['impeccable', 'google-design-md']), /mandatory taste-skill/);
  assert.throws(() => assertVisualCapabilityEvidence(runDir, ['taste-skill', 'impeccable', 'google-design-md', 'minimalist-ui']), /unproven=minimalist-ui/);
  assert.throws(() => assertVisualCapabilityEvidence(runDir, ['taste-skill', 'google-design-md']), /missing=impeccable/);
  const designerFile = path.join(runDir, 'advisories', 'visual', 'ui-designer.json'), designerBytes = fs.readFileSync(designerFile);
  fs.appendFileSync(designerFile, ' '); assert.throws(() => assertVisualCapabilityEvidence(runDir, ['taste-skill', 'impeccable', 'google-design-md']), /current completed designer job/); fs.writeFileSync(designerFile, designerBytes);

  assert.equal(agentRuntimeStatus(runDir).tokenUsageCoverage.visual.providerReported, 1);
  const uxId = savedSelection.agentJobs['ux-architect'];
  const uxJob = agentRuntimeStatus(runDir, uxId).jobs[0];
  let uxClaim = expect(invoke(authorize(), 'agent-runtime.mjs', ['claim', runDir, uxId, 'visual']), 'claim UX role');
  // Over-budget stopping and controlled recovery are covered in budget-recovery-router-test.
  const ux = { ...advisory, roleId: 'ux-architect', execution: { inputTokens: 0, outputTokens: 0, usageSource: 'unknown', model: 'unmetered-fixture', sessionId: uxJob.payload.agentSessionId, skillBindings: uxJob.payload.skillBindings, leaseToken: uxClaim.leaseToken } };
  const uxInput = path.join(runDir, 'ux-advisory.json'); fs.writeFileSync(uxInput, JSON.stringify(ux));
  expect(invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', uxInput]), 'record explicitly unmetered UX advisory');
  assert.equal(agentRuntimeStatus(runDir).tokenUsageCoverage.visual.unknown, 3); // independent host, interrupted designer, and unmetered UX
  for (const roleId of savedSelection.selectedRoles.filter(id => !['ui-designer', 'ux-architect'].includes(id))) {
    const selectedJob = agentRuntimeStatus(runDir, savedSelection.agentJobs[roleId]).jobs[0];
    const claim = expect(invoke(authorize(), 'agent-runtime.mjs', ['claim', runDir, selectedJob.jobId, 'visual']), `claim ${roleId}`);
    const review = { ...ux, roleId, execution: { ...ux.execution, sessionId: selectedJob.payload.agentSessionId, skillBindings: selectedJob.payload.skillBindings, leaseToken: claim.leaseToken } };
    const file = path.join(runDir, `fixture-${roleId}.json`); fs.writeFileSync(file, JSON.stringify(review));
    expect(invoke(authorize(), 'role-advisory.mjs', ['record', runDir, 'visual', file]), `record ${roleId}`);
  }
  expect(invoke(authorize(), 'role-advisory.mjs', ['summarize', runDir, 'visual']), 'summarize completed visual roles');
  const designText = '# Design contract\nPrioritize task hierarchy and clear feedback.\n';
  fs.writeFileSync(path.join(runDir, 'DESIGN.md'), designText);
  const designHash = `sha256:${(await import('node:crypto')).createHash('sha256').update(designText).digest('hex')}`;
  const kinds = ['layout', 'component', 'style', 'font', 'content'];
  const selections = kinds.map(kind => ({ id: kind, visualNodes: ['main'], kind, sourceType: 'native-web', sourceId: 'web', resourceId: kind, version: 'current', materialization: 'native-web', parameters: ['layout', 'style'].includes(kind) ? { pattern: kind, tokens: ['base'] } : kind === 'content' ? { origin: 'product', fields: ['task'], implementation: 'render task' } : {} }));
  const candidate = (kind, decision) => ({ sourceId: decision === 'selected' ? 'web' : 'alternative', resourceId: kind, version: 'current', platformFit: 'native', visualFit: 'clear', deliveryFit: 'compatible', decision });
  const responsive = { contractId: 'responsive', viewports: [{ class: 'mobile', minWidth: 320, maxWidth: 767, layoutMode: 'single' }, { class: 'tablet', minWidth: 768, maxWidth: 1023, layoutMode: 'two' }, { class: 'desktop', minWidth: 1024, maxWidth: 1920, layoutMode: 'wide' }], reflowRules: ['mobile', 'tablet', 'desktop'], overflowPolicy: { noUnintendedHorizontalOverflow: true, exceptions: [] }, typographyScale: 'readable', mediaBehavior: 'scale', acceptance: ['mobile', 'tablet', 'desktop'] };
  const benchmark = JSON.parse(fs.readFileSync(path.join(apexRoot, 'registry/industry-design-benchmarks.json'))).benchmarks[0];
  const plan = { schemaVersion: '3.0', deliveryNarrative: { mode: 'greenfield-selection', selections: [{ category: 'layout', sourceSelectionIds: ['layout'], selectionBasis: 'task hierarchy' }] }, layout: { informationArchitecture: ['task'], grid: 'single', responsive }, visualSystem: { styleDirection: 'clear', colors: ['white'], typography: 'system', effects: 'none' }, content: { hierarchy: ['task'], dataExpression: ['count'], states: ['default'] }, components: [{ visualNode: 'main' }], motion: [], dependencies: [], selectionAnalysis: { designCapabilities: ['taste-skill', 'impeccable', 'google-design-md'], designContract: { path: 'DESIGN.md', sha256: designHash, rules: ['hierarchy', 'spacing', 'color', 'responsive'] }, aestheticAssessment: { qualityRationale: 'Clear hierarchy supports the task.', coherenceChecks: ['layout', 'color', 'type', 'space', 'state'], rejectedPatterns: ['noise', 'clutter'] }, libraryComparisons: ['layout', 'style', 'component', 'font'].map(kind => ({ category: kind, candidates: [candidate(kind, 'selected'), candidate(kind, 'rejected')], decisionRationale: 'native source supports the task' })), userNeedFit: [{ need: 'complete task', selectedSourceIds: ['layout'], rationale: 'clear layout' }], alternatives: [{ candidate: 'complex layout', decision: 'unnecessary' }], industryBenchmark: { id: benchmark.id, scores: benchmark.criteria.map(criterion => ({ criterion, score: 4, sourceSelectionIds: ['layout'], rationale: 'task aligned' })) } }, sourceSelections: selections, risks: [], status: 'ready-for-user-confirmation' };
  { const designer = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories/visual/ui-designer.json'))); const rules = [{ skill: 'taste-skill', rules: designer.execution.tasteSkillUsage.appliedRules }, ...(designer.execution.optionalSkillUsage || []).filter(item => item.decision === 'applied').map(item => ({ skill: item.name, rules: item.appliedRules }))]; plan.selectionAnalysis.skillRuleDecisions = rules.flatMap(item => item.rules.map(rule => ({ skill: item.skill, rule, decision: 'Use task-oriented hierarchy in the selected layout.', rationale: 'The product task must remain clear and usable.', sourceSelectionIds: ['layout'] }))); }
  const planInput = path.join(runDir, 'visual-plan-input.json'); fs.writeFileSync(planInput, JSON.stringify(plan));
  const jobLedger = new DatabaseSync(path.join(runDir, 'run-ledger.sqlite'));
  jobLedger.prepare("UPDATE agent_jobs SET status = 'queued' WHERE job_id = ?").run(savedSelection.agentJobs['ui-designer']);
  jobLedger.close();
  const staleJob = run(path.join(apexRoot, 'scripts', 'apex-validate.mjs'), ['visual-role-stage', runDir]);
  assert.notEqual(staleJob.status, 0);
  assert.match(staleJob.stderr, /controlled role jobs are incomplete or stale/);
  const repairedLedger = new DatabaseSync(path.join(runDir, 'run-ledger.sqlite'));
  repairedLedger.prepare("UPDATE agent_jobs SET status = 'succeeded' WHERE job_id = ?").run(savedSelection.agentJobs['ui-designer']);
  repairedLedger.close();
  const summaryState = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json')));
  const summaryFile = path.join(runDir, summaryState.artifacts.roleDecisionSummaries.visual);
  const summaryText = fs.readFileSync(summaryFile, 'utf8');
  const staleAuthorization = authorize();
  fs.writeFileSync(summaryFile, `${summaryText}tampered\n`);
  const staleSummary = invoke(staleAuthorization, 'visual-execution-plan.mjs', ['compile', runDir, planInput]);
  assert.notEqual(staleSummary.status, 0, 'compiler must reject a changed role decision summary');
  const staleStage = run(path.join(apexRoot, 'scripts', 'apex-validate.mjs'), ['visual-role-stage', runDir]);
  assert.notEqual(staleStage.status, 0);
  assert.match(staleStage.stderr, /controlled role decision summary is missing or stale/);
  fs.writeFileSync(summaryFile, summaryText);
  const compiled = expect(invoke(authorize(), 'visual-execution-plan.mjs', ['compile', runDir, planInput]), 'compile visual plan with completed designer evidence');
  assert.ok(fs.existsSync(compiled.visualExecutionPlan));
  const compiledPlan = JSON.parse(fs.readFileSync(compiled.visualExecutionPlan));
  assert.deepEqual(compiledPlan.selectionAnalysis.designCapabilities, plan.selectionAnalysis.designCapabilities);

  // A material revision archives the previous role stage. It must allocate
  // one replacement epoch, not one for the revision plus one for the archive.
  const archiveVisual = name => {
    const source = path.join(runDir, 'advisories', 'visual');
    const files = fs.readdirSync(source).filter(file => fs.statSync(path.join(source, file)).isFile());
    const target = path.join(runDir, 'invalidated', name, 'advisories', 'visual');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    archiveArtifacts(runDir, files.map(file => `advisories/visual/${file}`), 'budget-epoch-fixture');
  };
  archiveVisual('1-role-prompt-revision-visual');
  fs.writeFileSync(path.join(runDir, 'prompt-revisions.ndjson'), `${JSON.stringify({ checkpoint: 'visual', impact: 'visible' })}\n`);
  expect(invoke(authorize(), 'role-advisory.mjs', ['select', runDir, 'visual']), 'select revised visual roles');
  const revised = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  const revisedBase = Math.max(24000, Object.values(revised.tokenBudget.perRole).reduce((sum, value) => sum + value, 0) + 2500);
  assert.equal(revised.tokenBudget.repairEpoch, 1);
  assert.equal(revised.tokenBudget.stage, revisedBase * 2, 'one revision gets one replacement allowance');
  archiveVisual('2-role-input-repair');
  expect(invoke(authorize(), 'role-advisory.mjs', ['select', runDir, 'visual']), 'select repaired visual roles');
  const repaired = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  const repairedBase = Math.max(24000, Object.values(repaired.tokenBudget.perRole).reduce((sum, value) => sum + value, 0) + 2500);
  assert.equal(repaired.tokenBudget.repairEpoch, 2);
  assert.equal(repaired.tokenBudget.stage, repairedBase * 3, 'independent repair gets its own allowance');
  const spent = agentRuntimeStatus(runDir).tokenUsage.visual || 0;
  recordTokenUsage(runDir, { stage: 'visual', inputTokens: repaired.tokenBudget.stage - spent, metadata: { usageSource: 'provider-reported', fixture: true } });
  const blockedId = repaired.agentJobs['ui-designer'];
  const exhausted = invoke(authorize(), 'agent-runtime.mjs', ['claim', runDir, blockedId, 'visual']);
  assert.notEqual(exhausted.status, 0); assert.match(exhausted.stderr, /stage-token-budget-exhausted/);
  const blocked = expect(run(router, ['status', root, 'visual-skill-run', 'visual-skill-session']), 'inspect exhausted budget');
  assert.equal(blocked.executionDirective?.blockingOperation?.category, 'token-budget-exhausted');
  assert.equal(blocked.terminalResponseContract?.allowed, true);

  console.log(JSON.stringify({ status: 'passed', checks: 54 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
