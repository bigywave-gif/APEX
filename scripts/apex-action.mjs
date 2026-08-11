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
  analyze_requirement: new Set(['experience-evaluator.mjs']),
  plan_visual: new Set(['visual-execution-plan.mjs', 'motion-capability.mjs', 'asset-resolver.mjs']),
  generate_visual: new Set(['visual-sandbox-writer.mjs', 'browser-capture.mjs', 'runtime-visual-baseline.mjs', 'visual-reference-compiler.mjs', 'visual-sandbox-dependency.mjs', 'experience-evaluator.mjs']),
  collect_existing_baseline: new Set(['project-intake.mjs', 'existing-code-reference.mjs', 'baseline-collector.mjs', 'browser-capture.mjs']),
  sync_stitch: new Set(['stitch-sync.mjs', 'stitch-ui-importer.mjs', 'strict-replica.mjs']),
  observe_stitch: new Set(['stitch-sync.mjs']),
  validate_stitch: new Set(['strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs']),
  prepare_workspace: new Set(['apex-workspace.mjs']),
  compile_visual_bundle: new Set(['visual-reference-compiler.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'bundle-compiler.mjs', 'asset-resolver.mjs', 'asset-materializer.mjs', 'experience-evaluator.mjs', 'motion-contract.mjs', 'motion-capability.mjs', 'visual-source.mjs']),
  implement: new Set(['asset-materializer.mjs', 'runtime-materializer.mjs']),
  verify: new Set(['browser-capture.mjs', 'strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'implementation-audit.mjs', 'asset-materializer.mjs', 'runtime-materializer.mjs', 'verification-planner.mjs', 'verification-orchestrator.mjs', 'contract-verifier.mjs', 'quality-evidence.mjs', 'trajectory-evaluator.mjs', 'stability-evidence.mjs', 'motion-contract.mjs', 'three-d-evidence.mjs', 'industry-benchmark.mjs']),
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
function fileHash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function fileFingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
const productionIgnored = new Set(['.git', '.apex', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
function productionSnapshot() {
  const root = path.resolve(projectRoot), files = [], pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (productionIgnored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) { files.push([path.relative(root, absolute), `symlink:${fs.readlinkSync(absolute)}`]); continue; }
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push([path.relative(root, absolute), fileHash(absolute)]);
    }
  }
  return Object.fromEntries(files.sort((a, b) => a[0].localeCompare(b[0])));
}
function updateOperationIndex(receiptPath, receipt) {
  const previous = fs.existsSync(operationIndexFile) ? JSON.parse(fs.readFileSync(operationIndexFile, 'utf8')) : { schemaVersion: '3.0', receipts: {} };
  const relative = path.relative(runDirectory, receiptPath);
  previous.receipts[relative] = { action: receipt.action, script: receipt.script, status: receipt.status, finishedAt: receipt.finishedAt || null, outputFileHashes: receipt.outputFileHashes || {}, outputFileFingerprints: receipt.outputFileFingerprints || {} };
  const temporary = `${operationIndexFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(previous, null, 2)}\n`);
  fs.renameSync(temporary, operationIndexFile);
}
function inputFileHashes() { const hashes = {}; for (const argument of scriptArgs) { const candidate = path.resolve(argument); if (candidate.startsWith(`${runDirectory}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) hashes[path.relative(runDirectory, candidate)] = fileHash(candidate); } return hashes; }
function outputFileHashes(stdout) { const paths = new Set(); const collect = value => { if (typeof value === 'string') { const candidate = path.resolve(value); if (candidate.startsWith(`${runDirectory}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) paths.add(candidate); return; } if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') Object.values(value).forEach(collect); }; for (const line of String(stdout || '').split(/\r?\n/).reverse()) { try { collect(JSON.parse(line)); } catch {} } return Object.fromEntries([...paths].sort().map(file => [path.relative(runDirectory, file), fileHash(file)])); }
const currentInputHashes = inputFileHashes();
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
const startedAt = new Date().toISOString();
fs.writeFileSync(receiptFile, `${JSON.stringify({ schemaVersion: '3.0', authorizationRef, action, script, fingerprint, inputFileHashes: currentInputHashes, status: 'running', startedAt }, null, 2)}\n`, { flag: 'wx' });
const execution = spawnSync(process.execPath, [target, ...scriptArgs], { encoding: 'utf8', env: { ...process.env, APEX_ROUTER_PROJECT_ROOT: projectRoot, APEX_ROUTER_RUN_ID: runId, APEX_ROUTER_SESSION_ID: sessionId, APEX_ROUTER_AUTHORIZATION_REF: authorizationRef, APEX_ROUTER_ACTION: action } });
const finishedAt = new Date().toISOString();
const productionAfter = action === 'generate_visual' ? productionSnapshot() : null;
const productionBoundaryError = productionBefore && JSON.stringify(productionBefore) !== JSON.stringify(productionAfter) ? 'generate_visual modified formal project files outside .apex; Demo generation is restricted to the current run visual-sandbox' : null;
const succeeded = execution.status === 0 && !productionBoundaryError;
const outputHashes = succeeded ? outputFileHashes(execution.stdout) : {};
const outputFingerprints = Object.fromEntries(Object.keys(outputHashes).map(relative => [relative, fileFingerprint(path.join(runDirectory, relative))]));
const receipt = { schemaVersion: '3.0', authorizationRef, action, script, fingerprint, inputFileHashes: currentInputHashes, outputFileHashes: outputHashes, outputFileFingerprints: outputFingerprints, productionBoundary: action === 'generate_visual' ? { allowedRoot: path.join(runDirectory, 'visual-sandbox'), formalProjectUnchanged: !productionBoundaryError } : null, status: succeeded ? 'succeeded' : 'failed', startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), exitCode: succeeded ? 0 : (execution.status || 1), stdout: execution.stdout || '', stderr: `${execution.stderr || ''}${productionBoundaryError ? `${productionBoundaryError}\n` : ''}` };
fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
updateOperationIndex(receiptFile, receipt);
process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr);
if (!succeeded) process.exit(receipt.exitCode || 1);
