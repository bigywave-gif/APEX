import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { controlledOutput } from './verification-policy.mjs';
import { newlyAvailableConfigs, newlyAvailableResources, newlyPreferredImports } from './existing-resource-freshness.mjs';

// Mark positions outside comments and quoted text. This is a conservative
// scanner, not a JavaScript parser; computed imports and aliases need their
// own runtime/build evidence.
export function codePositions(text) {
  const code = new Uint8Array(text.length);
  const stack = [{ kind: 'code', braces: null, previous: null }];
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1], frame = stack[stack.length - 1];
    if (frame.kind === 'line') { if (ch === '\n' || ch === '\r') stack.pop(); else continue; }
    else if (frame.kind === 'block') { if (ch === '*' && next === '/') { i++; stack.pop(); } continue; }
    else if (frame.kind === 'template') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '`') stack.pop();
      else if (ch === '$' && next === '{') { i++; stack.push({ kind: 'code', braces: 1, previous: null }); }
      continue;
    }
    else if (frame.kind === 'regex') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '[') frame.characterClass = true;
      else if (ch === ']' && frame.characterClass) frame.characterClass = false;
      else if (ch === '/' && !frame.characterClass) stack.pop();
      continue;
    }
    else if (frame.kind === 'quote') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === frame.quote) stack.pop();
      continue;
    }
    const current = stack[stack.length - 1];
    if (current.braces !== null && ch === '}') { current.braces--; if (current.braces === 0) { stack.pop(); continue; } }
    else if (current.braces !== null && ch === '{') current.braces++;
    if (ch === '/' && next === '/') { i++; stack.push({ kind: 'line' }); continue; }
    if (ch === '/' && next === '*') { i++; stack.push({ kind: 'block' }); continue; }
    if (ch === '/' && (current.previous === null || /^(?:[([{,:;=!?&|+*%^~<>-]|return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(current.previous))) { current.previous = 'value'; stack.push({ kind: 'regex', characterClass: false }); continue; }
    if (ch === '"' || ch === "'") { current.previous = 'value'; stack.push({ kind: 'quote', quote: ch }); continue; }
    if (ch === '`') { current.previous = 'value'; stack.push({ kind: 'template' }); continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1; while (end < text.length && /[\w$]/.test(text[end])) end++;
      code.fill(1, i, end); current.previous = text.slice(i, end); i = end - 1; continue;
    }
    if (!/\s/.test(ch)) current.previous = /\d/.test(ch) ? 'value' : ch;
    code[i] = 1;
  }
  return code;
}

// Inspect only script bodies in markup; HTML comments and non-script template
// text must not turn example imports into missing project dependencies.
export function embeddedScriptPositions(text) {
  const code = new Uint8Array(text.length);
  const opening = /<!--[\s\S]*?-->|<script\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi;
  let match;
  while ((match = opening.exec(text))) {
    if (match[0].startsWith('<!--')) continue;
    const end = /<\/script\s*>/gi; end.lastIndex = opening.lastIndex;
    const closing = end.exec(text); if (!closing) break;
    const attributes = [...match[0].matchAll(/(?:^|\s)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)];
    const type = attributes.find(item => item[1].toLowerCase() === 'type');
    const typeValue = (type?.[2] ?? type?.[3] ?? type?.[4] ?? '').trim().toLowerCase();
    if (!attributes.some(item => item[1].toLowerCase() === 'src') && ['', 'module', 'text/javascript', 'application/javascript'].includes(typeValue)) {
      const body = text.slice(opening.lastIndex, closing.index);
      code.set(codePositions(body), opening.lastIndex);
    }
    opening.lastIndex = end.lastIndex;
  }
  return code;
}

const marker = 'APEX_UNRESOLVED_LOCAL_IMPORTS:';
export function requirementRevisionState(runDir) {
  try {
    const root = fs.realpathSync(runDir), file = path.join(root, 'prompt-revisions.ndjson');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) return 'unavailable:invalid-revision-log';
    return `sha256:${digest(fs.readFileSync(file))}`;
  } catch (error) { return error.code === 'ENOENT' ? 'absent' : `unavailable:${error.code || 'unknown'}`; }
}
function failureSnapshot(stderr) {
  const line = String(stderr || '').split(/\r?\n/).find(item => item.startsWith(marker));
  if (!line) return null;
  const value = JSON.parse(line.slice(marker.length));
  if (!Array.isArray(value) || !value.length || value.length > 10000) throw new Error('invalid unresolved import evidence');
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('invalid unresolved import path');
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('unresolved import path escapes project');
  return file;
}
function pathState(root, relative) {
  const file = safePath(root, relative);
  try {
    const real = fs.realpathSync(file);
    if (!real.startsWith(`${fs.realpathSync(root)}${path.sep}`)) return 'outside-project';
    const stat = fs.statSync(real);
    return stat.isFile() ? `file:${digest(fs.readFileSync(real))}` : 'not-file';
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'absent';
    return `unavailable:${error.code || 'unknown'}`;
  }
}
export function unresolvedSnapshot(projectRoot, imports) {
  const root = path.resolve(projectRoot);
  if (!Array.isArray(imports) || !imports.length || imports.length > 10000) throw new Error('invalid unresolved imports');
  return imports.map(item => {
    if (typeof item.reference !== 'string' || !item.reference.startsWith('.') || !Array.isArray(item.candidates) || item.candidates.length > 100) throw new Error('invalid unresolved import');
    return { source: item.source, reference: item.reference, sourceState: pathState(root, item.source), candidates: item.candidates.map(candidate => ({ path: candidate, state: pathState(root, candidate) })) };
  });
}
export function unresolvedFailure(imports) {
  const observed = [];
  for (const item of imports) {
    const entry = item;
    if (observed.length && JSON.stringify([...observed, entry]).length > 262144) break;
    observed.push(entry);
  }
  return `${marker}${JSON.stringify(observed)}`;
}
export function unresolvedCauseChanged(stderr, projectRoot) {
  try {
    const previous = failureSnapshot(stderr);
    if (!previous) return false;
    const imports = previous.map(item => ({ source: item.source, reference: item.reference, candidates: item.candidates.map(candidate => candidate.path) }));
    return JSON.stringify(previous) !== JSON.stringify(unresolvedSnapshot(projectRoot, imports));
  } catch { return false; }
}

// The full evidence remains in the controlled receipt. Router status exposes
// a bounded digest so an analyst can identify the exact references without
// repeatedly loading or transmitting a potentially large receipt.
export function unresolvedFailureSummary(stderr) {
  try {
    const entries = failureSnapshot(stderr);
    if (!entries) return null;
    const visible = entries.slice(0, 10).map(item => {
      if (typeof item?.source !== 'string' || !item.source || typeof item.reference !== 'string' || !item.reference || typeof item.sourceState !== 'string' || !Array.isArray(item.candidates) || item.candidates.length > 100) throw new Error('invalid unresolved import evidence');
      if (item.source.length > 4096 || item.reference.length > 4096 || item.sourceState.length > 128 || !item.candidates.every(candidate => typeof candidate?.path === 'string' && candidate.path.length <= 4096 && typeof candidate.state === 'string' && candidate.state.length <= 128)) throw new Error('invalid unresolved import evidence');
      return { source: item.source.slice(0, 256), sourceTruncated: item.source.length > 256, reference: item.reference.slice(0, 256), referenceTruncated: item.reference.length > 256, sourceState: item.sourceState, candidateCount: item.candidates.length, candidates: item.candidates.slice(0, 2).map(candidate => ({ path: candidate.path.slice(0, 256), pathTruncated: candidate.path.length > 256, state: candidate.state })), candidatesTruncated: item.candidates.length > 2 };
    });
    return { status: 'unverified', recordedCount: entries.length, entries: visible, entriesTruncated: entries.length > visible.length, recordedEvidenceMayBePartial: true, fullEvidence: 'controlled-operation-receipt' };
  } catch { return { status: 'unreadable', fullEvidence: 'controlled-operation-receipt' }; }
}

// This establishes only that the unverified inspection still matches its
// bound inputs. It never accepts an exception or proves runtime coverage.
export function currentImportInspection(runDir, projectRoot, reference, { allowedSourceChanges = new Set() } = {}) {
  try {
    const root = fs.realpathSync(runDir), project = fs.realpathSync(projectRoot);
    if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new Error('inspection reference is invalid');
    const file = fs.realpathSync(path.resolve(root, reference));
    if (!file.startsWith(`${root}${path.sep}`) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('inspection is outside the Run or exceeds its size limit');
    const inspection = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
    if (state.artifacts?.unresolvedImportInspection !== reference) throw new Error('inspection is not the current Run artifact');
    if (inspection.schemaVersion !== '1.0' || inspection.status !== 'unverified' || inspection.scanner !== 'literal-relative-script-v5' || inspection.observationDrift !== 'no-drift-detected') throw new Error('inspection is invalid or recorded drift');
    if (fs.realpathSync(inspection.projectRoot) !== project) throw new Error('inspection belongs to another project');
    const revision = requirementRevisionState(root);
    if (revision.startsWith('unavailable:') || inspection.requirementRevision?.observed !== revision || inspection.requirementRevision?.authorized !== revision) throw new Error('requirement revision record changed or is unavailable');
    const scope = inspection.scope, scopeReference = scope?.inputReference;
    if (typeof scopeReference !== 'string' || !scopeReference || path.isAbsolute(scopeReference)) throw new Error('scope reference is invalid');
    const scopeFile = fs.realpathSync(path.resolve(root, scopeReference));
    if (!scopeFile.startsWith(`${root}${path.sep}`) || !fs.statSync(scopeFile).isFile()) throw new Error('scope input is outside the Run');
    const scopeHash = `sha256:${digest(fs.readFileSync(scopeFile))}`;
    if (scope.inputSha256 !== scopeHash || scope.authorizedInputSha256 !== scopeHash || !controlledOutput(root, reference, ['existing-code-reference.mjs'], [scopeReference], ['collect_existing_baseline'])) throw new Error('inspection lacks current controlled scope and receipt binding');
    if (!Array.isArray(inspection.sourceObservations) || !inspection.sourceObservations.length || inspection.sourceObservations.length > 10000 || !Array.isArray(inspection.configurationObservations) || !Array.isArray(inspection.unresolvedImports) || inspection.unresolvedImports.length > 10000) throw new Error('inspection observations are invalid');
    if (!(allowedSourceChanges instanceof Set)) throw new Error('allowed source changes are invalid');
    const frozen = allowedSourceChanges.size ? JSON.parse(fs.readFileSync(safePath(root, state.artifacts?.codeReference), 'utf8')) : null;
    const frozenFiles = new Map((frozen?.files || []).map(item => [item.path, item]));
    const sources = new Map();
    for (const item of inspection.sourceObservations) {
      const file = safePath(path.resolve(projectRoot), item?.path), real = fs.realpathSync(file);
      if (sources.has(item.path) || !real.startsWith(`${project}${path.sep}`) || !fs.statSync(real).isFile() || !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error('inspected source changed or is invalid');
      if (allowedSourceChanges.has(item.path)) {
        const frozenItem = frozenFiles.get(item.path), copy = frozenItem && fs.realpathSync(safePath(root, frozenItem.copyPath));
        if (!frozenItem || frozenItem.sha256 !== item.sha256 || !copy.startsWith(`${root}${path.sep}`) || `sha256:${digest(fs.readFileSync(copy))}` !== item.sha256) throw new Error('approved source change has no matching immutable original');
      } else if (`sha256:${digest(fs.readFileSync(real))}` !== item.sha256) throw new Error('inspected source changed or is invalid');
      sources.set(item.path, item.sha256);
    }
    for (const item of inspection.configurationObservations) if (!Array.isArray(item?.sha256Versions) || item.sha256Versions.length !== 1 || sources.get(item.path) !== item.sha256Versions[0]) throw new Error('inspected configuration is inconsistent');
    if (newlyAvailableConfigs(inspection, projectRoot, allowedSourceChanges).length || newlyPreferredImports(inspection, projectRoot, allowedSourceChanges).length) throw new Error('previously absent configuration or import candidate appeared');
    if (newlyAvailableResources(inspection, projectRoot, allowedSourceChanges).length) throw new Error('previously absent resource candidate appeared');
    const keys = new Set();
    const expected = inspection.unresolvedImports.map(item => {
      const key = JSON.stringify([item.source, item.reference]);
      if (keys.has(key) || sources.get(item.source) !== `sha256:${String(item.sourceState || '').replace(/^file:/, '')}` || !Array.isArray(item.candidates)) throw new Error('unresolved import identity is invalid');
      keys.add(key); return { source: item.source, reference: item.reference, candidates: item.candidates.map(candidate => candidate.path) };
    });
    if (expected.length && JSON.stringify(unresolvedSnapshot(projectRoot, expected)) !== JSON.stringify(inspection.unresolvedImports)) throw new Error('unresolved import source or candidate changed');
    return { status: 'current-unverified', inspection: reference, unresolvedCount: expected.length, limitations: inspection.limitations };
  } catch (error) { return { status: 'stale-or-unverified', inspection: reference || null, reason: error.message }; }
}
