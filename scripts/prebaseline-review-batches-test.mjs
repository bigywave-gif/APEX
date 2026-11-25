import assert from 'node:assert/strict';
import { partitionPrebaselineReviewContext, PREBASELINE_BATCH_MAX_BYTES, PREBASELINE_BATCH_MAX_ITEMS } from './prebaseline-import-review.mjs';
const context = { inspection: 'inspections/imports-test.json', inspectionSha256: `sha256:${'a'.repeat(64)}`, scope: { inputReference: 'scope.json', routes: ['/'] }, requirementRevision: { observed: 'absent', authorized: 'absent' }, unresolvedImports: Array.from({ length: 127 }, (_, index) => ({ source: `src/file-${index}.js`, reference: './missing-module', candidates: [{ path: `src/missing-${index}.js`, state: 'absent' }] })) };
const batches = partitionPrebaselineReviewContext(context);
assert.equal(batches.length, 3);
assert.deepEqual(batches.flatMap(batch => batch.unresolvedImports), context.unresolvedImports);
assert.deepEqual(batches.map(batch => batch.batch), [{ index: 1, count: 3, totalReferences: 127 }, { index: 2, count: 3, totalReferences: 127 }, { index: 3, count: 3, totalReferences: 127 }]);
assert.deepEqual(partitionPrebaselineReviewContext(context), batches, 'batching must be deterministic');
for (const batch of batches) {
  assert.ok(batch.unresolvedImports.length <= PREBASELINE_BATCH_MAX_ITEMS);
  assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= PREBASELINE_BATCH_MAX_BYTES);
  assert.equal(batch.inspectionSha256, context.inspectionSha256);
}
const largeEntries = { ...context, unresolvedImports: context.unresolvedImports.slice(0, 3).map(item => ({ ...item, padding: '界'.repeat(10000) })) };
const byteBatches = partitionPrebaselineReviewContext(largeEntries);
assert.equal(byteBatches.length, 2, 'UTF-8 bytes, not character count, must control grouping');
assert.deepEqual(byteBatches.flatMap(batch => batch.unresolvedImports), largeEntries.unresolvedImports);
assert.ok(byteBatches.every(batch => Buffer.byteLength(JSON.stringify(batch)) <= PREBASELINE_BATCH_MAX_BYTES));
assert.throws(() => partitionPrebaselineReviewContext({ ...context, unresolvedImports: [{ ...context.unresolvedImports[0], padding: 'x'.repeat(PREBASELINE_BATCH_MAX_BYTES) }] }), /single prebaseline reference exceeds/);
assert.throws(() => partitionPrebaselineReviewContext({ ...context, unresolvedImports: [context.unresolvedImports[0], context.unresolvedImports[0]] }), /duplicate references/);
assert.throws(() => partitionPrebaselineReviewContext({ ...context, unresolvedImports: [] }), /invalid/);
console.log(JSON.stringify({ status: 'passed', test: 'prebaseline-review-batches' }));
