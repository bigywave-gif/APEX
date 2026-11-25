#!/usr/bin/env node
/** Browser geometry checks; the APEX pipeline is exercised separately. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { npmCacheRoot, playwrightBridge } from './apex-paths.mjs';
import { inspectBoundMainViewport } from './viewport-main-evidence.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-main-viewport-'));
const session = `apex-main-${path.basename(root)}`;
const cached = (() => { try { return fs.readdirSync(npmCacheRoot).map(name => path.join(npmCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file)); } catch { return null; } })();
const env = { ...process.env, PWTEST_DAEMON_SESSION_DIR: path.join(root, 'daemon') };
function call(args) {
  const result = spawnSync(cached ? process.execPath : playwrightBridge, cached ? [cached, '--session', session, ...args] : ['--session', session, ...args], { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'browser command failed');
  return result.stdout;
}
function probe(html, binding = { visualNode: 'main', selector: '#target', sourceMarker: 'fixture', sourceSelectionIds: ['layout'] }) {
  const code = `async (page) => { await page.setContent(${JSON.stringify(html)}); return await (${inspectBoundMainViewport.toString()})(page, ${JSON.stringify([binding])}); }`;
  const output = call(['run-code', code]), match = output.match(/### Result\s*\n([\s\S]*?)\n### /);
  if (!match) throw new Error('browser result is missing');
  return JSON.parse(match[1]);
}
try {
  call(['open', 'about:blank']); call(['resize', '390', '844']);
  const normal = '<main><section id="target" data-apex-source="fixture">内容</section></main>';
  assert.equal(probe(normal).mainViewport.status, 'visible-or-scrollable');
  const many = '<div>' + Array.from({length:1001}, () => '<main><section class="target" data-apex-source="fixture">内容</section></main>').join('') + '</div>';
  assert.equal(probe(many, { visualNode: 'many', selector: '.target', sourceMarker: 'fixture', sourceSelectionIds: ['layout'] }).mainViewport.status, 'unverified');
  const manyNodes = '<main>' + '<section class="target" data-apex-source="fixture">内容</section>'.repeat(5001) + '</main>';
  assert.equal(probe(manyNodes, { visualNode: 'many-nodes', selector: '.target', sourceMarker: 'fixture', sourceSelectionIds: ['layout'] }).mainViewport.status, 'unverified');
  const offscreen = '<style>html,body{overflow:hidden}main{width:390px;height:200px;transform:translateX(650px)}</style>' + normal;
  assert.equal(probe(offscreen).mainViewport.status, 'offscreen');
  assert.equal(probe(offscreen + '<button style="position:fixed;left:10px;top:10px">打开菜单</button>').mainViewport.status, 'interactive-alternative');
  assert.equal(probe('<style>html,body{overflow-x:hidden;overflow-y:auto}main{width:390px;height:200px;transform:translateX(650px)}</style>' + normal + '<div style="height:2000px"></div>').mainViewport.status, 'scroll-alternative');
  assert.equal(probe(offscreen + '<button disabled style="position:fixed;left:10px;top:10px">不可操作</button>').mainViewport.status, 'offscreen');
  assert.equal(probe(offscreen + '<div>' + '<button disabled>不可操作</button>'.repeat(5001) + '</div>').mainViewport.status, 'unverified');
  assert.equal(probe(offscreen + '<div style="position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden"><button style="margin-left:20px">被裁切</button></div>').mainViewport.status, 'offscreen');
  const scrollable = '<div style="width:200px;overflow-x:auto"><div style="width:1000px"><main style="margin-left:600px;width:100px;height:100px"><section id="target" data-apex-source="fixture">内容</section></main></div></div>';
  assert.equal(probe(scrollable).mainViewport.status, 'visible-or-scrollable');
  assert.equal(probe('<main style="margin-top:1200px"><section id="target" data-apex-source="fixture">内容</section></main>').mainViewport.status, 'visible-or-scrollable');
  assert.equal(probe('<main hidden><section id="target" data-apex-source="fixture">内容</section></main>').mainViewport.status, 'not-applicable');
  assert.equal(probe('<main style="opacity:0"><section id="target" data-apex-source="fixture">内容</section></main>').mainViewport.status, 'not-applicable');
  assert.equal(probe('<div style="opacity:0"><main style="transform:translateX(650px)"><section id="target" data-apex-source="fixture">内容</section></main></div>').mainViewport.status, 'not-applicable');
  assert.equal(probe('<div id="target" data-apex-source="fixture">内容</div>').mainViewport.status, 'not-applicable');
  assert.equal(probe(normal, { visualNode: 'main', selector: '#target', sourceMarker: 'different', sourceSelectionIds: ['layout'] }).bindings[0].rendered, false);
  console.log(JSON.stringify({ status: 'passed', scope: 'real browser: bound main offscreen, reachable scrolling, below-fold and non-applicable cases' }));
} finally { try { call(['close']); } catch {} fs.rmSync(root, { recursive: true, force: true }); }
