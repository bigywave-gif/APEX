/** Detect an adapter from project evidence; generic directory names are only weak hints. */
export function adapterRecommendation(manifest, detected, files) {
  const dependencies = { ...(manifest?.dependencies || {}), ...(manifest?.devDependencies || {}) };
  if (['@micro-zoe/micro-app', 'qiankun', '@alifd/lowcode-engine'].some(name => dependencies[name])) return { id: 'platform-shell', path: 'adapters/examples/platform-shell/adapter.md', confidence: 'high', reasons: ['micro-frontend or low-code dependency detected'] };
  if (['jquery', 'requirejs', 'single-spa'].some(name => dependencies[name])) return { id: 'legacy-multi-entry', path: 'adapters/examples/legacy-multi-entry/adapter.md', confidence: 'high', reasons: ['legacy runtime indicators detected'] };
  if (detected.frameworks.includes('vue')) return { id: 'vue-enterprise', path: 'adapters/examples/vue-enterprise/adapter.md', confidence: 'high', reasons: ['Vue source or dependency detected'] };
  if (detected.frameworks.includes('react')) return { id: 'react-saas', path: 'adapters/examples/generic-saas/adapter.md', confidence: 'high', reasons: ['React source or dependency detected'] };
  if (files.some(file => /\.(html|htm|ejs|hbs|pug)$/.test(file)) && !detected.frameworks.includes('svelte')) return { id: 'legacy-multi-entry', path: 'adapters/examples/legacy-multi-entry/adapter.md', confidence: 'high', reasons: ['server-template or HTML indicators detected'] };
  if (files.some(file => /(^|\/)(shell|platform|micro-app|lowcode)\//i.test(file))) return { id: 'platform-shell', path: 'adapters/examples/platform-shell/adapter.md', confidence: 'low', reasons: ['directory names alone are ambiguous; review the actual host architecture'] };
  return { id: 'generic-saas', path: 'adapters/examples/generic-saas/adapter.md', confidence: 'low', reasons: ['no specialized runtime pattern detected; user review required'] };
}
