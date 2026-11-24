import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ledgerBoundOutput } from './verification-policy.mjs';

/** Unknown assets remain explicit; an empty static list is not a visual audit. */
export function resourceCoverage(reference) {
  if (reference.unresolvedResources === undefined) return { status: 'not-recorded', unresolvedCount: null };
  if (!Array.isArray(reference.unresolvedResources)) throw new Error('unresolved resource list is invalid');
  return { status: reference.unresolvedResources.length ? 'unverified' : 'no-unresolved-detected', unresolvedCount: reference.unresolvedResources.length };
}
export function assertResourceCoverage(reference, baseline) {
  const actual = baseline?.codeReference?.resourceCoverage;
  if (actual === undefined) return { status: 'not-recorded', unresolvedCount: null }; // Historical baselines retain their original contract.
  const expected = resourceCoverage(reference);
  if (actual.status !== expected.status || actual.unresolvedCount !== expected.unresolvedCount) throw new Error('Existing baseline resource coverage does not match its source reference');
  return expected;
}

/** The baseline analyst assesses each unresolved reference against frozen scope. */
export function validateResourceReviews(reference, reviews) {
  const resources = reference.unresolvedResources || [];
  if (!Array.isArray(resources)) throw new Error('unresolved resource list is invalid');
  if (!resources.length) return { status: 'not-required', pending: [] };
  if (!Array.isArray(reviews) || reviews.length !== resources.length) throw new Error('baseline analyst must review every unresolved resource');
  const expected = new Set(resources.map(item => JSON.stringify([item.source, item.reference]))), seen = new Set(), pending = [];
  if (expected.size !== resources.length) throw new Error('unresolved resource identities are duplicated');
  for (const item of reviews) {
    const key = JSON.stringify([item?.source, item?.reference]);
    if (!expected.has(key) || seen.has(key)) throw new Error('resource review has an unknown or duplicate reference');
    seen.add(key);
    if (!['out-of-scope', 'requires-verification'].includes(item.decision) || typeof item.rationale !== 'string' || item.rationale.trim().length < 12 || !Array.isArray(item.evidence) || !['codeReference', 'existingBaseline', 'changeScope'].every(name => item.evidence.includes(name))) throw new Error('resource review requires a scope decision, concrete rationale and frozen baseline evidence');
    if (item.decision === 'requires-verification') pending.push({ source: item.source, reference: item.reference });
  }
  return { status: pending.length ? 'unverified' : 'reviewed-out-of-scope', pending };
}

/** Read a current, receipt-bound baseline analyst decision; never infer one. */
export function currentResourceReview(runDir, state) {
  if (state.track !== 'existing' || state.roleChain?.confirmationModel !== 'two-confirmations') return { status: 'not-required', pending: [] };
  const root = fs.realpathSync(runDir);
  const local = ref => {
    if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) throw new Error('resource review artifact must be Run-local');
    const file = fs.realpathSync(path.resolve(root, ref));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('resource review artifact is outside the Run');
    return file;
  };
  const read = ref => JSON.parse(fs.readFileSync(local(ref), 'utf8'));
  const hash = ref => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(local(ref))).digest('hex')}`;
  const baseline = read(state.artifacts?.existingBaseline), reference = read(state.artifacts?.codeReference);
  if (baseline.codeReference?.resourceReviewProtocol !== '1.0') return { status: 'not-required', pending: [] };
  if (!Array.isArray(reference.unresolvedResources)) throw new Error('resource inventory was not recorded; recapture the Existing source reference');
  if (!reference.unresolvedResources.length) return { status: 'not-required', pending: [] };
  assertResourceCoverage(reference, baseline);
  const manifest = read(state.artifacts?.roleAdvisoryManifest), entry = manifest.stages?.baseline?.advisories?.find(item => item.roleId === 'existing-baseline-analyst');
  if (!entry || hash(entry.path) !== entry.sha256) throw new Error('current baseline analyst resource review is missing or stale');
  const receipt = read(entry.operationReceipt);
  if (receipt.status !== 'succeeded' || receipt.action !== 'collect_existing_baseline' || receipt.script !== 'role-advisory.mjs' || receipt.outputFileHashes?.[entry.path] !== entry.sha256 || !ledgerBoundOutput(runDir, receipt, entry.path, entry.sha256)) throw new Error('baseline analyst resource review lacks a successful controlled receipt or ledger binding');
  const advisory = read(entry.path);
  for (const artifact of ['codeReference', 'existingBaseline', 'changeScope']) {
    const binding = advisory.inputBindings?.find(item => item.artifact === artifact);
    if (!binding || binding.path !== state.artifacts?.[artifact] || binding.sha256 !== hash(binding.path)) throw new Error(`baseline analyst resource review input is stale: ${artifact}`);
  }
  return validateResourceReviews(reference, advisory.resourceReviews);
}

/** A previously absent local resource becoming available changes the baseline. */
export function newlyAvailableResources(reference, projectRoot, allowed = new Set()) {
  const root = path.resolve(projectRoot), result = new Set();
  for (const item of reference.unresolvedResources || []) {
    if (!Array.isArray(item?.candidates)) throw new Error('unresolved resource candidates are invalid');
    for (const candidate of item.candidates) {
      if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate)) throw new Error('unresolved resource candidate is invalid');
      const absolute = path.resolve(root, candidate);
      if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error('unresolved resource candidate escapes the project');
      if (!allowed.has(candidate) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) result.add(candidate);
    }
  }
  return [...result].sort();
}

export function newlyAvailableConfigs(reference, projectRoot, allowed = new Set()) {
  if (reference.absentConfigCandidates === undefined) return [];
  if (!Array.isArray(reference.absentConfigCandidates)) throw new Error('absent configuration candidates are invalid');
  const root = path.resolve(projectRoot), result = new Set();
  for (const candidate of reference.absentConfigCandidates) {
    if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate) || !['package.json', 'tsconfig.json'].includes(path.basename(candidate))) throw new Error('absent configuration candidate is invalid');
    const file = path.resolve(root, candidate);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('absent configuration candidate escapes the project');
    try { fs.lstatSync(file); if (!allowed.has(candidate)) result.add(candidate); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  return [...result].sort();
}
