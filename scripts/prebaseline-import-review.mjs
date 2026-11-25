import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { currentImportInspection } from './existing-import-inspection.mjs';

const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
export const PREBASELINE_REVIEWER_ID = 'prebaseline-codebase-onboarding-engineer';

// A bounded projection is the Agent's context; the full inspection stays
// hash-bound in the ledger and is revalidated before accepting any advisory.
export function prebaselineReviewContext(runDir, projectRoot, reference) {
  const current = currentImportInspection(runDir, projectRoot, reference);
  if (current.status !== 'current-unverified') throw new Error(`prebaseline import inspection is not current: ${current.reason || current.status}`);
  const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, reference));
  if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('prebaseline inspection is outside the Run or exceeds its size limit');
  const bytes = fs.readFileSync(file), digest = hash(bytes);
  if (path.basename(file) !== `imports-${digest.slice('sha256:'.length)}.json`) throw new Error('prebaseline inspection content identity changed');
  const inspection = JSON.parse(bytes.toString('utf8'));
  if (!inspection.unresolvedImports.length) throw new Error('prebaseline import review is not needed when no unresolved references were detected');
  if (inspection.unresolvedImports.length > 50) throw new Error('prebaseline import review exceeds 50 references; bounded batching is required');
  const context = { inspection: reference, inspectionSha256: digest, scope: inspection.scope, requirementRevision: inspection.requirementRevision, unresolvedImports: inspection.unresolvedImports };
  if (Buffer.byteLength(JSON.stringify(context)) > 64 * 1024) throw new Error('prebaseline import review context exceeds 64 KiB; bounded batching is required');
  return { inspection, context };
}

export function validatePrebaselineImportReviews(runDir, projectRoot, reference, reviews, prepared = null) {
  const { inspection } = prepared || prebaselineReviewContext(runDir, projectRoot, reference);
  if (prepared) {
    const root = fs.realpathSync(runDir);
    if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new Error('prebaseline inspection reference is invalid');
    const file = fs.realpathSync(path.resolve(root, reference));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('prebaseline inspection is outside the Run or exceeds its size limit');
    const bytes = fs.readFileSync(file);
    if (prepared.context?.inspection !== reference || prepared.context.inspectionSha256 !== hash(bytes) || JSON.stringify(JSON.parse(bytes.toString('utf8'))) !== JSON.stringify(inspection)) throw new Error('prepared prebaseline inspection no longer matches its source');
  }
  if (!Array.isArray(reviews) || reviews.length !== inspection.unresolvedImports.length) throw new Error('the analyst must review each unresolved import exactly once');
  const sourceHashes = new Map(inspection.sourceObservations.map(item => [item.path, item.sha256]));
  const expected = new Set(inspection.unresolvedImports.map(item => JSON.stringify([item.source, item.reference]))), seen = new Set();
  if (expected.size !== inspection.unresolvedImports.length) throw new Error('inspection has duplicate unresolved import identities');
  const project = fs.realpathSync(projectRoot), sourceContents = new Map();
  for (const item of reviews) {
    const key = JSON.stringify([item?.source, item?.reference]);
    if (!expected.has(key) || seen.has(key)) throw new Error('import review has an unknown or duplicate reference');
    seen.add(key);
    if (!['optional-candidate', 'shadowed-candidate', 'requires-resolution', 'unverified'].includes(item.decision) || typeof item.rationale !== 'string' || item.rationale.trim().length < 24 || item.rationale.length > 4000 || typeof item.sourceExcerpt !== 'string' || item.sourceExcerpt.trim().length < 8 || item.sourceExcerpt.length > 2000) throw new Error('import review requires a bounded decision, rationale and source excerpt');
    if (typeof item.source !== 'string' || path.isAbsolute(item.source)) throw new Error('import review source is invalid');
    if (!sourceContents.has(item.source)) {
      const file = path.resolve(project, item.source), real = fs.realpathSync(file);
      if (!file.startsWith(`${project}${path.sep}`) || !real.startsWith(`${project}${path.sep}`) || !fs.statSync(real).isFile()) throw new Error('import review source is outside the project');
      const bytes = fs.readFileSync(real);
      if (hash(bytes) !== sourceHashes.get(item.source)) throw new Error('import review source changed after inspection');
      sourceContents.set(item.source, bytes.toString('utf8'));
    }
    if (!sourceContents.get(item.source).includes(item.sourceExcerpt)) throw new Error('import review excerpt is not present in the inspected source');
  }
  if (currentImportInspection(runDir, projectRoot, reference).status !== 'current-unverified') throw new Error('prebaseline import inspection changed during review validation');
  return { status: 'professional-judgment-unverified', reviewedCount: seen.size, permitsBaseline: false };
}
