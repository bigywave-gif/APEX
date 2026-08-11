#!/usr/bin/env node
import { canonicalApexRoot, playwrightBridge as pwcli, npmCacheRoot as npxCacheRoot } from './apex-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function die(message) { console.error(`Browser capture failed: ${message}`); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(`${file}: ${error.message}`); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function canonical() { if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die(`APEX must run from canonical root: ${canonicalApexRoot}`); }
function cachedCli() { try { return fs.readdirSync(npxCacheRoot).map(name => path.join(npxCacheRoot, name, 'node_modules/@playwright/cli/playwright-cli.js')).find(file => fs.existsSync(file)); } catch { return null; } }
function call(session, cwd, args, outputLimit = 4000) {
  const cached = cachedCli();
  const command = cached ? process.execPath : pwcli;
  const commandArgs = cached ? [cached, '--session', session, ...args] : ['--session', session, ...args];
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', timeout: 120000 });
  const output = (result.stdout || '') + (result.stderr || '');
  return { ok: result.status === 0, output: output.slice(-outputLimit), status: result.status, runner: cached ? 'cached-playwright-cli' : 'bridge-playwright-cli' };
}
function images(dir, output = []) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) images(file, output); else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) output.push(file); } return output; }
function routeUrl(baseUrl, route) { return new URL(route, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString(); }
function domFrom(output) {
  const match = output.match(/### Result\s*\n([\s\S]*?)\n### /);
  if (!match) return null;
  try {
    let value = JSON.parse(match[1].trim());
    if (typeof value === 'string') value = JSON.parse(value);
    return typeof value?.html === 'string' ? value.html : null;
  } catch { return null; }
}

const [command, runArg, baseUrl, specArg] = process.argv.slice(2);
canonical();
if (command !== 'capture' || !runArg || !baseUrl || !specArg) die('usage: capture <run-dir> <base-url> <browser-spec.json>');
try { new URL(baseUrl); } catch { die(`invalid base URL: ${baseUrl}`); }
if (!fs.existsSync(pwcli) && !cachedCli()) die(`Playwright bridge is unavailable: ${pwcli}; install the Playwright Skill or provide a valid npm cache`);
const runDir = path.resolve(runArg); const spec = read(path.resolve(specArg));
try { requireRouterAction(runDir, ['verify', 'collect_existing_baseline', 'generate_visual']); } catch (error) { die(error.message); }
if (!Array.isArray(spec.screens) || !spec.screens.length) die('browser spec requires non-empty screens');
const requiredSourceSelectionIds = spec.requiredSourceSelectionIds || [];
if (!Array.isArray(requiredSourceSelectionIds) || requiredSourceSelectionIds.some(item => typeof item !== 'string' || !item)) die('requiredSourceSelectionIds must be an array of concrete visual-plan selection IDs');
const requiredSourceFiles = spec.requiredSourceFiles || [];
if (!Array.isArray(requiredSourceFiles) || requiredSourceFiles.some(item => !item?.selectionId || !item?.path || !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || ''))) die('requiredSourceFiles must contain concrete selectionId, path, and sha256 values');
const artifactDir = path.join(runDir, 'evidence', 'browser'); fs.mkdirSync(artifactDir, { recursive: true });
const captured = [];
const motionSamples = [];
for (const screen of spec.screens) {
  if (!screen.id || !screen.route || !Number.isInteger(screen.width) || !Number.isInteger(screen.height)) die('each screen requires id, route, width and height');
  const session = `apex-${crypto.createHash('sha1').update(`${runDir}:${screen.id}`).digest('hex').slice(0, 12)}`;
  const before = new Set(images(artifactDir)); const url = routeUrl(baseUrl, screen.route);
  const open = call(session, artifactDir, ['open', url]); const resize = open.ok ? call(session, artifactDir, ['resize', String(screen.width), String(screen.height)]) : { ok: false, output: 'open failed' };
  const snapshot = resize.ok ? call(session, artifactDir, ['snapshot']) : { ok: false, output: 'resize failed' };
  const shot = snapshot.ok ? call(session, artifactDir, ['screenshot']) : { ok: false, output: 'snapshot failed' };
  const dom = snapshot.ok ? call(session, artifactDir, ['run-code', 'async (page) => JSON.stringify({ html: await page.content() })'], 2000000) : { ok: false, output: 'snapshot failed' };
  const consoleLog = snapshot.ok ? call(session, artifactDir, ['console', 'error']) : { ok: false, output: 'snapshot failed' };
  const created = images(artifactDir).filter(file => !before.has(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const html = dom.ok ? domFrom(dom.output) : null;
  const domFile = html ? path.join(artifactDir, screen.id + '.dom.html') : null;
  if (domFile) fs.writeFileSync(domFile, html);
  const sourceSelections = html ? [...html.matchAll(/data-apex-source-selection=["']([^"']+)["']/g)].map(match => match[1]) : [];
  const sourceFiles = html ? [...html.matchAll(/data-apex-source-file=["']([^"']+)["']/g)].map(match => match[1]) : [];
  const sourceSelectionMatches = requiredSourceSelectionIds.every(id => sourceSelections.includes(id));
  const sourceFileMatches = requiredSourceFiles.every(file => sourceFiles.includes(`${file.selectionId}:${file.sha256}`));
  let elapsedMs = 0;
  for (const sample of screen.motionSamples || []) {
    if (!sample.id || !Number.isInteger(sample.timestampMs) || sample.timestampMs < elapsedMs) die(`motion sample for ${screen.id} requires an id and ascending timestampMs`);
    const wait = call(session, artifactDir, ['run-code', `async (page) => { await page.waitForTimeout(${sample.timestampMs - elapsedMs}); return 'waited'; }`]);
    const beforeSample = new Set(images(artifactDir)); const sampleShot = wait.ok ? call(session, artifactDir, ['screenshot']) : { ok: false, output: 'motion wait failed' };
    const screenshot = images(artifactDir).filter(file => !beforeSample.has(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    motionSamples.push({ id: sample.id, screenId: screen.id, timestampMs: sample.timestampMs, screenshot: screenshot ? path.relative(runDir, screenshot) : null, status: sampleShot.ok && Boolean(screenshot) ? 'captured' : 'failed', logs: { wait: wait.output, screenshot: sampleShot.output } }); elapsedMs = sample.timestampMs;
  }
  captured.push({ id: screen.id, route: screen.route, url, viewport: String(screen.width) + 'x' + String(screen.height), screenshot: created ? path.relative(runDir, created) : null, domHtml: domFile ? path.relative(runDir, domFile) : null, sourceSelections, sourceFiles, status: shot.ok && Boolean(created) && Boolean(domFile) && sourceSelectionMatches && sourceFileMatches ? 'captured' : 'failed', approved: false, runner: open.runner, logs: { open: open.output, resize: resize.output, snapshot: snapshot.output, screenshot: shot.output, dom: dom.ok ? 'captured' : dom.output, sourceSelections: sourceSelectionMatches ? 'matched' : `missing: ${requiredSourceSelectionIds.filter(id => !sourceSelections.includes(id)).join(', ')}`, sourceFiles: sourceFileMatches ? 'matched' : `missing exact rendered source files`, console: consoleLog.output } });
}
const result = { status: captured.every(item => item.status === 'captured') && motionSamples.every(item => item.status === 'captured') ? 'passed' : 'failed', sourceSelectionIds: requiredSourceSelectionIds, evidence: captured, motionSamples, capturedAt: new Date().toISOString(), note: 'Captured screenshots and motion samples are evidence only. Visual approval must be recorded against the frozen Stitch/design baseline.' };
write(path.join(runDir, 'evidence', 'browser-capture.json'), result); console.log(JSON.stringify({ evidence: path.join(runDir, 'evidence', 'browser-capture.json'), status: result.status, captured: captured.filter(item => item.status === 'captured').length, total: captured.length })); if (result.status !== 'passed') process.exitCode = 2;
