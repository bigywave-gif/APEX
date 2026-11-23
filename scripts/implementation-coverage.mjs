/** Check that an implementation map reaches every confirmed page. */
export function validateImplementationCoverage({ baseline, stitch, entries }) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('implementation must map at least one confirmed page');
  const mapped = new Set(entries.map(entry => entry.screenId));
  if ([...mapped].some(id => typeof id !== 'string' || !id)) throw new Error('implementation page ID is missing');
  if (stitch) {
    const screens = stitch.approvedScreens || [], ids = screens.map(screen => screen.screenId), approved = new Set(ids);
    if (!ids.length || ids.some(id => typeof id !== 'string' || !id) || approved.size !== ids.length) throw new Error('frozen Stitch page IDs are invalid');
    for (const id of approved) if (!mapped.has(id)) throw new Error(`approved Stitch screen is not mapped: ${id}`);
    for (const id of mapped) if (!approved.has(id)) throw new Error(`implementation maps an unapproved Stitch screen: ${id}`);
    return;
  }
  const captures = baseline?.screenCaptures;
  if (!Array.isArray(captures) || !captures.length) throw new Error('direct implementation requires confirmed Demo screen captures');
  const byId = new Map(), routes = new Set();
  for (const capture of captures) {
    if (!capture.id || byId.has(capture.id)) throw new Error('Demo screen IDs are missing or duplicated');
    let url; try { url = new URL(capture.url); } catch { throw new Error(`Demo screen URL is invalid: ${capture.id}`); }
    const route = `${url.origin}${url.pathname}${url.search}${url.hash}`;
    byId.set(capture.id, route); routes.add(route);
  }
  const mappedRoutes = new Set();
  for (const id of mapped) {
    if (!byId.has(id)) throw new Error(`implementation maps an unconfirmed Demo screen: ${id}`);
    mappedRoutes.add(byId.get(id));
  }
  for (const route of routes) if (!mappedRoutes.has(route)) throw new Error(`confirmed Demo route is not mapped: ${route}`);
}
