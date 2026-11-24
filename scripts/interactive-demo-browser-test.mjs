#!/usr/bin/env node
/** Real-browser acceptance through the existing Router/action/capture pipeline. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chatDemoContract as demoContract, demoFragment } from './interactive-demo-test-fixture.mjs';
import { verifyDemoInteractions, journeyCode } from './interactive-demo.mjs';
import { bindStitchScreen } from './stitch-screen-binding.mjs';
import { formalStitchProgress } from './formal-stitch-progress.mjs';
import { formalDirectProgress } from './formal-direct-progress.mjs';
import { validateFormalInteractionEvidence } from './formal-interaction-evidence.mjs';
import { formalJourneyCode } from './formal-interaction.mjs';
import { npmCacheRoot } from './apex-paths.mjs';
import { buildStitchPrompt } from './stitch-adaptation.mjs';
import { stitchMachineSealCurrent } from './stitch-machine-seal.mjs';
import { commitRunState, agentRuntimeStatus } from './run-ledger.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-interactive-browser-'));
const runId = 'interactive-browser', session = 'interactive-browser-test';
const runDir = path.join(project, '.apex/runs', runId);
let mockEndpoint, mockServer;
function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', script), ...args], { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...(mockEndpoint ? { STITCH_HOST: mockEndpoint, STITCH_API_KEY: 'local-fixture-only' } : {}) } });
  if (result.status !== 0) throw new Error(`${script}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
function action(script, ...args) {
  const auth = run('apex-router.mjs', ['authorize', project, runId, session, 'generate_visual']);
  return run('apex-action.mjs', ['run', project, runId, session, auth.authorizationRef, 'generate_visual', script, ...args]);
}
const write = (name, data) => { const file = path.join(runDir, name); fs.writeFileSync(file, JSON.stringify(data)); return file; };
function seedImplementationSeal(state) {
  // Gate 2 is deliberately a fixture here; the Demo confirmation is real.
  const name = fs.readdirSync(path.join(runDir, 'approvals')).find(value => value.startsWith('demo-') && value.endsWith('.json'));
  if (!name) throw new Error('Demo confirmation is missing');
  const demoApproval = `approvals/${name}`;
  for (const [key, file] of Object.entries({ visualBundle: 'fixture-bundle.json', implementationMap: 'fixture-map.json', implementationPresentation: 'fixture-presentation.md', implementationPresentationManifest: 'fixture-presentation.json' })) {
    fs.writeFileSync(path.join(runDir, file), key === 'implementationMap' ? JSON.stringify({ entries: [{ runtimeTarget: ['fixture-formal.html'] }] }) : `fixture ${key}\n`); state.artifacts[key] = file;
  }
  const refs = [demoApproval, state.artifacts.visualBundle, state.artifacts.implementationMap, state.artifacts.implementationPresentation, state.artifacts.implementationPresentationManifest];
  const artifactHashes = refs.map(ref => ({ path: ref, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(runDir, ref))).digest('hex') }));
  const id = crypto.createHash('sha256').update(JSON.stringify(artifactHashes)).digest('hex'), relative = `machine-seals/implementation-${id}.json`;
  fs.mkdirSync(path.join(runDir, 'machine-seals'), { recursive: true });
  fs.writeFileSync(path.join(runDir, relative), JSON.stringify({ schemaVersion: '3.0', type: 'implementation-machine-seal', status: 'validated', runId, demoApproval, artifactHashes }));
  state.gates.gate2.evidence.push(relative);
}
function seedImplementationRegistration(state) {
  // Registration is a fixture for parity plumbing, not proof of a real implementation.
  const target = path.join(project, 'fixture-formal.html'); fs.writeFileSync(target, '<main>fixture formal target</main>');
  const sha = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  const receipt = { schemaVersion: '3.0', type: 'implementation-registration', projectId: `project_${crypto.createHash('sha256').update(fs.realpathSync(project)).digest('hex').slice(0, 24)}`, runId, sessionId: session, authorizationRef: 'fixture-authorization', leaseId: 'fixture-lease', pageDelta: { path: state.artifacts.pageDelta, sha256: sha(path.join(runDir, state.artifacts.pageDelta)) }, implementationMap: { path: state.artifacts.implementationMap, sha256: sha(path.join(runDir, state.artifacts.implementationMap)) }, files: [{ path: 'fixture-formal.html', sha256: sha(target) }] };
  write('fixture-registration.json', receipt); state.artifacts.implementationRegistration = 'fixture-registration.json';
}
let pid;
try {
  run('apex-router.mjs', ['intake', project, runId, 'greenfield', 'standard', 'interactive', session, '确认调用 APEX']);
  const stateFile = path.join(runDir, 'state.json'), state = JSON.parse(fs.readFileSync(stateFile));
  write('fixture-product-strategy.json', { functionalPlan: demoContract.journeys.filter(item => item.kind === 'task').map(item => ({ task: item.task })) });
  state.artifacts.experienceStrategy = 'fixture-product-strategy.json';
  const selections = ['layout-a', 'chart-b', 'style-a', 'font-a', 'content-a'].map((id, index) => ({ id, kind: ['layout', 'component', 'style', 'font', 'content'][index], visualNodes: ['demo-root'], sourceType: 'native-web', sourceId: 'web', resourceId: id, version: 'current', materialization: 'native-web', parameters: index === 4 ? { origin: 'mock', fields: ['count'], implementation: 'local counter' } : {} }));
  const designText = '# Fixture design contract\n'; fs.writeFileSync(path.join(runDir, 'DESIGN.md'), designText);
  write('visual-execution-plan.json', { sourceSelections: selections, selectionAnalysis: { designContract: { path: 'DESIGN.md', sha256: `sha256:${crypto.createHash('sha256').update(designText).digest('hex')}` } } });
  state.gates.gate1 = { status: 'passed', evidence: ['test-fixture'] }; state.locks.requirementsApproved = true; state.locks.visualPlanApproved = true; state.phase = 'G-05 VISUAL'; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json'; commitRunState(runDir, state, { reason: 'interactive-browser-test-fixture' });
  const tokenHash = `sha256:${crypto.createHash('sha256').update('{}').digest('hex')}`;
  const markedFragment = demoFragment.replace('<div id="apex-chat-example"', `<div data-apex-node="demo-root" data-apex-component="demo-root" data-apex-component-kind="panel" data-apex-token-hash="${tokenHash}" id="apex-chat-example"`) + '\n<!-- data-apex-source-selection="comment-only-source" -->';
  const input = write('demo-source-input.json', { schemaVersion: '3.0', entrypoint: 'index.html', interactionContract: demoContract, chatPreview: { fragment: 'preview.html' }, files: [{ path: 'preview.html', content: markedFragment }], sourceBindings: selections.map(item => ({ sourceSelectionId: item.id, files: ['preview.html'] })) });
  action('demo-source-compiler.mjs', 'compile', runDir, input);
  action('visual-sandbox-writer.mjs', 'materialize', runDir, path.join(runDir, 'demo-source-manifest.json'));
  action('visual-sandbox-runtime.mjs', 'start', runDir);
  const runtime = JSON.parse(fs.readFileSync(path.join(runDir, 'visual-sandbox-runtime.json'))); pid = runtime.pid;
  const spec = write('runtime-browser-spec.json', { requiredSourceSelectionIds: selections.map(item => item.id), formalJourneys: process.env.APEX_TEST_DIRECT === '1' ? demoContract.journeys.filter(item => item.kind !== 'reset') : demoContract.journeys, screens: [{ id: 'desktop', route: '/', width: 1440, height: 900 }, { id: 'mobile', route: '/', width: 390, height: 844 }] });
  action('browser-capture.mjs', 'capture', runDir, runtime.url, spec);
  const capture = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence/runtime-browser-capture.json')));
  if (capture.evidence.some(item => item.sourceSelections.includes('comment-only-source'))) throw new Error('a source marker inside an HTML comment must not be reported as a DOM element');
  verifyDemoInteractions(runDir, capture, runtime.url);
  const captureStatus = run('apex-router.mjs', ['status', project, runId, session]);
  if (captureStatus.executionDirective?.currentStep?.id === 'capture-runtime-browser-evidence') throw new Error('successful same-origin multi-route capture must advance instead of repeating browser capture');
  for (const [id, size] of [['desktop', '1440x900'], ['mobile', '390x844']]) { const screen = capture.evidence.find(item => item.id === id); if (screen?.viewport !== size || screen.logs?.viewport !== 'matched' || screen.url !== new URL('/', runtime.url).href || screen.controlInventory?.viewport !== size || screen.controlInventory?.url !== screen.url) throw new Error(`browser capture must bind the observed URL, viewport and control inventory for ${id}`); }
  action('runtime-visual-baseline.mjs', 'compile', runDir, project, write('runtime-visual-baseline-input.json', { schemaVersion: '3.0', runtimeRoot: 'visual-sandbox', referenceScreenId: 'desktop', patterns: [] }));
  const baseline = JSON.parse(fs.readFileSync(path.join(runDir, 'runtime-visual-baseline.json')));
  const baselineValidation = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-validate.mjs'), 'validate', 'runtime-visual-baseline.schema.json', path.join(runDir, 'runtime-visual-baseline.json')], { encoding: 'utf8' });
  if (baselineValidation.status !== 0) throw new Error(`a real no-motion Demo baseline must satisfy its schema: ${baselineValidation.stderr || baselineValidation.stdout}`);
  if (baseline.screenCaptures?.length !== 2 || !['desktop', 'mobile'].every(id => baseline.screenCaptures.some(item => item.id === id && item.screenshot.sha256 && item.dom.sha256)) || baseline.journeyCaptures?.length !== demoContract.journeys.length || !demoContract.journeys.every(journey => baseline.journeyCaptures.some(item => item.id === journey.id && item.task === journey.task && /^\d+x\d+$/.test(item.viewport) && item.finalUrl.startsWith(runtime.url) && item.screenshot.sha256 && item.dom.sha256))) throw new Error('real browser baseline must bind both viewports and every executed user journey to its screenshot and DOM');
  const demo = JSON.parse(fs.readFileSync(path.join(runDir, 'runtime-demo.json')));
  if (demo.kind !== 'interactive-ui-prototype' || demo.journeyCount !== demoContract.journeys.length || demo.presentation.screenshotOnlyAllowed !== false || demo.presentation.preferred !== 'chat-inline' || !demo.presentation.contentReference?.includes('preview.html')) throw new Error('compiled Demo did not retain the interaction contract');
  if (demo.controlCoverage?.scope !== 'observed-screens-and-journeys' || demo.controlCoverage.truncated || demo.controlCoverage.untestedControls.length || !['route:%2F|id:settings-tab', 'route:%2F|id:projects-tab', 'route:%2F|id:project-name', 'route:%2F|id:notifications'].every(key => demo.controlCoverage.observedControls.some(item => item.key === key))) throw new Error('complete Demo journeys must exercise all observed sample controls');
  // Prove that dispatching a real click without the expected UI change fails.
  const cli = fs.readdirSync(npmCacheRoot).map(name => path.join(npmCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file));
  if (!cli) throw new Error('browser acceptance needs the installed Playwright CLI');
  const browserSession = `negative-${path.basename(project)}`;
  const cliCall = args => spawnSync(process.execPath, [cli, '--session', browserSession, ...args], { cwd: runDir, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PWTEST_DAEMON_SESSION_DIR: path.join(runDir, 'cache/playwright-daemon') } });
  try {
    const opened = cliCall(['open', runtime.url]); if (opened.status !== 0) throw new Error(opened.stderr || opened.stdout);
    const wrongButton = structuredClone(demoContract.journeys[0]); wrongButton.steps[0].selector = '#reset';
    const clicked = cliCall(['run-code', journeyCode({ journey: wrongButton, url: runtime.url, notice: demoContract.notice, screenshotPath: path.join(runDir, 'evidence/no-op-button.png') })]);
    const match = clicked.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
    let observed = match && JSON.parse(match[1]);
    if (typeof observed === 'string') observed = JSON.parse(observed);
    if (clicked.status !== 0 || observed?.status !== 'failed' || !observed.error?.includes('observed "0"')) throw new Error('a no-op button was not rejected by real-browser assertions');
    write('evidence/no-op-button.json', observed);
    const formalClicked = cliCall(['run-code', formalJourneyCode({ journey: wrongButton, url: runtime.url, screenshotPath: path.join(runDir, 'evidence/formal-no-op.png') })]);
    const formalMatch = formalClicked.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
    let formalObserved = formalMatch && JSON.parse(formalMatch[1]); if (typeof formalObserved === 'string') formalObserved = JSON.parse(formalObserved);
    if (formalClicked.status !== 0 || formalObserved?.status !== 'failed' || !formalObserved.error?.includes('observed "0"')) throw new Error('a no-op formal button must fail its observed state transition');
    const visibility = (selector, equals) => ({ selector, property: 'visible', equals });
    const value = (selector, equals) => ({ selector, property: 'value', equals });
    const checked = (selector, equals) => ({ selector, property: 'checked', equals });
    const openSettings = { action: 'click', selector: '#settings-tab', before: visibility('#settings-panel', false), after: visibility('#settings-panel', true) };
    const fillName = { action: 'fill', selector: '#project-name', value: '示例项目', before: value('#project-name', ''), after: value('#project-name', '示例项目') };
    const sampleJourneys = [
      { id: 'sample-navigation', route: '/', steps: [openSettings, { action: 'click', selector: '#projects-tab', before: visibility('#projects-panel', false), after: visibility('#projects-panel', true) }] },
      { id: 'sample-notifications', route: '/', steps: [openSettings, { action: 'uncheck', selector: '#notifications', before: checked('#notifications', true), after: checked('#notifications', false) }] },
      { id: 'sample-input-reset', route: '/', steps: [fillName, { action: 'click', selector: '#reset', before: value('#project-name', '示例项目'), after: value('#project-name', '') }] }
    ];
    for (const journey of sampleJourneys) {
      const result = cliCall(['run-code', journeyCode({ journey, url: runtime.url, notice: demoContract.notice, screenshotPath: path.join(runDir, `evidence/${journey.id}.png`) })]);
      const parsed = result.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
      let trace = parsed && JSON.parse(parsed[1]); if (typeof trace === 'string') trace = JSON.parse(trace);
      if (result.status !== 0 || trace?.status !== 'passed' || trace.steps.length !== journey.steps.length) throw new Error(`sample interactive control failed: ${journey.id}: ${trace?.error || result.stderr}`);
      write(`evidence/${journey.id}.json`, trace);
    }
    const customControlFile = path.join(runDir, 'visual-sandbox/control-audit-fixture.html');
    try {
      fs.writeFileSync(customControlFile, '<!doctype html><meta charset="utf-8"><p id="notice">交互预览 · 示例数据</p><div id="custom-radio" role="radio" tabindex="0" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')">选择</div><div id="custom-slider" role="slider" tabindex="0">滑块</div><div aria-disabled="true"><button id="disabled-control">不可用</button></div><p id="swap-result">before</p><button id="swap" onclick="document.querySelector(\'#swap-result\').textContent=\'after\';this.outerHTML=\'<input id=&quot;swap&quot;>\'">替换</button>');
      const customJourney = { id: 'sample-custom-control', route: '/control-audit-fixture.html', steps: [{ action: 'click', selector: '#custom-radio', before: { selector: '#custom-radio', property: 'attribute', attribute: 'aria-checked', equals: 'false' }, after: { selector: '#custom-radio', property: 'attribute', attribute: 'aria-checked', equals: 'true' } }] };
      const result = cliCall(['run-code', journeyCode({ journey: customJourney, url: runtime.url, notice: demoContract.notice, screenshotPath: path.join(runDir, 'evidence/sample-custom-control.png') })]);
      const match = result.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
      let trace = match && JSON.parse(match[1]); if (typeof trace === 'string') trace = JSON.parse(trace);
      const keys = (trace?.observedControls || []).map(item => item.key);
      if (result.status !== 0 || trace?.status !== 'passed' || !keys.includes('route:%2Fcontrol-audit-fixture.html|id:custom-radio') || !keys.includes('route:%2Fcontrol-audit-fixture.html|id:custom-slider') || keys.includes('route:%2Fcontrol-audit-fixture.html|id:disabled-control') || !trace.exercisedControls.includes('route:%2Fcontrol-audit-fixture.html|id:custom-radio')) throw new Error('custom controls or disabled ancestors were misclassified');
      const swapJourney = { id: 'sample-identity-conflict', route: '/control-audit-fixture.html', steps: [{ action: 'click', selector: '#swap', before: { selector: '#swap-result', property: 'text', equals: 'before' }, after: { selector: '#swap-result', property: 'text', equals: 'after' } }] };
      const swap = cliCall(['run-code', journeyCode({ journey: swapJourney, url: runtime.url, notice: demoContract.notice, screenshotPath: path.join(runDir, 'evidence/sample-identity-conflict.png') })]);
      const swapMatch = swap.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
      let swapTrace = swapMatch && JSON.parse(swapMatch[1]); if (typeof swapTrace === 'string') swapTrace = JSON.parse(swapTrace);
      if (swap.status !== 0 || swapTrace?.status !== 'passed' || !swapTrace.controlIdentityConflicts.includes('route:%2Fcontrol-audit-fixture.html|id:swap')) throw new Error('browser must report a changed control type under the same identity');
    } finally { fs.rmSync(customControlFile, { force: true }); }
    const routeJourney = { ...demoContract.journeys[0], route: '/?variant=other' };
    const routeResult = cliCall(['run-code', journeyCode({ journey: routeJourney, url: runtime.url, notice: demoContract.notice, screenshotPath: path.join(runDir, 'evidence/sample-other-route.png') })]);
    const routeMatch = routeResult.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
    let routeTrace = routeMatch && JSON.parse(routeMatch[1]); if (typeof routeTrace === 'string') routeTrace = JSON.parse(routeTrace);
    if (routeResult.status !== 0 || routeTrace?.status !== 'passed' || !routeTrace.observedControls.some(item => item.key === 'route:%2F%3Fvariant%3Dother|id:increment') || routeTrace.observedControls.some(item => item.key === 'route:%2F|id:increment')) throw new Error('control inventory must distinguish identical IDs on different routes');
    const limitedResult = cliCall(['run-code', journeyCode({ journey: demoContract.journeys[0], url: runtime.url, notice: demoContract.notice, screenshotPath: path.join(runDir, 'evidence/sample-limited-inventory.png'), controlInventoryLimit: 1 })]);
    const limitedMatch = limitedResult.stdout.match(/### Result\s*\n([\s\S]*?)\n### /);
    let limited = limitedMatch && JSON.parse(limitedMatch[1]); if (typeof limited === 'string') limited = JSON.parse(limited);
    if (limitedResult.status !== 0 || limited?.status !== 'passed' || limited.controlInventoryTruncated !== true || limited.observedControls.length !== 1) throw new Error('an undersized control inventory must report truncation');
  } finally { cliCall(['close']); }
  // Formal verification can replace its capture file without invalidating Demo evidence.
  const frozen = JSON.parse(fs.readFileSync(path.join(runDir, demo.interactionEvidence.path)));
  const captureBytes = fs.readFileSync(path.join(runDir, 'evidence/runtime-browser-capture.json'));
  write('evidence/runtime-browser-capture.json', { kind: 'runtime', status: 'passed', note: 'formal verification fixture' });
  verifyDemoInteractions(runDir, frozen, runtime.url);
  const bound = bindStitchScreen(runDir, { screenId: 'desktop', route: '/', viewport: 'desktop', state: 'default', demoCapture: { kind: 'screen', id: 'desktop' } }, baseline);
  if (baseline.browserCapture.path !== demo.interactionEvidence.path || bound.screenshot.sha256 !== baseline.screenCaptures.find(item => item.id === 'desktop').screenshot.sha256) throw new Error('formal capture must not replace the frozen Demo binding');
  fs.writeFileSync(path.join(runDir, 'evidence/runtime-browser-capture.json'), captureBytes);
  const globalVisualInput = write('global-visual-input.json', { source: 'gate1-visual', referenceImage: { path: path.join(runDir, baseline.referenceImage.path), viewport: 'desktop' }, contentLock: { locale: 'zh-CN', protectedText: ['项目工作台'] }, layoutLock: { mode: 'strict', protectedStructures: ['main'], nodes: [{ id: 'root', marker: 'demo-root', kind: 'main', order: 1 }] }, analyticsLock: { charts: [] }, designTokens: {}, componentContracts: [{ id: 'root', marker: 'demo-root', kind: 'panel' }] });
  action('visual-reference-compiler.mjs', 'emit', runDir, globalVisualInput);
  // Router state setup here is a fixture; screenshots, interaction traces and
  // source files above were actually produced and validated in the browser.
  const demoState = JSON.parse(fs.readFileSync(stateFile));
  demoState.roleChain.confirmationModel = 'two-confirmations'; demoState.locks.effectApproved = true; demoState.locks.visualApproved = true; demoState.phase = 'G-06 SYNC_FREEZE';
  for (const [key, file] of Object.entries({ designCandidates: 'design-candidates.json' })) { write(file, { testFixture: key }); demoState.artifacts[key] = file; }
  commitRunState(runDir, demoState, { reason: 'interactive-browser-test-fixture' });
  const presentationAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'present_runtime_demo']);
  const presented = run('apex-router.mjs', ['present-runtime-demo', project, runId, session, presentationAuth.authorizationRef, 'real-browser-demo', 'chat-inline']);
  if (presented.nextRequiredDecision?.id !== 'demo-confirmation') throw new Error('real Demo must await explicit user confirmation');
  const confirmed = run('apex-router.mjs', ['confirm-demo', project, runId, session, 'real-browser-confirmation', '确认交互式 Demo']);
  if (confirmed.nextRequiredDecision?.id !== 'delivery-route') throw new Error('real Demo confirmation must bind the actual browser baseline');
  const mobileScreenshot = path.join(runDir, baseline.screenCaptures.find(item => item.id === 'mobile').screenshot.path);
  const originalScreenshot = fs.readFileSync(mobileScreenshot);
  fs.writeFileSync(mobileScreenshot, Buffer.concat([originalScreenshot, Buffer.from('changed')]));
  const stale = run('apex-router.mjs', ['status', project, runId, session]);
  if (stale.nextRequiredAction !== 'revoke_visual' || stale.allowedActions.includes('select_delivery_route')) throw new Error('changed actual viewport screenshot must invalidate the Demo confirmation');
  fs.writeFileSync(mobileScreenshot, originalScreenshot);
  if (process.env.APEX_TEST_DIRECT === '1') {
    run('apex-router.mjs', ['select-route', project, runId, session, 'direct-code', 'actual-direct-route', 'user-selected-direct-code']);
    // This isolates verification; Gate 2 and the production delta are seeded.
    const directState = JSON.parse(fs.readFileSync(stateFile));
    write('fixture-product-strategy.json', { functionalPlan: demoContract.journeys.filter(item => item.kind === 'task').map(item => ({ task: item.task })) });
    directState.artifacts.experienceStrategy = 'fixture-product-strategy.json';
    directState.gates.gate2 = { status: 'passed', evidence: ['test-fixture'] }; directState.locks.implementationAllowed = true; directState.locks.implementationApproved = true; directState.artifacts.pageDelta = 'page-delta.json'; directState.phase = 'G-09 PROOF_IMPLEMENT';
    seedImplementationSeal(directState);
    write('page-delta.json', { status: 'fixture' }); seedImplementationRegistration(directState); commitRunState(runDir, directState, { reason: 'interactive-browser-test-fixture' });
    fs.writeFileSync(mobileScreenshot, Buffer.concat([originalScreenshot, Buffer.from('post-gate-change')]));
    const staleAfterGate = run('apex-router.mjs', ['status', project, runId, session]);
    if (staleAfterGate.nextRequiredAction !== 'revoke_visual' || staleAfterGate.allowedActions.includes('implement') || staleAfterGate.allowedActions.includes('verify')) throw new Error('changed confirmed Demo must revoke post-Gate-2 implementation and verification authority');
    const deniedAfterGate = spawnSync(process.execPath, [path.join(apexRoot, 'scripts/apex-router.mjs'), 'authorize', project, runId, session, 'verify'], { encoding: 'utf8' });
    if (deniedAfterGate.status === 0) throw new Error('stale confirmed Demo must not authorize verify after Gate 2');
    fs.writeFileSync(mobileScreenshot, originalScreenshot);
    const mapFile = path.join(runDir, directState.artifacts.implementationMap), mapBytes = fs.readFileSync(mapFile);
    fs.appendFileSync(mapFile, 'tampered');
    const staleMap = run('apex-router.mjs', ['status', project, runId, session]);
    if (staleMap.nextRequiredAction !== 'recover' || staleMap.allowedActions.includes('implement') || staleMap.allowedActions.includes('verify')) throw new Error('changed sealed implementation map must prevent post-Gate-2 authority');
    fs.writeFileSync(mapFile, mapBytes);
    const sealRef = directState.gates.gate2.evidence.find(ref => ref.startsWith('machine-seals/implementation-'));
    fs.unlinkSync(path.join(runDir, sealRef));
    const missingSeal = run('apex-router.mjs', ['status', project, runId, session]);
    if (missingSeal.nextRequiredAction !== 'recover' || missingSeal.allowedActions.includes('verify')) throw new Error('missing seal must request recovery without new visual confirmation');
    const recoveryAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'recover']);
    run('apex-action.mjs', ['run', project, runId, session, recoveryAuth.authorizationRef, 'recover', 'apex-recover.mjs', runDir]);
    if (!fs.existsSync(path.join(runDir, sealRef))) throw new Error('unchanged sealed artifacts must recover their original seal');
    const captureAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
    run('apex-action.mjs', ['run', project, runId, session, captureAuth.authorizationRef, 'verify', 'browser-capture.mjs', 'capture', runDir, runtime.url, spec]);
    const actualFormalCapture = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence/runtime-browser-capture.json')));
    const formalInteractions = actualFormalCapture.formalInteractions.journeys.map(item => ({ id: item.id, result: 'passed', evidence: item.evidence }));
    validateFormalInteractionEvidence(runDir, JSON.parse(fs.readFileSync(stateFile)), formalInteractions);
    const strategyPath = path.join(runDir, 'fixture-product-strategy.json'), strategyBytes = fs.readFileSync(strategyPath);
    fs.unlinkSync(strategyPath);
    try {
      const missingPlanStatus = run('apex-router.mjs', ['status', project, runId, session]);
      if (missingPlanStatus.executionDirective?.currentStep?.id === 'capture-formal-runtime-source-provenance') throw new Error('missing product plan must not request another browser capture');
      if (missingPlanStatus.nextRequiredAction !== 'recover' && missingPlanStatus.executionDirective?.currentStep?.id !== 'restore-product-plan-evidence') throw new Error('missing product plan must request recovery or plan restoration');
    } finally { fs.writeFileSync(strategyPath, strategyBytes); }
    const absentProductState = JSON.parse(fs.readFileSync(stateFile)); delete absentProductState.artifacts.experienceStrategy;
    try { validateFormalInteractionEvidence(runDir, absentProductState, formalInteractions); throw new Error('missing product plan must fail'); } catch (error) { if (!error.message.includes('current product plan with valid functional tasks is required')) throw error; }
    write('missing-product-task.json', { functionalPlan: [{ task: '未实现的产品任务' }] });
    const missingProductState = JSON.parse(fs.readFileSync(stateFile)); missingProductState.artifacts.experienceStrategy = 'missing-product-task.json';
    try { validateFormalInteractionEvidence(runDir, missingProductState, formalInteractions); throw new Error('missing product task must fail'); } catch (error) { if (!error.message.includes('formal interaction evidence misses confirmed tasks: 未实现的产品任务')) throw error; }
    try { validateFormalInteractionEvidence(runDir, JSON.parse(fs.readFileSync(stateFile)), []); throw new Error('missing confirmed task must fail'); } catch (error) { if (error.message === 'missing confirmed task must fail') throw error; }

    const traceFile = path.join(runDir, formalInteractions[0].evidence), traceBytes = fs.readFileSync(traceFile);
    fs.appendFileSync(traceFile, ' ');
    try { validateFormalInteractionEvidence(runDir, JSON.parse(fs.readFileSync(stateFile)), formalInteractions); throw new Error('changed formal interaction evidence must fail'); } catch (error) { if (error.message === 'changed formal interaction evidence must fail') throw error; }
    fs.writeFileSync(traceFile, traceBytes);
    const repeatAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
    run('apex-action.mjs', ['run', project, runId, session, repeatAuth.authorizationRef, 'verify', 'browser-capture.mjs', 'capture', runDir, runtime.url, spec]);
    const repeated = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence/runtime-browser-capture.json')));
    validateFormalInteractionEvidence(runDir, JSON.parse(fs.readFileSync(stateFile)), repeated.formalInteractions.journeys.map(item => ({ id: item.id, result: 'passed', evidence: item.evidence })));
    if (run('apex-router.mjs', ['status', project, runId, session]).integrity.status !== 'consistent') throw new Error('repeated formal capture must preserve ledger consistency');
    for (const id of ['desktop', 'mobile']) {
      const missing = run('apex-router.mjs', ['status', project, runId, session]);
      if (missing.executionDirective?.currentStep?.id !== 'compile-formal-screen-reference' || !missing.executionDirective.currentStep.details.includes(id)) throw new Error(`Router must request direct reference ${id}: ${JSON.stringify(missing.executionDirective?.currentStep)}`);
      const refInput = write(`direct-reference-${id}.json`, { source: 'runtime-visual-baseline', demoCapture: { kind: 'screen', id }, contentLock: { locale: 'zh-CN', protectedText: ['项目工作台'] }, layoutLock: { mode: 'strict', protectedStructures: ['main'], nodes: [{ id: 'root', marker: 'demo-root', kind: 'main', order: 1 }] }, analyticsLock: { charts: [] }, designTokens: {}, componentContracts: [{ id: 'root', marker: 'demo-root', kind: 'panel' }] });
      const refAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
      run('apex-action.mjs', ['run', project, runId, session, refAuth.authorizationRef, 'verify', 'visual-reference-compiler.mjs', 'emit-screen', runDir, refInput]);
      const pending = run('apex-router.mjs', ['status', project, runId, session]);
      if (pending.executionDirective?.currentStep?.id !== 'verify-formal-direct-screen' || !pending.executionDirective.currentStep.details.includes(id)) throw new Error(`Router must verify direct page ${id}`);
      const parityAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
      run('apex-action.mjs', ['run', project, runId, session, parityAuth.authorizationRef, 'verify', 'strict-replica.mjs', 'runtime', runDir, id]);
    }
    const receipts = fs.readdirSync(path.join(runDir, 'operations')).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(runDir, 'operations', name), 'utf8')));
    const actualState = JSON.parse(fs.readFileSync(stateFile));
    if (formalDirectProgress(runDir, actualState, receipts).status !== 'ready') throw new Error('all direct page comparisons must pass aggregation');
    const key = crypto.createHash('sha256').update('desktop').digest('hex'), evidenceFile = path.join(runDir, 'evidence', 'parity', `implementation-result-${key}.json`), bytes = fs.readFileSync(evidenceFile);
    fs.appendFileSync(evidenceFile, ' ');
    if (formalDirectProgress(runDir, actualState, receipts).status !== 'pending') throw new Error('tampered direct comparison must fail aggregation');
    fs.writeFileSync(evidenceFile, bytes);
    // Isolate the role handoff with a seeded matrix; the interactions and
    // their receipts above came from the real browser capture.
    const roleState = JSON.parse(fs.readFileSync(stateFile));
    roleState.artifacts.runtimeStateMatrix = 'fixture-formal-matrix.json';
    roleState.artifacts.intentBrief = 'fixture-intent.json'; write('fixture-intent.json', { sourceRequest: '测试示例任务和可观察状态变化', successCriteria: ['示例任务可执行'], acceptance: ['状态发生变化'] });
    roleState.artifacts.evidenceProvenance = 'fixture-provenance.json'; write('fixture-provenance.json', { status: 'passed', entries: [{ id: 'fixture-browser', result: 'passed' }] });
    write('fixture-formal-matrix.json', { interactions: repeated.formalInteractions.journeys.map(item => ({ id: item.id, result: 'passed', evidence: item.evidence })) });
    commitRunState(runDir, roleState, { reason: 'test-formal-product-review' });
    const roleAuth = () => run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
    run('apex-action.mjs', ['run', project, runId, session, roleAuth().authorizationRef, 'verify', 'role-advisory.mjs', 'select', runDir, 'verify']);
    const selection = JSON.parse(fs.readFileSync(path.join(runDir, 'advisories/verify/selection.json')));
    if (!selection.selectedRoles.includes('product-manager')) throw new Error('verify must schedule the product role');
    const job = agentRuntimeStatus(runDir).jobs.find(item => item.jobId === selection.agentJobs['product-manager']);
    const claim = run('apex-action.mjs', ['run', project, runId, session, roleAuth().authorizationRef, 'verify', 'agent-runtime.mjs', 'claim', runDir, job.jobId, 'verify', crypto.randomUUID()]);
    if (claim.status !== 'running') throw new Error('product reviewer must claim a running job');
    const productReview = repeated.formalInteractions.journeys.map(item => ({ task: item.task, interactionId: item.id, evidence: item.evidence, expectedOutcome: `示例任务“${item.task}”按合同改变状态`, observedOutcome: item.steps.map(step => `${JSON.stringify(step.before)} → ${JSON.stringify(step.after)}`).join('；'), rationale: '测试夹具中的动作与观察结果对应该示例任务', verdict: 'passed' }));
    const intent = JSON.parse(fs.readFileSync(path.join(runDir, roleState.artifacts.intentBrief)));
    const requirementReview = ['successCriteria','acceptance'].flatMap(source => intent[source].map((criterion,index) => ({ source, index, criterion, verdict:'passed', productTasks:[], implementationTargets:[], evidenceIds:['fixture-browser'], rationale:'合成测试模拟逐项核对浏览器观察结果。', implementationRationale:'合成测试仅检查任务映射与校验流程。' })));
    const requestCoverage = { verdict:'covered', rationale:'合成夹具模拟核对需求记录与产品方案的完整性。', unmappedRequirements:[] };
    const advisory = { schemaVersion: '1.0', roleId: 'product-manager', stage: 'verify', adapterVersion: '1.0.0', inputBindings: selection.inputBindings, findings: [{ id: 'product-observation', classification: 'fact', statement: '正式浏览器执行示例任务并观察到状态变化。', evidence: [roleState.artifacts.runtimeStateMatrix] }], recommendations: [{ id: 'product-result', choice: '确认示例任务的可观察结果。', rationale: '真实交互结果与演示任务一致。', acceptance: ['示例任务状态变化可见。'] }], execution: { inputTokens: 0, outputTokens: 0, usageSource: 'unknown', model: 'browser-fixture', sessionId: job.payload.agentSessionId, skillBindings: job.payload.skillBindings, leaseToken: claim.leaseToken }, status: 'ready', productReview, requirementReview, requestCoverage };
    const reviewInput = write('fixture-product-review.json', advisory);
    run('apex-action.mjs', ['run', project, runId, session, roleAuth().authorizationRef, 'verify', 'role-advisory.mjs', 'record', runDir, 'verify', reviewInput]);
    if (agentRuntimeStatus(runDir, job.jobId).jobs[0].status !== 'succeeded') throw new Error('product review must settle its own durable job');
    for (const roleId of selection.selectedRoles.filter(id => id !== 'product-manager')) {
      const otherJob = agentRuntimeStatus(runDir).jobs.find(item => item.jobId === selection.agentJobs[roleId]);
      const otherClaim = run('apex-action.mjs', ['run', project, runId, session, roleAuth().authorizationRef, 'verify', 'agent-runtime.mjs', 'claim', runDir, otherJob.jobId, 'verify', crypto.randomUUID()]);
      const otherInput = write(`fixture-${roleId}-review.json`, { ...advisory, roleId, productReview: undefined, requirementReview: undefined, requestCoverage: undefined, execution: { ...advisory.execution, sessionId: otherJob.payload.agentSessionId, skillBindings: otherJob.payload.skillBindings, leaseToken: otherClaim.leaseToken } });
      run('apex-action.mjs', ['run', project, runId, session, roleAuth().authorizationRef, 'verify', 'role-advisory.mjs', 'record', runDir, 'verify', otherInput]);
    }
    const summary = run('apex-action.mjs', ['run', project, runId, session, roleAuth().authorizationRef, 'verify', 'role-advisory.mjs', 'summarize', runDir, 'verify']);
    if (!fs.readFileSync(summary.summary, 'utf8').includes('产品任务复核')) throw new Error('verify role summary must retain product task review');
  } else {
  run('apex-router.mjs', ['select-route', project, runId, session, 'stitch', 'actual-stitch-route', 'user-selected-stitch']);
  // A local mock Stitch service serves exports copied from actual browser
  // views; no external Stitch request is made by this acceptance test.
  const digest = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  const screens = baseline.screenCaptures.map(capture => {
    const imageFile = path.join(runDir, `${capture.id}-stitch.png`), htmlFile = path.join(runDir, `${capture.id}-stitch.html`);
    fs.copyFileSync(path.join(runDir, capture.screenshot.path), imageFile); fs.copyFileSync(path.join(runDir, capture.dom.path), htmlFile);
    const url = new URL(capture.url);
    return { screenId: `${capture.id}-stitch`, route: `${url.pathname}${url.search}${url.hash}`, viewport: capture.id === 'desktop' ? 'desktop' : 'mobile', state: 'initial', demoCapture: { kind: 'screen', id: capture.id }, imagePath: path.relative(runDir, imageFile), imageHash: digest(imageFile), htmlPath: path.relative(runDir, htmlFile), htmlHash: digest(htmlFile) };
  });
  const globalVisual = JSON.parse(fs.readFileSync(path.join(runDir, 'visual-reference.json')));
  const freeze = { schemaVersion: '3.0', projectId: 'fixture-project', canvasUrl: 'https://stitch.example/fixture', approval: { id: 'fixture', scope: 'project', approvedAt: new Date().toISOString() }, approvedScreens: screens, excludedScreens: [], fingerprints: { screenSetHash: 'fixture-screen-set', designSystemHash: 'fixture-design-system' }, syncedAt: new Date().toISOString(), generationInput: { mode: 'text', promptHash: 'fixture-prompt', origin: 'apex-visual', references: baseline.screenCaptures.map(item => ({ id: item.id, sha256: item.screenshot.sha256, role: 'layout', fidelity: 'high' })), contentLock: { locale: 'zh-CN', sourceHash: globalVisual.contentLock.hash, protectedText: ['项目工作台'] }, layoutLock: { mode: 'strict', sourceHash: globalVisual.layoutLock.hash, protectedStructures: ['main'] }, analyticsLock: { sourceHash: globalVisual.analyticsLock.hash, charts: [] } } };
  const mockFiles = Object.fromEntries(screens.map(screen => [screen.screenId, { image: path.join(runDir, screen.imagePath), html: path.join(runDir, screen.htmlPath) }]));
  const mockManifest = write('stitch-mock-files.json', mockFiles), portFile = path.join(runDir, 'stitch-mock-port.txt');
  const raceFlag = path.join(runDir, 'stitch-state-race.flag');
  const inputRaceFlag = path.join(runDir, 'stitch-input-race.flag');
  mockServer = spawn(process.execPath, [path.join(apexRoot, 'scripts', 'stitch-mock-server-fixture.mjs'), mockManifest, portFile], { stdio: 'ignore', env: { ...process.env, ...(process.env.APEX_TEST_STITCH_STATE_RACE === '1' ? { APEX_STITCH_STATE_RACE_FLAG: raceFlag, APEX_STITCH_STATE_RACE_RUN: runDir } : {}), ...(process.env.APEX_TEST_STITCH_INPUT_RACE === '1' ? { APEX_STITCH_INPUT_RACE_FLAG: inputRaceFlag, APEX_STITCH_INPUT_RACE_FILE: path.join(runDir, 'stitch-selection.json') } : {}) } });
  for (let attempt = 0; attempt < 100 && !fs.existsSync(portFile); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  if (!fs.existsSync(portFile)) throw new Error('local Stitch fixture server did not start');
  mockEndpoint = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8')}/mcp`;
  const selection = { ...freeze, approvedScreens: screens.map(({ imagePath, imageHash, htmlPath, htmlHash, demoCapture, ...item }) => item) };
  // The ready job is a fixture; the skill is actually loaded through the
  // authorized action and freeze itself uses the local mock Stitch server.
  const skillAuth = () => run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
  const invokeStitch = (...args) => run('apex-action.mjs', ['run', project, runId, session, skillAuth().authorizationRef, 'sync_stitch', 'stitch-sync.mjs', ...args]);
  const taste = invokeStitch('skills', runDir, 'list').skills.find(item => item.name === 'stitch-design-taste');
  let expectedAdaptation = null;
  if (taste) {
    invokeStitch('skills', runDir, 'load', taste.name, taste.sha256);
    const plan = { prompt: 'Preserve the confirmed Demo', skillUse: { name: taste.name, sha256: taste.sha256, appliedRules: ['Preserve the approved hierarchy'], excludedRules: [{ rule: 'Unrequested motion', reason: 'The confirmed Demo does not include it' }], rationale: 'Preserve the approved design' } };
    const prompt = buildStitchPrompt(runDir, JSON.parse(fs.readFileSync(stateFile)), plan);
    expectedAdaptation = prompt.adaptation;
    selection.generationInput.promptHash = `sha256:${crypto.createHash('sha256').update(prompt.prompt).digest('hex')}`;
    write('stitch-job.json', { status: 'ready', screenId: screens[0].screenId, promptHash: selection.generationInput.promptHash, skillAdaptation: expectedAdaptation });
  }
  const selectionFile = write('stitch-selection.json', selection);
  const legacyDownloads = screens.flatMap(screen => ['html.html', 'screenshot.png'].map(name => {
    const file = path.join(runDir, 'evidence', 'stitch', 'screens', screen.screenId, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'previous frozen evidence');
    return file;
  }));
  if (process.env.APEX_TEST_STITCH_STATE_RACE === '1') {
    const freezeFile = path.join(runDir, 'stitch-freeze.json'), previous = fs.existsSync(freezeFile) ? fs.readFileSync(freezeFile) : null;
    fs.writeFileSync(raceFlag, 'inject concurrent state update');
    const racedAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
    const raced = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-action.mjs'), 'run', project, runId, session, racedAuth.authorizationRef, 'sync_stitch', 'stitch-sync.mjs', 'freeze', runDir, selectionFile], { encoding: 'utf8', timeout: 180000, env: { ...process.env, STITCH_HOST: mockEndpoint, STITCH_API_KEY: 'local-fixture-only' } });
    if (raced.status === 0 || !raced.stderr.includes('run state changed during Stitch freeze')) throw new Error(`Stitch freeze must reject a concurrent state change: ${raced.stderr}`);
    if (JSON.parse(fs.readFileSync(stateFile)).artifacts.concurrentFixture !== 'concurrent-marker.json') throw new Error('Stitch freeze must preserve the concurrent state');
    if (previous ? !fs.readFileSync(freezeFile).equals(previous) : fs.existsSync(freezeFile)) throw new Error('stale Stitch freeze must not overwrite the existing freeze');
  }
  if (process.env.APEX_TEST_STITCH_INPUT_RACE === '1') {
    const freezeFile = path.join(runDir, 'stitch-freeze.json'), previous = fs.existsSync(freezeFile) ? fs.readFileSync(freezeFile) : null;
    fs.writeFileSync(inputRaceFlag, 'inject concurrent input update');
    const racedAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
    const raced = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-action.mjs'), 'run', project, runId, session, racedAuth.authorizationRef, 'sync_stitch', 'stitch-sync.mjs', 'freeze', runDir, selectionFile], { encoding: 'utf8', timeout: 180000, env: { ...process.env, STITCH_HOST: mockEndpoint, STITCH_API_KEY: 'local-fixture-only' } });
    if (raced.status === 0 || !raced.stderr.includes('Stitch input changed during remote read')) throw new Error(`Stitch freeze must reject a concurrent input change: ${raced.stderr}`);
    if (previous ? !fs.readFileSync(freezeFile).equals(previous) : fs.existsSync(freezeFile)) throw new Error('stale Stitch input must not overwrite the existing freeze');
  }
  const freezeAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
  run('apex-action.mjs', ['run', project, runId, session, freezeAuth.authorizationRef, 'sync_stitch', 'stitch-sync.mjs', 'freeze', runDir, selectionFile]);
  const frozenStitch = JSON.parse(fs.readFileSync(path.join(runDir, JSON.parse(fs.readFileSync(stateFile)).artifacts.stitchFreeze)));
  if (process.env.APEX_TEST_STITCH_COMMIT_RACE === '1') {
    const previousRef = JSON.parse(fs.readFileSync(stateFile)).artifacts.stitchFreeze;
    const previousFile = path.join(runDir, previousRef), previous = fs.readFileSync(previousFile);
    const flag = path.join(runDir, 'stitch-commit-race.flag'); fs.writeFileSync(flag, 'inject concurrent ledger commit');
    const auth = skillAuth();
    const race = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-action.mjs'), 'run', project, runId, session, auth.authorizationRef, 'sync_stitch', 'stitch-sync.mjs', 'freeze', runDir, selectionFile], { encoding: 'utf8', timeout: 180000, env: { ...process.env, STITCH_HOST: mockEndpoint, STITCH_API_KEY: 'local-fixture-only', NODE_OPTIONS: `--import=${path.join(apexRoot, 'scripts', 'stitch-freeze-commit-race-fixture.mjs')}`, APEX_STITCH_COMMIT_RACE_FLAG: flag, APEX_STITCH_COMMIT_RACE_RUN: runDir } });
    if (race.status === 0 || !race.stderr.includes('run state changed before atomic commit')) throw new Error(`Stitch freeze must reject a last-moment ledger change: ${race.stderr}`);
    const current = JSON.parse(fs.readFileSync(stateFile));
    if (current.artifacts.stitchFreeze !== previousRef || current.artifacts.concurrentFreezeFixture !== 'concurrent-freeze-marker.json' || !fs.readFileSync(previousFile).equals(previous)) throw new Error('failed freeze must preserve the previously committed snapshot and concurrent ledger update');
  }
  if (legacyDownloads.some(file => fs.readFileSync(file, 'utf8') !== 'previous frozen evidence')) throw new Error('Stitch downloads must not overwrite prior frozen evidence');
  if (!invokeStitch('check', runDir).current) throw new Error('unchanged Stitch snapshot must remain current');
  if (expectedAdaptation && JSON.stringify(frozenStitch.skillAdaptation) !== JSON.stringify(expectedAdaptation)) throw new Error('Stitch freeze must preserve the loaded skill adaptation bound to the confirmed Demo and submitted prompt');
  if (frozenStitch.approvedScreens.length !== 2 || !frozenStitch.approvedScreens.every(item => item.demoCapture?.id === item.screenId.replace('-stitch', ''))) throw new Error('Stitch freeze must auto-bind both real Demo captures');
  for (const screen of screens) {
    const id = screen.demoCapture.id;
    const missing = run('apex-router.mjs', ['status', project, runId, session]);
    if (missing.executionDirective?.currentStep?.id !== 'compile-stitch-screen-reference' || !missing.executionDirective.currentStep.details.includes(screen.screenId)) throw new Error(`Router must request the missing reference for ${screen.screenId}`);
    const referenceInput = write(`screen-reference-${id}.json`, { source: 'runtime-visual-baseline', demoCapture: { kind: 'screen', id }, contentLock: { locale: 'zh-CN', protectedText: ['项目工作台'] }, layoutLock: { mode: 'strict', protectedStructures: ['main'], nodes: [{ id: 'root', marker: 'demo-root', kind: 'main', order: 1 }] }, analyticsLock: { charts: [] }, designTokens: {}, componentContracts: [{ id: 'root', marker: 'demo-root', kind: 'panel' }] });
    const auth = run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
    run('apex-action.mjs', ['run', project, runId, session, auth.authorizationRef, 'sync_stitch', 'visual-reference-compiler.mjs', 'emit-screen', runDir, referenceInput]);
    const derivedStatus = run('apex-router.mjs', ['status', project, runId, session]);
    if (derivedStatus.nextRequiredAction === 'revoke_visual' || derivedStatus.nextRequiredDecision?.id === 'demo-confirmation' || derivedStatus.integrity.status !== 'consistent') throw new Error(`derived ${id} reference must preserve the confirmed Demo and ledger consistency`);

    const current = run('apex-router.mjs', ['status', project, runId, session]);
    if (current.executionDirective?.currentStep?.id !== 'verify-stitch-candidate-screen' || !current.executionDirective.currentStep.details.includes(screen.screenId)) throw new Error(`Router must select pending screen ${screen.screenId}`);
    const parityAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
    run('apex-action.mjs', ['run', project, runId, session, parityAuth.authorizationRef, 'sync_stitch', 'strict-replica.mjs', 'stitch', runDir, screen.screenId]);
  }
  const screenIndex = JSON.parse(fs.readFileSync(path.join(runDir, 'visual-screen-references.json')));
  if (screenIndex.entries.length !== 2) throw new Error('both real browser screen references must be retained');
  const ready = run('apex-router.mjs', ['status', project, runId, session]);
  if (ready.executionDirective?.currentStep?.id !== 'seal-unchanged-stitch-candidate' || ready.integrity.status !== 'consistent') throw new Error('all real-screen parity results must advance to machine seal without ledger conflict');
  const firstKey = crypto.createHash('sha256').update(screens[0].screenId).digest('hex');
  const firstEvidence = path.join(runDir, 'evidence', 'parity', `stitch-result-${firstKey}.json`), originalEvidence = fs.readFileSync(firstEvidence);
  fs.appendFileSync(firstEvidence, ' ');
  const tamperedSeal = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-validate.mjs'), 'pre-stitch-machine-seal', runDir], { encoding: 'utf8', timeout: 30000 });
  if (tamperedSeal.status === 0 || !tamperedSeal.stderr.includes('multi-screen Stitch evidence incomplete')) throw new Error('changed screen parity evidence must block the multi-screen seal');
  fs.writeFileSync(firstEvidence, originalEvidence);
  if (process.env.APEX_TEST_STITCH_COMMIT_RACE === '1') {
    const flag = path.join(runDir, 'stitch-seal-race.flag'); fs.writeFileSync(flag, 'inject concurrent ledger commit');
    const auth = skillAuth();
    const race = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'apex-action.mjs'), 'run', project, runId, session, auth.authorizationRef, 'sync_stitch', 'stitch-sync.mjs', 'seal', runDir], { encoding: 'utf8', timeout: 180000, env: { ...process.env, STITCH_HOST: mockEndpoint, STITCH_API_KEY: 'local-fixture-only', NODE_OPTIONS: `--import=${path.join(apexRoot, 'scripts', 'stitch-freeze-commit-race-fixture.mjs')}`, APEX_STITCH_COMMIT_RACE_FLAG: flag, APEX_STITCH_COMMIT_RACE_RUN: runDir, APEX_STITCH_COMMIT_RACE_TARGET: '/machine-seals/stitch-' } });
    if (race.status === 0 || !race.stderr.includes('run state changed before atomic commit')) throw new Error(`Stitch seal must reject a concurrent ledger update: ${race.stderr}`);
    const state = JSON.parse(fs.readFileSync(stateFile));
    if (state.locks.stitchCurrent || state.locks.stitchApproved || state.artifacts.stitchMachineSeal || state.artifacts.concurrentFreezeFixture !== 'concurrent-freeze-marker.json') throw new Error('failed seal must not publish machine approval');
  }
  const sealAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'sync_stitch']);
  const seal = run('apex-action.mjs', ['run', project, runId, session, sealAuth.authorizationRef, 'sync_stitch', 'stitch-sync.mjs', 'seal', runDir]);
  const receipt = JSON.parse(fs.readFileSync(seal.machineSeal));
  if (!seal.sealed || receipt.screens?.length !== 2) throw new Error('machine seal must bind both screen parity records');
  const sealedState = JSON.parse(fs.readFileSync(stateFile));
  if (!stitchMachineSealCurrent(runDir, sealedState)) throw new Error('committed Stitch machine seal must bind the current evidence');
  const sealBytes = fs.readFileSync(seal.machineSeal); fs.appendFileSync(seal.machineSeal, ' ');
  const staleSeal = run('apex-router.mjs', ['status', project, runId, session]);
  if (staleSeal.nextRequiredAction !== 'recover' || staleSeal.allowedActions.includes('compile_visual_bundle')) throw new Error('tampered registered Stitch seal must require integrity recovery');
  fs.writeFileSync(seal.machineSeal, sealBytes);
  const legacyState = JSON.parse(fs.readFileSync(stateFile)), sealRef = legacyState.artifacts.stitchMachineSeal;
  legacyState.artifacts.stitchMachineSeal = null; legacyState.revision += 1; commitRunState(runDir, legacyState, { reason: 'legacy-stitch-seal-fixture' });
  const legacySeal = run('apex-router.mjs', ['status', project, runId, session]);
  if (legacySeal.nextRequiredAction !== 'sync_stitch' || legacySeal.executionDirective?.currentStep?.id !== 'seal-unchanged-stitch-candidate' || !legacySeal.allowedActions.includes('sync_stitch')) throw new Error('missing Stitch seal binding must return to authorized revalidation');
  const restoredState = JSON.parse(fs.readFileSync(stateFile)); restoredState.artifacts.stitchMachineSeal = sealRef; restoredState.revision += 1; commitRunState(runDir, restoredState, { reason: 'restore-stitch-seal-fixture' });
  fs.appendFileSync(firstEvidence, ' ');
  if (stitchMachineSealCurrent(runDir, sealedState)) throw new Error('changed screen parity must invalidate the committed machine seal');
  fs.writeFileSync(firstEvidence, originalEvidence);
  // Isolate formal parity plumbing: Gate 2 and pageDelta are seeded fixtures,
  // while both screenshots and DOM files were captured by the real browser.
  const formalState = JSON.parse(fs.readFileSync(stateFile));
  formalState.gates.gate2 = { status: 'passed', evidence: ['test-fixture'] }; formalState.locks.implementationAllowed = true; formalState.locks.implementationApproved = true; formalState.artifacts.pageDelta = 'page-delta.json'; formalState.phase = 'G-09 PROOF_IMPLEMENT';
  seedImplementationSeal(formalState);
  write('page-delta.json', { status: 'fixture' }); seedImplementationRegistration(formalState); commitRunState(runDir, formalState, { reason: 'interactive-browser-test-fixture' });
  const formalCaptureAuth = run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
  run('apex-action.mjs', ['run', project, runId, session, formalCaptureAuth.authorizationRef, 'verify', 'browser-capture.mjs', 'capture', runDir, runtime.url, spec]);
  for (const screen of screens) {
    const pendingFormal = run('apex-router.mjs', ['status', project, runId, session]);
    if (pendingFormal.executionDirective?.currentStep?.id !== 'verify-formal-stitch-screen' || !pendingFormal.executionDirective.currentStep.details.includes(screen.screenId)) throw new Error(`Router must verify formal screen ${screen.screenId}`);
    const auth = run('apex-router.mjs', ['authorize', project, runId, session, 'verify']);
    const formal = run('apex-action.mjs', ['run', project, runId, session, auth.authorizationRef, 'verify', 'strict-replica.mjs', 'runtime', runDir, screen.demoCapture.id, screen.screenId]);
    const proof = JSON.parse(fs.readFileSync(formal.evidence));
    if (proof.status !== 'passed' || proof.baseline?.screenId !== screen.screenId || proof.baseline.imageHash !== screen.imageHash) throw new Error(`formal comparison must bind the selected Stitch screen ${screen.screenId}`);
  }
  const formalDone = run('apex-router.mjs', ['status', project, runId, session]);
  if (formalDone.executionDirective?.currentStep?.id === 'verify-formal-stitch-screen' || formalDone.integrity.status !== 'consistent') throw new Error('both formal page comparisons must advance without a ledger conflict');
  const formalReceipts = fs.readdirSync(path.join(runDir, 'operations')).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(runDir, 'operations', name), 'utf8')));
  const actualState = JSON.parse(fs.readFileSync(stateFile)), firstFormalKey = crypto.createHash('sha256').update(screens[0].screenId).digest('hex');
  const firstFormal = path.join(runDir, 'evidence', 'parity', `implementation-result-${firstFormalKey}.json`), firstFormalBytes = fs.readFileSync(firstFormal);
  if (formalStitchProgress(runDir, actualState, formalReceipts).status !== 'ready') throw new Error('all real formal comparisons must pass aggregation');
  fs.appendFileSync(firstFormal, ' ');
  if (formalStitchProgress(runDir, actualState, formalReceipts).status !== 'pending') throw new Error('changed formal page evidence must prevent aggregation');
  fs.writeFileSync(firstFormal, firstFormalBytes);




  }
  console.log(JSON.stringify({ status: 'passed', checks: process.env.APEX_TEST_DIRECT === '1' ? 34 : 30, route: process.env.APEX_TEST_DIRECT === '1' ? 'direct-code' : 'stitch', journeys: demo.journeyCount, viewports: 2, runDir, evidence: path.join(runDir, 'evidence/runtime-browser-capture.json') }));
} finally {
  if (mockServer) mockServer.kill('SIGTERM');
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  // Retain this bounded, isolated Run for inspecting actual DOM/screenshots.
}
