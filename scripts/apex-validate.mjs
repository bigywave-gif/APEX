#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { protectedVisualEvidenceChecks } from './scope-boundary.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemas = path.join(root, 'core/runtime/schemas');

function fail(message) {
  console.error(`APEX validation failed: ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${file}: ${error.message}`); }
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported schema ref: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], rootSchema);
}

function validate(schema, value, at = '$', rootSchema = schema) {
  const errors = [];
  if (schema.$ref) return validate(resolveRef(rootSchema, schema.$ref), value, at, rootSchema);
  for (const branch of schema.allOf || []) errors.push(...validate(branch, value, at, rootSchema));
  if (schema.if) {
    const matches = validate(schema.if, value, at, rootSchema).length === 0;
    if (matches && schema.then) errors.push(...validate(schema.then, value, at, rootSchema));
    if (!matches && schema.else) errors.push(...validate(schema.else, value, at, rootSchema));
  }
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const allowed = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const typeMatches = allowed.includes(type) || (allowed.includes('integer') && type === 'number' && Number.isInteger(value));
  if (allowed.length && !typeMatches) return [`${at}: expected ${allowed.join('|')}, received ${type}`];
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: expected constant ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: expected one of ${schema.enum.join(', ')}`);
  if (type === 'string' && schema.minLength && value.length < schema.minLength) errors.push(`${at}: string is empty`);
  if (type === 'array') {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${at}: requires at least ${schema.minItems} items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${at}[${index}]`, rootSchema)));
  }
  if (type === 'object') {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}.${key}: required`);
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (!(key in value)) continue;
      errors.push(...validate(child, value[key], `${at}.${key}`, rootSchema));
    }
    const known = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(value)) {
      if (known.has(key)) continue;
      if (schema.additionalProperties === false) errors.push(`${at}.${key}: additional property is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, value[key], `${at}.${key}`, rootSchema));
    }
  }
  return errors;
}

function validateFile(schemaName, file) {
  const schema = readJson(path.join(schemas, schemaName));
  const value = readJson(file);
  const errors = validate(schema, value, '$', schema);
  if (errors.length) throw new Error(`${file}\n${errors.join('\n')}`);
  return value;
}

function resolveArtifact(runDir, reference, fallback) {
  const target = reference || fallback;
  return path.isAbsolute(target) ? target : path.join(runDir, target);
}
function hashFile(file) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function validateStructuralContract(runDir, parity, expectedSource, expectedImageHash) {
  const verification = parity.structuralVerification || {};
  if (verification.source !== expectedSource) throw new Error('Parity structure source must be ' + expectedSource);
  const contractFile = resolveArtifact(runDir, verification.contractPath, '');
  if (!verification.contractPath || !fs.existsSync(contractFile)) throw new Error('Parity structure contract file is missing');
  if (hashFile(contractFile) !== verification.contractHash) throw new Error('Parity structure contract hash does not match');
  const contract = readJson(contractFile);
  if (contract.source !== expectedSource || contract.sourceImageHash !== expectedImageHash || contract.verification?.status !== 'passed') throw new Error('Parity structure contract is not a passed export of the compared artifact');
}
function validateRuntimeStateMatrix(runDir, matrix, baseline, responsiveContract) {
  if (matrix.baseline?.kind !== baseline.kind || matrix.baseline?.imageHash !== baseline.imageHash || matrix.status !== 'passed') throw new Error('Runtime state matrix is not bound to the approved implementation baseline');
  if (matrix.responsiveContractId !== responsiveContract?.contractId) throw new Error('Runtime state matrix is not bound to the frozen responsive contract');
  const seenViewports = new Set();
  const viewportClasses = new Set();
  for (const viewport of matrix.viewports) {
    if (seenViewports.has(viewport.name)) throw new Error(`Runtime state matrix repeats viewport: ${viewport.name}`);
    seenViewports.add(viewport.name);
    if (viewportClasses.has(viewport.class)) throw new Error(`Runtime state matrix repeats viewport class: ${viewport.class}`);
    viewportClasses.add(viewport.class);
    const screenshot = resolveArtifact(runDir, viewport.screenshot, '');
    if (!screenshot.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(screenshot)) throw new Error(`Runtime state viewport screenshot is missing: ${viewport.name}`);
  }
  for (const viewportClass of ['mobile', 'tablet', 'desktop']) if (!viewportClasses.has(viewportClass)) throw new Error(`Runtime state matrix is missing responsive viewport: ${viewportClass}`);
  const ranges = new Map((responsiveContract.viewports || []).map(viewport => [viewport.class, viewport]));
  const rangeSamples = new Map();
  for (const sample of matrix.rangeChecks || []) {
    const range = ranges.get(sample.class);
    if (!range || sample.width < range.minWidth || sample.width > range.maxWidth) throw new Error(`Responsive range sample is outside its frozen viewport range: ${sample.class}/${sample.width}`);
    const key = `${sample.class}:${sample.width}`;
    if (rangeSamples.has(key)) throw new Error(`Runtime state matrix repeats responsive range sample: ${key}`);
    rangeSamples.set(key, sample);
    const screenshot = resolveArtifact(runDir, sample.screenshot, '');
    if (!screenshot.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(screenshot)) throw new Error(`Responsive range screenshot is missing: ${key}`);
  }
  for (const viewportClass of ['mobile', 'tablet', 'desktop']) if ([...rangeSamples.values()].filter(sample => sample.class === viewportClass).length < 3) throw new Error(`Responsive range needs min/mid/max evidence: ${viewportClass}`);
  const requiredStates = new Set(['default', 'loading', 'empty', 'error', 'permission-denied']);
  const seenStates = new Set();
  for (const stateCase of matrix.states) {
    if (seenStates.has(stateCase.name)) throw new Error(`Runtime state matrix repeats state: ${stateCase.name}`);
    seenStates.add(stateCase.name);
    if (stateCase.applicable) {
      const screenshot = resolveArtifact(runDir, stateCase.screenshot, '');
      if (stateCase.result !== 'passed' || !stateCase.screenshot || !screenshot.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(screenshot)) throw new Error(`Applicable runtime state is not verified: ${stateCase.name}`);
    } else if (stateCase.result !== 'not-applicable' || !stateCase.reason) throw new Error(`Not-applicable runtime state needs an explicit reason: ${stateCase.name}`);
  }
  for (const name of requiredStates) if (!seenStates.has(name)) throw new Error(`Runtime state matrix is missing state: ${name}`);
  for (const interaction of matrix.interactions) {
    const evidence = resolveArtifact(runDir, interaction.evidence, '');
    if (interaction.result !== 'passed' || !evidence.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(evidence)) throw new Error(`Runtime interaction is not verified: ${interaction.id}`);
  }
}

