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
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function check(id, pass, detail) { return { id, status: pass ? 'passed' : 'failed', detail }; }
function files(dir, filter, output = []) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) files(file, filter, output); else if (filter(file)) output.push(file); } return output; }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) { console.error(`Release audit must run from canonical root: ${canonicalApexRoot}`); process.exit(1); }
const results = [];
const versionResult = spawnSync(process.execPath, [versionManager, 'apply'], { encoding: 'utf8' });
results.push(check('release-version', versionResult.status === 0, (versionResult.stderr || versionResult.stdout || 'version policy applied').trim()));
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
const publicPdf = path.join(apexRoot, 'output', 'pdf', 'APEX-3.0-Product-Design-and-Technical-Architecture.pdf');
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
  analyze_requirement: ['experience-evaluator.mjs'],
  generate_visual: ['visual-sandbox-writer.mjs', 'browser-capture.mjs', 'runtime-visual-baseline.mjs', 'visual-reference-compiler.mjs', 'visual-sandbox-dependency.mjs', 'experience-evaluator.mjs'],
  'collect_existing_baseline': ['project-intake.mjs', 'existing-code-reference.mjs', 'baseline-collector.mjs', 'browser-capture.mjs'],
  'sync_stitch': ['stitch-sync.mjs', 'stitch-ui-importer.mjs', 'strict-replica.mjs'],
  observe_stitch: ['stitch-sync.mjs'],
  validate_stitch: ['strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs'],
  'prepare_workspace': ['apex-workspace.mjs'],
  'compile_visual_bundle': ['visual-reference-compiler.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'bundle-compiler.mjs', 'asset-resolver.mjs', 'asset-materializer.mjs', 'experience-evaluator.mjs', 'motion-contract.mjs', 'motion-capability.mjs', 'visual-source.mjs'],
  implement: ['asset-materializer.mjs', 'runtime-materializer.mjs'],
  verify: ['browser-capture.mjs', 'strict-replica.mjs', 'structure-contract.mjs', 'visual-parity.mjs', 'implementation-audit.mjs', 'asset-materializer.mjs', 'runtime-materializer.mjs', 'verification-planner.mjs', 'verification-orchestrator.mjs', 'contract-verifier.mjs', 'quality-evidence.mjs', 'trajectory-evaluator.mjs', 'stability-evidence.mjs', 'motion-contract.mjs'],
  'record_context': ['contract-recorder.mjs', 'context-compiler.mjs'],
  recover: ['apex-recover.mjs']
};
for (const [action, scripts] of Object.entries(guardedActionScripts)) {
  const missingGuards = scripts.filter(script => !fs.readFileSync(path.join(apexRoot, 'scripts', script), 'utf8').includes('requireRouterAction'));
  results.push(check(`router-guard:${action}`, missingGuards.length === 0, missingGuards.length ? `missing requireRouterAction: ${missingGuards.join(', ')}` : `${scripts.length} scripts guarded`));
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
const sandboxWriterContract = spawnSync(process.execPath, [path.join(apexRoot, 'scripts', 'visual-sandbox-writer-contract-test.mjs')], { encoding: 'utf8' });
results.push(check('visual-sandbox-writer-contract', sandboxWriterContract.status === 0, (sandboxWriterContract.stderr || sandboxWriterContract.stdout || 'ok').trim()));
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
results.push(check('package-manifest', fs.existsSync(path.join(apexRoot, 'package.json')), 'package.json must expose install, preflight, test and release audit commands'));
results.push(check('executable-preflight', fs.existsSync(path.join(apexRoot, 'scripts', 'preflight.mjs')), 'scripts/preflight.mjs must be present'));
results.push(check('host-skill-dependencies', fs.existsSync(path.join(apexRoot, 'registry', 'host-skill-dependencies.json')), 'required host Skills must have machine-readable sources and install commands'));
results.push(check('resolver-support', fs.existsSync(path.join(apexRoot, 'registry', 'assets', 'resolver-support.json')), 'resolver support levels must be machine-readable'));
results.push(check('license-declaration', ['LICENSE', 'LICENSE.md', 'COPYING'].some(file => fs.existsSync(path.join(apexRoot, file))), 'public distribution must declare its license before release'));
const maintainerPath = path.join(path.sep, 'Users', 'fredyw');
const hardCodedScripts = files(path.join(apexRoot, 'scripts'), file => file.endsWith('.mjs') && fs.readFileSync(file, 'utf8').includes(maintainerPath)).map(file => path.relative(apexRoot, file));
results.push(check('portable-script-paths', hardCodedScripts.length === 0, hardCodedScripts.length ? `maintainer paths remain: ${hardCodedScripts.join(', ')}` : 'no maintainer-specific script paths'));
const report = { schemaVersion: '3.0', auditedAt: new Date().toISOString(), status: results.every(item => item.status === 'passed') ? 'passed' : 'failed', checks: results };
const output = path.join(apexRoot, 'release-audit.json'); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ report: output, status: report.status, failed: results.filter(item => item.status === 'failed').map(item => item.id) })); if (report.status !== 'passed') process.exitCode = 2;
