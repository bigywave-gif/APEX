#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { resolveStitchScreenReference } from './stitch-screen-binding.mjs';
import { resolveDirectImplementationReference } from './implementation-reference.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error('Strict replica failed: ' + message); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(file + ': ' + error.message); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function invoke(script, args, { allowVerifiedDifference = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', script), ...args], { encoding: 'utf8', timeout: 180000 });
  if (result.status === 2 && allowVerifiedDifference) {
    try { const output = JSON.parse((result.stdout || '').trim().split(/\r?\n/).at(-1)); if (output.status === 'failed' && output.contract && fs.existsSync(output.contract)) return output; } catch {}
  }
  if (result.status !== 0) {
    // Preserve structured mismatch evidence for the gateway's failed-operation receipt.
    if (result.stdout) process.stdout.write(result.stdout);
    die((result.stderr || result.stdout || script + ' failed').trim());
  }
  const lines = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  try { return JSON.parse(lines.at(-1)); } catch { die(script + ' returned no JSON result'); }
}
function relative(runDir, target) { return path.relative(runDir, path.resolve(target)); }

const [command, runArg, idArg, screenArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die('APEX must run from canonical root: ' + canonicalApexRoot);
if (!['stitch', 'runtime'].includes(command) || !runArg || !idArg) die('usage: stitch <run-dir> <screen-id> | runtime <run-dir> <capture-id> [frozen-stitch-screen-id]');
const runDir = path.resolve(runArg);
// Stitch candidate parity is part of the `sync_stitch` automatic chain.  Keep
// `validate_stitch` for its explicit validation route, but do not make the
// workflow registry advertise an executor that its own guard will reject.
try { requireRouterAction(runDir, command === 'stitch' ? ['sync_stitch', 'validate_stitch'] : 'verify'); } catch (error) { die(error.message); }
if (command === 'stitch') {
  const state = read(path.join(runDir, 'state.json'));
  const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screen = freeze.approvedScreens.find(item => item.screenId === idArg);
  if (!screen) die('approved frozen Stitch screen not found: ' + idArg);
  let demoBinding = null;
  if (freeze.approvedScreens.length > 1) {
    try { demoBinding = resolveStitchScreenReference(runDir, state, screen).binding; } catch (error) { die(error.message); }
  }

  const exported = invoke('structure-contract.mjs', ['stitch', runDir, idArg], { allowVerifiedDifference: state.roleChain?.confirmationModel === 'two-confirmations' });
  const parityInput = { screenId: screen.screenId, ...(demoBinding ? { demoBinding } : {}), candidateImage: screen.imagePath, candidateTextPath: screen.htmlPath, candidateContractPath: relative(runDir, exported.contract) };
  const inputFile = path.join(runDir, 'evidence', 'parity', 'stitch-' + idArg + '.json');
  write(inputFile, parityInput);
  const parity = invoke('visual-parity.mjs', ['compare', runDir, 'stitch', inputFile]);
  // Validation never seals the candidate; the Router decides the next step.
  console.log(JSON.stringify({ stage: 'stitch', status: parity.status || 'passed', parityInput: inputFile, contract: exported.contract, evidence: parity.evidence, screenEvidence: parity.screenEvidence, next: state.roleChain?.confirmationModel === 'two-confirmations' ? 'sync_stitch seal when unchanged; request a user decision for verified differences' : 'request Stitch approval, then sync_stitch seal' }));
} else {
  const state = read(path.join(runDir, 'state.json'));
  const skipped = state.locks?.stitchSkipped === true;
  const visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
  const freeze = skipped ? null : read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screen = skipped ? null : freeze.approvedScreens.find(item => item.screenId === screenArg);
  if (!skipped && (!screenArg || !screen)) die('approved frozen Stitch screen not found: ' + screenArg);
  const capture = read(path.join(runDir, 'evidence', 'runtime-browser-capture.json'));
  const item = (capture.evidence || []).find(value => value.id === idArg && value.status === 'captured');
  if (!item?.screenshot) die('captured runtime screen not found: ' + idArg);
  let directReference = null;
  if (skipped && state.roleChain?.confirmationModel === 'two-confirmations') {
    const baseline = read(path.join(runDir, state.artifacts.runtimeVisualBaseline || 'runtime-visual-baseline.json'));
    if ((baseline.screenCaptures || []).length > 1) { try { directReference = resolveDirectImplementationReference(runDir, state, item); } catch (error) { die(error.message); } }
  }
  const exported = invoke('structure-contract.mjs', ['runtime-captured', runDir, idArg, ...(screen ? [screen.screenId] : [])]);
  const parityInput = { candidateImage: item.screenshot, candidateTextPath: item.domHtml, candidateContractPath: relative(runDir, exported.contract), captureId: item.id, baseline: skipped ? { kind: 'effect-image', imageHash: directReference?.visual.referenceImage.sha256 || visual.referenceImage.sha256, ...(directReference ? { screenId: directReference.capture.id } : {}) } : { kind: 'stitch', imageHash: screen.imageHash, screenId: screen.screenId } };
  const inputFile = path.join(runDir, 'evidence', 'parity', 'runtime-' + idArg + '.json');
  write(inputFile, parityInput);
  const parity = invoke('visual-parity.mjs', ['compare', runDir, 'implementation', inputFile]);
  console.log(JSON.stringify({ stage: 'implementation', status: parity.status || 'passed', parityInput: inputFile, contract: exported.contract, evidence: parity.evidence, ...(parity.screenEvidence ? { screenEvidence: parity.screenEvidence } : {}) }));
}
