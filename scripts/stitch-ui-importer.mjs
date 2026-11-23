#!/usr/bin/env node
import { canonicalApexRoot, playwrightBridge as pwcli, npmCacheRoot as npxCacheRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { buildStitchPrompt } from './stitch-adaptation.mjs';
import { externalSubmissionIntents, recordExternalSubmissionIntent, recordExternalSubmissionObservation, runCancellationRequested } from './run-ledger.mjs';
const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_TIMEOUT_MS = Number(process.env.APEX_STITCH_UI_TIMEOUT_MS || 30000);
function die(message) { console.error(`Stitch UI import failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function cachedCli() { try { return fs.readdirSync(npxCacheRoot).map(name => path.join(npxCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file)); } catch { return null; } }
function playwrightEnv(runDir) { const daemonDirectory = path.join(runDir, 'cache', 'playwright-daemon'); fs.mkdirSync(daemonDirectory, { recursive: true }); return { ...process.env, PWTEST_DAEMON_SESSION_DIR: daemonDirectory }; }
function call(session, cwd, args, runDir) { const cached = cachedCli(); const result = spawnSync(cached ? process.execPath : pwcli, cached ? [cached, '--session', session, ...args] : ['--session', session, ...args], { cwd, env: playwrightEnv(runDir), encoding: 'utf8', timeout: PLAYWRIGHT_TIMEOUT_MS }); return { command: args, runner: cached ? 'cached-playwright-cli' : 'bridge-playwright-cli', status: result.status === 0 ? 'passed' : 'failed', output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) }; }
function health(cwd, runDir) { const cached = cachedCli(); const result = spawnSync(cached ? process.execPath : pwcli, cached ? [cached, '--help'] : ['--help'], { cwd, env: playwrightEnv(runDir), encoding: 'utf8', timeout: Math.min(15000, PLAYWRIGHT_TIMEOUT_MS) }); return { command: ['health'], runner: cached ? 'cached-playwright-cli' : 'bridge-playwright-cli', status: result.status === 0 ? 'passed' : 'failed', output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) }; }
function authenticationProbe(session, cwd, runDir) { return call(session, cwd, ['run-code', 'async (page) => JSON.stringify({ top: page.url(), frames: page.frames().map(frame => frame.url()) })'], runDir); }
function probeValue(output) { try { const match = output.match(/### Result\s*\n([\s\S]*?)\n### /); if (!match) return null; const value = JSON.parse(match[1]); return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } }
function stitchUrl(value) { try { const url = new URL(value); return url.origin === 'https://stitch.withgoogle.com' && !url.username && !url.password; } catch { return false; } }
function verifyPageOrigin(session, runDir) { const probe = authenticationProbe(session, runDir, runDir); const value = probeValue(probe.output); return { command: ['validate-origin'], status: probe.status === 'passed' && stitchUrl(value?.top) ? 'passed' : 'failed', output: 'Stitch page origin checked before external action' }; }
const [command, runArg, planArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'import' || !runArg || !planArg) die('usage: import <run-dir> <stitch-ui-import-plan.json>');
if (!fs.existsSync(pwcli) && !cachedCli()) die(`Playwright bridge is unavailable: ${pwcli}; install the Playwright Skill or provide a valid npm cache`);
const runDir = path.resolve(runArg); const plan = read(path.resolve(planArg));
try { requireRouterAction(runDir, 'sync_stitch'); } catch (error) { die(error.message); }
for (const key of ['url', 'imagePath', 'prompt', 'uploadTriggerRef', 'promptRef', 'submitRef']) if (!plan[key]) die(`${key} is required`);
if (!stitchUrl(plan.url)) die('Stitch UI URL must use the official https://stitch.withgoogle.com origin');
const image = path.resolve(plan.imagePath); if (!fs.existsSync(image)) die(`image is missing: ${image}`);
const session = plan.session || `apex-stitch-${crypto.createHash('sha1').update(`${runDir}:${plan.url}`).digest('hex').slice(0,12)}`;
const imageHash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex')}`;
const state = read(path.join(runDir, 'state.json'));
if (state.roleChain?.confirmationModel === 'two-confirmations') {
  const baselinePath = path.join(runDir, 'runtime-visual-baseline.json');
  const baseline = read(baselinePath);
  const captures = [baseline.referenceImage, ...(baseline.screenCaptures || []).map(item => item.screenshot)].filter(Boolean);
  const root = fs.realpathSync(runDir);
  const actual = fs.realpathSync(image);
  const isApprovedCapture = captures.some(item => {
    if (!item.path || item.sha256 !== imageHash) return false;
    try {
      const capture = fs.realpathSync(path.resolve(runDir, item.path));
      return capture.startsWith(root + path.sep) && capture === actual;
    } catch { return false; }
  });
  if (!isApprovedCapture) die('image must be an unchanged screenshot from the confirmed Demo baseline');
}
let promptInfo; try { promptInfo = buildStitchPrompt(runDir, state, plan); } catch (error) { die(error.message); }
const promptHash = `sha256:${crypto.createHash('sha256').update(promptInfo.prompt).digest('hex')}`;
const evidenceFile = path.join(runDir, 'evidence', 'stitch-ui-import.json');
const jobFile = path.join(runDir, 'stitch-job.json');
const previous = fs.existsSync(evidenceFile) ? read(evidenceFile) : null;
const pendingStages = new Set(['submission-uncertain', 'submitted', 'observed']);
const pending = previous && pendingStages.has(previous.stage);
const durableIntents = externalSubmissionIntents(runDir).filter(intent => intent.provider === 'stitch');
if (durableIntents.some(intent => intent.operation === 'upload' && !['consumed', 'not-submitted'].includes(intent.status))) die('a durable Stitch upload may still exist; inspect or recover it before another upload');
if (!pending && durableIntents.some(intent => intent.operation !== 'upload' && !['ready', 'not-submitted'].includes(intent.status))) die('a durable Stitch submission may still exist; inspect or recover it before any new upload or generation');
if (pending && (previous.imageHash !== imageHash || previous.promptHash !== promptHash || previous.session !== session)) die('a prior Stitch submission may still be running; resolve or explicitly revoke it before changing input');
if (!previous && fs.existsSync(jobFile)) die('a Stitch job exists without its submission receipt; inspect the remote job before any new submission');
const browserHealth = health(runDir, runDir);
if (browserHealth.status !== 'passed') {
  const preserveSubmission = Boolean(pending);
  write(evidenceFile, preserveSubmission ? { ...previous, status: 'failed', stage: previous.stage, logs: [...(previous.logs || []), browserHealth], completedAt: new Date().toISOString(), note: 'Browser bridge health check failed while resuming an existing submission. The remote job is retained; no second upload or generation was attempted.' } : { schemaVersion: '3.0', status: 'browser-bridge-unavailable', stage: 'not-submitted', transport: 'stitch-ui-automation', session, imagePath: path.relative(runDir, image), imageHash, promptHash, logs: [browserHealth], completedAt: new Date().toISOString(), note: 'Browser bridge health check failed before any Stitch UI interaction. No upload or generation was attempted; resolve the bridge and retry.' });
  console.log(JSON.stringify({ evidence: evidenceFile, status: 'browser-bridge-unavailable', session })); process.exit(2);
}
let submissionIntentId = previous?.intentId || null;
const resumingSubmission = Boolean(pending);
const logs = [...(resumingSubmission ? previous.logs || [] : [])];
const observationLogs = [];
if (resumingSubmission) {
  if (!fs.existsSync(jobFile)) write(jobFile, { schemaVersion: '3.0', status: previous.stage === 'submission-uncertain' ? 'submission-uncertain' : 'submitted', transport: 'stitch-ui-automation', ...(previous.intentId ? { intentId: previous.intentId } : {}), ...(previous.skillAdaptation ? { skillAdaptation: previous.skillAdaptation } : {}), projectId: plan.projectId || null, screenId: plan.resultScreenId || null, imageHash, promptHash, submittedAt: previous.submittedAt || previous.intentAt, attempts: 0, note: 'Recover the existing submission; do not submit again.' });
  logs.push({ command: ['resume-submission'], status: 'passed', output: 'previous submission is reused; no second upload or submit is sent' });
}
else {
  logs.push(call(session, runDir, ['open', plan.url, '--headed'], runDir)); logs.push(call(session, runDir, ['snapshot'], runDir));
  const auth = logs.at(-1).status === 'passed' ? authenticationProbe(session, runDir, runDir) : { status: 'failed', output: 'snapshot did not complete' }; logs.push(auth);
  const observed = probeValue(auth.output);
  const authenticationRequired = Array.isArray(observed?.frames) && [observed.top, ...observed.frames].some(value => { try { return new URL(value).hostname === 'accounts.google.com'; } catch { return false; } });
  if (!authenticationRequired && (!observed || !stitchUrl(observed.top))) { logs.push({ command: ['validate-origin'], status: 'failed', output: 'Stitch page origin is missing or not official; no upload attempted' }); }
  if (runCancellationRequested(runDir)) die('run was cancelled before Stitch upload');
  if (!authenticationRequired && logs.at(-1).status === 'passed') logs.push(call(session, runDir, ['click', plan.uploadTriggerRef], runDir));
  if (!authenticationRequired && logs.at(-1).status === 'passed') logs.push(verifyPageOrigin(session, runDir));
  let uploadIntentId = null, uploadOutcome = null;
  if (!authenticationRequired && logs.at(-1).status === 'passed') {
    if (runCancellationRequested(runDir)) die('run was cancelled before Stitch upload');
    uploadIntentId = crypto.randomUUID();
    try { recordExternalSubmissionIntent(runDir, { intentId: uploadIntentId, provider: 'stitch', operation: 'upload', projectId: plan.projectId || null, imageHash, promptHash }); } catch (error) { die(error.message); }
    if (runCancellationRequested(runDir)) { recordExternalSubmissionObservation(runDir, { intentId: uploadIntentId, status: 'not-submitted', at: new Date().toISOString() }); die('run was cancelled before Stitch upload'); }
    const upload = call(session, runDir, ['upload', image], runDir); logs.push(upload);
    uploadOutcome = upload.status === 'passed' ? 'uploaded' : 'submission-uncertain';
    recordExternalSubmissionObservation(runDir, { intentId: uploadIntentId, status: uploadOutcome, at: new Date().toISOString() });
  }
  if (!authenticationRequired && logs.at(-1).status === 'passed') logs.push(verifyPageOrigin(session, runDir));
  if (!authenticationRequired && logs.at(-1).status === 'passed') logs.push(call(session, runDir, ['fill', plan.promptRef, promptInfo.prompt], runDir));
  if (!authenticationRequired && logs.at(-1).status === 'passed') logs.push(verifyPageOrigin(session, runDir));
  if (authenticationRequired || logs.at(-1).status !== 'passed') {
    const status = authenticationRequired ? 'authentication-required' : 'failed';
    const stage = uploadIntentId ? (uploadOutcome === 'uploaded' ? 'uploaded-unsubmitted' : 'upload-uncertain') : 'not-submitted';
    const note = authenticationRequired ? 'Stitch redirected to Google sign-in. No file was uploaded and no generation was requested; sign in in the headed browser, then rerun with fresh element references.' : uploadIntentId ? 'An upload was attempted or completed, but no generation was submitted. Inspect and recover the durable upload before any retry; do not upload again.' : 'No upload or generation was attempted; retry after correcting the observed failure.';
    write(evidenceFile, { schemaVersion: '3.0', status, stage, ...(uploadIntentId ? { uploadIntentId } : {}), transport: 'stitch-ui-automation', session, imagePath: path.relative(runDir, image), imageHash, promptHash, logs, completedAt: new Date().toISOString(), note });
    console.log(JSON.stringify({ evidence: evidenceFile, status, session })); process.exit(2);
  }
  // Persist before the external side effect: a timeout or crash after click
  // cannot prove whether the remote request succeeded.
  const intentAt = new Date().toISOString();
  const intentId = crypto.randomUUID(); submissionIntentId = intentId;
  try { recordExternalSubmissionIntent(runDir, { intentId, provider: 'stitch', uploadIntentId, projectId: plan.projectId || null, screenId: plan.resultScreenId || null, imageHash, promptHash, submittedAt: intentAt }); } catch (error) { die(error.message); }
  write(evidenceFile, { schemaVersion: '3.0', status: 'submission-uncertain', stage: 'submission-uncertain', transport: 'stitch-ui-automation', session, intentId, ...(promptInfo.adaptation ? { skillAdaptation: promptInfo.adaptation } : {}), imagePath: path.relative(runDir, image), imageHash, promptHash, logs, intentAt, note: 'Submit intent persisted; observe the existing remote job and do not resubmit.' });
  write(jobFile, { schemaVersion: '3.0', status: 'submission-uncertain', transport: 'stitch-ui-automation', intentId, ...(promptInfo.adaptation ? { skillAdaptation: promptInfo.adaptation } : {}), projectId: plan.projectId || null, screenId: plan.resultScreenId || null, imageHash, promptHash, submittedAt: intentAt, attempts: 0, note: 'Submission outcome may be unknown; bind the real screen before observation.' });
  if (uploadIntentId) recordExternalSubmissionObservation(runDir, { intentId: uploadIntentId, status: 'consumed', generationIntentId: intentId, at: new Date().toISOString() });
  if (runCancellationRequested(runDir)) { recordExternalSubmissionObservation(runDir, { intentId, status: 'not-submitted', at: new Date().toISOString() }); die('run was cancelled before Stitch submission'); }
  const submit = call(session, runDir, ['click', plan.submitRef], runDir); logs.push(submit);
  recordExternalSubmissionObservation(runDir, { intentId, status: submit.status === 'passed' ? 'submitted' : 'submission-uncertain', at: new Date().toISOString() });
  if (submit.status !== 'passed') {
    write(evidenceFile, { schemaVersion: '3.0', status: 'submission-uncertain', stage: 'submission-uncertain', transport: 'stitch-ui-automation', session, intentId, ...(promptInfo.adaptation ? { skillAdaptation: promptInfo.adaptation } : {}), imagePath: path.relative(runDir, image), imageHash, promptHash, logs, intentAt, note: 'The submit outcome is unknown. Observe the existing remote job; do not submit again.' });
    console.log(JSON.stringify({ evidence: evidenceFile, job: jobFile, status: 'submission-uncertain', session })); process.exit(2);
  }
  const submittedAt = new Date().toISOString();
  write(evidenceFile, { schemaVersion: '3.0', status: 'submitted', stage: 'submitted', transport: 'stitch-ui-automation', session, intentId, ...(promptInfo.adaptation ? { skillAdaptation: promptInfo.adaptation } : {}), imagePath: path.relative(runDir, image), imageHash, promptHash, logs, submittedAt, note: 'Generation was submitted. Retry resumes snapshot collection and does not upload or submit again.' });
  write(jobFile, { schemaVersion: '3.0', status: 'submitted', transport: 'stitch-ui-automation', intentId, ...(promptInfo.adaptation ? { skillAdaptation: promptInfo.adaptation } : {}), projectId: plan.projectId || null, screenId: plan.resultScreenId || null, imageHash, promptHash, submittedAt, attempts: 0, note: 'Bind the resulting Screen ID, then use observe_stitch to poll readiness. No retry may submit a second generation.' });
}
observationLogs.push(call(session, runDir, ['snapshot'], runDir)); logs.push(observationLogs.at(-1));
if (observationLogs.at(-1).status === 'passed') { observationLogs.push(call(session, runDir, ['screenshot'], runDir)); logs.push(observationLogs.at(-1)); }
const authenticationRequired = false;
const status = previous?.stage === 'submission-uncertain' ? 'submission-uncertain' : authenticationRequired ? 'authentication-required' : (observationLogs.length && observationLogs.every(item => item.status === 'passed') ? 'passed' : 'failed');
const artifact = { schemaVersion: '3.0', status, stage: status === 'submission-uncertain' ? 'submission-uncertain' : status === 'passed' ? 'observed' : 'submitted', transport: 'stitch-ui-automation', session, ...(submissionIntentId ? { intentId: submissionIntentId } : {}), ...(promptInfo.adaptation ? { skillAdaptation: promptInfo.adaptation } : {}), imagePath: path.relative(runDir, image), imageHash, promptHash, logs, completedAt: new Date().toISOString(), note: status === 'passed' ? 'Submission observed. Element references must come from the immediately preceding Stitch UI snapshot; stale references fail closed.' : 'Submission is retained. Retry resumes snapshot collection and does not upload or submit again.' };
write(evidenceFile, artifact); console.log(JSON.stringify({ evidence: evidenceFile, job: fs.existsSync(jobFile) ? jobFile : null, status, session, resumed: resumingSubmission })); if (status !== 'passed') process.exitCode = 2;
