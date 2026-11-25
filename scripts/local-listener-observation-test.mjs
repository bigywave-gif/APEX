import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { observeLocalListener } from './local-listener-observation.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-listener-owner-'));
let child;
async function listen(cwd, port = 0) {
  const script = `require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.argv[1]),'127.0.0.1',function(){console.log(this.address().port)})`;
  const processChild = spawn(process.execPath, ['-e', script, String(port)], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const actual = await new Promise((resolve, reject) => {
    let output = '';
    processChild.stdout.on('data', data => { output += data; if (output.includes('\n')) resolve(Number(output.trim())); });
    processChild.on('error', reject); processChild.on('exit', code => reject(new Error(`fixture server exited: ${code}`)));
  });
  return { processChild, port: actual };
}
async function stop() { if (!child) return; const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exit; child = null; }
try {
  if (process.platform !== 'darwin') { console.log(JSON.stringify({ status: 'skipped', reason: 'fixture requires macOS process tools' })); process.exit(0); }
  const first = await listen(root); child = first.processChild;
  const observed = observeLocalListener(first.port, root);
  assert.ok(observed); assert.equal(observed.pid, child.pid); assert.equal(observed.cwd, fs.realpathSync(root));
  await stop(); assert.equal(observeLocalListener(first.port, root), null);
  const second = await listen(root, first.port); child = second.processChild;
  const replaced = observeLocalListener(first.port, root);
  assert.ok(replaced); assert.notEqual(replaced.pid, observed.pid, 'a replacement listener must not match the original process');
  await stop();
  const foreign = await listen(os.tmpdir(), first.port); child = foreign.processChild;
  assert.equal(observeLocalListener(first.port, root), null, 'a listener outside the project must remain unverified');
  console.log(JSON.stringify({ status: 'passed', test: 'local-listener-observation' }));
} finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
