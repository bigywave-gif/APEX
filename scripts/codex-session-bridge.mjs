/** Exact, project-local bridge from a Codex host thread to an APEX session alias. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const firstString = (source, keys) => keys.map(key => source?.[key]).find(value => typeof value === 'string' && value.trim()) || null;
function strings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach(item => strings(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => strings(item, found));
  return found;
}
function shellWords(command) {
  const words = []; let current = ''; let quote = null; let escaped = false;
  for (const char of command) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; else current += char; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\s/.test(char)) { if (current) { words.push(current); current = ''; } continue; }
    current += char;
  }
  if (current) words.push(current);
  return words;
}
function invocation(input) {
  for (const command of strings(input)) {
    if (!command.includes('apex-router.mjs')) continue;
    const words = shellWords(command); const at = words.findIndex(word => word.endsWith('apex-router.mjs'));
    if (at < 0) continue;
    const args = words.slice(at + 1); const action = args[0];
    let projectRoot; let sessionId;
    if (['intake', 'restart'].includes(action)) { projectRoot = args[1]; sessionId = args[6]; }
    else if (action === 'reinvoke') { projectRoot = args[1]; sessionId = args[2]; }
    else if (['resume', 'status', 'inspect_run'].includes(action)) { projectRoot = args[1]; sessionId = args.at(-1); }
    else if (['authorize', 'approve', 'revise', 'cancel', 'register-gate1-presentation', 'register-runtime-demo', 'select-route', 'transition', 'lease'].includes(action)) { projectRoot = args[1]; sessionId = args[3]; }
    if (projectRoot && sessionId) return { projectRoot, sessionId };
  }
  return null;
}
export function recordHostSessionBridge(input) {
  const hostSessionId = firstString(input, ['session_id', 'sessionId', 'thread_id', 'threadId']);
  const current = invocation(input);
  if (!hostSessionId || !current) return null;
  const projectRoot = path.resolve(current.projectRoot);
  const directory = path.join(projectRoot, '.apex', 'session-bridges');
  fs.mkdirSync(directory, { recursive: true });
  const value = { schemaVersion: '1.0', hostSessionId, apexSessionId: current.sessionId, projectRoot, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, `${hash(hostSessionId)}.json`), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
export function sessionBridge(projectRoot, hostSessionId) {
  const file = path.join(projectRoot, '.apex', 'session-bridges', `${hash(hostSessionId)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value.hostSessionId === hostSessionId && value.apexSessionId && path.resolve(value.projectRoot || '') === path.resolve(projectRoot) ? value : null;
  } catch { return null; }
}
