#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { evidenceFor, pass } from './structure-evidence.mjs';
import { resolveStitchScreenReference } from './stitch-screen-binding.mjs';
import { resolveImplementationReference, resolveDirectImplementationReference } from './implementation-reference.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error('Structure contract export failed: ' + message); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(file + ': ' + error.message); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function hash(file) { return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function contract(visual, source, sourceImageHash, evidence, inputs) {
  return { schemaVersion: '3.0', source, sourceImageHash, contentLock: visual.contentLock, layoutLock: visual.layoutLock, analyticsLock: visual.analyticsLock, designTokens: visual.designTokens, componentContracts: visual.componentContracts, verification: { status: pass(evidence) ? 'passed' : 'failed', evidence, inputs, exportedAt: new Date().toISOString() } };
}
const [command, runArg, firstArg, secondArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die('APEX must run from canonical root: ' + canonicalApexRoot);
if (!['stitch', 'runtime', 'runtime-captured'].includes(command) || !runArg || !firstArg) die('usage: stitch <run-dir> <screen-id> | runtime <run-dir> <dom-html-file> <screenshot-file> | runtime-captured <run-dir> <capture-id>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, command === 'stitch' ? ['sync_stitch', 'compile_visual_bundle', 'validate_stitch'] : 'verify'); } catch (error) { die(error.message); }
const state = read(path.join(runDir, 'state.json'));
let visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
let result;
let runtimeHtmlArg = firstArg;
let runtimeImageArg = secondArg;
if (command === 'runtime-captured') {
  const capture = read(path.join(runDir, 'evidence', 'runtime-browser-capture.json'));
  const item = (capture.evidence || []).find(value => value.id === firstArg && value.status === 'captured');
  if (!item?.domHtml || !item?.screenshot) die('captured runtime screen is missing DOM HTML or screenshot: ' + firstArg);
  if (state.locks?.stitchSkipped && state.roleChain?.confirmationModel === 'two-confirmations') {
    const baseline = read(path.join(runDir, state.artifacts.runtimeVisualBaseline || 'runtime-visual-baseline.json'));
    if ((baseline.screenCaptures || []).length > 1) { try { visual = resolveDirectImplementationReference(runDir, state, item).visual; } catch (error) { die(error.message); } }
  }
  if (secondArg && !state.locks?.stitchSkipped) {
    const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
    const screen = freeze.approvedScreens.find(value => value.screenId === secondArg);
    if (!screen) die('selected frozen Stitch screen is missing: ' + secondArg);
    try { const selected = resolveImplementationReference(runDir, state, { kind: 'stitch', imageHash: screen.imageHash, screenId: screen.screenId }, item); if (selected.visual) visual = selected.visual; } catch (error) { die(error.message); }
  }
  runtimeHtmlArg = path.resolve(runDir, item.domHtml);
  runtimeImageArg = path.resolve(runDir, item.screenshot);
}
if (command === 'stitch') {
  const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screen = freeze.approvedScreens.find(item => item.screenId === firstArg);
  if (!screen) die('frozen screen is not approved: ' + firstArg);
  if (freeze.approvedScreens.length > 1) { try { visual = resolveStitchScreenReference(runDir, state, screen).visual; } catch (error) { die(error.message); } }
  const htmlFile = path.resolve(runDir, screen.htmlPath || '');
  const imageFile = path.resolve(runDir, screen.imagePath || '');
  if (!fs.existsSync(htmlFile) || !fs.existsSync(imageFile)) die('frozen screen must include materialized htmlPath and imagePath');
  if (hash(imageFile) !== screen.imageHash) die('frozen screen image hash does not match downloaded screenshot');
  const evidence = evidenceFor(visual, fs.readFileSync(htmlFile, 'utf8'));
  result = contract(visual, 'stitch-screen-export', screen.imageHash, evidence, { screenId: screen.screenId, htmlPath: screen.htmlPath, imagePath: screen.imagePath, htmlHash: hash(htmlFile) });
  const output = path.join(runDir, 'evidence', 'contracts', 'stitch-' + screen.screenId + '.json');
  write(output, result); console.log(JSON.stringify({ contract: output, status: result.verification.status, evidence: result.verification.evidence })); if (result.verification.status !== 'passed') process.exitCode = 2;
} else {
  if (!runtimeImageArg) die('runtime export requires <dom-html-file> <screenshot-file>');
  const htmlFile = path.resolve(runtimeHtmlArg), imageFile = path.resolve(runtimeImageArg);
  if (!fs.existsSync(htmlFile) || !fs.existsSync(imageFile)) die('runtime DOM HTML and screenshot files must exist');
  const evidence = evidenceFor(visual, fs.readFileSync(htmlFile, 'utf8'));
  result = contract(visual, 'runtime-dom-export', hash(imageFile), evidence, { htmlPath: htmlFile, imagePath: imageFile, htmlHash: hash(htmlFile) });
  const output = path.join(runDir, 'evidence', 'contracts', 'runtime-' + path.basename(imageFile).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') + '.json');
  write(output, result); console.log(JSON.stringify({ contract: output, status: result.verification.status, evidence: result.verification.evidence })); if (result.verification.status !== 'passed') process.exitCode = 2;
}
