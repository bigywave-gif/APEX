import { spawn } from 'node:child_process';
import { runCancellationRequested } from './run-ledger.mjs';

// Local child processes are isolated so cancellation can stop their process
// group without signalling unrelated sessions. Remote effects remain unknown.
export function runControlledSubprocess(command, args, { env, runDir, timeoutMs, maxBuffer = 1024 * 1024, pollMs = 500, monitorFailureGraceMs = 5000 }) {
  return new Promise(resolve => {
    try {
      if (runCancellationRequested(runDir, { busyTimeoutMs: 5000, requireLedger: true })) return resolve({ status: null, signal: null, error: null, stdout: '', stderr: '', cancelled: true });
    } catch (cause) {
      return resolve({ status: null, signal: null, error: Object.assign(new Error(`cancellation monitor unavailable: ${cause.message}`), { code: 'APEX_MONITOR_UNAVAILABLE' }), stdout: '', stderr: '', cancelled: false });
    }
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, { env, detached, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), error = null, cancelled = false, escalation = null, settled = false, monitorFailedAt = null;
    const signal = name => {
      if (!child.pid || settled) return;
      if (!detached && (child.exitCode !== null || child.signalCode !== null)) return;
      try { if (detached) process.kill(-child.pid, name); else child.kill(name); } catch (failure) { if (failure.code !== 'ESRCH') error ||= failure; }
    };
    const stop = () => { signal('SIGTERM'); if (!escalation) escalation = setTimeout(() => signal('SIGKILL'), 2000); };
    const append = (current, chunk) => {
      if (current.length + chunk.length > maxBuffer) { error ||= Object.assign(new Error('controlled subprocess output exceeded maxBuffer'), { code: 'ENOBUFS' }); stop(); return current; }
      return Buffer.concat([current, chunk]);
    };
    child.stdout.on('data', data => { stdout = append(stdout, data); });
    child.stderr.on('data', data => { stderr = append(stderr, data); });
    child.on('error', failure => { error ||= failure; });
    const timeout = setTimeout(() => { error ||= Object.assign(new Error('controlled subprocess timed out'), { code: 'ETIMEDOUT' }); stop(); }, timeoutMs);
    const polling = setInterval(() => {
      try { if (runCancellationRequested(runDir, { busyTimeoutMs: 100, requireLedger: true })) { cancelled = true; stop(); } monitorFailedAt = null; }
      catch (cause) {
        monitorFailedAt ??= Date.now();
        if (Date.now() - monitorFailedAt >= monitorFailureGraceMs) { error ||= Object.assign(new Error(`cancellation monitor unavailable: ${cause.message}`), { code: 'APEX_MONITOR_UNAVAILABLE' }); stop(); }
      }
    }, pollMs);
    child.on('close', (status, signalCode) => {
      if (settled) return; settled = true;
      clearTimeout(timeout); clearInterval(polling); if (escalation) clearTimeout(escalation);
      if (!error && !cancelled) {
        try { cancelled = runCancellationRequested(runDir, { busyTimeoutMs: 5000, requireLedger: true }); }
        catch (cause) { error = Object.assign(new Error(`cancellation monitor unavailable at completion: ${cause.message}`), { code: 'APEX_MONITOR_UNAVAILABLE' }); }
      }
      resolve({ status, signal: signalCode, error, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), cancelled });
    });
  });
}
