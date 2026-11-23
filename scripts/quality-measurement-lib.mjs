import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { controlledOutput, declaredVerificationCommand } from './verification-policy.mjs';

export function runProjectMeasurement(projectRoot, inventory, checkId, kind) {
  const manifestFile = path.join(projectRoot, 'package.json'), manifestBytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const check = (inventory.testCommands || []).find(item => item.id === checkId);
  if (!check || !declaredVerificationCommand(check, inventory, manifest)) throw new Error('measurement must use an unchanged project-declared verification script');
  const name = /^npm run ([A-Za-z0-9:_-]+)$/.exec(check.command)[1];
  const result = spawnSync('npm', ['run', '--silent', name], { cwd: projectRoot, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`measurement command failed: ${(result.stderr || result.error?.message || '').slice(-1000)}`);
  if (!fs.readFileSync(manifestFile).equals(manifestBytes)) throw new Error('project manifest changed during measurement');
  let report; try { report = JSON.parse(result.stdout); } catch { throw new Error('measurement command must emit one JSON report'); }
  if (report?.kind !== kind || !report.tool?.name || !report.tool?.version || !report.environment || report.scope !== 'automated-checks-only') throw new Error('measurement report must identify kind, tool, version, environment and automated scope');
  return { schemaVersion: '1.0', kind, projectRoot: fs.realpathSync(projectRoot), command: check.command, checkId, report, measuredAt: new Date().toISOString() };
}
export function assessMeasuredQuality(kind, report, contract) {
  const failures = [];
  if (report?.kind !== kind || !report.tool?.name || !report.tool?.version || !report.environment || report.scope !== 'automated-checks-only') failures.push('measurement metadata is incomplete');
  if (kind === 'accessibility') {
    if (report.standard !== contract.qualityBar.accessibilityTarget) failures.push('measurement standard does not match the target');
    if (!Array.isArray(report.violations) || !Array.isArray(report.incomplete)) failures.push('violations and incomplete arrays are required');
    else if (report.violations.length || report.incomplete.length) failures.push('violations or incomplete checks remain');
  } else if (kind === 'performance') {
    if (!Object.keys(contract.qualityBar.performanceTarget || {}).length) failures.push('performance target is missing');
    for (const [key, limit] of Object.entries(contract.qualityBar.performanceTarget || {})) {
      const value = report.metrics?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) failures.push(`${key} measured metric is missing or invalid`);
      else if (value > limit) failures.push(`${key} exceeds its target`);
    }
  } else failures.push('unsupported measurement kind');
  return { status: failures.length ? 'failed' : 'passed', scope: 'automated-checks-only', evidence: [{ kind, status: failures.length ? 'failed' : 'passed', report, failures }], limitations: ['Automated checks do not establish complete accessibility or real-user performance.'], checkedAt: new Date().toISOString() };
}

export function measurementMatchesRegistration(runDir, state, measurement) {
  try {
    const ref = state.artifacts?.implementationRegistration;
    if (!ref || measurement.implementationRegistration?.path !== ref) return false;
    const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, ref));
    if (!file.startsWith(`${root}${path.sep}`)) return false;
    return measurement.implementationRegistration.sha256 === `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  } catch { return false; }
}

export function qualityEvidenceCurrent(runDir, state, evidence, kind, contract, projectRoot = path.dirname(path.dirname(path.dirname(runDir)))) {
  try {
    const ref = evidence.measurementPath;
    if (evidence.status !== 'passed' || !ref || !controlledOutput(runDir, ref, ['quality-measurement.mjs'])) return false;
    const root = fs.realpathSync(runDir), file = fs.realpathSync(path.resolve(root, ref));
    if (!file.startsWith(`${root}${path.sep}`)) return false;
    if (evidence.measurementSha256 !== `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`) return false;
    const measurement = JSON.parse(fs.readFileSync(file));
    if (measurement.kind !== kind || !measurementMatchesRegistration(runDir, state, measurement)) return false;
    if (!measurementContextCurrent(runDir, state, measurement, projectRoot)) return false;
    const assessed = assessMeasuredQuality(kind, measurement.report, contract);
    return assessed.status === 'passed' && JSON.stringify(evidence.evidence?.[0]?.report) === JSON.stringify(measurement.report);
  } catch { return false; }
}

export function measurementContextCurrent(runDir, state, measurement, projectRoot = path.dirname(path.dirname(path.dirname(runDir)))) {
  try {
    const root = fs.realpathSync(runDir);
    if (!measurementMatchesRegistration(runDir, state, measurement) || fs.realpathSync(measurement.projectRoot) !== fs.realpathSync(projectRoot)) return false;
    const inv = state.artifacts?.verificationInventory;
    if (!inv || measurement.verificationInventory?.path !== inv || !controlledOutput(runDir, inv, ['project-intake.mjs'])) return false;
    const invFile = fs.realpathSync(path.resolve(root, inv));
    if (!invFile.startsWith(`${root}${path.sep}`) || measurement.verificationInventory.sha256 !== `sha256:${crypto.createHash('sha256').update(fs.readFileSync(invFile)).digest('hex')}`) return false;
    const packageFile = path.join(fs.realpathSync(projectRoot), 'package.json');
    return measurement.packageManifestSha256 === `sha256:${crypto.createHash('sha256').update(fs.readFileSync(packageFile)).digest('hex')}`;
  } catch { return false; }
}
