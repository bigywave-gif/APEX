import fs from 'node:fs';
import path from 'node:path';

export const ignoredProjectDirectories = new Set(['.git', '.apex', '.worktrees', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte', '.html', '.htm', '.ejs', '.hbs', '.pug', '.php', '.py', '.java', '.go', '.rb', '.cs']);
const entryPattern = /(^|\/)(main|index|app|server|client|layout|page)\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|html|htm)$/i;
const routePattern = /(^|\/)(pages|app|routes|router|views)\/|(^|\/)(routes?|router)\.(js|jsx|ts|tsx|py)$/;
export function projectScanOptions(input = {}) {
  const defaults = { maxSourceFiles: 12000, maxEntrypoints: 80, maxRoutes: 160 }, result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !(key in defaults))) throw new Error('invalid project scan options');
  for (const [key, value] of Object.entries(defaults)) { const n = input[key] ?? value; if (!Number.isSafeInteger(n) || n < 1 || n > 1000000) throw new Error(`invalid project scan limit: ${key}`); result[key] = n; }
  return result;
}
export function expandedProjectScanOptions(coverage) {
  if (!coverage || coverage.complete !== false) throw new Error('no truncated project scan to expand');
  const options = projectScanOptions({ maxSourceFiles: coverage.sourceLimit, maxEntrypoints: coverage.entrypointLimit, maxRoutes: coverage.routeLimit });
  let changed = false;
  for (const [flag, key] of [['sourceTruncated', 'maxSourceFiles'], ['entrypointsTruncated', 'maxEntrypoints'], ['routesTruncated', 'maxRoutes']]) {
    if (typeof coverage[flag] !== 'boolean') throw new Error(`invalid scan coverage: ${flag}`);
    if (!coverage[flag]) continue;
    if (options[key] >= 1000000) throw new Error(`project scan limit reached: ${key}; inventory remains incomplete`);
    options[key] = Math.min(1000000, options[key] * 2);
    changed = true;
  }
  if (!changed) throw new Error('incomplete project scan has no expandable limit');
  return options;
}
export function scanProjectSources(root, input = {}) {
  const limits = projectScanOptions(input), files = [], packageManifests = [], excludedVirtualEnvironments = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignoredProjectDirectories.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory() && fs.existsSync(path.join(absolute, 'pyvenv.cfg'))) {
        excludedVirtualEnvironments.push(path.relative(root, absolute).split(path.sep).join('/'));
        continue;
      }
      if (entry.isDirectory()) { if (walk(absolute)) return true; }
      else if (entry.isFile() && entry.name === 'package.json' && current !== root) {
        if (packageManifests.length === limits.maxSourceFiles) return true;
        packageManifests.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        if (files.length === limits.maxSourceFiles) return true;
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
    return false;
  }
  const sourceTruncated = walk(root), entries = files.filter(file => entryPattern.test(file)), routes = files.filter(file => routePattern.test(file));
  const entrypointsTruncated = entries.length > limits.maxEntrypoints, routesTruncated = routes.length > limits.maxRoutes;
  return { files, packageManifests, excludedVirtualEnvironments, entrypoints: entries.slice(0, limits.maxEntrypoints), routeCandidates: routes.slice(0, limits.maxRoutes), coverage: { sourceCount: files.length, sourceLimit: limits.maxSourceFiles, sourceTruncated, entrypointCount: entries.length, entrypointLimit: limits.maxEntrypoints, entrypointsTruncated, routeCount: routes.length, routeLimit: limits.maxRoutes, routesTruncated, complete: !sourceTruncated && !entrypointsTruncated && !routesTruncated } };
}
