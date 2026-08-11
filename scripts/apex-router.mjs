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
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256File(file) { return `sha256:${hashFile(file)}`; }
function fileFingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function sameFingerprint(expected, file) { if (!expected || !file || !fs.existsSync(file)) return false; const actual = fileFingerprint(file); return Object.entries(expected).every(([key, value]) => actual[key] === value); }
function operationRecords(dir) {
  const operations = path.join(dir, 'operations'); const indexFile = path.join(dir, 'operations-index.json');
  if (fs.existsSync(indexFile)) {
    try { return Object.entries(read(indexFile).receipts || {}).map(([relative, receipt]) => ({ path: path.join(dir, relative), receipt })); } catch {}
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
const gate1Artifacts = ['intentBrief', 'deliveryContract', 'gate1Presentation', 'projectInventory', 'existingBaseline', 'codeReference', 'pageSkeleton', 'experienceStrategy', 'experienceQualityEvidence', 'domainModel', 'apiContract', 'dataContract', 'siteContract', 'functionalFreeze'];
// Formal Existing evidence remains valid when the user refines the requested
// product behavior.  Everything derived from that behavior must be rebuilt;
// otherwise an approved Gate 1 receipt can silently describe an older scope.
const gate1DerivedArtifacts = ['intentBrief', 'deliveryContract', 'gate1Presentation', 'gate1PresentationManifest', 'experienceStrategy', 'experienceQualityEvidence', 'domainModel', 'apiContract', 'dataContract', 'siteContract', 'functionalFreeze', 'changeScope'];
const visualAndImplementationArtifacts = ['motionContract', 'motionEvidence', 'visualExecutionPlan', 'visualPlanPresentation', 'visualPlanPresentationManifest', 'visualSandboxFiles', 'runtimeDemo', 'runtimeSourceLock', 'runtimeVisualBaseline', 'runtimeMaterialization', 'runtimeMaterializationAudit', 'materializedAssets', 'materializedAssetsAudit', 'designCandidates', 'visualSourceManifest', 'visualReference', 'gate1VisualOutput', 'stitchFreeze', 'stitchParityEvidence', 'implementationParityEvidence', 'visualBundle', 'implementationMap', 'runtimeStateMatrix', 'verificationPlan', 'verificationBundle', 'pageDelta', 'dependencyLock'];
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
function invalidateVisualIntermediates(dir, reason) {
  const candidates = ['design-candidates.json', 'visual-reference.json', 'gate1-visual-output.json', 'stitch-job.json', 'stitch-freeze.json', 'stitch-raw.json', 'stitch-parity-evidence.json', 'visual-bundle.json', 'implementation-map.json', 'evidence/stitch-ui-import.json'];
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
    const [runDir, reason = 'stitch-content-changed'] = args; const dir = path.resolve(runDir); const state = load(dir); const invalidated = invalidateVisualIntermediates(dir, reason); state.gates.gate2 = { status: 'revoked', at: now(), evidence: [reason] }; state.locks.effectApproved = false; state.locks.visualApproved = false; state.locks.visualPlanApproved = false; state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.implementationApproved = false; state.locks.stitchCurrent = false; state.locks.implementationAllowed = false; for (const artifact of ['visualExecutionPlan', 'runtimeDemo', 'designCandidates', 'visualReference', 'gate1VisualOutput', 'stitchFreeze', 'stitchParityEvidence', 'visualBundle', 'implementationMap']) state.artifacts[artifact] = null; state.phase = state.track === 'greenfield' ? 'G-04 VISUAL_PLAN' : 'E-06 VISUAL_PLAN'; save(dir, state); appendEvent(dir, { type: 'visual-reset', reason, invalidated });
  } else if (command === 'checkpoint') {
    const [runDir, label = 'checkpoint'] = args; const dir = path.resolve(runDir); const state = load(dir); const artifacts = {};
    for (const [name, ref] of Object.entries(state.artifacts)) { if (!ref) continue; const file = path.isAbsolute(ref) ? ref : path.join(dir, ref); if (fs.existsSync(file)) artifacts[name] = { path: ref, hash: hashFile(file) }; }
    const checkpoint = { schemaVersion: '3.0', label, at: now(), phase: state.phase, gates: state.gates, locks: state.locks, artifacts }; const file = path.join(dir, 'checkpoints', `${Date.now()}-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`); write(file, checkpoint); state.checkpoints ||= []; state.checkpoints.push({ path: path.relative(dir, file), at: checkpoint.at, label }); save(dir, state);
  } else if (command === 'pass-proof') {
    const [runDir, evidence] = args; if (!evidence) die('usage: pass-proof <run-dir> <evidence-path>'); const dir = path.resolve(runDir); const evidenceFile = path.resolve(dir, evidence); if (!evidenceFile.startsWith(`${dir}${path.sep}`) || !fs.existsSync(evidenceFile)) die(`proof evidence does not exist inside the run: ${evidenceFile}`); const proof = read(evidenceFile), receipt = outputReceiptFor(dir, evidenceFile); if (proof.status !== 'passed' || !Array.isArray(proof.evidence) || !proof.evidence.length || !receipt) die('proof evidence is not passed raw output of a successful controlled verify operation'); const state = load(dir); state.gates.proof = { status: 'passed', at: now(), evidence: [path.relative(dir, evidenceFile), path.relative(dir, receipt.path)] }; state.phase = state.track === 'greenfield' ? 'G-11 EXPAND' : 'E-13 REGRESSION'; save(dir, state);
  } else if (command === 'open-gate3') {
    const dir = path.resolve(args[0] || '.'); validate('gate3', dir); const state = load(dir); if (!['passed', 'not-required'].includes(state.gates.proof.status)) die('Proof Gate has not passed'); state.gates.gate3 = { status: 'passed', at: now(), evidence: [state.artifacts.verificationBundle || 'verification-bundle.json'] }; state.phase = state.track === 'greenfield' ? 'G-13 MEMORY' : 'E-15 MEMORY'; save(dir, state);
  } else die(`unsupported internal controller command: ${command}`);
}
function registerRuntimeDemo(root, run, sessionId) {
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
function existingVisualBaselineStatus(runDir, state) {
  if (state.track !== 'existing') return { ready: true, reason: null };
  const inventoryFile = artifactFile(runDir, state.artifacts?.projectInventory);
  const referenceFile = artifactFile(runDir, state.artifacts?.codeReference);
  const skeletonFile = artifactFile(runDir, state.artifacts?.pageSkeleton);
  const baselineFile = artifactFile(runDir, state.artifacts?.existingBaseline);
  if (!inventoryFile || !referenceFile || !skeletonFile || !baselineFile) return { ready: false, reason: 'project inventory, complete code reference, page skeleton, and existing baseline are required' };
  try {
    const inventory = read(inventoryFile);
    const reference = read(referenceFile);
    const skeleton = read(skeletonFile);
    const baseline = read(baselineFile);
    const displayFile = artifactFile(runDir, baseline.displayEvidence?.path);
    if (!Array.isArray(inventory.entrypoints) || !inventory.entrypoints.length) return { ready: false, reason: 'project inventory has no real entrypoint evidence' };
    if (reference.complete !== true || !Array.isArray(reference.files) || !reference.files.length || !reference.sourceTreeHash) return { ready: false, reason: 'code reference is not a complete source snapshot' };
    const projectRoot = path.resolve(reference.projectRoot || path.join(runDir, '..', '..', '..'));
    for (const item of reference.files) {
      const source = path.resolve(projectRoot, item.path || '');
      if (!source.startsWith(`${projectRoot}${path.sep}`) || !fs.existsSync(source) || !fs.statSync(source).isFile()) return { ready: false, reason: `scoped source is missing or outside the project: ${item.path || '<unknown>'}` };
      if (sha256File(source) !== item.sha256) return { ready: false, reason: `scoped source changed after capture: ${item.path}` };
    }
    if (skeleton.sourceTreeHash !== reference.sourceTreeHash || !skeleton.skeletonHash || !Array.isArray(skeleton.nodes) || !skeleton.nodes.length) return { ready: false, reason: 'page skeleton does not bind the complete code reference' };
    if (!displayFile || !baseline.displayEvidence?.hash || !Array.isArray(baseline.displayEvidence?.capturedRoutes) || !baseline.displayEvidence.capturedRoutes.length) return { ready: false, reason: 'real browser display evidence is required' };
    if (baseline.codeReference?.complete !== true || baseline.codeReference.sourceTreeHash !== reference.sourceTreeHash || baseline.codeReference.pageSkeletonHash !== skeleton.skeletonHash) return { ready: false, reason: 'existing baseline is not bound to the current code reference and page skeleton' };
  } catch {
    return { ready: false, reason: 'existing visual baseline artifacts are unreadable' };
  }
  return { ready: true, reason: null };
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
function substantiveSections(content, sections) {
  return sections.every((section, index) => {
    const start = content.indexOf(section);
    if (start < 0) return false;
    const next = index + 1 < sections.length ? content.indexOf(sections[index + 1], start + section.length) : content.length;
    return next > start && content.slice(start + section.length, next).replace(/[#*_`>|\-\s]/g, '').length >= 40;
  });
}
function gate1PresentationReady(state, runDir) {
  const presentation = artifactFile(runDir, state.artifacts?.gate1Presentation);
  const manifestFile = artifactFile(runDir, state.artifacts?.gate1PresentationManifest);
  if (!presentation || !manifestFile || !substantiveSections(fs.readFileSync(presentation, 'utf8'), gate1PresentationSections)) return false;
  try {
    const manifest = read(manifestFile);
    if (manifest.status !== 'ready-for-user-confirmation' || manifest.track !== state.track || manifest.presentationSha256 !== sha256File(presentation)) return false;
    const required = ['intentBrief', 'deliveryContract', 'experienceStrategy'];
    if (state.track === 'existing') required.push('projectInventory', 'existingBaseline', 'functionalFreeze', 'changeScope');
    return required.every(name => {
      const source = manifest.sources?.[name], file = artifactFile(runDir, source?.path);
      return file && source.sha256 === sha256File(file) && source.path === state.artifacts?.[name];
    });
  } catch { return false; }
}
function visualPlanReady(state, runDir) {
  const plan = artifactFile(runDir, state.artifacts?.visualExecutionPlan);
  const presentation = artifactFile(runDir, state.artifacts?.visualPlanPresentation);
  const manifestFile = artifactFile(runDir, state.artifacts?.visualPlanPresentationManifest);
  if (!plan || !presentation || !manifestFile || !substantiveSections(fs.readFileSync(presentation, 'utf8'), visualPlanPresentationSections)) return false;
  try {
    const manifest = read(manifestFile);
    const scopeCurrent = state.track !== 'existing' || (manifest.changeScope === state.artifacts?.changeScope && artifactFile(runDir, manifest.changeScope) && manifest.changeScopeSha256 === sha256File(artifactFile(runDir, manifest.changeScope)));
    return scopeCurrent && manifest.status === 'ready-for-user-confirmation'
      && manifest.visualExecutionPlan === state.artifacts.visualExecutionPlan
      && manifest.visualExecutionPlanSha256 === sha256File(plan)
      && manifest.presentation === state.artifacts.visualPlanPresentation
      && manifest.presentationSha256 === sha256File(presentation);
  } catch { return false; }
}
function checkpointReady(state, runDir, checkpoint) {
  if (!runDir) return false;
  if (checkpoint === 'gate1') {
    // This controls only whether a completed proposal may be shown.  The
    // approval path below still runs pre-gate1, including full source hashes.
    const required = ['intentBrief', 'deliveryContract', 'gate1Presentation', 'gate1PresentationManifest', 'experienceStrategy', 'experienceQualityEvidence'];
    if (state.track === 'existing') required.push('projectInventory', 'existingBaseline', 'codeReference', 'pageSkeleton', 'functionalFreeze', 'changeScope');
    try {
      if (required.some(name => !artifactFile(runDir, state.artifacts?.[name])) || !gate1PresentationReady(state, runDir)) return false;
      const contract = read(artifactFile(runDir, state.artifacts.deliveryContract));
      if ((contract.capabilities || []).some(capability => ['backend', 'api-contract'].includes(capability)) && ['domainModel', 'apiContract'].some(name => !artifactFile(runDir, state.artifacts?.[name]))) return false;
      return true;
    } catch { return false; }
  }
  if (checkpoint === 'visual-plan') return visualPlanReady(state, runDir);
  if (checkpoint === 'stitch') return Boolean(state.deliveryRoute === 'stitch' && state.artifacts?.stitchFreeze && state.artifacts?.stitchParityEvidence);
  if (checkpoint === 'implementation') return Boolean((state.locks?.stitchCurrent || state.locks?.stitchSkipped) && state.locks?.stitchApproved && state.artifacts?.visualBundle && state.artifacts?.implementationMap);
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
    actions.add(state.track === 'existing' ? 'collect_existing_baseline' : 'plan_product');
  }
  const existingBaseline = runDir ? existingVisualBaselineStatus(runDir, state) : { ready: state.track !== 'existing', reason: 'run directory is required to verify Existing baseline' };
  if (gate1 && !gate2 && !existingBaseline.ready) {
    actions.add('collect_existing_baseline');
    actions.add('revoke_visual');
  } else if (gate1 && !gate2) {
    if (!state.locks?.visualPlanApproved) {
      ['plan_visual', 'revoke_visual'].forEach(action => actions.add(action));
      if (checkpointReady(state, runDir, 'visual-plan')) actions.add('request_visual_plan_approval');
    }
    // The visual plan is the only visual user confirmation.  Until the real
    // effect artifacts are registered, generation is the sole forward action;
    // compiling a bundle here would let a host bypass the runtime image.
    else if (!state.locks?.effectApproved) {
      ['generate_visual', 'revoke_visual'].forEach(action => actions.add(action));
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
  if (gate2 && !gate3) ['prepare_workspace', 'implement', 'verify', 'request_release', 'pass_proof', 'open_gate3', 'revoke_visual'].forEach(action => actions.add(action));
  if (gate3) actions.add('read_delivery_evidence');
  for (const checkpoint of ['gate1', 'visual-plan', 'stitch', 'implementation']) {
    if (checkpointIsAwaitingDecision(state, checkpoint) && checkpointReady(state, runDir, checkpoint)) actions.add('skip_checkpoint');
  }
  return [...actions].sort();
}
function nextRequiredAction(state, runDir = null) {
  if (state.lifecycle === 'active' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed' && !state.locks?.visualPlanApproved && !visualPlanReady(state, runDir)) return 'plan_visual';
  // A confirmed visual plan is an execution boundary, not another chat prompt.
  // The host must obtain authorization and run the existing generation chain
  // before it can expose the Stitch/direct-code route decision.
  if (state.lifecycle === 'active' && state.gates?.gate1?.status === 'passed' && state.gates?.gate2?.status !== 'passed' && state.locks?.visualPlanApproved && !state.locks?.effectApproved) return runtimeDemoRegistrationReady(state, runDir) ? 'register_runtime_demo' : 'generate_visual';
  return null;
}
function responsePolicy(state, runDir = null) {
  return ['plan_visual', 'generate_visual', 'register_runtime_demo'].includes(nextRequiredAction(state, runDir)) ? 'complete-required-action-before-user-response' : 'decision-only-user-response';
}
function executionDirective(state, runDir = null) {
  const action = nextRequiredAction(state, runDir);
  if (!['plan_visual', 'generate_visual', 'register_runtime_demo'].includes(action)) return null;
  // This is deliberately structured rather than prose.  A host must not turn
  // a confirmed visual plan into a generic chat "continue" affordance.
  return {
    kind: 'must-complete-before-user-response',
    action,
    automatic: true,
    userInput: 'forbidden-until-action-settles',
    terminalUserResponseAllowed: false,
    progressUpdates: 'commentary-only-never-end-the-turn',
    incompleteBehavior: 'continue-the-authorized-chain-without-user-interaction',
    onlyTerminalFailure: 'single-blocking-report-with-observable-error-and-missing-artifacts',
    afterSuccess: action === 'plan_visual' ? 'present_complete_visual_plan_and_request_visual_plan_confirmation' : action === 'generate_visual' ? 'register_runtime_demo' : 'present_runtime_demo_and_request_delivery_route',
    requiredChain: action === 'plan_visual'
      ? ['analyze_requirement_and_platform_constraints', 'compare_real_layout_style_component_icon_chart_motion_sources', 'emit_visual_execution_plan', 'emit_10_section_visual_plan_presentation']
      : action === 'generate_visual'
      ? ['materialize_run_local_demo_code', 'start_run_local_demo', 'capture_browser_and_motion_evidence', 'freeze_runtime_visual_baseline', 'emit_visual_reference', 'register_runtime_demo']
      : ['register_runtime_demo', 'present_runtime_demo_and_request_delivery_route'],
    completionEvidence: action === 'plan_visual' ? ['visual-execution-plan.json', 'visual-plan-presentation.md'] : action === 'generate_visual' ? ['runtime-demo.json', 'runtime-source-lock.json', 'runtime-visual-baseline.json', 'visual-reference.json', 'gate1-visual-output.json', 'design-candidates.json'] : ['registrations/runtime-demo-*.json'],
    userVisibleResults: action === 'plan_visual' ? ['full-visual-plan-presentation-and-confirmation', 'blocking-report'] : ['runtime-demo', 'blocking-report'],
    forbiddenTerminalResults: action === 'plan_visual' ? ['stage-status-only', 'generation-progress-only', 'artifact-file-list-only', 'one-sentence-plan-summary'] : ['stage-status-only', 'generation-progress-only', 'artifact-file-list-only'],
    prohibitedUserPrompts: action === 'plan_visual' ? ['continue', 'generate-visual-plan', 'confirm-runtime-demo', 'poll-for-progress'] : ['continue', 'confirm-visual-plan', 'confirm-runtime-demo', 'poll-for-progress']
  };
}
function terminalResponseContract(state, runDir = null) {
  const automatic = executionDirective(state, runDir);
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
  if (interaction.confirmation) return {
    allowed: true,
    allowedKinds: ['named-confirmation'],
    exactLabels: [interaction.confirmation.label],
    recheckRouterBeforeEndingTurn: true,
    requiredPresentation: interaction.confirmation.presentation?.renderPolicy,
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
  if (automatic) return { mode: 'no-user-input', allowed: [], genericContinueForbidden: true, terminalUserResponseAllowed: false, requiredTerminalResult: automatic.userVisibleResults, reason: `complete ${automatic.action} before asking the user anything; progress text cannot end the turn` };
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
  const confirmation = {
    gate1: { label: '确认需求与交付方案', unconfirmedInputPolicy: 'revise-current-gate1', presentation: { artifact: state.artifacts?.gate1Presentation, renderPolicy: 'chat-orientation-then-full-human-readable-artifact-not-summary', chatOrientation: { confirming: '确认 APEX 对需求方向、目标用户、范围边界、数据与 API、交付路径、质量门槛及风险假设的理解', reviewFocus: ['目标与成功标准是否正确', '页面、功能、数据和不包含项是否完整', 'Existing/Greenfield 判断及正式基线是否正确', '验收标准和风险是否可以接受'], afterApproval: '自动生成完整视觉方案，并在生成完毕后进入“确认视觉方案”', revisionBehavior: '未明确确认的任何意见都用于修订当前需求与交付方案，不进入下一阶段' }, requiredSections: gate1PresentationSections } },
    'visual-plan': { label: '确认视觉方案', unconfirmedInputPolicy: 'revise-current-visual-plan', presentation: { artifact: state.artifacts?.visualPlanPresentation, renderPolicy: 'chat-orientation-then-full-human-readable-artifact-not-summary', chatOrientation: { confirming: '确认页面的信息架构、布局、视觉 Token、组件、图标/图表、动效、响应式以及真实库来源与落地方式', reviewFocus: ['整体布局和视觉方向是否符合产品目标', '颜色、字体、间距、组件与数据表达是否协调', '真实来源、候选取舍和动效是否合理', 'Existing 改造收益或 Greenfield 选择依据是否清晰'], afterApproval: '自动生成并启动可访问的运行时 Demo，不再追加视觉确认', revisionBehavior: '未明确确认的任何意见都用于修订当前视觉方案，不生成 Demo' }, requiredSections: visualPlanPresentationSections } },
    stitch: { label: '确认 Stitch 内容', unconfirmedInputPolicy: 'revise-current-stitch', presentation: { artifacts: [state.artifacts?.stitchFreeze, state.artifacts?.stitchParityEvidence], renderPolicy: 'complete-candidate-differences-parity-sources-risks-and-adjustments' } },
    implementation: { label: '确认实施冻结', unconfirmedInputPolicy: 'revise-current-implementation', presentation: { artifacts: [state.artifacts?.visualBundle, state.artifacts?.implementationMap], renderPolicy: 'complete-code-targets-source-materialization-dependencies-verification-risks-and-adjustments' } }
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
  }
  if (confirmation?.presentation && checkpoint === 'visual-plan' && visualPlanFile) {
    confirmation.presentation.content = fs.readFileSync(visualPlanFile, 'utf8');
    confirmation.presentation.sha256 = sha256File(visualPlanFile);
    confirmation.presentation.contentRequiredInUserMessage = true;
  }
  if (checkpoint && !checkpointReady(state, runDir, checkpoint)) return { mode: 'no-user-input', allowed: [], checkpoint, confirmation: null, genericContinueForbidden: true, reason: `complete and validate the ${checkpoint} confirmation artifacts before exposing any user confirmation` };
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
  const state = run.state || stateOf(run.runDir);
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
  appendEvent(run.runDir, { type: 'action-authorized', sessionId, action, tokenId: token.tokenId, stateHash: token.stateHash }); json({ status: 'authorized', authorizationRef: reference, authorization: token, ...response });
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
    if (![state.artifacts.stitchFreeze, state.artifacts.stitchParityEvidence].every(reference => references.includes(reference))) fail('Stitch approval must freeze stitchFreeze and stitchParityEvidence');
  }
  if (gate === 'implementation') {
    if ((!state.locks?.stitchCurrent && !state.locks?.stitchSkipped) || !state.locks?.stitchApproved || !state.artifacts?.visualBundle || !state.artifacts?.implementationMap) fail('implementation approval requires confirmed current or explicitly skipped Stitch, Visual Bundle, and Implementation Map');
    if (![state.artifacts.visualBundle, state.artifacts.implementationMap].every(reference => references.includes(reference))) fail('implementation approval must freeze visualBundle and implementationMap');
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
  if (checkpoint === 'stitch') return [artifacts.stitchFreeze, artifacts.stitchParityEvidence];
  if (checkpoint === 'implementation') return [artifacts.visualBundle, artifacts.implementationMap];
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
  state.locks.stitchSkipped = true; state.locks.stitchApproved = true; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.phase = state.track === 'greenfield' ? 'G-07 COMPILE' : 'E-09 COMPILE'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  appendEvent(run.runDir, { type: 'stitch-stage-skipped-by-user', sessionId, decisionId, reason, receipt: relative });
  return { receipt: relative, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) };
}

function selectDeliveryRoute(root, run, sessionId, route, decisionId, reason, references) {
  const state = stateOf(run.runDir);
  const normalizedRoute = ['直接代码', '直接生成代码', '直接生成生产代码', '跳过 Stitch 生成代码'].includes(route) ? 'direct-code' : ['继续执行流程', '进入 Stitch', '走 Stitch'].includes(route) ? 'stitch' : route;
  if (!['stitch', 'direct-code'].includes(normalizedRoute) || !decisionId || !reason) fail('select-route requires stitch|direct-code (or its declared Chinese utterance), a decision id, and a reason');
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
  if (impact === 'non-baseline') {
    appendEvent(run.runDir, { type: 'prompt-revision-no-baseline-change', sessionId, checkpoint, reason, preserved: ['approvals', 'gate2', 'implementation-authority'] });
  } else if (checkpoint === 'gate1') {
    const previouslyApproved = state.gates?.gate1?.status === 'passed';
    const invalidated = invalidateVisualIntermediates(run.runDir, 'prompt-revision-gate1');
    const cleared = clearArtifactReferences(state, [...gate1DerivedArtifacts, ...visualAndImplementationArtifacts]);
    state.gates.gate1 = { status: previouslyApproved ? 'revoked' : 'pending', at: now(), evidence: [`prompt-revision:gate1`, reason] };
    state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['prompt-revision:gate1'] };
    state.gates.gate3 = { status: 'pending', at: null, evidence: [] };
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
    appendEvent(run.runDir, { type: 'gate1-reopened-for-material-revision', sessionId, reason, previouslyApproved, preserved: state.track === 'existing' ? ['projectInventory', 'existingBaseline', 'codeReference', 'pageSkeleton'] : [], cleared, invalidated });
  } else if (checkpoint === 'visual-plan' || checkpoint === 'visual' || (checkpoint === 'implementation' && impact === 'visible')) {
    const invalidated = invalidateVisualIntermediates(run.runDir, `prompt-revision-${checkpoint}`); state.locks.visualPlanApproved = false; state.locks.effectApproved = false; state.locks.visualApproved = false; state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.deliveryRoute = null; state.gates.gate2 = { status: 'revoked', at: now(), evidence: [`prompt-revision:${checkpoint}`] }; const cleared = clearArtifactReferences(state, visualAndImplementationArtifacts); state.phase = state.track === 'greenfield' ? 'G-04 VISUAL_PLAN' : 'E-06 VISUAL_PLAN'; appendEvent(run.runDir, { type: 'visual-reset', reason: `prompt-revision:${checkpoint}`, invalidated, cleared });
  } else if (checkpoint === 'stitch') {
    state.locks.stitchApproved = false; state.locks.stitchSkipped = false; state.locks.stitchCurrent = false; state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['prompt-revision:stitch'] }; state.phase = state.track === 'greenfield' ? 'G-06 SYNC_FREEZE' : 'E-08 SYNC_FREEZE';
  } else if (checkpoint === 'implementation' && !gate2Open) {
    state.locks.implementationApproved = false; state.locks.implementationAllowed = false; state.gates.gate2 = { status: 'revoked', at: now(), evidence: ['prompt-revision:implementation'] };
  } else if (checkpoint === 'implementation') {
    appendEvent(run.runDir, { type: 'post-gate2-implementation-revision-retained', sessionId, reason, preserved: ['gate2', 'implementation-authority'], gate3: 'must-revalidate' });
  }
  state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
  const revision = { at: now(), sessionId, checkpoint, impact, reason, stateRevision: state.revision };
  fs.appendFileSync(path.join(run.runDir, 'prompt-revisions.ndjson'), `${JSON.stringify(revision)}\n`); appendEvent(run.runDir, { type: 'prompt-revised', sessionId, checkpoint, impact, reason });
  return routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId);
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
    const [projectArg, runId, track, scope = 'standard', authorization = 'interactive', sessionId] = args;
    if (!projectArg || !runId || !['greenfield', 'existing', 'auto'].includes(track) || !sessionId) fail('usage: intake <project-root> <run-id> <greenfield|existing|auto> [lite|standard|full] [interactive|autonomous] <session-id>');
    const root = projectRoot(projectArg); ensureProject(root);
    const trackClassification = track === 'auto' ? classifyTrack(root) : { track, reason: 'explicit track requested by host', visualEntrypoint: null, preserveBackend: false };
    const result = runControllerCommand('init', [root, runId, trackClassification.track, scope, authorization]);
    if (result.status !== 0) fail((result.stderr || result.stdout).trim());
    const dir = runDir(root, runId); ['artifacts', 'approvals', 'evidence', 'locks', 'checkpoints'].forEach(name => fs.mkdirSync(path.join(dir, name), { recursive: true }));
    bindSession(root, sessionId, runId);
    appendEvent(dir, { type: 'run-created', sessionId: sessionId || null, track: trackClassification.track, requestedTrack: track, trackClassification, scope, authorization }); json({ status: 'created', trackClassification, ...routerState(root, { runId, runDir: dir }, sessionId) });
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
    appendEvent(dir, { type: 'run-restarted-from-entry', sessionId, replacedRunId: retired.runId, replacementReason: reason, retainedGate1, track: trackClassification.track, requestedTrack: track, trackClassification, scope, authorization });
    json({ status: 'restarted', replacedRunId: retired.runId, retainedGate1, trackClassification, ...routerState(root, { runId, runDir: dir }, sessionId) });
  } else if (command === 'reinvoke') {
    const [projectArg, sessionId, mode, runId, track, scope = 'standard', authorization = 'interactive', reason = 'user-submitted-a-second-request'] = args;
    if (!projectArg || !sessionId || !['continue', 'new-task'].includes(mode)) fail('usage: reinvoke <project-root> <session-id> <continue|new-task> [new-run-id greenfield|existing lite|standard|full interactive|autonomous reason]');
    const root = projectRoot(projectArg); ensureProject(root);
    const previousRunId = assertSessionBinding(root, sessionId);
    if (mode === 'continue') {
      const run = selectRun(root, previousRunId);
      appendEvent(run.runDir, { type: 'session-reinvoked', sessionId, disposition: 'continue', reason });
      json({ status: 'continued', disposition: 'continue', ...routerState(root, run, sessionId) });
    } else {
      if (!runId || !['greenfield', 'existing', 'auto'].includes(track)) fail('new-task reinvocation requires a new run id and track');
      const trackClassification = track === 'auto' ? classifyTrack(root) : { track, reason: 'explicit track requested by host', visualEntrypoint: null, preserveBackend: false };
      const result = runControllerCommand('init', [root, runId, trackClassification.track, scope, authorization]);
      if (result.status !== 0) fail((result.stderr || result.stdout).trim());
      const dir = runDir(root, runId); ['artifacts', 'approvals', 'evidence', 'locks', 'checkpoints'].forEach(name => fs.mkdirSync(path.join(dir, name), { recursive: true }));
      const retired = clearSessionHistory(root, sessionId, reason);
      bindSession(root, sessionId, runId);
      appendEvent(dir, { type: 'session-reinvoked', sessionId, disposition: 'new-task', replacedRunId: retired.runId, reason, track: trackClassification.track, requestedTrack: track, trackClassification, scope, authorization });
      json({ status: 'created', disposition: 'new-task', replacedRunId: retired.runId, trackClassification, ...routerState(root, { runId, runDir: dir }, sessionId) });
    }
  } else if (command === 'revise') {
    const [projectArg, requestedRunId, sessionId, checkpoint, impact, reason] = args;
    if (!projectArg || !requestedRunId || !sessionId || !checkpoint || !impact || !reason) fail('usage: revise <project-root> <run-id> <session-id> <gate1|visual-plan|visual|stitch|implementation> <visible|implementation-only|non-baseline> <reason>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'revision-recorded', ...recordPromptRevision(root, run, sessionId, checkpoint, impact, reason) });
  } else if (command === 'cancel') {
    const [projectArg, requestedRunId, sessionId, reason = 'cancelled-by-user'] = args;
    if (!projectArg || !requestedRunId || !sessionId) fail('usage: cancel <project-root> <run-id> <session-id> [reason]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId)); const state = stateOf(run.runDir);
    if (state.lifecycle === 'cancelled') { json({ status: 'cancelled', idempotent: true, ...routerState(root, run, sessionId) }); }
    else {
      state.lifecycle = 'cancelled'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = now(); write(path.join(run.runDir, 'state.json'), state);
      const releasedLease = releaseLeaseForRun(root, run, sessionId, 'run-cancelled'); appendEvent(run.runDir, { type: 'run-cancelled', sessionId, reason, releasedLease });
      json({ status: 'cancelled', idempotent: false, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) });
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
    const [projectArg, requestedRunId, sessionId] = args;
    if (!projectArg || !requestedRunId || !sessionId) fail('usage: register-runtime-demo <project-root> <run-id> <session-id>');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    json({ status: 'runtime-demo-registered', ...registerRuntimeDemo(root, run, sessionId) });
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
    json({ status: 'verified', authorization: verifyAuthorization(root, run, sessionId, reference, action), ...routerState(root, run, sessionId) });
  } else if (command === 'transition') {
    const [projectArg, requestedRunId, sessionId, authorizationRef, transition, ...transitionArgs] = args;
    if (!projectArg || !requestedRunId || !sessionId || !authorizationRef || !transition) fail('usage: transition <project-root> <run-id> <session-id> <authorization-ref> <open-gate2|pass-proof|open-gate3|revoke-stitch|checkpoint> [args...]');
    const root = projectRoot(projectArg); const run = selectRun(root, assertSessionBinding(root, sessionId, requestedRunId));
    const state = stateOf(run.runDir);
    const commandByTransition = { 'open-gate2': 'open-gate2', 'pass-proof': 'pass-proof', 'open-gate3': 'open-gate3', 'revoke-stitch': 'revoke-stitch', checkpoint: 'checkpoint' };
    const controllerCommand = commandByTransition[transition];
    if (!controllerCommand) fail(`unsupported transition: ${transition}`);
    const requiredAction = { 'open-gate2': 'open_gate2', 'pass-proof': 'pass_proof', 'open-gate3': 'open_gate3', 'revoke-stitch': 'revoke_visual', checkpoint: 'inspect_run' }[transition];
    if (!allowedActions(state, run.runDir).includes(requiredAction)) fail(`transition ${transition} is not allowed in phase ${state.phase}`);
    const token = read(authorizationFile(run, authorizationRef));
    const permittedActions = transition === 'revoke-stitch' ? ['revoke_visual', 'sync_stitch'] : [requiredAction];
    if (!permittedActions.includes(token.action)) fail(`authorization action ${token.action} cannot perform transition ${transition}`);
    verifyAuthorization(root, run, sessionId, authorizationRef, token.action);
    const result = runControllerCommand(controllerCommand, [run.runDir, ...transitionArgs]);
    if (result.status !== 0) fail((result.stderr || result.stdout).trim());
    appendEvent(run.runDir, { type: 'state-transition', sessionId, transition });
    json({ status: 'transitioned', transition, ...routerState(root, { ...run, state: stateOf(run.runDir) }, sessionId) });
  } else fail('commands: intake | restart | reinvoke | revise | cancel | skip | skip-stage | register-runtime-demo | select-route | handoff | resume-handoff | queue-mutation | claim-mutation | review | resume | status | lease | authorize | approve | verify-authorization | transition');
} catch (error) { fail(error.message); }
