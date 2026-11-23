import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function apiInput(runDir, reference) {
  if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new Error('API evidence input must be Run-local');
  const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, reference));
  if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error('API evidence input must be a Run-local file');
  return { reference, sha256: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}` };
}
export function apiContractEvidenceCurrent(runDir, state, evidence) {
  try {
    if (evidence?.scope !== 'supplied-samples-only' || !Array.isArray(evidence.inputBindings) || evidence.inputBindings.length < 3) return false;
    const contractRef = state.artifacts?.apiContract || 'api-contract.json';
    if (evidence.contractRef !== contractRef || !evidence.samplesRef || !evidence.inputBindings.some(item => item.reference === contractRef) || !evidence.inputBindings.some(item => item.reference === evidence.samplesRef)) return false;
    const contract = JSON.parse(fs.readFileSync(path.join(runDir, contractRef), 'utf8'));
    if (!Array.isArray(contract.endpoints) || !contract.endpoints.length) return false;
    const references = new Set([contractRef, evidence.samplesRef, ...contract.endpoints.flatMap(endpoint => [endpoint.requestSchema, endpoint.responseSchema])]);
    if (evidence.inputBindings.length !== references.size) return false;
    return [...references].every(ref => { const binding = evidence.inputBindings.find(item => item.reference === ref); return binding && apiInput(runDir, ref).sha256 === binding.sha256; });
  } catch { return false; }
}

export function apiContractEvidenceAssessment(runDir, state, evidence) {
  if (!apiContractEvidenceCurrent(runDir, state, evidence)) return { status: 'unverified', reason: 'API contract, schemas or samples are missing or stale' };
  return { status: 'unverified', reason: 'supplied samples do not establish actual API execution or response provenance' };
}
