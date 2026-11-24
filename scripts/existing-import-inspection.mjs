import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Mark positions outside comments and quoted text. This is a conservative
// scanner, not a JavaScript parser; computed imports and aliases need their
// own runtime/build evidence.
export function codePositions(text) {
  const code = new Uint8Array(text.length);
  let state = 'code', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (state === 'line') { if (ch === '\n' || ch === '\r') state = 'code'; else continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { i++; state = 'code'; } continue; }
    if (state !== 'code') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === state) state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { i++; state = 'line'; continue; }
    if (ch === '/' && next === '*') { i++; state = 'block'; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { state = ch; continue; }
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
    const line = String(stderr || '').split(/\r?\n/).find(item => item.startsWith(marker));
    if (!line) return false;
    const previous = JSON.parse(line.slice(marker.length));
    const imports = previous.map(item => ({ source: item.source, reference: item.reference, candidates: item.candidates.map(candidate => candidate.path) }));
    return JSON.stringify(previous) !== JSON.stringify(unresolvedSnapshot(projectRoot, imports));
  } catch { return false; }
}
