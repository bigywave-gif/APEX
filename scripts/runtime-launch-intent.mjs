import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function readRuntimeLaunchIntent(runDir, runId) {
  const file = path.join(runDir, 'runtime-launch-intent.json');
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) return null;
  const root = fs.realpathSync(runDir), real = fs.realpathSync(file);
  if (!real.startsWith(`${root}${path.sep}`) || !fs.statSync(real).isFile()) throw new Error('runtime launch intent is outside the Run');
  const intent = JSON.parse(fs.readFileSync(real, 'utf8'));
  if (intent.schemaVersion !== '1.0' || intent.runId !== runId || intent.host !== os.hostname() || !/^[a-f0-9-]{36}$/.test(intent.id || '') || !['127.0.0.1', '::1'].includes(intent.bindHost) || !Number.isInteger(intent.port) || intent.port < 1024 || intent.port > 65535 || intent.runtimeRoot !== path.join(root, 'visual-sandbox')) throw new Error('runtime launch intent is invalid or belongs to another host');
  return intent;
}

export function findRuntimeLaunchProcess(intent) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,stat=,command=', '-ww'], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('runtime launch process inspection is unavailable');
  const marker = ` --apex-start-id ${intent.id} `, expected = ` serve ${intent.runtimeRoot} ${intent.port} --apex-run-id ${intent.runId} --bind-host ${intent.bindHost} `;
  const matches = [];
  for (const line of result.stdout.split('\n')) {
    const parsed = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!parsed || parsed[2].includes('Z') || !`${parsed[3]} `.includes(marker)) continue;
    if (!parsed[3].includes('visual-sandbox-runtime.mjs serve ') || !`${parsed[3]} `.includes(expected)) throw new Error('runtime launch identity is ambiguous');
    matches.push(Number(parsed[1]));
  }
  if (matches.length > 1) throw new Error('multiple processes match the runtime launch intent');
  return matches[0] || null;
}
