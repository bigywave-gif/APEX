#!/usr/bin/env node
import { commitRunState, readRunStateForUpdate } from './run-ledger.mjs';
import { canonicalApexRoot } from './apex-paths.mjs';
/** Freezes the complete code closure for the Existing change scope, not the entire site. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { newlyAvailableConfigs, newlyPreferredImports } from './existing-resource-freshness.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', '.apex', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.json', '.yaml', '.yml'];
const CAPTURE_VERSION = '11';
function die(message) { console.error(`Existing code reference failed: ${message}`); process.exit(1); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha(content) { return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`; }
function fingerprint(file) { const stat = fs.statSync(file); return { dev: String(stat.dev), ino: String(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function sameFingerprint(expected, file) { if (!expected || !fs.existsSync(file)) return false; const actual = fingerprint(file); return Object.entries(expected).every(([key, value]) => actual[key] === value); }
function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
function inside(root, file) { const resolved = path.resolve(file); return resolved === root || resolved.startsWith(`${root}${path.sep}`); }
function parseJsonComments(text) {
  let out = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; out += ch; continue; }
    if (ch === '/' && next === '/') { i += 2; while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; if (i >= text.length) throw new Error('unterminated JSON comment'); i++; out += ' '; continue; }
    if (ch === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    out += ch;
  }
  return JSON.parse(out);
}
let compilerOptions = {}, tsconfigFile = null, configHash = null, configFiles = [], workspaces = new Map(), publicRoots = [];
const missingResources = new Map();
const absentImportCandidates = new Set();
function workspaceTarget(specifier) {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const item = workspaces.get(name); if (!item) return null;
  const suffix = specifier.slice(name.length), key = suffix ? `.${suffix}` : '.';
  let target = item.manifest.exports?.[key];
  if (key === '.' && typeof item.manifest.exports === 'string') target = item.manifest.exports;
  if (key === '.' && !target) target = item.manifest.source || item.manifest.module || item.manifest.main;
  while (target && typeof target === 'object' && !Array.isArray(target)) target = target.source || target.import || target.default || target.types;
  if (typeof target !== 'string') return null;
  const generated = path.resolve(item.dir, target), outDir = item.options.outDir && path.resolve(item.dir, item.options.outDir), rootDir = item.options.rootDir && path.resolve(item.dir, item.options.rootDir);
  if (outDir && rootDir && inside(outDir, generated)) return path.join(rootDir, path.relative(outDir, generated));
  return generated;
}
function resolveImport(projectRoot, from, specifier) {
  specifier = specifier.split(/[?#]/, 1)[0];
  if (!specifier) return null;
  const bases = [];
  if (specifier.startsWith('.')) bases.push(path.resolve(path.dirname(from), specifier));
  else {
  const workspace = workspaceTarget(specifier); if (workspace) bases.push(workspace);
  for (const [pattern, targets] of Object.entries(compilerOptions.paths || {})) {
    if (!Array.isArray(targets)) continue;
    const parts = pattern.split('*'); if (parts.length > 2 || !specifier.startsWith(parts[0]) || (parts.length === 2 && !specifier.endsWith(parts[1]))) continue;
    if (parts.length === 1 && specifier !== pattern) continue;
    const match = parts.length === 2 ? specifier.slice(parts[0].length, specifier.length - parts[1].length) : '';
    for (const target of targets) if (typeof target === 'string') bases.push(path.resolve(projectRoot, compilerOptions.baseUrl || '.', target.replace('*', match)));
  }
  }
  const earlierCandidates = [];
  for (const base of bases) {
    const stem = /\.(?:mjs|cjs|js|jsx)$/.test(base) ? base.replace(/\.(?:mjs|cjs|js|jsx)$/, '') : null;
    const candidates = [base, ...(stem ? ['.ts', '.tsx', '.mts', '.cts'].map(ext => `${stem}${ext}`) : []), ...extensions.map(ext => `${base}${ext}`), ...extensions.map(ext => path.join(base, `index${ext}`))];
    for (const candidate of candidates) {
      if (!inside(projectRoot, candidate)) continue;
      if (fs.existsSync(candidate)) {
        if (fs.statSync(candidate).isFile()) { for (const previous of earlierCandidates) absentImportCandidates.add(rel(projectRoot, previous)); return candidate; }
      }
      earlierCandidates.push(candidate);
    }
  }
  return null;
}
function imports(projectRoot, file, content) {
  const found = new Set();
  // Keep the static forms separate from require()/dynamic import().  The old
  // optional "from" group could consume `import` and then fail at a named
  // binding (`import { App } from ...`), silently producing an incomplete
  // Existing closure.  A missed dependency is worse than a conservative
  // closure because it makes later scope protection and regression evidence
  // claim coverage they do not have.
  const patterns = [
    /\b(?:import|export)\s+(?:[\w*$\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) {
    const target = resolveImport(projectRoot, file, match[1]);
    if (target) found.add(target);
  }
  // HTML entrypoints often load their real styles/scripts outside JS imports.
  // Follow local references so the Existing protected complement includes them.
  const localReference = (value, context) => {
    const clean = value.split(/[?#]/, 1)[0];
    if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(clean)) return;
    const targets = clean.startsWith('/') ? [path.resolve(projectRoot, `.${clean}`), ...publicRoots.map(root => path.resolve(root, `.${clean}`))] : [path.resolve(path.dirname(file), clean)];
    const local = targets.filter(candidate => inside(projectRoot, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    const alias = !clean.startsWith('.') && !clean.startsWith('/') ? resolveImport(projectRoot, file, clean) : null;
    if (local.length || alias) { for (const target of local) found.add(target); if (alias) found.add(alias); }
    else {
      const key = JSON.stringify([rel(projectRoot, file), value]);
      const entry = missingResources.get(key) || { source: rel(projectRoot, file), reference: value, candidates: targets.filter(candidate => inside(projectRoot, candidate)).map(candidate => rel(projectRoot, candidate)), contexts: [] };
      if (!entry.contexts.includes(context)) entry.contexts.push(context);
      missingResources.set(key, entry);
    }
  };
  if (/\.(?:html?|vue|svelte)$/i.test(file)) {
    for (const match of content.matchAll(/<(link|script|img|source|video|audio)\b[^>]*>/gi)) {
      const tag = match[0], type = match[1].toLowerCase(), attribute = type === 'link' ? 'href' : 'src';
      if (type === 'link' && !/\brel\s*=\s*["'][^"']*\b(?:stylesheet|icon|preload)\b/i.test(tag)) continue;
      const source = tag.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (source) localReference(source[1], `${type}-${attribute}`);
      if (type === 'video') { const poster = tag.match(/(?:^|\s)poster\s*=\s*["']([^"']+)["']/i); if (poster) localReference(poster[1], 'video-poster'); }
    }
  }
  if (/\.(?:css|scss|sass|less|vue|svelte)$/i.test(file)) for (const match of content.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) localReference(match[1], 'css-import');
  if (/\.(?:css|scss|sass|less|vue|svelte)$/i.test(file)) for (const match of content.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^'"()\s]+))\s*\)/gi)) {
    const property = content.slice(0, match.index).match(/(?:^|[;{}])\s*([-\w]+)\s*:\s*[^;{}]*$/)?.[1]?.toLowerCase();
    localReference(match[1] ?? match[2] ?? match[3], ['background', 'background-image'].includes(property) ? 'css-background-url' : 'css-url');
  }
  return [...found];
}
function markers(content) { const text = content.toString('utf8'); const result = []; const tags = [...text.matchAll(/<([A-Za-z][\w.-]*)\b[^>]*>/g)].map(match => match[1]); const tests = [...text.matchAll(/data-testid=["']([^"']+)["']/g)].map(match => `testid:${match[1]}`); [...tags, ...tests].forEach((marker, index) => result.push({ marker: `${marker}#${index + 1}`, kind: marker.startsWith('testid:') ? 'test-anchor' : 'dom-element' })); return result; }
const [command, runArg, projectArg, scopeArg] = process.argv.slice(2);
if (command !== 'capture' || !runArg || !projectArg || !scopeArg) die('usage: capture <run-dir> <project-root> <baseline-input.json>');
const runDir = path.resolve(runArg); const projectRoot = path.resolve(projectArg); const scope = JSON.parse(fs.readFileSync(path.resolve(scopeArg), 'utf8'));
try { requireRouterAction(runDir, 'collect_existing_baseline'); } catch (error) { die(error.message); }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
const stateFile = path.join(runDir, 'state.json'); const { state, expectedStateHash } = readRunStateForUpdate(runDir); if (state.track !== 'existing') die('code reference is only valid for Existing runs');
const entries = [...new Set(scope.codeEntrypoints || [])].map(item => path.resolve(projectRoot, item));
if (!entries.length) die('baseline input must declare target codeEntrypoints');
const realProjectRoot = fs.realpathSync(projectRoot);
if (realProjectRoot !== fs.realpathSync(process.env.APEX_ROUTER_PROJECT_ROOT || '')) die('code reference must use the Router-authorized project');
tsconfigFile = path.join(projectRoot, 'tsconfig.json');
const absentConfigCandidates = new Set();
function projectConfig(file) { const real = fs.realpathSync(file); if (!inside(realProjectRoot, real)) throw new Error(`project configuration is outside the project: ${rel(projectRoot, file)}`); return fs.readFileSync(file, 'utf8'); }
const checkedConfigDirectories = new Set();
function collectAncestorConfigs(source) {
  const found = []; let current = path.dirname(source);
  while (inside(projectRoot, current) && !checkedConfigDirectories.has(current)) {
    checkedConfigDirectories.add(current);
    for (const name of ['package.json', 'tsconfig.json']) {
      const file = path.join(current, name);
      let present = false;
      try { fs.lstatSync(file); present = true; } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      if (present) { projectConfig(file); found.push(file); }
      else absentConfigCandidates.add(rel(projectRoot, file));
    }
    if (current === projectRoot) break;
    current = path.dirname(current);
  }
  return found;
}
try {
  for (const entry of entries) {
    if (!inside(projectRoot, entry)) throw new Error('target code entrypoint is outside the project');
    configFiles.push(...collectAncestorConfigs(entry));
  }
  if (fs.existsSync(tsconfigFile)) { compilerOptions = parseJsonComments(projectConfig(tsconfigFile)).compilerOptions || {}; configFiles.push(tsconfigFile); }
  const manifestFile = path.join(projectRoot, 'package.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(projectConfig(manifestFile)); configFiles.push(manifestFile);
    const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages || [];
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || !/^[\w./-]+(?:\/\*)?$/.test(pattern)) continue;
      const wildcard = pattern.endsWith('/*'), parent = path.resolve(projectRoot, wildcard ? pattern.slice(0, -2) : pattern);
      if (!inside(projectRoot, parent) || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) continue;
      const dirs = wildcard ? fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(parent, entry.name)) : [parent];
      for (const dir of dirs) {
        const packageFile = path.join(dir, 'package.json'); if (!fs.existsSync(packageFile)) continue;
        const workspaceManifest = JSON.parse(projectConfig(packageFile)); configFiles.push(packageFile);
        const configFile = path.join(dir, 'tsconfig.json'); let options = {};
        if (fs.existsSync(configFile)) { options = parseJsonComments(projectConfig(configFile)).compilerOptions || {}; configFiles.push(configFile); }
        if (workspaceManifest.name) { if (workspaces.has(workspaceManifest.name)) throw new Error(`duplicate workspace name: ${workspaceManifest.name}`); workspaces.set(workspaceManifest.name, { dir, manifest: workspaceManifest, options }); }
      }
    }
  }
  configFiles = [...new Set(configFiles)].sort();
  configHash = sha(JSON.stringify(configFiles.map(file => [rel(projectRoot, file), sha(projectConfig(file))])));
} catch (error) { die(`cannot inspect project configuration: ${error.message}`); }
function requireProjectSource(file) {
  try {
    const realFile = fs.realpathSync(file);
    if (!inside(realProjectRoot, realFile) || realFile === realProjectRoot || !fs.statSync(realFile).isFile()) throw new Error('outside project or not a file');
  } catch { die(`code source must be an existing file inside the project: ${rel(projectRoot, file)}`); }
}
for (const entry of entries) { if (!inside(projectRoot, entry)) die(`target code entrypoint is outside the project: ${rel(projectRoot, entry)}`); requireProjectSource(entry); }
publicRoots = [...new Set([path.join(projectRoot, 'public'), ...entries.map(entry => {
  let current = path.dirname(entry);
  while (inside(projectRoot, current) && current !== projectRoot) {
    if (fs.existsSync(path.join(current, 'package.json'))) return path.join(current, 'public');
    current = path.dirname(current);
  }
  return path.join(projectRoot, 'public');
})])];
// Reference copies are immutable content-addressed objects.  Earlier versions
// erased `code-reference/` before rebuilding; that is unsafe under host
// project-deletion policies and can destroy evidence needed to diagnose a
// failed run.  A rebuild now creates/reuses only the exact object for each
// source hash and switches the state to the new manifest atomically later.
const snapshotRoot = path.join(runDir, 'code-reference'); const copies = path.join(snapshotRoot, 'objects');
const priorReferenceFile = path.join(runDir, 'code-reference.json'); const integrityIndexFile = path.join(runDir, 'source-integrity-index.json');
if (fs.existsSync(priorReferenceFile) && fs.existsSync(integrityIndexFile)) {
  try {
    const prior = JSON.parse(fs.readFileSync(priorReferenceFile, 'utf8')); const index = JSON.parse(fs.readFileSync(integrityIndexFile, 'utf8'));
    const requestedEntries = entries.map(entry => rel(projectRoot, entry)).sort(); const indexedEntries = (index.entrypoints || []).slice().sort();
    const scopeHash = sha(Buffer.from(JSON.stringify({ routes: scope.routes || [], entrypoints: requestedEntries, configHash, publicRoots })));
    const unchanged = prior.complete === true && index.captureVersion === CAPTURE_VERSION && index.scopeHash === scopeHash && JSON.stringify(requestedEntries) === JSON.stringify(indexedEntries) && (index.files || []).length === (prior.files || []).length && (index.files || []).every(item => sameFingerprint(item.sourceFingerprint, path.join(projectRoot, item.path)) && sameFingerprint(item.copyFingerprint, path.join(runDir, item.copyPath))) && Array.isArray(index.missingCandidates) && index.missingCandidates.every(file => !fs.existsSync(path.join(projectRoot, file))) && Array.isArray(prior.absentConfigCandidates) && newlyAvailableConfigs(prior, projectRoot).length === 0 && Array.isArray(prior.absentImportCandidates) && newlyPreferredImports(prior, projectRoot).length === 0;
    if (unchanged) {
      state.artifacts.codeReference = 'code-reference.json'; state.artifacts.pageSkeleton = 'page-skeleton.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'existing-code-reference-state-update', expectedStateHash });
      console.log(JSON.stringify({ codeReference: priorReferenceFile, pageSkeleton: path.join(runDir, 'page-skeleton.json'), complete: true, reused: true, sourceFileCount: prior.sourceFileCount, totalBytes: prior.totalBytes, sourceTreeHash: prior.sourceTreeHash }));
      process.exit(0);
    }
  } catch { /* A malformed cache is never trusted; rebuild it below. */ }
}
const pending = [...entries, ...configFiles]; const selected = new Set();
while (pending.length) { const file = pending.pop(); if (selected.has(file)) continue; requireProjectSource(file); selected.add(file); try { for (const config of collectAncestorConfigs(file)) if (!selected.has(config)) pending.push(config); } catch (error) { die(`cannot inspect scoped dependency configuration: ${error.message}`); } if (/\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|html?|json|ya?ml)$/i.test(file)) { const content = fs.readFileSync(file, 'utf8'); for (const dependency of imports(projectRoot, file, content)) if (!selected.has(dependency)) pending.push(dependency); } }
fs.mkdirSync(copies, { recursive: true });
const aggregate = crypto.createHash('sha256'); let totalBytes = 0; const nodes = [];
const integrityFiles = [];
const files = [...selected].sort((a, b) => rel(projectRoot, a).localeCompare(rel(projectRoot, b))).map(file => {
  const content = fs.readFileSync(file); const relative = rel(projectRoot, file); const hash = sha(content); const hashSegment = hash.slice('sha256:'.length);
  const copyPath = path.join('code-reference', 'objects', hashSegment, relative).split(path.sep).join('/'); const copy = path.join(runDir, copyPath);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  if (fs.existsSync(copy)) {
    if (sha(fs.readFileSync(copy)) !== hash) die(`immutable code-reference object hash collision: ${copyPath}`);
  } else fs.writeFileSync(copy, content, { flag: 'wx' });
  aggregate.update(relative); aggregate.update('\0'); aggregate.update(hash); aggregate.update('\0'); totalBytes += content.length;
  if (/\.(?:[cm]?[jt]sx?|vue|svelte|html?)$/i.test(file)) for (const item of markers(content)) nodes.push({ id: `${relative}:${item.marker}`, sourcePath: relative, marker: item.marker, kind: item.kind });
  integrityFiles.push({ path: relative, copyPath, sha256: hash, sourceFingerprint: fingerprint(file), copyFingerprint: fingerprint(copy) });
  return { path: relative, sha256: hash, bytes: content.length, copyPath, language: path.extname(file).slice(1) || 'text' };
});
if (!nodes.length) die('target code closure has no mappable page skeleton nodes');
const sourceTreeHash = `sha256:${aggregate.digest('hex')}`; const skeletonPayload = { sourceTreeHash, entrypoints: entries.map(entry => rel(projectRoot, entry)), nodes }; const skeletonHash = sha(Buffer.from(JSON.stringify(skeletonPayload)));
const reference = { schemaVersion: '3.0', capturedAt: new Date().toISOString(), projectRoot, complete: true, scope: { routes: scope.routes || [], entrypoints: skeletonPayload.entrypoints, mode: 'target-entrypoints-and-transitive-project-dependencies' }, sourceFileCount: files.length, totalBytes, sourceTreeHash, files, absentConfigCandidates: [...absentConfigCandidates].sort(), absentImportCandidates: [...absentImportCandidates].sort(), unresolvedResources: [...missingResources.values()], excludedDirectories: [...ignored].sort() };
if (!reference.scope.routes.length) die('baseline input must declare target routes');
const output = path.join(runDir, 'code-reference.json'); const skeletonOutput = path.join(runDir, 'page-skeleton.json'); write(output, reference); write(skeletonOutput, { schemaVersion: '3.0', ...skeletonPayload, skeletonHash });
write(integrityIndexFile, { schemaVersion: '3.0', captureVersion: CAPTURE_VERSION, capturedAt: new Date().toISOString(), purpose: 'fast-path-only; Gate validation recomputes all SHA-256 values', sourceTreeHash, scopeHash: sha(Buffer.from(JSON.stringify({ routes: scope.routes || [], entrypoints: skeletonPayload.entrypoints.slice().sort(), configHash, publicRoots }))), entrypoints: skeletonPayload.entrypoints, files: integrityFiles, missingCandidates: [...new Set([...missingResources.values()].flatMap(item => item.candidates))] });
for (const [schema, file] of [['code-reference.schema.json', output], ['page-skeleton.schema.json', skeletonOutput]]) { const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-validate.mjs'), 'validate', schema, file], { encoding: 'utf8' }); if (result.status !== 0) die((result.stderr || result.stdout).trim()); }
state.artifacts.codeReference = 'code-reference.json'; state.artifacts.pageSkeleton = 'page-skeleton.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'existing-code-reference-state-update', expectedStateHash });
console.log(JSON.stringify({ codeReference: output, pageSkeleton: skeletonOutput, complete: true, sourceFileCount: files.length, unresolvedResources: missingResources.size, totalBytes, sourceTreeHash, skeletonHash }));
