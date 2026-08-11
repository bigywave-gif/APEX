#!/usr/bin/env node
/** Regression test: a rendered runtime package must be installed with identical locked files in the project. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = path.join(apexRoot, 'scripts', 'apex-router.mjs');
const action = path.join(apexRoot, 'scripts', 'apex-action.mjs');
function run(script, args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
function expect(result, message) { if (result.status !== 0) throw new Error(`${message}: ${(result.stderr || result.stdout).trim()}`); return JSON.parse(result.stdout); }
function reject(result, message) { if (result.status === 0) throw new Error(`${message}: expected rejection`); }
function digest(file) { return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`; }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-runtime-materializer-'));
try {
  expect(run(router, ['intake', root, 'run-runtime-material', 'greenfield', 'standard', 'interactive', 'runtime-material-session']), 'intake');
  const runDir = path.join(root, '.apex', 'runs', 'run-runtime-material'); const stateFile = path.join(runDir, 'state.json'); const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const packageDir = path.join(root, 'node_modules', 'fixture-motion', 'dist'); fs.mkdirSync(packageDir, { recursive: true });
  const packageJson = path.join(root, 'node_modules', 'fixture-motion', 'package.json'); const component = path.join(packageDir, 'Card.js'); const style = path.join(packageDir, 'Card.css');
  fs.writeFileSync(packageJson, JSON.stringify({ name: 'fixture-motion', version: '1.2.3' })); fs.writeFileSync(component, "import { animate } from 'fixture-motion'; export { animate };"); fs.writeFileSync(style, '.card { color: cyan; }');
  const files = [packageJson, component, style].map(file => ({ path: path.relative(root, file), sha256: digest(file) }));
  fs.writeFileSync(path.join(runDir, 'visual-execution-plan.json'), JSON.stringify({ sourceSelections: [{ id: 'motion-package', visualNodes: ['card'], kind: 'component', sourceType: 'approved-candidate', sourceId: 'fixture-motion', resourceId: 'Card', version: '1.2.3', materialization: 'runtime-package', parameters: {} }] }));
  fs.writeFileSync(path.join(runDir, 'runtime-source-lock.json'), JSON.stringify({ schemaVersion: '3.0', projectRoot: root, sourceKind: 'project-installed', patterns: [{ id: 'fixture-card', sourceSelectionId: 'motion-package', visualNodes: ['card'], package: 'fixture-motion', version: '1.2.3', componentPath: 'node_modules/fixture-motion/dist/Card.js', stylePaths: ['node_modules/fixture-motion/dist/Card.css'], props: {}, completeStyle: true, noCssPatch: true, files }] }));
  state.gates.gate1 = { status: 'passed', at: '2026-08-03T00:00:00.000Z', evidence: ['test'] }; state.gates.gate2 = { status: 'passed', at: '2026-08-03T00:00:00.000Z', evidence: ['test'] }; state.locks.requirementsApproved = true; state.locks.implementationAllowed = true; state.artifacts.visualExecutionPlan = 'visual-execution-plan.json'; state.artifacts.runtimeSourceLock = 'runtime-source-lock.json'; fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const audit = expect(run(router, ['authorize', root, 'run-runtime-material', 'runtime-material-session', 'verify']), 'runtime audit authorization');
  expect(run(action, ['run', root, 'run-runtime-material', 'runtime-material-session', audit.authorizationRef, 'verify', 'runtime-materializer.mjs', 'audit', runDir, root]), 'exact runtime audit');
  fs.writeFileSync(style, '.card { color: substitute; }');
  const changed = expect(run(router, ['authorize', root, 'run-runtime-material', 'runtime-material-session', 'verify']), 'changed runtime audit authorization');
  reject(run(action, ['run', root, 'run-runtime-material', 'runtime-material-session', changed.authorizationRef, 'verify', 'runtime-materializer.mjs', 'audit', runDir, root]), 'runtime audit must reject a substituted package style');
  console.log(JSON.stringify({ status: 'passed', checks: 3 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
