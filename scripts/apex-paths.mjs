#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
export const canonicalApexRoot = path.resolve(path.join(codexHome, 'apex', 'APEX'));
export const apexRoot = moduleRoot;
export const globalBridge = path.join(codexHome, 'skills', 'apex', 'SKILL.md');
export const playwrightBridge = path.join(codexHome, 'skills', 'playwright', 'scripts', 'playwright_cli.sh');
export const npmCacheRoot = path.resolve(process.env.npm_config_cache || path.join(os.homedir(), '.npm'), '_npx');

function real(file) {
  return fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
}

export function isCanonicalApexRoot(root = apexRoot) {
  return real(root) === real(canonicalApexRoot);
}

export function assertCanonicalApexRoot(root = apexRoot) {
  if (!isCanonicalApexRoot(root)) {
    throw new Error(`APEX must run from canonical root: ${canonicalApexRoot}`);
  }
  return canonicalApexRoot;
}