function validateResponsiveContract(contract, label) {
  const viewports = contract?.viewports || [];
  const classes = new Set(viewports.map(viewport => viewport.class));
  if (!contract?.contractId || !['mobile', 'tablet', 'desktop'].every(viewportClass => classes.has(viewportClass))) throw new Error(`${label} does not cover mobile, tablet, and desktop`);
  if (viewports.some(viewport => !Number.isInteger(viewport.minWidth) || !Number.isInteger(viewport.maxWidth) || viewport.minWidth > viewport.maxWidth || !viewport.layoutMode)) throw new Error(`${label} has an invalid viewport range or layout mode`);
  if (!contract.overflowPolicy?.noUnintendedHorizontalOverflow || !Array.isArray(contract.overflowPolicy.exceptions) || !Array.isArray(contract.reflowRules) || contract.reflowRules.length < 3 || !Array.isArray(contract.acceptance) || contract.acceptance.length < 3) throw new Error(`${label} lacks reflow, overflow, or acceptance rules`);
}

function capabilities(contract) {
  return new Set(contract.capabilities || []);
}

function requireArtifact(runDir, state, name, fallback) {
  const reference = state.artifacts[name];
  if (!reference) throw new Error(`${name} artifact is required`);
  return resolveArtifact(runDir, reference, fallback);
}

function hasPlaceholder(value) {
  if (typeof value === 'string') return /(^replace$|\breplace[-\w ]*|<[^>]+>)/i.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (value && typeof value === 'object') return Object.values(value).some(hasPlaceholder);
  return false;
}

function rejectPlaceholders(value, artifact) {
  if (hasPlaceholder(value)) throw new Error(`${artifact} still contains template placeholders`);
}

