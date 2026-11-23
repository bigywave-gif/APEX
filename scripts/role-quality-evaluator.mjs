#!/usr/bin/env node
/** Release-time evaluator for controlled-role contracts and scenario coverage. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApexRoot } from './apex-paths.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Role quality evaluation failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`);
if (process.argv[2] !== 'audit') die('usage: audit');
const registry = read(path.join(apexRoot, 'registry', 'agency-role-registry.json'));
const profile = read(path.join(apexRoot, 'registry', 'agency-role-quality-profile.json'));
const ids = new Set(); const failures = [];
for (const role of registry.roles || []) {
  if (!role.id || ids.has(role.id)) failures.push(`role id is missing or duplicated: ${role.id || '<empty>'}`);
  ids.add(role.id);
  if (!role.stage || !role.purpose || !Array.isArray(role.standards) || role.standards.length < 2 || !Array.isArray(role.prohibitions) || !['modify-project', 'approve-gate', 'ask-user'].every(item => role.prohibitions.includes(item))) failures.push(`role contract is incomplete or unsafe: ${role.id}`);
}
if (!/^[a-f0-9]{40}$/.test(registry.upstream?.commit || '')) failures.push('upstream commit is not pinned');
for (const roleId of ids) {
  const source = registry.sourceFiles?.[roleId];
  // Every professional contract must point to a concrete upstream file at the
  // registry's pinned repository commit. Older imports retain a blob SHA;
  // newly adapted roles retain an explicit adaptation note instead of
  // inventing a blob identity that was never verified.
  if (!source?.path || (!/^[a-f0-9]{40}$/.test(source.blobSha1 || '') && !source.adaptation)) failures.push(`source attribution is missing or invalid: ${roleId}`);
}
for (const scenario of profile.scenarios || []) {
  if (!scenario.id || !Array.isArray(scenario.requiredRoles) || !scenario.requiredRoles.length || !Array.isArray(scenario.assertions) || scenario.assertions.length < 3) failures.push(`quality scenario is incomplete: ${scenario.id || '<empty>'}`);
  for (const roleId of scenario.requiredRoles || []) if (!ids.has(roleId)) failures.push(`quality scenario refers to unknown role: ${scenario.id}/${roleId}`);
  const context = scenario.activationContext;
  if (!context || !['existing', 'greenfield'].includes(context.track) || !Array.isArray(context.capabilities)) {
    failures.push(`quality scenario lacks a valid activation context: ${scenario.id || '<empty>'}`);
    continue;
  }
  const capabilities = new Set(context.capabilities);
  const active = role => (role.activation || []).some(flag => flag === 'all'
    || (flag === 'existing' && context.track === 'existing')
    || (flag === 'requires-chart' && capabilities.has('chart'))
    || (flag === 'requires-motion' && capabilities.has('motion'))
    || (flag === 'requires-backend' && ['backend', 'api-contract', 'data-intelligence'].some(item => capabilities.has(item))));
  for (const roleId of scenario.requiredRoles || []) {
    const role = registry.roles.find(item => item.id === roleId);
    if (role && !active(role)) failures.push(`quality scenario does not activate its required role: ${scenario.id}/${roleId}`);
  }
}
const expected = ['codebase-onboarding-engineer', 'product-manager', 'senior-project-manager', 'backend-architect', 'ux-architect', 'ui-designer', 'data-visualization-engineer', 'frontend-implementation-planner', 'frontend-engineer', 'code-reviewer', 'qa-test-engineer', 'evidence-collector', 'reality-checker'];
for (const roleId of expected) if (!ids.has(roleId)) failures.push(`required professional role is absent: ${roleId}`);
const result = { schemaVersion: '1.0', status: failures.length ? 'failed' : 'passed', score: failures.length ? Math.max(0, 100 - failures.length * 10) : 100, threshold: profile.minimumScore, roles: ids.size, scenarios: profile.scenarios?.length || 0, failures };
console.log(JSON.stringify(result));
if (result.status !== 'passed' || result.score < result.threshold) process.exitCode = 1;
