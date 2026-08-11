#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
function die(message) { console.error('Strict replica failed: ' + message); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(file + ': ' + error.message); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function invoke(script, args) {
  const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', script), ...args], { encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) die((result.stderr || result.stdout || script + ' failed').trim());
  const lines = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  try { return JSON.parse(lines.at(-1)); } catch { die(script + ' returned no JSON result'); }
}
function relative(runDir, target) { return path.relative(runDir, path.resolve(target)); }

const [command, runArg, idArg, screenArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die('APEX must run from canonical root: ' + canonicalApexRoot);
if (!['stitch', 'runtime'].includes(command) || !runArg || !idArg) die('usage: stitch <run-dir> <screen-id> | runtime <run-dir> <capture-id> [frozen-stitch-screen-id]');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, command === 'stitch' ? 'validate_stitch' : 'verify'); } catch (error) { die(error.message); }
if (command === 'stitch') {
  const state = read(path.join(runDir, 'state.json'));
  const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screen = freeze.approvedScreens.find(item => item.screenId === idArg);
  if (!screen) die('approved frozen Stitch screen not found: ' + idArg);
  const exported = invoke('structure-contract.mjs', ['stitch', runDir, idArg]);
  const parityInput = { candidateImage: screen.imagePath, candidateTextPath: screen.htmlPath, candidateContractPath: relative(runDir, exported.contract) };
  const inputFile = path.join(runDir, 'evidence', 'parity', 'stitch-' + idArg + '.json');
  write(inputFile, parityInput);
  const parity = invoke('visual-parity.mjs', ['compare', runDir, 'stitch', inputFile]);
  // Seal is deliberately not part of validation. The user must first confirm
  // the passed candidate; only the later sync_stitch seal action may mark it current.
  console.log(JSON.stringify({ stage: 'stitch', status: parity.status || 'passed', parityInput: inputFile, contract: exported.contract, evidence: parity.evidence, next: 'request Stitch approval, then sync_stitch seal' }));
} else {
  const state = read(path.join(runDir, 'state.json'));
  const skipped = state.locks?.stitchSkipped === true;
  const visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
  const freeze = skipped ? null : read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screen = skipped ? null : freeze.approvedScreens.find(item => item.screenId === screenArg);
  if (!skipped && (!screenArg || !screen)) die('approved frozen Stitch screen not found: ' + screenArg);
  const capture = read(path.join(runDir, 'evidence', 'browser-capture.json'));
  const item = (capture.evidence || []).find(value => value.id === idArg && value.status === 'captured');
  if (!item?.screenshot) die('captured runtime screen not found: ' + idArg);
  const exported = invoke('structure-contract.mjs', ['runtime-captured', runDir, idArg]);
  const parityInput = { candidateImage: item.screenshot, candidateTextPath: item.domHtml, candidateContractPath: relative(runDir, exported.contract), baseline: skipped ? { kind: 'effect-image', imageHash: visual.referenceImage.sha256 } : { kind: 'stitch', imageHash: screen.imageHash } };
  const inputFile = path.join(runDir, 'evidence', 'parity', 'runtime-' + idArg + '.json');
  write(inputFile, parityInput);
  const parity = invoke('visual-parity.mjs', ['compare', runDir, 'implementation', inputFile]);
  console.log(JSON.stringify({ stage: 'implementation', status: parity.status || 'passed', parityInput: inputFile, contract: exported.contract, evidence: parity.evidence }));
}
