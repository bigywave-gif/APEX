#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
/** Creates one detached Git worktree per APEX run without moving run artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`APEX workspace failed: ${message}`); process.exit(1); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
const [command, runArg, projectArg] = process.argv.slice(2);
if (command !== 'prepare' || !runArg || !projectArg) die('usage: prepare <run-dir> <project-root>');
const runDir = path.resolve(runArg); const projectRoot = path.resolve(projectArg);
try { requireRouterAction(runDir, 'prepare_workspace'); } catch (error) { die(error.message); }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
const runId = path.basename(runDir); const gitRoot = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (gitRoot.status !== 0) die('isolated workspace requires a Git project');
if (path.resolve(gitRoot.stdout.trim()) !== projectRoot) die('project root must be the Git repository root for isolated workspace creation');
const workspace = path.join(projectRoot, '.apex', 'workspaces', runId); const manifest = path.join(runDir, 'workspace.json');
if (!fs.existsSync(workspace)) {
  const result = spawnSync('git', ['-C', projectRoot, 'worktree', 'add', '--detach', workspace, 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) die((result.stderr || result.stdout).trim());
}
const head = spawnSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (head.status !== 0) die('created workspace is not a readable Git worktree');
write(manifest, { schemaVersion: '3.0', runId, projectRoot, workspaceRoot: workspace, baseCommit: head.stdout.trim(), mode: 'git-detached-worktree', createdAt: new Date().toISOString() });
console.log(JSON.stringify({ status: 'prepared', workspace, manifest }));
