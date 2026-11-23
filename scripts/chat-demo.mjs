/** One self-contained source for the chat fragment and the HTTP verification page. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { demoHash } from './interactive-demo.mjs';

function relativeFile(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value)
    && !value.split(/[\\/]/).some(part => part === '..' || part === '.') && !value.includes('\0');
}

export function validateChatFragment(fragment) {
  assert(typeof fragment === 'string' && fragment.trim() && Buffer.byteLength(fragment) < 1024 * 1024, 'chat preview must be a nonempty HTML fragment below 1 MiB');
  assert(!/<\s*(?:!doctype|html|head|body|iframe|object|embed|base)\b/i.test(fragment), 'chat preview must be a fragment, without document wrappers or embedded pages');
  assert(/\bid\s*=\s*["'][A-Za-z][\w-]*["']/.test(fragment), 'chat preview needs a stable root id');
  // Portability diagnostics, not a JavaScript security sandbox; the host CSP is authoritative.
  assert(!/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon\s*\(|import\s*(?:\(|["'{*]))/.test(fragment), 'chat preview must use local mock state and bundled code');
  const resources = [...fragment.matchAll(/\b(?:src|href|action|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(match => match[1] ?? match[2] ?? match[3]);
  resources.push(...[...fragment.matchAll(/url\(\s*([^)]*)\)/gi)].map(match => match[1].trim().replace(/^["']|["']$/g, '')));
  assert(resources.every(value => /^(?:#|data:|blob:|$)/i.test(value.trim())) && !/\b(?:srcset|srcdoc)\s*=|@import\b/i.test(fragment), 'chat preview assets must be inlined; local paths and remote resources are not portable');
  return fragment;
}

export function wrapChatFragment(fragment) {
  validateChatFragment(fragment);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>APEX Demo</title><style>html{color-scheme:light dark}body{margin:0}</style></head><body>\n${fragment}\n</body></html>\n`;
}

export function compileChatPreview(input) {
  if (!input.chatPreview) return input; // Existing and package-backed runs keep their HTTP route.
  const preview = input.chatPreview;
  assert(relativeFile(preview.fragment) && relativeFile(input.entrypoint) && preview.fragment !== input.entrypoint, 'chat fragment and HTTP entrypoint must be distinct run-relative files');
  assert(!preview.mode || preview.mode === 'wide', 'chat preview mode must be omitted or wide');
  const file = input.files.find(item => item.path === preview.fragment);
  assert(file && (!file.encoding || file.encoding === 'utf8'), 'chat preview must reference a declared UTF-8 fragment');
  assert(!input.files.some(item => item.path === input.entrypoint), 'HTTP entrypoint is generated from the chat fragment; do not author a second Demo');
  assert(input.interactionContract.journeys.every(journey => journey.route === '/'), 'chat preview journeys must use local view switching on route /');
  return { ...input, chatPreview: { fragment: preview.fragment, ...(preview.mode ? { mode: preview.mode } : {}) }, files: [...input.files, { path: input.entrypoint, encoding: 'utf8', content: wrapChatFragment(file.content) }] };
}

export function readChatPreview(runDir, manifest) {
  if (!manifest.chatPreview) return null;
  const reference = manifest.chatPreview.fragment;
  assert(relativeFile(reference), 'invalid chat preview fragment path');
  const fragmentPath = path.join('visual-sandbox', reference);
  const file = path.resolve(runDir, fragmentPath), root = fs.realpathSync(path.join(runDir, 'visual-sandbox'));
  assert(fs.realpathSync(file).startsWith(`${root}${path.sep}`), 'chat preview escaped this Run sandbox');
  const fragment = fs.readFileSync(file, 'utf8');
  const record = manifest.files.find(item => item.path === fragmentPath);
  assert(record?.sha256 === demoHash(fragment), 'chat preview source changed after materialization');
  const entry = manifest.files.find(item => item.path === manifest.entrypoint);
  assert(relativeFile(manifest.entrypoint) && entry?.sha256 === demoHash(wrapChatFragment(fragment)), 'HTTP Demo must be generated from this exact chat fragment');
  assert(fs.realpathSync(path.resolve(runDir, manifest.entrypoint)).startsWith(`${root}${path.sep}`), 'HTTP Demo escaped this Run sandbox');
  assert(demoHash(fs.readFileSync(path.resolve(runDir, manifest.entrypoint))) === entry.sha256, 'HTTP Demo source changed after materialization');
  return { path: fragmentPath, sha256: record.sha256, ...(manifest.chatPreview.mode ? { mode: manifest.chatPreview.mode } : {}) };
}

export function chatContentReference(runDir, preview) {
  return `visualize${JSON.stringify({ path: path.resolve(runDir, preview.path), ...(preview.mode ? { mode: preview.mode } : {}) })}`;
}

export function demoPresentation(runDir, demo, surface = null) {
  const inline = demo.chatPreview && surface !== 'browser-panel';
  return { preferred: inline ? 'chat-inline' : 'browser-panel', fallback: 'browser-panel', screenshotOnlyAllowed: false,
    ...(inline ? { contentReference: chatContentReference(runDir, demo.chatPreview), emitInFinalResponse: true } : { fallbackReason: demo.chatPreview ? '宿主使用浏览器回退；具体原因见展示回执。' : '此 Demo 尚无经过同源验证的聊天片段，使用当前 Run 浏览器预览。' }) };
}

export function verifyChatPresentation(runDir, demo, manifest, presentation) {
  const preview = readChatPreview(runDir, manifest);
  assert(JSON.stringify(preview) === JSON.stringify(demo.chatPreview || null), 'runtime Demo chat preview is missing or stale');
  if (presentation.surface === 'chat-inline') {
    assert(preview && presentation.fragment?.sha256 === preview.sha256 && presentation.fragment?.path === preview.path, 'chat presentation must bind the current verified fragment');
  } else {
    assert(presentation.surface === 'browser-panel', 'unsupported Demo presentation surface');
    assert(!preview || typeof presentation.fallbackReason === 'string' && presentation.fallbackReason.trim(), 'browser fallback requires an observed compatibility reason');
  }
  return true;
}
