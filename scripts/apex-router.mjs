#!/usr/bin/env node
import { canonicalApexRoot, globalBridge } from './apex-paths.mjs';
/**
 * Code-level admission point for Codex sessions. Existing gates and skills are
 * preserved; this router creates project-local runs and returns an action
 * allow-list scoped to one project, run, and session.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertAffectedOnlyPresentation } from './scope-boundary.mjs';
import { assertWorkflowNode } from './workflow-node-registry.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgeSource = path.join(apexRoot, 'runtime', 'host-bridges', 'codex-skill', 'SKILL.md');
const bridgeSync = path.join(apexRoot, 'scripts', 'sync-codex-bridge.mjs');
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');
const DEFAULT_LEASE_MS = 15 * 60 * 1000;
function fail(message) { console.error(`APEX router failed: ${message}`); process.exit(1); }
function json(value) { console.log(JSON.stringify(value, null, 2)); }
function now() { return new Date().toISOString(); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256Text(value) { return `sha256:${sha(value)}`; }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256File(file) { return `sha256:${hashFile(file)}`; }
function fileFingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function sameFingerprint(expected, file) { if (!expected || !file || !fs.existsSync(file)) return false; const actual = fileFingerprint(file); return Object.entries(expected).every(([key, value]) => actual[key] === value); }
function operationRecords(dir) {
  const operations = path.join(dir, 'operations'); const indexFile = path.join(dir, 'operations-index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const indexed = Object.entries(read(indexFile).receipts || {}).map(([relative, receipt]) => ({ path: path.join(dir, relative), receipt }));
      // The index is a performance cache, never the sole source of truth for
      // a security decision. A crash between receipt write and index update
      // must fall back to the append-only operation receipts, not fabricate a
      // missing-output blocker.
      const known = new Map(indexed.map((item, index) => [item.path, index]));
      const operations = path.join(dir, 'operations');
      if (fs.existsSync(operations)) for (const name of fs.readdirSync(operations)) {
        const file = path.join(operations, name);
        if (!name.endsWith('.json')) continue;
        // The receipt file is the durable operation record. The index omits
        // diagnostic fields in some host versions, so it may accelerate a
        // lookup but must never replace stderr, exit code, or failure type.
        const durable = { path: file, receipt: read(file) };
        if (known.has(file)) indexed[known.get(file)] = durable;
        else { known.set(file, indexed.length); indexed.push(durable); }
      }
      return indexed;
    } catch {}
  }
  if (!fs.existsSync(operations)) return [];
  return fs.readdirSync(operations).filter(name => name.endsWith('.json')).map(name => ({ path: path.join(operations, name), receipt: read(path.join(operations, name)) }));
}
function outputReceiptFor(dir, artifact, strict = true) { return receiptFor(dir, artifact, 'verify', strict); }
function actionOutputReceiptFor(dir, artifact, action, strict = false) { return receiptFor(dir, artifact, action, strict); }
function receiptFor(dir, artifact, action, strict) {
  const relative = path.relative(dir, artifact); const expected = strict ? sha256File(artifact) : null;
  const matches = operationRecords(dir).filter(item => {
    if (item.receipt.status !== 'succeeded' || item.receipt.action !== action) return false;
    if (strict) return item.receipt.outputFileHashes?.[relative] === expected;
    // Old runs have receipts but no index fingerprints. Preserve compatibility
    // by doing the slower authoritative comparison only for those old records.
    return item.receipt.outputFileFingerprints?.[relative] ? sameFingerprint(item.receipt.outputFileFingerprints[relative], artifact) : item.receipt.outputFileHashes?.[relative] === sha256File(artifact);
  });
  return matches.length ? matches.sort((a, b) => String(b.receipt.finishedAt || '').localeCompare(String(a.receipt.finishedAt || '')))[0] : null;
}
function failureCategory(receipt) {
  const evidence = `${receipt.stderr || ''}\n${receipt.stdout || ''}`;
  if (/project code changed after complete reference capture|scoped source changed after code reference capture/i.test(evidence)) return 'source-drift';
  if (/generate_visual modified formal project files outside \.apex/i.test(evidence)) {
    // Receipts written before the formal-source boundary fix contained only a
    // boolean and compared the entire project directory.  They can be proved
    // obsolete because they cannot identify a changed protected file.  A new
    // receipt always carries the exact protected snapshot and changedFiles;
    // only that new evidence may block a Demo retry.
    if (!Array.isArray(receipt.productionBoundary?.changedFiles)) return 'obsolete-boundary-snapshot';
    return 'production-boundary';
  }
  if (/PROJECT_DELETION_POLICY|deletion policy|delete(?:d|\s+operation)?\s+(?:is\s+)?forbidden/i.test(evidence)) return 'policy-denied';
  if (/EACCES|EPERM|permission denied|not permitted/i.test(evidence)) return 'permission-denied';
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|browser.*unavailable/i.test(evidence)) return 'external-unavailable';
  if (/JSON|schema|parse|validation/i.test(evidence)) return 'invalid-internal-input';
  return 'execution-failed';
}
function latestBlockingOperation(runDir, action) {
  if (!runDir || !action) return null;
  const receipts = operationRecords(runDir)
    .filter(item => item.receipt?.action === action && ['succeeded', 'failed'].includes(item.receipt?.status))
    .sort((left, right) => String(right.receipt.finishedAt || right.receipt.startedAt || '').localeCompare(String(left.receipt.finishedAt || left.receipt.startedAt || '')));
  const latest = receipts[0];
  if (!latest || latest.receipt.status !== 'failed') return null;
  const receipt = latest.receipt;
  const observedError = `${receipt.stderr || receipt.stdout || 'controlled operation failed without stderr'}`.trim().slice(0, 1200);
  return {
    kind: 'operation-failed',
    category: failureCategory(receipt),
    action,
    script: receipt.script || null,
    operationReceipt: path.relative(runDir, latest.path),
    exitCode: receipt.exitCode ?? null,
    observedError,
    retryPolicy: 'do-not-repeat-automatically; require an explicit remediation or a newly authorized retry after the observed cause changes'
  };
}
function assertCore() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) fail(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function apexVersion() { const manifest = fs.readFileSync(path.join(apexRoot, 'manifest.yaml'), 'utf8'); return manifest.match(/^version:\s*([^\s]+)/m)?.[1] || 'unknown'; }
function assertBridgeSynchronized() {
  const synchronization = spawnSync(process.execPath, [bridgeSync], { encoding: 'utf8' });
  if (synchronization.status !== 0) fail(`unable to synchronize the global APEX Skill: ${(synchronization.stderr || synchronization.stdout).trim()}`);
  if (!fs.existsSync(bridgeSource) || !fs.existsSync(globalBridge)) fail('APEX Codex bridge is missing');
  if (hashFile(bridgeSource) !== hashFile(globalBridge)) fail('APEX Codex bridge remains stale after automatic synchronization');
}
function projectRoot(input) {
  const target = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(target).isDirectory()) fail(`project root is not a directory: ${target}`);
  const core = fs.realpathSync(canonicalApexRoot);
  if (target === core || target.startsWith(`${core}${path.sep}`)) fail('project runtime artifacts must not be stored inside the APEX Core root');
  return target;
}
function projectId(root) { return `project_${sha(root).slice(0, 24)}`; }
const trackIgnoredDirectories = new Set(['.git', '.apex', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
function classifyTrack(root) {
  const gitFiles = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  let files = []; let sourceBasis = 'filesystem-with-transient-directories-excluded';
  if (gitFiles.status === 0 && gitFiles.stdout) {
    files = gitFiles.stdout.split('\0').filter(Boolean).filter(file => !/(^|\/)\.apex(\/|$)/.test(file) && fs.existsSync(path.join(root, file)));
    sourceBasis = 'git-tracked-formal-project-files';
  } else {
    const pending = [root];
    while (pending.length && files.length < 2500) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (trackIgnoredDirectories.has(entry.name) || /^(visual-sandbox|runtime-demo|apex-demo|\.tmp|tmp)$/i.test(entry.name)) continue;
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
        if (files.length >= 2500) break;
      }
    }
  }
  // A component file alone is not an Existing visual baseline. We require a
  // formal page, view, route-level UI, or application UI entrypoint.
  const visualEntrypoint = files.find(file => /(^|\/)(app|pages|views)\/.*\.(tsx|jsx|vue|svelte|html|htm)$|(^|\/)(App|main|index)\.(tsx|jsx|vue|svelte|html|htm)$/.test(file));
  const serverEvidence = files.some(file => /(^|\/)(api|server|controllers?|models?|routes?|services?|db|prisma)\//i.test(file) || /(^|\/)(server|app|main|index)\.(py|go|java|rb|cs|ts|js)$/.test(file));
  return visualEntrypoint
    ? { track: 'existing', reason: 'detected a formal existing page or visual UI entrypoint', sourceBasis, visualEntrypoint, preserveBackend: serverEvidence }
    : { track: 'greenfield', reason: serverEvidence ? 'detected formal API/data/service code but no formal existing visual UI entrypoint' : 'no formal existing visual UI entrypoint was detected', sourceBasis, visualEntrypoint: null, preserveBackend: serverEvidence };
}
function sessionFile(root, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') fail('sessionId is required');
  return path.join(root, '.apex', 'sessions', `${sha(sessionId)}.json`);
}
function sessionBinding(root, sessionId) {
  const file = sessionFile(root, sessionId);
  return fs.existsSync(file) ? read(file) : null;
}
function currentBridgeSnapshot() {
  return { apexVersion: apexVersion(), bridgeHash: hashFile(bridgeSource), canonicalBridge: bridgeSource, publishedBridge: globalBridge };
}
function sessionContextStatus(root, sessionId) {
  const current = currentBridgeSnapshot();
  if (!sessionId) return { status: 'not-bound', autoRefreshApplied: false, current };
  const binding = sessionBinding(root, sessionId);
  if (!binding || binding.projectId !== projectId(root)) return { status: 'not-bound', autoRefreshApplied: false, current };
  const refreshPending = binding.apexVersion !== current.apexVersion || binding.bridgeHash !== current.bridgeHash;
  return {
    status: refreshPending ? 'refresh-pending' : 'current',
    autoRefreshApplied: false,
    bound: { apexVersion: binding.apexVersion, bridgeHash: binding.bridgeHash, boundAt: binding.boundAt },
    current
  };
}
function refreshSessionContext(root, sessionId) {
  const binding = sessionBinding(root, sessionId);
  if (!binding || binding.projectId !== projectId(root)) fail('this session has no APEX run for the project; use intake instead');
  const current = currentBridgeSnapshot();
  const changed = binding.apexVersion !== current.apexVersion || binding.bridgeHash !== current.bridgeHash;
  const refreshedAt = now();
  const next = {
    ...binding,
    ...current,
    refreshedAt,
    lastCheckedAt: refreshedAt,
    ...(changed ? { previousBridge: { apexVersion: binding.apexVersion, bridgeHash: binding.bridgeHash, refreshedAt } } : {})
  };
  delete next.contextRefreshRequiredAt;
  delete next.lastDetectedBridge;
  write(sessionFile(root, sessionId), next);
  if (changed) appendEvent(runDir(root, binding.runId), { type: 'session-context-auto-refreshed', sessionId, from: binding.apexVersion, to: current.apexVersion, bridgeHash: current.bridgeHash });
  return { status: changed ? 'auto-refreshed' : 'current', autoRefreshApplied: changed, bound: { apexVersion: next.apexVersion, bridgeHash: next.bridgeHash, boundAt: next.boundAt, refreshedAt }, current };
}
function bindSession(root, sessionId, runId) {
  const existing = sessionBinding(root, sessionId);
  if (existing && existing.projectId === projectId(root) && existing.runId !== runId) fail(`session is already bound to run ${existing.runId}; use resume for that run or start a different Codex session`);
  write(sessionFile(root, sessionId), { schemaVersion: '3.0', projectId: projectId(root), runId, sessionId, ...currentBridgeSnapshot(), boundAt: now(), refreshedAt: now() });
}
function clearSessionHistory(root, sessionId, reason) {
  const binding = sessionBinding(root, sessionId);
  if (!binding || binding.projectId !== projectId(root)) fail('this session has no APEX run for the project; use intake instead');
  const previous = { runId: binding.runId, runDir: runDir(root, binding.runId) };
  if (!fs.existsSync(path.join(previous.runDir, 'state.json'))) fail(`bound run state does not exist: ${previous.runDir}`);
  appendEvent(previous.runDir, { type: 'run-restarted-by-user', sessionId, replacementReason: reason });
  const lease = fs.existsSync(leaseFile(root)) ? read(leaseFile(root)) : null;
  if (lease && lease.runId === previous.runId && lease.sessionId === sessionId) {
    fs.rmSync(leaseDirectory(root), { recursive: true, force: true });
    appendEvent(previous.runDir, { type: 'mutation-lease-released-for-restart', sessionId, leaseId: lease.leaseId });
  }
  fs.unlinkSync(sessionFile(root, sessionId));
  return previous;
}
function purgeRetiredRun(root, previous, activeRunDir) {
  const runsRoot = path.resolve(root, '.apex', 'runs');
  const retiredDir = path.resolve(previous.runDir);
  const activeDir = path.resolve(activeRunDir);
  if (!retiredDir.startsWith(`${runsRoot}${path.sep}`) || retiredDir === runsRoot || retiredDir === activeDir) fail('refusing to purge an invalid or active retired run directory');
  if (fs.existsSync(retiredDir)) fs.rmSync(retiredDir, { recursive: true, force: false });
  return { runId: previous.runId, purged: !fs.existsSync(retiredDir), scope: 'current-session-bound-run-only' };
}
const gate1Artifacts = ['intentBrief', 'deliveryContract', 'gate1Presentation', 'projectInventory', 'existingBaseline', 'codeReference', 'pageSkeleton', 'experienceStrategy', 'experienceQualityEvidence', 'domainModel', 'apiContract', 'functionalFreeze'];
// Formal Existing evidence remains valid when the user refines the requested
// product behavior.  Everything derived from that behavior must be rebuilt;
// otherwise an approved Gate 1 receipt can silently describe an older scope.
const gate1DerivedArtifacts = ['intentBrief', 'deliveryContract', 'gate1Presentation', 'gate1PresentationManifest', 'experienceStrategy', 'experienceQualityEvidence', 'domainModel', 'apiContract', 'functionalFreeze', 'changeScope'];
const visualAndImplementationArtifacts = ['motionContract', 'motionEvidence', 'visualExecutionPlan', 'visualPlanPresentation', 'visualPlanPresentationManifest', 'demoSourceManifest', 'visualSandboxFiles', 'visualSandboxRuntime', 'runtimeDemo', 'runtimeSourceLock', 'runtimeVisualBaseline', 'runtimeMaterialization', 'runtimeMaterializationAudit', 'materializedAssets', 'materializedAssetsAudit', 'designCandidates', 'visualSourceManifest', 'visualReference', 'gate1VisualOutput', 'siteContract', 'stitchFreeze', 'stitchParityEvidence', 'stitchPresentation', 'stitchPresentationManifest', 'implementationParityEvidence', 'visualBundle', 'implementationMap', 'implementationPresentation', 'implementationPresentationManifest', 'runtimeStateMatrix', 'verificationPlan', 'verificationBundle', 'pageDelta', 'dependencyLock'];
function clearArtifactReferences(state, names) {
  const cleared = [];
  for (const name of names) {
    if (state.artifacts?.[name]) cleared.push(name);
    if (state.artifacts && name in state.artifacts) state.artifacts[name] = null;
  }
  return cleared;
}
function inheritGate1Context(source, target) {
  const sourceState = stateOf(source.runDir);
  const targetState = stateOf(target.runDir);
  if (sourceState.gates?.gate1?.status !== 'passed' || sourceState.track !== targetState.track || sourceState.scope !== targetState.scope) return { retained: false, artifacts: [] };
  const sourceRoot = path.resolve(source.runDir);
  const retained = [];
  for (const name of gate1Artifacts) {
    const reference = sourceState.artifacts?.[name];
    if (!reference) continue;
    const sourceFile = path.resolve(source.runDir, reference);
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) fail(`retained Gate 1 artifact is missing: ${name}`);
    if (sourceFile.startsWith(`${sourceRoot}${path.sep}`)) {
      const relative = path.relative(source.runDir, sourceFile);
      const targetFile = path.resolve(target.runDir, relative);
      if (!targetFile.startsWith(`${path.resolve(target.runDir)}${path.sep}`)) fail(`retained Gate 1 artifact is outside the new run: ${name}`);
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.copyFileSync(sourceFile, targetFile);
      targetState.artifacts[name] = relative;
    } else targetState.artifacts[name] = path.isAbsolute(reference) ? reference : sourceFile;
    retained.push(name);
  }
  targetState.gates.gate1 = { status: 'passed', at: sourceState.gates.gate1.at, evidence: [`inherited-from-run:${source.runId}`, ...retained] };
  targetState.locks.requirementsApproved = true;
  targetState.phase = targetState.track === 'greenfield' ? 'G-04 VISUAL_PLAN' : 'E-06 VISUAL_PLAN';
  targetState.revision = Number(targetState.revision || 0) + 1;
  targetState.updatedAt = now();
  write(path.join(target.runDir, 'state.json'), targetState);
  appendEvent(target.runDir, { type: 'gate1-context-retained', sourceRunId: source.runId, artifacts: retained });
  return { retained: true, artifacts: retained };
}
function assertSessionBinding(root, sessionId, requestedRunId) {
  const binding = sessionBinding(root, sessionId);
  if (!binding || binding.projectId !== projectId(root)) fail('this session has no APEX run for the project; a new Codex session must use intake to create a new run');
  if (requestedRunId && binding.runId !== requestedRunId) fail(`session is bound to run ${binding.runId}, not ${requestedRunId}; cross-session or cross-run resume is not allowed`);
  // The Router is the executable policy boundary.  Every continued session is
  // rebound to the current canonical Bridge before it can inspect, authorize,
  // or mutate a run; a stale prompt snapshot must never require a new session.
  refreshSessionContext(root, sessionId);
  return binding.runId;
}
function runDir(root, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId || '')) fail('runId must contain only letters, numbers, dot, underscore, or dash');
  return path.join(root, '.apex', 'runs', runId);
}
function stateOf(dir) { const file = path.join(dir, 'state.json'); if (!fs.existsSync(file)) fail(`run state does not exist: ${file}`); return read(file); }
function appendEvent(dir, event) { fs.appendFileSync(path.join(dir, 'events.ndjson'), `${JSON.stringify({ at: now(), ...event })}\n`); }
const cancellationReceiptName = 'cancellation-receipt.json';
const cancellationRetainedEntries = new Set(['state.json', 'events.ndjson', cancellationReceiptName]);
function isCurrentRunChild(runDir, candidate) {
  const root = path.resolve(runDir);
  const resolved = path.resolve(candidate);
  return path.dirname(resolved) === root;
}
function pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function assertExplicitCurrentRunCancellation(userInstruction) {
  const text = String(userInstruction || '').trim().replace(/\s+/g, ' ');
  const cancellation = /(?:取消|终止|结束|停止)\s*(?:当前\s*)?(?:APEX\s*)?(?:执行|任务|运行|流程|run|execution|task|workflow)|\b(?:cancel|terminate|stop)\s+(?:the\s+)?current\s+(?:apex\s+)?(?:run|execution|task|workflow)\b/i.test(text);
  const revision = /修改|调整|重新分析|重新设计|方案有问题|优化|改动|revise|modify|redesign|reanaly[sz]e/i.test(text);
  if (!cancellation || revision) fail('cancel requires an unambiguous user instruction to terminate the current APEX execution; plan revisions must use revise');
  return 'explicit-current-run-cancellation';
}

// Creating a Run is itself a stateful operation: it creates a project-local
// execution record, binds the current Codex session, and enables the Stop
// continuation hook.  Keep that boundary as explicit as destructive actions.
// A host must pass the user's original authorization, rather than infer it
// from a UI-related request or its own plan.
function assertExplicitApexConsent(userInstruction) {
  const text = String(userInstruction || '').trim();
  const consent = /^(?:(?:确认|同意|请|可以)(?:使用|调用|启用|启动)?|(?:使用|调用|启用|启动))(?:最新(?:版本)?的?)?\s*APEX\b|^\[APEX\](?:\s|$)|^(?:confirm|use|invoke|enable|start)(?:\s+(?:the\s+)?(?:latest\s+)?)?APEX\b/i.test(text);
  if (!consent) fail('intake requires the user\'s explicit APEX consent (for example: “确认调用 APEX”); a UI request, plan, or host statement is not consent');
  return text;
}
function processIsLive(pid) {
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', timeout: 1000 });
  const status = String(result.stdout || '').trim();
  return Boolean(status) && !status.includes('Z');
}
function runtimeRecordCandidates(runDir) {
  const candidates = [path.join(runDir, 'visual-sandbox-runtime.json')];
  const registry = path.join(runDir, 'runtime-services.json');
  if (fs.existsSync(registry)) {
    try {
      const services = read(registry).services;
      if (Array.isArray(services)) for (const service of services) {
        if (typeof service?.record === 'string' && isCurrentRunChild(runDir, path.join(runDir, service.record))) candidates.push(path.join(runDir, service.record));
      }
    } catch {}
  }
  return [...new Set(candidates)];
}
function stopRunLocalServices(runDir, runId) {
  const stopped = [], alreadyStopped = [], refused = [];
  for (const recordFile of runtimeRecordCandidates(runDir)) {
    if (!fs.existsSync(recordFile)) continue;
    let record;
    try { record = read(recordFile); } catch { refused.push({ record: path.basename(recordFile), reason: 'invalid-runtime-record' }); continue; }
    const pid = Number(record?.pid);
    const runtimeRoot = typeof record?.runtimeRoot === 'string' ? path.resolve(runDir, record.runtimeRoot) : null;
    const expectedRoot = path.resolve(runDir, 'visual-sandbox');
    const canonicalRuntimeRoot = runtimeRoot && fs.existsSync(runtimeRoot) ? fs.realpathSync(runtimeRoot) : null;
    const canonicalExpectedRoot = fs.existsSync(expectedRoot) ? fs.realpathSync(expectedRoot) : null;
    if (!Number.isInteger(pid) || pid <= 1 || !canonicalRuntimeRoot || canonicalRuntimeRoot !== canonicalExpectedRoot || !isCurrentRunChild(runDir, runtimeRoot)) {
      refused.push({ record: path.basename(recordFile), reason: 'runtime-record-not-owned-by-current-run' });
      continue;
    }
    const processInfo = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    const command = String(processInfo.stdout || '').trim();
    if (!command) { alreadyStopped.push({ record: path.basename(recordFile), pid }); continue; }
    if (!command.includes('visual-sandbox-runtime.mjs serve') || !command.includes(`--apex-run-id ${runId}`) || (!command.includes(runtimeRoot) && !command.includes(canonicalExpectedRoot))) {
      refused.push({ record: path.basename(recordFile), pid, reason: 'pid-command-does-not-match-current-run-runtime' });
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      const deadline = Date.now() + 2000;
      while (processIsLive(pid) && Date.now() < deadline) pause(25);
      if (processIsLive(pid)) process.kill(pid, 'SIGKILL');
      pause(25);
      if (processIsLive(pid)) { refused.push({ record: path.basename(recordFile), pid, reason: 'runtime-stop-did-not-exit' }); continue; }
      stopped.push({ record: path.basename(recordFile), pid, url: typeof record.url === 'string' ? record.url : null });
    } catch (error) { refused.push({ record: path.basename(recordFile), pid, reason: `runtime-stop-failed:${error.code || error.message}` }); }
  }
  return { stopped, alreadyStopped, refused };
}
function reclaimCancelledRun(root, run, sessionId, reason) {
  const state = stateOf(run.runDir);
  const services = stopRunLocalServices(run.runDir, run.runId);
  if (services.refused.length) fail(`refusing cancellation cleanup because a runtime process cannot be proven run-local: ${services.refused.map(item => item.reason).join(', ')}`);
  const removed = [];
  for (const entry of fs.readdirSync(run.runDir, { withFileTypes: true })) {
    if (cancellationRetainedEntries.has(entry.name)) continue;
    const target = path.join(run.runDir, entry.name);
    if (!isCurrentRunChild(run.runDir, target)) fail(`refusing to reclaim an entry outside the current run: ${entry.name}`);
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(entry.name);
  }
  state.lifecycle = 'cancelled';
  state.revision = Number(state.revision || 0) + 1;
  state.updatedAt = now();
  for (const key of Object.keys(state.artifacts || {})) state.artifacts[key] = key === 'roleDecisionSummaries' ? {} : null;
  state.handoff = null;
  state.cancellation = { receipt: cancellationReceiptName, at: state.updatedAt, reason, sessionId, temporaryArtifactsReclaimed: true };
  write(path.join(run.runDir, 'state.json'), state);
  const receipt = {
    schemaVersion: '1.0', type: 'run-cancellation-reclamation', projectId: projectId(root), runId: run.runId, sessionId,
    cancelledAt: state.updatedAt, reason, temporaryArtifactsReclaimed: true, removedEntries: removed,
    services: { stopped: services.stopped, alreadyStopped: services.alreadyStopped }
  };
  write(path.join(run.runDir, cancellationReceiptName), receipt);
  appendEvent(run.runDir, { type: 'run-temporary-artifacts-reclaimed', sessionId, receipt: cancellationReceiptName, removedEntries: removed, stoppedServices: services.stopped.map(item => item.pid), alreadyStoppedServices: services.alreadyStopped.map(item => item.pid) });
  return { receipt: cancellationReceiptName, removedEntries: removed, services };
}
function revokeDownstreamDeliveryState(state, reason) {
  // Proof and Gate 3 are descendants of Gate 2. A visual or implementation
  // reset must never leave a stale delivery claim active.
  const revoked = [];
  if (state.gates?.proof?.status === 'passed') {
    state.gates.proof = { status: 'revoked', at: now(), evidence: [reason] };
    revoked.push('proof');
  }
  if (state.gates?.gate3?.status === 'passed') {
    state.gates.gate3 = { status: 'revoked', at: now(), evidence: [reason] };
    revoked.push('gate3');
  }
  for (const artifact of ['runtimeStateMatrix', 'verificationPlan', 'verificationBundle', 'industryBenchmarkEvidence', 'evidenceProvenance']) {
    if (state.artifacts?.[artifact]) { state.artifacts[artifact] = null; revoked.push(artifact); }
  }
  return revoked;
}
function reconcileGateDependencyState(dir, state) {
  const gate2Open = state.gates?.gate2?.status === 'passed' && state.locks?.implementationAllowed === true;
  if (gate2Open || (state.gates?.proof?.status !== 'passed' && state.gates?.gate3?.status !== 'passed')) return state;
  const revoked = revokeDownstreamDeliveryState(state, 'upstream-gate2-is-not-open');
  state.phase = state.track === 'greenfield' ? 'G-08 GATE_2' : 'E-10 GATE_2';
  state.revision = Number(state.revision || 0) + 1;
  state.updatedAt = now();
  write(path.join(dir, 'state.json'), state);
  appendEvent(dir, { type: 'gate-dependency-state-reconciled', reason: 'upstream-gate2-is-not-open', revoked });
  return state;
}
function invalidateVisualIntermediates(dir, reason) {
  // These are generated, reviewable outputs.  Clearing their state references
  // alone is insufficient: an old runtime-demo.json or visual-sandbox can be
  // mistaken for the current Demo by a host that discovers files by name.
  // Preserve the evidence trail under invalidated/, but leave no runnable
  // generated visual at the active run root after a material reset.
  const candidates = ['visual-execution-plan.json', 'visual-plan-presentation.md', 'visual-plan-presentation-manifest.json', 'visual-sandbox', 'visual-sandbox-files.json', 'runtime-demo.json', 'runtime-source-lock.json', 'runtime-visual-baseline.json', 'design-candidates.json', 'visual-reference.json', 'gate1-visual-output.json', 'stitch-job.json', 'stitch-freeze.json', 'stitch-raw.json', 'stitch-parity-evidence.json', 'visual-bundle.json', 'implementation-map.json', 'evidence/stitch-ui-import.json'];
  const stamp = `${Date.now()}-${String(reason).replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const archive = path.join(dir, 'invalidated', stamp); const moved = [];
  for (const relative of candidates) {
    const source = path.join(dir, relative);
    if (!fs.existsSync(source)) continue;
    const target = path.join(archive, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(source, target); moved.push(relative);
  }
  if (moved.length) appendEvent(dir, { type: 'visual-intermediates-invalidated', reason, archive: path.relative(dir, archive), artifacts: moved });
  return moved;
}
function invalidateRoleStages(dir, state, stages, reason) {
  if (!state.roleChain?.enabled || !stages.length) return [];
  const manifestRef = state.artifacts?.roleAdvisoryManifest;
  const manifestFile = manifestRef && artifactFile(dir, manifestRef);
  const moved = [];
  const stamp = `${Date.now()}-role-${String(reason).replace(/[^A-Za-z0-9._-]/g, '_')}`;
  for (const stage of stages) {
    const source = path.join(dir, 'advisories', stage);
    if (fs.existsSync(source)) {
      const target = path.join(dir, 'invalidated', stamp, 'advisories', stage);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(source, target); moved.push(`advisories/${stage}`);
    }
    if (state.artifacts?.roleDecisionSummaries) delete state.artifacts.roleDecisionSummaries[stage];
  }
  if (manifestFile && fs.existsSync(manifestFile)) {
    try { const manifest = read(manifestFile); for (const stage of stages) delete manifest.stages?.[stage]; write(manifestFile, manifest); }
    catch { state.artifacts.roleAdvisoryManifest = null; }
  }
  if (moved.length) appendEvent(dir, { type: 'role-advisories-invalidated', reason, stages, artifacts: moved });
  return moved;
}
function runControllerCommand(command, args) {
  executeRouterController(command, args);
  return { status: 0, stdout: '', stderr: '' };
}
function executeRouterController(command, args) {
  const die = message => { throw new Error(`APEX controller failed: ${message}`); };
  const stateFile = dir => path.join(dir, 'state.json');
  const load = dir => read(stateFile(dir));
  const save = (dir, state) => { state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(stateFile(dir), state); };
  const validate = (stage, dir) => {
    const result = spawnSync(process.execPath, [validator, stage, dir], { encoding: 'utf8' });
    if (result.status !== 0) die((result.stderr || result.stdout).trim());
  };
  const approval = (dir, reference, gate, state) => {
    if (!reference) die(`a ${gate} approval receipt is required`);
    const approvals = path.resolve(dir, 'approvals');
    const file = path.resolve(dir, reference);
    if (!file.startsWith(`${approvals}${path.sep}`) || !fs.existsSync(file)) die(`approval receipt must exist under ${approvals}`);
    const receipt = read(file);
    if (receipt.schemaVersion !== '3.0' || receipt.status !== 'approved' || receipt.gate !== gate || receipt.runId !== state.runId || !receipt.projectId || !receipt.sessionId) die(`invalid ${gate} approval receipt`);
    if (!Array.isArray(receipt.artifactHashes) || !receipt.artifactHashes.length) die(`approval receipt has no frozen artifact hashes`);
    for (const item of receipt.artifactHashes) {
      const artifact = path.resolve(dir, item.path || '');
      if (!artifact.startsWith(`${path.resolve(dir)}${path.sep}`) || !fs.existsSync(artifact) || hashFile(artifact) !== item.sha256) die(`approval artifact hash no longer matches: ${item.path}`);
    }
    return receipt;
  };
  const writeTemplate = (dir, target, template) => write(path.join(dir, target), read(path.join(apexRoot, 'core', 'templates', template)));
  if (command === 'init') {
    const [projectRoot, runId, track, scope = 'standard', authorization = 'interactive'] = args;
    if (!projectRoot || !runId || !['greenfield', 'existing'].includes(track)) die('usage: init <project-root> <run-id> <greenfield|existing> [lite|standard|full] [interactive|autonomous]');
    if (!['lite', 'standard', 'full'].includes(scope) || !['interactive', 'autonomous'].includes(authorization)) die('invalid scope or authorization');
    const dir = path.join(path.resolve(projectRoot), '.apex', 'runs', runId);
    if (fs.existsSync(dir)) die(`run already exists: ${dir}`);
    fs.mkdirSync(path.join(dir, 'checkpoints'), { recursive: true });
    const state = read(path.join(apexRoot, 'core', 'templates', 'run-state.example.json'));
    Object.assign(state, { runId, revision: 0, track, scope, authorization, lifecycle: 'active', phase: track === 'greenfield' ? 'G-01 PRODUCT' : 'E-01 BASELINE', updatedAt: now() });
    // Contract fixtures intentionally exercise the pre-role-chain state
    // machine. This test-only switch is never emitted by normal invocation.
    if (process.env.APEX_TEST_LEGACY_ROLE_CHAIN === '1') state.roleChain = { version: '1.0', enabled: false, confirmationModel: 'gate-summary-only' };
    write(stateFile(dir), state);
    write(path.join(dir, 'context-index.json'), { schemaVersion: '3.0', sources: [] });
    write(path.join(dir, 'decisions.json'), { schemaVersion: '3.0', decisions: [] });
    writeTemplate(dir, 'intent-brief.json', 'intent-brief.example.json'); writeTemplate(dir, 'delivery-contract.json', 'delivery-contract.example.json');
    state.artifacts.intentBrief = 'intent-brief.json'; state.artifacts.deliveryContract = 'delivery-contract.json';
    if (track === 'existing') { state.artifacts.projectInventory = 'project-inventory.json'; writeTemplate(dir, 'existing-baseline.json', 'existing-baseline.example.json'); writeTemplate(dir, 'functional-freeze.json', 'functional-freeze.example.json'); state.artifacts.existingBaseline = 'existing-baseline.json'; state.artifacts.functionalFreeze = 'functional-freeze.json'; }
    write(stateFile(dir), state);
  } else if (command === 'pass-gate1') {
    const [runDir, evidence] = args; const dir = path.resolve(runDir); validate('pre-gate1', dir); const state = load(dir); const receipt = approval(dir, evidence, 'gate1', state);
    state.gates.gate1 = { status: 'passed', at: now(), evidence: [evidence, `approval:${receipt.approvalId}`] }; state.locks.requirementsApproved = true; state.locks.visualPlanApproved = false; state.phase = state.track === 'greenfield' ? 'G-04 VISUAL_PLAN' : 'E-06 VISUAL_PLAN'; save(dir, state);
  } else if (command === 'confirm-visual-plan') {
    const [runDir, evidence] = args; const dir = path.resolve(runDir); const state = load(dir); if (state.gates.gate1.status !== 'passed' || !state.artifacts.visualExecutionPlan) die('Gate 1 and a visual execution plan are required before visual-plan confirmation'); const receipt = approval(dir, evidence, 'visual-plan', state);
    state.locks.visualPlanApproved = true; state.phase = state.track === 'greenfield' ? 'G-05 VISUAL' : 'E-07 VISUAL'; save(dir, state);
  } else if (command === 'register') {
    const [runDir, artifact, reference] = args; const dir = path.resolve(runDir); const state = load(dir);
    if (!(artifact in state.artifacts) || !reference) die('unknown artifact or missing reference');
    const file = path.isAbsolute(reference) ? reference : path.join(dir, reference); if (!fs.existsSync(file)) die(`artifact does not exist: ${file}`);
    state.artifacts[artifact] = reference;
    // A completed generated visual is evidence, not a second human Gate. Once
    // its full artifact set is registered after visual-plan approval, advance
    // automatically to the Stitch/direct-code decision boundary.
    if (state.locks.visualPlanApproved && !state.locks.effectApproved && state.artifacts.runtimeDemo && state.artifacts.designCandidates && state.artifacts.visualReference && state.artifacts.gate1VisualOutput) {
      state.locks.effectApproved = true; state.locks.visualApproved = true; state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.implementationApproved = false; state.locks.stitchCurrent = false;
      state.gates.gate2 = { status: 'pending', at: null, evidence: ['runtime-demo-baseline-registered'] };
      state.phase = state.track === 'greenfield' ? 'G-06 SYNC_FREEZE' : 'E-08 SYNC_FREEZE';
      appendEvent(dir, { type: 'runtime-demo-recorded', artifacts: ['runtimeDemo', 'designCandidates', 'visualReference', 'gate1VisualOutput'] });
    }
    save(dir, state);
  } else if (command === 'confirm-visual') {
    die('visual has no human confirmation checkpoint: register the complete generated visual artifacts after visual-plan confirmation');
  } else if (command === 'confirm-stitch') {
    const [runDir, evidence] = args; const dir = path.resolve(runDir); const state = load(dir); if (!state.locks.effectApproved || !state.artifacts.runtimeDemo || !state.artifacts.stitchFreeze || !state.artifacts.stitchParityEvidence) die('runtime Demo baseline, Stitch candidate, and strict parity evidence are required before Stitch confirmation'); const receipt = approval(dir, evidence, 'stitch', state);
    state.locks.stitchApproved = true; state.locks.implementationApproved = false; save(dir, state);
  } else if (command === 'confirm-implementation') {
    const [runDir, evidence] = args; const dir = path.resolve(runDir); const state = load(dir); if ((!state.locks.stitchCurrent && !state.locks.stitchSkipped) || !state.locks.stitchApproved || !state.artifacts.visualBundle || !state.artifacts.implementationMap) die('confirmed current or explicitly skipped Stitch, Visual Bundle, and Implementation Map are required before implementation confirmation'); const receipt = approval(dir, evidence, 'implementation', state);
    state.locks.implementationApproved = true; save(dir, state);
  } else if (command === 'open-gate2') {
    const dir = path.resolve(args[0] || '.'); validate('pre-gate2', dir); const state = load(dir); state.gates.gate2 = { status: 'passed', at: now(), evidence: ['machine-pre-gate2-passed'] }; state.locks.implementationAllowed = true; state.phase = state.track === 'greenfield' ? 'G-09 PROOF_IMPLEMENT' : 'E-11 IMPLEMENT'; save(dir, state); validate('gate2', dir);
  } else if (command === 'revoke-stitch') {
    const [runDir, reason = 'stitch-content-changed'] = args; const dir = path.resolve(runDir); const state = load(dir); const invalidated = invalidateVisualIntermediates(dir, reason); const invalidatedRoles = invalidateRoleStages(dir, state, ['visual', 'implementation', 'verify'], reason); state.gates.gate2 = { status: 'revoked', at: now(), evidence: [reason] }; state.locks.effectApproved = false; state.locks.visualApproved = false; state.locks.visualPlanApproved = false; state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.implementationApproved = false; state.locks.stitchCurrent = false; state.locks.implementationAllowed = false; state.deliveryRoute = null; state.pendingDeliveryRoute = null; state.pendingDeliveryRouteReceipt = null; for (const artifact of ['visualExecutionPlan', 'runtimeDemo', 'designCandidates', 'visualReference', 'gate1VisualOutput', 'stitchFreeze', 'stitchParityEvidence', 'visualBundle', 'implementationMap']) state.artifacts[artifact] = null; const revoked = revokeDownstreamDeliveryState(state, reason); state.phase = state.track === 'greenfield' ? 'G-04 VISUAL_PLAN' : 'E-06 VISUAL_PLAN'; save(dir, state); appendEvent(dir, { type: 'visual-reset', reason, invalidated, invalidatedRoles, revoked });
  } else if (command === 'repair-visual-source-identity') {
    const [runDir, evidence] = args; const dir = path.resolve(runDir); const state = load(dir); const repair = latestTechnicalIdentityRepair(state, dir);
    if (!repair.ready) die(`technical visual identity repair is unavailable: ${repair.reason || 'no exact prior approval and equivalent rebuilt plan'}`);
    const receipt = { schemaVersion: '3.0', type: 'technical-visual-source-identity-repair', repairedAt: now(), reason: repair.reason, priorPlan: { path: repair.priorPlan, sha256: repair.priorHash, approval: repair.approval }, currentPlan: { path: repair.currentPlan, sha256: repair.currentHash }, evidence };
    const relative = path.join('repairs', `visual-source-identity-${Date.now()}.json`); write(path.join(dir, relative), receipt);
    state.locks.visualPlanApproved = true; state.locks.effectApproved = false; state.locks.visualApproved = false; state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.deliveryRoute = null; state.pendingDeliveryRoute = null; state.pendingDeliveryRouteReceipt = null; state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['technical-visual-source-identity-repair'] }; const revoked = revokeDownstreamDeliveryState(state, 'technical-visual-source-identity-repair'); state.phase = state.track === 'greenfield' ? 'G-05 VISUAL' : 'E-07 VISUAL'; save(dir, state); appendEvent(dir, { type: 'visual-source-identity-repaired-with-prior-approval', receipt: relative, priorPlan: repair.priorPlan, currentPlan: repair.currentPlan, priorApproval: repair.approval, revoked });
  } else if (command === 'checkpoint') {
    const [runDir, label = 'checkpoint'] = args; const dir = path.resolve(runDir); const state = load(dir); const artifacts = {};
    for (const [name, ref] of Object.entries(state.artifacts)) { if (typeof ref !== 'string' || !ref) continue; const file = path.isAbsolute(ref) ? ref : path.join(dir, ref); if (fs.existsSync(file)) artifacts[name] = { path: ref, hash: hashFile(file) }; }
    const checkpoint = { schemaVersion: '3.0', label, at: now(), phase: state.phase, gates: state.gates, locks: state.locks, artifacts }; const file = path.join(dir, 'checkpoints', `${Date.now()}-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`); write(file, checkpoint); state.checkpoints ||= []; state.checkpoints.push({ path: path.relative(dir, file), at: checkpoint.at, label }); save(dir, state);
  } else if (command === 'pass-proof') {
    const [runDir, evidence] = args; if (!evidence) die('usage: pass-proof <run-dir> <evidence-path>'); const dir = path.resolve(runDir); const evidenceFile = path.resolve(dir, evidence); if (!evidenceFile.startsWith(`${dir}${path.sep}`) || !fs.existsSync(evidenceFile)) die(`proof evidence does not exist inside the run: ${evidenceFile}`); const proof = read(evidenceFile), receipt = outputReceiptFor(dir, evidenceFile); if (proof.status !== 'passed' || !Array.isArray(proof.evidence) || !proof.evidence.length || !receipt) die('proof evidence is not passed raw output of a successful controlled verify operation'); const state = load(dir); state.gates.proof = { status: 'passed', at: now(), evidence: [path.relative(dir, evidenceFile), path.relative(dir, receipt.path)] }; state.phase = state.track === 'greenfield' ? 'G-11 EXPAND' : 'E-13 REGRESSION'; save(dir, state);
  } else if (command === 'open-gate3') {
    const dir = path.resolve(args[0] || '.'); validate('gate3', dir); const state = load(dir); if (!['passed', 'not-required'].includes(state.gates.proof.status)) die('Proof Gate has not passed'); state.gates.gate3 = { status: 'passed', at: now(), evidence: [state.artifacts.verificationBundle || 'verification-bundle.json'] }; state.phase = state.track === 'greenfield' ? 'G-13 MEMORY' : 'E-15 MEMORY'; save(dir, state);
  } else die(`unsupported internal controller command: ${command}`);
}
function registerRuntimeDemo(root, run, sessionId, authorizationRef) {
  if (!authorizationRef) fail('runtime Demo registration requires a current register_runtime_demo Router authorization');
  verifyAuthorization(root, run, sessionId, authorizationRef, 'register_runtime_demo');
  const state = stateOf(run.runDir);
  if (state.lifecycle !== 'active' || state.gates?.gate1?.status !== 'passed' || !state.locks?.visualPlanApproved || state.locks?.effectApproved) fail('runtime Demo registration is only available after visual-plan confirmation and before route selection');
  const required = ['runtimeDemo', 'designCandidates', 'visualReference', 'gate1VisualOutput']; const records = [];
  for (const artifact of required) {
    const reference = state.artifacts?.[artifact]; const file = artifactFile(run.runDir, reference);
    if (!file) fail(`runtime Demo registration requires ${artifact}`);
    // Registration is a security boundary: unlike status polling it must
    // recompute the artifact hash, never rely on the fast stat fingerprint.
    const operation = actionOutputReceiptFor(run.runDir, file, 'generate_visual', true);
    if (!operation) fail(`${artifact} is not an unchanged output of a successful generate_visual operation`);
    records.push({ artifact, path: path.relative(run.runDir, file), sha256: sha256File(file), operationReceipt: path.relative(run.runDir, operation.path) });
  }
  const receipt = { schemaVersion: '3.0', type: 'runtime-demo-registration', projectId: projectId(root), runId: run.runId, sessionId, registeredAt: now(), artifacts: records };
  const relative = path.join('registrations', `runtime-demo-${Date.now()}.json`); write(path.join(run.runDir, relative), receipt);
  runControllerCommand('register', [run.runDir, 'runtimeDemo', state.artifacts.runtimeDemo]);
  appendEvent(run.runDir, { type: 'runtime-demo-registration-verified', sessionId, receipt: relative, artifacts: records.map(item => item.artifact) });
  // A route utterance made while the Demo was still being generated is a
  // durable user decision, not a second visual-plan confirmation. Apply it
  // only after this registration proves the same runtime Demo exists.
  const registered = stateOf(run.runDir);
  if (registered.pendingDeliveryRoute === 'direct-code') {
    const intent = registered.pendingDeliveryRouteReceipt;
    if (!intent) fail('pending direct-code route is missing its decision receipt');
    skipStitchStage(root, { ...run, state: registered }, sessionId, 'pending-direct-code-route', `apply registered direct-code route intent: ${intent}`, [intent]);
    appendEvent(run.runDir, { type: 'pending-delivery-route-applied-after-runtime-demo-registration', sessionId, route: 'direct-code', intent });
  }
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}
function gate1PresentationRegistrationReady(runDir, state) {
  const reference = state.artifacts?.gate1PresentationRegistration;
  const file = artifactFile(runDir, reference);
  if (!file) return false;
  try {
    const receipt = read(file);
    const presentation = artifactFile(runDir, state.artifacts?.gate1Presentation);
    const manifest = artifactFile(runDir, state.artifacts?.gate1PresentationManifest);
    return receipt.schemaVersion === '3.0' && receipt.type === 'gate1-presentation-registration'
      && receipt.runId === state.runId && receipt.presentation?.sha256 === sha256File(presentation)
      && receipt.manifest?.sha256 === sha256File(manifest);
  } catch { return false; }
}
function registerGate1Presentation(root, run, sessionId, authorizationRef) {
  if (!authorizationRef) fail('Gate 1 presentation registration requires a current analyze_requirement Router authorization');
  verifyAuthorization(root, run, sessionId, authorizationRef, 'analyze_requirement');
  const state = stateOf(run.runDir);
  if (state.lifecycle !== 'active' || state.gates?.gate1?.status === 'passed') fail('Gate 1 presentation registration is only available before Gate 1 approval');
  if (state.track === 'existing' && !existingVisualBaselineStatus(run.runDir, state).ready) fail('Gate 1 presentation registration requires a current Existing formal-code and browser baseline');
  if (!gate1PrerequisitesReady(state, run.runDir)) fail('Gate 1 presentation registration requires all automatic requirement, API/domain, baseline, experience, and role-advisory prerequisites');
  const presentation = artifactFile(run.runDir, state.artifacts?.gate1Presentation);
  const manifest = artifactFile(run.runDir, state.artifacts?.gate1PresentationManifest);
  if (!presentation || !manifest || !gate1PresentationReady(state, run.runDir)) fail('Gate 1 presentation registration requires a complete current eight-section presentation and manifest');
  const presentationOperation = actionOutputReceiptFor(run.runDir, presentation, 'analyze_requirement', true);
  const manifestOperation = actionOutputReceiptFor(run.runDir, manifest, 'analyze_requirement', true);
  if (!presentationOperation || !manifestOperation) fail('Gate 1 presentation and manifest must be unchanged outputs of a successful controlled analyze_requirement operation');
  const receipt = {
    schemaVersion: '3.0', type: 'gate1-presentation-registration', projectId: projectId(root), runId: run.runId, sessionId, registeredAt: now(),
    presentation: { path: path.relative(run.runDir, presentation), sha256: sha256File(presentation), operationReceipt: path.relative(run.runDir, presentationOperation.path) },
    manifest: { path: path.relative(run.runDir, manifest), sha256: sha256File(manifest), operationReceipt: path.relative(run.runDir, manifestOperation.path) }
  };
  const relative = path.join('registrations', `gate1-presentation-${Date.now()}.json`); write(path.join(run.runDir, relative), receipt);
  state.artifacts.gate1PresentationRegistration = relative; state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  appendEvent(run.runDir, { type: 'gate1-presentation-registered', sessionId, receipt: relative });
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}
function ensureProject(root) {
  const file = path.join(root, '.apex', 'project.json');
  const expected = { schemaVersion: '3.0', projectId: projectId(root), projectRoot: root };
  fs.mkdirSync(path.join(root, '.apex', 'cache'), { recursive: true });
  const gitignore = path.join(root, '.apex', '.gitignore');
  if (!fs.existsSync(gitignore)) writeText(gitignore, "runs/\ncache/\nlocks/\nsessions/\n");
  if (fs.existsSync(file)) { const existing = read(file); if (existing.projectId !== expected.projectId || existing.projectRoot !== root) fail('project identity mismatch; refusing to mix APEX runs'); return existing; }
  write(file, { ...expected, createdAt: now() }); return expected;
}
function candidates(root) {
  const parent = path.join(root, '.apex', 'runs');
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter(item => item.isDirectory() && fs.existsSync(path.join(parent, item.name, 'state.json'))).map(item => {
    const dir = path.join(parent, item.name); return { runId: item.name, runDir: dir, state: stateOf(dir) };
  }).sort((a, b) => String(b.state.updatedAt).localeCompare(String(a.state.updatedAt)));
}
function selectRun(root, requested) {
  if (requested) { const dir = runDir(root, requested); return { runId: requested, runDir: dir, state: stateOf(dir) }; }
  const active = candidates(root).filter(item => item.state.gates?.gate3?.status !== 'passed');
  if (!active.length) fail('no resumable run exists; use intake to create a project-local run');
  if (active.length > 1) { json({ status: 'selection-required', projectRoot: root, candidates: active.map(item => ({ runId: item.runId, phase: item.state.phase, updatedAt: item.state.updatedAt })) }); process.exit(2); }
  return active[0];
}
function artifactFile(runDir, reference) {
  if (!reference || typeof reference !== 'string') return null;
  const root = path.resolve(runDir);
  const file = path.resolve(root, reference);
  return file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}
function changeScopeStatus(runDir, state, reference = null) {
  if (state.track !== 'existing' || !state.artifacts?.changeScope) return { ready: true, reason: null };
  const scopeFile = artifactFile(runDir, state.artifacts.changeScope);
  const codeReferenceFile = artifactFile(runDir, state.artifacts?.codeReference);
  if (!scopeFile || !codeReferenceFile) return { ready: false, reason: 'change scope and complete code reference are required together' };
  try {
    const scope = read(scopeFile);
    const codeReference = reference || read(codeReferenceFile);
    const referenceFiles = new Map((codeReference.files || []).map(item => [item.path, item.sha256]));
    const affectedTargets = new Set(scope.affected?.runtimeTargets || []);
    const protectedFiles = new Map((scope.protected?.files || []).map(item => [item.path, item.sha256]));
    if (![...affectedTargets].every(item => referenceFiles.has(item))) return { ready: false, reason: 'change scope contains a runtime target outside the frozen code reference' };
    for (const [file, hash] of referenceFiles) {
      if (affectedTargets.has(file)) continue;
      if (protectedFiles.get(file) !== hash) return { ready: false, reason: `change scope protected complement is stale for ${file}` };
    }
    if ([...protectedFiles.keys()].some(file => !referenceFiles.has(file) || affectedTargets.has(file))) return { ready: false, reason: 'change scope protection set is not the exact complement of the frozen code reference' };
  } catch { return { ready: false, reason: 'change scope artifacts are unreadable' }; }
  return { ready: true, reason: null };
}
function existingCodeReferenceFreshness(runDir, state) {
  if (state.track !== 'existing') return { ready: true, reason: null };
  const referenceFile = artifactFile(runDir, state.artifacts?.codeReference);
  const skeletonFile = artifactFile(runDir, state.artifacts?.pageSkeleton);
  if (!referenceFile || !skeletonFile) return { ready: false, reason: 'complete code reference and page skeleton are required' };
  try {
    const reference = read(referenceFile), skeleton = read(skeletonFile);
    const projectRoot = path.resolve(reference.projectRoot || path.join(runDir, '..', '..', '..'));
    if (reference.complete !== true || !reference.sourceTreeHash || !Array.isArray(reference.files) || !reference.files.length) return { ready: false, reason: 'code reference is not a complete source snapshot' };
    if (skeleton.sourceTreeHash !== reference.sourceTreeHash || !skeleton.skeletonHash || !Array.isArray(skeleton.nodes) || !skeleton.nodes.length) return { ready: false, reason: 'page skeleton does not bind the complete code reference' };
    for (const item of reference.files) {
      const source = path.resolve(projectRoot, item.path || ''); const copy = path.resolve(runDir, item.copyPath || '');
      if (!source.startsWith(`${projectRoot}${path.sep}`) || !copy.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(source) || !fs.existsSync(copy)) return { ready: false, reason: `scoped source or immutable snapshot is missing: ${item.path || '<unknown>'}` };
      if (sha256File(source) !== item.sha256 || sha256File(copy) !== item.sha256) return { ready: false, reason: `scoped source changed after code reference capture: ${item.path}` };
    }
    return { ready: true, reason: null, reference, skeleton, referenceFile, skeletonFile };
  } catch (error) { return { ready: false, reason: `code reference or page skeleton is unreadable: ${error.message}` }; }
}
function existingBrowserCaptureFreshness(runDir, state, referenceStatus = existingCodeReferenceFreshness(runDir, state)) {
  if (state.track !== 'existing') return { ready: true, reason: null };
  if (!referenceStatus.ready) return { ready: false, reason: referenceStatus.reason };
  const displayFile = path.join(runDir, 'evidence', 'existing-browser-capture.json');
  if (!fs.existsSync(displayFile)) return { ready: false, reason: 'real Existing browser evidence is missing' };
  try {
    const display = read(displayFile), snapshot = display.sourceSnapshot;
    const bound = display.kind === 'existing' && display.status === 'passed' && snapshot
      && snapshot.codeReference === state.artifacts?.codeReference
      && snapshot.codeReferenceSha256 === sha256File(referenceStatus.referenceFile)
      && snapshot.sourceTreeHash === referenceStatus.reference.sourceTreeHash
      && snapshot.pageSkeleton === state.artifacts?.pageSkeleton
      && snapshot.pageSkeletonSha256 === sha256File(referenceStatus.skeletonFile)
      && snapshot.pageSkeletonHash === referenceStatus.skeleton.skeletonHash;
    return bound ? { ready: true, reason: null, displayFile } : { ready: false, reason: 'Existing browser evidence is not bound to the current code reference and page skeleton' };
  } catch (error) { return { ready: false, reason: `Existing browser evidence is unreadable: ${error.message}` }; }
}
function existingVisualBaselineStatus(runDir, state) {
  if (state.track !== 'existing') return { ready: true, reason: null };
  const inventoryFile = artifactFile(runDir, state.artifacts?.projectInventory);
  const referenceFile = artifactFile(runDir, state.artifacts?.codeReference);
  const skeletonFile = artifactFile(runDir, state.artifacts?.pageSkeleton);
  const baselineFile = artifactFile(runDir, state.artifacts?.existingBaseline);
  if (!inventoryFile || !referenceFile || !skeletonFile || !baselineFile) return { ready: false, reason: 'project inventory, complete code reference, page skeleton, and existing baseline are required' };
  try {
    // The aggregate baseline status must report the same first invalid
    // dependency as automaticWorkStep. Otherwise it can label a stale scope
    // as the issue while the executor correctly requires browser recapture.
    const referenceStatus = existingCodeReferenceFreshness(runDir, state);
    if (!referenceStatus.ready) return referenceStatus;
    const browserStatus = existingBrowserCaptureFreshness(runDir, state, referenceStatus);
    if (!browserStatus.ready) return browserStatus;
    const inventory = read(inventoryFile);
    const reference = read(referenceFile);
    const skeleton = read(skeletonFile);
    const baseline = read(baselineFile);
    const displayFile = artifactFile(runDir, baseline.displayEvidence?.path);
    if (!Array.isArray(inventory.entrypoints) || !inventory.entrypoints.length) return { ready: false, reason: 'project inventory has no real entrypoint evidence' };
    if (reference.complete !== true || !Array.isArray(reference.files) || !reference.files.length || !reference.sourceTreeHash) return { ready: false, reason: 'code reference is not a complete source snapshot' };
    const projectRoot = path.resolve(reference.projectRoot || path.join(runDir, '..', '..', '..'));
    const postGate2Targets = (() => {
      if (state.gates?.gate2?.status !== 'passed') return new Set();
      const scopeFile = artifactFile(runDir, state.artifacts?.changeScope);
      const mapFile = artifactFile(runDir, state.artifacts?.implementationMap);
      if (!scopeFile || !mapFile) return null;
      const scope = read(scopeFile), map = read(mapFile);
      if (map.scopeControl?.changeScopeHash !== sha256File(scopeFile) || map.scopeControl?.implementationPolicy !== 'deny-outside-change-closure') return null;
      const allowed = new Set(scope.affected?.runtimeTargets || []);
      if ((map.entries || []).some(entry => (entry.runtimeTarget || []).some(target => !allowed.has(target)))) return null;
      return allowed;
    })();
    if (postGate2Targets === null) return { ready: false, reason: 'post-Gate-2 implementation is not bound to the frozen change closure' };
    for (const item of reference.files) {
      const source = path.resolve(projectRoot, item.path || '');
      if (!source.startsWith(`${projectRoot}${path.sep}`) || !fs.existsSync(source) || !fs.statSync(source).isFile()) return { ready: false, reason: `scoped source is missing or outside the project: ${item.path || '<unknown>'}` };
      if (!postGate2Targets.has(item.path) && sha256File(source) !== item.sha256) return { ready: false, reason: `scoped source changed outside the approved implementation closure: ${item.path}` };
    }
    if (skeleton.sourceTreeHash !== reference.sourceTreeHash || !skeleton.skeletonHash || !Array.isArray(skeleton.nodes) || !skeleton.nodes.length) return { ready: false, reason: 'page skeleton does not bind the complete code reference' };
    if (!displayFile || !baseline.displayEvidence?.hash || !Array.isArray(baseline.displayEvidence?.capturedRoutes) || !baseline.displayEvidence.capturedRoutes.length) return { ready: false, reason: 'real browser display evidence is required' };
    const display = read(displayFile);
    if (display.kind !== 'existing' || display.status !== 'passed' || baseline.displayEvidence.hash !== sha256File(displayFile)) return { ready: false, reason: 'Existing browser display evidence is missing, replaced, or no longer matches the frozen baseline hash' };
    if (baseline.codeReference?.complete !== true || baseline.codeReference.sourceTreeHash !== reference.sourceTreeHash || baseline.codeReference.pageSkeletonHash !== skeleton.skeletonHash) return { ready: false, reason: 'existing baseline is not bound to the current code reference and page skeleton' };
    const scope = changeScopeStatus(runDir, state, reference);
    if (!scope.ready) return scope;
  } catch {
    return { ready: false, reason: 'existing visual baseline artifacts are unreadable' };
  }
  return { ready: true, reason: null };
}
function existingVisualPlanBindingStatus(runDir, state) {
  if (state.track !== 'existing') return { ready: true, reason: null };
  const planFile = artifactFile(runDir, state.artifacts?.visualExecutionPlan);
  const skeletonFile = artifactFile(runDir, state.artifacts?.pageSkeleton);
  if (!planFile || !skeletonFile) return { ready: false, reason: 'confirmed visual plan and frozen page skeleton are required' };
  try {
    const plan = read(planFile), skeleton = read(skeletonFile);
    const selectedVisualNodes = new Set((plan.sourceSelections || []).flatMap(selection => selection.visualNodes || []));
    const mappings = plan.existingPageSkeleton?.mappings || [];
    const mappingByVisualNode = new Map(mappings.map(mapping => [mapping?.visualNode, mapping?.nodeId]));
    const knownNodeIds = new Set((skeleton.nodes || []).map(node => node.id));
    if (!plan.existingPageSkeleton || plan.existingPageSkeleton.sourceTreeHash !== skeleton.sourceTreeHash || plan.existingPageSkeleton.skeletonHash !== skeleton.skeletonHash) return { ready: false, reason: 'visual plan is not bound to the current frozen page skeleton' };
    if (!selectedVisualNodes.size || mappingByVisualNode.size !== selectedVisualNodes.size || [...selectedVisualNodes].some(node => !mappingByVisualNode.has(node)) || [...mappingByVisualNode.entries()].some(([node, nodeId]) => !selectedVisualNodes.has(node) || !knownNodeIds.has(nodeId))) return { ready: false, reason: 'visual plan does not map every selected visual node to a valid frozen page-skeleton node' };
  } catch { return { ready: false, reason: 'visual plan page-skeleton mapping is unreadable' }; }
  return { ready: true, reason: null };
}
function visualPlanSourceBindingStatus(runDir, state) {
  const planFile = artifactFile(runDir, state.artifacts?.visualExecutionPlan);
  if (!planFile) return { ready: false, reason: 'visual execution plan is missing' };
  try {
    const plan = read(planFile);
    const requiredKinds = ['layout', 'component', 'style', 'font', 'content'];
    const byNode = new Map();
    for (const selection of plan.sourceSelections || []) {
      if (!selection?.id || !selection?.kind || !Array.isArray(selection.visualNodes) || !selection.visualNodes.length) return { ready: false, reason: 'visual plan contains an unreadable source selection' };
      if (selection.kind === 'content' && (!selection.parameters?.origin || !Array.isArray(selection.parameters.fields) || !selection.parameters.fields.length || !selection.parameters.implementation)) return { ready: false, reason: `content source ${selection.id} lacks origin, fields, or implementation binding` };
      for (const node of selection.visualNodes) {
        const kinds = byNode.get(node) || new Set();
        kinds.add(selection.kind);
        byNode.set(node, kinds);
      }
    }
    if (!byNode.size) return { ready: false, reason: 'visual plan has no source-bound visual nodes' };
    for (const [node, kinds] of byNode) {
      const missing = requiredKinds.filter(kind => !kinds.has(kind));
      if (missing.length) return { ready: false, reason: `visual node ${node} lacks confirmed ${missing.join(', ')} source selections` };
    }
    return { ready: true, reason: null };
  } catch { return { ready: false, reason: 'visual plan source bindings are unreadable' }; }
}
function canonicalRuntimePackageName(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'apacheecharts' ? 'echarts' : normalized;
}
function normalizeTechnicalIdentityPlan(plan) {
  const normalized = JSON.parse(JSON.stringify(plan));
  normalized.sourceSelections = (normalized.sourceSelections || []).map(selection => selection?.materialization === 'runtime-package'
    ? { ...selection, sourceId: canonicalRuntimePackageName(selection.sourceId) }
    : selection);
  normalized.dependencies = (normalized.dependencies || []).map(dependency => ({ ...dependency, package: canonicalRuntimePackageName(dependency.package) || dependency.package }));
  if (Array.isArray(normalized.selectionAnalysis?.libraryComparisons)) {
    normalized.selectionAnalysis.libraryComparisons = normalized.selectionAnalysis.libraryComparisons.map(comparison => ({
      ...comparison,
      candidates: (comparison.candidates || []).map(candidate => ({ ...candidate, sourceId: canonicalRuntimePackageName(candidate.sourceId) || candidate.sourceId }))
    }));
  }
  return normalized;
}
function latestTechnicalIdentityRepair(state, runDir) {
  if (!runDir || state.gates?.gate1?.status !== 'passed' || state.locks?.visualPlanApproved || !visualPlanReady(state, runDir)) return { ready: false, reason: null };
  const eventFile = path.join(runDir, 'events.ndjson');
  if (!fs.existsSync(eventFile)) return { ready: false, reason: null };
  try {
    const events = fs.readFileSync(eventFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    const resetIndex = events.map(event => event.type).lastIndexOf('visual-reset');
    const reset = resetIndex >= 0 ? events[resetIndex] : null;
    // The invalidation operation owns the archive path; visual-reset is the
    // state transition that follows it. Join the paired receipts by reason
    // instead of assuming the transition duplicates operation metadata.
    const invalidation = reset && events.slice(0, resetIndex + 1).reverse().find(event => event.type === 'visual-intermediates-invalidated' && event.reason === reset.reason && event.archive);
    if (!reset?.reason || !String(reset.reason).startsWith('源完整性修复：') || !invalidation?.archive) return { ready: false, reason: null };
    const priorPlan = artifactFile(runDir, path.join(invalidation.archive, 'visual-execution-plan.json'));
    const currentPlan = artifactFile(runDir, state.artifacts?.visualExecutionPlan);
    if (!priorPlan || !currentPlan || !fs.existsSync(priorPlan) || !fs.existsSync(currentPlan)) return { ready: false, reason: 'technical repair plan artifacts are missing' };
    const priorHash = hashFile(priorPlan), currentHash = hashFile(currentPlan);
    if (JSON.stringify(normalizeTechnicalIdentityPlan(read(priorPlan))) !== JSON.stringify(normalizeTechnicalIdentityPlan(read(currentPlan)))) return { ready: false, reason: 'the rebuilt plan changes more than the canonical runtime package identity' };
    const approvalDir = path.join(runDir, 'approvals');
    const approval = fs.existsSync(approvalDir) && fs.readdirSync(approvalDir).filter(name => name.startsWith('visual-plan-') && name.endsWith('.json')).map(name => ({ relative: path.join('approvals', name), value: read(path.join(approvalDir, name)) })).find(item => item.value.status === 'approved' && item.value.gate === 'visual-plan' && item.value.artifactHashes?.some(artifact => artifact.path === 'visual-execution-plan.json' && artifact.sha256 === priorHash));
    if (!approval) return { ready: false, reason: 'no approval receipt binds the prior visual plan' };
    return { ready: true, reason: reset.reason, archive: invalidation.archive, priorPlan: path.relative(runDir, priorPlan), priorHash, currentPlan: state.artifacts.visualExecutionPlan, currentHash, approval: approval.relative };
  } catch { return { ready: false, reason: 'technical identity repair evidence is unreadable' }; }
}
function runtimeDemoRegistrationReady(state, runDir) {
  if (!runDir || !state.artifacts?.runtimeDemo || !state.artifacts?.designCandidates || !state.artifacts?.visualReference || !state.artifacts?.gate1VisualOutput) return false;
  const required = ['runtimeDemo', 'designCandidates', 'visualReference', 'gate1VisualOutput'];
  return required.every(artifact => {
    const reference = state.artifacts[artifact];
    const file = artifactFile(runDir, reference);
    return file && actionOutputReceiptFor(runDir, file, 'generate_visual');
  });
}
const visualPlanPresentationSections = ['## 1. 目标与范围', '## 2. 信息架构与布局', '## 3. 视觉 Token', '## 4. 组件与交互', '## 5. 图标、图表与素材', '## 6. 动效与可访问性', '## 7. 响应式与状态', '## 8. 真实来源与物化', '## 9. 候选比较与取舍', '## 10. 实施影响与验收'];
const gate1PresentationSections = ['## 1. 需求方向与成功标准', '## 2. 用户、场景与核心任务', '## 3. 轨道判断与正式基线', '## 4. 产品范围、页面与功能边界', '## 5. 信息架构、数据、API 与权限', '## 6. 交付路径、技术约束与不包含项', '## 7. 质量门槛、验证与验收', '## 8. 已知事实、假设、待决项与风险'];
const stitchPresentationSections = ['## 1. 候选范围与入口', '## 2. 已冻结页面与视口', '## 3. 差异与一致性证据', '## 4. 真实来源与锁定内容', '## 5. 风险、限制与可调整项', '## 6. 确认后的实施影响'];
const implementationPresentationSections = ['## 1. 实施目标与范围', '## 2. 正式代码目标', '## 3. 来源物化与依赖', '## 4. 数据、交互与响应式约束', '## 5. 验证、风险与保护边界', '## 6. 确认后的执行链'];
function substantiveSections(content, sections) {
  if (typeof content !== 'string' || /TO_REPLACE|\[object Object\]/.test(content)) return false;
  const hashes = [];
  const complete = sections.every((section, index) => {
    const start = content.indexOf(section);
    if (start < 0) return false;
    const next = index + 1 < sections.length ? content.indexOf(sections[index + 1], start + section.length) : content.length;
    const body = next > start ? content.slice(start + section.length, next).trim() : '';
    const substantive = body.replace(/[#*_`>|\-\s]/g, '');
    if (substantive.length < 40) return false;
    hashes.push(sha256Text(body));
    return true;
  });
  return complete && new Set(hashes).size === sections.length;
}
function containsGateTemplatePlaceholder(value) {
  if (typeof value === 'string') return /(^replace$|\breplace[-\w ]*|<[^>]+>)/i.test(value);
  if (Array.isArray(value)) return value.some(containsGateTemplatePlaceholder);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsGateTemplatePlaceholder));
}
function gate1InputArtifactsReady(state, runDir) {
  try {
    for (const name of ['intentBrief', 'deliveryContract']) {
      const file = artifactFile(runDir, state.artifacts?.[name]);
      if (!file || containsGateTemplatePlaceholder(read(file))) return false;
    }
    return true;
  } catch { return false; }
}
function displayList(values, empty = '无') {
  const items = (Array.isArray(values) ? values : []).map(value => typeof value === 'string' ? value : value?.id || value?.path || value?.name || value?.visualNode || '').filter(Boolean);
  return items.length ? items.map(value => `- ${value}`).join('\n') : `- ${empty}`;
}
function durableConfirmationPresentationReady(state, runDir, checkpoint, sections, sourceNames, action) {
  try {
    const presentationRef = state.artifacts?.[`${checkpoint}Presentation`];
    const manifestRef = state.artifacts?.[`${checkpoint}PresentationManifest`];
    const presentation = artifactFile(runDir, presentationRef), manifestFile = artifactFile(runDir, manifestRef);
    if (!presentation || !manifestFile || !substantiveSections(fs.readFileSync(presentation, 'utf8'), sections) || !actionOutputReceiptFor(runDir, presentation, action) || !actionOutputReceiptFor(runDir, manifestFile, action)) return false;
    const manifest = read(manifestFile);
    if (manifest.schemaVersion !== '1.1' || manifest.status !== 'ready-for-user-confirmation' || manifest.checkpoint !== checkpoint || manifest.presentation !== presentationRef || manifest.presentationSha256 !== sha256File(presentation) || JSON.stringify(manifest.sections) !== JSON.stringify(sections)) return false;
    const body = fs.readFileSync(presentation, 'utf8');
    if (!Array.isArray(manifest.sectionProof) || manifest.sectionProof.length !== sections.length) return false;
    const proofsCurrent = manifest.sectionProof.every((proof, index) => {
      const heading = sections[index], start = body.indexOf(heading), next = index + 1 < sections.length ? body.indexOf(sections[index + 1], start + heading.length) : body.length;
      const sectionBody = start >= 0 && next > start ? body.slice(start + heading.length, next).trim() : '';
      return proof.id === index + 1 && proof.heading === heading && typeof proof.requiredFact === 'string' && proof.substantiveChars >= 40 && proof.sha256 === sha256Text(sectionBody);
    });
    if (!proofsCurrent) return false;
    return sourceNames.every(name => {
      const source = manifest.sources?.[name], currentRef = state.artifacts?.[name], current = artifactFile(runDir, currentRef);
      return current && source?.path === currentRef && source?.sha256 === sha256File(current);
    });
  } catch { return false; }
}
function gate1PresentationReady(state, runDir) {
  const presentation = artifactFile(runDir, state.artifacts?.gate1Presentation);
  const manifestFile = artifactFile(runDir, state.artifacts?.gate1PresentationManifest);
  if (!gate1InputArtifactsReady(state, runDir) || !presentation || !manifestFile || !substantiveSections(fs.readFileSync(presentation, 'utf8'), gate1PresentationSections)) return false;
  try {
    const manifest = read(manifestFile);
    if (manifest.status !== 'ready-for-user-confirmation' || manifest.track !== state.track || manifest.presentationSha256 !== sha256File(presentation)) return false;
    const required = ['intentBrief', 'deliveryContract', 'experienceStrategy'];
    if (deliveryRequiresApiContracts(state, runDir)) required.push('domainModel', 'apiContract');
    if (state.track === 'existing') required.push('projectInventory', 'existingBaseline', 'functionalFreeze', 'changeScope');
    const sourcesCurrent = required.every(name => {
      const source = manifest.sources?.[name], file = artifactFile(runDir, source?.path);
      return file && source.sha256 === sha256File(file) && source.path === state.artifacts?.[name];
    });
    if (!sourcesCurrent) return false;
    if (state.track === 'existing') {
      const scope = read(artifactFile(runDir, state.artifacts.changeScope));
      const result = assertAffectedOnlyPresentation(fs.readFileSync(presentation, 'utf8'), scope, { requireBaselineSection: true });
      if (manifest.presentationScopeValidation?.status !== 'passed' || manifest.presentationScopeValidation?.policy !== result.policy) return false;
    }
    return true;
  } catch { return false; }
}
function visualPlanReady(state, runDir) {
  const plan = artifactFile(runDir, state.artifacts?.visualExecutionPlan);
  const presentation = artifactFile(runDir, state.artifacts?.visualPlanPresentation);
  const manifestFile = artifactFile(runDir, state.artifacts?.visualPlanPresentationManifest);
  if (!plan || !presentation || !manifestFile || !visualPlanSourceBindingStatus(runDir, state).ready || !substantiveSections(fs.readFileSync(presentation, 'utf8'), visualPlanPresentationSections) || !roleStageReady(state, runDir, 'visual')) return false;
  try {
    const manifest = read(manifestFile);
    const scopeCurrent = state.track !== 'existing' || (manifest.changeScope === state.artifacts?.changeScope && artifactFile(runDir, manifest.changeScope) && manifest.changeScopeSha256 === sha256File(artifactFile(runDir, manifest.changeScope)));
    const basicReady = scopeCurrent && manifest.status === 'ready-for-user-confirmation'
      && manifest.visualExecutionPlan === state.artifacts.visualExecutionPlan
      && manifest.visualExecutionPlanSha256 === sha256File(plan)
      && manifest.presentation === state.artifacts.visualPlanPresentation
      && manifest.presentationSha256 === sha256File(presentation);
    if (!basicReady) return false;
    if (state.track === 'existing') {
      const scope = read(artifactFile(runDir, state.artifacts.changeScope));
      const result = assertAffectedOnlyPresentation(fs.readFileSync(presentation, 'utf8'), scope);
      if (manifest.presentationScopeValidation?.status !== 'passed' || manifest.presentationScopeValidation?.policy !== result.policy) return false;
    }
    return true;
  } catch { return false; }
}
function roleStageReady(state, runDir, stage) {
  // Runs created before the role-chain release have no roleChain field. Keep
  // them resumable; every new run gets roleChain.enabled from the template.
  if (!state.roleChain?.enabled) return true;
  const manifestFile = artifactFile(runDir, state.artifacts?.roleAdvisoryManifest);
  if (!manifestFile) return false;
  try {
    const manifest = read(manifestFile); const expectedRegistry = path.join(apexRoot, 'registry', 'agency-role-registry.json');
    const entry = manifest.stages?.[stage];
    if (manifest.schemaVersion !== '1.0' || manifest.status !== 'ready' || !entry || entry.status !== 'ready' || !Array.isArray(entry.selectedRoles) || !entry.selectedRoles.length || entry.selectedRoles.length !== entry.advisories?.length || manifest.registry?.sha256 !== sha256File(expectedRegistry)) return false;
    const summary = artifactFile(runDir, entry.summary);
    if (!summary || !fs.existsSync(summary) || entry.summarySha256 !== sha256File(summary)) return false;
    const operationIndex = fs.existsSync(path.join(runDir, 'operations-index.json')) ? read(path.join(runDir, 'operations-index.json')).receipts || {} : {};
    return entry.advisories.every(item => {
      const file = artifactFile(runDir, item.path);
      const receipt = item.operationReceipt && operationIndex[item.operationReceipt];
      return file && fs.existsSync(file) && sha256File(file) === item.sha256 && entry.selectedRoles.includes(item.roleId) && receipt?.status === 'succeeded' && receipt.script === 'role-advisory.mjs' && receipt.outputFileHashes?.[item.path] === item.sha256;
    });
  } catch { return false; }
}
function deliveryRequiresApiContracts(state, runDir) {
  try {
    const contract = artifactFile(runDir, state.artifacts?.deliveryContract);
    if (!contract) return false;
    return (read(contract).capabilities || []).some(capability => ['backend', 'api-contract'].includes(capability));
  } catch { return false; }
}
function roleStageState(state, runDir, stage) {
  if (!state.roleChain?.enabled) return 'not-required';
  const manifestFile = artifactFile(runDir, state.artifacts?.roleAdvisoryManifest);
  if (!manifestFile) return 'select';
  try {
    const entry = read(manifestFile).stages?.[stage];
    if (!entry?.selectedRoles?.length) return 'select';
    if (!entry.advisories || entry.advisories.length !== entry.selectedRoles.length) return 'record';
    if (!entry.summary || !artifactFile(runDir, entry.summary)) return 'summarize';
    return roleStageReady(state, runDir, stage) ? 'ready' : 'repair';
  } catch { return 'select'; }
}
function visualSandboxSourceReady(state, runDir) {
  const manifestFile = artifactFile(runDir, state.artifacts?.demoSourceManifest);
  const sandboxFile = artifactFile(runDir, state.artifacts?.visualSandboxFiles);
  if (!manifestFile || !sandboxFile) return { ready: false, reason: 'Demo source manifest or sandbox materialization is missing' };
  try {
    const source = read(manifestFile), sandbox = read(sandboxFile);
    if (!Array.isArray(source.sourceBindings) || !source.sourceBindings.length || sandbox.status !== 'materialized' || !sandbox.entrypoint) return { ready: false, reason: 'Demo source bindings or materialization manifest is incomplete' };
    const entry = artifactFile(runDir, sandbox.entrypoint);
    if (!entry || !fs.existsSync(entry)) return { ready: false, reason: 'materialized Demo entrypoint is missing' };
    const renderedSource = fs.readFileSync(entry, 'utf8');
    const missing = source.sourceBindings.map(item => item.sourceSelectionId).filter(id => typeof id !== 'string' || !renderedSource.includes(`data-apex-source-selection=\"${id}\"`) && !renderedSource.includes(`data-apex-source-selection='${id}'`));
    return missing.length ? { ready: false, reason: `materialized Demo does not declare its selected sources: ${missing.join(', ')}` } : { ready: true, reason: null };
  } catch { return { ready: false, reason: 'Demo source or sandbox materialization is unreadable' }; }
}
function formalRuntimeSourceProvenanceStatus(state, runDir) {
  try {
    const manifestFile = artifactFile(runDir, state.artifacts?.visualSourceManifest);
    const planFile = artifactFile(runDir, state.artifacts?.visualExecutionPlan);
    const mapFile = artifactFile(runDir, state.artifacts?.implementationMap);
    const lockFile = artifactFile(runDir, state.artifacts?.runtimeSourceLock);
    if (!manifestFile || !planFile || !mapFile || !lockFile) return { ready: false, enforce: false, needsImplementation: false, reason: 'frozen visual source, implementation-map, or runtime-source-lock artifact is missing' };
    const manifest = read(manifestFile), plan = read(planFile), map = read(mapFile), sourceLock = read(lockFile);
    const projectRoot = sourceLock.projectRoot;
    if (!projectRoot || !fs.existsSync(projectRoot)) return { ready: false, enforce: true, needsImplementation: false, reason: 'formal project root for runtime provenance is unavailable' };
    const selections = new Set((plan.sourceSelections || []).map(selection => selection.id));
    const mapEntries = new Map((map.entries || []).map(entry => [entry.visualNode, entry]));
    const missingCodeMarkers = [];
    for (const binding of manifest.bindings || []) {
      const entry = mapEntries.get(binding.visualNode);
      const selected = (plan.sourceSelections || []).filter(selection => (selection.visualNodes || []).includes(binding.visualNode));
      if (!entry || !binding.sourceMarker || !selected.length || selected.some(selection => !selections.has(selection.id))) return { ready: false, enforce: true, needsImplementation: false, reason: `frozen source binding is incomplete: ${binding.visualNode || '<unknown>'}` };
      const emitted = (entry.runtimeTarget || []).some(target => {
        const file = path.join(projectRoot, target);
        if (!fs.existsSync(file)) return false;
        const source = fs.readFileSync(file, 'utf8');
        return source.includes(`data-apex-source=\"${binding.sourceMarker}\"`) || source.includes(`data-apex-source='${binding.sourceMarker}'`);
      });
      if (!emitted) missingCodeMarkers.push(`${binding.visualNode}:${binding.sourceMarker}`);
    }
    if (missingCodeMarkers.length) return { ready: false, enforce: true, needsImplementation: true, reason: `formal implementation does not emit frozen DOM source markers (${missingCodeMarkers.join(', ')})` };
    const matrixFile = artifactFile(runDir, state.artifacts?.runtimeStateMatrix);
    if (!matrixFile) return { ready: false, enforce: true, needsImplementation: false, reason: 'runtime state matrix has not been captured after formal source markers were emitted' };
    const provenance = read(matrixFile).sourceProvenance;
    if (!provenance?.ready || !Array.isArray(provenance.bindings) || provenance.bindings.length !== (manifest.bindings || []).length) return { ready: false, enforce: true, needsImplementation: false, reason: 'runtime state matrix lacks complete browser-bound formal source provenance' };
    const expected = new Set((plan.sourceSelections || []).map(selection => selection.id));
    if (![...expected].every(id => provenance.sourceSelectionIds?.includes(id))) return { ready: false, enforce: true, needsImplementation: false, reason: 'runtime state matrix does not bind every selected visual source' };
    return { ready: true, enforce: true, needsImplementation: false, reason: null };
  } catch (error) { return { ready: false, enforce: true, needsImplementation: false, reason: `formal runtime provenance is unreadable: ${error.message}` }; }
}
function gate3IndustryEvidenceReady(state, runDir) {
  try {
    const evidence = artifactFile(runDir, state.artifacts?.industryBenchmarkEvidence);
    return Boolean(evidence && fs.existsSync(evidence));
  } catch { return false; }
}
function automaticWorkStep(state, runDir, action) {
  const runFile = name => artifactFile(runDir, state.artifacts?.[name]);
  const step = (id, title, produces, details, followUpAction = action) => {
    const contract = assertWorkflowNode(id, followUpAction, produces);
    return {
      id,
      title,
      produces,
      details,
      authorizationAction: followUpAction,
      mandatory: true,
      userInteraction: 'forbidden',
      afterCompletion: 're-read-router-status-and-execute-the-next-current-step',
      // This makes the next operation executable by contract instead of
      // asking a host to infer it from a status sentence.
      execution: {
        nodeId: id,
        executor: contract.executor,
        inputPolicy: contract.inputPolicy,
        requiredOutputs: contract.outputs,
        completion: contract.completion,
        failurePolicy: contract.failurePolicy,
        stateCommit: contract.stateCommit,
        retry: contract.retry
      }
    };
  };
  if (action === 'collect_existing_baseline') {
    if (!runFile('projectInventory')) return step('capture-project-inventory', '扫描正式项目入口、技术栈与脚本', ['project-inventory.json'], '通过 collect_existing_baseline 调用 project-intake.mjs scan；仅扫描正式项目，排除 .apex 与临时 Demo。');
    const reference = existingCodeReferenceFreshness(runDir, state);
    if (!reference.ready) return step('freeze-code-reference', '从当前目标页生成或刷新 Existing 代码闭包与页面骨架', ['baseline-code-scope-input.json', 'code-reference.json', 'page-skeleton.json'], `内部根据当前需求、真实入口和路由生成范围输入，再调用 existing-code-reference.mjs capture。当前原因：${reference.reason}。不得使用模板 Replace 值，也不得复用已漂移的快照。`);
    const display = existingBrowserCaptureFreshness(runDir, state, reference);
    if (!display.ready) return step('capture-existing-browser-baseline', '采集并绑定当前 Existing 页面截图与 DOM 证据', ['browser-spec.json', 'evidence/existing-browser-capture.json'], `内部基于当前冻结代码引用和页面骨架生成浏览器规格并调用 browser-capture.mjs capture。当前原因：${display.reason}。截图和 DOM 必须绑定同一 sourceTreeHash，且仅作证据，不是用户确认。`);
    const baseline = existingVisualBaselineStatus(runDir, state);
    const scope = changeScopeStatus(runDir, state);
    if (!baseline.ready && scope.ready) return step('freeze-existing-baseline', '从同一版本的真实代码、DOM、截图和样式源冻结 Existing 基线', ['existing-baseline-input.json', 'existing-baseline.json'], `内部生成真实基线输入并调用 baseline-collector.mjs capture；当前校验原因：${baseline.reason}。禁止提交占位符、1970 时间或 Replace 模板。`);
    if (!scope.ready) return step('freeze-change-scope', '刷新本次受影响闭包与未改动保护补集', ['change-scope-input.json', 'change-scope.json'], `内部从最新完整代码引用生成局部变更闭包，再以 record_context 调用 contract-recorder.mjs scope。当前原因：${scope.reason}。`, 'record_context');
    const roles = roleStageState(state, runDir, 'baseline');
    if (roles !== 'ready' && roles !== 'not-required') return step(`baseline-role-${roles}`, '完成 Existing 基线专业角色汇总', ['advisories/baseline/selection.json', 'advisories/baseline/*.json', 'advisories/baseline/role-decision-summary.md'], `通过 collect_existing_baseline 调用 role-advisory.mjs ${roles === 'select' ? 'select' : roles === 'record' ? 'record' : 'summarize'}；已选角色必须形成可验证结论，失败保留受控回执并停止当前 Gate。`);
    return step('continue-gate1-analysis', '转入 Gate 1 需求与交付方案编译', [], 'Existing 基线已有效；重新读取 Router 后必须授权 analyze_requirement 并继续完整 Gate 1 链。', 'analyze_requirement');
  }
  if (action === 'analyze_requirement') {
    if (!runFile('intentBrief') || !runFile('deliveryContract') || !gate1InputArtifactsReady(state, runDir)) return step('derive-intent-and-delivery', '根据用户需求和冻结基线生成需求及交付契约', ['intent-brief.json', 'delivery-contract.json'], '内部从当前任务和 Existing/Greenfield 基线提炼可验证目标、范围、能力与不包含项；初始化模板、Replace 文本或未绑定字段必须在此自动替换，绝不得先展示确认。', 'record_context');
    if (deliveryRequiresApiContracts(state, runDir) && !runFile('domainModel')) return step('record-domain-model', '登记领域模型', ['domain-model-input.json', 'domain-model.json'], '基于当前代码/API 证据生成领域模型输入，再以 record_context 调用 contract-recorder.mjs domain。', 'record_context');
    if (deliveryRequiresApiContracts(state, runDir) && !runFile('apiContract')) return step('record-api-contract', '登记 API 契约', ['api-contract-input.json', 'api-contract.json'], '基于当前代码/API 证据生成 API 契约输入，再以 record_context 调用 contract-recorder.mjs api。', 'record_context');
    if (!runFile('experienceStrategy') || !runFile('experienceQualityEvidence')) return step('evaluate-experience-strategy', '评估体验策略与质量证据', ['experience-strategy.json', 'experience-quality-evidence.json'], '通过 analyze_requirement 调用 experience-evaluator.mjs；质量结论必须绑定当前需求与基线。');
    const roles = roleStageState(state, runDir, 'gate1');
    if (roles !== 'ready' && roles !== 'not-required') return step(`gate1-role-${roles}`, '完成 Gate 1 专业角色汇总', ['advisories/gate1/selection.json', 'advisories/gate1/*.json', 'advisories/gate1/role-decision-summary.md'], `通过 analyze_requirement 调用 role-advisory.mjs ${roles === 'select' ? 'select' : roles === 'record' ? 'record' : 'summarize'}；角色结论必须可验证并写入八节方案的内部专业协作摘要。`);
    // Presence is not readiness. A stale body, manifest, source hash, or
    // affected-scope proof must be rebuilt here rather than falling through
    // with analyze_requirement but no runnable currentStep.
    if (!gate1PresentationReady(state, runDir)) return step('compile-gate1-presentation', '生成或重建完整八节需求与交付方案', ['gate1-presentation.md', 'gate1-presentation-manifest.json'], '通过 analyze_requirement 调用 contract-recorder.mjs gate1-presentation，重新绑定当前需求、冻结基线与范围证明。完成后不得停止，必须登记该方案。');
    if (!gate1PresentationRegistrationReady(runDir, state)) return step('register-gate1-presentation', '登记完整 Gate 1 方案并打开唯一确认点', ['registrations/gate1-presentation-*.json'], '重新授权 analyze_requirement 后调用 Router register-gate1-presentation；随后完整流式展示八节方案，并且只显示“确认需求与交付方案”。');
  }
  if (action === 'plan_visual') {
    // A Gate 1 approval must never leave the host in an automatic state with
    // no concrete instruction.  The visual-plan compiler owns the complete
    // plan, role summary and ten-section presentation as one controlled chain.
    return step('compile-complete-visual-plan', '编译完整视觉方案及十节确认内容', ['visual-execution-plan.json', 'visual-plan-presentation.md', 'visual-plan-presentation-manifest.json'], '基于已确认需求、冻结基线、DESIGN 规范和专业角色结论，以 plan_visual 生成视觉执行方案及完整十节展示内容；完成后重新读取 Router，并且只呈现“确认视觉方案”。不得以一句摘要、文件卡片或“继续”替代该确认。');
  }
  if (action === 'generate_visual') {
    const manifest = artifactFile(runDir, state.artifacts?.demoSourceManifest) || path.join(runDir, 'demo-source-manifest.json');
    if (!fs.existsSync(manifest)) return step('compile-demo-source-manifest', '编译运行时 Demo 源清单', ['demo-source-input.json', 'demo-source-manifest.json'], '从已确认视觉方案、精确来源选择和 Existing 页面骨架自动构建 Demo 源输入；以 generate_visual 调用 demo-source-compiler.mjs compile，再调用 visual-sandbox-writer.mjs materialize。清单缺失是自动链内部步骤，禁止作为用户阻断或确认。');
    if (!runFile('visualSandboxFiles')) return step('materialize-run-local-demo-code', '物化当前 Run 的运行时 Demo 源码', ['visual-sandbox/index.html', 'visual-sandbox-files.json'], '以当前 Demo 源清单调用 visual-sandbox-writer.mjs materialize；只能写入当前 Run 的 visual-sandbox，正式项目代码不得变更。');
    const sandbox = visualSandboxSourceReady(state, runDir);
    if (!sandbox.ready) return step('rebuild-invalid-run-local-demo-source', '重建未绑定真实来源的运行时 Demo 源码', ['demo-source-input.json', 'demo-source-manifest.json', 'visual-sandbox-files.json'], `当前沙盒源码不可作为视觉证据：${sandbox.reason}。内部必须从已确认来源选择重建源码，并为每项选择写入 data-apex-source-selection 标记；禁止将该内部缺陷展示为用户确认、继续按钮或已完成 Demo。`);
    if (!runFile('visualSandboxRuntime')) return step('start-run-local-demo', '启动当前 Run 的运行时 Demo', ['visual-sandbox-runtime.json'], '以 generate_visual 调用 visual-sandbox-runtime.mjs start；启动当前 Run 的 visual-sandbox 静态运行时并登记可访问 URL。不得只报告“沙盒已生成”。');
    const runtimeEvidence = path.join(runDir, 'evidence', 'runtime-browser-capture.json');
    if (!fs.existsSync(runtimeEvidence)) return step('capture-runtime-browser-evidence', '采集 Demo 的真实浏览器与动效证据', ['runtime-browser-spec.json', 'evidence/runtime-browser-capture.json'], '内部从已确认来源、入口和运行时 URL 生成浏览器规格，再调用 browser-capture.mjs capture；必须验证 DOM 中每项已选来源，截图与动效帧均为真实运行时证据。');
    if (!runFile('runtimeVisualBaseline') || !runFile('runtimeDemo') || !runFile('runtimeSourceLock')) return step('freeze-runtime-visual-baseline', '冻结真实运行时视觉基线', ['runtime-visual-baseline-input.json', 'runtime-source-lock.json', 'runtime-visual-baseline.json', 'runtime-demo.json'], '内部根据已确认来源、真实浏览器证据和运行时依赖生成基线输入，并调用 runtime-visual-baseline.mjs compile；不得手填 URL、截图或来源哈希。');
    if (!runFile('visualReference') || !runFile('gate1VisualOutput')) return step('emit-runtime-visual-reference', '从已冻结 Demo 生成视觉引用', ['visual-reference-input.json', 'visual-reference.json', 'gate1-visual-output.json'], '内部仅使用已冻结运行时截图、内容锁、布局锁、图表口径和 Existing 页面骨架映射调用 visual-reference-compiler.mjs emit。');
    if (!runFile('designCandidates')) return step('record-selected-runtime-design-candidate', '登记已确认方案的运行时候选证据', ['design-candidates.json'], '内部将视觉方案中的已选候选与其真实运行时截图、策略哈希和取舍依据写入 design-candidates.json，再调用 experience-evaluator.mjs candidates；禁止生成虚假的替代效果图或要求用户再次确认视觉。');
  }
  if (action === 'verify') {
    const provenance = formalRuntimeSourceProvenanceStatus(state, runDir);
    if (provenance.enforce && !provenance.ready) return step('capture-formal-runtime-source-provenance', '采集正式页面的来源选择与交互证据', ['evidence/runtime-browser-capture.json', 'runtime-state-matrix.json'], `从冻结 Visual Source Manifest 自动生成正式页来源绑定；浏览器必须在每个视口读取 data-apex-source 标记并映射回已确认来源选择。当前原因：${provenance.reason}。这不是确认点，也不得用空来源规格伪造通过。`);
    if (!runFile('runtimeStateMatrix')) return step('capture-runtime-state-matrix', '采集正式页面的视口、状态与关键交互证据', ['runtime-state-matrix.json'], '以 verify 调用 browser-capture.mjs，覆盖桌面、平板、移动端以及加载、空、异常或权限状态；这是自动验证证据，不是用户确认。');
    if (!runFile('verificationPlan')) return step('compile-verification-plan', '根据项目声明脚本编译验证计划', ['verification-plan.json'], '以 verify 调用 verification-planner.mjs generate；只选取项目已声明且安全的检查，不得猜测或虚构测试命令。');
    if (!runFile('verificationBundle')) return step('run-controlled-verification', '执行受控验证并生成证据包', ['verification-bundle.json', 'evidence/proof-*.json'], '以 verify 调用 verification-orchestrator.mjs，汇总运行时状态、构建/测试、结构、视觉、无障碍与实现映射证据；失败必须形成可观察 operation receipt。');
    if (!gate3IndustryEvidenceReady(state, runDir)) return step('compile-evidence-bound-industry-review', '生成并执行证据绑定的行业基准复核', ['industry-benchmark-review.json', 'industry-benchmark-evidence.json'], '基于本次正式页浏览器证据、冻结来源选择与视觉方案，为每项行业准则生成独立观察、评分和证据 ID，再以 verify 调用 industry-benchmark.mjs verify。不得复制视觉方案的计划分数，也不得把该内部复核变成用户确认。');
    const roles = roleStageState(state, runDir, 'verify');
    if (roles !== 'ready' && roles !== 'not-required') return step(`verify-role-${roles}`, '完成验证阶段专业角色汇总', ['advisories/verify/selection.json', 'advisories/verify/*.json', 'advisories/verify/role-decision-summary.md'], `通过 verify 调用 role-advisory.mjs ${roles === 'select' ? 'select' : roles === 'record' ? 'record' : 'summarize'}；仅作为证据综合，不新增用户交互。`);
  }
  if (action === 'register_runtime_demo') return step('register-runtime-demo', '登记已验证的运行时 Demo 并进入交付路线选择', ['registrations/runtime-demo-*.json'], '确认当前 Run 的 Demo、来源锁、运行时基线、视觉引用和候选证据均来自同一 generate_visual 受控回执后，调用 Router register-runtime-demo。登记完成后展示可访问 Demo，并且仅提供“使用 Stitch”与“直接代码”两条路线；这不是确认点。');
  if (action === 'sync_stitch') {
    if (!runFile('stitchFreeze')) return step('create-stitch-candidate', '生成并冻结 Stitch 候选内容', ['stitch-freeze.json'], '以 sync_stitch 提交或恢复当前 Run 对应的 Stitch 作业，并将导出结果冻结为 stitch-freeze.json；不得复用其它 Run 或 Session 的候选。');
    if (!runFile('stitchParityEvidence')) return step('verify-stitch-candidate-parity', '采集 Stitch 候选与运行时 Demo 的严格一致性证据', ['stitch-parity-evidence.json'], '以 sync_stitch 对当前冻结候选执行结构与视觉一致性校验；完成后重新读取 Router，并完整展示候选、差异、来源、风险与调整项，再仅呈现“确认 Stitch 内容”。');
    if (!durableConfirmationPresentationReady(state, runDir, 'stitch', stitchPresentationSections, ['stitchFreeze', 'stitchParityEvidence'], 'sync_stitch')) return step('compile-stitch-confirmation-presentation', '编译来源绑定的 Stitch 确认正文', ['stitch-presentation.md', 'stitch-presentation-manifest.json'], '以 sync_stitch 调用 confirmation-presentation.mjs compile <run-dir> stitch。正文必须绑定当前候选、冻结页面、来源锁与严格一致性证据；不得以文件清单、短摘要或临时聊天拼接替代。');
    return step('publish-complete-stitch-presentation', '整理完整 Stitch 候选确认内容', ['stitch-freeze.json', 'stitch-parity-evidence.json'], '当前候选与一致性证据已齐备；重新读取 Router 以打开唯一的 Stitch 确认点。不得以进度文字或通用“继续”结束。');
  }
  if (action === 'compile_visual_bundle') {
    if (!runFile('siteContract')) return step('derive-site-contract', '从已锁定视觉方案生成站点实施契约', ['site-contract.json'], '以 compile_visual_bundle 从已确认视觉方案、来源锁和当前项目边界生成站点契约；不得扩大到未受影响页面。');
    const roles = roleStageState(state, runDir, 'implementation');
    if (roles !== 'ready' && roles !== 'not-required') return step(`implementation-role-${roles}`, '完成实施阶段专业角色汇总', ['advisories/implementation/selection.json', 'advisories/implementation/*.json', 'advisories/implementation/role-decision-summary.md'], `以 compile_visual_bundle 调用 role-advisory.mjs ${roles === 'select' ? 'select' : roles === 'record' ? 'record' : 'summarize'}，将前端、设计、可访问性和验证约束汇总进实施冻结；不得新增用户交互。`);
    if (!runFile('visualBundle') || !runFile('implementationMap')) return step('compile-visual-bundle-and-implementation-map', '编译视觉实施包与受影响代码映射', ['visual-bundle.json', 'implementation-map.json'], '以 compile_visual_bundle 物化已选依赖并编译实施包及 Implementation Map；只能包含已确认的页面、组件、来源和运行时目标。完成后完整展示实施范围、文件、依赖、验证、风险与回滚边界，并且只呈现“确认实施冻结”。');
    if (!durableConfirmationPresentationReady(state, runDir, 'implementation', implementationPresentationSections, ['visualBundle', 'implementationMap'], 'compile_visual_bundle')) return step('compile-implementation-confirmation-presentation', '编译来源绑定的实施冻结确认正文', ['implementation-presentation.md', 'implementation-presentation-manifest.json'], '以 compile_visual_bundle 调用 confirmation-presentation.mjs compile <run-dir> implementation。正文必须绑定当前 Visual Bundle、Implementation Map、正式代码目标与验收边界；不得以文件清单、短摘要或临时聊天拼接替代。');
    return step('publish-complete-implementation-freeze', '整理完整实施冻结确认内容', ['visual-bundle.json', 'implementation-map.json'], '实施包与代码映射已齐备；重新读取 Router 以打开唯一的实施冻结确认点。不得以文件清单或“继续”代替完整确认内容。');
  }
  if (action === 'open_gate2') return step('run-pre-gate2-and-open-implementation', '执行 Gate 2 机器校验并开启正式实施权限', ['Gate 2 机器校验结果'], '先执行 pre-gate2 完整契约校验；通过后立即调用 open-gate2 转换。该转换不是用户确认，也不能以“已授权”或文件卡片代替实际转换。');
  if (action === 'implement') {
    const provenance = formalRuntimeSourceProvenanceStatus(state, runDir);
    if (provenance.needsImplementation) return step('emit-formal-runtime-source-markers', '把冻结来源标记写入正式受影响节点', ['正式项目受影响实现文件', 'evidence/implementation-audit.json'], `仅在已批准的 Implementation Map 目标和选择器上写入精确 data-apex-source 标记，随后重新采集浏览器证据。当前原因：${provenance.reason}。不得把标记写在注释、配置或 Run 工件中，也不得修改未受影响页面。`, 'implement');
    return step('apply-approved-formal-implementation', '按已批准实施映射落地正式代码', ['page-delta.json', '正式页运行时证据'], '获取当前 Run 的项目级 mutation lease 后，仅物化已锁定依赖，并在 Implementation Map 允许的正式项目文件中完成实现、重启和运行时验证。不得把“已授权”或沙盒 Demo 当作代码已落地。', 'implement');
  }
  if (action === 'open_gate3') return step('validate-gate3-delivery-evidence', '核验 Gate 3 交付证据并登记最终交付', ['industry-benchmark-evidence.json', 'Gate 3 delivery evidence'], '以 open_gate3 重新运行 Gate 3 机器校验；只有通过才登记最终交付。失败仅报告受控验证实际缺口，不得返回泛化的继续提示。');
  if (action === 'pass_proof') return step('pass-controlled-proof-gate', '登记受控验证生成的 Proof Gate 证据', ['evidence/proof-*.json', 'Proof Gate passed evidence'], '仅使用本次 verify 受控操作回执绑定的证明文件执行 pass-proof 转换；通过后重新读取 Router，若仍缺行业基准复核则自动回到 verify，不得向用户追加确认。');
  if (action === 'repair_visual_source_identity') return step('restore-approved-visual-plan-after-package-identity-repair', '恢复已批准视觉方案并继续运行时 Demo 链路', ['repairs/visual-source-identity-*.json'], '仅当已批准方案与重建方案逐字段一致，且差异严格限于受控的运行时包名标准化（Apache ECharts -> echarts）时，才恢复原确认。不得重展示视觉方案、不得要求用户重新确认。');
  if (action === 'revoke_visual') return step('reopen-incomplete-existing-visual-plan', '撤销来源或页面骨架不完整的视觉方案并重建', ['visual-execution-plan.json', 'visual-plan-presentation.md'], '当前视觉方案缺少每个可视节点必需的已确认来源绑定，或 Existing 页面骨架映射不完整；通过受控 revoke-stitch 转换撤销无效方案，随后自动重编译完整十节方案并仅呈现“确认视觉方案”。这是内部契约修复，不是用户确认或 Demo 失败。');
  return null;
}
function gate1PrerequisitesReady(state, runDir) {
  if (!runDir) return false;
  const required = ['intentBrief', 'deliveryContract', 'experienceStrategy', 'experienceQualityEvidence'];
  if (state.track === 'existing') {
    if (!existingVisualBaselineStatus(runDir, state).ready) return false;
    required.push('projectInventory', 'existingBaseline', 'codeReference', 'pageSkeleton', 'functionalFreeze', 'changeScope');
  }
  try {
    if (required.some(name => !artifactFile(runDir, state.artifacts?.[name]))) return false;
    if (!roleStageReady(state, runDir, 'gate1') || (state.track === 'existing' && !roleStageReady(state, runDir, 'baseline'))) return false;
    return !deliveryRequiresApiContracts(state, runDir) || ['domainModel', 'apiContract'].every(name => artifactFile(runDir, state.artifacts?.[name]));
  } catch { return false; }
}
function checkpointReady(state, runDir, checkpoint) {
  if (!runDir) return false;
  if (checkpoint === 'gate1') {
    // This controls only whether a completed proposal may be shown.  The
    // approval path below still runs pre-gate1, including full source hashes.
    const required = ['gate1Presentation', 'gate1PresentationManifest'];
    try {
      if (!gate1PrerequisitesReady(state, runDir) || required.some(name => !artifactFile(runDir, state.artifacts?.[name])) || !gate1PresentationReady(state, runDir) || !gate1PresentationRegistrationReady(runDir, state)) return false;
      return true;
    } catch { return false; }
  }
  if (checkpoint === 'visual-plan') return visualPlanReady(state, runDir);
  if (checkpoint === 'stitch') return Boolean(state.deliveryRoute === 'stitch' && state.artifacts?.stitchFreeze && state.artifacts?.stitchParityEvidence && durableConfirmationPresentationReady(state, runDir, 'stitch', stitchPresentationSections, ['stitchFreeze', 'stitchParityEvidence'], 'sync_stitch'));
  if (checkpoint === 'implementation') return Boolean(roleStageReady(state, runDir, 'implementation') && (state.locks?.stitchCurrent || state.locks?.stitchSkipped) && state.locks?.stitchApproved && state.artifacts?.visualBundle && state.artifacts?.implementationMap && durableConfirmationPresentationReady(state, runDir, 'implementation', implementationPresentationSections, ['visualBundle', 'implementationMap'], 'compile_visual_bundle'));
  return false;
}
function allowedActions(state, runDir = null) {
  if (state.lifecycle === 'cancelled') return ['inspect_run', 'recover'];
  if (state.lifecycle === 'handed-off') return ['inspect_run', 'recover', 'resume_handoff'];
  const gate1 = state.gates?.gate1?.status === 'passed';
  const gate2 = state.gates?.gate2?.status === 'passed' && state.locks?.implementationAllowed === true;
  const gate3 = state.gates?.gate3?.status === 'passed';
  const actions = new Set(['inspect_run', 'record_context', 'recover']);
  if (!gate1) {
    actions.add('analyze_requirement');
    // Gate 1 production is governed by analyze_requirement.  Do not expose a
    // synthetic plan_product action: it has no controlled executor and used
    // to leave Greenfield runs in a no-input state with no runnable next step.
    if (state.track === 'existing') actions.add('collect_existing_baseline');
  }
  const existingBaseline = runDir ? existingVisualBaselineStatus(runDir, state) : { ready: state.track !== 'existing', reason: 'run directory is required to verify Existing baseline' };
  if (gate1 && !gate2 && !existingBaseline.ready) {
    actions.add('collect_existing_baseline');
    actions.add('revoke_visual');
  } else if (gate1 && !gate2) {
    const technicalRepair = latestTechnicalIdentityRepair(state, runDir);
    if (technicalRepair.ready) {
      actions.add('repair_visual_source_identity');
      return [...actions].sort();
    }
    const visualBinding = runDir ? existingVisualPlanBindingStatus(runDir, state) : { ready: state.track !== 'existing', reason: 'run directory is required to verify Existing visual-plan mapping' };
    const visualSources = runDir ? visualPlanSourceBindingStatus(runDir, state) : { ready: false, reason: 'run directory is required to verify visual-plan source bindings' };
    if (state.locks?.visualPlanApproved && (!visualBinding.ready || !visualSources.ready)) {
      actions.add('revoke_visual');
      return [...actions].sort();
    }
    if (!state.locks?.visualPlanApproved) {
      ['plan_visual', 'revoke_visual'].forEach(action => actions.add(action));
      if (checkpointReady(state, runDir, 'visual-plan')) actions.add('request_visual_plan_approval');
    }
    // The visual plan is the only visual user confirmation.  Until the real
    // effect artifacts are registered, generation is the sole forward action;
    // compiling a bundle here would let a host bypass the runtime image.
    else if (!state.locks?.effectApproved) {
      ['generate_visual', 'revoke_visual'].forEach(action => actions.add(action));
      if (state.pendingDeliveryRoute === 'direct-code') actions.add('select_delivery_route');
      if (runtimeDemoRegistrationReady(state, runDir)) actions.add('register_runtime_demo');
    }
    else if (!state.locks?.stitchApproved && !state.locks?.stitchSkipped && !state.deliveryRoute) ['select_delivery_route', 'revoke_visual'].forEach(action => actions.add(action));
    else if (!state.locks?.stitchApproved && !state.locks?.stitchSkipped && state.deliveryRoute === 'stitch') {
      ['sync_stitch', 'observe_stitch', 'validate_stitch', 'revoke_visual'].forEach(action => actions.add(action));
      if (checkpointReady(state, runDir, 'stitch')) actions.add('request_stitch_approval');
    } else if (!state.locks?.stitchCurrent && !state.locks?.stitchSkipped) ['sync_stitch', 'revoke_visual'].forEach(action => actions.add(action));
    else if (!state.locks?.implementationApproved) {
      ['compile_visual_bundle', 'revoke_visual'].forEach(action => actions.add(action));
      if (checkpointReady(state, runDir, 'implementation')) actions.add('request_implementation_approval');
    }
    else ['compile_visual_bundle', 'open_gate2', 'revoke_visual'].forEach(action => actions.add(action));
  }
  // Do not expose downstream Gate 2 operations before their evidence exists.
  // Otherwise a host can receive an authorization for a command that must
  // fail, and mistake that validation failure for a user-facing blocker.
  if (gate2 && !gate3) {
    actions.add('revoke_visual');
    const provenance = formalRuntimeSourceProvenanceStatus(state, runDir);
    if (!state.artifacts?.pageDelta || provenance.needsImplementation) ['prepare_workspace', 'implement'].forEach(action => actions.add(action));
    else if ((provenance.enforce && !provenance.ready) || !state.artifacts?.verificationBundle) actions.add('verify');
    else if (!['passed', 'not-required'].includes(state.gates?.proof?.status)) actions.add('pass_proof');
    else if (!gate3IndustryEvidenceReady(state, runDir)) actions.add('verify');
    else actions.add('open_gate3');
  }
  if (gate3) actions.add('read_delivery_evidence');
  for (const checkpoint of ['gate1', 'visual-plan', 'stitch', 'implementation']) {
    if (checkpointIsAwaitingDecision(state, checkpoint) && checkpointReady(state, runDir, checkpoint)) actions.add('skip_checkpoint');
  }
  return [...actions].sort();
}
function nextRequiredAction(state, runDir = null) {
  if (state.lifecycle === 'active' && state.gates?.gate1?.status !== 'passed') {
    const existingBaseline = runDir ? existingVisualBaselineStatus(runDir, state) : { ready: state.track !== 'existing' };
    if (state.track === 'existing' && !existingBaseline.ready) return 'collect_existing_baseline';
    // Baseline-role receipts are part of the Existing evidence package.  A
    // stale or missing one has a concrete repair step in the baseline chain;
    // it must not leak into Gate 1 as an analyze_requirement action with no
    // executable substep.
    const baselineRoles = state.track === 'existing' ? roleStageState(state, runDir, 'baseline') : 'not-required';
    if (baselineRoles !== 'ready' && baselineRoles !== 'not-required') return 'collect_existing_baseline';
    if (!checkpointReady(state, runDir, 'gate1')) return 'analyze_requirement';
  }
  // Existing evidence remains a hard dependency until Gate 2 opens.  A
  // visual-plan revocation can make the protected change-scope complement
  // stale *after* Gate 1 has passed.  In that state allowedActions correctly
  // exposes collect_existing_baseline, but the former next-action branch fell
  // through to plan_visual.  That produced an impossible directive: the host
  // repeatedly requested authorization for plan_visual and Router repeatedly
  // refused it.  Keep the executable next action and allowedActions aligned.
  if (state.lifecycle === 'active' && state.track === 'existing' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed') {
    const existingBaseline = runDir ? existingVisualBaselineStatus(runDir, state) : { ready: false };
    if (!existingBaseline.ready) return 'collect_existing_baseline';
  }
  if (state.lifecycle === 'active' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed' && !state.locks?.visualPlanApproved && !visualPlanReady(state, runDir)) return 'plan_visual';
  if (state.lifecycle === 'active' && latestTechnicalIdentityRepair(state, runDir).ready) return 'repair_visual_source_identity';
  if (state.lifecycle === 'active' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed' && state.locks?.visualPlanApproved && (!existingVisualPlanBindingStatus(runDir, state).ready || !visualPlanSourceBindingStatus(runDir, state).ready)) return 'revoke_visual';
  // A confirmed visual plan is an execution boundary, not another chat prompt.
  // The host must obtain authorization and run the existing generation chain
  // before it can expose the Stitch/direct-code route decision.
  if (state.lifecycle === 'active' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed' && state.locks?.visualPlanApproved && !state.locks?.effectApproved) return runtimeDemoRegistrationReady(state, runDir) ? 'register_runtime_demo' : 'generate_visual';
  // Choosing a delivery route is the last user decision before the next
  // checkpoint.  The work that makes that checkpoint reviewable must not turn
  // into a silent no-input state: run it automatically and only then expose
  // the named Stitch or implementation-freeze confirmation.
  if (state.lifecycle === 'active' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed' && state.locks?.effectApproved) {
    if (state.deliveryRoute === 'stitch' && !checkpointReady(state, runDir, 'stitch')) return 'sync_stitch';
    if ((state.locks?.stitchSkipped || state.locks?.stitchApproved) && !checkpointReady(state, runDir, 'implementation')) return 'compile_visual_bundle';
    if (state.locks?.implementationApproved && state.gates?.gate2?.status !== 'passed') return 'open_gate2';
  }
  // Implementation approval is not an endpoint.  Once Gate 2 is open, keep
  // executing the controlled implementation and evidence chain to Gate 3;
  // otherwise a successful machine gate leaves the user in another silent
  // no-input state with no delivery action.
  if (state.lifecycle === 'active' && state.gates?.gate2?.status === 'passed' && state.gates?.gate3?.status !== 'passed') {
    const provenance = formalRuntimeSourceProvenanceStatus(state, runDir);
    if (!state.artifacts?.pageDelta) return 'implement';
    if (provenance.needsImplementation) return 'implement';
    if (provenance.enforce && !provenance.ready) return 'verify';
    if (!state.artifacts?.verificationBundle || !roleStageReady(state, runDir, 'verify')) return 'verify';
    if (!['passed', 'not-required'].includes(state.gates?.proof?.status)) return 'pass_proof';
    if (!gate3IndustryEvidenceReady(state, runDir)) return 'verify';
    return 'open_gate3';
  }
  return null;
}
function responsePolicy(state, runDir = null) {
  return nextRequiredAction(state, runDir) ? 'complete-required-action-before-user-response' : 'decision-only-user-response';
}
function executionDirective(state, runDir = null) {
  const action = nextRequiredAction(state, runDir);
  if (!['analyze_requirement', 'collect_existing_baseline', 'plan_visual', 'generate_visual', 'revoke_visual', 'repair_visual_source_identity', 'register_runtime_demo', 'sync_stitch', 'compile_visual_bundle', 'open_gate2', 'implement', 'verify', 'pass_proof', 'open_gate3'].includes(action)) return null;
  const requiresApiContracts = action === 'analyze_requirement' && deliveryRequiresApiContracts(state, runDir);
  // This is deliberately structured rather than prose.  A host must not turn
  // a confirmed visual plan into a generic chat "continue" affordance.
  const currentStep = automaticWorkStep(state, runDir, action);
  // An automatic action without a next operation is a Router programming
  // error, not a user-visible waiting state.  Fail the contract immediately
  // during development instead of emitting a terminal-forbidden response that
  // leaves the host with nothing runnable.
  if (!currentStep) throw new Error(`APEX Router configuration error: automatic action ${action} has no concrete currentStep`);
  // A receipt is authoritative: a failed attempt must become one explicit,
  // inspectable blocking result. It must never be mistaken for unfinished
  // work and repeatedly re-injected by the host Stop Hook.
  const latestFailure = latestBlockingOperation(runDir, action);
  // Source drift is not a user-facing failure when the Router can prove the
  // next safe operation: rebuild the immutable code reference first, then
  // recapture browser evidence and baseline from that same snapshot.  This is
  // an explicit consistency transition, not a blind retry of the failed
  // baseline collector. Likewise, an old whole-directory Demo boundary
  // receipt is deterministically superseded by the current frozen-source
  // checker; it contains no protected-file evidence and must be retried once
  // with a new authorization. Any current, file-specific failure remains
  // terminal and inspectable.
  const automaticallyRemediableFailure = (latestFailure?.category === 'source-drift' && currentStep.id === 'freeze-code-reference') || latestFailure?.category === 'obsolete-boundary-snapshot';
  const blockingOperation = automaticallyRemediableFailure ? null : latestFailure;
  return {
    kind: 'must-complete-before-user-response',
    action,
    automatic: true,
    userInput: 'forbidden-until-action-settles',
    terminalUserResponseAllowed: false,
    progressUpdates: 'commentary-only-never-end-the-turn',
    incompleteBehavior: 'continue-the-authorized-chain-without-user-interaction',
    onlyTerminalFailure: 'single-blocking-report-with-observable-error-and-missing-artifacts',
    blockingPolicy: {
      beforeAttempt: 'forbidden',
      rule: `missing ${action === 'analyze_requirement' ? 'complete Gate 1 direction and delivery artifacts' : action === 'collect_existing_baseline' ? 'Existing formal-code and browser baseline' : action === 'plan_visual' ? 'visual-execution-plan.json' : action === 'generate_visual' ? 'runtime Demo' : action === 'register_runtime_demo' ? 'runtime Demo registration' : action === 'sync_stitch' ? 'Stitch candidate and parity evidence' : action === 'compile_visual_bundle' ? 'Visual Bundle and Implementation Map' : action === 'open_gate2' ? 'Gate 2 machine validation' : action === 'implement' ? 'controlled production implementation delta' : action === 'verify' ? 'verification bundle' : action === 'pass_proof' ? 'controlled proof evidence' : 'Gate 3 machine validation'} is an actionable automatic-work condition, not a blocking condition`,
      requiredBeforeBlocking: ['authorize-current-action', 'execute-required-chain', 'capture-operation-receipt'],
      allowedAfterAttempt: 'only report the observed action error together with its failed operation receipt and missing artifacts'
    },
    actionAuthorization: action === 'analyze_requirement'
      ? { action, required: true, runner: 'apex-action.mjs + apex-router.mjs', command: 'register-gate1-presentation', mode: 'run-complete-gate1-chain-then-register-before-presentation', ...(requiresApiContracts ? { internalSubActions: [{ action: 'record_context', script: 'contract-recorder.mjs', command: 'domain', requiredArtifact: 'domain-model.json' }, { action: 'record_context', script: 'contract-recorder.mjs', command: 'api', requiredArtifact: 'api-contract.json' }] } : {}) }
      : action === 'register_runtime_demo'
      ? { action, required: true, runner: 'apex-router.mjs', command: 'register-runtime-demo', mode: 'run-after-router-authorize' }
      : ['open_gate2', 'pass_proof', 'open_gate3', 'revoke_visual', 'repair_visual_source_identity'].includes(action)
        ? { action, required: true, runner: 'apex-router.mjs', command: `transition ${action === 'revoke_visual' ? 'revoke-stitch' : action === 'repair_visual_source_identity' ? 'repair-visual-source-identity' : action.replaceAll('_', '-')}`, mode: 'run-after-router-authorize' }
        : action === 'implement'
          ? { action, required: true, leaseRequired: true, leaseMode: 'acquire-before-router-authorize', runner: 'host-controlled-implementation', mode: 'lease-then-router-authorize-then-apply-approved-implementation-map', scope: 'formal-project-files-only-within-approved-implementation-map', requiredPostconditions: ['page-delta.json', 'selected-dependency-materialization-record', 'no-out-of-scope-project-changes'] }
          : { action, required: true, runner: 'apex-action.mjs', mode: 'run-after-router-authorize' },
    currentStep,
    blockingOperation,
    continuationProtocol: {
      reauthorizeAfterEveryStateWrite: true,
      nextStepSource: 'executionDirective.currentStep',
      terminalRule: 'do not end on a completed substep; repeat Router status and execute currentStep until Router exposes an exact confirmation or a receipt-backed failure',
      forbiddenTerminalStates: ['baseline-captured-only', 'code-reference-captured-only', 'browser-captured-only', 'stage-summary-only']
    },
    streamingProgress: {
      enabled: true,
      mode: 'commentary-step-progress',
      start: `正在执行 APEX 自动步骤：${action}。`,
      updateAfterEachRequiredStep: true,
      format: '已完成自动步骤 {current}/{total}：{step}；正在继续下一项。',
      userInput: 'forbidden-until-action-settles',
      terminalRule: 'progress is commentary only; continue the chain until a complete presentation, route decision, or observed blocking report is available',
      forbiddenDuringProgress: ['confirmation-button', 'generic-continue', 'file-card-only-terminal-response']
    },
    afterSuccess: action === 'collect_existing_baseline' ? 'analyze_requirement_and_present_complete_gate1_confirmation' : action === 'analyze_requirement' ? 'present_complete_gate1_direction_and_delivery_confirmation' : action === 'plan_visual' ? 'present_complete_visual_plan_and_request_visual_plan_confirmation' : action === 'revoke_visual' ? 'rebuild_complete_visual_plan_with_page_skeleton_mapping' : action === 'repair_visual_source_identity' ? 'continue_existing_visual_plan_without_reconfirmation' : action === 'generate_visual' ? 'register_runtime_demo' : action === 'register_runtime_demo' ? 'present_runtime_demo_and_request_delivery_route' : action === 'sync_stitch' ? 'present_complete_stitch_candidate_and_request_stitch_confirmation' : action === 'compile_visual_bundle' ? 'present_complete_implementation_freeze_and_request_implementation_confirmation' : action === 'open_gate2' ? 'continue_to_controlled_implementation' : action === 'implement' ? 'run_full_verification_chain' : action === 'verify' ? 'pass_proof_with_controlled_evidence' : action === 'pass_proof' ? 'open_gate3' : 'present_delivery_evidence',
    requiredChain: action === 'collect_existing_baseline'
      ? ['scan_formal_project_inventory', 'freeze_code_reference_and_page_skeleton', 'capture_real_browser_baseline', 'bind_existing_baseline', 'select_and_run_baseline_role_advisories', 'analyze_requirement_and_emit_complete_gate1_presentation']
      : action === 'analyze_requirement'
      ? ['derive_requirement_and_delivery_contract', ...(requiresApiContracts ? ['derive_and_record_domain_model_from_current_scope', 'derive_and_record_api_contract_from_current_scope'] : []), 'evaluate_experience_strategy', 'select_and_run_gate1_role_advisories', 'synthesize_role_decisions_into_gate1_presentation', 'emit_complete_8_section_gate1_presentation', 'register_complete_gate1_presentation', 'render_chat_orientation_and_full_eight_section_plan', 'request_named_gate1_confirmation']
      : action === 'plan_visual'
      ? ['analyze_requirement_and_platform_constraints', 'select_and_run_visual_role_advisories', 'compare_real_layout_style_component_icon_chart_motion_sources', 'synthesize_role_decisions_into_visual_presentation', 'emit_visual_execution_plan', 'emit_10_section_visual_plan_presentation']
      : action === 'revoke_visual'
      ? ['revoke_incomplete_visual_plan', 'rebuild_visual_plan_with_exact_source_bindings_and_existing_page_skeleton_mapping', 'render_complete_visual_plan_and_request_visual_plan_confirmation']
      : action === 'repair_visual_source_identity'
      ? ['verify-only-canonical-runtime-package-identity-changed', 'restore-prior-visual-plan-approval', 'continue-runtime-demo-chain-without-user-confirmation']
      : action === 'generate_visual'
      ? ['compile_demo_source_manifest', 'materialize_run_local_demo_code', 'start_run_local_demo', 'capture_browser_and_motion_evidence', 'freeze_runtime_visual_baseline', 'emit_visual_reference', 'register_runtime_demo']
      : action === 'register_runtime_demo'
      ? ['register_runtime_demo', 'present_runtime_demo_and_request_delivery_route']
      : action === 'sync_stitch'
      ? ['submit_or_resume_same_stitch_job', 'capture_strict_export_and_parity_evidence', 'compile_receipt_bound_stitch_confirmation_body', 'present_complete_stitch_candidate_and_request_stitch_confirmation']
      : action === 'compile_visual_bundle'
      ? ['derive_and_record_site_contract_from_locked_visual_plan', 'select_and_run_implementation_role_advisories', 'compile_visual_bundle', 'materialize_only_selected_sources', 'emit_implementation_map', 'compile_receipt_bound_implementation_confirmation_body', 'present_complete_implementation_freeze_and_request_implementation_confirmation']
      : action === 'open_gate2'
      ? ['run_pre_gate2_machine_validation', 'open_gate2', 'continue_to_controlled_implementation']
      : action === 'implement'
      ? ['acquire_project_mutation_lease', 'materialize_selected_dependencies', 'apply_approved_implementation_map', 'emit_page_delta']
      : action === 'verify'
      ? ['capture_runtime_state_matrix', 'run_declared_project_checks', 'emit_verification_bundle_and_proof_evidence', 'select_and_run_verification_role_advisories', 'synthesize_evidence_and_reality_check', 'compile_evidence_bound_industry_review', 'verify_industry_benchmark_evidence']
      : action === 'pass_proof'
      ? ['pass_proof', 'open_gate3']
      : ['open_gate3', 'present_delivery_evidence'],
    completionEvidence: action === 'collect_existing_baseline' ? ['project-inventory.json', 'code-reference.json', 'page-skeleton.json', 'existing-baseline.json', 'gate1-presentation.md', 'registrations/gate1-presentation-*.json'] : action === 'analyze_requirement' ? ['intent-brief.json', 'delivery-contract.json', ...(requiresApiContracts ? ['domain-model.json', 'api-contract.json'] : []), 'experience-strategy.json', 'gate1-presentation.md', 'registrations/gate1-presentation-*.json'] : action === 'plan_visual' || action === 'revoke_visual' ? ['visual-execution-plan.json', 'visual-plan-presentation.md'] : action === 'generate_visual' ? ['runtime-demo.json', 'runtime-source-lock.json', 'runtime-visual-baseline.json', 'visual-reference.json', 'gate1-visual-output.json', 'design-candidates.json'] : action === 'register_runtime_demo' ? ['registrations/runtime-demo-*.json'] : action === 'sync_stitch' ? ['stitch-freeze.json', 'stitch-parity-evidence.json', 'stitch-presentation.md', 'stitch-presentation-manifest.json'] : action === 'compile_visual_bundle' ? ['site-contract.json', 'visual-bundle.json', 'implementation-map.json', 'implementation-presentation.md', 'implementation-presentation-manifest.json'] : action === 'open_gate2' ? ['Gate 2 passed machine evidence'] : action === 'implement' ? ['page-delta.json'] : action === 'verify' ? ['verification-bundle.json', 'proof evidence', 'industry-benchmark-review.json', 'industry-benchmark-evidence.json'] : action === 'pass_proof' ? ['passed proof evidence'] : ['Gate 3 delivery evidence'],
    userVisibleResults: action === 'collect_existing_baseline' || action === 'analyze_requirement' ? ['full-gate1-presentation-and-confirmation', 'blocking-report'] : action === 'plan_visual' ? ['full-visual-plan-presentation-and-confirmation', 'blocking-report'] : action === 'generate_visual' || action === 'register_runtime_demo' ? ['runtime-demo', 'blocking-report'] : action === 'sync_stitch' ? ['full-stitch-presentation-and-confirmation', 'blocking-report'] : action === 'compile_visual_bundle' ? ['full-implementation-freeze-presentation-and-confirmation', 'blocking-report'] : action === 'open_gate3' ? ['delivery-evidence', 'blocking-report'] : ['automatic-chain-progress', 'blocking-report'],
    forbiddenTerminalResults: ['stage-status-only', 'generation-progress-only', 'artifact-file-list-only', ...(action === 'plan_visual' ? ['one-sentence-plan-summary'] : [])],
    prohibitedUserPrompts: ['continue', 'confirm-runtime-demo', 'poll-for-progress', ...(action === 'plan_visual' ? ['generate-visual-plan', 'report-missing-visual-execution-plan-before-attempt'] : []), ...(action === 'sync_stitch' ? ['confirm-stitch-before-candidate-is-ready'] : []), ...(action === 'compile_visual_bundle' ? ['confirm-implementation-before-freeze-is-ready'] : [])]
  };
}
function terminalResponseContract(state, runDir = null) {
  const automatic = executionDirective(state, runDir);
  if (automatic?.blockingOperation) return {
    allowed: true,
    allowedKinds: ['blocking-report'],
    exactLabels: [],
    recheckRouterBeforeEndingTurn: true,
    requiredOperationReceipt: automatic.blockingOperation.operationReceipt,
    blockingOperation: automatic.blockingOperation,
    forbiddenLabels: ['确认', '继续'],
    reason: `the ${automatic.blockingOperation.action} action has an observed ${automatic.blockingOperation.category} receipt; automatic continuation is forbidden until its cause is remediated or an explicit retry is requested`
  };
  if (automatic) return {
    allowed: false,
    allowedKinds: [],
    exactLabels: [],
    mustContinueAction: automatic.action,
    recheckRouterBeforeEndingTurn: true,
    forbiddenLabels: ['确认', '继续'],
    forbiddenClaims: ['已开始改造', '已进入代码改造', '已进入实施冻结', '下一步将生成', '等待用户继续'],
    reason: `the authorized ${automatic.action} chain has not produced its required user-visible result`
  };
  const decision = nextRequiredDecision(state);
  if (decision) return {
    allowed: true,
    allowedKinds: ['delivery-route-choice'],
    exactLabels: Object.values(decision.optionLabels),
    recheckRouterBeforeEndingTurn: true,
    requiredPresentation: 'runtime-demo-before-complete-route-choice',
    forbiddenLabels: ['确认', '继续'],
    reason: 'the registered runtime Demo must be shown with both complete route choices'
  };
  const interaction = userInteractionDirective(state, runDir);
  if (interaction.confirmation?.presentation?.contentRequiredInUserMessage && !String(interaction.confirmation.presentation.content || '').trim()) return {
    allowed: false,
    allowedKinds: [],
    exactLabels: [],
    recheckRouterBeforeEndingTurn: true,
    forbiddenLabels: ['确认', '继续'],
    reason: `the ${interaction.confirmation.label} presentation is empty and must be rebuilt before exposing a user confirmation`
  };
  if (interaction.confirmation) return {
    allowed: true,
    allowedKinds: ['named-confirmation'],
    exactLabels: [interaction.confirmation.label],
    recheckRouterBeforeEndingTurn: true,
    requiredPresentation: interaction.confirmation.presentation?.renderPolicy,
    confirmationPending: true,
    completionClaimForbidden: true,
    presentationMustAppearInChat: interaction.confirmation.presentation?.contentRequiredInUserMessage === true,
    prohibitedOutcomeClaims: ['无需确认', '不重复请求确认', '已恢复并继续执行', '确认已沿用', '方案已自动通过'],
    forbiddenLabels: ['确认', '继续'],
    reason: `only the complete ${interaction.confirmation.label} checkpoint may end this turn`
  };
  return {
    allowed: false,
    allowedKinds: [],
    exactLabels: [],
    recheckRouterBeforeEndingTurn: true,
    forbiddenLabels: ['确认', '继续'],
    reason: 'no generated and validated user decision is available'
  };
}
function nextRequiredDecision(state) {
  if (state.lifecycle === 'active' && state.locks?.effectApproved && !state.locks?.stitchApproved && !state.locks?.stitchSkipped && !state.deliveryRoute) {
    return {
      id: 'delivery-route',
      title: '运行时 Demo 已生成，请确认后续路线',
      purpose: '审阅当前可访问 Demo；选择任一路线即接受该 Demo 作为后续实施基线',
      reviewBeforeChoice: ['实际页面布局与内容', '关键交互与状态', '响应式表现', '组件、图标、图表和动效来源摘要'],
      options: ['stitch', 'direct-code'],
      optionLabels: {
        stitch: '继续执行流程（进入 Stitch）',
        'direct-code': '直接代码（跳过 Stitch，继续实施冻结、Gate 2 与 Gate 3）'
      },
      acceptedUtterances: {
        stitch: ['继续执行流程', '进入 Stitch', '走 Stitch'],
        'direct-code': ['直接代码', '直接生成代码', '直接生成生产代码', '跳过 Stitch 生成代码']
      },
      formalCodeDetection: 'Only formal project files outside .apex count as production code. Runtime Demo and visual-sandbox files never mean that production code already exists.',
      unselectedInputPolicy: 'revise-current-visual-plan-and-regenerate-runtime-demo',
      noSeparateDemoConfirmation: true
    };
  }
  return null;
}
function userInteractionDirective(state, runDir = null) {
  const automatic = executionDirective(state, runDir);
  if (automatic) {
    if (automatic.blockingOperation) return {
      mode: 'blocking-report',
      allowed: ['inspect-operation-receipt', 'remediate-observed-cause', 'explicit-retry'],
      terminalUserResponseAllowed: true,
      genericContinueForbidden: true,
      blockingOperation: automatic.blockingOperation,
      reason: 'a controlled action has already failed; do not repeat it automatically or inject a generic continuation'
    };
    const checkpoint = ['collect_existing_baseline', 'analyze_requirement'].includes(automatic.action) ? 'gate1'
      : automatic.action === 'plan_visual' ? 'visual-plan'
        : automatic.action === 'sync_stitch' ? 'stitch'
          : automatic.action === 'compile_visual_bundle' ? 'implementation' : null;
    return { mode: 'no-user-input', allowed: [], checkpoint, confirmation: null, genericContinueForbidden: true, terminalUserResponseAllowed: false, requiredTerminalResult: automatic.userVisibleResults, reason: `complete ${automatic.action} before asking the user anything; progress text cannot end the turn` };
  }
  const decision = nextRequiredDecision(state);
  if (decision) return { mode: 'required-choice', allowed: decision.options, genericContinueForbidden: true, decisionId: decision.id, decision, renderPolicy: 'show-runtime-demo-first-then-title-purpose-review-points-and-both-labelled-options', selectionEffect: 'accept-current-runtime-demo-as-implementation-baseline-and-enter-selected-route' };
  const checkpoint = state.lifecycle !== 'active' ? null
    : state.gates?.gate1?.status !== 'passed' ? 'gate1'
    : !state.locks?.visualPlanApproved ? 'visual-plan'
    : !state.locks?.stitchApproved && !state.locks?.stitchSkipped ? 'stitch'
    : !state.locks?.implementationApproved ? 'implementation'
    : null;
  const gate1File = artifactFile(runDir, state.artifacts?.gate1Presentation);
  const visualPlanFile = artifactFile(runDir, state.artifacts?.visualPlanPresentation);
  const stitchPresentationFile = artifactFile(runDir, state.artifacts?.stitchPresentation);
  const implementationPresentationFile = artifactFile(runDir, state.artifacts?.implementationPresentation);
  const confirmation = {
    gate1: { label: '确认需求与交付方案', unconfirmedInputPolicy: 'revise-current-gate1', presentation: { artifact: state.artifacts?.gate1Presentation, renderPolicy: 'chat-orientation-then-full-human-readable-artifact-not-summary', chatOrientation: { confirming: '确认 APEX 对需求方向、目标用户、范围边界、数据与 API、交付路径、质量门槛及风险假设的理解', reviewFocus: ['目标与成功标准是否正确', '页面、功能、数据和不包含项是否完整', 'Existing/Greenfield 判断及正式基线是否正确', '验收标准和风险是否可以接受'], afterApproval: '自动生成完整视觉方案，并在生成完毕后进入“确认视觉方案”', revisionBehavior: '未明确确认的任何意见都用于修订当前需求与交付方案，不进入下一阶段' }, requiredSections: gate1PresentationSections } },
    'visual-plan': { label: '确认视觉方案', unconfirmedInputPolicy: 'revise-current-visual-plan', presentation: { artifact: state.artifacts?.visualPlanPresentation, renderPolicy: 'chat-orientation-then-full-human-readable-artifact-not-summary', chatOrientation: { confirming: '确认页面的信息架构、布局、视觉 Token、组件、图标/图表、动效、响应式以及真实库来源与落地方式', reviewFocus: ['整体布局和视觉方向是否符合产品目标', '颜色、字体、间距、组件与数据表达是否协调', '真实来源、候选取舍和动效是否合理', 'Existing 改造收益或 Greenfield 选择依据是否清晰'], afterApproval: '自动生成并启动可访问的运行时 Demo，不再追加视觉确认', revisionBehavior: '未明确确认的任何意见都用于修订当前视觉方案，不生成 Demo' }, requiredSections: visualPlanPresentationSections } },
    stitch: { label: '确认 Stitch 内容', unconfirmedInputPolicy: 'revise-current-stitch', presentation: { artifact: state.artifacts?.stitchPresentation, artifacts: [state.artifacts?.stitchFreeze, state.artifacts?.stitchParityEvidence, state.artifacts?.stitchPresentation, state.artifacts?.stitchPresentationManifest], renderPolicy: 'chat-orientation-then-complete-candidate-differences-parity-sources-risks-and-adjustments', chatOrientation: { confirming: '确认当前 Stitch 候选的覆盖范围、冻结页面、差异与一致性证据、真实来源、风险和可调整项', reviewFocus: ['候选是否覆盖了本次需要交付的页面与状态', '差异与一致性证据是否足以支持后续实施', '来源、内容、布局与数据口径是否正确', '风险、排除项及需调整内容是否明确'], afterApproval: '自动编译实施包、代码映射及完整实施冻结方案', revisionBehavior: '未明确确认的任何意见都用于修订当前 Stitch 候选并重新验证' }, requiredSections: stitchPresentationSections } },
    implementation: { label: '确认实施冻结', unconfirmedInputPolicy: 'revise-current-implementation', presentation: { artifact: state.artifacts?.implementationPresentation, artifacts: [state.artifacts?.visualBundle, state.artifacts?.implementationMap, state.artifacts?.implementationPresentation, state.artifacts?.implementationPresentationManifest], renderPolicy: 'chat-orientation-then-complete-code-targets-source-materialization-dependencies-verification-risks-and-adjustments', chatOrientation: { confirming: '确认本次正式代码实施的目标文件、来源物化、依赖、数据与交互约束、验证和保护边界', reviewFocus: ['每个正式代码目标是否必要且范围正确', '来源、依赖、数据和交互约束是否可执行', '验收、风险及未修改内容的保护是否明确', '确认后执行正式修改、验证与交付链是否符合预期'], afterApproval: '自动进入受控正式代码实施、真实页面验证、Proof Gate 和最终交付', revisionBehavior: '未明确确认的任何意见都用于修订当前实施冻结，不会写入正式代码' }, requiredSections: implementationPresentationSections } }
  }[checkpoint] || null;
  if (confirmation?.presentation && state.track === 'existing' && ['gate1', 'visual-plan'].includes(checkpoint)) {
    const scopeFile = artifactFile(runDir, state.artifacts?.changeScope);
    if (scopeFile) {
      const scope = read(scopeFile);
      confirmation.presentation.scope = {
        mode: scope.mode,
        affected: scope.affected,
        protectedPolicy: scope.protected?.policy,
        confirmationContent: scope.presentationPolicy?.confirmationContent,
        unchangedContent: scope.presentationPolicy?.unchangedContent
      };
      confirmation.presentation.renderPolicy = 'chat-orientation-then-complete-affected-closure-only-never-republish-unchanged-site-content';
      confirmation.presentation.chatOrientation.confirming = checkpoint === 'gate1'
        ? '仅确认本次局部变更闭包、交付边界和验收；未列入变更闭包的页面、区域、组件与数据展示沿用冻结基线'
        : '仅确认本次受影响节点的布局、数据展示、视觉 Token 差异、组件、动效、来源与落地方式；不重新确认全站内容';
      confirmation.presentation.chatOrientation.reviewFocus = ['本次要调整的节点是否完整且没有扩大范围', '每项改动、原因与验收是否明确', '明确保护的未调整内容是否保持不变', '是否存在必要且已说明的跨组件影响'];
    }
  }
  if (confirmation?.presentation && checkpoint === 'gate1' && gate1File) {
    confirmation.presentation.content = fs.readFileSync(gate1File, 'utf8');
    confirmation.presentation.sha256 = sha256File(gate1File);
    confirmation.presentation.contentRequiredInUserMessage = true;
    confirmation.presentation.streaming = {
      enabled: true,
      mode: 'progressive-section-render',
      start: '正在整理完整的需求与交付方案，将按章节持续输出并校验。',
      sections: gate1PresentationSections,
      progressFormat: '正在生成并校验第 {current}/{total} 节：{title}',
      terminalRule: 'stream chat orientation and every section in order; render the exact confirmation label only after all sections, source binding, and final validation complete',
      forbiddenDuringStream: ['confirmation-button', 'generic-continue', 'partial-approval', 'file-card-only']
    };
  }
  if (confirmation?.presentation && checkpoint === 'visual-plan' && visualPlanFile) {
    confirmation.presentation.content = fs.readFileSync(visualPlanFile, 'utf8');
    confirmation.presentation.sha256 = sha256File(visualPlanFile);
    confirmation.presentation.contentRequiredInUserMessage = true;
    confirmation.presentation.streaming = {
      enabled: true,
      mode: 'progressive-section-render',
      start: '正在整理完整的视觉实施方案，将按章节持续输出并校验。',
      sections: visualPlanPresentationSections,
      progressFormat: '正在生成并校验第 {current}/{total} 节：{title}',
      terminalRule: 'stream chat orientation and every section in order; render the exact confirmation label only after all sections, source binding, and final validation complete',
      forbiddenDuringStream: ['confirmation-button', 'generic-continue', 'partial-approval', 'file-card-only']
    };
  }
  if (confirmation?.presentation && checkpoint === 'stitch' && stitchPresentationFile) {
      confirmation.presentation.content = fs.readFileSync(stitchPresentationFile, 'utf8');
      confirmation.presentation.sha256 = sha256File(stitchPresentationFile);
      confirmation.presentation.contentRequiredInUserMessage = true;
      confirmation.presentation.streaming = { enabled: true, mode: 'progressive-section-render', start: '正在整理完整 Stitch 候选确认内容，将按章节持续输出并校验。', sections: stitchPresentationSections, progressFormat: '正在生成并校验第 {current}/{total} 节：{title}', terminalRule: 'stream chat orientation and every section in order; render the exact confirmation label only after all sections and parity validation complete', forbiddenDuringStream: ['confirmation-button', 'generic-continue', 'partial-approval', 'file-card-only'] };
  }
  if (confirmation?.presentation && checkpoint === 'implementation' && implementationPresentationFile) {
      confirmation.presentation.content = fs.readFileSync(implementationPresentationFile, 'utf8');
      confirmation.presentation.sha256 = sha256File(implementationPresentationFile);
      confirmation.presentation.contentRequiredInUserMessage = true;
      confirmation.presentation.streaming = { enabled: true, mode: 'progressive-section-render', start: '正在整理完整实施冻结确认内容，将按章节持续输出并校验。', sections: implementationPresentationSections, progressFormat: '正在生成并校验第 {current}/{total} 节：{title}', terminalRule: 'stream chat orientation and every section in order; render the exact confirmation label only after all sections, source bindings and implementation-map validation complete', forbiddenDuringStream: ['confirmation-button', 'generic-continue', 'partial-approval', 'file-card-only'] };
  }
  if (checkpoint && !checkpointReady(state, runDir, checkpoint)) return { mode: 'no-user-input', allowed: [], checkpoint, confirmation: null, genericContinueForbidden: true, reason: `complete and validate the ${checkpoint} confirmation artifacts before exposing any user confirmation` };
  if (confirmation) {
    confirmation.approvalStatus = 'pending-user-confirmation';
    confirmation.presentationRequiredBeforeApproval = confirmation.presentation?.contentRequiredInUserMessage === true;
    confirmation.previousApprovalMayNotBeReused = true;
    confirmation.prohibitedOutcomeClaims = ['无需确认', '不重复请求确认', '确认已沿用', '方案已自动通过'];
  }
  return { mode: checkpoint ? 'work-until-checkpoint' : 'no-user-input', allowed: checkpoint ? [checkpoint] : [], checkpoint, confirmation, genericContinueForbidden: true, reason: checkpoint ? `complete work, then present only “${confirmation.label}”; any other user input revises this same checkpoint` : 'no user interaction is available' };
}
function capabilityExecutionDirective() {
  return {
    mode: 'internal-non-interactive',
    purpose: 'derive product and design context from the current APEX requirement, baseline, contracts, and selected sources',
    capabilities: ['google-design-md', 'ui-ux-pro-max-skill', 'impeccable', 'taste-skill'],
    forbiddenUserPrompts: ['initialize-project-context', 'confirm-product-positioning', 'confirm-PRODUCT.md', 'confirm-DESIGN.md', 'continue', 'generate-visual-plan'],
    rule: 'Capability setup, missing project-context files, candidate research, and plan generation are automatic internal work. Only Router userInteraction or nextRequiredDecision may be presented to the user.'
  };
}
function operatingConstraints() {
  return {
    strictFlow: 'only Router actions, decisions, and four named confirmations may advance the run',
    completeArtifacts: 'a confirmation is unavailable until its complete user-readable and machine-readable artifact set exists',
    continuousExecution: 'all work between confirmation gates runs automatically without continue, progress-poll, or setup prompts',
    efficientExecution: 'reuse context, source-integrity, and operation indexes; perform full cryptographic verification only at defined trust boundaries',
    tokenPolicy: 'load the current stage index, summaries, frozen contracts, and changed dependency closure only; do not reload unrelated full files'
  };
}
function routerState(root, run, sessionId) {
  const state = reconcileGateDependencyState(run.runDir, run.state || stateOf(run.runDir));
  const baseline = existingVisualBaselineStatus(run.runDir, state);
  const sessionContext = sessionContextStatus(root, sessionId);
  return { schemaVersion: '3.4', apexVersion: apexVersion(), bridgeHash: hashFile(bridgeSource), projectId: projectId(root), projectRoot: root, runId: run.runId, runDir: run.runDir, sessionId: sessionId || null, sessionContext, track: state.track, scope: state.scope, authorization: state.authorization, lifecycle: state.lifecycle || 'active', phase: state.phase, gates: Object.fromEntries(Object.entries(state.gates || {}).map(([key, value]) => [key, value.status])), handoff: state.handoff || null, existingVisualBaseline: state.track === 'existing' ? baseline : null, allowedActions: allowedActions(state, run.runDir), nextRequiredAction: nextRequiredAction(state, run.runDir), nextRequiredDecision: nextRequiredDecision(state), responsePolicy: responsePolicy(state, run.runDir), executionDirective: executionDirective(state, run.runDir), terminalResponseContract: terminalResponseContract(state, run.runDir), capabilityExecution: capabilityExecutionDirective(), operatingConstraints: operatingConstraints(), userInteraction: userInteractionDirective(state, run.runDir), nextRequiredGate: ['cancelled', 'handed-off'].includes(state.lifecycle) ? null : state.gates?.gate1?.status !== 'passed' ? 'gate1' : state.gates?.gate2?.status !== 'passed' ? 'gate2' : state.gates?.gate3?.status !== 'passed' ? 'gate3' : null };
}
function leaseDirectory(root) { return path.join(root, '.apex', 'locks', 'project-mutation.lock'); }
function leaseFile(root) { return path.join(leaseDirectory(root), 'lease.json'); }
function authorizationDirectory(run) { return path.join(run.runDir, 'authorizations'); }
function authorizationFile(run, reference) {
  const directory = path.resolve(authorizationDirectory(run));
  const file = path.resolve(run.runDir, reference || '');
  if (!file.startsWith(`${directory}${path.sep}`) || !fs.existsSync(file)) fail('authorization receipt must exist under the run authorizations directory');
  return file;
}
function validLease(lease) { return lease && Date.parse(lease.expiresAt) > Date.now(); }
function acquireLease(root, run, sessionId, durationMs) {
  if (!sessionId) fail('sessionId is required to acquire a project mutation lease');
  const directory = leaseDirectory(root); const file = leaseFile(root);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  try { fs.mkdirSync(directory, { recursive: false }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = fs.existsSync(file) ? read(file) : null;
    if (validLease(existing) && (existing.runId !== run.runId || existing.sessionId !== sessionId)) fail(`project mutation lease is held by run ${existing.runId} until ${existing.expiresAt}`);
    if (validLease(existing)) return existing;
    fs.rmSync(directory, { recursive: true, force: true });
    try { fs.mkdirSync(directory, { recursive: false }); }
    catch (retryError) { fail('project mutation lease changed while reclaiming an expired lease; retry the request'); }
  }
  const lease = { schemaVersion: '3.0', leaseId: crypto.randomUUID(), projectId: projectId(root), runId: run.runId, sessionId, issuedAt: now(), expiresAt: new Date(Date.now() + durationMs).toISOString() };
  write(file, lease); appendEvent(run.runDir, { type: 'mutation-lease-acquired', sessionId, leaseId: lease.leaseId, expiresAt: lease.expiresAt }); return lease;
}
function authorize(root, run, sessionId, action, leaseId) {
  const response = routerState(root, run, sessionId);
  if (action === 'generate_visual' && response.existingVisualBaseline && !response.existingVisualBaseline.ready) {
    json({ status: 'denied', reason: `Existing generate_visual requires a bound real-code/runtime baseline: ${response.existingVisualBaseline.reason}`, ...response }); process.exit(3);
  }
  if (!response.allowedActions.includes(action)) { json({ status: 'denied', reason: `action ${action} is not allowed in phase ${response.phase}`, ...response }); process.exit(3); }
  if (['prepare_workspace', 'implement', 'request_release'].includes(action)) {
    const lease = fs.existsSync(leaseFile(root)) ? read(leaseFile(root)) : null;
    if (!validLease(lease) || lease.runId !== run.runId || lease.sessionId !== sessionId || lease.leaseId !== leaseId) { json({ status: 'denied', reason: 'a current project mutation lease bound to this run and session is required', ...response }); process.exit(3); }
  }
  const token = { schemaVersion: '3.0', tokenId: crypto.randomUUID(), projectId: response.projectId, runId: response.runId, sessionId, action, phase: response.phase, gates: response.gates, stateHash: hashFile(path.join(run.runDir, 'state.json')), issuedAt: now(), expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
  const reference = path.join('authorizations', `${token.tokenId}.json`);
  write(path.join(run.runDir, reference), token);
  // `routerState` contains the run's authorization *mode* (interactive or
  // autonomous).  Keep the one-time token under a distinct name so the
  // object spread cannot silently overwrite it.
  appendEvent(run.runDir, { type: 'action-authorized', sessionId, action, tokenId: token.tokenId, stateHash: token.stateHash }); json({ status: 'authorized', authorizationRef: reference, authorizationToken: token, ...response });
}
function verifyAuthorization(root, run, sessionId, reference, action) {
  const token = read(authorizationFile(run, reference));
  if (token.schemaVersion !== '3.0' || token.projectId !== projectId(root) || token.runId !== run.runId || token.sessionId !== sessionId || token.action !== action) fail('authorization receipt does not match this project, run, session, or action');
  if (Date.parse(token.expiresAt) <= Date.now()) fail('authorization receipt has expired');
  if (token.stateHash !== hashFile(path.join(run.runDir, 'state.json'))) fail('authorization receipt is stale because the run state changed');
  if (!allowedActions(stateOf(run.runDir), run.runDir).includes(action)) fail(`action ${action} is no longer allowed by the current run state`);
  appendEvent(run.runDir, { type: 'action-verified', sessionId, action, tokenId: token.tokenId });
  return token;
}
function approvalReceipt(root, run, sessionId, gate, approvalId, references) {
  if (!['gate1', 'visual-plan', 'stitch', 'implementation'].includes(gate) || !approvalId || !references.length) fail('approval requires gate1|visual-plan|stitch|implementation, an approval id, and at least one run-relative artifact');
  const state = run.state || stateOf(run.runDir);
  if (!checkpointIsAwaitingDecision(state, gate) || !checkpointReady(state, run.runDir, gate)) fail(`${gate} confirmation is unavailable until its complete generated artifacts are ready`);
  if (gate === 'visual-plan' && state.gates?.gate1?.status !== 'passed') fail('Gate 1 must pass before a visual plan approval can be recorded');
  if (gate === 'gate1') {
    const presentation = state.artifacts?.gate1Presentation;
    if (!presentation || !references.includes(presentation) || !gate1PresentationReady(state, run.runDir)) fail('Gate 1 approval requires the chat-oriented, source-bound, complete eight-section direction and delivery presentation');
  }
  if (gate === 'visual-plan') {
    const presentation = state.artifacts?.visualPlanPresentation;
    const presentationFile = presentation && artifactFile(run.runDir, presentation);
    if (!state.artifacts?.visualExecutionPlan || !references.includes(state.artifacts.visualExecutionPlan)) fail('visual-plan approval must freeze visualExecutionPlan');
    if (!presentationFile || !references.includes(presentation) || !visualPlanReady(state, run.runDir)) fail('visual-plan approval requires a complete user-readable visualPlanPresentation with all 10 required sections');
  }
  if (gate === 'stitch') {
    if (!state.locks?.effectApproved || !state.artifacts?.runtimeDemo || !state.artifacts?.stitchFreeze || !state.artifacts?.stitchParityEvidence) fail('Stitch approval requires the runtime Demo baseline, Stitch candidate, and strict parity evidence');
    if (!durableConfirmationPresentationReady(state, run.runDir, 'stitch', stitchPresentationSections, ['stitchFreeze', 'stitchParityEvidence'], 'sync_stitch')) fail('Stitch approval requires the current source-bound six-section confirmation presentation and manifest');
    if (![state.artifacts.stitchFreeze, state.artifacts.stitchParityEvidence, state.artifacts.stitchPresentation, state.artifacts.stitchPresentationManifest].every(reference => references.includes(reference))) fail('Stitch approval must freeze the candidate, parity evidence, and the exact confirmation body shown to the user');
  }
  if (gate === 'implementation') {
    if ((!state.locks?.stitchCurrent && !state.locks?.stitchSkipped) || !state.locks?.stitchApproved || !state.artifacts?.visualBundle || !state.artifacts?.implementationMap) fail('implementation approval requires confirmed current or explicitly skipped Stitch, Visual Bundle, and Implementation Map');
    if (!durableConfirmationPresentationReady(state, run.runDir, 'implementation', implementationPresentationSections, ['visualBundle', 'implementationMap'], 'compile_visual_bundle')) fail('implementation approval requires the current source-bound six-section confirmation presentation and manifest');
    if (![state.artifacts.visualBundle, state.artifacts.implementationMap, state.artifacts.implementationPresentation, state.artifacts.implementationPresentationManifest].every(reference => references.includes(reference))) fail('implementation approval must freeze the implementation map and the exact confirmation body shown to the user');
  }
  if (gate === 'gate1') {
    const validation = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-validate.mjs'), 'pre-gate1', run.runDir], { encoding: 'utf8' });
    if (validation.status !== 0) fail((validation.stderr || validation.stdout).trim());
  }
  const rootDir = path.resolve(run.runDir);
  const artifactHashes = references.map(reference => {
    const target = path.resolve(run.runDir, reference);
    if (!target.startsWith(`${rootDir}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`approval artifact is missing or outside the run: ${reference}`);
    return { path: path.relative(run.runDir, target), sha256: hashFile(target) };
  });
  const scopes = { gate1: 'requirements-and-delivery-contract', 'visual-plan': 'pre-image-visual-execution-plan', stitch: 'stitch-candidate', implementation: 'pre-implementation-freeze' }; const receipt = { schemaVersion: '3.0', approvalId, gate, status: 'approved', projectId: projectId(root), runId: run.runId, sessionId, scope: scopes[gate], approvedAt: now(), artifactHashes };
  const safeId = approvalId.replace(/[^A-Za-z0-9._-]/g, '_');
  const relative = path.join('approvals', `${gate}-${safeId}.json`);
  write(path.join(run.runDir, relative), receipt);
  appendEvent(run.runDir, { type: 'approval-recorded', sessionId, gate, approvalId, artifactCount: artifactHashes.length });
  const command = { gate1: 'pass-gate1', 'visual-plan': 'confirm-visual-plan', stitch: 'confirm-stitch', implementation: 'confirm-implementation' }[gate];
  const result = runControllerCommand(command, [run.runDir, relative]);
  if (result.status !== 0) fail((result.stderr || result.stdout).trim());
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function checkpointIsAwaitingDecision(state, checkpoint) {
  if (checkpoint === 'gate1') return state.gates?.gate1?.status !== 'passed';
  if (checkpoint === 'visual-plan') return state.gates?.gate1?.status === 'passed' && !state.locks?.visualPlanApproved;
  if (checkpoint === 'stitch') return state.locks?.effectApproved === true && state.deliveryRoute === 'stitch' && !state.locks?.stitchApproved;
  if (checkpoint === 'implementation') return (state.locks?.stitchCurrent === true || state.locks?.stitchSkipped === true) && !state.locks?.implementationApproved;
  return false;
}

function decisionArtifactHashes(run, references, required) {
  const rootDir = path.resolve(run.runDir);
  const requested = new Set(references);
  for (const reference of required) requested.add(reference);
  return [...requested].map(reference => {
    const target = path.resolve(run.runDir, reference);
    if (!target.startsWith(`${rootDir}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`checkpoint decision artifact is missing or outside the run: ${reference}`);
    return { path: path.relative(run.runDir, target), sha256: hashFile(target) };
  });
}

function requiredCheckpointArtifacts(state, checkpoint) {
  const artifacts = state.artifacts || {};
  if (checkpoint === 'visual-plan') return [artifacts.visualExecutionPlan, artifacts.visualPlanPresentation];
  if (checkpoint === 'stitch') return [artifacts.stitchFreeze, artifacts.stitchParityEvidence, artifacts.stitchPresentation, artifacts.stitchPresentationManifest];
  if (checkpoint === 'implementation') return [artifacts.visualBundle, artifacts.implementationMap, artifacts.implementationPresentation, artifacts.implementationPresentationManifest];
  return [artifacts.intentBrief, artifacts.deliveryContract, artifacts.gate1Presentation];
}

function applyConfirmationWaiver(run, checkpoint, receipt) {
  const state = stateOf(run.runDir);
  if (checkpoint === 'gate1') {
    const validation = spawnSync(process.execPath, [validator, 'pre-gate1', run.runDir], { encoding: 'utf8' });
    if (validation.status !== 0) fail((validation.stderr || validation.stdout).trim());
    state.gates.gate1 = { status: 'passed', at: now(), evidence: [receipt, 'confirmation-waived-by-user'] };
    state.locks.requirementsApproved = true; state.phase = state.track === 'greenfield' ? 'G-05 VISUAL' : 'E-07 VISUAL';
  } else if (checkpoint === 'visual-plan') {
    if (state.gates?.gate1?.status !== 'passed' || !visualPlanReady(state, run.runDir)) fail('Gate 1 and the complete visual execution plan plus presentation are required before skipping visual-plan confirmation');
    state.locks.visualPlanApproved = true; state.phase = state.track === 'greenfield' ? 'G-05 VISUAL' : 'E-07 VISUAL';
  } else if (checkpoint === 'stitch') {
    if (!state.locks?.effectApproved || !state.artifacts?.stitchFreeze || !state.artifacts?.stitchParityEvidence) fail('approved effect image, Stitch candidate, and strict parity evidence are required before skipping the Stitch confirmation');
    state.locks.stitchApproved = true; state.locks.implementationApproved = false;
  } else if (checkpoint === 'implementation') {
    if ((!state.locks?.stitchCurrent && !state.locks?.stitchSkipped) || !state.locks?.stitchApproved || !state.artifacts?.visualBundle || !state.artifacts?.implementationMap) fail('current confirmed-or-stage-skipped Stitch, Visual Bundle, and Implementation Map are required before skipping implementation confirmation');
    state.locks.implementationApproved = true;
  }
  state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
}

function skipCheckpointAndContinue(root, run, sessionId, checkpoint, decisionId, reason, references) {
  const state = stateOf(run.runDir);
  if (!['gate1', 'visual-plan', 'stitch', 'implementation'].includes(checkpoint) || !decisionId || !reason) fail('skip requires gate1|visual-plan|stitch|implementation, a decision id, and a reason');
  if (state.lifecycle !== 'active') fail(`skip is unavailable for lifecycle ${state.lifecycle}`);
  if (!checkpointIsAwaitingDecision(state, checkpoint)) fail(`checkpoint ${checkpoint} is not awaiting a user decision in phase ${state.phase}`);
  if (!checkpointReady(state, run.runDir, checkpoint)) fail(`checkpoint ${checkpoint} has not produced a complete generated artifact set to waive`);
  const required = requiredCheckpointArtifacts(state, checkpoint);
  if (required.some(reference => !reference)) fail(`checkpoint ${checkpoint} has no complete, generated confirmation artifact set to waive`);
  const artifactHashes = decisionArtifactHashes(run, references, required);
  const safeId = decisionId.replace(/[^A-Za-z0-9._-]/g, '_');
  const relative = path.join('decisions', `skip-${checkpoint}-${safeId}.json`);
  const receipt = {
    schemaVersion: '3.0', decisionId, type: 'confirmation-waiver', checkpoint, outcome: 'continued',
    projectId: projectId(root), runId: run.runId, sessionId, reason, decidedAt: now(),
    effects: ['preserve-user-input-and-deliverables', 'waive-only-this-human-confirmation', 'keep-machine-validation-and-downstream-gates-required'], artifactHashes
  };
  write(path.join(run.runDir, relative), receipt);
  applyConfirmationWaiver(run, checkpoint, relative);
  appendEvent(run.runDir, { type: 'checkpoint-confirmation-waived-by-user', sessionId, checkpoint, decisionId, reason, receipt: relative });
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function skipStitchStage(root, run, sessionId, decisionId, reason, references) {
  const state = stateOf(run.runDir);
  if (!decisionId || !reason) fail('skip-stage stitch requires a decision id and reason');
  if (state.lifecycle !== 'active' || !state.locks?.effectApproved || state.locks?.stitchApproved || state.locks?.stitchSkipped) fail('Stitch stage is not available for an explicit stage skip');
  const required = [state.artifacts?.runtimeDemo, state.artifacts?.visualReference, state.artifacts?.gate1VisualOutput, state.artifacts?.designCandidates];
  if (required.some(reference => !reference)) fail('a runtime Demo baseline, selected candidate, and generated visual source evidence are required before skipping Stitch');
  const artifactHashes = decisionArtifactHashes(run, references, required);
  const safeId = decisionId.replace(/[^A-Za-z0-9._-]/g, '_'); const relative = path.join('decisions', `skip-stage-stitch-${safeId}.json`);
  const receipt = { schemaVersion: '3.0', decisionId, type: 'stage-skip', checkpoint: 'stitch', outcome: 'continued-with-runtime-demo-baseline', projectId: projectId(root), runId: run.runId, sessionId, reason, decidedAt: now(), effects: ['preserve-user-input-and-deliverables', 'skip-stitch-generation-and-human-confirmation', 'require-runtime-demo-source-lock-gate2-and-gate3'], artifactHashes };
  write(path.join(run.runDir, relative), receipt);
  state.locks.stitchSkipped = true; state.locks.stitchApproved = true; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.pendingDeliveryRoute = null; state.pendingDeliveryRouteReceipt = null; state.phase = state.track === 'greenfield' ? 'G-07 COMPILE' : 'E-09 COMPILE'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  appendEvent(run.runDir, { type: 'stitch-stage-skipped-by-user', sessionId, decisionId, reason, receipt: relative });
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function selectDeliveryRoute(root, run, sessionId, route, decisionId, reason, references) {
  const state = stateOf(run.runDir);
  const normalizedRoute = ['直接代码', '直接生成代码', '直接生成生产代码', '跳过 Stitch 生成代码'].includes(route) ? 'direct-code' : ['继续执行流程', '进入 Stitch', '走 Stitch'].includes(route) ? 'stitch' : route;
  if (!['stitch', 'direct-code'].includes(normalizedRoute) || !decisionId || !reason) fail('select-route requires stitch|direct-code (or its declared Chinese utterance), a decision id, and a reason');
  if (normalizedRoute === 'direct-code' && state.lifecycle === 'active' && state.locks?.visualPlanApproved && !state.locks?.effectApproved && !state.locks?.stitchApproved && !state.locks?.stitchSkipped) {
    const safeId = decisionId.replace(/[^A-Za-z0-9._-]/g, '_');
    const relative = path.join('decisions', `delivery-route-intent-${safeId}.json`);
    const receipt = { schemaVersion: '3.0', decisionId, type: 'delivery-route-intent', route: 'direct-code', userUtterance: route, projectId: projectId(root), runId: run.runId, sessionId, reason, decidedAt: now(), effects: ['preserve-the-confirmed-visual-plan', 'wait-for-runtime-demo-registration', 'skip-stitch-after-the-same-demo-is-registered'] };
    write(path.join(run.runDir, relative), receipt);
    state.pendingDeliveryRoute = 'direct-code'; state.pendingDeliveryRouteReceipt = relative; state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
    appendEvent(run.runDir, { type: 'delivery-route-intent-recorded', sessionId, route: normalizedRoute, userUtterance: route, decisionId, reason, receipt: relative });
    return { selectedRoute: normalizedRoute, userUtterance: route, disposition: 'queued-until-runtime-demo-registration', productionCodeStatus: 'not-inferred-from-runtime-demo', receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
  }
  if (state.lifecycle !== 'active' || !state.locks?.effectApproved || !state.artifacts?.runtimeDemo || state.locks?.stitchApproved || state.locks?.stitchSkipped) fail('delivery route is unavailable until the runtime Demo is registered and before Stitch is confirmed');
  if (normalizedRoute === 'direct-code') return { selectedRoute: normalizedRoute, userUtterance: route, productionCodeStatus: 'not-inferred-from-runtime-demo', ...skipStitchStage(root, run, sessionId, decisionId, reason, references) };
  const required = [state.artifacts.runtimeDemo, state.artifacts.visualReference, state.artifacts.gate1VisualOutput, state.artifacts.designCandidates];
  if (required.some(reference => !reference)) fail('runtime Demo source evidence is incomplete; cannot select Stitch');
  const artifactHashes = decisionArtifactHashes(run, references, required);
  const safeId = decisionId.replace(/[^A-Za-z0-9._-]/g, '_'); const relative = path.join('decisions', `delivery-route-stitch-${safeId}.json`);
  const receipt = { schemaVersion: '3.0', decisionId, type: 'delivery-route', route: 'stitch', userUtterance: route, projectId: projectId(root), runId: run.runId, sessionId, reason, decidedAt: now(), artifactHashes };
  write(path.join(run.runDir, relative), receipt);
  state.deliveryRoute = 'stitch'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  appendEvent(run.runDir, { type: 'delivery-route-selected', sessionId, route: normalizedRoute, userUtterance: route, decisionId, reason, receipt: relative });
  return { selectedRoute: normalizedRoute, userUtterance: route, productionCodeStatus: 'not-inferred-from-runtime-demo', receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function recordHandoffDecision(root, run, sessionId, checkpoint, decisionId, reason, references) {
  const state = stateOf(run.runDir);
  if (!['gate1', 'visual-plan', 'stitch', 'implementation'].includes(checkpoint) || !decisionId || !reason) fail('handoff requires gate1|visual-plan|stitch|implementation, a decision id, and a reason');
  if (state.lifecycle !== 'active') fail(`handoff is unavailable for lifecycle ${state.lifecycle}`);
  if (!checkpointIsAwaitingDecision(state, checkpoint)) fail(`checkpoint ${checkpoint} is not awaiting a user decision in phase ${state.phase}`);
  const artifactHashes = decisionArtifactHashes(run, references, []);
  const safeId = decisionId.replace(/[^A-Za-z0-9._-]/g, '_');
  const relative = path.join('decisions', `handoff-${checkpoint}-${safeId}.json`);
  const receipt = {
    schemaVersion: '3.0', decisionId, type: 'checkpoint-handoff', checkpoint, outcome: 'handoff',
    projectId: projectId(root), runId: run.runId, sessionId, reason, decidedAt: now(),
    effects: ['preserve-user-input-and-deliverables', 'keep-all-unmet-gates-closed', 'deny-implementation-and-release'], artifactHashes
  };
  write(path.join(run.runDir, relative), receipt);
  state.lifecycle = 'handed-off';
  state.handoff = { checkpoint, decisionId, reason, receipt: relative, at: receipt.decidedAt, resumePhase: state.phase };
  state.locks.implementationAllowed = false;
  state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  const releasedLease = releaseLeaseForRun(root, run, sessionId, 'checkpoint-skipped');
  appendEvent(run.runDir, { type: 'checkpoint-handed-off-by-user', sessionId, checkpoint, decisionId, reason, receipt: relative, releasedLease });
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function resumeHandoff(root, run, sessionId, reason) {
  const state = stateOf(run.runDir);
  if (state.lifecycle !== 'handed-off' || !state.handoff?.resumePhase) fail('run is not in a resumable checkpoint handoff');
  const handoff = state.handoff;
  state.lifecycle = 'active'; state.phase = handoff.resumePhase;
  state.handoff = { ...handoff, resumedAt: now(), resumeReason: reason || 'user-resumed-checkpoint' };
  state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  appendEvent(run.runDir, { type: 'checkpoint-handoff-resumed', sessionId, checkpoint: handoff.checkpoint, decisionId: handoff.decisionId, reason: state.handoff.resumeReason });
  return routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId);
}

function recordPromptRevision(root, run, sessionId, checkpoint, impact, reason) {
  const state = stateOf(run.runDir);
  const allowed = ['gate1', 'visual-plan', 'visual', 'stitch', 'implementation'];
  if (!allowed.includes(checkpoint) || !['visible', 'implementation-only', 'non-baseline'].includes(impact) || !reason) fail('revision requires gate1|visual-plan|visual|stitch|implementation, visible|implementation-only|non-baseline, and a reason');
  if (['visual-plan', 'visual'].includes(checkpoint) && state.gates?.gate1?.status !== 'passed') fail('visual prompt revision requires Gate 1');
  if (checkpoint === 'stitch' && !state.locks?.effectApproved) fail('Stitch prompt revision requires confirmed effect image');
  if (checkpoint === 'implementation' && !state.locks?.stitchCurrent && !state.locks?.stitchSkipped) fail('implementation prompt revision requires sealed or explicitly skipped Stitch');
  const gate2Open = state.gates?.gate2?.status === 'passed' && state.locks?.implementationAllowed === true;
  const approvalsBefore = { gate1: state.gates?.gate1?.status === 'passed', 'visual-plan': state.locks?.visualPlanApproved === true, stitch: state.locks?.stitchApproved === true, implementation: state.locks?.implementationApproved === true };
  let revisionOutcome = { kind: 'current-checkpoint-revision', checkpoint, impact, reopenedApprovedCheckpoints: [], message: '调整只影响当前未确认工件；将自动重建后回到同一确认点。' };
  if (impact === 'non-baseline') {
    appendEvent(run.runDir, { type: 'prompt-revision-no-baseline-change', sessionId, checkpoint, reason, preserved: ['approvals', 'gate2', 'implementation-authority'] });
    revisionOutcome = { kind: 'non-baseline-clarification', checkpoint, impact, reopenedApprovedCheckpoints: [], message: '该补充未改变已冻结字段；已记录，不解锁任何已确认方案。' };
  } else if (checkpoint === 'gate1') {
    const previouslyApproved = state.gates?.gate1?.status === 'passed';
    const invalidated = invalidateVisualIntermediates(run.runDir, 'prompt-revision-gate1');
    const invalidatedRoles = invalidateRoleStages(run.runDir, state, ['baseline', 'gate1', 'visual', 'implementation', 'verify'], 'prompt-revision-gate1');
    const cleared = clearArtifactReferences(state, [...gate1DerivedArtifacts, ...visualAndImplementationArtifacts]);
    state.gates.gate1 = { status: previouslyApproved ? 'revoked' : 'pending', at: now(), evidence: [`prompt-revision:gate1`, reason] };
    state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['prompt-revision:gate1'] };
    const revoked = revokeDownstreamDeliveryState(state, 'prompt-revision:gate1');
    state.locks.requirementsApproved = false;
    state.locks.visualPlanApproved = false;
    state.locks.effectApproved = false;
    state.locks.visualApproved = false;
    state.locks.stitchApproved = false;
    state.locks.stitchSkipped = false;
    state.locks.stitchCurrent = false;
    state.locks.implementationApproved = false;
    state.locks.implementationAllowed = false;
    state.deliveryRoute = null;
    state.phase = state.track === 'greenfield' ? 'G-01 PRODUCT' : 'E-05 IMPACT';
    appendEvent(run.runDir, { type: 'gate1-reopened-for-material-revision', sessionId, reason, previouslyApproved, preserved: state.track === 'existing' ? ['projectInventory', 'existingBaseline', 'codeReference', 'pageSkeleton'] : [], cleared, invalidated, invalidatedRoles, revoked });
    revisionOutcome = { kind: previouslyApproved ? 'reopened-upstream-checkpoint' : 'current-checkpoint-revision', checkpoint, impact, reopenedApprovedCheckpoints: ['gate1', 'visual-plan', 'stitch', 'implementation'].filter(item => approvalsBefore[item]), requiredNextConfirmation: '确认需求与交付方案', message: previouslyApproved ? '此调整改变了已确认的需求与交付边界；已解锁 Gate 1，并撤销其派生方案。APEX 将自动重建完整需求与交付方案，随后请重新确认“确认需求与交付方案”。' : '调整只影响当前需求与交付方案；将自动重建后回到同一确认点。' };
  } else if (checkpoint === 'visual-plan' || checkpoint === 'visual' || (checkpoint === 'implementation' && impact === 'visible')) {
    const invalidated = invalidateVisualIntermediates(run.runDir, `prompt-revision-${checkpoint}`); const invalidatedRoles = invalidateRoleStages(run.runDir, state, ['visual', 'implementation', 'verify'], `prompt-revision-${checkpoint}`); state.locks.visualPlanApproved = false; state.locks.effectApproved = false; state.locks.visualApproved = false; state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.deliveryRoute = null; state.gates.gate2 = { status: 'revoked', at: now(), evidence: [`prompt-revision:${checkpoint}`] }; const cleared = clearArtifactReferences(state, visualAndImplementationArtifacts); const revoked = revokeDownstreamDeliveryState(state, `prompt-revision:${checkpoint}`); state.phase = state.track === 'greenfield' ? 'G-04 VISUAL_PLAN' : 'E-06 VISUAL_PLAN'; appendEvent(run.runDir, { type: 'visual-reset', reason: `prompt-revision:${checkpoint}`, invalidated, invalidatedRoles, cleared, revoked });
    revisionOutcome = { kind: approvalsBefore['visual-plan'] ? 'reopened-upstream-checkpoint' : 'current-checkpoint-revision', checkpoint, impact, reopenedApprovedCheckpoints: ['visual-plan', 'stitch', 'implementation'].filter(item => approvalsBefore[item]), requiredNextConfirmation: '确认视觉方案', message: approvalsBefore['visual-plan'] ? '此调整改变了已确认的视觉方案；已解锁视觉方案及其派生 Demo、路线、Stitch 和实施冻结。APEX 将自动重建完整视觉方案，随后请重新确认“确认视觉方案”。' : '调整只影响当前未确认的视觉方案；将自动重建后回到“确认视觉方案”。' };
  } else if (checkpoint === 'stitch') {
    const invalidatedRoles = invalidateRoleStages(run.runDir, state, ['implementation', 'verify'], 'prompt-revision-stitch'); state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['prompt-revision:stitch'] }; const revoked = revokeDownstreamDeliveryState(state, 'prompt-revision:stitch'); state.phase = state.track === 'greenfield' ? 'G-06 SYNC_FREEZE' : 'E-08 SYNC_FREEZE'; appendEvent(run.runDir, { type: 'role-advisories-reset-after-stitch-revision', invalidatedRoles, revoked });
    revisionOutcome = { kind: approvalsBefore.stitch ? 'reopened-upstream-checkpoint' : 'current-checkpoint-revision', checkpoint, impact, reopenedApprovedCheckpoints: ['stitch', 'implementation'].filter(item => approvalsBefore[item]), requiredNextConfirmation: '确认 Stitch 内容', message: approvalsBefore.stitch ? '此调整改变了已确认的 Stitch 内容；已解锁 Stitch 与实施冻结。APEX 将自动重建并回到“确认 Stitch 内容”。' : '调整只影响当前未确认的 Stitch 工件；将自动重建后回到“确认 Stitch 内容”。' };
  } else if (checkpoint === 'implementation' && !gate2Open) {
    const invalidatedRoles = invalidateRoleStages(run.runDir, state, ['implementation', 'verify'], 'prompt-revision-implementation'); state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['prompt-revision:implementation'] }; const revoked = revokeDownstreamDeliveryState(state, 'prompt-revision:implementation'); appendEvent(run.runDir, { type: 'role-advisories-reset-after-implementation-revision', invalidatedRoles, revoked });
    revisionOutcome = { kind: approvalsBefore.implementation ? 'reopened-upstream-checkpoint' : 'current-checkpoint-revision', checkpoint, impact, reopenedApprovedCheckpoints: approvalsBefore.implementation ? ['implementation'] : [], requiredNextConfirmation: '确认实施冻结', message: approvalsBefore.implementation ? '此调整改变了已确认的实施冻结；已解锁实施冻结。APEX 将自动重建并回到“确认实施冻结”。' : '调整只影响当前未确认的实施冻结；将自动重建后回到“确认实施冻结”。' };
  } else if (checkpoint === 'implementation') {
    appendEvent(run.runDir, { type: 'post-gate2-implementation-revision-retained', sessionId, reason, preserved: ['gate2', 'implementation-authority'], gate3: 'must-revalidate' });
    revisionOutcome = { kind: 'post-gate2-implementation-revision', checkpoint, impact, reopenedApprovedCheckpoints: [], message: '该调整未改变冻结视觉、动效、依赖或映射；保留 Gate 2 与实施权限，但交付前必须重新通过 Gate 3。' };
  }
  state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  const revision = { at: now(), sessionId, checkpoint, impact, reason, stateRevision: state.revision, revisionOutcome };
  fs.appendFileSync(path.join(run.runDir, 'prompt-revisions.ndjson'), `${JSON.stringify(revision)}\n`); appendEvent(run.runDir, { type: 'prompt-revised', sessionId, checkpoint, impact, reason });
  appendEvent(run.runDir, { type: 'revision-outcome-recorded', sessionId, ...revisionOutcome });
  return { revisionOutcome, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function releaseLeaseForRun(root, run, sessionId, reason) {
  const lease = fs.existsSync(leaseFile(root)) ? read(leaseFile(root)) : null;
  if (!lease || lease.runId !== run.runId || lease.sessionId !== sessionId) return false;
  fs.rmSync(leaseDirectory(root), { recursive: true, force: true });
  appendEvent(run.runDir, { type: 'mutation-lease-released', sessionId, leaseId: lease.leaseId, reason });
  return true;
}
function mutationQueueFile(root) { return path.join(root, '.apex', 'queues', 'mutation.json'); }
function loadMutationQueue(root) { const file = mutationQueueFile(root); return fs.existsSync(file) ? read(file) : { schemaVersion: '3.0', entries: [] }; }
function saveMutationQueue(root, queue) { write(mutationQueueFile(root), queue); }
function queueMutation(root, run, sessionId) {
  const queue = loadMutationQueue(root); const existing = queue.entries.find(item => item.runId === run.runId && item.sessionId === sessionId);
  if (existing) return { queue, entry: existing, queued: false };
  const entry = { queueId: crypto.randomUUID(), projectId: projectId(root), runId: run.runId, sessionId, requestedAt: now() };
  queue.entries.push(entry); saveMutationQueue(root, queue); appendEvent(run.runDir, { type: 'mutation-queued', sessionId, queueId: entry.queueId, position: queue.entries.length });
  return { queue, entry, queued: true };
}
function claimQueuedMutation(root, run, sessionId, durationMs) {
  const queue = loadMutationQueue(root); const entry = queue.entries[0];
  if (!entry || entry.runId !== run.runId || entry.sessionId !== sessionId) fail('mutation queue head belongs to another run/session');
  const lease = acquireLease(root, run, sessionId, durationMs);
  queue.entries.shift(); saveMutationQueue(root, queue); appendEvent(run.runDir, { type: 'mutation-queue-claimed', sessionId, queueId: entry.queueId, leaseId: lease.leaseId });
  return lease;
}

const [command, ...args] = process.argv.slice(2);
assertCore();
assertBridgeSynchronized();
try {
  if (command === 'intake') {
    const [projectArg, runId, track, scope = 'standard', authorization = 'interactive', sessionId, ...consentWords] = args;
    if (!projectArg || !runId || !['greenfield', 'existing', 'auto'].includes(track) || !sessionId || !consentWords.length) fail('usage: intake <project-root> <run-id> <greenfield|existing|auto> [lite|standard|full] [interactive|autonomous] <session-id> <explicit-user-apex-consent>');
    const userConsent = assertExplicitApexConsent(consentWords.join(' '));
    const root = projectRoot(projectArg); ensureProject(root);
    const trackClassification = track === 'auto' ? classifyTrack(root) : { track, reason: 'explicit track requested by host', visualEntrypoint: null, preserveBackend: false };
    const result = runControllerCommand('init', [root, runId, trackClassification.track, scope, authorization]);
    if (result.status !== 0) fail((result.stderr || result.stdout).trim());
    const dir = runDir(root, runId); ['artifacts', 'approvals', 'evidence', 'locks', 'checkpoints'].forEach(name => fs.mkdirSync(path.join(dir, name), { recursive: true }));
    bindSession(root, sessionId, runId);
    appendEvent(dir, { type: 'run-created', sessionId: sessionId || null, track: trackClassification.track, requestedTrack: track, trackClassification, scope, authorization, userConsent }); json({ status: 'created', trackClassification, ...routerState(root, { runId, runDir: dir }, sessionId) });
  } else if (command === 'restart') {
    const [projectArg, runId, track, scope = 'standard', authorization = 'interactive', sessionId, reason = 'user-rejected-pre-confirmation-plan'] = args;
    if (!projectArg || !runId || !['greenfield', 'existing', 'auto'].includes(track) || !sessionId) fail('usage: restart <project-root> <new-run-id> <greenfield|existing|auto> [lite|standard|full] [interactive|autonomous] <session-id> [reason]');
    const root = projectRoot(projectArg); ensureProject(root);
    const previous = sessionBinding(root, sessionId);
    if (!previous || previous.projectId !== projectId(root)) fail('restart requires a current session binding; use intake for the first run');
    const trackClassification = track === 'auto' ? classifyTrack(root) : { track, reason: 'explicit track requested by host', visualEntrypoint: null, preserveBackend: false };
    const result = runControllerCommand('init', [root, runId, trackClassification.track, scope, authorization]);
    if (result.status !== 0) fail((result.stderr || result.stdout).trim());
    const dir = runDir(root, runId); ['artifacts', 'approvals', 'evidence', 'locks', 'checkpoints'].forEach(name => fs.mkdirSync(path.join(dir, name), { recursive: true }));
    const retainedGate1 = { retained: false, artifacts: [], reason: 'explicit-restart-must-reexecute-from-entry' };
    const retired = clearSessionHistory(root, sessionId, reason);
    bindSession(root, sessionId, runId);
    const retiredCleanup = purgeRetiredRun(root, retired, dir);
    appendEvent(dir, { type: 'run-restarted-from-entry', sessionId, replacedRunId: retired.runId, replacementReason: reason, retainedGate1, retiredCleanup, track: trackClassification.track, requestedTrack: track, trackClassification, scope, authorization });
    json({ status: 'restarted', replacedRunId: retired.runId, retainedGate1, trackClassification, ...routerState(root, { runId, runDir: dir }, sessionId) });
  } else if (command === 'reinvoke') {
    const [projectArg, sessionId, mode, runId, track, scope = 'standard', authorization = 'interactive', reason = 'user-submitted-a-second-request', userConsent] = args;
    if (!projectArg || !sessionId || !['continue', 'new-task'].includes(mode)) fail('usage: reinvoke <project-root> <session-id> <continue|new-task> [new-run-id greenfield|existing lite|standard|full interactive|autonomous reason explicit-user-apex-consent]');
    const root = projectRoot(projectArg); ensureProject(root);
    const previousRunId = assertSessionBinding(root, sessionId);
    if (mode === 'continue') {
      const run = selectRun(root, previousRunId);
      appendEvent(run.runDir, { type: 'session-reinvoked', sessionId, disposition: 'continue', reason });
      json({ status: 'continued', disposition: 'continue', ...routerState(root, run, sessionId) });
    } else {
      if (!runId || !['greenfield', 'existing', 'auto'].includes(track)) fail('new-task reinvocation requires a new run id and track');
      const explicitConsent = assertExplicitApexConsent(userConsent);
      const trackClassification = track === 'auto' ? classifyTrack(root) : { track, reason: 'explicit track requested by host', visualEntrypoint: null, preserveBackend: false };
      const result = runControllerCommand('init', [root, runId, trackClassification.track, scope, authorization]);
      if (result.status !== 0) fail((result.stderr || result.stdout).trim());
      const dir = runDir(root, runId); ['artifacts', 'approvals', 'evidence', 'locks', 'checkpoints'].forEach(name => fs.mkdirSync(path.join(dir, name), { recursive: true }));
      const retired = clearSessionHistory(root, sessionId, reason);
      bindSession(root, sessionId, runId);
      const retiredCleanup = purgeRetiredRun(root, retired, dir);
      appendEvent(dir, { type: 'session-reinvoked', sessionId, disposition: 'new-task', replacedRunId: retired.runId, reason, retiredCleanup, track: trackClassification.track, requestedTrack: track, trackClassification, scope, authorization, userConsent: explicitConsent });
      json({ status: 'created', disposition: 'new-task', replacedRunId: retired.runId, trackClassification, ...routerState(root, { runId, runDir: dir }, sessionId) });
    }
  } else if (command === 'revise') {
    const [projectArg, requestedRunId, sessionId, checkpoint, impact, reason] = args;
    if (!projectArg || !requestedRunId || !sessionId || !checkpoint || !impact || !reason) fail('usage: revise <project-root> <run-id> <session-id> <gate1|visual-plan|visual|stitch|implementation> <visible|implementation-only|non-baseline> <reason>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'revision-recorded', ...recordPromptRevision(root, run, sessionId, checkpoint, impact, reason) });
  } else if (command === 'cancel') {
    const [projectArg, requestedRunId, sessionId, userInstruction, reason = 'cancelled-by-user'] = args;
    if (!projectArg || !requestedRunId || !sessionId || !userInstruction) fail('usage: cancel <project-root> <run-id> <session-id> <explicit-user-cancel-text> [reason]');
    const cancellationIntent = assertExplicitCurrentRunCancellation(userInstruction);
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId)); const state = stateOf(run.runDir);
    if (state.lifecycle === 'cancelled' && fs.existsSync(path.join(run.runDir, cancellationReceiptName))) { json({ status: 'cancelled', idempotent: true, cancellation: read(path.join(run.runDir, cancellationReceiptName)), ...routerState(root, run, sessionId) }); }
    else if (state.lifecycle === 'cancelled') {
      const releasedLease = releaseLeaseForRun(root, run, sessionId, 'cancelled-run-reclamation');
      appendEvent(run.runDir, { type: 'cancelled-run-reclamation-started', sessionId, reason, releasedLease });
      const cancellation = reclaimCancelledRun(root, run, sessionId, `${cancellationIntent}:${reason}`);
      json({ status: 'cancelled', idempotent: false, recoveredCancellation: true, cancellation, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) });
    }
    else {
      const releasedLease = releaseLeaseForRun(root, run, sessionId, 'run-cancelled');
      appendEvent(run.runDir, { type: 'run-cancelled', sessionId, reason, releasedLease });
      const cancellation = reclaimCancelledRun(root, run, sessionId, `${cancellationIntent}:${reason}`);
      json({ status: 'cancelled', idempotent: false, cancellation, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) });
    }
  } else if (command === 'skip') {
    const [projectArg, requestedRunId, sessionId, checkpoint, decisionId, reason, ...references] = args;
    if (!projectArg || !requestedRunId || !sessionId || !checkpoint || !decisionId || !reason) fail('usage: skip <project-root> <run-id> <session-id> <gate1|visual-plan|stitch|implementation> <decision-id> <reason> [run-relative-artifact ...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'continued-with-confirmation-waiver', ...skipCheckpointAndContinue(root, run, sessionId, checkpoint, decisionId, reason, references) });
  } else if (command === 'skip-stage') {
    const [projectArg, requestedRunId, sessionId, stage, decisionId, reason, ...references] = args;
    if (!projectArg || !requestedRunId || !sessionId || stage !== 'stitch' || !decisionId || !reason) fail('usage: skip-stage <project-root> <run-id> <session-id> stitch <decision-id> <reason> [run-relative-artifact ...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'continued-with-stitch-stage-skip', ...skipStitchStage(root, run, sessionId, decisionId, reason, references) });
  } else if (command === 'select-route') {
    const [projectArg, requestedRunId, sessionId, route, decisionId, reason, ...references] = args;
    if (!projectArg || !requestedRunId || !sessionId || !route || !decisionId || !reason) fail('usage: select-route <project-root> <run-id> <session-id> <stitch|direct-code> <decision-id> <reason> [run-relative-artifact ...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'delivery-route-selected', ...selectDeliveryRoute(root, run, sessionId, route, decisionId, reason, references) });
  } else if (command === 'register-runtime-demo') {
    const [projectArg, requestedRunId, sessionId, authorizationRef] = args;
    if (!projectArg || !requestedRunId || !sessionId || !authorizationRef) fail('usage: register-runtime-demo <project-root> <run-id> <session-id> <authorization-ref>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'runtime-demo-registered', ...registerRuntimeDemo(root, run, sessionId, authorizationRef) });
  } else if (command === 'register-gate1-presentation') {
    const [projectArg, requestedRunId, sessionId, authorizationRef] = args;
    if (!projectArg || !requestedRunId || !sessionId || !authorizationRef) fail('usage: register-gate1-presentation <project-root> <run-id> <session-id> <authorization-ref>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'gate1-presentation-registered', ...registerGate1Presentation(root, run, sessionId, authorizationRef) });
  } else if (command === 'handoff') {
    const [projectArg, requestedRunId, sessionId, checkpoint, decisionId, reason, ...references] = args;
    if (!projectArg || !requestedRunId || !sessionId || !checkpoint || !decisionId || !reason) fail('usage: handoff <project-root> <run-id> <session-id> <gate1|visual-plan|stitch|implementation> <decision-id> <reason> [run-relative-artifact ...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'handed-off', ...recordHandoffDecision(root, run, sessionId, checkpoint, decisionId, reason, references) });
  } else if (command === 'resume-handoff') {
    const [projectArg, requestedRunId, sessionId, reason = 'user-resumed-checkpoint'] = args;
    if (!projectArg || !requestedRunId || !sessionId) fail('usage: resume-handoff <project-root> <run-id> <session-id> [reason]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'resumed', ...resumeHandoff(root, run, sessionId, reason) });
  } else if (command === 'queue-mutation') {
    const [projectArg, requestedRunId, sessionId] = args;
    if (!projectArg || !requestedRunId || !sessionId) fail('usage: queue-mutation <project-root> <run-id> <session-id>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    if (!allowedActions(run.state, run.runDir).includes('implement')) fail(`mutation queue is not allowed in phase ${run.state.phase}`);
    const result = queueMutation(root, run, sessionId); json({ status: 'queued', idempotent: !result.queued, queueId: result.entry.queueId, position: result.queue.entries.findIndex(item => item.queueId === result.entry.queueId) + 1, ...routerState(root, run, sessionId) });
  } else if (command === 'claim-mutation') {
    const [projectArg, requestedRunId, sessionId, minutes = '15'] = args;
    if (!projectArg || !requestedRunId || !sessionId) fail('usage: claim-mutation <project-root> <run-id> <session-id> [minutes]');
    const durationMs = Number(minutes) * 60 * 1000; if (!Number.isFinite(durationMs) || durationMs < 60 * 1000 || durationMs > 60 * 60 * 1000) fail('lease duration must be between 1 and 60 minutes');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'leased', lease: claimQueuedMutation(root, run, sessionId, durationMs), ...routerState(root, run, sessionId) });
  } else if (command === 'review') {
    const [projectArg, requestedRunId, sessionId, gate, disposition, reviewId, ...references] = args;
    if (!projectArg || !requestedRunId || !sessionId || !['gate1', 'visual'].includes(gate) || !['edited', 'rejected'].includes(disposition) || !reviewId) fail('usage: review <project-root> <run-id> <session-id> <gate1|visual> <edited|rejected> <review-id> [run-relative-artifact ...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId)); const rootDir = path.resolve(run.runDir);
    const artifacts = references.map(reference => { const target = path.resolve(run.runDir, reference); if (!target.startsWith(`${rootDir}${path.sep}`) || !fs.existsSync(target)) fail(`review artifact is missing or outside the run: ${reference}`); return { path: path.relative(run.runDir, target), sha256: hashFile(target) }; });
    const safeId = reviewId.replace(/[^A-Za-z0-9._-]/g, '_'); const relative = path.join('reviews', `${gate}-${safeId}.json`);
    const receipt = { schemaVersion: '3.0', reviewId, projectId: projectId(root), runId: run.runId, sessionId, gate, disposition, reviewedAt: now(), artifactHashes: artifacts };
    write(path.join(run.runDir, relative), receipt); appendEvent(run.runDir, { type: 'approval-reviewed', sessionId, gate, disposition, reviewId, artifactCount: artifacts.length });
    json({ status: 'reviewed', receipt: relative, ...routerState(root, run, sessionId) });
  } else if (command === 'refresh-session') {
    // Deliberately read-only entrypoint for host lifecycle hooks.  It makes a
    // previously bound session observe the current Core/Bridge without
    // emitting a misleading run-inspected event or advancing any Gate.
    const [projectArg, sessionId] = args; if (!projectArg || !sessionId) fail('usage: refresh-session <project-root> <session-id>');
    const root = projectRoot(projectArg); ensureProject(root);
    const run = selectRun(root, assertSessionBinding(root, sessionId));
    json({ status: 'session-refreshed', ...routerState(root, run, sessionId) });
  } else if (command === 'resume' || command === 'status') {
    const [projectArg, requestedRunId, sessionId] = args; if (!projectArg || !sessionId) fail(`usage: ${command} <project-root> [run-id] <session-id>`);
    const root = projectRoot(projectArg); ensureProject(root); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    appendEvent(run.runDir, { type: command === 'resume' ? 'run-resumed' : 'run-inspected', sessionId: sessionId || null }); json({ status: 'ready', ...routerState(root, run, sessionId) });
  } else if (command === 'lease') {
    const [projectArg, requestedRunId, sessionId, minutes = '15'] = args; if (!projectArg || !requestedRunId || !sessionId) fail('usage: lease <project-root> <run-id> <session-id> [minutes]');
    const durationMs = Number(minutes) * 60 * 1000; if (!Number.isFinite(durationMs) || durationMs < 60 * 1000 || durationMs > 60 * 60 * 1000) fail('lease duration must be between 1 and 60 minutes');
    const root = projectRoot(projectArg); json({ status: 'leased', lease: acquireLease(root, selectRun(root, assertSessionBinding(root, sessionId, requestedRunId)), sessionId, durationMs || DEFAULT_LEASE_MS) });
  } else if (command === 'authorize') {
    const [projectArg, requestedRunId, sessionId, action, leaseId] = args; if (!projectArg || !requestedRunId || !sessionId || !action) fail('usage: authorize <project-root> <run-id> <session-id> <action> [lease-id]');
    const root = projectRoot(projectArg); authorize(root, selectRun(root, assertSessionBinding(root, sessionId, requestedRunId)), sessionId, action, leaseId);
  } else if (command === 'approve') {
    const [projectArg, requestedRunId, sessionId, gate, approvalId, ...references] = args;
    if (!projectArg || !requestedRunId || !sessionId || !gate || !approvalId || !references.length) fail('usage: approve <project-root> <run-id> <session-id> <gate1|visual-plan|visual|stitch|implementation> <approval-id> <run-relative-artifact> [...]');
    const root = projectRoot(projectArg); json({ status: 'approved', ...approvalReceipt(root, selectRun(root, assertSessionBinding(root, sessionId, requestedRunId)), sessionId, gate, approvalId, references) });
  } else if (command === 'verify-authorization') {
    const [projectArg, requestedRunId, sessionId, reference, action] = args;
    if (!projectArg || !requestedRunId || !sessionId || !reference || !action) fail('usage: verify-authorization <project-root> <run-id> <session-id> <authorization-ref> <action>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'verified', authorizationToken: verifyAuthorization(root, run, sessionId, reference, action), ...routerState(root, run, sessionId) });
  } else if (command === 'transition') {
    const [projectArg, requestedRunId, sessionId, authorizationRef, transition, ...transitionArgs] = args;
    if (!projectArg || !requestedRunId || !sessionId || !authorizationRef || !transition) fail('usage: transition <project-root> <run-id> <session-id> <authorization-ref> <open-gate2|pass-proof|open-gate3|revoke-stitch|repair-visual-source-identity|checkpoint> [args...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    const state = stateOf(run.runDir);
    const commandByTransition = { 'open-gate2': 'open-gate2', 'pass-proof': 'pass-proof', 'open-gate3': 'open-gate3', 'revoke-stitch': 'revoke-stitch', 'repair-visual-source-identity': 'repair-visual-source-identity', checkpoint: 'checkpoint' };
    const controllerCommand = commandByTransition[transition];
    if (!controllerCommand) fail(`unsupported transition: ${transition}`);
    const requiredAction = { 'open-gate2': 'open_gate2', 'pass-proof': 'pass_proof', 'open-gate3': 'open_gate3', 'revoke-stitch': 'revoke_visual', 'repair-visual-source-identity': 'repair_visual_source_identity', checkpoint: 'inspect_run' }[transition];
    if (!allowedActions(state, run.runDir).includes(requiredAction)) fail(`transition ${transition} is not allowed in phase ${state.phase}`);
    const token = read(authorizationFile(run, authorizationRef));
    const permittedActions = transition === 'revoke-stitch' ? ['revoke_visual', 'sync_stitch'] : [requiredAction];
    if (!permittedActions.includes(token.action)) fail(`authorization action ${token.action} cannot perform transition ${transition}`);
    verifyAuthorization(root, run, sessionId, authorizationRef, token.action);
    const result = runControllerCommand(controllerCommand, [run.runDir, ...transitionArgs]);
    if (result.status !== 0) fail((result.stderr || result.stdout).trim());
    appendEvent(run.runDir, { type: 'state-transition', sessionId, transition });
    json({ status: 'transitioned', transition, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) });
  } else fail('commands: intake | restart | reinvoke | revise | cancel | skip | skip-stage | register-gate1-presentation | register-runtime-demo | select-route | handoff | resume-handoff | queue-mutation | claim-mutation | review | resume | status | lease | authorize | approve | verify-authorization | transition');
} catch (error) { fail(error.message); }
