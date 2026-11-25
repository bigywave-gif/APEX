import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// This is process evidence, not proof of which files a server serves. Refuse
// ambiguous listeners, inaccessible process metadata, and unavailable tools.
export function observeLocalListener(port, projectRoot) {
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || process.platform === 'win32') return null;
    const invoke = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024 });
    const listener = invoke('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
    if (listener.status !== 0) return null;
    const pids = [...new Set(listener.stdout.split(/\r?\n/).filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))];
    if (pids.length !== 1 || !Number.isSafeInteger(pids[0]) || pids[0] < 2) return null;
    const pid = pids[0], cwd = invoke('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const start = invoke('/bin/ps', ['-p', String(pid), '-o', 'lstart=']);
    if (cwd.status !== 0 || start.status !== 0 || !start.stdout.trim()) return null;
    const paths = cwd.stdout.split(/\r?\n/).filter(line => line.startsWith('n')).map(line => line.slice(1));
    if (paths.length !== 1) return null;
    const directory = fs.realpathSync(paths[0]), project = fs.realpathSync(projectRoot);
    if (directory !== project && !directory.startsWith(`${project}${path.sep}`)) return null;
    return { pid, startedAt: start.stdout.trim(), cwd: directory };
  } catch { return null; }
}
