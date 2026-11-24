#!/usr/bin/env node
import { canonicalApexRoot, isCanonicalApexRoot } from './apex-paths.mjs';
/** Executes only registered APEX runtime scripts after Router authorization. */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRunState, recordArtifact, agentRuntimeStatus, visualSkillLoads } from './run-ledger.mjs';
import { requiredTasteLoadCurrent, optionalSkillLoadCurrent } from './required-visual-skill.mjs';
import { recordLateCancelledOperation } from './cancelled-operation-finalizer.mjs';
import { runControlledSubprocess } from './controlled-subprocess.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const permitted = {
  // Gate 1 is one controlled chain: the evaluator produces the evidence and
  // the recorder materializes the human-readable eight-section proposal.
  // Keeping the recorder on record_context only made the Router advertise an
  // automatic Gate 1 action that had no executor capable of finishing it.
  analyze_requirement: new Set(['experience-evaluator.mjs', 'contract-recorder.mjs', 'role-advisory.mjs', 'agent-runtime.mjs']),
  plan_visual: new Set(['visual-execution-plan.mjs', 'motion-capability.mjs', 'asset-resolver.mjs', 'role-advisory.mjs', 'agent-runtime.mjs']),
  generate_visual: new Set(['demo-source-compiler.mjs', 'visual-sandbox-writer.mjs', 'visual-sandbox-runtime.mjs', 'browser-capture.mjs', 'runtime-visual-baseline.mjs', 'visual-reference-compiler.mjs', 'visual-sandbox-dependency.mjs', 'experience-evaluator.mjs']),
  collect_existing_baseline: new Set(['project-intake.mjs', 'existing-code-reference.mjs', 'baseline-collector.mjs', 'functional-freeze-compiler.mjs', 'browser-capture.mjs', 'role-advisory.mjs', 'agent-runtime.mjs']),
  sync_stitch: new Set(['stitch-sync.mjs', 'stitch-ui-importer.mjs', 'strict-replica.mjs', 'visual-reference-compiler.mjs', 'confirmation-presentation.mjs']),
  observe_stitch: new Set(['stitch-sync.mjs']),
  validate_stitch: new Set(['strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs']),
  prepare_workspace: new Set(['apex-workspace.mjs']),
  compile_visual_bundle: new Set(['visual-reference-compiler.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'bundle-compiler.mjs', 'asset-resolver.mjs', 'asset-materializer.mjs', 'experience-evaluator.mjs', 'motion-contract.mjs', 'motion-capability.mjs', 'visual-source.mjs', 'role-advisory.mjs', 'contract-recorder.mjs', 'confirmation-presentation.mjs', 'agent-runtime.mjs']),
  implement: new Set(['asset-materializer.mjs', 'runtime-materializer.mjs']),
  verify: new Set(['project-intake.mjs', 'browser-capture.mjs', 'visual-reference-compiler.mjs', 'strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'implementation-audit.mjs', 'asset-materializer.mjs', 'runtime-materializer.mjs', 'verification-planner.mjs', 'verification-orchestrator.mjs', 'contract-verifier.mjs', 'api-contract-capture.mjs', 'quality-measurement.mjs', 'quality-evidence.mjs', 'trajectory-evaluator.mjs', 'stability-evidence.mjs', 'motion-contract.mjs', 'three-d-evidence.mjs', 'industry-benchmark.mjs', 'role-advisory.mjs', 'agent-runtime.mjs']),
  record_context: new Set(['contract-recorder.mjs', 'context-compiler.mjs', 'evidence-provenance.mjs']),
  recover: new Set(['apex-recover.mjs', 'run-migrate.mjs', 'role-advisory.mjs'])
};
function fail(message) { console.error(`APEX action failed: ${message}`); process.exit(1); }
if (!isCanonicalApexRoot(apexRoot)) fail(`APEX must run from canonical root: ${canonicalApexRoot}`);
const [command, projectRoot, runId, sessionId, authorizationRef, action, script, ...scriptArgs] = process.argv.slice(2);
if (command !== 'run' || !projectRoot || !runId || !sessionId || !authorizationRef || !action || !script) fail('usage: run <project-root> <run-id> <session-id> <authorization-ref> <action> <apex-script> [args...]');
if (!permitted[action]?.has(script)) fail(`script ${script || '<none>'} is not registered for action ${action}`);
const target = path.join(apexRoot, 'scripts', script);
const runDirectory = path.resolve(projectRoot, '.apex', 'runs', runId);
if (action !== 'recover' && fs.existsSync(path.join(runDirectory, 'state.json')) && readRunState(runDirectory).lifecycle === 'cancelled') fail('cancelled run cannot execute or replay this action');
const operationDirectory = path.join(runDirectory, 'operations');
const operationIndexFile = path.join(runDirectory, 'operations-index.json');
const DEFAULT_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
function boundedTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 30 * 60 * 1000 ? parsed : fallback;
}
// A runaway child used to leave an operation receipt permanently `running`.
// Keep the limit local to the controlled runner, bounded, and recorded in the
// receipt so recovery can distinguish a timeout from a script failure.
const executionTimeoutMs = boundedTimeout(process.env.APEX_ACTION_TIMEOUT_MS, DEFAULT_EXECUTION_TIMEOUT_MS);
function containsTemplatePlaceholder(value) {
  if (typeof value === 'string') return /(?:^|:)TO_REPLACE(?:$|[^A-Za-z0-9_-])/.test(value);
  if (Array.isArray(value)) return value.some(containsTemplatePlaceholder);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsTemplatePlaceholder));
}
function validatePlanVisualInput() {
  if (action !== 'plan_visual' || script !== 'visual-execution-plan.mjs' || scriptArgs[0] !== 'compile' || !scriptArgs[2]) return;
  const input = path.resolve(scriptArgs[2]);
  if (!input.startsWith(`${runDirectory}${path.sep}`) || !fs.existsSync(input)) fail('plan_visual input must be a current run-local JSON file');
  let value;
  try { value = JSON.parse(fs.readFileSync(input, 'utf8')); }
  catch (error) { fail(`plan_visual input is invalid JSON: ${path.relative(runDirectory, input)}: ${error.message}. Regenerate the input internally and retry; do not expose this as a user confirmation or manual repair task.`); }
  if (containsTemplatePlaceholder(value)) fail(`plan_visual input contains unresolved template placeholders: ${path.relative(runDirectory, input)}. Bind current change-scope and DESIGN hashes, then regenerate internally before retrying.`);
}
validatePlanVisualInput();
function fileHash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function fileFingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
const productionIgnored = new Set(['.git', '.apex', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
const formalSourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte', '.html', '.htm', '.ejs', '.hbs', '.pug', '.php', '.py', '.java', '.go', '.rb', '.cs', '.css', '.scss', '.sass', '.less']);
const formalRootFiles = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'tsconfig.json', 'jsconfig.json', 'vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.ts']);
function safeProjectFile(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const root = path.resolve(projectRoot), absolute = path.resolve(root, relative);
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}
function frozenReferencePaths() {
  const referenceFile = path.join(runDirectory, 'code-reference.json');
  if (!fs.existsSync(referenceFile)) return null;
  try {
    const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
    if (reference.complete !== true || !Array.isArray(reference.files) || !reference.files.length) return null;
    const paths = [...new Set(reference.files.map(item => item?.path).filter(Boolean))].sort();
    if (!paths.every(item => safeProjectFile(item))) return null;
    return paths;
  } catch { return null; }
}
function fallbackFormalPaths() {
  const root = path.resolve(projectRoot), files = [], pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (productionIgnored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name), relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && (formalSourceExtensions.has(path.extname(entry.name).toLowerCase()) || (path.dirname(relative) === '.' && formalRootFiles.has(entry.name)))) files.push(relative);
    }
  }
  return files.sort();
}
function productionSnapshot() {
  const referencePaths = frozenReferencePaths();
  const paths = referencePaths || fallbackFormalPaths();
  const files = Object.fromEntries(paths.map(relative => {
    const absolute = safeProjectFile(relative);
    if (!absolute || !fs.existsSync(absolute)) return [relative, 'missing'];
    const stat = fs.lstatSync(absolute);
    return [relative, stat.isSymbolicLink() ? `symlink:${fs.readlinkSync(absolute)}` : fileHash(absolute)];
  }));
  return { mode: referencePaths ? 'frozen-code-reference' : 'formal-source-discovery', files };
}
function productionChanges(before, after) {
  const paths = [...new Set([...Object.keys(before.files || {}), ...Object.keys(after.files || {})])].sort();
  return paths.filter(relative => before.files?.[relative] !== after.files?.[relative]).map(relative => ({ path: relative, before: before.files?.[relative] || 'absent', after: after.files?.[relative] || 'absent' }));
}
function updateOperationIndex(receiptPath, receipt) {
  const previous = fs.existsSync(operationIndexFile) ? JSON.parse(fs.readFileSync(operationIndexFile, 'utf8')) : { schemaVersion: '3.0', receipts: {} };
  const relative = path.relative(runDirectory, receiptPath);
  previous.receipts[relative] = {
    action: receipt.action,
    script: receipt.script,
    status: receipt.status,
    operationKey: receipt.operationKey || null,
    stateHash: receipt.stateHash || null,
    inputDigest: receipt.inputDigest || null,
    finishedAt: receipt.finishedAt || null,
    outputFileHashes: receipt.outputFileHashes || {},
    outputFileFingerprints: receipt.outputFileFingerprints || {}
  };
  const temporary = `${operationIndexFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(previous, null, 2)}\n`);
  fs.renameSync(temporary, operationIndexFile);
}
function inputFileHashes() { const hashes = {}; for (const argument of scriptArgs) { const candidate = path.resolve(argument); if (candidate.startsWith(`${runDirectory}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) hashes[path.relative(runDirectory, candidate)] = fileHash(candidate); } return hashes; }
function runInputHashes() {
  // Many guarded scripts intentionally read current run evidence by convention
  // (for example evidence/runtime-browser-capture.json) rather than receiving
  // every dependency on argv.  Include the run-local input closure so a real
  // remediation can retry, while excluding receipts/cache so bookkeeping alone
  // cannot manufacture a different operation.
  const ignored = new Set(['operations', 'cache', 'authorizations']);
  // Ledger files are control-plane durability data, not business/action
  // inputs. Including WAL churn here makes an identical failed operation look
  // different merely because authorization or recovery appended an event.
  const ignoredFiles = new Set(['events.ndjson', 'operations-index.json', 'run-ledger.sqlite', 'run-ledger.sqlite-shm', 'run-ledger.sqlite-wal', 'ledger-established.json']);
  const hashes = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !ignoredFiles.has(entry.name)) hashes[path.relative(runDirectory, absolute)] = fileHash(absolute);
    }
  };
  visit(runDirectory);
  return hashes;
}
function roleEvidenceInputs() {
  if (script !== 'role-advisory.mjs' || scriptArgs[0] !== 'record' || !['baseline', 'gate1', 'visual', 'implementation', 'verify'].includes(scriptArgs[2])) return undefined;
  try {
    const stage = scriptArgs[2], input = path.resolve(scriptArgs[3] || ''), root = fs.realpathSync(runDirectory);
    if (!fs.realpathSync(input).startsWith(`${root}${path.sep}`)) return undefined;
    const advisory = JSON.parse(fs.readFileSync(input, 'utf8'));
    const selection = JSON.parse(fs.readFileSync(path.join(root, 'advisories', stage, 'selection.json'), 'utf8'));
    const jobId = selection.agentJobs?.[advisory.roleId], job = jobId && agentRuntimeStatus(root, jobId).jobs[0];
    if (!job) return { status: 'job-unavailable' };
    const required = job.payload?.tasteSkill ? requiredTasteLoadCurrent(root, jobId, job.attempt, advisory.execution?.leaseToken, job.payload.tasteSkill) : null;
    const events = visualSkillLoads(root, jobId, job.attempt);
    const loads = readRunState(root).roleChain?.confirmationModel === 'two-confirmations' ? events.filter(event => optionalSkillLoadCurrent(root, event, advisory.execution?.leaseToken)) : events;
    const optional = [...new Set(loads.map(event => `${event.name}:${event.sha256}`))].sort();
    return { jobId, attempt: job.attempt, status: job.status, required, optional };
  } catch { return { status: 'evidence-unavailable' }; }
}
function agentClaimBudgetInputs() {
  if (script !== 'agent-runtime.mjs' || scriptArgs[0] !== 'claim') return undefined;
  try {
    const runtime = agentRuntimeStatus(runDirectory), jobId = scriptArgs[2], stage = scriptArgs[3];
    const job = runtime.jobs.find(item => item.jobId === jobId);
    return { job: job ? { jobId, stage: job.stage, status: job.status, attempt: job.attempt, tokenBudget: job.payload?.tokenBudget, stageTokenBudget: job.payload?.stageTokenBudget, budgetRecovery: job.payload?.budgetRecovery } : null, stageUsage: runtime.tokenUsage?.[stage] ?? 0, stageCoverage: runtime.tokenUsageCoverage?.[stage] || null, runBudget: runtime.runBudget, runningReservations: runtime.jobs.filter(item => item.status === 'running').map(item => ({ jobId: item.jobId, stage: item.stage, reservedTokens: item.reservedTokens })).sort((a, b) => a.jobId.localeCompare(b.jobId)) };
  } catch { return { status: 'budget-state-unavailable' }; }
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }
function failedOperationWithSameKey(operationKey) {
  if (!fs.existsSync(operationDirectory)) return null;
  for (const name of fs.readdirSync(operationDirectory).filter(item => item.endsWith('.json'))) {
    const record = JSON.parse(fs.readFileSync(path.join(operationDirectory, name), 'utf8'));
    if (['failed', 'interrupted'].includes(record.status) && record.operationKey === operationKey) return path.join('operations', name);
  }
  return null;
}
function outputFileHashes(stdout) {
  const runRoot = fs.realpathSync(runDirectory), paths = new Set();
  const collect = value => {
    if (typeof value === 'string') {
      const candidate = path.resolve(value);
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return;
      const actual = fs.realpathSync(candidate);
      // A valid run path may have a different spelling (e.g. /var versus
      // /private/var on macOS); resolve both sides while rejecting symlink
      // escapes out of the current run.
      if (actual.startsWith(`${runRoot}${path.sep}`)) paths.add(actual);
      return;
    }
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  for (const line of String(stdout || '').split(/\r?\n/).reverse()) { try { collect(JSON.parse(line)); } catch {} }
  return Object.fromEntries([...paths].sort().map(file => [path.relative(runRoot, file), fileHash(file)]));
}
const currentInputHashes = inputFileHashes();
const currentRunInputHashes = runInputHashes();
const productionBefore = action === 'generate_visual' ? productionSnapshot() : null;
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ action, script, scriptArgs })).digest('hex');
const receiptFile = path.join(operationDirectory, `${path.basename(authorizationRef, '.json')}.json`);
fs.mkdirSync(operationDirectory, { recursive: true });
if (fs.existsSync(receiptFile)) {
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.fingerprint !== fingerprint) fail('authorization receipt was already used for a different operation');
  if (receipt.status === 'succeeded') { if (script === 'agent-runtime.mjs' && scriptArgs[0] === 'claim') fail('agent claim replay requires a fresh Router authorization and the same claim key so the current lease is revalidated'); if (script === 'agent-runtime.mjs' && scriptArgs[0] === 'status') fail('agent status replay requires a fresh Router authorization to observe current jobs'); if (script === 'agent-runtime.mjs' && scriptArgs[0] === 'run-budget') fail('run budget replay requires a fresh Router authorization to observe the current configuration'); if (JSON.stringify(receipt.inputFileHashes || {}) !== JSON.stringify(currentInputHashes)) fail('authorized operation input files changed; obtain a new Router authorization before retrying'); process.stdout.write(receipt.stdout || ''); process.stderr.write(receipt.stderr || ''); process.exit(0); }
  fail(`operation receipt is ${receipt.status}; obtain a new Router authorization before retrying`);
}
const verification = spawnSync(process.execPath, [router, 'verify-authorization', projectRoot, runId, sessionId, authorizationRef, action], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGTERM' });
if (verification.status !== 0) fail((verification.stderr || verification.stdout).trim());
let verificationResult;
try { verificationResult = JSON.parse(verification.stdout); }
catch { fail('Router authorization verification returned invalid JSON'); }
const stateHash = verificationResult?.authorizationToken?.stateHash;
if (!stateHash) fail('Router authorization verification did not return its bound state hash');
const claimBudgetInputs = agentClaimBudgetInputs();
const inputDigest = digest({ argumentFiles: currentInputHashes, runInputs: currentRunInputHashes, roleEvidence: roleEvidenceInputs(), ...(claimBudgetInputs === undefined ? {} : { agentClaimBudget: claimBudgetInputs }) });
// An authorization is deliberately single-use, but a fresh authorization is
// not evidence that the failed action now has different inputs.  Without this
// operation key, hosts can create an infinite retry loop by asking Router for
// another token after the same deterministic failure.
const operationKey = digest({ runId, action, script, fingerprint, stateHash, inputDigest });
const priorFailure = failedOperationWithSameKey(operationKey);
if (priorFailure) fail(`an identical controlled operation already failed or was interrupted (${priorFailure}); inspect its outcome and change the observed cause, state, or input before requesting another retry`);
const startedAt = new Date().toISOString();
fs.writeFileSync(receiptFile, `${JSON.stringify({ schemaVersion: '3.1', authorizationRef, action, script, fingerprint, operationKey, stateHash, inputDigest, inputFileHashes: currentInputHashes, runInputHashes: currentRunInputHashes, status: 'running', startedAt, owner: { pid: process.pid, host: os.hostname() } }, null, 2)}\n`, { flag: 'wx' });
const execution = await runControlledSubprocess(process.execPath, [target, ...scriptArgs], {
  timeoutMs: executionTimeoutMs, runDir: runDirectory,
  onSpawn: localProcess => {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    if (receipt.status !== 'running' || receipt.authorizationRef !== authorizationRef) throw new Error('running operation receipt changed');
    const temporary = `${receiptFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ ...receipt, localProcess }, null, 2)}\n`);
    fs.renameSync(temporary, receiptFile);
  },
  env: { ...process.env, APEX_ROUTER_PROJECT_ROOT: projectRoot, APEX_ROUTER_RUN_ID: runId, APEX_ROUTER_SESSION_ID: sessionId, APEX_ROUTER_AUTHORIZATION_REF: authorizationRef, APEX_ROUTER_ACTION: action, APEX_ROUTER_OPERATION_RECEIPT: path.relative(runDirectory, receiptFile) }
});
const finishedAt = new Date().toISOString();
if (execution.error?.code === 'APEX_MONITOR_UNAVAILABLE') {
  // Do not call readRunState here: its legacy migration can create a new
  // ledger from the projection when the original ledger is unavailable.
  // The local receipt remains recoverable, but neither cancellation nor any
  // external side effect can be inferred from the missing ledger.
  const receipt = { schemaVersion: '3.2', authorizationRef, action, script, fingerprint, operationKey, stateHash, inputDigest, inputFileHashes: currentInputHashes, runInputHashes: currentRunInputHashes, outputFileHashes: {}, outputFileFingerprints: {}, status: 'failed', startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), timeoutMs: executionTimeoutMs, timedOut: false, exitCode: 1, stdout: execution.stdout || '', stderr: `APEX_MONITOR_UNAVAILABLE: ${execution.error.message}\nRun ledger integrity and external side effects remain unverified; inspect the original ledger before retrying.\n`, ledgerIntegrity: 'unverified', externalSideEffects: 'unverified' };
  const temporary = `${receiptFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.renameSync(temporary, receiptFile);
  const incidentFile = path.join(runDirectory, 'ledger-integrity-incident.json');
  const incidentTemp = `${incidentFile}.${process.pid}.tmp`;
  fs.writeFileSync(incidentTemp, `${JSON.stringify({ schemaVersion: '1.0', kind: 'cancellation-monitor-unavailable', status: 'requires-ledger-investigation', authorizationRef, stateHash, observedAt: finishedAt, externalSideEffects: 'unverified' }, null, 2)}\n`);
  fs.renameSync(incidentTemp, incidentFile);
  try { updateOperationIndex(receiptFile, receipt); } catch (error) { process.stderr.write(`operation index unavailable: ${error.message}\n`); }
  process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr);
  process.exit(1);
}
if (recordLateCancelledOperation(runDirectory, { authorizationRef, action, script, startedAt, finishedAt, exitCode: execution.status, signal: execution.signal, interruptionRequested: execution.cancelled, timedOut: execution.error?.code === 'ETIMEDOUT' })) {
  fail('the operation finished after cancellation; its result is not accepted and external side effects require verification');
}
// Most legacy scripts still project their final state directly to state.json.
// They are never allowed to run outside this gateway, so immediately import
// that projection into the durable ledger before declaring the operation
// successful. This closes the migration window without turning every legacy
// script into a different execution path in one risky release.
let stateReconciliationError = null;
try { readRunState(runDirectory); } catch (error) { stateReconciliationError = `run-state reconciliation failed: ${error.message}`; }
const productionAfter = action === 'generate_visual' ? productionSnapshot() : null;
const productionChangedFiles = productionBefore && productionAfter ? productionChanges(productionBefore, productionAfter) : [];
const productionBoundaryError = productionChangedFiles.length ? `generate_visual modified formal project files outside .apex: ${productionChangedFiles.map(item => item.path).join(', ')}; Demo generation is restricted to the current run visual-sandbox` : null;
const timedOut = execution.error?.code === 'ETIMEDOUT';
const executionError = execution.error ? `${execution.error.code || 'spawn-error'}: ${execution.error.message}${execution.error.code === 'APEX_SUBPROCESS_IDENTITY_UNAVAILABLE' ? '; external side effects remain unverified' : ''}` : '';
const succeeded = execution.status === 0 && !execution.error && !productionBoundaryError && !stateReconciliationError;
// Failed operations may still emit useful evidence; hashes identify it without marking it as a successful artifact.
const outputHashes = outputFileHashes(execution.stdout);
const outputFingerprints = Object.fromEntries(Object.keys(outputHashes).map(relative => [relative, fileFingerprint(path.join(runDirectory, relative))]));
if (succeeded) {
  try {
    const parentArtifactIds = Object.entries(currentInputHashes).map(([reference, sha256]) => `input:${sha256}:${reference}`);
    for (const [reference, sha256] of Object.entries(currentInputHashes)) recordArtifact(runDirectory, { artifactId: `input:${sha256}:${reference}`, reference, sha256, status: 'input', metadata: { action, authorizationRef, operationKey } });
    for (const [reference, sha256] of Object.entries(outputHashes)) {
      recordArtifact(runDirectory, { artifactId: `${authorizationRef}:${reference}`, reference, sha256, metadata: { action, script, authorizationRef, operationKey }, parentArtifactIds });
    }
  } catch (error) {
    if (recordLateCancelledOperation(runDirectory, { authorizationRef, action, script, startedAt, finishedAt, exitCode: execution.status, stage: 'artifact-registration' })) fail('the operation was cancelled before its result could be registered; external side effects require verification');
    throw error;
  }
}
if (recordLateCancelledOperation(runDirectory, { authorizationRef, action, script, startedAt, finishedAt, exitCode: execution.status, stage: 'receipt-write' })) fail('the operation was cancelled before its receipt could be committed; external side effects require verification');
const receipt = { schemaVersion: '3.2', authorizationRef, action, script, fingerprint, operationKey, stateHash, inputDigest, inputFileHashes: currentInputHashes, runInputHashes: currentRunInputHashes, outputFileHashes: outputHashes, outputFileFingerprints: outputFingerprints, productionBoundary: action === 'generate_visual' ? { allowedRoot: path.join(runDirectory, 'visual-sandbox'), snapshotMode: productionBefore?.mode || null, protectedFiles: Object.keys(productionBefore?.files || {}), changedFiles: productionChangedFiles, formalProjectUnchanged: !productionBoundaryError } : null, status: succeeded ? 'succeeded' : 'failed', startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), timeoutMs: executionTimeoutMs, timedOut, exitCode: succeeded ? 0 : (execution.status || 1), stdout: execution.stdout || '', stderr: `${execution.stderr || ''}${executionError ? `${executionError}\n` : ''}${stateReconciliationError ? `${stateReconciliationError}\n` : ''}${timedOut ? `operation exceeded controlled timeout (${executionTimeoutMs}ms)\n` : ''}${productionBoundaryError ? `${productionBoundaryError}\n` : ''}` };
fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
updateOperationIndex(receiptFile, receipt);
process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr);
if (!succeeded) process.exit(receipt.exitCode || 1);
