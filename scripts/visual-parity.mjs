#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';
import { archiveArtifacts, commitRunState, readRunStateForUpdate } from './run-ledger.mjs';
import { resolveStitchScreenReference } from './stitch-screen-binding.mjs';
import { resolveImplementationReference, resolveDirectImplementationReference } from './implementation-reference.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Visual parity failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function textFrom(file) { return fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' '); }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(key => key !== 'hash').sort().map(key => [key, canonical(value[key])])); return value; }
function same(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function ocr(image, languages) {
  const binary = process.env.APEX_TESSERACT_BIN || '/opt/homebrew/bin/tesseract';
  if (!fs.existsSync(binary)) return { status: 'unavailable', reason: `OCR binary is missing: ${binary}` };
  const available = spawnSync(binary, ['--list-langs'], { encoding: 'utf8', timeout: 30000 });
  if (available.status !== 0) return { status: 'unavailable', reason: available.stderr || 'cannot list OCR languages' };
  const installed = available.stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean).filter(item => !item.startsWith('List of'));
  const requested = languages.split('+').filter(Boolean);
  const missing = requested.filter(language => !installed.includes(language));
  if (missing.length) return { status: 'unavailable', installed, missing, reason: `missing OCR languages: ${missing.join(', ')}` };
  const result = spawnSync(binary, [image, 'stdout', '-l', languages], { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) return { status: 'failed', reason: result.stderr || 'OCR command failed' };
  return { status: 'passed', languages: requested, text: result.stdout.replace(/\s+/g, ' ').trim() };
}
function compare(reference, candidate) {
  const source = `from PIL import Image, ImageChops, ImageStat
import json,sys
a=Image.open(sys.argv[1]).convert('RGBA'); b=Image.open(sys.argv[2]).convert('RGBA')
if a.size != b.size: print(json.dumps({'sameSize':False,'referenceSize':a.size,'candidateSize':b.size})); sys.exit(0)
d=ImageChops.difference(a,b); s=ImageStat.Stat(d); mean=sum(s.mean)/len(s.mean); px=list(d.getdata()); changed=sum(1 for p in px if max(p)>0); print(json.dumps({'sameSize':True,'referenceSize':a.size,'candidateSize':b.size,'meanAbsoluteError':mean,'changedRatio':changed/len(px)}))`;
  const result = spawnSync('/usr/bin/python3', ['-c', source, reference, candidate], { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) die(`image comparison unavailable: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
function contractFrom(input, runDir) { if (!input.candidateContractPath) return null; const file = path.resolve(runDir, input.candidateContractPath); return { value: read(file), file }; }
function structuralDiff(visual, candidateContract, stage, candidateHash) {
  if (!candidateContract) return [{ kind: 'structure-contract', reason: 'candidateContractPath or candidateContract is required for strict parity' }];
  const expectedSource = stage === 'stitch' ? 'stitch-screen-export' : 'runtime-dom-export';
  const failures = [];
  const value = candidateContract.value;
  if (value.source !== expectedSource) failures.push({ kind: 'structure-source', expected: expectedSource, actual: value.source || null });
  if (value.verification?.status !== 'passed') {
    if (value.verification?.status === 'failed' && value.verification?.evidence && value.verification?.inputs?.htmlHash) failures.push({ kind: 'structure-difference', details: value.verification.evidence });
    else failures.push({ kind: 'structure-extraction', reason: 'candidate structure contract was not automatically verified from its source artifact' });
  }
  if (value.sourceImageHash !== candidateHash) failures.push({ kind: 'structure-image-hash', expected: candidateHash, actual: value.sourceImageHash || null });
  for (const key of ['contentLock', 'layoutLock', 'analyticsLock', 'designTokens', 'componentContracts']) if (!same(visual[key], value[key])) failures.push({ kind: key });
  return failures;
}
const [command, runArg, stage, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compare' || !runArg || !['stitch', 'implementation'].includes(stage) || !inputArg) die('usage: compare <run-dir> <stitch|implementation> <parity-input.json>');
const runDir = path.resolve(runArg), input = read(path.resolve(inputArg));
try { requireRouterAction(runDir, stage === 'stitch' ? ['sync_stitch', 'compile_visual_bundle', 'validate_stitch'] : 'verify'); } catch (error) { die(error.message); }
const { state, expectedStateHash } = readRunStateForUpdate(runDir);
let visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
let screenReference = null;
if (stage === 'stitch') {
  const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  if (freeze.approvedScreens?.length > 1) {
    const screens = freeze.approvedScreens.filter(item => item.screenId === input.screenId);
    if (screens.length !== 1) die('multi-screen parity requires one exact frozen screen ID');
    try { screenReference = resolveStitchScreenReference(runDir, state, screens[0]); visual = screenReference.visual; } catch (error) { die(error.message); }
  }
}
const requestedBaseline = input.baseline || (input.stitchImageHash ? { kind: 'stitch', imageHash: input.stitchImageHash } : null);
let reference = path.resolve(runDir, visual.referenceImage.path);
const candidate = path.resolve(runDir, input.candidateImage || '');
if (stage === 'implementation' && requestedBaseline?.kind === 'stitch') {
  const capture = input.captureId ? read(path.join(runDir, 'evidence', 'runtime-browser-capture.json')).evidence?.find(item => item.id === input.captureId && item.status === 'captured') : null;
  if (input.captureId && (!capture || path.resolve(runDir, capture.screenshot || '') !== candidate)) die('formal parity input does not match the captured screen');
  try { const selected = resolveImplementationReference(runDir, state, requestedBaseline, capture); reference = selected.image; if (selected.visual) visual = selected.visual; } catch (error) { die(error.message); }
}
if (stage === 'implementation' && requestedBaseline?.kind === 'effect-image' && requestedBaseline.screenId) {
  const captures = read(path.join(runDir, 'evidence', 'runtime-browser-capture.json')).evidence || [];
  const capture = captures.find(item => item.id === input.captureId && item.status === 'captured');
  if (!capture || path.resolve(runDir, capture.screenshot || '') !== candidate) die('formal parity input does not match the captured screen');
  try {
    const selected = resolveDirectImplementationReference(runDir, state, capture);
    if (selected.capture.id !== requestedBaseline.screenId || selected.visual.referenceImage.sha256 !== requestedBaseline.imageHash) die('direct implementation baseline does not match the confirmed Demo page');
    reference = selected.image; visual = selected.visual;
  } catch (error) { die(error.message); }
}
if (!fs.existsSync(reference) || !fs.existsSync(candidate)) die('Gate 1 reference image and candidateImage must exist');
if (hash(reference) !== (stage === 'implementation' && requestedBaseline?.kind === 'stitch' ? requestedBaseline.imageHash : visual.referenceImage.sha256)) die('reference image hash does not match the selected baseline');
if (stage === 'stitch' && input.screenId) {
  const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screens = (freeze.approvedScreens || []).filter(item => item.screenId === input.screenId);
  if (screens.length !== 1 || path.resolve(runDir, screens[0].imagePath) !== candidate || hash(candidate) !== screens[0].imageHash) die('screen-specific parity must bind one frozen Stitch screen and its exact image');
}
const candidateHash = hash(candidate), diff = compare(reference, candidate), candidateContract = contractFrom(input, runDir), structureFailures = structuralDiff(visual, candidateContract, stage, candidateHash);
const suppliedText = input.candidateTextPath ? textFrom(path.resolve(runDir, input.candidateTextPath)) : String(input.candidateText || '');
const hasAuthoritativeText = Boolean(suppliedText.trim()), ocrEvidence = hasAuthoritativeText ? { status: 'not-required', reason: 'authoritative candidate text was supplied' } : input.disableOcr ? { status: 'not-requested' } : ocr(candidate, input.ocrLanguages || 'chi_sim+eng');
const text = [suppliedText, ocrEvidence.status === 'passed' ? ocrEvidence.text : ''].filter(Boolean).join(' ');
const missingText = (visual.contentLock.protectedText || []).filter(item => !text.includes(item));
const pixelExact = diff.sameSize && diff.meanAbsoluteError === 0 && diff.changedRatio === 0;
const contentVerifiable = hasAuthoritativeText || ocrEvidence.status === 'passed';
const hasFailure = kind => structureFailures.some(item => item.kind === kind);
const checks = { content: contentVerifiable && !missingText.length && !hasFailure('contentLock') ? 'passed' : 'failed', layout: pixelExact && !hasFailure('layoutLock') ? 'passed' : 'failed', analytics: pixelExact && !hasFailure('analyticsLock') ? 'passed' : 'failed', style: pixelExact && !hasFailure('designTokens') && !hasFailure('componentContracts') ? 'passed' : 'failed' };
const unmatched = [...structureFailures, ...(!contentVerifiable ? [{ kind: 'content-verification', reason: ocrEvidence.reason || 'candidateText or candidateTextPath is required when OCR is unavailable' }] : []), ...missingText.map(text => ({ kind: 'content', text })), ...(pixelExact ? [] : [{ kind: 'pixel-diff', diff }])];
const status = Object.values(checks).every(value => value === 'passed') && !unmatched.length ? 'passed' : 'failed';
const provenance = candidateContract ? { source: candidateContract.value.source || null, sourceImageHash: candidateContract.value.sourceImageHash || null, contractPath: path.relative(runDir, candidateContract.file), contractHash: hash(candidateContract.file) } : { source: null, sourceImageHash: null, contractPath: null, contractHash: null };
const implementationBaseline = requestedBaseline || (state.locks?.stitchSkipped ? { kind: 'effect-image', imageHash: visual.referenceImage.sha256 } : null);
if (stage === 'implementation' && implementationBaseline?.kind === 'effect-image' && implementationBaseline.imageHash !== visual.referenceImage.sha256) die('effect-image baseline does not match the confirmed visual reference');
const artifact = stage === 'stitch' ? { schemaVersion: '3.0', status, ...(input.screenId ? { screenId: input.screenId } : {}), referenceImageHash: visual.referenceImage.sha256, stitchImageHash: candidateHash, checks, unmatched, diff, strictPixelMatch: pixelExact, structuralVerification: provenance, textVerification: { source: hasAuthoritativeText ? 'candidate-text' : 'ocr', ocr: ocrEvidence }, comparedAt: new Date().toISOString() } : { schemaVersion: '3.0', status, baseline: implementationBaseline, ...(implementationBaseline?.kind === 'stitch' ? { stitchImageHash: implementationBaseline.imageHash } : {}), runtimeImageHash: candidateHash, checks, unmatched, diff, strictPixelMatch: pixelExact, structuralVerification: provenance, textVerification: { source: hasAuthoritativeText ? 'candidate-text' : 'ocr', ocr: ocrEvidence }, comparedAt: new Date().toISOString() };
if (stage === 'implementation' && (!implementationBaseline || !['stitch', 'effect-image'].includes(implementationBaseline.kind) || !implementationBaseline.imageHash)) die('implementation parity requires a frozen Stitch or approved effect-image baseline');
const name = stage === 'stitch' ? 'stitch-parity-evidence.json' : 'implementation-parity-evidence.json';
// The top-level result is a latest-result projection; individual Stitch page
// results remain separately addressable and retain their own receipts.
if (fs.existsSync(path.join(runDir, name))) archiveArtifacts(runDir, [name], 'parity-projection-superseded');
write(path.join(runDir, name), artifact);
// Keep each comparison independently addressable; the legacy top-level file
// remains the current single-reference result and is not multi-screen proof.
let screenEvidence = null;
if (stage === 'stitch' && input.screenId) {
  const key = crypto.createHash('sha256').update(input.screenId).digest('hex');
  screenEvidence = path.join(runDir, 'evidence', 'parity', `stitch-result-${key}.json`);
  if (fs.existsSync(screenEvidence)) archiveArtifacts(runDir, [path.relative(runDir, screenEvidence)], 'screen-parity-superseded');
  write(screenEvidence, { ...artifact, screenId: input.screenId, ...(screenReference ? { demoBinding: screenReference.binding, visualReference: { path: screenReference.path, sha256: screenReference.sha256 } } : {}), referenceScope: screenReference ? 'confirmed-demo-screen' : 'single-visual-reference' });
}
if (stage === 'implementation' && input.captureId && ['stitch', 'effect-image'].includes(implementationBaseline?.kind) && implementationBaseline.screenId) {
  const key = crypto.createHash('sha256').update(implementationBaseline.screenId).digest('hex');
  screenEvidence = path.join(runDir, 'evidence', 'parity', `implementation-result-${key}.json`);
  if (fs.existsSync(screenEvidence)) archiveArtifacts(runDir, [path.relative(runDir, screenEvidence)], 'implementation-screen-parity-superseded');
  write(screenEvidence, { ...artifact, captureId: input.captureId, screenId: implementationBaseline.screenId });
}
state.artifacts[stage === 'stitch' ? 'stitchParityEvidence' : 'implementationParityEvidence'] = name; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); commitRunState(runDir, state, { reason: 'visual-parity-state-update', expectedStateHash });
console.log(JSON.stringify({ evidence: path.join(runDir, name), ...(screenEvidence ? { screenEvidence } : {}), status, checks, pixelExact, structureFailures, diff }));
if (status !== 'passed') process.exitCode = 2;
