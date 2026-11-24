import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Only a missing artifact whose complete Run-relative path and content match
// an archived version may be retired during recovery.
export function archivedMissingReferences(runDir, issues, events = [], state = {}) {
  const root = path.resolve(runDir), invalidated = path.join(root, 'invalidated');
  const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const activeReferences = new Set([...strings(state.artifacts), ...strings(state.gates)]);
  if (!fs.existsSync(invalidated) || !fs.statSync(invalidated).isDirectory()) return [];
  const realArchive = fs.realpathSync(invalidated), matches = [];
  if (!realArchive.startsWith(`${fs.realpathSync(root)}${path.sep}`)) return [];
  for (const issue of issues || []) {
    if (issue.type !== 'registered-artifact-missing' || typeof issue.reference !== 'string' || path.isAbsolute(issue.reference) || !/^sha256:[a-f0-9]{64}$/.test(issue.expectedSha256 || '') || !Number.isFinite(Date.parse(issue.registeredAt))) continue;
    if ([...activeReferences].some(reference => issue.reference === reference || issue.reference.startsWith(`${reference}/`))) continue;
    const target = path.resolve(root, issue.reference);
    if (!target.startsWith(`${root}${path.sep}`) || fs.existsSync(target)) continue;
    for (const epoch of fs.readdirSync(invalidated, { withFileTypes: true })) {
      if (!epoch.isDirectory()) continue;
      const directory = path.join(invalidated, epoch.name), candidate = path.resolve(directory, issue.reference);
      if (!candidate.startsWith(`${directory}${path.sep}`) || !fs.existsSync(candidate)) continue;
      const authorized = events.some(event => {
        const recordedAt = Date.parse(event?.recordedAt);
        if (!Number.isFinite(recordedAt) || recordedAt <= Date.parse(issue.registeredAt) || typeof event.archive !== 'string' || path.resolve(root, event.archive) !== directory || !Array.isArray(event.artifacts)) return false;
        return event.artifacts.some(reference => typeof reference === 'string' && (issue.reference === reference || issue.reference.startsWith(`${reference}/`)));
      });
      if (!authorized) continue;
      const real = fs.realpathSync(candidate);
      if (!real.startsWith(`${realArchive}${path.sep}`) || !fs.statSync(real).isFile()) continue;
      const digest = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex')}`;
      if (digest === issue.expectedSha256) { matches.push(issue.reference); break; }
    }
  }
  return [...new Set(matches)];
}
