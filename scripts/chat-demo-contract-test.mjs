#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileChatPreview, readChatPreview, demoPresentation, validateChatFragment, verifyChatPresentation } from './chat-demo.mjs';
import { demoHash } from './interactive-demo.mjs';
import { demoContract } from './interactive-demo-test-fixture.mjs';

const fragment = '<main id="preview"><button>操作</button></main><script>document.getElementById("preview");</script>';
const input = { entrypoint: 'index.html', files: [{ path: 'preview.html', content: fragment }], chatPreview: { fragment: 'preview.html', mode: 'wide' }, interactionContract: demoContract };
let checks = 0;
function check(fn) { fn(); checks++; }
function reject(fn) { check(() => assert.throws(fn)); }
check(() => assert.equal(compileChatPreview({ files: [] }).chatPreview, undefined));
const compiled = compileChatPreview(input);
check(() => assert(compiled.files[1].content.includes(fragment)));
for (const invalid of ['<!doctype html>', '<body id="x">x</body>', '<iframe id="x" src="http://localhost:1"></iframe>', '<main id="x"><script>fetch("/api")</script></main>', '<main id="x"><script src="./app.js"></script></main>', '<main id="x"><style>a{background:url("./asset.png")}</style></main>', '<main id="x"><script>import("./app.js")</script></main>', '<main id="x"><img srcset="x.png 1x"></main>', '<main id="x">' + 'a'.repeat(1024 * 1024)]) reject(() => validateChatFragment(invalid));
check(() => validateChatFragment('<main id="x"><img src="data:image/png;base64,AA=="><style>#x{background:url("data:image/png;base64,AA==")}</style></main>'));
reject(() => compileChatPreview({ ...input, files: [...input.files, { path: 'index.html', content: 'different Demo' }] }));
reject(() => compileChatPreview({ ...input, chatPreview: { fragment: '../preview.html' } }));
reject(() => compileChatPreview({ ...input, interactionContract: { ...demoContract, journeys: [{ route: '/settings' }] } }));
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-chat-demo-'));
try {
  fs.mkdirSync(path.join(runDir, 'visual-sandbox'));
  const manifest = { entrypoint: 'visual-sandbox/index.html', chatPreview: compiled.chatPreview, files: compiled.files.map(file => {
    fs.writeFileSync(path.join(runDir, 'visual-sandbox', file.path), file.content);
    return { path: `visual-sandbox/${file.path}`, sha256: demoHash(file.content) };
  }) };
  const preview = readChatPreview(runDir, manifest), demo = { chatPreview: preview };
  check(() => assert.equal(preview.sha256, demoHash(fragment)));
  check(() => assert(demoPresentation(runDir, demo).contentReference.includes(path.join(runDir, preview.path))));
  check(() => assert.equal(demoPresentation(runDir, demo, 'browser-panel').contentReference, undefined));
  check(() => verifyChatPresentation(runDir, demo, manifest, { surface: 'chat-inline', fragment: preview }));
  reject(() => verifyChatPresentation(runDir, demo, manifest, { surface: 'browser-panel' }));
  check(() => verifyChatPresentation(runDir, demo, manifest, { surface: 'browser-panel', fallbackReason: 'host has no inline renderer' }));
  reject(() => verifyChatPresentation(runDir, {}, manifest, { surface: 'chat-inline', fragment: preview }));
  reject(() => verifyChatPresentation(runDir, demo, manifest, { surface: 'chat-inline', fragment: { ...preview, sha256: 'changed' } }));
  fs.appendFileSync(path.join(runDir, preview.path), '<!-- drift -->');
  reject(() => readChatPreview(runDir, manifest));
  fs.writeFileSync(path.join(runDir, preview.path), fragment);
  fs.appendFileSync(path.join(runDir, manifest.entrypoint), '<!-- drift -->');
  reject(() => readChatPreview(runDir, manifest));
  console.log(JSON.stringify({ status: 'passed', checks }));
} finally { fs.rmSync(runDir, { recursive: true, force: true }); }
