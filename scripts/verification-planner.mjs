#!/usr/bin/env node
import { canonicalApexRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(apexRoot, 'scripts', 'apex-validate.mjs');
function die(message) { console.error(`Verification planner failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function category(requirement) { return ({ unit: 'code', integration: 'runtime', contract: 'contract', e2e: 'functional', visual: 'visual', accessibility: 'accessibility', performance: 'performance', regression: 'siteRegression', smoke: 'runtime' })[requirement]; }
function emptyCategories() { return { code: [], runtime: [], visual: [], functional: [], siteRegression: [], responsive: [], accessibility: [], console: [], performance: [], contract: [] }; }

const [command, runArg] = process.argv.slice(2);
canonical();
if (command !== 'generate' || !runArg) die('usage: generate <run-dir>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, 'verify'); } catch (error) { die(error.message); }
const stateFile = path.join(runDir, 'state.json');
const state = read(stateFile);
const inventoryRef = state.artifacts.projectInventory;
if (!inventoryRef) die('projectInventory has not been registered; run project-intake first');
const inventory = read(path.join(runDir, inventoryRef));
const contract = read(path.join(runDir, state.artifacts.deliveryContract || 'delivery-contract.json'));
const plan = { schemaVersion: '3.0', categories: emptyCategories(), generatedFrom: { inventory: inventoryRef, deliveryContract: state.artifacts.deliveryContract || 'delivery-contract.json' }, warnings: [] };
const required = new Set((contract.verificationRequirements || []).map(category).filter(Boolean));
for (const check of inventory.testCommands || []) {
  const target = check.purpose === 'test' ? 'code' : 'runtime';
  plan.categories[target].push({ id: check.id, type: 'command', command: check.command, timeoutMs: 120000 });
}
for (const requirement of required) {
  if (!plan.categories[requirement]?.length) {
    const evidencePath = ({ visual: 'evidence/visual-verification.json', accessibility: 'evidence/accessibility-verification.json', performance: 'evidence/performance-verification.json', contract: 'evidence/contract-verification.json' })[requirement];
    if (evidencePath) plan.categories[requirement].push({ id: `${requirement}-evidence`, type: 'evidence', path: evidencePath });
    plan.warnings.push(`${requirement} requires explicit evidence; discovery did not infer a safe command`);
  }
}
if (!plan.categories.code.length && required.has('code')) plan.warnings.push('code verification has no project-declared test command');
if (!inventory.testCommands?.length) plan.warnings.push('No executable project verification command was discovered');
const output = path.join(runDir, 'verification-plan.generated.json');
write(output, plan);
const validation = spawnSync(process.execPath, [validator, 'validate', 'verification-plan.schema.json', output], { encoding: 'utf8' });
if (validation.status !== 0) die((validation.stderr || validation.stdout).trim());
state.artifacts.verificationPlan = 'verification-plan.generated.json';
state.revision = Number(state.revision || 0) + 1;
state.updatedAt = new Date().toISOString();
write(stateFile, state);
console.log(JSON.stringify({ verificationPlan: output, generatedChecks: Object.values(plan.categories).flat().length, warnings: plan.warnings }));
