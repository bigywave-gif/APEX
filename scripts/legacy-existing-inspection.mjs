import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { currentImportInspection } from './existing-import-inspection.mjs';

const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const normalized = values => [...new Set(values)].sort();
// Supplements the original approved baseline; it never changes the plan,
// approval, old reference, or the scope of the approved implementation.
export function legacyExistingInspection(runDir, state, { allowedSourceChanges = new Set() } = {}) {
  try {
    const root = fs.realpathSync(runDir), project = fs.realpathSync(path.resolve(root, '..', '..', '..'));
    const local = reference => {
      if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new Error('invalid Run-local reference');
      const file = fs.realpathSync(path.resolve(root, reference));
      if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('reference is outside the Run');
      return file;
    };
    if (state.track !== 'existing' || state.roleChain?.confirmationModel !== 'two-confirmations' || state.gates?.gate1?.status !== 'passed' || !state.locks?.visualPlanApproved) throw new Error('no approved Existing visual plan');
    const oldReference = JSON.parse(fs.readFileSync(local(state.artifacts?.codeReference), 'utf8'));
    if (oldReference.complete !== true || oldReference.importInspection === 'literal-relative-script-v5' || fs.realpathSync(oldReference.projectRoot) !== project || !Array.isArray(oldReference.files) || !oldReference.files.length) throw new Error('legacy source reference is invalid');
    const approvalRefs = (state.gates.gate1.evidence || []).filter(ref => /^approvals\/visual-plan-[^/]+\.json$/.test(ref));
    if (approvalRefs.length !== 1) throw new Error('original visual approval is missing');
    const approval = JSON.parse(fs.readFileSync(local(approvalRefs[0]), 'utf8'));
    const projectId = `project_${crypto.createHash('sha256').update(project).digest('hex').slice(0, 24)}`;
    if (approval.schemaVersion !== '3.0' || approval.status !== 'approved' || approval.gate !== 'visual-plan' || approval.scope !== 'requirements-and-visual-plan' || approval.runId !== state.runId || approval.projectId !== projectId || Number(approval.confirmationEpoch || 0) !== Number(state.confirmationEpochs?.['visual-plan'] || 0) || !Array.isArray(approval.artifactHashes)) throw new Error('original visual approval is invalid');
    const approvals = new Map();
    for (const item of approval.artifactHashes) { if (approvals.has(item.path) || hash(fs.readFileSync(local(item.path))).slice('sha256:'.length) !== item.sha256) throw new Error('original approval artifact changed'); approvals.set(item.path, item.sha256); }
    for (const key of ['visualExecutionPlan', 'visualPlanPresentation', 'intentBrief', 'deliveryContract']) if (!state.artifacts?.[key] || !approvals.has(state.artifacts[key])) throw new Error('original approval artifact is missing');
    const inspectionRef = state.artifacts?.unresolvedImportInspection;
    const current = currentImportInspection(root, project, inspectionRef, { allowedSourceChanges, allowLegacySnapshot: state.gates?.gate2?.status === 'passed' });
    if (current.status !== 'current-unverified' || current.unresolvedCount !== 0) throw new Error(`supplemental import inspection is not current and clean: ${current.reason || current.status}`);
    const inspection = JSON.parse(fs.readFileSync(local(inspectionRef), 'utf8'));
    if (!Array.isArray(inspection.unresolvedResources) || inspection.unresolvedResources.length) throw new Error(`supplemental resource coverage is incomplete: ${Array.isArray(inspection.unresolvedResources) ? inspection.unresolvedResources.length : 'not recorded'}`);
    if (!Array.isArray(oldReference.scope?.routes) || !Array.isArray(oldReference.scope?.entrypoints) || JSON.stringify(normalized(oldReference.scope.routes)) !== JSON.stringify(normalized(inspection.scope.routes)) || JSON.stringify(normalized(oldReference.scope.entrypoints)) !== JSON.stringify(normalized(inspection.scope.entrypoints))) throw new Error('supplemental inspection does not cover the approved baseline scope');
    const observed = new Map(inspection.sourceObservations.map(item => [item.path, item.sha256]));
    if (observed.size !== inspection.sourceObservations.length || oldReference.files.some(item => observed.get(item.path) !== item.sha256 || hash(fs.readFileSync(local(item.copyPath))) !== item.sha256)) throw new Error('supplemental inspection does not match the original immutable reference');
    return { ready: true, inspection: inspectionRef, inspectionSha256: hash(fs.readFileSync(local(inspectionRef))), approval: approvalRefs[0] };
  } catch (error) { return { ready: false, reason: error.message }; }
}

