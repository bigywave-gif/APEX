import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = file => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
export function implementationRegistrationCurrent(runDir, state, projectRoot) {
  if (state.roleChain?.confirmationModel !== 'two-confirmations' || !state.roleChain?.enabled) return true;
  try {
    const run = fs.realpathSync(runDir), project = fs.realpathSync(projectRoot);
    const local = value => { if (typeof value !== 'string' || !value || path.isAbsolute(value)) return null; const file = path.resolve(run, value); if (!fs.existsSync(file)) return null; const actual = fs.realpathSync(file); return actual.startsWith(`${run}${path.sep}`) && fs.statSync(actual).isFile() ? actual : null; };
    const receiptFile = local(state.artifacts?.implementationRegistration), mapFile = local(state.artifacts?.implementationMap), deltaFile = local(state.artifacts?.pageDelta);
    if (!receiptFile || !mapFile || !deltaFile) return false;
    const receipt = JSON.parse(fs.readFileSync(receiptFile)), map = JSON.parse(fs.readFileSync(mapFile));
    const projectId = `project_${crypto.createHash('sha256').update(project).digest('hex').slice(0, 24)}`;
    if (receipt.schemaVersion !== '3.0' || receipt.type !== 'implementation-registration' || receipt.projectId !== projectId || receipt.runId !== state.runId || !receipt.sessionId || !receipt.authorizationRef || !receipt.leaseId || receipt.pageDelta?.path !== state.artifacts.pageDelta || receipt.pageDelta.sha256 !== hash(deltaFile) || receipt.implementationMap?.path !== state.artifacts.implementationMap || receipt.implementationMap.sha256 !== hash(mapFile) || !Array.isArray(receipt.files)) return false;
    const targets = [...new Set((map.entries || []).flatMap(entry => entry.runtimeTarget || []))].sort();
    if (!targets.length || targets.length !== receipt.files.length || JSON.stringify(targets) !== JSON.stringify(receipt.files.map(item => item.path).sort())) return false;
    return receipt.files.every(item => {
      if (typeof item.path !== 'string' || path.isAbsolute(item.path)) return false;
      const file = path.resolve(project, item.path), first = path.relative(project, file).split(path.sep)[0];
      const excluded = new Set(['.apex', '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
      if (!file.startsWith(`${project}${path.sep}`) || excluded.has(first) || !fs.existsSync(file)) return false;
      const actual = fs.realpathSync(file); return actual.startsWith(`${project}${path.sep}`) && fs.statSync(actual).isFile() && item.sha256 === hash(actual);
    });
  } catch { return false; }
}
