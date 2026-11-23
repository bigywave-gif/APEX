#!/usr/bin/env node
import { apexRoot, canonicalApexRoot, globalBridge } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const sourceBridge = path.join(apexRoot, 'runtime/host-bridges/codex-skill/SKILL.md');
const bridgeSync = path.join(apexRoot, 'scripts', 'sync-codex-bridge.mjs');
const versionManager = path.join(apexRoot, 'scripts', 'apex-release-version.mjs');
const pdfGenerator = path.join(apexRoot, 'scripts', 'generate-public-pdf.py');
const python = process.env.APEX_PYTHON || 'python3';
const results = [];
const auditStartedAt = new Date().toISOString();
const auditProgress = path.join(apexRoot, 'release-audit-progress.json');
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function check(id, pass, detail) { return { id, status: pass ? 'passed' : 'failed', detail }; }
function files(dir, filter, output = []) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) files(file, filter, output); else if (filter(file)) output.push(file); } return output; }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) { console.error(`Release audit must run from canonical root: ${canonicalApexRoot}`); process.exit(1); }
function writeProgress() {
  fs.writeFileSync(auditProgress, `${JSON.stringify({ schemaVersion: '1.0', status: 'running', startedAt: auditStartedAt, updatedAt: new Date().toISOString(), completedChecks: results.length, checks: results }, null, 2)}\n`);
}
writeProgress();
const appendResult = results.push.bind(results);
results.push = (...entries) => {
  const length = appendResult(...entries);
  writeProgress();
  return length;
};
const progressTimer = setInterval(writeProgress, 1000);
progressTimer.unref();
// Auditing must not create a release or advance the version before checks pass.
const versionResult = spawnSync(process.execPath, [versionManager, 'analyze'], { encoding: 'utf8' });
results.push(check('release-version', versionResult.status === 0, (versionResult.stderr || versionResult.stdout || 'version policy analyzed').trim()));
try {
  const analysis = JSON.parse(versionResult.stdout || '{}');
  const baseline = JSON.parse(fs.readFileSync(path.join(apexRoot, 'registry', 'release-baseline.json'), 'utf8'));
  const current = versionResult.status === 0 && analysis.status === 'analyzed' && Array.isArray(analysis.changed) && analysis.changed.length === 0 && baseline.version === analysis.current;
  results.push(check('release-baseline-current', current, current ? `release baseline matches ${analysis.current}` : `release baseline does not match current version or files: baseline=${baseline.version || 'missing'}, current=${analysis.current || 'missing'}, changed=${Array.isArray(analysis.changed) ? analysis.changed.length : 'unknown'}; finalize the release baseline after the intended release candidate is verified`));
} catch (error) { results.push(check('release-baseline-current', false, `release baseline could not be verified: ${error.message}`)); }
const bridgeSyncResult = spawnSync(process.execPath, [bridgeSync], { encoding: 'utf8' });
results.push(check('global-bridge-published', bridgeSyncResult.status === 0, (bridgeSyncResult.stderr || bridgeSyncResult.stdout || 'ok').trim()));
const manifest = fs.existsSync(path.join(apexRoot, 'manifest.yaml')) ? fs.readFileSync(path.join(apexRoot, 'manifest.yaml'), 'utf8') : '';
const manifestSemver = manifest.match(/^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*$/m)?.[1] || null;
results.push(check('manifest-semver', Boolean(manifestSemver), 'manifest version must be a valid semantic version'));
const manifestYaml = spawnSync('ruby', ['-ryaml', '-e', 'YAML.load_file(ARGV.fetch(0));', path.join(apexRoot, 'manifest.yaml')], { encoding: 'utf8' });
results.push(check('manifest-yaml', manifestYaml.status === 0, (manifestYaml.stderr || manifestYaml.stdout || 'manifest is valid YAML').trim()));
const manifestPaths = spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'doc = YAML.load_file(ARGV.fetch(0)); paths = doc.fetch("entrypoints", {}).values + doc.fetch("connectors", []) + doc.fetch("adapters", []); puts JSON.generate(paths)', path.join(apexRoot, 'manifest.yaml')], { encoding: 'utf8' });
try {
  const missing = JSON.parse(manifestPaths.stdout || '[]').filter(entrypoint => !fs.existsSync(path.join(apexRoot, entrypoint)));
  results.push(check('manifest-entrypoints', manifestPaths.status === 0 && missing.length === 0, missing.length ? `missing manifest paths: ${missing.join(', ')}` : `${JSON.parse(manifestPaths.stdout || '[]').length} manifest paths present`));
} catch (error) { results.push(check('manifest-entrypoints', false, (manifestPaths.stderr || error.message).trim())); }
results.push(check('global-bridge-present', fs.existsSync(globalBridge), globalBridge));
results.push(check('global-bridge-synchronized', fs.existsSync(globalBridge) && hash(globalBridge) === hash(sourceBridge), 'global bridge must equal canonical bridge'));
const publicPdf = path.join(apexRoot, 'output', 'pdf', 'APEX-Product-Design-and-Technical-Architecture.pdf');
const pdfBuild = spawnSync(python, [pdfGenerator], { encoding: 'utf8' });
results.push(check('public-pdf-generated', pdfBuild.status === 0 && fs.existsSync(publicPdf), (pdfBuild.stderr || pdfBuild.stdout || 'public PDF generated').trim()));
const manifestVersion = manifest.match(/^version:\s*([^\s#]+)/m)?.[1]?.replace(/["']/g, '') || 'unknown';
const pdfMetadata = spawnSync(python, ['-c', 'from pypdf import PdfReader; import sys; print(PdfReader(sys.argv[1]).metadata.get("/Subject", ""))', publicPdf], { encoding: 'utf8' });
results.push(check('public-pdf-version', pdfMetadata.status === 0 && pdfMetadata.stdout.includes(`APEX 版本 ${manifestVersion}`), (pdfMetadata.stderr || pdfMetadata.stdout || 'PDF metadata must contain manifest version').trim()));
const pdfRenderDirectory = fs.mkdtempSync(path.join('/tmp', 'apex-public-pdf-render-'));
const pdftoppmLookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pdftoppm'], { encoding: 'utf8' });
const pdftoppm = process.env.APEX_PDFTOPPM || pdftoppmLookup.stdout.trim() || 'pdftoppm';
const pdfRender = spawnSync(pdftoppm, ['-f', '1', '-l', '1', '-png', '-r', '72', publicPdf, path.join(pdfRenderDirectory, 'page')], { encoding: 'utf8' });
const renderedPage = path.join(pdfRenderDirectory, 'page-01.png');
results.push(check('public-pdf-renderable', pdfRender.status === 0 && fs.existsSync(renderedPage) && fs.statSync(renderedPage).size > 4096, (pdfRender.stderr || pdfRender.stdout || 'portable PDF first page rendered').trim()));
fs.rmSync(pdfRenderDirectory, { recursive: true, force: true });
const capabilityRegistryFile = path.join(apexRoot, 'registry', 'capability-registry.json');
try {
  const registry = JSON.parse(fs.readFileSync(capabilityRegistryFile, 'utf8'));
  const missing = (registry.capabilities || []).filter(item => !item.entrypoint || !fs.existsSync(path.join(apexRoot, item.entrypoint))).map(item => item.id);
  results.push(check('capability-registry', missing.length === 0, missing.length ? `missing capability entrypoints: ${missing.join(', ')}` : `${registry.capabilities.length} capability entrypoints present`));
} catch (error) { results.push(check('capability-registry', false, error.message)); }
const guardedActionScripts = {
  analyze_requirement: ['experience-evaluator.mjs', 'contract-recorder.mjs', 'role-advisory.mjs', 'agent-runtime.mjs'],
  plan_visual: ['visual-execution-plan.mjs', 'motion-capability.mjs', 'asset-resolver.mjs', 'role-advisory.mjs', 'agent-runtime.mjs'],
  generate_visual: ['demo-source-compiler.mjs', 'visual-sandbox-writer.mjs', 'visual-sandbox-runtime.mjs', 'browser-capture.mjs', 'runtime-visual-baseline.mjs', 'visual-reference-compiler.mjs', 'visual-sandbox-dependency.mjs', 'experience-evaluator.mjs'],
  'collect_existing_baseline': ['project-intake.mjs', 'existing-code-reference.mjs', 'baseline-collector.mjs', 'browser-capture.mjs', 'role-advisory.mjs', 'agent-runtime.mjs'],
  'sync_stitch': ['stitch-sync.mjs', 'stitch-ui-importer.mjs', 'strict-replica.mjs', 'confirmation-presentation.mjs'],
  observe_stitch: ['stitch-sync.mjs'],
  validate_stitch: ['strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs'],
  'prepare_workspace': ['apex-workspace.mjs'],
  'compile_visual_bundle': ['visual-reference-compiler.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'bundle-compiler.mjs', 'asset-resolver.mjs', 'asset-materializer.mjs', 'experience-evaluator.mjs', 'motion-contract.mjs', 'motion-capability.mjs', 'visual-source.mjs', 'role-advisory.mjs', 'contract-recorder.mjs', 'confirmation-presentation.mjs', 'agent-runtime.mjs'],
  implement: ['asset-materializer.mjs', 'runtime-materializer.mjs'],
  verify: ['browser-capture.mjs', 'strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'implementation-audit.mjs', 'asset-materializer.mjs', 'runtime-materializer.mjs', 'verification-planner.mjs', 'verification-orchestrator.mjs', 'contract-verifier.mjs', 'quality-measurement.mjs', 'quality-evidence.mjs', 'trajectory-evaluator.mjs', 'stability-evidence.mjs', 'motion-contract.mjs', 'three-d-evidence.mjs', 'industry-benchmark.mjs', 'role-advisory.mjs', 'agent-runtime.mjs'],
  'record_context': ['contract-recorder.mjs', 'context-compiler.mjs', 'evidence-provenance.mjs'],
  recover: ['apex-recover.mjs', 'run-migrate.mjs']
};
for (const [action, scripts] of Object.entries(guardedActionScripts)) {
  const missingGuards = scripts.filter(script => {
    const source = fs.readFileSync(path.join(apexRoot, 'scripts', script), 'utf8');
    return !source.includes('requireRouterAction') || !source.includes(`'${action}'`);
  });
  results.push(check(`router-guard:${action}`, missingGuards.length === 0, missingGuards.length ? `missing matching Router guard for ${action}: ${missingGuards.join(', ')}` : `${scripts.length} scripts guarded for ${action}`));
}
const guardedScriptPattern = /node scripts\/(?:runtime-visual-baseline|runtime-materializer|visual-reference-compiler|visual-source|stitch-sync|stitch-ui-importer|strict-replica|browser-capture|structure-contract|visual-parity|asset-resolver|asset-materializer|bundle-compiler|motion-contract|motion-capability|context-compiler|verification-orchestrator|project-intake|existing-code-reference|baseline-collector|verification-planner|contract-verifier|quality-evidence|implementation-audit|contract-recorder|apex-recover|apex-workspace|trajectory-evaluator|experience-evaluator|stability-evidence)\.mjs/;
const documentationFiles = files(apexRoot, file => file.endsWith('.md'));
const obsoleteDirectCommands = documentationFiles.filter(file => guardedScriptPattern.test(fs.readFileSync(file, 'utf8'))).map(file => path.relative(apexRoot, file));
results.push(check('documentation-router-path', obsoleteDirectCommands.length === 0, obsoleteDirectCommands.length ? `direct guarded commands documented in: ${obsoleteDirectCommands.join(', ')}` : 'no direct guarded runtime commands documented'));
const brokenDocumentationLinks = [];
for (const file of documentationFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (!target || /^(?:https?:|mailto:|#|<)/.test(target) || target.includes('://')) continue;
    const localTarget = target.split('#')[0];
    if (localTarget && !fs.existsSync(path.resolve(path.dirname(file), localTarget))) brokenDocumentationLinks.push(`${path.relative(apexRoot, file)} -> ${target}`);
  }
}
results.push(check('documentation-links', brokenDocumentationLinks.length === 0, brokenDocumentationLinks.length ? `broken links: ${brokenDocumentationLinks.slice(0, 20).join(', ')}` : `${documentationFiles.length} Markdown files have resolvable local links`));
const publicDocumentationFiles = documentationFiles.filter(file => !path.relative(apexRoot, file).startsWith(`adapters${path.sep}student-system${path.sep}`));
const privateReferences = publicDocumentationFiles.filter(file => /\/Users\/fredyw|adapters\/student-system/.test(fs.readFileSync(file, 'utf8'))).map(file => path.relative(apexRoot, file));
results.push(check('public-documentation-portability', privateReferences.length === 0, privateReferences.length ? `private or maintainer references remain: ${privateReferences.join(', ')}` : 'public documentation contains no maintainer path or private adapter reference'));
for (const file of files(path.join(apexRoot, 'scripts'), file => file.endsWith('.mjs'))) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); results.push(check(`syntax:${path.basename(file)}`, result.status === 0, (result.stderr || result.stdout || 'ok').trim())); }
for (const file of files(path.join(apexRoot, 'core/runtime/schemas'), file => file.endsWith('.json'))) { try { JSON.parse(fs.readFileSync(file, 'utf8')); results.push(check(`json:${path.basename(file)}`, true, 'valid JSON')); } catch (error) { results.push(check(`json:${path.basename(file)}`, false, error.message)); } }
const routerContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'router-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('router-contract', routerContract.status === 0, (routerContract.stderr || routerContract.stdout || 'ok').trim()));
// v4.45 workflow regressions are release checks, not optional local commands.
// Browser/end-to-end acceptance remains separately reported and is not
// inferred from these focused contracts.
for (const [name, script] of [
  ['default-confirmation-contract', 'default-confirmation-contract-test.mjs'],
  ['combined-plan-contract', 'combined-plan-contract-test.mjs'],
  ['implementation-seal-contract', 'implementation-seal-test.mjs'],
  ['agent-concurrency-contract', 'agent-concurrency-contract-test.mjs'],
  ['run-ledger-init-race', 'run-ledger-init-race-test.mjs'],
  ['cancelled-operation-finalizer', 'cancelled-operation-finalizer-test.mjs'],
  ['controlled-subprocess', 'controlled-subprocess-test.mjs'],
  ['operation-recovery', 'operation-recovery-test.mjs'],
  ['ledger-marker', 'ledger-marker-test.mjs'],
  ...(process.platform === 'win32' ? [] : [['cancelled-action-race', 'cancelled-action-race-test.mjs']]),
  ['agent-attempt-usage-contract', 'agent-attempt-usage-test.mjs'],
  ['release-version-cache-contract', 'release-version-cache-test.mjs'],
  ['budget-recovery-router-contract', 'budget-recovery-router-test.mjs'],
  ['agent-budget-reservation-contract', 'agent-budget-reservation-test.mjs'],
  ['run-metrics-contract', 'run-metrics-test.mjs'],
  ['adapter-coverage-status', 'adapter-coverage-status-test.mjs'],
  ['design-contract-evidence', 'design-contract-evidence-test.mjs'],
  ['role-summary-binding', 'role-summary-binding-test.mjs'],
  ['bridge-confirmation-contract', 'bridge-confirmation-contract-test.mjs'],
  ['product-to-visual-handoff', 'product-to-visual-handoff-test.mjs'],
  ['implementation-registration-contract', 'implementation-registration-contract-test.mjs'],
  ['responsive-evidence', 'responsive-evidence-test.mjs'],
  ['verification-policy', 'verification-policy-test.mjs'],
  ['api-sample-schema', 'api-sample-schema-test.mjs'],
  ['api-contract-evidence', 'api-contract-evidence-test.mjs'],
  ['quality-measurement', 'quality-measurement-test.mjs'],
  ['quality-workflow', 'quality-workflow-test.mjs'],
  ['industry-review-progress', 'industry-review-progress-test.mjs'],
  ['visual-quality-evidence', 'visual-quality-evidence-test.mjs'],
  ['implementation-coverage-contract', 'implementation-coverage-test.mjs'],
  ['formal-route-coverage-contract', 'formal-route-coverage-test.mjs'],
  ['formal-task-coverage-contract', 'formal-task-coverage-test.mjs'],
  ['runtime-baseline-contract', 'runtime-baseline-contract-test.mjs'],
  ['stitch-screen-binding-contract', 'stitch-screen-binding-test.mjs'],
  ['external-submission-intent', 'external-submission-intent-test.mjs'],
  ['external-submission-concurrency', 'external-submission-concurrency-test.mjs'],
  ['project-external-registry', 'project-external-registry-test.mjs'],
  ['stitch-upload-contract', 'stitch-upload-contract-test.mjs'],
  ['stitch-adaptation', 'stitch-adaptation-test.mjs'],
  ['stitch-submission-contract', 'stitch-submission-contract-test.mjs']
]) {
  const result = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', script)], { encoding: 'utf8', timeout: 120000 });
  results.push(check(name, result.status === 0, (result.stderr || result.stdout || result.error?.message || 'no output').trim()));
}
const lifecycleHookContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'codex-lifecycle-hook-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('codex-lifecycle-hook-contract', lifecycleHookContract.status === 0, (lifecycleHookContract.stderr || lifecycleHookContract.stdout || 'ok').trim()));
const roleAdvisoryContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'role-advisory-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('role-advisory-contract', roleAdvisoryContract.status === 0, (roleAdvisoryContract.stderr || roleAdvisoryContract.stdout || 'ok').trim()));
const roleQualityAudit = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'role-quality-evaluator.mjs'), 'audit'], { encoding: 'utf8' });
results.push(check('role-quality-evaluation', roleQualityAudit.status === 0, (roleQualityAudit.stderr || roleQualityAudit.stdout || 'ok').trim()));
const runLedgerContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'run-ledger-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('run-ledger-contract', runLedgerContract.status === 0, (runLedgerContract.stderr || runLedgerContract.stdout || 'ok').trim()));
const agentRuntimeContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'agent-runtime-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('agent-runtime-contract', agentRuntimeContract.status === 0, (agentRuntimeContract.stderr || agentRuntimeContract.stdout || 'ok').trim()));
const visualSkillContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'required-visual-skill-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('required-visual-skill-contract', visualSkillContract.status === 0, (visualSkillContract.stderr || visualSkillContract.stdout || 'ok').trim()));
const visualRoleSkillIntegration = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'visual-role-skill-integration-test.mjs')], { encoding: 'utf8' });
results.push(check('visual-role-skill-integration', visualRoleSkillIntegration.status === 0, (visualRoleSkillIntegration.stderr || visualRoleSkillIntegration.stdout || 'ok').trim()));
const preflightContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'preflight-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('preflight-contract', preflightContract.status === 0, (preflightContract.stderr || preflightContract.stdout || 'ok').trim()));
const sandboxWriterContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'visual-sandbox-writer-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('visual-sandbox-writer-contract', sandboxWriterContract.status === 0, (sandboxWriterContract.stderr || sandboxWriterContract.stdout || 'ok').trim()));
const sandboxRuntimeContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'visual-sandbox-runtime-contract-test.mjs')], { encoding: 'utf8', timeout: 30000 });
results.push(check('visual-sandbox-runtime-contract', sandboxRuntimeContract.status === 0, (sandboxRuntimeContract.stderr || sandboxRuntimeContract.stdout || 'ok').trim()));
const interactiveDemoContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'interactive-demo-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('interactive-demo-contract', interactiveDemoContract.status === 0, (interactiveDemoContract.stderr || interactiveDemoContract.stdout || 'ok').trim()));
const demoSourceCompilerContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'demo-source-compiler-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('demo-source-compiler-contract', demoSourceCompilerContract.status === 0, (demoSourceCompilerContract.stderr || demoSourceCompilerContract.stdout || 'ok').trim()));
const runtimeBaselineContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'runtime-visual-baseline-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('runtime-visual-baseline-contract', runtimeBaselineContract.status === 0, (runtimeBaselineContract.stderr || runtimeBaselineContract.stdout || 'ok').trim()));
const visualSourceContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'visual-source-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('visual-source-contract', visualSourceContract.status === 0, (visualSourceContract.stderr || visualSourceContract.stdout || 'ok').trim()));
const assetMaterializerContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'asset-materializer-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('asset-materializer-contract', assetMaterializerContract.status === 0, (assetMaterializerContract.stderr || assetMaterializerContract.stdout || 'ok').trim()));
const runtimeMaterializerContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'runtime-materializer-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('runtime-materializer-contract', runtimeMaterializerContract.status === 0, (runtimeMaterializerContract.stderr || runtimeMaterializerContract.stdout || 'ok').trim()));
const scopeBoundaryContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'scope-boundary-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('scope-boundary-contract', scopeBoundaryContract.status === 0, (scopeBoundaryContract.stderr || scopeBoundaryContract.stdout || 'ok').trim()));
const portableInstallContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'portable-install-contract-test.mjs')], { encoding: 'utf8', timeout: 120000 });
results.push(check('portable-install-contract', portableInstallContract.status === 0, (portableInstallContract.stderr || portableInstallContract.stdout || 'ok').trim()));
const preflightCheck = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'preflight.mjs'), '--json'], { encoding: 'utf8' });
let preflightReady = false;
let preflightDetail = (preflightCheck.stderr || preflightCheck.stdout || 'no preflight output').trim();
if (preflightCheck.status === 0) {
  try {
    const preflight = JSON.parse(preflightCheck.stdout);
    const invalidSkill = (preflight.required || []).find(item => item.status !== 'ready' || (item.expectedContentHash && item.sourceHashStatus !== 'matched'));
    preflightReady = preflight.status === 'ready' && !invalidSkill;
    preflightDetail = preflightReady ? `${(preflight.required || []).length} host Skills are source-locked and ready` : `preflight=${preflight.status}; invalidSkill=${invalidSkill?.name || 'unknown'}`;
  } catch (error) { preflightDetail = `invalid preflight JSON: ${error.message}`; }
}
results.push(check('preflight-source-lock', preflightReady, preflightDetail));
results.push(check('package-manifest', fs.existsSync(path.join(apexRoot, 'package.json')), 'package.json must expose install, preflight, test and release audit commands'));
results.push(check('executable-preflight', fs.existsSync(path.join(apexRoot, 'scripts', 'preflight.mjs')), 'scripts/preflight.mjs must be present'));
results.push(check('codex-lifecycle-hooks', fs.existsSync(path.join(apexRoot, 'scripts', 'codex-stop-continuation.mjs')) && fs.existsSync(path.join(apexRoot, 'scripts', 'install-codex-stop-hook.mjs')) && fs.existsSync(path.join(apexRoot, 'scripts', 'codex-pretool-session-refresh.mjs')) && fs.existsSync(path.join(apexRoot, 'scripts', 'install-codex-session-refresh-hook.mjs')), 'APEX must ship the Codex Stop continuation and PreToolUse session refresh hooks with installers'));
results.push(check('host-skill-dependencies', fs.existsSync(path.join(apexRoot, 'registry', 'host-skill-dependencies.json')), 'required host Skills must have machine-readable sources and install commands'));
results.push(check('resolver-support', fs.existsSync(path.join(apexRoot, 'registry', 'assets', 'resolver-support.json')), 'resolver support levels must be machine-readable'));
results.push(check('license-declaration', ['LICENSE', 'LICENSE.md', 'COPYING'].some(file => fs.existsSync(path.join(apexRoot, file))), 'public distribution must declare its license before release'));
const maintainerPath = path.join(path.sep, 'Users', 'fredyw');
const hardCodedScripts = files(path.join(apexRoot, 'scripts'), file => file.endsWith('.mjs') && fs.readFileSync(file, 'utf8').includes(maintainerPath)).map(file => path.relative(apexRoot, file));
results.push(check('portable-script-paths', hardCodedScripts.length === 0, hardCodedScripts.length ? `maintainer paths remain: ${hardCodedScripts.join(', ')}` : 'no maintainer-specific script paths'));
clearInterval(progressTimer);
const report = { schemaVersion: '3.0', auditedAt: new Date().toISOString(), status: results.every(item => item.status === 'passed') ? 'passed' : 'failed', checks: results };
const output = path.join(apexRoot, 'release-audit.json'); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ report: output, status: report.status, failed: results.filter(item => item.status === 'failed').map(item => item.id) })); if (report.status !== 'passed') process.exitCode = 2;
fs.rmSync(auditProgress, { force: true });
