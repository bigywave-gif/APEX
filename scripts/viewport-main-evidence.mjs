/** Browser observation, not an aesthetic score or a proof of all responsive behavior. */
export async function inspectBoundMainViewport(page, bindings) {
  return page.evaluate(items => {
    const results = [], mains = new Set();
    let mainScanTruncated = false, scannedNodes = 0;
    for (const binding of items) {
      let rendered = false;
      for (const node of document.querySelectorAll(binding.selector)) {
        if (node.getAttribute('data-apex-source') !== binding.sourceMarker) continue;
        rendered = true;
        if (++scannedNodes > 5000) { mainScanTruncated = true; break; }
        const main = node.closest('main,[role="main"]');
        if (main && !mains.has(main)) {
          if (mains.size >= 1000) { mainScanTruncated = true; break; }
          mains.add(main);
        }
      }
      results.push({ ...binding, rendered });
    }
    const examined = [];
    const rootStyle = getComputedStyle(document.documentElement), bodyStyle = document.body ? getComputedStyle(document.body) : null;
    let verticalScrollAvailable = document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 && (!['hidden', 'clip'].includes(rootStyle.overflowY) || !bodyStyle || !['hidden', 'clip'].includes(bodyStyle.overflowY));
    for (const main of mains) {
      const style = getComputedStyle(main), rect = main.getBoundingClientRect();
      if (style.display === 'none' || style.visibility !== 'visible' || !main.getClientRects().length || rect.width <= 0 || rect.height <= 0) continue;
      let transparent = false;
      for (let ancestor = main; ancestor; ancestor = ancestor.parentElement) if (Number(getComputedStyle(ancestor).opacity) === 0) { transparent = true; break; }
      if (transparent) continue;
      let scrollable = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      for (let parent = main.parentElement; parent && !scrollable; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollWidth > parent.clientWidth + 1) scrollable = true;
        const vertical = getComputedStyle(parent).overflowY;
        if ((vertical === 'auto' || vertical === 'scroll') && parent.scrollHeight > parent.clientHeight + 1) verticalScrollAvailable = true;
      }
      examined.push({ outside: rect.right <= 0 || rect.left >= innerWidth, scrollable });
    }
    const allOutside = examined.length > 0 && examined.every(item => item.outside && !item.scrollable);
    let visibleControls = 0, controlsTruncated = false;
    if (allOutside && !mainScanTruncated) {
      const controls = document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"]');
      controlsTruncated = controls.length > 5000;
      let inspected = 0;
      for (const node of controls) {
        if (inspected++ >= 5000) break;
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        if (!node.getClientRects().length || node.matches(':disabled') || node.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]') || style.visibility !== 'visible' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) continue;
        let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right), top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom), transparent = false;
        for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const parentStyle = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
          if (Number(parentStyle.opacity) === 0) { transparent = true; break; }
          if (['hidden', 'clip', 'auto', 'scroll'].includes(parentStyle.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
          if (['hidden', 'clip', 'auto', 'scroll'].includes(parentStyle.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
        }
        if (!transparent && left < right && top < bottom) { visibleControls++; break; }
      }
    }
    const status = mainScanTruncated ? 'unverified' : !examined.length ? 'not-applicable' : !allOutside ? 'visible-or-scrollable' : visibleControls ? 'interactive-alternative' : controlsTruncated ? 'unverified' : verticalScrollAvailable ? 'scroll-alternative' : 'offscreen';
    return { bindings: results, mainViewport: { version: '1.0', status, examinedCount: examined.length, offscreenCount: examined.filter(item => item.outside && !item.scrollable).length, visibleControls, controlsTruncated, verticalScrollAvailable, mainScanTruncated } };
  }, bindings);
}
export const boundMainViewportCode = bindings => `async (page) => await (${inspectBoundMainViewport.toString()})(page, ${JSON.stringify(bindings)})`;

export function validBoundMainViewport(value) {
  if (!value || value.version !== '1.0' || !Number.isSafeInteger(value.examinedCount) || value.examinedCount < 0 || !Number.isSafeInteger(value.offscreenCount) || value.offscreenCount < 0 || value.offscreenCount > value.examinedCount || !Number.isSafeInteger(value.visibleControls) || value.visibleControls < 0 || value.visibleControls > 1 || typeof value.controlsTruncated !== 'boolean' || typeof value.verticalScrollAvailable !== 'boolean' || typeof value.mainScanTruncated !== 'boolean') return false;
  if (value.mainScanTruncated) return value.status === 'unverified' && value.visibleControls === 0 && !value.controlsTruncated;
  const allOutside = value.examinedCount > 0 && value.offscreenCount === value.examinedCount;
  if (value.status === 'not-applicable') return value.examinedCount === 0 && value.visibleControls === 0 && !value.controlsTruncated;
  if (value.status === 'visible-or-scrollable') return value.examinedCount > 0 && !allOutside && value.visibleControls === 0 && !value.controlsTruncated;
  if (value.status === 'offscreen') return allOutside && value.visibleControls === 0 && !value.controlsTruncated && !value.verticalScrollAvailable;
  if (value.status === 'scroll-alternative') return allOutside && value.visibleControls === 0 && !value.controlsTruncated && value.verticalScrollAvailable;
  if (value.status === 'interactive-alternative') return allOutside && value.visibleControls === 1;
  if (value.status === 'unverified') return allOutside && value.visibleControls === 0 && value.controlsTruncated;
  return false;
}
