#!/usr/bin/env node
import { canonicalApexRoot, isCanonicalApexRoot } from './apex-paths.mjs';
/** Executes only registered APEX runtime scripts after Router authorization. */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const permitted = {
  // Gate 1 is one controlled chain: the evaluator produces the evidence and
  // the recorder materializes the human-readable eight-section proposal.
  // Keeping the recorder on record_context only made the Router advertise an
  // automatic Gate 1 action that had no executor capable of finishing it.
  analyze_requirement: new Set(['experience-evaluator.mjs', 'contract-recorder.mjs', 'role-advisory.mjs']),
  plan_visual: new Set(['visual-execution-plan.mjs', 'motion-capability.mjs', 'asset-resolver.mjs', 'role-advisory.mjs']),
  generate_visual: new Set(['demo-source-compiler.mjs', 'visual-sandbox-writer.mjs', 'visual-sandbox-runtime.mjs', 'browser-capture.mjs', 'runtime-visual-baseline.mjs', 'visual-reference-compiler.mjs', 'visual-sandbox-dependency.mjs', 'experience-evaluator.mjs']),
  collect_existing_baseline: new Set(['project-intake.mjs', 'existing-code-reference.mjs', 'baseline-collector.mjs', 'browser-capture.mjs', 'role-advisory.mjs']),
  sync_stitch: new Set(['stitch-sync.mjs', 'stitch-ui-importer.mjs', 'strict-replica.mjs', 'confirmation-presentation.mjs']),
  observe_stitch: new Set(['stitch-sync.mjs']),
  validate_stitch: new Set(['strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs']),
  prepare_workspace: new Set(['apex-workspace.mjs']),
  compile_visual_bundle: new Set(['visual-reference-compiler.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'bundle-compiler.mjs', 'asset-resolver.mjs', 'asset-materializer.mjs', 'experience-evaluator.mjs', 'motion-contract.mjs', 'motion-capability.mjs', 'visual-source.mjs', 'role-advisory.mjs', 'contract-recorder.mjs', 'confirmation-presentation.mjs']),
  implement: new Set(['asset-materializer.mjs', 'runtime-materializer.mjs']),
  verify: new Set(['browser-capture.mjs', 'strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'implementation-audit.mjs', 'asset-materializer.mjs', 'runtime-materializer.mjs', 'verification-planner.mjs', 'verification-orchestrator.mjs', 'contract-verifier.mjs', 'quality-evidence.mjs', 'trajectory-evaluator.mjs', 'stability-evidence.mjs', 'motion-contract.mjs', 'three-d-evidence.mjs', 'industry-benchmark.mjs', 'role-advisory.mjs']),
  record_context: new Set(['contract-recorder.mjs', 'context-compiler.mjs', 'evidence-provenance.mjs']),
  recover: new Set(['apex-recover.mjs', 'run-migrate.mjs'])
};
function fail(message) { console.error(`APEX action failed: ${message}`); process.exit(1); }
if (!isCanonicalApexRoot(apexRoot)) fail(`APEX must run from canonical root: ${canonicalApexRoot}`);
const [command, projectRoot, runId, sessionId, authorizationRef, action, script, ...scriptArgs] = process.argv.slice(2);
if (command !== 'run' || !projectRoot || !runId || !sessionId || !authorizationRef || !action || !script) fail('usage: run <project-root> <run-id> <session-id> <authorization-ref> <action> <apex-script> [args...]');
if (!permitted[action]?.has(script)) fail(`script ${script || '<none>'} is not registered for action ${action}`);
const target = path.join(apexRoot, 'scripts', script);
const runDirectory = path.resolve(projectRoot, '.apex', 'runs', runId);
const operationDirectory = path.join(runDirectory, 'operations');
const operationIndexFile = path.join(runDirectory, 'operations-index.json');
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
  const ignoredFiles = new Set(['events.ndjson', 'operations-index.json']);
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
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }
function failedOperationWithSameKey(operationKey) {
  if (!fs.existsSync(operationIndexFile)) return null;
  const index = JSON.parse(fs.readFileSync(operationIndexFile, 'utf8'));
  for (const [relative, record] of Object.entries(index.receipts || {})) {
    if (record.status === 'failed' && record.operationKey === operationKey) return relative;
  }
  return null;
}
function outputFileHashes(stdout) { const paths = new Set(); const collect = value => { if (typeof value === 'string') { const candidate = path.resolve(value); if (candidate.startsWith(`${runDirectory}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) paths.add(candidate); return; } if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') Object.values(value).forEach(collect); }; for (const line of String(stdout || '').split(/\r?\n/).reverse()) { try { collect(JSON.parse(line)); } catch {} } return Object.fromEntries([...paths].sort().map(file => [path.relative(runDirectory, file), fileHash(file)])); }
const currentInputHashes = inputFileHashes();
const currentRunInputHashes = runInputHashes();
const productionBefore = action === 'generate_visual' ? productionSnapshot() : null;
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ action, script, scriptArgs })).digest('hex');
const receiptFile = path.join(operationDirectory, `${path.basename(authorizationRef, '.json')}.json`);
fs.mkdirSync(operationDirectory, { recursive: true });
if (fs.existsSync(receiptFile)) {
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.fingerprint !== fingerprint) fail('authorization receipt was already used for a different operation');
  if (receipt.status === 'succeeded') { if (JSON.stringify(receipt.inputFileHashes || {}) !== JSON.stringify(currentInputHashes)) fail('authorized operation input files changed; obtain a new Router authorization before retrying'); process.stdout.write(receipt.stdout || ''); process.stderr.write(receipt.stderr || ''); process.exit(0); }
  fail(`operation receipt is ${receipt.status}; obtain a new Router authorization before retrying`);
}
const verification = spawnSync(process.execPath, [router, 'verify-authorization', projectRoot, runId, sessionId, authorizationRef, action], { encoding: 'utf8' });
if (verification.status !== 0) fail((verification.stderr || verification.stdout).trim());
let verificationResult;
try { verificationResult = JSON.parse(verification.stdout); }
catch { fail('Router authorization verification returned invalid JSON'); }
const stateHash = verificationResult?.authorizationToken?.stateHash;
if (!stateHash) fail('Router authorization verification did not return its bound state hash');
const inputDigest = digest({ argumentFiles: currentInputHashes, runInputs: currentRunInputHashes });
// An authorization is deliberately single-use, but a fresh authorization is
// not evidence that the failed action now has different inputs.  Without this
// operation key, hosts can create an infinite retry loop by asking Router for
// another token after the same deterministic failure.
const operationKey = digest({ runId, action, script, fingerprint, stateHash, inputDigest });
const priorFailure = failedOperationWithSameKey(operationKey);
if (priorFailure) fail(`an identical controlled operation already failed (${priorFailure}); change the observed cause, state, or input before requesting another retry`);
const startedAt = new Date().toISOString();
fs.writeFileSync(receiptFile, `${JSON.stringify({ schemaVersion: '3.1', authorizationRef, action, script, fingerprint, operationKey, stateHash, inputDigest, inputFileHashes: currentInputHashes, runInputHashes: currentRunInputHashes, status: 'running', startedAt }, null, 2)}\n`, { flag: 'wx' });
const execution = spawnSync(process.execPath, [target, ...scriptArgs], { encoding: 'utf8', env: { ...process.env, APEX_ROUTER_PROJECT_ROOT: projectRoot, APEX_ROUTER_RUN_ID: runId, APEX_ROUTER_SESSION_ID: sessionId, APEX_ROUTER_AUTHORIZATION_REF: authorizationRef, APEX_ROUTER_ACTION: action } });
const finishedAt = new Date().toISOString();
const productionAfter = action === 'generate_visual' ? productionSnapshot() : null;
const productionChangedFiles = productionBefore && productionAfter ? productionChanges(productionBefore, productionAfter) : [];
const productionBoundaryError = productionChangedFiles.length ? `generate_visual modified formal project files outside .apex: ${productionChangedFiles.map(item => item.path).join(', ')}; Demo generation is restricted to the current run visual-sandbox` : null;
const succeeded = execution.status === 0 && !productionBoundaryError;
const outputHashes = succeeded ? outputFileHashes(execution.stdout) : {};
const outputFingerprints = Object.fromEntries(Object.keys(outputHashes).map(relative => [relative, fileFingerprint(path.join(runDirectory, relative))]));
const receipt = { schemaVersion: '3.1', authorizationRef, action, script, fingerprint, operationKey, stateHash, inputDigest, inputFileHashes: currentInputHashes, runInputHashes: currentRunInputHashes, outputFileHashes: outputHashes, outputFileFingerprints: outputFingerprints, productionBoundary: action === 'generate_visual' ? { allowedRoot: path.join(runDirectory, 'visual-sandbox'), snapshotMode: productionBefore?.mode || null, protectedFiles: Object.keys(productionBefore?.files || {}), changedFiles: productionChangedFiles, formalProjectUnchanged: !productionBoundaryError } : null, status: succeeded ? 'succeeded' : 'failed', startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), exitCode: succeeded ? 0 : (execution.status || 1), stdout: execution.stdout || '', stderr: `${execution.stderr || ''}${productionBoundaryError ? `${productionBoundaryError}\n` : ''}` };
fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
updateOperationIndex(receiptFile, receipt);
process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr);
if (!succeeded) process.exit(receipt.exitCode || 1);
