import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export const formalReviewArtifacts = ['experienceStrategy', 'visualSandboxFiles', 'runtimeStateMatrix'];
export function formalReviewBindings(runDir, state) {
  const root = fs.realpathSync(runDir);
  return formalReviewArtifacts.map(artifact => {
    const reference = state.artifacts?.[artifact];
    if (typeof reference !== 'string' || !reference.trim()) throw new Error(`formal review input is missing: ${artifact}`);
    const file = path.resolve(runDir, reference);
    if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error(`formal review input is missing or outside the run: ${artifact}`);
    return { artifact, path: reference, sha256: hash(file) };
  });
}
export function hasFormalObservation(step) {
  const observation = step?.observation;
  return typeof observation?.selector === 'string' && Boolean(observation.selector.trim()) && ['text', 'value', 'visible', 'checked', 'attribute'].includes(observation.property) && (observation.property !== 'attribute' || (typeof observation.attribute === 'string' && Boolean(observation.attribute.trim())));
}
export function requiredFormalTasks(manifest, strategy = {}, { requireProductPlan = false } = {}) {
  if (requireProductPlan && (!Array.isArray(strategy?.functionalPlan) || !strategy.functionalPlan.length || strategy.functionalPlan.some(item => typeof item?.task !== 'string' || !item.task.trim()))) throw new Error('current product plan with valid functional tasks is required');
  const productTasks = new Set((strategy.functionalPlan || []).map(item => item.task).filter(Boolean));
  return new Set([...productTasks, ...(manifest.interactionContract?.journeys || []).filter(item => item.kind !== 'reset' || productTasks.has(item.task)).map(item => item.task).filter(Boolean)]);
}
export function validateProductTaskReview(runDir, state, review) {
  const bindings = formalReviewBindings(runDir, state);
  const inputs = Object.fromEntries(bindings.map(binding => [binding.artifact, JSON.parse(fs.readFileSync(path.resolve(runDir, binding.path), 'utf8'))]));
  const tasks = requiredFormalTasks(inputs.visualSandboxFiles, inputs.experienceStrategy, { requireProductPlan: true });
  validateFormalInteractionEvidence(runDir, state, inputs.runtimeStateMatrix.interactions);
  if (!Array.isArray(review) || review.length !== tasks.size) throw new Error('product review must cover every confirmed task exactly once');
  const seen = new Set();
  for (const item of review) {
    if (!tasks.has(item?.task) || seen.has(item.task)) throw new Error('product review has a duplicate or unknown task');
    seen.add(item.task);
    if (item.verdict !== 'passed' || !['expectedOutcome', 'observedOutcome', 'rationale'].every(key => typeof item[key] === 'string' && item[key].trim())) throw new Error(`product review needs a passed verdict and concrete reasoning: ${item.task}`);
    const matches = (inputs.runtimeStateMatrix.interactions || []).filter(entry => entry.id === item.interactionId && entry.result === 'passed' && entry.evidence === item.evidence);
    if (matches.length !== 1) throw new Error(`product review lacks matching formal evidence: ${item.task}`);
    const root = fs.realpathSync(runDir), file = path.resolve(runDir, item.evidence || '');
    if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error(`product review evidence is missing or outside the run: ${item.task}`);
    const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (trace.id !== item.interactionId || trace.task !== item.task || trace.status !== 'passed') throw new Error(`product review evidence does not match the task: ${item.task}`);
  }
  return { status: 'passed', tasks: [...seen] };
}
export function validateFormalInteractionEvidence(runDir, state, interactions) {
  const root = fs.realpathSync(runDir), local = reference => { const file = path.resolve(runDir, reference || ''); if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error(`formal interaction evidence is missing or outside the run: ${reference || ''}`); return file; };
  const manifest = JSON.parse(fs.readFileSync(local(state.artifacts.visualSandboxFiles), 'utf8'));
  const strategy = state.artifacts.experienceStrategy ? JSON.parse(fs.readFileSync(local(state.artifacts.experienceStrategy), 'utf8')) : {};
  const tasks = requiredFormalTasks(manifest, strategy, { requireProductPlan: state.roleChain?.confirmationModel === 'two-confirmations' });
  const allowedTasks = new Set((manifest.interactionContract?.journeys || []).map(item => item.task));
  const expectedJourneys = state.roleChain?.confirmationModel === 'two-confirmations'
    ? (manifest.interactionContract?.journeys || []).filter(item => item.kind !== 'reset' || (strategy.functionalPlan || []).some(task => task.task === item.task))
    : [];
  const expectedById = new Map();
  for (const journey of expectedJourneys) {
    if (!journey.id || !journey.task || typeof journey.route !== 'string' || expectedById.has(journey.id)) throw new Error('confirmed Demo journey identity or route is invalid');
    expectedById.set(journey.id, journey);
  }
  if (!tasks.size) throw new Error('confirmed Demo has no interaction tasks');
  const captureRef = 'evidence/runtime-browser-capture.json', captureFile = local(captureRef), capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  if (capture.status !== 'passed' || capture.formalInteractions?.status !== 'passed') throw new Error('formal browser interaction capture is missing or failed');
  const operations = path.join(runDir, 'operations');
  const receipts = fs.existsSync(operations) ? fs.readdirSync(operations).filter(name => name.endsWith('.json')).flatMap(name => { try { return [JSON.parse(fs.readFileSync(path.join(operations, name), 'utf8'))]; } catch { return []; } }) : [];
  const covered = new Set(), ids = new Set();
  for (const interaction of interactions || []) {
    if (interaction.id?.startsWith('protected:')) continue;
    if (!interaction.id || ids.has(interaction.id) || interaction.result !== 'passed') throw new Error('formal interaction IDs must be unique and passed');
    ids.add(interaction.id);
    const evidence = local(interaction.evidence), trace = JSON.parse(fs.readFileSync(evidence, 'utf8'));
    const expected = expectedById.get(interaction.id);
    if (expectedById.size && (!expected || trace.task !== expected.task || trace.route !== expected.route)) throw new Error(`formal interaction does not match a confirmed Demo journey: ${interaction.id}`);
    const matches = (capture.formalInteractions.journeys || []).filter(item => item.id === interaction.id && item.evidence === interaction.evidence && item.evidenceSha256 === hash(evidence));
    if (matches.length !== 1 || trace.id !== interaction.id || trace.status !== 'passed' || !Array.isArray(trace.steps) || !trace.steps.length || trace.steps.some(step => step.passed !== true || step.before === step.after || !hasFormalObservation(step)) || trace.task !== matches[0].task || !allowedTasks.has(trace.task)) throw new Error(`formal interaction is not an observed confirmed task: ${interaction.id}`);
    for (const ref of [trace.screenshot, trace.dom]) if (!ref?.sha256 || hash(local(ref.path)) !== ref.sha256) throw new Error(`formal interaction screenshot or DOM changed: ${interaction.id}`);
    if (!(receipts || []).some(item => item.action === 'verify' && item.status === 'succeeded' && path.basename(item.script || '') === 'browser-capture.mjs' && item.outputFileHashes?.[captureRef] === hash(captureFile) && item.outputFileHashes?.[interaction.evidence] === hash(evidence))) throw new Error(`formal interaction lacks a successful capture receipt: ${interaction.id}`);
    covered.add(trace.task);
  }
  const missing = [...tasks].filter(task => !covered.has(task));
  if (missing.length) throw new Error(`formal interaction evidence misses confirmed tasks: ${missing.join(', ')}`);
  const missingJourneys = [...expectedById.keys()].filter(id => !ids.has(id));
  if (missingJourneys.length) throw new Error(`formal interaction evidence misses confirmed journeys: ${missingJourneys.join(', ')}`);
  return { status: 'passed', tasks: [...covered] };
}
