#!/usr/bin/env node
/** Computes and applies semantic APEX Core versions from a release baseline. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'manifest.yaml');
const baselineFile = path.join(root, 'registry', 'release-baseline.json');
const historyFile = path.join(root, 'registry', 'release-history.json');
const trackedRoots = ['core/runtime/schemas', 'scripts', 'runtime', 'skills', 'registry/capability-registry.json', 'package.json', 'manifest.yaml'];
const ignored = new Set(['registry/release-baseline.json', 'registry/release-history.json', 'scripts/generate-public-pdf.py', 'scripts/release-audit.mjs', 'scripts/apex-release-version.mjs']);
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function walk(target, all = []) { const stat = fs.statSync(target); if (stat.isDirectory()) for (const item of fs.readdirSync(target)) walk(path.join(target, item), all); else all.push(target); return all; }
function content(file) { const relative = path.relative(root, file); let value = fs.readFileSync(file); if (relative === 'manifest.yaml') value = Buffer.from(value.toString('utf8').replace(/^version:\s*[^\n]+/m, 'version: <managed>')); if (relative === 'package.json') { const pkg = JSON.parse(value.toString('utf8')); pkg.version = '<managed>'; value = Buffer.from(JSON.stringify(pkg)); } return crypto.createHash('sha256').update(value).digest('hex'); }
function snapshot() { const files = trackedRoots.flatMap(item => walk(path.join(root, item))).map(file => path.relative(root, file)).filter(file => !ignored.has(file)).sort(); return Object.fromEntries(files.map(file => [file, content(path.join(root, file))])); }
function currentVersion() { const hit = fs.readFileSync(manifest, 'utf8').match(/^version:\s*([^\s#]+)/m); if (!hit) throw new Error('manifest version is missing'); return hit[1].replace(/["']/g, ''); }
function classify(previous, next) {
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(file => previous[file] !== next[file]);
  const removed = changed.filter(file => previous[file] && !next[file]);
  if (removed.length) return { level: 'major', changed, reason: 'removed versioned APEX capability or contract' };
  const weighted = changed.reduce((sum, file) => sum + (file.startsWith('scripts/') || file.startsWith('core/') || file.startsWith('registry/') ? 2 : 1), 0);
  if (weighted >= 8 || changed.some(file => file.startsWith('core/runtime/schemas/'))) return { level: 'minor', changed, reason: 'materially extended APEX runtime capability or contract' };
  return { level: 'patch', changed, reason: 'compatible APEX runtime implementation fix' };
}
function bump(version, level) { const [major, minor, patch] = version.split('.').map(Number); return level === 'major' ? `${major + 1}.0.0` : level === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`; }
function synchronizeDocumentVersions(version) {
  for (const relative of ['system-docs/product-document.md', 'system-docs/technical-architecture.md', 'system-docs/deployment-and-integration.md']) {
    const file = path.join(root, relative);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/- 当前版本：[^\n]+/, `- 当前版本：${version}`));
  }
  const packageFile = path.join(root, 'package.json');
  const pkg = read(packageFile);
  pkg.version = version;
  write(packageFile, pkg);
}
function apply() {
  const before = fs.existsSync(baselineFile) ? read(baselineFile).files || {} : null; const now = snapshot();
  if (!before) { write(baselineFile, { schemaVersion: '1.0', version: currentVersion(), generatedAt: new Date().toISOString(), files: now }); return { status: 'initialized', version: currentVersion(), changed: [] }; }
  const analysis = classify(before, now); if (!analysis.changed.length) return { status: 'current', version: currentVersion(), changed: [] };
  const from = currentVersion(); const to = bump(from, analysis.level);
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/^version:\s*[^\n]+/m, `version: ${to}`)); synchronizeDocumentVersions(to);
  const history = fs.existsSync(historyFile) ? read(historyFile) : { schemaVersion: '1.0', releases: [] };
  history.releases.push({ from, to, level: analysis.level, reason: analysis.reason, changed: analysis.changed, releasedAt: new Date().toISOString() }); write(historyFile, history);
  write(baselineFile, { schemaVersion: '1.0', version: to, generatedAt: new Date().toISOString(), files: snapshot() });
  return { status: 'bumped', from, version: to, level: analysis.level, reason: analysis.reason, changed: analysis.changed };
}
const [command = 'analyze'] = process.argv.slice(2);
try {
  if (command === 'apply') console.log(JSON.stringify(apply()));
  else if (command === 'reset-baseline') { write(baselineFile, { schemaVersion: '1.0', version: currentVersion(), generatedAt: new Date().toISOString(), files: snapshot() }); console.log(JSON.stringify({ status: 'reset', version: currentVersion() })); }
  else { const previous = fs.existsSync(baselineFile) ? read(baselineFile).files || {} : {}; console.log(JSON.stringify({ status: fs.existsSync(baselineFile) ? 'analyzed' : 'uninitialized', current: currentVersion(), ...classify(previous, snapshot()) })); }
} catch (error) { console.error(`APEX release version failed: ${error.message}`); process.exitCode = 1; }
