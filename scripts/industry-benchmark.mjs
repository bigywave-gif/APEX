#!/usr/bin/env node
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { requireRouterAction } from './apex-runtime-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Industry benchmark failed: ${message}`); process.exit(1); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function inside(runDir, value, label) { const target = path.resolve(runDir, value || ''); if (!target.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(target)) die(`${label} must be an existing artifact inside this run`); return target; }
const [command, runArg, reviewArg] = process.argv.slice(2); if (command !== 'verify' || !runArg || !reviewArg) die('usage: industry-benchmark.mjs verify <run-dir> <industry-benchmark-review.json>');
const runDir = path.resolve(runArg); try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const state = read(path.join(runDir, 'state.json'));
const planFile = inside(runDir, state.artifacts.visualExecutionPlan, 'visual execution plan');
const provenanceFile = inside(runDir, state.artifacts.evidenceProvenance, 'evidence provenance');
const reviewFile = inside(runDir, reviewArg, 'industry review');
const receiptFile = inside(runDir, path.join('operations', `${path.basename(process.env.APEX_ROUTER_AUTHORIZATION_REF || '', '.json')}.json`), 'current controlled-operation receipt');
const receipt = read(receiptFile); const reviewRelative = path.relative(runDir, reviewFile);
if (receipt.status !== 'succeeded' && receipt.status !== 'running' || receipt.action !== 'verify' || receipt.script !== 'industry-benchmark.mjs' || receipt.inputFileHashes?.[reviewRelative] !== hash(reviewFile)) die('industry review was changed or was not bound to this controlled verification operation');
const plan = read(planFile), provenance = read(provenanceFile), review = read(reviewFile), assessment = plan.selectionAnalysis?.industryBenchmark;
const registry = read(path.join(root, 'registry/industry-design-benchmarks.json')), benchmark = registry.benchmarks?.find(item => item.id === assessment?.id);
if (!benchmark || provenance.status !== 'passed' || review.schemaVersion !== '1.0' || review.status !== 'ready' || review.assessmentMode !== 'evidence-bound-review' || review.visualPlanHash !== hash(planFile)) die('industry benchmark, passed provenance, and an evidence-bound review of the current visual plan are required');
const sources = new Map((plan.sourceSelections || []).map(item => [item.id, item])); const plannedScores = new Map((assessment.scores || []).map(item => [item.criterion, item])); const observations = new Map((review.observations || []).map(item => [item.criterion, item]));
if (observations.size !== benchmark.criteria.length || benchmark.criteria.some(criterion => !observations.has(criterion))) die('industry review must contain exactly one observation for every benchmark criterion');
const runtimeEvidence = new Map((provenance.entries || []).filter(item => item.kind === 'browser' && item.result === 'passed').map(item => [item.id, item])); if (!runtimeEvidence.size) die('industry benchmark requires passed browser capture evidence');
function renderedSelections(entry) { const file = inside(runDir, entry.path, `runtime evidence ${entry.id}`); const capture = read(file); if (capture.status !== 'passed' || !Array.isArray(capture.evidence)) die(`runtime evidence is not a passed browser capture: ${entry.id}`); return new Set(capture.evidence.filter(item => item.status === 'captured' && item.screenshot && item.domHtml).flatMap(item => item.sourceSelections || [])); }
const renderedByEvidence = new Map([...runtimeEvidence].map(([id, entry]) => [id, renderedSelections(entry)])); const scores = [];
for (const criterion of benchmark.criteria) {
  const planned = plannedScores.get(criterion), observation = observations.get(criterion);
  if (!planned || !Array.isArray(planned.sourceSelectionIds) || !planned.sourceSelectionIds.length || planned.sourceSelectionIds.some(id => !sources.has(id))) die(`industry criterion has no selected-source basis: ${criterion}`);
  if (!observation || !Number.isInteger(observation.score) || observation.score < 0 || observation.score > 5 || !['passed', 'failed', 'unverified'].includes(observation.result) || !Array.isArray(observation.sourceSelectionIds) || !observation.sourceSelectionIds.length || !Array.isArray(observation.evidenceIds) || !observation.evidenceIds.length || !observation.finding) die(`industry criterion has an invalid evidence-bound observation: ${criterion}`);
  if (observation.sourceSelectionIds.some(id => !planned.sourceSelectionIds.includes(id)) || observation.evidenceIds.some(id => !renderedByEvidence.has(id))) die(`industry observation is not bound to its planned sources and runtime evidence: ${criterion}`);
  const rendered = new Set(observation.evidenceIds.flatMap(id => [...renderedByEvidence.get(id)])); const sourceRendered = observation.sourceSelectionIds.every(id => rendered.has(id)); const passed = observation.result === 'passed' && observation.score >= 4 && sourceRendered;
  scores.push({ criterion, plannedScore: planned.score, verifiedScore: passed ? observation.score : 0, sourceSelectionIds: observation.sourceSelectionIds, evidenceIds: observation.evidenceIds, reviewFinding: observation.finding, result: passed ? 'passed' : observation.result === 'unverified' ? 'unverified' : 'failed' });
}
const average = scores.reduce((sum, item) => sum + item.verifiedScore, 0) / scores.length;
const output = { schemaVersion: '1.1', assessmentMode: 'evidence-bound-review', visualPlanHash: hash(planFile), provenanceHash: hash(provenanceFile), benchmarkId: benchmark.id, reviewPath: reviewRelative, reviewHash: hash(reviewFile), reviewReceipt: path.relative(runDir, receiptFile), scores, average, status: average >= 4 && scores.every(item => item.result === 'passed') ? 'passed' : scores.some(item => item.result === 'unverified') ? 'unverified' : 'failed' };
fs.writeFileSync(path.join(runDir, 'industry-benchmark-evidence.json'), `${JSON.stringify(output, null, 2)}\n`); state.artifacts.industryBenchmarkEvidence = 'industry-benchmark-evidence.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`); console.log(JSON.stringify({ evidence: path.join(runDir, 'industry-benchmark-evidence.json'), benchmark: benchmark.id, average, status: output.status })); if (output.status !== 'passed') process.exitCode = 2;
