#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
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
  if (value.verification?.status !== 'passed') failures.push({ kind: 'structure-extraction', reason: 'candidate structure contract was not automatically verified from its source artifact' });
  if (value.sourceImageHash !== candidateHash) failures.push({ kind: 'structure-image-hash', expected: candidateHash, actual: value.sourceImageHash || null });
  for (const key of ['contentLock', 'layoutLock', 'analyticsLock', 'designTokens', 'componentContracts']) if (!same(visual[key], value[key])) failures.push({ kind: key });
  return failures;
}
const [command, runArg, stage, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'compare' || !runArg || !['stitch', 'implementation'].includes(stage) || !inputArg) die('usage: compare <run-dir> <stitch|implementation> <parity-input.json>');
const runDir = path.resolve(runArg), input = read(path.resolve(inputArg)), state = read(path.join(runDir, 'state.json'));
try { requireRouterAction(runDir, stage === 'stitch' ? ['compile_visual_bundle', 'validate_stitch'] : 'verify'); } catch (error) { die(error.message); }
const visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
const reference = path.resolve(runDir, visual.referenceImage.path), candidate = path.resolve(runDir, input.candidateImage || '');
if (!fs.existsSync(reference) || !fs.existsSync(candidate)) die('Gate 1 reference image and candidateImage must exist');
if (hash(reference) !== visual.referenceImage.sha256) die('Gate 1 reference image hash does not match Visual Reference');
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
const implementationBaseline = input.baseline || (input.stitchImageHash ? { kind: 'stitch', imageHash: input.stitchImageHash } : state.locks?.stitchSkipped ? { kind: 'effect-image', imageHash: visual.referenceImage.sha256 } : null);
const artifact = stage === 'stitch' ? { schemaVersion: '3.0', status, referenceImageHash: visual.referenceImage.sha256, stitchImageHash: candidateHash, checks, unmatched, diff, strictPixelMatch: pixelExact, structuralVerification: provenance, textVerification: { source: hasAuthoritativeText ? 'candidate-text' : 'ocr', ocr: ocrEvidence }, comparedAt: new Date().toISOString() } : { schemaVersion: '3.0', status, baseline: implementationBaseline, ...(implementationBaseline?.kind === 'stitch' ? { stitchImageHash: implementationBaseline.imageHash } : {}), runtimeImageHash: candidateHash, checks, unmatched, diff, strictPixelMatch: pixelExact, structuralVerification: provenance, textVerification: { source: hasAuthoritativeText ? 'candidate-text' : 'ocr', ocr: ocrEvidence }, comparedAt: new Date().toISOString() };
if (stage === 'implementation' && (!implementationBaseline || !['stitch', 'effect-image'].includes(implementationBaseline.kind) || !implementationBaseline.imageHash)) die('implementation parity requires a frozen Stitch or approved effect-image baseline');
const name = stage === 'stitch' ? 'stitch-parity-evidence.json' : 'implementation-parity-evidence.json';
write(path.join(runDir, name), artifact);
state.artifacts[stage === 'stitch' ? 'stitchParityEvidence' : 'implementationParityEvidence'] = name; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(path.join(runDir, 'state.json'), state);
console.log(JSON.stringify({ evidence: path.join(runDir, name), status, checks, pixelExact, structureFailures, diff }));
if (status !== 'passed') process.exitCode = 2;
