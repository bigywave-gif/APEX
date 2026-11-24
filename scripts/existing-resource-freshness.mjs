import fs from 'node:fs';
import path from 'node:path';

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
