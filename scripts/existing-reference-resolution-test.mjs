import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newlyAvailableResources, resourceCoverage, assertResourceCoverage } from './existing-resource-freshness.mjs';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-reference-resolution-'));
const run = 'resolution', session = 'resolution-session', dir = path.join(project, '.apex', 'runs', run);
function put(name, text) { const file = path.join(project, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function call(script, args) { const result = spawnSync(process.execPath, [path.join(core, 'scripts', script), ...args], { encoding: 'utf8', timeout: 30000 }); assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`); return JSON.parse(result.stdout); }
function action(script, args) { const auth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']); return call('apex-action.mjs', ['run', project, run, session, auth.authorizationRef, 'collect_existing_baseline', script, ...args]); }
try {
  put('package.json', JSON.stringify({ workspaces: ['packages/*'] }));
  put('tsconfig.json', '{ /* alias config */ "compilerOptions": { "baseUrl": ".", "paths": { "~*": ["./src/*",], }, }, }');
  put('index.html', '<main>Fixture<img src="/hero.png"></main><link rel="stylesheet" href="/style.css"><script src="/main.js"></script>');
  put('public/style.css', 'body { background: url("/logo.svg"), url("/late.png"), url("data:image/svg+xml,example") }'); put('public/main.js', "import '../src/main.js';");
  put('public/hero.png', 'fixture image'); put('public/logo.svg', '<svg></svg>');
  put('src/main.ts', "import './App.js'; import Button from '~components/Button.vue'; import {ui} from '@fixture/ui';\n");
  put('src/App.tsx', 'export const App = () => <main>Fixture</main>;');
  put('src/components/Button.vue', '<template><button>Original</button></template><script src="./button.ts"></script><style>@import "~shared.css";</style>');
  put('src/components/button.ts', 'export const button = true;');
  put('src/shared.css', 'button { color: red }');
  put('packages/ui/package.json', JSON.stringify({ name: '@fixture/ui', exports: { '.': { import: './dist/index.js' } } }));
  put('packages/ui/tsconfig.json', JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } }));
  put('packages/ui/src/index.ts', "export { ui } from './implementation.js';");
  put('packages/ui/src/implementation.ts', 'export const ui = true;');
  call('apex-router.mjs', ['intake', project, run, 'existing', 'standard', 'interactive', session, '确认调用 APEX']);
  action('project-intake.mjs', ['scan', dir, project]);
  const scope = path.join(dir, 'scope.json'); fs.writeFileSync(scope, JSON.stringify({ routes: ['/'], codeEntrypoints: ['index.html'] }));
  const capture = () => action('existing-code-reference.mjs', ['capture', dir, project, scope]);
  capture();
  const paths = () => new Set(JSON.parse(fs.readFileSync(path.join(dir, 'code-reference.json'))).files.map(item => item.path));
  for (const expected of ['public/style.css', 'public/main.js', 'public/hero.png', 'public/logo.svg', 'src/main.ts', 'src/App.tsx', 'src/components/Button.vue', 'src/components/button.ts', 'src/shared.css', 'packages/ui/src/index.ts', 'packages/ui/src/implementation.ts', 'tsconfig.json', 'package.json', 'packages/ui/package.json', 'packages/ui/tsconfig.json']) assert.ok(paths().has(expected), expected);
  const initial = JSON.parse(fs.readFileSync(path.join(dir, 'code-reference.json')));
  assert.deepEqual(initial.unresolvedResources.map(item => item.reference), ['/late.png']);
  assert.deepEqual(resourceCoverage(initial), { status: 'unverified', unresolvedCount: 1 });
  assert.deepEqual(assertResourceCoverage(initial, { codeReference: { resourceCoverage: resourceCoverage(initial) } }), { status: 'unverified', unresolvedCount: 1 });
  assert.throws(() => assertResourceCoverage(initial, { codeReference: { resourceCoverage: { status: 'no-unresolved-detected', unresolvedCount: 0 } } }), /does not match/);
  assert.equal(resourceCoverage({}).status, 'not-recorded');
  // Synthetic display evidence exercises metadata propagation only; browser acceptance is tested separately.
  const digest = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  const screenshot = path.join(dir, 'evidence', 'fixture.png'); fs.writeFileSync(screenshot, 'fixture');
  const skeleton = JSON.parse(fs.readFileSync(path.join(dir, 'page-skeleton.json')));
  fs.writeFileSync(path.join(dir, 'evidence', 'existing-browser-capture.json'), JSON.stringify({ kind: 'existing', status: 'passed', evidence: [{ status: 'captured', screenshot: 'evidence/fixture.png', domHtml: 'fixture.html', screenshotSha256: digest(screenshot), viewport: '1280x800', route: '/' }], sourceSnapshot: { codeReference: 'code-reference.json', codeReferenceSha256: digest(path.join(dir, 'code-reference.json')), sourceTreeHash: initial.sourceTreeHash, pageSkeleton: 'page-skeleton.json', pageSkeletonSha256: digest(path.join(dir, 'page-skeleton.json')), pageSkeletonHash: skeleton.skeletonHash } }));
  const baselineInput = path.join(dir, 'baseline-input.json');
  fs.writeFileSync(baselineInput, JSON.stringify({ routes: ['/'], screens: [{ viewport: '1280x800', path: path.relative(project, screenshot) }], codeEntrypoints: ['index.html'], apiSamples: [], contentFacts: ['fixture'], protectedBoundaries: ['fixture'], impactMap: ['fixture'], styleBaseline: { mode: 'existing-platform', sources: [{ path: 'public/style.css', sha256: digest(path.join(project, 'public/style.css')) }], typography: { families: ['sans'], scale: ['1', '2', '3'], lineHeights: ['1', '2'], weights: ['400', '700'] }, colors: { tokens: ['a', 'b', 'c'], semanticRoles: ['a', 'b', 'c'] }, spacing: { scale: ['1', '2', '3'], pageGutters: ['1'], sectionGaps: ['1'] }, geometry: { radius: ['1'], borders: ['1'], shadows: ['none'] } } }));
  const baselineResult = action('baseline-collector.mjs', ['capture', dir, baselineInput, project]);
  assert.deepEqual(baselineResult.resourceCoverage, { status: 'unverified', unresolvedCount: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'existing-baseline.json'))).codeReference.resourceCoverage, baselineResult.resourceCoverage);
  assert.equal(capture().reused, true);
  put('public/late.png', 'late fixture image');
  const staleStatus = call('apex-router.mjs', ['status', project, run, session]);
  assert.equal(staleStatus.executionDirective?.currentStep?.id, 'freeze-code-reference');
  assert.match(staleStatus.executionDirective.currentStep.details, /previously unavailable resource/);
  assert.throws(() => newlyAvailableResources({ unresolvedResources: [{ candidates: ['../outside.png'] }] }, project), /escapes the project/);
  assert.deepEqual(newlyAvailableResources(initial, project, new Set(['public/late.png'])), []);
  assert.notEqual(capture().reused, true);
  assert.ok(paths().has('public/late.png'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'code-reference.json'))).unresolvedResources, []);
  assert.deepEqual(resourceCoverage(JSON.parse(fs.readFileSync(path.join(dir, 'code-reference.json')))), { status: 'no-unresolved-detected', unresolvedCount: 0 });
  put('src/alternate/components/Button.vue', '<template><button>New mapping</button></template>');
  put('tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "~*": ["./src/alternate/*", "./src/*"] } } }');
  assert.notEqual(capture().reused, true);
  assert.ok(paths().has('src/alternate/components/Button.vue'));
  assert.ok(!paths().has('src/components/Button.vue'));
  put('apps/client/package.json', '{}');
  put('apps/client/src/main.tsx', "import '../../../packages/ui/src/theme.css'; export const App = () => <main>App</main>;");
  put('apps/client/public/avatar.png', 'nested app image');
  put('packages/ui/src/theme.css', '.avatar { background-image: url("/avatar.png") }');
  const nestedScope = path.join(dir, 'nested-scope.json'); fs.writeFileSync(nestedScope, JSON.stringify({ routes: ['/'], codeEntrypoints: ['apps/client/src/main.tsx'] }));
  action('existing-code-reference.mjs', ['capture', dir, project, nestedScope]);
  assert.ok(paths().has('apps/client/public/avatar.png'), 'cross-workspace CSS must bind the target application public resource');
  console.log(JSON.stringify({ status: 'passed', scope: 'public paths, TypeScript imports, aliases, workspace sources and cache invalidation' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
