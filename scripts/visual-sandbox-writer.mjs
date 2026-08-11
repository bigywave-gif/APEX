#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
/** Materializes runtime Demo source only inside the current project-local run sandbox. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Visual sandbox write failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha256(buffer) { return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`; }
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\0')) return null;
  const target = path.resolve(root, relative);
  return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
}
function assertNoSymlink(root, target) {
  let current = path.dirname(target);
  while (current.startsWith(`${root}${path.sep}`)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) die(`sandbox path traverses a symbolic link: ${current}`);
    current = path.dirname(current);
  }
}

const [command, runArg, inputArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (command !== 'materialize' || !runArg || !inputArg) die('usage: materialize <run-dir> <demo-source-manifest.json>');
const requestedRunDir = path.resolve(runArg);
try { requireRouterAction(requestedRunDir, 'generate_visual'); } catch (error) { die(error.message); }
const requestedProjectRoot = path.resolve(process.env.APEX_ROUTER_PROJECT_ROOT || '');
const projectRoot = fs.realpathSync(requestedProjectRoot);
const expectedRun = fs.realpathSync(path.join(requestedProjectRoot, '.apex', 'runs', process.env.APEX_ROUTER_RUN_ID || ''));
const runDir = fs.realpathSync(requestedRunDir);
if (runDir !== expectedRun || !runDir.startsWith(`${projectRoot}${path.sep}.apex${path.sep}runs${path.sep}`)) die('Demo run must be the current project-local .apex run; external or orphan .apex directories are forbidden');
const requestedInputFile = path.resolve(inputArg);
if (!fs.existsSync(requestedInputFile)) die('Demo source manifest must be an existing file inside the current run');
const inputFile = fs.realpathSync(requestedInputFile);
if (!inputFile.startsWith(`${runDir}${path.sep}`)) die('Demo source manifest must be an existing file inside the current run');
const input = read(inputFile);
if (input.schemaVersion !== '3.0' || !Array.isArray(input.files) || !input.files.length || !input.entrypoint) die('Demo source manifest requires schemaVersion 3.0, entrypoint, and files');
const sandboxRoot = path.join(runDir, 'visual-sandbox');
fs.mkdirSync(sandboxRoot, { recursive: true });
if (fs.lstatSync(sandboxRoot).isSymbolicLink()) die('visual-sandbox cannot be a symbolic link');
const seen = new Set(), outputs = [];
for (const item of input.files) {
  const target = inside(sandboxRoot, item?.path);
  if (!target || seen.has(target) || !['utf8', 'base64'].includes(item.encoding || 'utf8') || typeof item.content !== 'string') die(`invalid or duplicate Demo source file: ${item?.path || '<missing>'}`);
  assertNoSymlink(sandboxRoot, target);
  const content = Buffer.from(item.content, item.encoding === 'base64' ? 'base64' : 'utf8');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (fs.lstatSync(target).isSymbolicLink()) die(`Demo source file cannot be a symbolic link: ${item.path}`);
  seen.add(target); outputs.push({ path: path.relative(runDir, target), sha256: sha256(content), bytes: content.length });
}
const entrypoint = inside(sandboxRoot, input.entrypoint);
if (!entrypoint || !seen.has(entrypoint)) die('Demo entrypoint must reference one of the materialized sandbox files');
const manifest = { schemaVersion: '3.0', kind: 'project-local-runtime-demo-source', projectRoot, runId: process.env.APEX_ROUTER_RUN_ID, runtimeRoot: 'visual-sandbox', entrypoint: path.relative(runDir, entrypoint), files: outputs, sourceManifest: path.relative(runDir, inputFile), status: 'materialized' };
const output = path.join(runDir, 'visual-sandbox-files.json'); write(output, manifest);
const stateFile = path.join(runDir, 'state.json'), state = read(stateFile); state.artifacts.visualSandboxFiles = 'visual-sandbox-files.json'; state.revision = Number(state.revision || 0) + 1; state.updatedAt = new Date().toISOString(); write(stateFile, state);
console.log(JSON.stringify({ visualSandboxFiles: output, runtimeRoot: sandboxRoot, entrypoint }));
