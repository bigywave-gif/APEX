#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowNode } from './workflow-node-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const router = fs.readFileSync(path.join(root, 'scripts', 'apex-router.mjs'), 'utf8');
const staticStepIds = [...router.matchAll(/step\('([^']+)'/g)].map(match => match[1]);
const missing = staticStepIds.filter(id => !workflowNode(id));
if (missing.length) throw new Error(`automatic Router steps missing workflow contracts: ${missing.join(', ')}`);

for (const id of staticStepIds) {
  const definition = workflowNode(id);
  if (!definition.action || !Array.isArray(definition.outputs) || !definition.executor?.kind) throw new Error(`workflow contract is incomplete for ${id}`);
  if (!['guarded-apex-action', 'router-command', 'host-controlled-implementation'].includes(definition.executor.kind)) throw new Error(`workflow contract uses an unsupported executor for ${id}`);
  if (!definition.inputPolicy || !definition.completion || !definition.failurePolicy || !definition.stateCommit || !definition.retry) throw new Error(`workflow contract lacks lifecycle policy for ${id}`);
}

for (const dynamicId of ['baseline-role-select', 'gate1-role-record', 'visual-role-summarize', 'implementation-role-repair', 'verify-role-select']) {
  if (!workflowNode(dynamicId)) throw new Error(`dynamic role step missing workflow contract: ${dynamicId}`);
}
console.log(JSON.stringify({ status: 'passed', checkedStaticSteps: staticStepIds.length, checkedDynamicRolePatterns: 5 }));
