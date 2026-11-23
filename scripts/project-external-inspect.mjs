#!/usr/bin/env node
import { inspectProjectExternalIntents } from './project-external-registry.mjs';
try {
  const [command, runDir] = process.argv.slice(2);
  if (command !== 'inspect' || !runDir) throw new Error('usage: project-external-inspect.mjs inspect <run-dir>');
  console.log(JSON.stringify(inspectProjectExternalIntents(runDir), null, 2));
} catch (error) { console.error(`External submission inspection failed: ${error.message}`); process.exitCode = 1; }
