#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRouterAction } from './apex-runtime-guard.mjs';

const apexRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalApexRoot = '/Users/fredyw/.codex/apex/APEX';
function die(message) { console.error('Structure contract export failed: ' + message); process.exit(1); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { die(file + ': ' + error.message); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function hash(file) { return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function htmlText(html) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(); }
function includes(haystack, needle) { return haystack.toLowerCase().includes(String(needle).toLowerCase()); }
function strings(value, output = []) { if (typeof value === 'string') output.push(value); else if (Array.isArray(value)) value.forEach(item => strings(item, output)); else if (value && typeof value === 'object') Object.values(value).forEach(item => strings(item, output)); return output; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function hashValue(value) { return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function normalizedAttributes(html) { return html.replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&quot;/gi, '\"').replace(/&#39;|&apos;/gi, "'"); }
function hasData(html, name, value) { const source = normalizedAttributes(html); const attr = 'data-apex-' + String(name); const target = String(value); return source.includes(attr + '=\"' + target + '\"') || source.includes(attr + "='" + target + "'"); }
function evidenceFor(visual, html) {
  const attributeHtml = normalizedAttributes(html);
  const text = htmlText(html);
  const content = [...(visual.contentLock.protectedText || []), ...(visual.contentLock.protectedTableHeaders || [])];
  const missingContent = content.filter(item => !includes(text, item));
  const nodes = [...(visual.layoutLock.nodes || [])].sort((left, right) => left.order - right.order);
  const nodePositions = nodes.map(node => ({ id: node.id, order: node.order, position: Math.max(attributeHtml.indexOf('data-apex-node=\"' + node.marker + '\"'), attributeHtml.indexOf("data-apex-node='" + node.marker + "'")) }));
  const missingNodes = nodePositions.filter(node => node.position < 0).map(node => node.id);
  const outOfOrder = nodePositions.some((node, index) => index > 0 && node.position <= nodePositions[index - 1].position);
  const missingCharts = [];
  for (const chart of visual.analyticsLock.charts || []) {
    const attributes = { chart: chart.marker, 'chart-type': chart.type, metric: chart.metric, dimension: chart.dimension, encoding: chart.encoding };
    const absent = Object.entries(attributes).filter(([name, value]) => !hasData(html, name, value)).map(([name]) => name);
    if (absent.length) missingCharts.push({ id: chart.id, absent });
  }
  const missingComponents = (visual.componentContracts || []).filter(component => !hasData(html, 'component', component.marker) || !hasData(html, 'component-kind', component.kind)).map(component => component.id);
  const expectedTokenHash = hashValue(visual.designTokens);
  const tokens = { expected: expectedTokenHash, present: hasData(html, 'token-hash', expectedTokenHash) };
  return { protectedText: { checked: content, missing: missingContent }, layout: { checked: nodes.map(node => node.id), missing: missingNodes, outOfOrder }, charts: { checked: (visual.analyticsLock.charts || []).map(chart => chart.id), missing: missingCharts }, components: { checked: (visual.componentContracts || []).map(component => component.id), missing: missingComponents }, tokens };
}

function pass(evidence) { return !evidence.protectedText.missing.length && !evidence.layout.missing.length && !evidence.layout.outOfOrder && !evidence.charts.missing.length && !evidence.components.missing.length && evidence.tokens.present; }
function contract(visual, source, sourceImageHash, evidence, inputs) {
  return { schemaVersion: '3.0', source, sourceImageHash, contentLock: visual.contentLock, layoutLock: visual.layoutLock, analyticsLock: visual.analyticsLock, designTokens: visual.designTokens, componentContracts: visual.componentContracts, verification: { status: pass(evidence) ? 'passed' : 'failed', evidence, inputs, exportedAt: new Date().toISOString() } };
}
const [command, runArg, firstArg, secondArg] = process.argv.slice(2);
if (fs.realpathSync(apexRoot) !== fs.realpathSync(canonicalApexRoot)) die('APEX must run from canonical root: ' + canonicalApexRoot);
if (!['stitch', 'runtime', 'runtime-captured'].includes(command) || !runArg || !firstArg) die('usage: stitch <run-dir> <screen-id> | runtime <run-dir> <dom-html-file> <screenshot-file> | runtime-captured <run-dir> <capture-id>');
const runDir = path.resolve(runArg);
try { requireRouterAction(runDir, command === 'stitch' ? ['compile_visual_bundle', 'validate_stitch'] : 'verify'); } catch (error) { die(error.message); }
const state = read(path.join(runDir, 'state.json'));
const visual = read(path.join(runDir, state.artifacts.visualReference || 'visual-reference.json'));
let result;
let runtimeHtmlArg = firstArg;
let runtimeImageArg = secondArg;
if (command === 'runtime-captured') {
  const capture = read(path.join(runDir, 'evidence', 'browser-capture.json'));
  const item = (capture.evidence || []).find(value => value.id === firstArg && value.status === 'captured');
  if (!item?.domHtml || !item?.screenshot) die('captured runtime screen is missing DOM HTML or screenshot: ' + firstArg);
  runtimeHtmlArg = path.resolve(runDir, item.domHtml);
  runtimeImageArg = path.resolve(runDir, item.screenshot);
}
if (command === 'stitch') {
  const freeze = read(path.join(runDir, state.artifacts.stitchFreeze || 'stitch-freeze.json'));
  const screen = freeze.approvedScreens.find(item => item.screenId === firstArg);
  if (!screen) die('frozen screen is not approved: ' + firstArg);
  const htmlFile = path.resolve(runDir, screen.htmlPath || '');
  const imageFile = path.resolve(runDir, screen.imagePath || '');
  if (!fs.existsSync(htmlFile) || !fs.existsSync(imageFile)) die('frozen screen must include materialized htmlPath and imagePath');
  if (hash(imageFile) !== screen.imageHash) die('frozen screen image hash does not match downloaded screenshot');
  const evidence = evidenceFor(visual, fs.readFileSync(htmlFile, 'utf8'));
  result = contract(visual, 'stitch-screen-export', screen.imageHash, evidence, { screenId: screen.screenId, htmlPath: screen.htmlPath, imagePath: screen.imagePath, htmlHash: hash(htmlFile) });
  const output = path.join(runDir, 'evidence', 'contracts', 'stitch-' + screen.screenId + '.json');
  write(output, result); console.log(JSON.stringify({ contract: output, status: result.verification.status, evidence: result.verification.evidence })); if (result.verification.status !== 'passed') process.exitCode = 2;
} else {
  if (!runtimeImageArg) die('runtime export requires <dom-html-file> <screenshot-file>');
  const htmlFile = path.resolve(runtimeHtmlArg), imageFile = path.resolve(runtimeImageArg);
  if (!fs.existsSync(htmlFile) || !fs.existsSync(imageFile)) die('runtime DOM HTML and screenshot files must exist');
  const evidence = evidenceFor(visual, fs.readFileSync(htmlFile, 'utf8'));
  result = contract(visual, 'runtime-dom-export', hash(imageFile), evidence, { htmlPath: htmlFile, imagePath: imageFile, htmlHash: hash(htmlFile) });
  const output = path.join(runDir, 'evidence', 'contracts', 'runtime-' + path.basename(imageFile).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') + '.json');
  write(output, result); console.log(JSON.stringify({ contract: output, status: result.verification.status, evidence: result.verification.evidence })); if (result.verification.status !== 'passed') process.exitCode = 2;
}
