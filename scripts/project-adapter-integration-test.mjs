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
    { name: 'micro', dependencies: { vue: '3', qiankun: '2' }, source: 'src/platform/index.ts', adapter: 'platform-shell' },
    { name: 'angular', dependencies: { '@angular/core': '19' }, source: 'src/index.html', adapter: 'generic-saas', confidence: 'low' },
    { name: 'html', dependencies: {}, source: 'index.html', adapter: 'legacy-multi-entry', confidence: 'low' },
    { name: 'preact', dependencies: { preact: '10' }, source: 'src/app.tsx', adapter: 'generic-saas', confidence: 'low', framework: 'preact' },
    { name: 'solid', dependencies: { 'solid-js': '1' }, source: 'src/app.tsx', adapter: 'generic-saas', confidence: 'low', framework: 'solid' },
    { name: 'jsx-only', dependencies: {}, source: 'src/app.tsx', adapter: 'generic-saas', confidence: 'low', framework: 'jsx-compatible' },
    { name: 'mixed', dependencies: { react: '19', vue: '3' }, source: 'src/app.tsx', adapter: 'generic-saas', confidence: 'low' },
    { name: 'nested-react', dependencies: {}, source: 'packages/web/app.tsx', adapter: 'generic-saas', confidence: 'low', nested: { path: 'packages/web/package.json', dependencies: { react: '19' }, framework: 'react' } },
    { name: 'nested-vue', dependencies: { react: '19' }, source: 'src/app.tsx', adapter: 'react-saas', confidence: 'low', nested: { path: 'packages/web/package.json', dependencies: { vue: '3' }, framework: 'vue' } },
    { name: 'nested-invalid', dependencies: { react: '19' }, source: 'src/app.tsx', adapter: 'react-saas', confidence: 'low', nested: { path: 'packages/web/package.json', invalid: true } }
  ];
  for (const item of cases) {
    const project = path.join(base, item.name), run = 'adapter', session = 'adapter-session', runDir = path.join(project, '.apex/runs', run);
    fs.mkdirSync(path.dirname(path.join(project, item.source)), { recursive: true });
    fs.writeFileSync(path.join(project, item.source), 'export const fixture = true;\n');
    if (item.nested) { const file = path.join(project, item.nested.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, item.nested.invalid ? '{invalid' : JSON.stringify({ dependencies: item.nested.dependencies })); }
    if (item.name === 'vue') {
      for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(path.dirname(path.join(project, item.source)), `extra${i}.ts`), 'export const extra = true;\n');
      fs.mkdirSync(path.join(project, '.custom-env'));
      fs.writeFileSync(path.join(project, '.custom-env', 'pyvenv.cfg'), 'home = fixture\n');
      fs.writeFileSync(path.join(project, '.custom-env', 'index.py'), 'pass\n');
    }
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: item.dependencies }));
    call('apex-router.mjs', ['intake', project, run, 'existing', 'standard', 'interactive', session, '确认调用 APEX']);
    const authorization = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
    call('apex-action.mjs', ['run', project, run, session, authorization.authorizationRef, 'collect_existing_baseline', 'project-intake.mjs', 'scan', runDir, project]);
    const inventory = JSON.parse(fs.readFileSync(path.join(runDir, 'project-inventory.json')));
    assert.equal(inventory.adapterRecommendation.id, item.adapter, item.name);
    if (item.confidence) assert.equal(inventory.adapterRecommendation.confidence, item.confidence, item.name);
    if (item.framework) { assert.ok(inventory.frameworks.includes(item.framework), item.name); assert.ok(!inventory.frameworks.includes('react'), item.name); }
    if (item.nested) { const evidence = inventory.nestedPackages.find(record => record.path === item.nested.path); assert.ok(evidence, item.name); assert.equal(evidence.status, item.nested.invalid ? 'unverified' : 'read'); if (item.nested.framework) assert.ok(evidence.frameworks.includes(item.nested.framework)); }
    assert.equal(inventory.scanCoverage.complete, true);
    if (item.name === 'vue') {
      assert.ok(inventory.ignoredPaths.includes('.custom-env'));
      assert.ok(!inventory.runtime.includes('python'));
      const options = path.join(runDir, 'project-scan-options.json');
      fs.writeFileSync(options, JSON.stringify({ maxSourceFiles: 1 }));
      const limitedAuth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
      call('apex-action.mjs', ['run', project, run, session, limitedAuth.authorizationRef, 'collect_existing_baseline', 'project-intake.mjs', 'scan', runDir, project, options]);
      const partial = JSON.parse(fs.readFileSync(path.join(runDir, 'project-inventory.json')));
      assert.equal(partial.scanCoverage.sourceTruncated, true);
      assert.equal(partial.adapterRecommendation.confidence, 'low');
      const status = call('apex-router.mjs', ['status', project, run, session]);
      assert.equal(status.executionDirective?.currentStep?.id, 'expand-project-inventory');
      assert.equal(status.userInteraction?.mode, 'no-user-input');
      for (const expectedLimit of [2, 4, 8]) {
        const expandedAuth = call('apex-router.mjs', ['authorize', project, run, session, 'collect_existing_baseline']);
        call('apex-action.mjs', ['run', project, run, session, expandedAuth.authorizationRef, 'collect_existing_baseline', 'project-intake.mjs', 'expand', runDir, project]);
        const coverage = JSON.parse(fs.readFileSync(path.join(runDir, 'project-inventory.json'))).scanCoverage;
        assert.equal(coverage.sourceLimit, expectedLimit);
        assert.equal(coverage.complete, expectedLimit === 8);
        if (!coverage.complete) assert.equal(call('apex-router.mjs', ['status', project, run, session]).executionDirective?.currentStep?.id, 'expand-project-inventory');
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'project-inventory.json'))).scanCoverage.complete, true);
      assert.notEqual(call('apex-router.mjs', ['status', project, run, session]).executionDirective?.currentStep?.id, 'expand-project-inventory');
    }
  }
  console.log(JSON.stringify({ status: 'passed', scope: 'Router-controlled adapter recommendations on isolated project fixtures' }));
} finally { fs.rmSync(base, { recursive: true, force: true }); }
