#!/usr/bin/env node
/** Contract test for the controlled, non-interactive professional role chain. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentRuntimeStatus } from './run-ledger.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
const roleScript = 'role-advisory.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-role-advisory-'));
function run(script, args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
function expect(result, message) { if (result.status !== 0) throw new Error(`${message}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); }
function reject(result, pattern, message) { if (result.status === 0 || !pattern.test(`${result.stderr || ''}\n${result.stdout || ''}`)) throw new Error(`${message}: ${(result.stderr || result.stdout).trim()}`); }
try {
  const intake = expect(run(router, ['intake', root, 'role-run', 'greenfield', 'full', 'interactive', 'role-session', '确认调用 APEX']), 'new role-chain run intake must succeed');
  if (intake.nextRequiredAction !== 'analyze_requirement') throw new Error('new role-chain run must retain the normal Gate 1 automatic action');
  const runDir = path.join(root, '.apex', 'runs', 'role-run');
  // A product with a real API/data capability must materialize the dedicated
  // backend profession, rather than leaving it as a registry-only label.
  const stateFile = path.join(runDir, 'state.json');
  const seededState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.writeFileSync(path.join(runDir, 'delivery-contract.json'), JSON.stringify({ capabilities: ['backend', 'api-contract'] }) + '\n');
  seededState.artifacts.deliveryContract = 'delivery-contract.json';
  fs.writeFileSync(stateFile, `${JSON.stringify(seededState, null, 2)}\n`);
  const authorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'role selection must receive a normal analyze_requirement authorization');
  if (!authorization.authorizationToken?.stateHash) throw new Error('Router authorization must expose the immutable authorization token without overwriting it with the run authorization mode');
  const selected = expect(run(action, ['run', root, 'role-run', 'role-session', authorization.authorizationRef, 'analyze_requirement', roleScript, 'select', runDir, 'gate1']), 'role selector must run through the action gateway');
  if (!selected.selectedRoles.includes('product-manager') || !selected.selectedRoles.includes('senior-project-manager') || !selected.selectedRoles.includes('backend-architect')) throw new Error('a backend-capable Gate 1 must activate product, delivery, and backend professionals');
  const selection = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories', 'gate1', 'selection.json'), 'utf8'));
  if (Object.keys(selection.agentJobs || {}).length !== selection.selectedRoles.length) throw new Error('role selection must create one durable dedicated Agent job per selected role');
  const failedRole = selection.selectedRoles[0];
  const failedAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'a controlled failed role attempt must receive an authorization');
  reject(run(action, ['run', root, 'role-run', 'role-session', failedAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'degrade', runDir, 'gate1', failedRole, 'simulated advisory failure']), /degrade is prohibited/, 'selected role failures must not be converted into an unverified ready advisory');
  const duplicateAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'a new authorization can be obtained only to test duplicate failure protection');
  reject(run(action, ['run', root, 'role-run', 'role-session', duplicateAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'degrade', runDir, 'gate1', failedRole, 'simulated advisory failure']), /identical controlled operation already failed/, 'a fresh authorization must not restart an identical failed controlled operation');
  const underreported = {
    schemaVersion: '1.0', roleId: failedRole, stage: 'gate1', adapterVersion: '1.0.0', inputBindings: selection.inputBindings,
    findings: [{ id: 'underreported-fact', classification: 'fact', statement: 'This advisory intentionally underreports its consumed context.', evidence: selection.inputBindings.map(item => item.path) }],
    execution: { inputTokens: 0, outputTokens: 0, model: 'contract-test', sessionId: 'not-yet-claimed', skillBindings: [] },
    recommendations: [{ id: 'underreported-choice', choice: 'Reject impossible token reports.', rationale: 'Budget evidence must not accept zero for bound artifacts.', alternatives: ['Trust unchecked host input'], acceptance: ['The record is rejected before job settlement.'] }], status: 'ready'
  };
  const underreportedInput = path.join(runDir, 'underreported-advisory.json'); fs.writeFileSync(underreportedInput, `${JSON.stringify(underreported, null, 2)}\n`);
  const underreportedAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'an underreported advisory must receive a controlled authorization before rejection');
  reject(run(action, ['run', root, 'role-run', 'role-session', underreportedAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'record', runDir, 'gate1', underreportedInput]), /below the frozen-input floor/, 'an advisory cannot underreport its frozen input token usage');
  const fabricatedEvidence = { ...underreported, execution: { ...underreported.execution, inputTokens: 1000, outputTokens: 1000 }, findings: [{ ...underreported.findings[0], evidence: ['invented-evidence.json'] }] };
  const fabricatedInput = path.join(runDir, 'fabricated-evidence-advisory.json'); fs.writeFileSync(fabricatedInput, `${JSON.stringify(fabricatedEvidence, null, 2)}\n`);
  const fabricatedAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'a fabricated evidence advisory must receive a controlled authorization before rejection');
  reject(run(action, ['run', root, 'role-run', 'role-session', fabricatedAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'record', runDir, 'gate1', fabricatedInput]), /not a current frozen stage binding/, 'an advisory cannot cite fabricated evidence outside the current frozen bindings');
  for (const roleId of selection.selectedRoles) {
    const job = agentRuntimeStatus(runDir).jobs.find(item => item.jobId === selection.agentJobs[roleId]);
    const advisory = {
      schemaVersion: '1.0', roleId, stage: 'gate1', adapterVersion: '1.0.0', inputBindings: selection.inputBindings,
      findings: [{ id: `${roleId}-fact`, classification: 'fact', statement: 'The current requirement and delivery artifacts are bound for review.', evidence: selection.inputBindings.map(item => item.path) }],
      execution: { inputTokens: 1000, outputTokens: 1000, model: 'contract-test', sessionId: job.payload.agentSessionId, skillBindings: job.payload.skillBindings },
      recommendations: [{ id: `${roleId}-choice`, choice: 'Keep the approved delivery boundary explicit.', rationale: 'It provides a testable handoff to the visual stage.', alternatives: ['Expand the scope without a new Gate'], acceptance: ['The Gate 1 presentation names scope, risks, and acceptance.'] }], status: 'ready'
    };
    const input = path.join(runDir, `${roleId}-input.json`); fs.writeFileSync(input, `${JSON.stringify(advisory, null, 2)}\n`);
    const claimAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), `role ${roleId} claim authorization must be current`);
    const claim = expect(run(action, ['run', root, 'role-run', 'role-session', claimAuthorization.authorizationRef, 'analyze_requirement', 'agent-runtime.mjs', 'claim', runDir, selection.agentJobs[roleId], 'gate1']), `role ${roleId} must claim its dedicated Agent job before work`);
    advisory.execution.leaseToken = claim.leaseToken;
    const research = roleId === 'product-manager' && claim.optionalSkills?.find(item => item.name === 'research-intake');
    if (research) {
      const skillAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'research-intake load authorization');
      const loaded = expect(run(action, ['run', root, 'role-run', 'role-session', skillAuthorization.authorizationRef, 'analyze_requirement', 'agent-runtime.mjs', 'skill', runDir, selection.agentJobs[roleId], 'gate1', claim.leaseToken, research.name, research.sha256]), 'load research-intake for a research-dependent product task');
      if (loaded.skill.sha256 !== research.sha256 || !loaded.skill.content.includes('调研')) throw new Error('research-intake must load its actual bound instructions');
      advisory.execution.optionalSkillUsage = [{ name: research.name, sha256: research.sha256, decision: 'applied', rationale: 'The task requires current-source research.', appliedRules: ['Classify time sensitivity before selecting sources.'] }];
    }
    fs.writeFileSync(input, `${JSON.stringify(advisory, null, 2)}\n`);
    const recordAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), `role ${roleId} record authorization must be current`);
    expect(run(action, ['run', root, 'role-run', 'role-session', recordAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'record', runDir, 'gate1', input]), `role ${roleId} advisory must be recorded through the action gateway`);
  }
  const summarizeAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'role summary authorization must be current');
  const summary = expect(run(action, ['run', root, 'role-run', 'role-session', summarizeAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'summarize', runDir, 'gate1']), 'role summary must be generated through the action gateway');
  const manifest = JSON.parse(fs.readFileSync(summary.manifest, 'utf8'));
  if (manifest.status !== 'ready' || manifest.stages.gate1.advisories.length !== selection.selectedRoles.length || !manifest.stages.gate1.advisories.every(item => item.operationReceipt) || !manifest.stages.gate1.summarySha256 || !fs.readFileSync(summary.summary, 'utf8').includes('角色决策摘要')) throw new Error('role manifest must retain selected roles, controlled receipts, hashes, and a human-readable synthesis');
  const summaryText = fs.readFileSync(summary.summary, 'utf8');
  if (!summaryText.includes('角色标注的事实与依据') || !summaryText.includes('不代表独立事实核验') || !summaryText.includes('## 推断') || !summaryText.includes(selection.inputBindings[0].path)) throw new Error('role summary must distinguish attributed facts from inference and retain their evidence references');
  const productAdvisory = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories', 'gate1', 'product-manager.json')));
  if (productAdvisory.execution.optionalSkillUsage?.length && !fs.readFileSync(summary.summary, 'utf8').includes('research-intake')) throw new Error('actually loaded research decisions must be handed off in the role summary');
  if (agentRuntimeStatus(runDir).counts.succeeded !== selection.selectedRoles.length) throw new Error('each recorded role advisory must settle its own dedicated Agent job successfully');
  const verifyAuthorization = expect(run(router, ['authorize', root, 'role-run', 'role-session', 'analyze_requirement']), 'role verification authorization must be current after summary state registration');
  const verified = expect(run(action, ['run', root, 'role-run', 'role-session', verifyAuthorization.authorizationRef, 'analyze_requirement', roleScript, 'verify', runDir, 'gate1']), 'role manifest verification must run through the action gateway');
  if (verified.status !== 'passed') throw new Error('role verification must produce a passed receipt');
  console.log(JSON.stringify({ status: 'passed', selectedRoles: selection.selectedRoles }));
} catch (error) {
  console.error(`APEX role advisory contract test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