// Gate 2 may legitimately change production targets. Reconstruct the old
// project only from its original immutable files, and verify that every
// non-target source still equals that original. The caller must separately
// validate the original Demo confirmation and authorize the recovery action.
export function legacyExistingSnapshotInputs(runDir, state) {
  try {
    const root = fs.realpathSync(runDir), project = fs.realpathSync(path.resolve(root, '..', '..', '..'));
    const local = reference => {
      if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new Error('invalid Run-local reference');
      const file = fs.realpathSync(path.resolve(root, reference));
      if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('reference is outside the Run');
      return file;
    };
    if (state.track !== 'existing' || state.roleChain?.confirmationModel !== 'two-confirmations' || state.gates?.gate2?.status !== 'passed' || !state.locks?.implementationAllowed || !state.locks?.visualPlanApproved) throw new Error('no approved Gate 2 Existing run');
    const referenceRef = state.artifacts?.codeReference, referenceFile = local(referenceRef), reference = JSON.parse(fs.readFileSync(referenceFile));
    if (reference.complete !== true || reference.importInspection === 'literal-relative-script-v5' || fs.realpathSync(reference.projectRoot) !== project || !Array.isArray(reference.files) || !reference.files.length || reference.files.length > 20000 || !Array.isArray(reference.scope?.routes) || !reference.scope.routes.length || !Array.isArray(reference.scope?.entrypoints) || !reference.scope.entrypoints.length) throw new Error('legacy source reference is invalid');
    const scopeRef = state.artifacts?.changeScope, mapRef = state.artifacts?.implementationMap, scopeBytes = fs.readFileSync(local(scopeRef)), mapBytes = fs.readFileSync(local(mapRef)), scope = JSON.parse(scopeBytes), map = JSON.parse(mapBytes);
    if (map.scopeControl?.changeScopeHash !== hash(scopeBytes) || map.scopeControl?.implementationPolicy !== 'deny-outside-change-closure' || !Array.isArray(scope.affected?.runtimeTargets) || !Array.isArray(map.entries)) throw new Error('approved implementation scope is invalid');
    const targets = new Set(scope.affected.runtimeTargets);
    for (const target of targets) if (typeof target !== 'string' || !target || path.isAbsolute(target) || !path.resolve(project, target).startsWith(`${project}${path.sep}`)) throw new Error('approved implementation target is invalid');
    for (const entry of map.entries) if (!Array.isArray(entry.runtimeTarget) || entry.runtimeTarget.some(target => !targets.has(target))) throw new Error('implementation map escapes the approved scope');
    const originals = new Map(reference.files.map(item => [item.path, item.sha256]));
    const protectedFiles = new Map((scope.protected?.files || []).map(item => [item.path, item.sha256]));
    if (originals.size !== reference.files.length || [...targets].some(target => !originals.has(target)) || [...originals].some(([name, digest]) => !targets.has(name) && protectedFiles.get(name) !== digest) || [...protectedFiles.keys()].some(name => !originals.has(name) || targets.has(name))) throw new Error('approved scope does not protect the exact original source complement');
    const seen = new Set(); let totalBytes = 0;
    for (const item of reference.files) {
      if (typeof item.path !== 'string' || !item.path || path.isAbsolute(item.path) || seen.has(item.path)) throw new Error('legacy source path is invalid');
      seen.add(item.path);
      const source = fs.realpathSync(path.resolve(project, item.path)), copy = local(item.copyPath);
      if (!source.startsWith(`${project}${path.sep}`) || !fs.statSync(source).isFile() || hash(fs.readFileSync(copy)) !== item.sha256) throw new Error(`original immutable source is invalid: ${item.path}`);
      if (!targets.has(item.path) && hash(fs.readFileSync(source)) !== item.sha256) throw new Error(`source changed outside the approved scope: ${item.path}`);
      totalBytes += fs.statSync(copy).size; if (totalBytes > 512 * 1024 * 1024) throw new Error('legacy snapshot exceeds 512 MiB');
    }
    return { ready: true, project, reference: { path: referenceRef, sha256: hash(fs.readFileSync(referenceFile)) }, scope: { path: scopeRef, sha256: hash(scopeBytes) }, implementationMap: { path: mapRef, sha256: hash(mapBytes) }, routes: reference.scope.routes, entrypoints: reference.scope.entrypoints, files: reference.files, allowedTargets: [...targets].sort(), totalBytes };
  } catch (error) { return { ready: false, reason: error.message }; }
}