function hashJson(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function assertStyleBaseline(style, expectedMode) {
  if (!style || style.mode !== expectedMode || !['typography', 'colors', 'spacing', 'geometry'].every(key => style[key] && typeof style[key] === 'object' && Object.keys(style[key]).length)) throw new Error(`style baseline must define typography, colors, spacing, and geometry for ${expectedMode}`);
}

function assertExistingCodeReferenceUnchanged(runDir, state) {
  const reference = validateFile('code-reference.schema.json', requireArtifact(runDir, state, 'codeReference', 'code-reference.json'));
  const projectRoot = path.resolve(reference.projectRoot);
  for (const item of reference.files) {
    const source = path.resolve(projectRoot, item.path); const copy = path.resolve(runDir, item.copyPath);
    if (!source.startsWith(`${projectRoot}${path.sep}`) || !copy.startsWith(`${runDir}${path.sep}`) || !fs.existsSync(source) || !fs.existsSync(copy)) throw new Error(`Existing code reference is missing: ${item.path}`);
    if (hashFile(source) !== item.sha256 || hashFile(copy) !== item.sha256) throw new Error(`Existing code changed after the scoped reference was captured: ${item.path}`);
  }
  return reference;
}

function validateGate1(runDir) {
  const state = validateFile('run-state.schema.json', path.join(runDir, 'state.json'));
  const intent = validateFile('intent-brief.schema.json', requireArtifact(runDir, state, 'intentBrief', 'intent-brief.json'));
  const contract = validateFile('delivery-contract.schema.json', requireArtifact(runDir, state, 'deliveryContract', 'delivery-contract.json'));
  rejectPlaceholders(intent, 'Intent Brief');
  rejectPlaceholders(contract, 'Delivery Contract');
  const strategy = validateFile('experience-strategy.schema.json', requireArtifact(runDir, state, 'experienceStrategy', 'experience-strategy.json'));
  const quality = validateFile('experience-quality-evidence.schema.json', requireArtifact(runDir, state, 'experienceQualityEvidence', 'experience-quality-evidence.json'));
  if (quality.strategyHash !== hashFile(resolveArtifact(runDir, state.artifacts.experienceStrategy, 'experience-strategy.json')) || quality.status !== 'passed' || quality.score < quality.threshold || quality.criticalFailures.length) throw new Error('Experience strategy quality gate has not passed for the current strategy');
  const plannedStyle = strategy.designSystem?.styleBaseline;
  if (state.track === 'existing') {
    const inventory = validateFile('project-inventory.schema.json', requireArtifact(runDir, state, 'projectInventory', 'project-inventory.json'));
    const baseline = validateFile('existing-baseline.schema.json', requireArtifact(runDir, state, 'existingBaseline', 'existing-baseline.json'));
    rejectPlaceholders(inventory, 'Project Inventory');
    const freeze = validateFile('functional-freeze.schema.json', requireArtifact(runDir, state, 'functionalFreeze', 'functional-freeze.json'));
    rejectPlaceholders(baseline, 'Existing Baseline');
    rejectPlaceholders(freeze, 'Functional Freeze');
    assertStyleBaseline(baseline.styleBaseline, 'existing-platform');
    assertStyleBaseline(plannedStyle, 'existing-platform');
    if (plannedStyle.sourceHash !== hashJson(baseline.styleBaseline)) throw new Error('Existing visual strategy must reuse the captured platform style baseline without token drift');
    const codeReference = assertExistingCodeReferenceUnchanged(runDir, state);
    const changeScope = validateFile('change-scope.schema.json', requireArtifact(runDir, state, 'changeScope', 'change-scope.json'));
    rejectPlaceholders(changeScope, 'Change Scope');
    const affectedTargets = new Set(changeScope.affected.runtimeTargets);
    const protectedFiles = new Map(changeScope.protected.files.map(item => [item.path, item.sha256]));
    const referenceFiles = new Map(codeReference.files.map(item => [item.path, item.sha256.startsWith('sha256:') ? item.sha256 : `sha256:${item.sha256}`]));
    if ([...affectedTargets].some(item => !referenceFiles.has(item)) || [...referenceFiles.keys()].filter(item => !affectedTargets.has(item)).some(item => protectedFiles.get(item) !== referenceFiles.get(item))) throw new Error('Change Scope must freeze the exact protected complement of the affected Existing code closure');
    const pageSkeleton = validateFile('page-skeleton.schema.json', requireArtifact(runDir, state, 'pageSkeleton', 'page-skeleton.json'));
    const displayFile = resolveArtifact(runDir, baseline.displayEvidence?.path, '');
    if (!baseline.displayEvidence?.hash || !fs.existsSync(displayFile) || hashFile(displayFile) !== baseline.displayEvidence.hash) throw new Error('Existing Baseline does not bind real frontend display evidence');
    if (pageSkeleton.sourceTreeHash !== codeReference.sourceTreeHash || baseline.codeReference?.complete !== true || baseline.codeReference.sourceTreeHash !== codeReference.sourceTreeHash || baseline.codeReference.sourceFileCount !== codeReference.sourceFileCount || baseline.codeReference.pageSkeletonHash !== pageSkeleton.skeletonHash || strategy.sourceBindings?.codeReferenceHash !== codeReference.sourceTreeHash || strategy.sourceBindings?.pageSkeletonHash !== pageSkeleton.skeletonHash || strategy.sourceBindings?.displayEvidenceHash !== baseline.displayEvidence.hash) throw new Error('Existing Baseline strategy does not bind complete scoped code, real display, and page skeleton evidence');
    if (!capabilities(contract).has('existing-baseline')) throw new Error('Existing runs must require existing-baseline capability');
  } else {
    assertStyleBaseline(plannedStyle, 'greenfield-standard');
    if (plannedStyle.sourceHash) throw new Error('Greenfield style baseline must be a newly frozen standard, not an Existing-platform reference');
  }
  if (capabilities(contract).has('backend') || capabilities(contract).has('api-contract')) {
    const domain = validateFile('domain-model.schema.json', requireArtifact(runDir, state, 'domainModel', 'domain-model.json'));
    const api = validateFile('api-contract.schema.json', requireArtifact(runDir, state, 'apiContract', 'api-contract.json'));
    rejectPlaceholders(domain, 'Domain Model');
    rejectPlaceholders(api, 'API Contract');
  }
  if (intent.trackRecommendation !== 'undetermined' && intent.trackRecommendation !== state.track && intent.trackRecommendation !== 'controlled-rebuild') {
    throw new Error(`Intent Brief track recommendation (${intent.trackRecommendation}) does not match run track (${state.track})`);
  }
  return { state, contract };
}

function validateGate2(runDir) {
  const { state, contract } = validateGate1(runDir);
  if (state.gates.gate1.status !== 'passed') throw new Error('Gate 1 has not passed');
  const site = validateFile('site-contract.schema.json', resolveArtifact(runDir, state.artifacts.siteContract, 'site-contract.json'));
  if (state.track === 'existing') validateFile('functional-freeze.schema.json', resolveArtifact(runDir, state.artifacts.functionalFreeze, 'functional-freeze.json'));
  const stitchSkipped = state.locks?.stitchSkipped === true;
  const stitch = stitchSkipped ? null : validateFile('stitch-freeze.schema.json', resolveArtifact(runDir, state.artifacts.stitchFreeze, 'stitch-freeze.json'));
  const bundle = validateFile('visual-bundle.schema.json', resolveArtifact(runDir, state.artifacts.visualBundle, 'visual-bundle.json'));
  const implementation = validateFile('implementation-map.schema.json', resolveArtifact(runDir, state.artifacts.implementationMap, 'implementation-map.json'));
  const visualSourceFile = requireArtifact(runDir, state, 'visualSourceManifest', 'visual-source-manifest.json');
  const visualSources = validateFile('visual-source-manifest.schema.json', visualSourceFile);
  const runtimeSourceLockFile = requireArtifact(runDir, state, 'runtimeSourceLock', 'runtime-source-lock.json');
  const runtimeBaselineFile = requireArtifact(runDir, state, 'runtimeVisualBaseline', 'runtime-visual-baseline.json');
  const runtimeSourceLock = validateFile('runtime-source-lock.schema.json', runtimeSourceLockFile);
  const runtimeBaseline = validateFile('runtime-visual-baseline.schema.json', runtimeBaselineFile);
  const dependency = validateFile('dependency-lock.schema.json', resolveArtifact(runDir, state.artifacts.dependencyLock, 'dependency-lock.json'));
  const visualPlan = validateFile('visual-execution-plan.schema.json', requireArtifact(runDir, state, 'visualExecutionPlan', 'visual-execution-plan.json'));
  if (state.track === 'existing') {
    const changeScopeFile = requireArtifact(runDir, state, 'changeScope', 'change-scope.json');
    const changeScope = validateFile('change-scope.schema.json', changeScopeFile);
    const planScope = visualPlan.scopeControl, bundleScope = bundle.scopeControl, mapScope = implementation.scopeControl;
    if (!planScope || planScope.changeScopeHash !== hashFile(changeScopeFile) || planScope.implementationPolicy !== 'deny-outside-change-closure' || planScope.presentationPolicy !== 'affected-closure-only') throw new Error('Visual plan does not bind the frozen affected-only change scope');
    if (!bundleScope || !mapScope || JSON.stringify(bundleScope) !== JSON.stringify(mapScope) || mapScope.changeScopeHash !== planScope.changeScopeHash) throw new Error('Visual Bundle and Implementation Map must preserve the same change scope');
    const allowedNodes = new Set(changeScope.affected.visualNodes), allowedTargets = new Set(changeScope.affected.runtimeTargets);
    if ((implementation.entries || []).some(entry => !allowedNodes.has(entry.visualNode) || (entry.runtimeTarget || []).some(target => !allowedTargets.has(target)))) throw new Error('Implementation Map contains work outside the confirmed change closure');
  }
  validateResponsiveContract(visualPlan.layout?.responsive, 'Visual execution plan responsive contract');
  validateResponsiveContract(bundle.responsive, 'Visual Bundle responsive contract');
  if (bundle.responsive?.contractId !== visualPlan.layout?.responsive?.contractId) throw new Error('Visual Bundle responsive contract does not match the confirmed visual execution plan');
  for (const scene of visualPlan.threeD || []) {
    const planned = (visualPlan.dependencies || []).some(item => item.package === scene.dependency.package && item.version === scene.dependency.version && ['installed', 'planned'].includes(item.status));
    const locked = (dependency.items || []).some(item => item.source === scene.dependency.package && item.version === scene.dependency.version);
    if (!planned || !locked) throw new Error(`3D runtime is not bound to the confirmed plan and exact dependency lock: ${scene.id}`);
  }
  if (state.track === 'existing' && state.artifacts.pageDelta) validateFile('page-delta.schema.json', resolveArtifact(runDir, state.artifacts.pageDelta, 'page-delta.json'));
  if (bundle.siteContract.version !== site.version || bundle.siteContract.hash !== site.hash) throw new Error('Visual Bundle Site Contract lock does not match');
  if (stitchSkipped) {
    if (bundle.implementationBaseline?.kind !== 'effect-image') throw new Error('Stitch-skipped runs must use the approved effect image as the implementation baseline');
  } else if (bundle.stitchFreeze?.screenSetHash !== stitch.fingerprints.screenSetHash || bundle.implementationBaseline?.kind !== 'stitch') throw new Error('Visual Bundle Stitch lock does not match');
  rejectPlaceholders(site, 'Site Contract');
  if (stitch) rejectPlaceholders(stitch, 'Stitch Freeze');
  rejectPlaceholders(bundle, 'Visual Bundle');
  rejectPlaceholders(implementation, 'Implementation Map');
  if (bundle.visualSourceManifest?.path !== state.artifacts.visualSourceManifest || bundle.visualSourceManifest?.hash !== hashFile(visualSourceFile)) throw new Error('Visual Bundle does not bind the frozen visual source manifest');
  const planSelections = new Map((visualPlan.sourceSelections || []).map(item => [item.id, item]));
  if (visualSources.sources.length !== planSelections.size || visualSources.sources.some(source => !planSelections.has(source.planSourceSelectionId) || planSelections.get(source.planSourceSelectionId).materialization !== source.materialization)) throw new Error('Visual source manifest does not freeze every confirmed source selection and its materialization mode');
  for (const selection of planSelections.values()) if (!visualSources.sources.some(source => source.planSourceSelectionId === selection.id)) throw new Error(`Confirmed source selection is absent from the visual source manifest: ${selection.id}`);
  for (const selection of planSelections.values()) if (selection.materialization === 'runtime-package' && !(runtimeSourceLock.patterns || []).some(pattern => pattern.sourceSelectionId === selection.id && (pattern.files || []).length)) throw new Error(`Runtime package selection has no exact rendered source files: ${selection.id}`);
  const staticSelections = [...planSelections.values()].filter(selection => ['inline-transfer', 'generated-source'].includes(selection.materialization));
  if (staticSelections.length) {
    const materialized = JSON.parse(fs.readFileSync(requireArtifact(runDir, state, 'materializedAssets', 'materialized-assets.json'), 'utf8'));
    const actual = new Set((materialized.assets || []).map(asset => asset.selectionId));
    for (const selection of staticSelections) if (!actual.has(selection.id)) throw new Error(`Selected static source was not frozen before Gate 2: ${selection.id}`);
  }
  const sourceBindings = new Map(visualSources.bindings.map(item => [item.visualNode, item]));
  for (const source of visualSources.sources) if (source.sourceType === 'approved-candidate' && !(dependency.items || []).some(item => item.assetRef === source.sourceId || item.source === source.sourceId)) throw new Error(`Approved visual source is not locked as a dependency: ${source.sourceId}`);
  for (const entry of implementation.entries) {
    const source = sourceBindings.get(entry.visualNode);
    if (!source || !entry.sourceBindings || entry.sourceBindings.layoutSourceId !== source.layoutSourceId || entry.sourceBindings.componentSourceId !== source.componentSourceId || entry.sourceBindings.styleSourceId !== source.styleSourceId || entry.sourceBindings.fontSourceId !== source.fontSourceId || entry.sourceBindings.contentSourceId !== source.contentSourceId || entry.sourceBindings.selector !== source.selector || entry.sourceBindings.sourceMarker !== source.sourceMarker) throw new Error(`Implementation Map does not consume the frozen visual sources: ${entry.visualNode}`);
  }
  rejectPlaceholders(dependency, 'Dependency Lock');
  const required = capabilities(contract);
  if (required.has('chart') && !bundle.charts.length) throw new Error('Delivery Contract requires at least one chart specification');
  if (required.has('motion') && !bundle.motion.length) throw new Error('Delivery Contract requires at least one motion specification');
  if (bundle.motion.length) {
    const motionContractFile = requireArtifact(runDir, state, 'motionContract', 'motion-contract.json');
    const motionContract = validateFile('motion-contract.schema.json', motionContractFile);
    const strategyFile = resolveArtifact(runDir, state.artifacts.experienceStrategy, 'experience-strategy.json');
    if (motionContract.experienceStrategyHash !== hashFile(strategyFile)) throw new Error('Motion Contract does not bind the frozen Experience Strategy');
    const inventoryFile = requireArtifact(runDir, state, 'motionCapabilityInventory', 'motion-capability-inventory.json');
    const selectionFile = requireArtifact(runDir, state, 'motionCapabilitySelection', 'motion-capability-selection.json');
    validateFile('motion-capability-inventory.schema.json', inventoryFile);
    const selection = validateFile('motion-capability-selection.schema.json', selectionFile);
    const motionImplementation = validateFile('motion-implementation-map.schema.json', requireArtifact(runDir, state, 'motionImplementationMap', 'motion-implementation-map.json'));
    if (selection.inventoryHash !== hashFile(inventoryFile) || !selection.designSkills.includes('ui-ux-pro-max-skill')) throw new Error('Motion capability selection is not bound to the current inventory and ui-ux-pro-max-skill');
    const contractIds = new Set(motionContract.motions.map(item => item.id));
    const selected = new Map(selection.bindings.map(item => [item.motionId, item])); const implemented = new Map(motionImplementation.bindings.map(item => [item.motionId, item]));
    for (const motion of bundle.motion) {
      if (!contractIds.has(motion.id) || motion.contractRef !== state.artifacts.motionContract || motion.contractHash !== hashFile(motionContractFile)) throw new Error(`Visual Bundle motion is not hash-bound to the current motion contract: ${motion.id}`);
      const contractMotion = motionContract.motions.find(item => item.id === motion.id);
      if (JSON.stringify(motion.functionalBinding) !== JSON.stringify(contractMotion.functionalBinding)) throw new Error(`Visual Bundle motion does not preserve the frozen functional binding: ${motion.id}`);
      if (!selected.has(motion.id) || !implemented.has(motion.id) || selected.get(motion.id).engine !== implemented.get(motion.id).engine || selected.get(motion.id).sourceSelectionId !== implemented.get(motion.id).sourceSelectionId || !selected.get(motion.id).sourceSelectionId) throw new Error(`Motion lacks a capability-to-implementation binding: ${motion.id}`);
      if (JSON.stringify(implemented.get(motion.id).functionalBinding) !== JSON.stringify(contractMotion.functionalBinding)) throw new Error(`Motion implementation map does not preserve the functional binding: ${motion.id}`);
      const binding = selected.get(motion.id);
      const plannedMotion = (visualPlan.motion || []).find(item => item.id === motion.id);
      const selectedMotionSource = planSelections.get(binding.sourceSelectionId);
      if (!plannedMotion || plannedMotion.sourceSelectionId !== binding.sourceSelectionId || !selectedMotionSource || selectedMotionSource.kind !== 'motion' || selectedMotionSource.sourceId !== binding.capabilityId) throw new Error(`Motion does not consume its confirmed selected source: ${motion.id}`);
      if (binding.sourceType === 'approved-candidate') {
        const planned = (visualPlan.dependencies || []).find(item => item.package === binding.dependency?.package && item.version === binding.dependency?.version && ['installed', 'planned'].includes(item.status));
        const locked = (dependency.items || []).some(item => item.source === binding.dependency?.package && item.version === binding.dependency?.version);
        if (!planned || !locked) throw new Error(`Online motion candidate is not bound to the confirmed plan and exact dependency lock: ${motion.id}`);
      }
    }
  }
  {
    const reference = validateFile('visual-reference.schema.json', requireArtifact(runDir, state, 'visualReference', 'visual-reference.json'));
    if (runtimeBaseline.sourceLockHash !== hashFile(runtimeSourceLockFile) || runtimeBaseline.referenceImage.sha256 !== reference.referenceImage.sha256 || path.resolve(runDir, runtimeBaseline.referenceImage.path) !== path.resolve(runDir, reference.referenceImage.path)) throw new Error('Approved visual reference is not the frozen runtime-rendered baseline');
    for (const binding of visualSources.bindings) if (!runtimeSourceLock.patterns.some(pattern => pattern.visualNodes.includes(binding.visualNode)) && !runtimeSourceLock.nativeSelections?.some(selection => selection.visualNodes.includes(binding.visualNode))) throw new Error(`Visual source is not backed by a complete runtime source: ${binding.visualNode}`);
    if (visualSources.visualReferenceHash !== reference.referenceImage.sha256) throw new Error('Visual source manifest is not bound to the current approved effect image');
    if (state.track === 'existing') {
      const codeReference = assertExistingCodeReferenceUnchanged(runDir, state);
      const pageSkeleton = validateFile('page-skeleton.schema.json', requireArtifact(runDir, state, 'pageSkeleton', 'page-skeleton.json'));
      if (reference.existingCodeReference?.sourceTreeHash !== codeReference.sourceTreeHash || reference.existingCodeReference?.sourceFileCount !== codeReference.sourceFileCount || reference.existingCodeReference?.complete !== true || reference.existingPageSkeleton?.sourceTreeHash !== codeReference.sourceTreeHash || reference.existingPageSkeleton?.skeletonHash !== pageSkeleton.skeletonHash) throw new Error('Existing Visual Reference is not bound to the complete scoped code reference and page skeleton');
      const skeletonNodes = new Set(pageSkeleton.nodes.map(item => `${item.sourcePath}\u0000${item.marker}`)); const mappings = reference.existingPageSkeleton.mappings || [];
      if (new Set(mappings.map(item => item.visualNode)).size !== reference.layoutLock.nodes.length || !reference.layoutLock.nodes.every(node => mappings.some(item => item.visualNode === node.id)) || mappings.some(item => !skeletonNodes.has(`${item.sourcePath}\u0000${item.sourceMarker}`))) throw new Error('Existing Visual Reference does not strictly map every visual node to the real page skeleton');
    }
    const gate1VisualOutput = requireArtifact(runDir, state, 'gate1VisualOutput', 'gate1-visual-output.json');
    const gate1Visual = readJson(gate1VisualOutput);
    if (gate1Visual.source !== 'gate1-visual') throw new Error('Gate 1 visual output is not marked as gate1-visual');
    if (path.resolve(runDir, gate1Visual.referenceImage?.path || '') !== path.resolve(runDir, reference.referenceImage.path)) throw new Error('Gate 1 effect image does not match Visual Reference');
    const candidates = validateFile('design-candidates.schema.json', requireArtifact(runDir, state, 'designCandidates', 'design-candidates.json'));
    const strategyFile = resolveArtifact(runDir, state.artifacts.experienceStrategy, 'experience-strategy.json');
    if (candidates.strategyHash !== hashFile(strategyFile)) throw new Error('Design candidates do not bind the current experience strategy');
    const selected = candidates.candidates.find(item => item.id === candidates.selectedCandidateId);
    if (!selected || selected.image.sha256 !== reference.referenceImage.sha256 || path.resolve(runDir, selected.image.path) !== path.resolve(runDir, reference.referenceImage.path)) throw new Error('Visual Reference is not the user-selected, hash-locked design candidate');
    if (stitchSkipped) {
      if (bundle.implementationBaseline.path !== state.artifacts.visualReference || bundle.implementationBaseline.hash !== reference.referenceImage.sha256) throw new Error('Stitch-skipped implementation baseline does not bind the approved effect image');
    } else {
      const parity = validateFile('stitch-parity-evidence.schema.json', requireArtifact(runDir, state, 'stitchParityEvidence', 'stitch-parity-evidence.json'));
      if (parity.referenceImageHash !== reference.referenceImage.sha256) throw new Error('Stitch parity reference hash does not match Visual Reference');
      validateStructuralContract(runDir, parity, 'stitch-screen-export', parity.stitchImageHash);
      if (parity.unmatched.length) throw new Error('Stitch parity evidence has unmatched visual differences');
      if (!stitch.approvedScreens.some(screen => screen.imageHash === parity.stitchImageHash)) throw new Error('Stitch parity does not reference a frozen Stitch screen');
      if (!stitch.generationInput || stitch.generationInput.origin !== 'apex-visual') throw new Error('Stitch Freeze is not parameterized from the APEX Visual Reference');
      if (!stitch.generationInput.references?.some(item => item.sha256 === reference.referenceImage.sha256)) throw new Error('Stitch Freeze does not reference the APEX effect image');
      if (stitch.generationInput.contentLock?.sourceHash !== reference.contentLock.hash || stitch.generationInput.layoutLock?.sourceHash !== reference.layoutLock.hash || stitch.generationInput.analyticsLock?.sourceHash !== reference.analyticsLock.hash) throw new Error('Stitch Freeze parameter locks do not match Visual Reference');
    }
  }
  if (!state.locks.effectApproved || !state.locks.visualApproved) throw new Error('effect image approval is missing');
  if (!state.locks.stitchApproved) throw new Error('Stitch user approval is missing');
  if (!state.locks.implementationApproved) throw new Error('pre-implementation approval is missing');
  if (!state.locks.stitchCurrent && !stitchSkipped) throw new Error('stitchCurrent is false');
  return state;
}

function validateGate3(runDir) {
  const { state, contract } = validateGate1(runDir);
  if (state.gates.gate2.status !== 'passed' || !state.locks.implementationAllowed) throw new Error('Gate 2 has not passed or implementation is not allowed');
  if (!['passed', 'not-required'].includes(state.gates.proof.status)) throw new Error('Proof Gate has not passed');
  {
    const stitchSkipped = state.locks?.stitchSkipped === true;
    const stitch = stitchSkipped ? null : validateFile('stitch-freeze.schema.json', requireArtifact(runDir, state, 'stitchFreeze', 'stitch-freeze.json'));
    const parity = validateFile('implementation-parity-evidence.schema.json', requireArtifact(runDir, state, 'implementationParityEvidence', 'implementation-parity-evidence.json'));
    validateStructuralContract(runDir, parity, 'runtime-dom-export', parity.runtimeImageHash);
    const reference = validateFile('visual-reference.schema.json', requireArtifact(runDir, state, 'visualReference', 'visual-reference.json'));
    const expectedBaseline = stitchSkipped ? { kind: 'effect-image', imageHash: reference.referenceImage.sha256 } : { kind: 'stitch', imageHash: parity.stitchImageHash };
    if (parity.baseline?.kind !== expectedBaseline.kind || parity.baseline?.imageHash !== expectedBaseline.imageHash) throw new Error('Implementation parity does not reference the approved implementation baseline');
    if (!stitchSkipped && !stitch.approvedScreens.some(screen => screen.imageHash === parity.stitchImageHash)) throw new Error('Implementation parity does not reference the frozen Stitch screen');
    if (parity.unmatched.length) throw new Error('Implementation parity evidence has unmatched visual differences');
    const bundle = validateFile('visual-bundle.schema.json', requireArtifact(runDir, state, 'visualBundle', 'visual-bundle.json'));
    const stateMatrix = validateFile('runtime-state-matrix.schema.json', requireArtifact(runDir, state, 'runtimeStateMatrix', 'runtime-state-matrix.json'));
    validateRuntimeStateMatrix(runDir, stateMatrix, expectedBaseline, bundle.responsive);
    if (state.track === 'existing') {
      const scopeFile = requireArtifact(runDir, state, 'changeScope', 'change-scope.json');
      const scope = validateFile('change-scope.schema.json', scopeFile), scopeHash = hashFile(scopeFile);
      const failed = protectedVisualEvidenceChecks(runDir, scopeHash, scope.protected.visualNodes, stateMatrix.interactions).filter(item => !item.passed);
      if (failed.length) throw new Error(`protected visual nodes changed or lack valid zero-diff evidence: ${failed.map(item => item.visualNode).join(', ')}`);
    }
    const visualPlanFile = requireArtifact(runDir, state, 'visualExecutionPlan', 'visual-execution-plan.json');
    const visualPlan = validateFile('visual-execution-plan.schema.json', visualPlanFile);
    const requiresMaterialization = (visualPlan.sourceSelections || []).some(selection => ['inline-transfer', 'generated-source'].includes(selection.materialization));
    if (requiresMaterialization) {
      const manifest = JSON.parse(fs.readFileSync(requireArtifact(runDir, state, 'materializedAssets', 'materialized-assets.json'), 'utf8'));
      const audit = JSON.parse(fs.readFileSync(requireArtifact(runDir, state, 'materializedAssetsAudit', 'evidence/materialized-assets-audit.json'), 'utf8'));
      if (!Array.isArray(manifest.assets) || !manifest.assets.length || audit.status !== 'passed') throw new Error('selected static visual sources were not materialized and verified in the project');
      const expected = new Set((visualPlan.sourceSelections || []).filter(selection => ['inline-transfer', 'generated-source'].includes(selection.materialization)).map(selection => selection.id));
      const actual = new Set(manifest.assets.map(asset => asset.selectionId));
      for (const selectionId of expected) if (!actual.has(selectionId)) throw new Error(`selected static visual source was not materialized: ${selectionId}`);
    }
    const requiresRuntimeMaterialization = (visualPlan.sourceSelections || []).some(selection => selection.materialization === 'runtime-package');
    if (requiresRuntimeMaterialization) {
      const runtimeAudit = JSON.parse(fs.readFileSync(requireArtifact(runDir, state, 'runtimeMaterializationAudit', 'evidence/runtime-materialization-audit.json'), 'utf8'));
      if (runtimeAudit.status !== 'passed') throw new Error('selected runtime packages were not installed and verified against the rendered source lock');
      const expected = new Set((visualPlan.sourceSelections || []).filter(selection => selection.materialization === 'runtime-package').map(selection => selection.id));
      const actual = new Set((runtimeAudit.packages || []).flatMap(item => item.selectionIds || []));
      for (const selectionId of expected) if (!actual.has(selectionId)) throw new Error(`selected runtime package was not verified in the project: ${selectionId}`);
    }
    if (visualPlan.threeD?.length) {
      const threeDEvidence = validateFile('three-d-evidence.schema.json', requireArtifact(runDir, state, 'threeDEvidence', 'three-d-evidence.json'));
      if (threeDEvidence.visualExecutionPlanHash !== hashFile(visualPlanFile)) throw new Error('3D evidence does not bind the frozen visual execution plan');
      for (const scene of visualPlan.threeD) {
        const evidence = threeDEvidence.scenes.find(item => item.id === scene.id);
        if (!evidence || evidence.renderer !== scene.renderer || (scene.assets || []).some(asset => !evidence.assetSelectionIds?.includes(asset.sourceSelectionId))) throw new Error(`3D runtime evidence is missing or does not consume the selected assets: ${scene.id}`);
        for (const key of ['screenshot', 'performanceEvidence', 'fallbackEvidence', 'reducedMotionEvidence']) {
          const evidenceFile = resolveArtifact(runDir, evidence[key], '');
          if (!evidenceFile.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(evidenceFile)) throw new Error(`3D ${key} is missing: ${scene.id}`);
        }
      }
    }
    if (bundle.motion.length) {
      const motionContractFile = requireArtifact(runDir, state, 'motionContract', 'motion-contract.json');
      const motionEvidence = validateFile('motion-evidence.schema.json', requireArtifact(runDir, state, 'motionEvidence', 'motion-evidence.json'));
      if (motionEvidence.motionContractHash !== hashFile(motionContractFile)) throw new Error('Motion evidence does not bind the frozen motion contract');
      const contract = validateFile('motion-contract.schema.json', motionContractFile);
      for (const motion of contract.motions) {
        const evidence = (motionEvidence.eventEvidence || []).find(item => item.motionId === motion.id);
        if (!evidence || evidence.event !== motion.functionalBinding.event || evidence.beforeState !== motion.functionalBinding.stateTransition.from || evidence.afterState !== motion.functionalBinding.stateTransition.to) throw new Error(`Motion runtime evidence does not prove the frozen functional transition: ${motion.id}`);
      }
      const motionImplementation = validateFile('motion-implementation-map.schema.json', requireArtifact(runDir, state, 'motionImplementationMap', 'motion-implementation-map.json'));
      if (motionImplementation.bindings.length !== bundle.motion.length) throw new Error('Runtime motion evidence has no complete frozen implementation map');
    }
  }
  const verification = validateFile('verification-bundle.schema.json', resolveArtifact(runDir, state.artifacts.verificationBundle, 'verification-bundle.json'));
  const provenanceFile = requireArtifact(runDir, state, 'evidenceProvenance', 'evidence-provenance.json');
  const provenance = validateFile('evidence-provenance.schema.json', provenanceFile);
  if (provenance.status !== 'passed' || provenance.entries.some(entry => entry.result !== 'passed')) throw new Error('Gate 3 requires a passed raw-evidence provenance envelope');
  for (const entry of provenance.entries) {
    const evidence = resolveArtifact(runDir, entry.path, ''); const receipt = resolveArtifact(runDir, entry.operationReceipt, '');
    const receiptExists = receipt.startsWith(`${path.resolve(runDir)}${path.sep}operations${path.sep}`) && fs.existsSync(receipt); const operation = receiptExists ? readJson(receipt) : null; if (!evidence.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(evidence) || hashFile(evidence) !== entry.sha256 || !receiptExists || operation.status !== 'succeeded' || operation.outputFileHashes?.[entry.path] !== entry.sha256) throw new Error(`Gate 3 provenance entry is missing, changed, or not produced by a successful controlled operation: ${entry.id}`);
  }
  const industryFile = requireArtifact(runDir, state, 'industryBenchmarkEvidence', 'industry-benchmark-evidence.json');
  const industry = validateFile('industry-benchmark-evidence.schema.json', industryFile);
  const currentPlan = requireArtifact(runDir, state, 'visualExecutionPlan', 'visual-execution-plan.json');
  const reviewFile = resolveArtifact(runDir, industry.reviewPath, ''); const reviewReceipt = resolveArtifact(runDir, industry.reviewReceipt, '');
  if (!reviewFile.startsWith(`${path.resolve(runDir)}${path.sep}`) || !fs.existsSync(reviewFile) || !reviewReceipt.startsWith(`${path.resolve(runDir)}${path.sep}operations${path.sep}`) || !fs.existsSync(reviewReceipt)) throw new Error('Gate 3 industry benchmark review or controlled-operation receipt is missing');
  const review = validateFile('industry-benchmark-review.schema.json', reviewFile); const receipt = readJson(reviewReceipt);
  if (industry.status !== 'passed' || industry.assessmentMode !== 'evidence-bound-review' || industry.visualPlanHash !== hashFile(currentPlan) || industry.provenanceHash !== hashFile(provenanceFile) || industry.reviewHash !== hashFile(reviewFile) || review.visualPlanHash !== hashFile(currentPlan) || receipt.status !== 'succeeded' || receipt.action !== 'verify' || receipt.script !== 'industry-benchmark.mjs' || receipt.inputFileHashes?.[industry.reviewPath] !== industry.reviewHash || industry.average < 4 || industry.scores.some(item => item.result !== 'passed')) throw new Error('Gate 3 industry benchmark is not evidence-bound to the current plan, runtime evidence, and controlled review');
  if (verification.gate3 !== 'passed' || verification.unverified?.length) throw new Error('Verification Bundle has failures or unverified checks');
  const requirements = new Set(contract.verificationRequirements || []);
  const evidence = {
    unit: verification.code,
    integration: verification.runtime,
    contract: verification.contract,
    e2e: verification.functional,
    visual: verification.visual,
    accessibility: verification.accessibility,
    performance: verification.performance,
    regression: verification.siteRegression,
    smoke: verification.runtime
  };
  for (const requirement of requirements) if (!evidence[requirement]?.length) throw new Error(`Verification evidence missing for ${requirement}`);
  return state;
}

function hashFiles(files) {
  const hash = crypto.createHash('sha256');
  [...files].sort().forEach(file => {
    hash.update(path.basename(file));
    hash.update(fs.readFileSync(file));
  });
  return hash.digest('hex');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (fs.realpathSync(root) !== fs.realpathSync(canonicalApexRoot)) throw new Error(`APEX validator must run from canonical root: ${canonicalApexRoot}`);
  if (command === 'validate') {
    const [schemaName, file] = args;
    if (!schemaName || !file) throw new Error('usage: validate <schema-file-name> <json-file>');
    validateFile(schemaName, path.resolve(file));
    console.log('APEX validation passed');
  } else if (command === 'gate2') {
    const runDir = path.resolve(args[0] || '.');
    const state = validateGate2(runDir);
    if (!state.locks.implementationAllowed || state.gates.gate2.status !== 'passed') throw new Error('Gate 2 artifacts are valid but implementation permission has not been explicitly opened');
    console.log('APEX Gate 2 passed: implementation is allowed');
  } else if (command === 'pre-gate2') {
    validateGate2(path.resolve(args[0] || '.'));
    console.log('APEX pre-Gate 2 validation passed');
  } else if (command === 'pre-gate1') {
    validateGate1(path.resolve(args[0] || '.'));
    console.log('APEX pre-Gate 1 validation passed');
  } else if (command === 'gate3') {
    validateGate3(path.resolve(args[0] || '.'));
    console.log('APEX Gate 3 validation passed');
  } else if (command === 'hash') {
    if (!args.length) throw new Error('usage: hash <file> [file...]');
    console.log(hashFiles(args.map(file => path.resolve(file))));
  } else {
    throw new Error('commands: validate | pre-gate1 | pre-gate2 | gate2 | gate3 | hash');
  }
} catch (error) {
  fail(error.message);
}
