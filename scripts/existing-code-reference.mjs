#!/usr/bin/env node
/** Freezes the complete code closure for the Existing change scope, not the entire site. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
const ignored = new Set(['.git', '.apex', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.json', '.yaml', '.yml'];
function die(message) { console.error(`Existing code reference failed: ${message}`); process.exit(1); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha(content) { return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`; }
function fingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function sameFingerprint(expected, file) { if (!expected || !fs.existsSync(file)) return false; const actual = fingerprint(file); return Object.entries(expected).every(([key, value]) => actual[key] === value); }
function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
function inside(root, file) { const resolved = path.resolve(file); return resolved === root || resolved.startsWith(`${root}${path.sep}`); }
function resolveImport(projectRoot, from, specifier) { if (!specifier.startsWith('.')) return null; const base = path.resolve(path.dirname(from), specifier); const candidates = [base, ...extensions.map(ext => `${base}${ext}`), ...extensions.map(ext => path.join(base, `index${ext}`))]; return candidates.find(candidate => inside(projectRoot, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null; }
function imports(projectRoot, file, content) { const found = new Set(); const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+(?:[^'";]+?\s+from\s+)?|require\s*\(|import\s*\()\s*[(']([^'")]+)['"]/g; for (const match of content.matchAll(pattern)) { const target = resolveImport(projectRoot, file, match[1]); if (target) found.add(target); } return [...found]; }
function markers(content) { const text = content.toString('utf8'); const result = []; const tags = [...text.matchAll(/<([A-Za-z][\w.-]*)\b[^>]*>/g)].map(match => match[1]); const tests = [...text.matchAll(/data-testid=["']([^"']+)["']/g)].map(match => `testid:${match[1]}`); [...tags, ...tests].forEach((marker, index) => result.push({ marker: `${marker}#${index + 1}`, kind: marker.startsWith('testid:') ? 'test-anchor' : 'dom-element' })); return result; }
const [command, runArg, projectArg, scopeArg] = process.argv.slice(2);
if (command !== 'capture' || !runArg || !projectArg || !scopeArg) die('usage: capture <run-dir> <project-root> <baseline-input.json>');
const runDir = path.resolve(runArg); const projectRoot = path.resolve(projectArg); const scope = JSON.parse(fs.readFileSync(path.resolve(scopeArg), 'utf8'));
try { requireRouterAction(runDir, 'collect_existing_baseline'); } catch (error) { die(error.message); }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
const stateFile = path.join(runDir, 'state.json'); const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (state.track !== 'existing') die('code reference is only valid for Existing runs');
const entries = [...new Set(scope.codeEntrypoints || [])].map(item => path.resolve(projectRoot, item));
if (!entries.length) die('baseline input must declare target codeEntrypoints');
for (const entry of entries) if (!inside(projectRoot, entry) || !fs.existsSync(entry) || !fs.statSync(entry).isFile()) die(`target code entrypoint is missing: ${rel(projectRoot, entry)}`);
const snapshotRoot = path.join(runDir, 'code-reference'); const copies = path.join(snapshotRoot, 'files');
const priorReferenceFile = path.join(runDir, 'code-reference.json'); const integrityIndexFile = path.join(runDir, 'source-integrity-index.json');
if (fs.existsSync(priorReferenceFile) && fs.existsSync(integrityIndexFile)) {
  try {
    const prior = JSON.parse(fs.readFileSync(priorReferenceFile, 'utf8')); const index = JSON.parse(fs.readFileSync(integrityIndexFile, 'utf8'));
    const requestedEntries = entries.map(entry => rel(projectRoot, entry)).sort(); const indexedEntries = (index.entrypoints || []).slice().sort();
    const scopeHash = sha(Buffer.from(JSON.stringify({ routes: scope.routes || [], entrypoints: requestedEntries })));
    const unchanged = prior.complete === true && index.scopeHash === scopeHash && JSON.stringify(requestedEntries) === JSON.stringify(indexedEntries) && (index.files || []).length === (prior.files || []).length && (index.files || []).every(item => sameFingerprint(item.sourceFingerprint, path.join(projectRoot, item.path)) && sameFingerprint(item.copyFingerprint, path.join(runDir, item.copyPath)));
    if (unchanged) {
      state.artifacts.codeReference = 'code-reference.json'; state.artifacts.pageSkeleton = 'page-skeleton.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
      console.log(JSON.stringify({ codeReference: priorReferenceFile, pageSkeleton: path.join(runDir, 'page-skeleton.json'), complete: true, reused: true, sourceFileCount: prior.sourceFileCount, totalBytes: prior.totalBytes, sourceTreeHash: prior.sourceTreeHash }));
      process.exit(0);
    }
  } catch { /* A malformed cache is never trusted; rebuild it below. */ }
}
const pending = [...entries]; const selected = new Set();
while (pending.length) { const file = pending.pop(); if (selected.has(file)) continue; selected.add(file); const content = fs.readFileSync(file, 'utf8'); for (const dependency of imports(projectRoot, file, content)) if (!selected.has(dependency)) pending.push(dependency); }
fs.rmSync(snapshotRoot, { recursive: true, force: true }); fs.mkdirSync(copies, { recursive: true });
const aggregate = crypto.createHash('sha256'); let totalBytes = 0; const nodes = [];
const integrityFiles = [];
const files = [...selected].sort((a, b) => rel(projectRoot, a).localeCompare(rel(projectRoot, b))).map(file => { const content = fs.readFileSync(file); const relative = rel(projectRoot, file); const copyPath = path.join('code-reference', 'files', relative).split(path.sep).join('/'); const copy = path.join(runDir, copyPath); fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.writeFileSync(copy, content); const hash = sha(content); aggregate.update(relative); aggregate.update('\0'); aggregate.update(hash); aggregate.update('\0'); totalBytes += content.length; for (const item of markers(content)) nodes.push({ id: `${relative}:${item.marker}`, sourcePath: relative, marker: item.marker, kind: item.kind }); integrityFiles.push({ path: relative, copyPath, sha256: hash, sourceFingerprint: fingerprint(file), copyFingerprint: fingerprint(copy) }); return { path: relative, sha256: hash, bytes: content.length, copyPath, language: path.extname(file).slice(1) || 'text' }; });
if (!nodes.length) die('target code closure has no mappable page skeleton nodes');
const sourceTreeHash = `sha256:${aggregate.digest('hex')}`; const skeletonPayload = { sourceTreeHash, entrypoints: entries.map(entry => rel(projectRoot, entry)), nodes }; const skeletonHash = sha(Buffer.from(JSON.stringify(skeletonPayload)));
const reference = { schemaVersion: '3.0', capturedAt: new Date().toISOString(), projectRoot, complete: true, scope: { routes: scope.routes || [], entrypoints: skeletonPayload.entrypoints, mode: 'target-entrypoints-and-transitive-project-dependencies' }, sourceFileCount: files.length, totalBytes, sourceTreeHash, files, excludedDirectories: [...ignored].sort() };
if (!reference.scope.routes.length) die('baseline input must declare target routes');
const output = path.join(runDir, 'code-reference.json'); const skeletonOutput = path.join(runDir, 'page-skeleton.json'); write(output, reference); write(skeletonOutput, { schemaVersion: '3.0', ...skeletonPayload, skeletonHash });
write(integrityIndexFile, { schemaVersion: '3.0', capturedAt: new Date().toISOString(), purpose: 'fast-path-only; Gate validation recomputes all SHA-256 values', sourceTreeHash, scopeHash: sha(Buffer.from(JSON.stringify({ routes: scope.routes || [], entrypoints: skeletonPayload.entrypoints.slice().sort() }))), entrypoints: skeletonPayload.entrypoints, files: integrityFiles });
for (const [schema, file] of [['code-reference.schema.json', output], ['page-skeleton.schema.json', skeletonOutput]]) { const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-validate.mjs'), 'validate', schema, file], { encoding: 'utf8' }); if (result.status !== 0) die((result.stderr || result.stdout).trim()); }
state.artifacts.codeReference = 'code-reference.json'; state.artifacts.pageSkeleton = 'page-skeleton.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ codeReference: output, pageSkeleton: skeletonOutput, complete: true, sourceFileCount: files.length, totalBytes, sourceTreeHash, skeletonHash }));
