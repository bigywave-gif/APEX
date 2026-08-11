#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
/** Produces deterministic, reviewable experience-quality and candidate-selection evidence. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Experience evaluator failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
function dimension(id, max, score, findings = []) { return { id, max, score, findings }; }
function notEmpty(value) { return Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim().length > 0 : Boolean(value); }
function values(value) { if (Array.isArray(value)) return value.flatMap(values); if (value && typeof value === 'object') return Object.values(value).flatMap(values); return typeof value === 'string' ? [value] : []; }
function evaluate(strategy) {
  const dimensions = [];
  const criticalFailures = [];
  const ia = strategy.informationArchitecture || [];
  const priorities = ia.map(item => item.priority);
  const iaFindings = [];
  let iaScore = 0;
  if (ia.length >= 2) iaScore += 6; else iaFindings.push('requires at least two information layers');
  if (new Set(priorities).size === priorities.length && Math.min(...priorities) === 1) iaScore += 7; else iaFindings.push('priorities must be distinct and start at 1');
  if (ia.every(item => notEmpty(item.purpose) && notEmpty(item.content))) iaScore += 7; else iaFindings.push('each layer needs purpose and content');
  dimensions.push(dimension('information-architecture', 20, iaScore, iaFindings));
  const data = strategy.dataExpression || [];
  const dataFindings = [];
  let dataScore = 0;
  if (data.length) dataScore += 5; else { dataFindings.push('data expression is absent'); criticalFailures.push('data-expression-missing'); }
  if (data.every(item => ['question', 'metric', 'comparison', 'encoding', 'interaction', 'rationale'].every(key => notEmpty(item[key])))) dataScore += 15; else dataFindings.push('every data expression needs question, metric, comparison, encoding, interaction and rationale');
  dimensions.push(dimension('data-expression', 20, dataScore, dataFindings));
  const functional = strategy.functionalPlan || [];
  const functionFindings = [];
  let functionScore = 0;
  if (functional.length) functionScore += 5; else criticalFailures.push('functional-plan-missing');
  if (functional.every(item => ['task', 'component', 'states', 'events', 'acceptance'].every(key => notEmpty(item[key])))) functionScore += 15; else functionFindings.push('each function needs task, component, states, events and acceptance');
  dimensions.push(dimension('functional-coverage', 20, functionScore, functionFindings));
  const visual = strategy.visualDirection || {};
  const visualKeys = ['hierarchy', 'density', 'composition', 'colorSemantics', 'typography'];
  dimensions.push(dimension('visual-system', 10, visualKeys.every(key => notEmpty(visual[key])) && notEmpty(strategy.designSystem?.tokens) && notEmpty(strategy.designSystem?.components) ? 10 : 0, ['visual direction, tokens and components must be explicit'].filter(() => !(visualKeys.every(key => notEmpty(visual[key])) && notEmpty(strategy.designSystem?.tokens) && notEmpty(strategy.designSystem?.components)))));
  const responsive = strategy.responsive || {};
  dimensions.push(dimension('adaptive-layout', 10, notEmpty(responsive.breakpoints) && notEmpty(responsive.reflowRules) ? 10 : 0, notEmpty(responsive.breakpoints) && notEmpty(responsive.reflowRules) ? [] : ['breakpoints and reflow rules are required']));
  const accessibility = strategy.accessibility || {};
  dimensions.push(dimension('accessibility', 10, notEmpty(accessibility.target) && notEmpty(accessibility.keyboard) && notEmpty(accessibility.semantics) ? 10 : 0, notEmpty(accessibility.target) && notEmpty(accessibility.keyboard) && notEmpty(accessibility.semantics) ? [] : ['target, keyboard and semantics are required']));
  const motion = strategy.motion || {};
  const motionBindings = motion.bindings || [];
  const validMotionBindings = motionBindings.length > 0 && motionBindings.every(binding => {
    const task = functional.find(item => item.task === binding.task);
    return task && values(task.events).includes(binding.event) && values(task.states).includes(binding.stateTransition?.from) && values(task.states).includes(binding.stateTransition?.to) && binding.stateTransition.from !== binding.stateTransition.to && ['operation-feedback','state-change','spatial-orientation','hierarchy-guidance','progress-explanation','risk-notice'].includes(binding.informationBenefit) && typeof binding.valueStatement === 'string' && binding.valueStatement.trim().length >= 12;
  });
  dimensions.push(dimension('motion-purpose', 5, notEmpty(motion.purpose) && notEmpty(motion.reducedMotion) && validMotionBindings ? 5 : 0, notEmpty(motion.purpose) && notEmpty(motion.reducedMotion) && validMotionBindings ? [] : ['every motion must bind a declared task, event, real state transition, and information benefit']));
  const anti = strategy.antiPatterns || [];
  dimensions.push(dimension('anti-pattern-prevention', 5, anti.length >= 3 ? 5 : 0, anti.length >= 3 ? [] : ['at least three project-relevant anti-patterns are required']));
  const score = dimensions.reduce((total, item) => total + item.score, 0);
  return { schemaVersion: '3.0', status: score >= 85 && !criticalFailures.length ? 'passed' : 'failed', score, threshold: 85, dimensions, criticalFailures, checkedAt: new Date().toISOString() };
}
function updateState(runDir, artifacts) {
  const file = path.join(runDir, 'state.json'); const state = read(file);
  Object.assign(state.artifacts, artifacts);
  state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(file, state);
}
const [command, runArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (!['evaluate', 'candidates'].includes(command) || !runArg || !inputArg) die('usage: evaluate <run-dir> <experience-strategy.json> | candidates <run-dir> <design-candidates.json>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, command === 'evaluate' ? 'analyze_requirement' : ['generate_visual', 'compile_visual_bundle']); } catch (error) { die(error.message); }
if (command === 'evaluate') {
  if (read(path.join(runDir, 'state.json')).gates?.gate1?.status === 'passed') die('experience strategy is frozen after Gate 1; use restart for a requirements change');
  const sourceStrategy = path.resolve(inputArg);
  if (!fs.existsSync(sourceStrategy) || !fs.statSync(sourceStrategy).isFile()) die(`experience strategy does not exist: ${sourceStrategy}`);
  // A run may only reference its own immutable copy. This keeps the quality
  // result and the strategy that it evaluated in the same authorization-bound
  // state transition, rather than requiring a later manual state registration.
  const strategyFile = path.join(runDir, 'experience-strategy.json');
  if (sourceStrategy !== strategyFile) write(strategyFile, read(sourceStrategy));
  const result = evaluate(read(strategyFile)); result.strategyHash = hash(strategyFile);
  const output = path.join(runDir, 'experience-quality-evidence.json'); write(output, result);
  updateState(runDir, { experienceStrategy: 'experience-strategy.json', experienceQualityEvidence: 'experience-quality-evidence.json' });
  console.log(JSON.stringify({ strategy: strategyFile, evidence: output, status: result.status, score: result.score, threshold: result.threshold })); if (result.status !== 'passed') process.exitCode = 2;
} else {
  const candidatesFile = path.resolve(inputArg); const candidates = read(candidatesFile); const state = read(path.join(runDir, 'state.json')); const strategyFile = path.join(runDir, state.artifacts.experienceStrategy || 'experience-strategy.json');
  if (state.locks?.effectApproved) die('design candidates are frozen after visual approval; use a visual revision before replacing them');
  if (!fs.existsSync(strategyFile) || candidates.strategyHash !== hash(strategyFile)) die('design candidates must bind the current experience strategy');
  const ids = candidates.candidates?.map(item => item.id) || [];
  if (new Set(ids).size !== ids.length || !ids.includes(candidates.selectedCandidateId)) die('candidate ids must be unique and selectedCandidateId must exist');
  for (const item of candidates.candidates || []) { const image = path.resolve(runDir, item.image.path); if (!image.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(image) || hash(image) !== item.image.sha256) die(`candidate image is missing or hash-mismatched: ${item.id}`); }
  const output = path.join(runDir, 'design-candidates.json'); if (path.resolve(candidatesFile) !== output) write(output, candidates); updateState(runDir, { designCandidates: 'design-candidates.json' });
  console.log(JSON.stringify({ candidates: output, status: 'passed', selectedCandidateId: candidates.selectedCandidateId }));
}
