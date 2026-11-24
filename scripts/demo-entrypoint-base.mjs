import path from 'node:path';

/** Preserve nested HTML entrypoint resource resolution when it is served at /. */
export function bindDemoEntrypointBase(input) {
  if (input.chatPreview || !/\.html?$/i.test(input.entrypoint || '')) return input;
  const entry = input.entrypoint;
  if (path.posix.isAbsolute(entry) || entry.includes('\\') || entry.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Demo HTML entrypoint must be a normalized relative path');
  const directory = path.posix.dirname(entry);
  if (directory === '.') return input;
  const file = input.files.find(item => item?.path === entry);
  if (!file || (file.encoding && file.encoding !== 'utf8') || typeof file.content !== 'string') throw new Error('nested Demo HTML entrypoint must be declared as UTF-8 text');
  const markup = file.content.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, match => ' '.repeat(match.length));
  if (/<base\b/i.test(markup)) return input;
  const base = `<base href="/${entry.split('/').map(encodeURIComponent).join('/')}">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(markup), doctype = /^\s*<!doctype\s+html\s*>/i.exec(markup);
  const offset = head ? head.index + head[0].length : doctype ? doctype[0].length : 0;
  const content = `${file.content.slice(0, offset)}${base}${file.content.slice(offset)}`;
  return { ...input, files: input.files.map(item => item === file ? { ...item, content } : item) };
}
