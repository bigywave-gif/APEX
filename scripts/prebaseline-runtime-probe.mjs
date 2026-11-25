/** Navigation observations; these do not authorize an import exception. */
export async function observePrebaselineRuntime(page, input) {
  const { origin, routes } = input, originUrl = new URL(origin), results = [];
  const relevant = new Set(['document', 'script']);
  for (const route of routes) {
    const target = new URL(route, originUrl), responses = [], failures = [], blocked = [], tasks = [];
    let pageErrors = 0, consoleErrors = 0, overflow = false, navigationError = null, hashedBytes = 0, responseCount = 0, hashQueue = Promise.resolve();
    const handler = async requestRoute => {
      const request = requestRoute.request(), url = new URL(request.url());
      if ((url.origin === originUrl.origin && request.method() === 'GET') || ['data:', 'blob:'].includes(url.protocol)) await requestRoute.continue();
      else { if (blocked.length < 1000) blocked.push({ method: request.method(), sameOrigin: url.origin === originUrl.origin }); else overflow = true; await requestRoute.abort(); }
    };
    const onResponse = response => {
      const request = response.request(); let url;
      try { url = new URL(response.url()); } catch { return; }
      if (url.origin !== originUrl.origin || !relevant.has(request.resourceType())) return;
      if (++responseCount > 1000) { overflow = true; return; }
      if (response.status() >= 400) failures.push({ path: url.pathname, status: response.status() });
      if (response.status() !== 200) return;
      const task = hashQueue = hashQueue.then(async () => {
        try {
          const length = Number(response.headers()['content-length'] || 0);
          if (length > 4 * 1024 * 1024 || (length && hashedBytes + length > 64 * 1024 * 1024)) { overflow = true; return; }
          const body = await response.body();
          if (body.length > 4 * 1024 * 1024 || hashedBytes + body.length > 64 * 1024 * 1024) { overflow = true; return; }
          hashedBytes += body.length;
          const digest = await globalThis.crypto.subtle.digest('SHA-256', body);
          const sha256 = `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
          responses.push({ path: url.pathname, resourceType: request.resourceType(), sha256 });
        } catch { failures.push({ path: url.pathname, status: 'body-unavailable' }); }
      });
      tasks.push(task);
    };
    const onRequestFailed = request => { try { const url = new URL(request.url()); if (url.origin === originUrl.origin && relevant.has(request.resourceType()) && !String(request.failure()?.errorText || '').includes('ERR_ABORTED')) { if (failures.length < 1000) failures.push({ path: url.pathname, status: 'network-error' }); else overflow = true; } } catch {} };
    const onPageError = () => { pageErrors++; };
    const onConsole = message => { if (message.type() === 'error') consoleErrors++; };
    await page.route('**/*', handler); page.on('response', onResponse); page.on('requestfailed', onRequestFailed); page.on('pageerror', onPageError); page.on('console', onConsole);
    try {
      const response = await page.goto(target.href, { waitUntil: 'networkidle', timeout: 15000 });
      if (!response || response.status() !== 200 || page.url() !== target.href) navigationError = 'route did not return the requested URL with HTTP 200';
      await Promise.all(tasks);
    } catch (error) { navigationError = String(error.message || error).slice(0, 300); }
    finally { await page.unroute('**/*', handler); page.off('response', onResponse); page.off('requestfailed', onRequestFailed); page.off('pageerror', onPageError); page.off('console', onConsole); }
    results.push({ route, status: !navigationError && !overflow ? 'observed' : 'incomplete', navigationError, pageErrors, consoleErrors, failedResources: failures, blockedRequests: blocked, overflow, hashedBytes, responses });
  }
  return { status: results.every(item => item.status === 'observed') ? 'observed' : 'incomplete', routes: results, limitations: ['loaded-source-hash-does-not-prove-execution-or-all-interactions', 'not-a-build-result-or-an-import-exception', 'route-interception-does-not-prove-complete-network-isolation'] };
}
export const prebaselineRuntimeProbeCode = input => `async (page) => await (${observePrebaselineRuntime.toString()})(page, ${JSON.stringify(input)})`;
