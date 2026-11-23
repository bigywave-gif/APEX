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

export function apiEndpointSchemaReferences(endpoint) {
  if (!endpoint || typeof endpoint.requestSchema !== 'string' || !endpoint.requestSchema || typeof endpoint.responseSchema !== 'string' || !endpoint.responseSchema) throw new Error('API endpoint requires request and response schemas');
  const mapping = endpoint.responseSchemas;
  if (mapping === undefined) return [endpoint.requestSchema, endpoint.responseSchema];
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length || Object.entries(mapping).some(([status, ref]) => !/^[1-5]\d\d$/.test(status) || typeof ref !== 'string' || !ref)) throw new Error('API responseSchemas must map explicit HTTP status codes to schema paths');
  return [endpoint.requestSchema, endpoint.responseSchema, ...Object.values(mapping)];
}
export function apiResponseSchemaReference(endpoint, status) {
  apiEndpointSchemaReferences(endpoint);
  if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) throw new Error('API response status is invalid');
  if (endpoint.responseSchemas === undefined) return endpoint.responseSchema;
  if (status === undefined || !Object.hasOwn(endpoint.responseSchemas, String(status))) throw new Error('API response status has no declared response schema');
  return endpoint.responseSchemas[String(status)];
}
