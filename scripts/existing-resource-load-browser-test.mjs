import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { npmCacheRoot } from './apex-paths.mjs';
import { resourceImageProbeCode } from './existing-resource-runtime.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-resource-load-'));
const cli = fs.readdirSync(npmCacheRoot).map(name => path.join(npmCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(fs.existsSync);
if (!cli) throw new Error('installed Playwright CLI is required');
const server = spawn(process.execPath, ['-e', `const http=require('node:http');http.createServer((req,res)=>{if(req.url==='/ok.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.fixtureLoaded=true')}if(req.url==='/ok.css'){res.setHeader('Content-Type','text/css');return res.end('body { color: rgb(1, 2, 3) }')}if(req.url==='/redirect.js'){res.writeHead(302,{Location:'/ok.js'});return res.end()}if(req.url==='/missing.js'||req.url==='/missing.css'){res.writeHead(404);return res.end('missing')}res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;self&#39;; script-src &#39;self&#39;"><link id="style" rel="stylesheet" href="/ok.css"><link id="bad-style" rel="stylesheet" href="/missing.css"><script id="script" src="/ok.js"></script><script id="bad" src="/missing.js"></script><script id="redirect" src="/redirect.js"></script><main>fixture</main>')}).listen(0,'127.0.0.1',function(){console.log(this.address().port)})`], { stdio: ['ignore','pipe','pipe'] });
const session = `resources-${path.basename(root)}`;
const call = args => spawnSync(process.execPath, [cli, '--session', session, ...args], { cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PWTEST_DAEMON_SESSION_DIR: path.join(root, 'daemon') } });
try {
 const port = await new Promise((resolve,reject) => { server.stdout.once('data', data => resolve(Number(String(data).trim()))); server.once('error', reject); server.once('exit', code => reject(new Error(`server exited ${code}`))); });
 const opened = call(['open', `http://127.0.0.1:${port}/`]); assert.equal(opened.status, 0, opened.stderr || opened.stdout);
 const checks = [
  { source:'index.html', reference:'/ok.js', screenId:'desktop', selector:'#script', kind:'loaded-script' },
  { source:'index.html', reference:'/ok.css', screenId:'desktop', selector:'#style', kind:'loaded-stylesheet' },
  { source:'index.html', reference:'/missing.js', screenId:'desktop', selector:'#bad', kind:'loaded-script' },
  { source:'index.html', reference:'/missing.css', screenId:'desktop', selector:'#bad-style', kind:'loaded-stylesheet' },
  { source:'index.html', reference:'/redirect.js', screenId:'desktop', selector:'#redirect', kind:'loaded-script' },
  { source:'index.html', reference:'/ok.js', screenId:'desktop', selector:'#style', kind:'loaded-script' },
  { source:'index.html', reference:'/never.js', screenId:'desktop', selector:'#never', kind:'not-applicable', resourceKind:'loaded-script', rationale:'This script is not used on this captured page.' },
  { source:'index.html', reference:'/ok.js', screenId:'desktop', selector:'#never', kind:'not-applicable', resourceKind:'loaded-script', rationale:'This script is not used on this captured page.' },
  { source:'index.html', reference:'/never.css', screenId:'desktop', selector:'#never', kind:'not-applicable', resourceKind:'loaded-stylesheet', rationale:'This stylesheet is not used on this captured page.' },
  { source:'index.html', reference:'/ok.css', screenId:'desktop', selector:'#never', kind:'not-applicable', resourceKind:'loaded-stylesheet', rationale:'This stylesheet is not used on this captured page.' }
 ];
 const result = call(['run-code', resourceImageProbeCode(checks)]); assert.equal(result.status, 0, result.stderr || result.stdout);
 const match = result.stdout.match(/### Result\s*\n([\s\S]*?)\n### /); assert.ok(match, result.stdout);
 let observations = JSON.parse(match[1].trim()); if (typeof observations === 'string') observations = JSON.parse(observations);
 assert.deepEqual(observations.map(item => item.status), ['passed','passed','unverified','unverified','unverified','unverified','not-rendered','unverified','not-rendered','unverified']);
 console.log(JSON.stringify({ status:'passed', test:'existing-resource-load-browser', checks:observations.length }));
} finally { call(['close']); server.kill('SIGTERM'); fs.rmSync(root, { recursive:true, force:true }); }
