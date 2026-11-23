import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The shared advisory manifest also changes when later stages finish. Bind
// the Gate 1 presentation to its own immutable summary, not that manifest.
function roleSummaryCurrent(state, runDir, stage, source) {
  if (!state.roleChain?.enabled) return true;
  const current = state.artifacts?.roleDecisionSummaries?.[stage];
  if (!current || source?.path !== current || typeof source.sha256 !== 'string') return false;
  try {
    const root = fs.realpathSync(runDir);
    const file = fs.realpathSync(path.resolve(root, current));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile()) return false;
    return source.sha256 === `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  } catch { return false; }
}

export const gate1RoleSummaryCurrent = (state, runDir, manifest) => roleSummaryCurrent(state, runDir, 'gate1', manifest.sources?.roleDecisionSummary);
export const visualRoleSummaryCurrent = (state, runDir, manifest) => roleSummaryCurrent(state, runDir, 'visual', { path: manifest.roleDecisionSummary, sha256: manifest.roleDecisionSummarySha256 });

export function approvedRoleSummariesCurrent(state, runDir) {
  for (const [name, check] of [['gate1PresentationManifest', gate1RoleSummaryCurrent], ['visualPlanPresentationManifest', visualRoleSummaryCurrent]]) {
    const reference = state.artifacts?.[name];
    if (!reference) continue;
    try {
      const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, reference));
      if (!file.startsWith(`${root}${path.sep}`) || !check(state, runDir, JSON.parse(fs.readFileSync(file, 'utf8')))) return false;
    } catch { return false; }
  }
  return true;
}
