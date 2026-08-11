#!/usr/bin/env node
import { canonicalApexRoot, playwrightBridge as pwcli, npmCacheRoot as npxCacheRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_TIMEOUT_MS = Number(process.env.APEX_STITCH_UI_TIMEOUT_MS || 30000);
function die(message) { console.error(`Stitch UI import failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function cachedCli() { try { return fs.readdirSync(npxCacheRoot).map(name => path.join(npxCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file)); } catch { return null; } }
function call(session, cwd, args) { const cached = cachedCli(); const result = spawnSync(cached ? process.execPath : pwcli, cached ? [cached, '--session', session, ...args] : ['--session', session, ...args], { cwd, encoding: 'utf8', timeout: PLAYWRIGHT_TIMEOUT_MS }); return { command: args, runner: cached ? 'cached-playwright-cli' : 'bridge-playwright-cli', status: result.status === 0 ? 'passed' : 'failed', output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) }; }
function health(cwd) { const cached = cachedCli(); const result = spawnSync(cached ? process.execPath : pwcli, cached ? [cached, '--help'] : ['--help'], { cwd, encoding: 'utf8', timeout: Math.min(15000, PLAYWRIGHT_TIMEOUT_MS) }); return { command: ['health'], runner: cached ? 'cached-playwright-cli' : 'bridge-playwright-cli', status: result.status === 0 ? 'passed' : 'failed', output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) }; }
function authenticationProbe(session, cwd) { return call(session, cwd, ['run-code', 'async (page) => JSON.stringify({ top: page.url(), frames: page.frames().map(frame => frame.url()) })']); }
const [command, runArg, planArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'import' || !runArg || !planArg) die('usage: import <run-dir> <stitch-ui-import-plan.json>');
if (!fs.existsSync(pwcli) && !cachedCli()) die(`Playwright bridge is unavailable: ${pwcli}; install the Playwright Skill or provide a valid npm cache`);
const runDir = path.resolve(runArg); const plan = read(path.resolve(planArg));
try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
for (const key of ['url', 'imagePath', 'prompt', 'uploadTriggerRef', 'promptRef', 'submitRef']) if (!plan[key]) die(`${key} is required`);
const image = path.resolve(plan.imagePath); if (!fs.existsSync(image)) die(`image is missing: ${image}`);
const session = plan.session || `apex-stitch-${crypto.createHash('sha1').update(`${runDir}:${plan.url}`).digest('hex').slice(0,12)}`;
const imageHash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex')}`;
const promptHash = `sha256:${crypto.createHash('sha256').update(plan.prompt).digest('hex')}`;
const evidenceFile = path.join(runDir, 'evidence', 'stitch-ui-import.json');
const jobFile = path.join(runDir, 'stitch-job.json');
const previous = fs.existsSync(evidenceFile) ? read(evidenceFile) : null;
const browserHealth = health(runDir);
if (browserHealth.status !== 'passed') {
  const preserveSubmission = previous?.stage === 'submitted' && previous.imageHash === imageHash && previous.promptHash === promptHash;
  write(evidenceFile, preserveSubmission ? { ...previous, status: 'failed', stage: 'submitted', logs: [...(previous.logs || []), browserHealth], completedAt: new Date().toISOString(), note: 'Browser bridge health check failed while resuming an existing submission. The remote job is retained; no second upload or generation was attempted.' } : { schemaVersion: '3.0', status: 'browser-bridge-unavailable', stage: 'not-submitted', transport: 'stitch-ui-automation', session, imagePath: path.relative(runDir, image), imageHash, promptHash, logs: [browserHealth], completedAt: new Date().toISOString(), note: 'Browser bridge health check failed before any Stitch UI interaction. No upload or generation was attempted; resolve the bridge and retry.' });
  console.log(JSON.stringify({ evidence: evidenceFile, status: 'browser-bridge-unavailable', session })); process.exitCode = 2;
}
const resumingSubmission = previous?.stage === 'submitted' && previous.imageHash === imageHash && previous.promptHash === promptHash;
const logs = [...(resumingSubmission ? previous.logs || [] : [])];
const observationLogs = [];
if (resumingSubmission) logs.push({ command: ['resume-submission'], status: 'passed', output: 'previous submission is reused; no second upload or submit is sent' });
else {
  logs.push(call(session, runDir, ['open', plan.url, '--headed'])); logs.push(call(session, runDir, ['snapshot']));
  const auth = logs.at(-1).status === 'passed' ? authenticationProbe(session, runDir) : { status: 'failed', output: 'snapshot did not complete' }; logs.push(auth);
  const authenticationRequired = /accounts\.google\.com/.test(auth.output);
  if (!authenticationRequired && logs.at(-1).status === 'passed') logs.push(call(session, runDir, ['click', plan.uploadTriggerRef]));
  if (logs.at(-1).status === 'passed') logs.push(call(session, runDir, ['upload', image]));
  if (logs.at(-1).status === 'passed') logs.push(call(session, runDir, ['fill', plan.promptRef, plan.prompt]));
  if (logs.at(-1).status === 'passed') logs.push(call(session, runDir, ['click', plan.submitRef]));
  if (authenticationRequired || logs.at(-1).status !== 'passed') {
    const status = authenticationRequired ? 'authentication-required' : 'failed';
    write(evidenceFile, { schemaVersion: '3.0', status, stage: 'not-submitted', transport: 'stitch-ui-automation', session, imagePath: path.relative(runDir, image), imageHash, promptHash, logs, completedAt: new Date().toISOString(), note: authenticationRequired ? 'Stitch redirected to Google sign-in. No file was uploaded and no generation was requested; sign in in the headed browser, then rerun with fresh element references.' : 'No submission was confirmed; retry is safe.' });
    console.log(JSON.stringify({ evidence: evidenceFile, status, session })); process.exitCode = 2;
  }
  // Persist immediately after submit so a timeout while the remote generation is
  // running resumes observation instead of submitting another duplicate screen.
  const submittedAt = new Date().toISOString();
  write(evidenceFile, { schemaVersion: '3.0', status: 'submitted', stage: 'submitted', transport: 'stitch-ui-automation', session, imagePath: path.relative(runDir, image), imageHash, promptHash, logs, submittedAt, note: 'Generation was submitted. Retry resumes snapshot collection and does not upload or submit again.' });
  write(jobFile, { schemaVersion: '3.0', status: 'submitted', transport: 'stitch-ui-automation', projectId: plan.projectId || null, screenId: plan.resultScreenId || null, imageHash, promptHash, submittedAt, attempts: 0, note: 'Bind the resulting Screen ID, then use observe_stitch to poll readiness. No retry may submit a second generation.' });
}
observationLogs.push(call(session, runDir, ['snapshot'])); logs.push(observationLogs.at(-1));
if (observationLogs.at(-1).status === 'passed') { observationLogs.push(call(session, runDir, ['screenshot'])); logs.push(observationLogs.at(-1)); }
const authenticationRequired = false;
const status = authenticationRequired ? 'authentication-required' : (observationLogs.length && observationLogs.every(item => item.status === 'passed') ? 'passed' : 'failed');
const artifact = { schemaVersion: '3.0', status, stage: status === 'passed' ? 'observed' : 'submitted', transport: 'stitch-ui-automation', session, imagePath: path.relative(runDir, image), imageHash, promptHash, logs, completedAt: new Date().toISOString(), note: status === 'passed' ? 'Submission observed. Element references must come from the immediately preceding Stitch UI snapshot; stale references fail closed.' : 'Submission is retained. Retry resumes snapshot collection and does not upload or submit again.' };
write(evidenceFile, artifact); console.log(JSON.stringify({ evidence: evidenceFile, job: fs.existsSync(jobFile) ? jobFile : null, status, session, resumed: resumingSubmission })); if (status !== 'passed') process.exitCode = 2;
