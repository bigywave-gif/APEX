/** Deterministic test data. Synthetic evidence here is only for contract tests. */
import fs from 'node:fs';
import { wrapChatFragment } from './chat-demo.mjs';
export const demoFragment = fs.readFileSync(new URL('../core/templates/chat-demo-example.html', import.meta.url), 'utf8');
import path from 'node:path';
import { demoHash, interactionSource } from './interactive-demo.mjs';

const probe = value => ({ selector: '#count', property: 'text', equals: value });
const increment = { action: 'click', selector: '#increment', before: probe('0'), after: probe('1') };
export const demoContract = {
  schemaVersion: '1.0', kind: 'interactive-ui-prototype', dataMode: 'mock',
  notice: { selector: '#notice', text: '交互预览 · 示例数据' },
  journeys: [
    { id: 'add', kind: 'task', task: '添加示例项目', route: '/', steps: [increment] },
    { id: 'reset', kind: 'reset', task: '重置演示', route: '/', steps: [increment, { action: 'click', selector: '#reset', before: probe('1'), after: probe('0') }] }
  ]
};
export const demoHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>APEX 交互验收样例</title>
<style>body{font:18px system-ui;background:#181c24;color:#eef2fa;max-width:800px;margin:64px auto;padding:24px}button{font:inherit;padding:12px 20px;margin:12px 12px 12px 0;border:0;border-radius:8px;cursor:pointer}#count{font-size:48px}#notice{color:#a7b7d1}</style>
<main data-apex-source-selection="layout-a chart-b style-a font-a content-a"><p id="notice">交互预览 · 示例数据</p><h1>APEX 前端 Demo 交互验收</h1><p>点击添加，查看数量变化，然后重置演示。</p><p id="count" aria-live="polite">0</p><button id="increment">添加示例项目</button><button id="reset">重置演示</button></main>
<script>let count=0;document.querySelector('#increment').onclick=()=>document.querySelector('#count').textContent=String(++count);document.querySelector('#reset').onclick=()=>{count=0;document.querySelector('#count').textContent='0'}</script></html>`;

export function seedInteractionFixture(runDir, url = 'http://127.0.0.1:4173/', chat = false) {
  fs.mkdirSync(path.join(runDir, 'visual-sandbox'), { recursive: true });
  const entry = path.join(runDir, 'visual-sandbox/index.html');
  if (chat) { fs.writeFileSync(entry, wrapChatFragment(demoFragment)); fs.writeFileSync(path.join(runDir, 'visual-sandbox/preview.html'), demoFragment); }
  else if (!fs.existsSync(entry)) fs.writeFileSync(entry, demoHtml);
  const manifest = { schemaVersion: '3.0', entrypoint: 'visual-sandbox/index.html', interactionContract: demoContract, files: [{ path: 'visual-sandbox/index.html', sha256: demoHash(fs.readFileSync(entry)) }] };
  if (chat) { manifest.chatPreview = { fragment: 'preview.html' }; manifest.files.push({ path: 'visual-sandbox/preview.html', sha256: demoHash(demoFragment) }); }
  fs.writeFileSync(path.join(runDir, 'visual-sandbox-files.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  const artifact = { path: 'evidence/fixture.txt', sha256: demoHash('contract-test-only') };
  fs.writeFileSync(path.join(runDir, artifact.path), 'contract-test-only');
  const source = interactionSource(runDir);
  const interactiveDemo = {
    url, status: 'passed', contractHash: source.contractHash, sourceManifestHash: source.sourceManifestHash,
    journeys: demoContract.journeys.map(journey => ({ id: journey.id, url: new URL(journey.route, url).href, finalUrl: new URL(journey.route, url).href, viewport: '1440x900', status: 'passed', noticeVisible: true, blockedRequests: [], steps: journey.steps.map(step => ({ action: step.action, selector: step.selector, before: step.before.equals, after: step.after.equals, passed: true })), screenshot: artifact, dom: artifact }))
  };
  return interactiveDemo;
}

// Only synthetic contract tests use this fixture; it is not design evidence.
export function seedDesignContract(runDir) {
  const content = '# Fixture design contract\n';
  fs.writeFileSync(path.join(runDir, 'DESIGN.md'), content);
  return { designContract: { path: 'DESIGN.md', sha256: demoHash(content) } };
}
