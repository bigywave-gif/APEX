import fs from 'node:fs';
import path from 'node:path';

/** Validate coverage and provenance links; product judgment remains human/role work. */
export function validateRequirementReview(runDir, state, review, requestCoverage) {
  const root = fs.realpathSync(runDir);
  const read = name => {
    const ref = state.artifacts?.[name];
    if (typeof ref !== 'string' || !ref || path.isAbsolute(ref)) throw new Error(`requirement review input is missing: ${name}`);
    const file = fs.realpathSync(path.resolve(root, ref));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error(`requirement review input is outside the Run: ${name}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const intent = read('intentBrief'), strategy = read('experienceStrategy'), implementation = read('implementationMap'), provenance = read('evidenceProvenance');
  if (typeof intent.sourceRequest !== 'string' || !intent.sourceRequest.trim() || !['covered', 'uncovered', 'unverified'].includes(requestCoverage?.verdict) || typeof requestCoverage.rationale !== 'string' || requestCoverage.rationale.trim().length < 20 || !Array.isArray(requestCoverage.unmappedRequirements) || requestCoverage.unmappedRequirements.some(item => typeof item !== 'string' || !item.trim())) throw new Error('product review must assess the recorded request and leave no unmapped requirements');
  if (requestCoverage.verdict !== 'covered' || requestCoverage.unmappedRequirements.length) throw new Error(`recorded request coverage is ${requestCoverage.verdict}; unmapped requirements: ${requestCoverage.unmappedRequirements.join('；') || 'not determined'}`);
  const expected = new Map();
  for (const source of ['successCriteria', 'acceptance']) {
    if (!Array.isArray(intent[source]) || !intent[source].length || intent[source].some(item => typeof item !== 'string' || !item.trim())) throw new Error(`intent ${source} is missing or invalid`);
    intent[source].forEach((criterion, index) => expected.set(`${source}:${index}`, criterion));
  }
  if (!Array.isArray(strategy.functionalPlan) || !strategy.functionalPlan.length || !Array.isArray(implementation.entries) || !implementation.entries.length || provenance.status !== 'passed' || !Array.isArray(provenance.entries)) throw new Error('product plan, implementation map or passed provenance is missing');
  const tasks = new Set(strategy.functionalPlan.map(item => item.task)), targets = new Set(implementation.entries.flatMap(item => Array.isArray(item.runtimeTarget) ? item.runtimeTarget : []));
  const evidence = new Map();
  for (const entry of provenance.entries) {
    if (!entry.id || evidence.has(entry.id)) throw new Error('provenance evidence IDs are missing or duplicated');
    evidence.set(entry.id, entry);
  }
  if (!Array.isArray(review) || review.length !== expected.size) throw new Error('product requirement review must cover every success criterion and acceptance item exactly once');
  const seen = new Set();
  for (const item of review) {
    const key = `${item?.source}:${item?.index}`;
    if (!Number.isInteger(item?.index) || item.index < 0 || !expected.has(key) || seen.has(key) || item.criterion !== expected.get(key)) throw new Error('requirement review has a duplicate, unknown or changed criterion');
    seen.add(key);
    if (!['passed', 'failed', 'unverified', 'not-applicable'].includes(item.verdict) || typeof item.rationale !== 'string' || item.rationale.trim().length < 12 || typeof item.implementationRationale !== 'string' || item.implementationRationale.trim().length < 12) throw new Error(`requirement review needs a justified outcome and implementation assessment: ${key}`);
    if (['failed', 'unverified'].includes(item.verdict)) throw new Error(`requirement ${key} is ${item.verdict}: ${item.rationale}`);
    if (!Array.isArray(item.productTasks) || item.productTasks.some(task => !tasks.has(task)) || !Array.isArray(item.implementationTargets) || item.implementationTargets.some(target => !targets.has(target))) throw new Error(`requirement review references an unknown task or implementation target: ${key}`);
    if (!Array.isArray(item.evidenceIds) || !item.evidenceIds.length || new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => evidence.get(id)?.result !== 'passed')) throw new Error(`requirement review requires current passed evidence IDs: ${key}`);
  }
  return { status: 'passed', reviewed: seen.size };
}
