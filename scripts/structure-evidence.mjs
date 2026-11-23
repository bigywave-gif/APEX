import crypto from 'node:crypto';

function htmlText(html) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(); }
function includes(haystack, needle) { return haystack.toLowerCase().includes(String(needle).toLowerCase()); }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function hashValue(value) { return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function normalizedAttributes(html) { return html.replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&quot;/gi, '\"').replace(/&#39;|&apos;/gi, "'"); }
function hasData(html, name, value) { const source = normalizedAttributes(html); const attr = 'data-apex-' + String(name); const target = String(value); return source.includes(attr + '=\"' + target + '\"') || source.includes(attr + "='" + target + "'"); }
export function evidenceFor(visual, html) {
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

export function pass(evidence) { return !evidence.protectedText.missing.length && !evidence.layout.missing.length && !evidence.layout.outOfOrder && !evidence.charts.missing.length && !evidence.components.missing.length && evidence.tokens.present; }
