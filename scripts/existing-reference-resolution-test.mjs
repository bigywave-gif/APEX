import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-reference-resolution-'));
const run = 'resolution', session = 'resolution-session', dir = path.join(project, '.apex', 'runs', run);
function put(name, text) { const file = path.join(project, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function call(script, args) { const result = spawnSync(process.execPath, [path.join(core, 'scripts', script), ...args], { encoding: 'utf8', timeout: 30000 }); assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`); return JSON.parse(result.stdout); }
function action(script, args) { const auth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']); return call('apex-action.mjs', ['run', project, run, session, auth.authorizationRef, 'collect_existing_baseline', script, ...args]); }
try {
  put('package.json', JSON.stringify({ workspaces: ['packages/*'] }));
  put('tsconfig.json', '{ /* alias config */ "compilerOptions": { "baseUrl": ".", "paths": { "~*": ["./src/*",], }, }, }');
  put('index.html', '<main>Fixture</main><link rel="stylesheet" href="/style.css"><script src="/main.js"></script>');
  put('public/style.css', 'body { color: red }'); put('public/main.js', "import '../src/main.js';");
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
  const scope = path.join(dir, 'scope.json'); fs.writeFileSync(scope, JSON.stringify({ routes: ['/'], codeEntrypoints: ['index.html'] }));
  const capture = () => action('existing-code-reference.mjs', ['capture', dir, project, scope]);
  capture();
  const paths = () => new Set(JSON.parse(fs.readFileSync(path.join(dir, 'code-reference.json'))).files.map(item => item.path));
  for (const expected of ['public/style.css', 'public/main.js', 'src/main.ts', 'src/App.tsx', 'src/components/Button.vue', 'src/components/button.ts', 'src/shared.css', 'packages/ui/src/index.ts', 'packages/ui/src/implementation.ts', 'tsconfig.json', 'package.json', 'packages/ui/package.json', 'packages/ui/tsconfig.json']) assert.ok(paths().has(expected), expected);
  assert.equal(capture().reused, true);
  put('src/alternate/components/Button.vue', '<template><button>New mapping</button></template>');
  put('tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "~*": ["./src/alternate/*", "./src/*"] } } }');
  assert.notEqual(capture().reused, true);
  assert.ok(paths().has('src/alternate/components/Button.vue'));
  assert.ok(!paths().has('src/components/Button.vue'));
  console.log(JSON.stringify({ status: 'passed', scope: 'public paths, TypeScript imports, aliases, workspace sources and cache invalidation' }));
} finally { fs.rmSync(project, { recursive: true, force: true }); }
