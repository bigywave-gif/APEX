/** Require every contract endpoint and distinguish multiple observations for the same endpoint. */
export function validateApiCaseCoverage(endpoints, cases) {
  if (!Array.isArray(endpoints) || !endpoints.length || !Array.isArray(cases) || !cases.length) throw new Error('API contract and cases must be nonempty arrays');
  const groups = new Map(), caseIds = new Set();
  for (const endpoint of endpoints) {
    if (!endpoint || typeof endpoint.method !== 'string' || !endpoint.method || typeof endpoint.path !== 'string' || !endpoint.path) throw new Error('invalid API contract endpoint');
    const key = JSON.stringify([endpoint.method, endpoint.path]);
    if (groups.has(key)) throw new Error('duplicate API contract endpoint');
    groups.set(key, []);
  }
  for (const item of cases) {
    const key = JSON.stringify([item?.method, item?.path]), group = groups.get(key);
    if (!group) throw new Error('API case does not match a contract endpoint');
    if (item.caseId !== undefined) {
      if (typeof item.caseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.caseId) || caseIds.has(item.caseId)) throw new Error('API case IDs must be unique safe names');
      caseIds.add(item.caseId);
    }
    group.push(item);
  }
  for (const group of groups.values()) {
    if (!group.length) throw new Error('API contract endpoint has no case');
    if (group.length > 1 && group.some(item => !item.caseId)) throw new Error('multiple API cases for an endpoint require unique case IDs');
  }
  return groups;
}
