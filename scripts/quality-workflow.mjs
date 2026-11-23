import fs from 'node:fs';import path from 'node:path';
import {controlledOutput} from './verification-policy.mjs';
import {measurementContextCurrent,qualityEvidenceCurrent} from './quality-measurement-lib.mjs';
import {visualQualityEvidence} from './visual-quality-evidence.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function artifactFile(runDir,reference){if(typeof reference!=='string'||!reference||path.isAbsolute(reference))return null;const root=fs.realpathSync(runDir),file=path.resolve(root,reference);if(!fs.existsSync(file))return null;const actual=fs.realpathSync(file);return actual.startsWith(`${root}${path.sep}`)&&fs.statSync(actual).isFile()?actual:null;}
export function qualityVerificationPending(state, runDir) {
  if (state.roleChain?.confirmationModel !== 'two-confirmations') return null;
  try {
    const contractFile = artifactFile(runDir, state.artifacts?.deliveryContract);
    if (!contractFile) return { kind: 'quality', stage: 'invalid' };
    const contract = read(contractFile), requirements = new Set(contract.verificationRequirements || []);
    if (requirements.has('visual')) {
      const evidenceRef = 'evidence/visual-verification.json', evidenceFile = artifactFile(runDir, evidenceRef);
      if (visualQualityEvidence(runDir, state).status !== 'passed') return { kind: 'visual', stage: 'parity' };
      if (!evidenceFile || !controlledOutput(runDir, evidenceRef, ['quality-evidence.mjs']) || read(evidenceFile).scope !== 'design-fidelity-only' || read(evidenceFile).status !== 'passed') return { kind: 'visual', stage: 'evidence' };
    }
    for (const kind of ['accessibility', 'performance']) {
      if (!requirements.has(kind)) continue;
      const measurementRef = `evidence/${kind}-measurement.json`, measurementFile = artifactFile(runDir, measurementRef);
      if (!measurementFile || !controlledOutput(runDir, measurementRef, ['quality-measurement.mjs']) || !measurementContextCurrent(runDir, state, read(measurementFile))) return { kind, stage: 'measurement' };
      const evidenceRef = `evidence/${kind}-verification.json`, evidenceFile = artifactFile(runDir, evidenceRef);
      if (!evidenceFile || !controlledOutput(runDir, evidenceRef, ['quality-evidence.mjs']) || !qualityEvidenceCurrent(runDir, state, read(evidenceFile), kind, contract)) return { kind, stage: 'evidence' };
    }
    return null;
  } catch { return { kind: 'quality', stage: 'invalid' }; }
}
