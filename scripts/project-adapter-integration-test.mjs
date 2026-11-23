import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-adapter-integration-'));
const call = (script, args) => { const result = spawnSync(process.execPath, [path.join(core, 'scripts', script), ...args], { encoding: 'utf8', timeout: 30000 }); assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`); return JSON.parse(result.stdout); };
try {
  const cases = [
    { name: 'vue', dependencies: { vue: '3' }, source: 'src/media/platform/index.ts', adapter: 'vue-enterprise' },
    { name: 'react', dependencies: { react: '19' }, source: 'src/platform/view.tsx', adapter: 'react-saas' },
    { name: 'micro', dependencies: { vue: '3', qiankun: '2' }, source: 'src/platform/index.ts', adapter: 'platform-shell' }
  ];
  for (const item of cases) {
    const project = path.join(base, item.name), run = 'adapter', session = 'adapter-session', runDir = path.join(project, '.apex/runs', run);
    fs.mkdirSync(path.dirname(path.join(project, item.source)), { recursive: true });
    fs.writeFileSync(path.join(project, item.source), 'export const fixture = true;\n');
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: item.dependencies }));
    call('apex-router.mjs', ['intake', project, run, 'existing', 'standard', 'interactive', session, '确认调用 APEX']);
    const authorization = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
    call('apex-action.mjs', ['run', project, run, session, authorization.authorizationRef, 'collect_existing_baseline', 'project-intake.mjs', 'scan', runDir, project]);
    const inventory = JSON.parse(fs.readFileSync(path.join(runDir, 'project-inventory.json')));
    assert.equal(inventory.adapterRecommendation.id, item.adapter, item.name);
  }
  console.log(JSON.stringify({ status: 'passed', scope: 'Router-controlled adapter recommendations on isolated project fixtures' }));
} finally { fs.rmSync(base, { recursive: true, force: true }); }
