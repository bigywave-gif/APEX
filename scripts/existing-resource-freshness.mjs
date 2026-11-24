import fs from 'node:fs';
import path from 'node:path';

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
