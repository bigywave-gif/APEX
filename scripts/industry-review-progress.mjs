import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function industryReviewFailures(state, runDir) {
  try {
    const resolve = reference => {
      if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) return null;
      const root = fs.realpathSync(runDir), candidate = fs.realpathSync(path.resolve(root, reference));
      return candidate.startsWith(root + path.sep) && fs.statSync(candidate).isFile() ? candidate : null;
    };
    const evidenceFile = resolve(state.artifacts?.industryBenchmarkEvidence), plan = resolve(state.artifacts?.visualExecutionPlan), provenance = resolve(state.artifacts?.evidenceProvenance);
    if (!evidenceFile || !plan || !provenance) return [];
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    if (!['failed', 'unverified'].includes(evidence.status) || evidence.visualPlanHash !== hash(plan) || evidence.provenanceHash !== hash(provenance) || !Array.isArray(evidence.scores)) return [];
    const review = resolve(evidence.reviewPath), receiptFile = resolve(evidence.reviewReceipt);
    if (!review || !receiptFile || !receiptFile.startsWith(fs.realpathSync(path.join(runDir, 'operations')) + path.sep)) return [];
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    if (receipt.status !== 'failed' || receipt.action !== 'verify' || receipt.script !== 'industry-benchmark.mjs' || receipt.outputFileHashes?.[state.artifacts.industryBenchmarkEvidence] !== hash(evidenceFile) || receipt.inputFileHashes?.[evidence.reviewPath] !== hash(review) || evidence.reviewHash !== hash(review)) return [];
    return evidence.scores.filter(item => ['failed', 'unverified'].includes(item.result) && typeof item.criterion === 'string').map(item => ({criterion:item.criterion, result:item.result}));
  } catch { return []; }
}
