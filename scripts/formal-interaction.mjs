/** Browser-executed, observable formal UI transitions. */
export function validateFormalJourneys(journeys) {
  if (!Array.isArray(journeys) || !journeys.length) throw new Error('formal journeys must be a non-empty array');
  const ids = new Set();
  for (const journey of journeys) {
    if (!/^[A-Za-z0-9_-]+$/.test(journey?.id || '') || ids.has(journey.id) || typeof journey.task !== 'string' || !journey.task.trim() || typeof journey.route !== 'string' || !journey.route.startsWith('/') || journey.route.startsWith('//') || journey.route.includes('\\')) throw new Error('formal journey needs a unique safe ID, task, and same-origin route');
    ids.add(journey.id);
    if (!Array.isArray(journey.steps) || !journey.steps.length) throw new Error(`formal journey has no actions: ${journey.id}`);
    for (const step of journey.steps) {
      if (!['click', 'fill', 'selectOption', 'check', 'uncheck', 'press'].includes(step.action) || typeof step.selector !== 'string' || !step.selector.trim()) throw new Error('formal action or selector is invalid');
      if (['fill', 'selectOption', 'press'].includes(step.action) && typeof step.value !== 'string') throw new Error('formal action value is required');
      for (const probe of [step.before, step.after]) if (!probe || typeof probe.selector !== 'string' || !probe.selector.trim() || !['text', 'value', 'visible', 'checked', 'attribute'].includes(probe.property) || !['string', 'boolean'].includes(typeof probe.equals) || (probe.property === 'attribute' && !probe.attribute)) throw new Error('formal before and after observations are required');
      if (step.before.selector !== step.after.selector || step.before.property !== step.after.property || step.before.attribute !== step.after.attribute || step.before.equals === step.after.equals) throw new Error('formal action must change an observed value');
    }
  }
  return journeys;
}
export async function runFormalJourney(page, input) {
  const { journey, url, screenshotPath } = input, steps = [], origin = new URL(url).origin;
  const observe = async probe => { const node = page.locator(probe.selector); if (probe.property === 'visible') return await node.isVisible(); if (probe.property === 'value') return await node.inputValue(); if (probe.property === 'checked') return await node.isChecked(); if (probe.property === 'attribute') return await node.getAttribute(probe.attribute); return (await node.innerText()).trim(); };
  const until = async probe => { const deadline = Date.now() + 3000; let actual; do { actual = await observe(probe); if (actual === probe.equals) return actual; await page.waitForTimeout(75); } while (Date.now() < deadline); throw new Error(`Expected ${probe.selector} ${probe.property}=${JSON.stringify(probe.equals)}, observed ${JSON.stringify(actual)}`); };
  let error = null, html = '';
  try {
    const ensureOrigin = () => { if (new URL(page.url()).origin !== origin) throw new Error('formal interaction left the application origin'); };
    await page.goto(new URL(journey.route, url).href);
    ensureOrigin();
    for (const step of journey.steps) {
      ensureOrigin();
      const before = await until(step.before), target = page.locator(step.selector);
      ensureOrigin();
      if (['fill', 'selectOption', 'press'].includes(step.action)) await target[step.action](step.value, { timeout: 3000 }); else await target[step.action]({ timeout: 3000 });
      ensureOrigin();
      const after = await until(step.after);
      ensureOrigin();
      const observation = { selector: step.before.selector, property: step.before.property, ...(step.before.property === 'attribute' ? { attribute: step.before.attribute } : {}) };
      steps.push({ action: step.action, selector: step.selector, observation, before, after, passed: true });
    }
    await page.screenshot({ path: screenshotPath, fullPage: true }); html = await page.content();
  } catch (cause) { error = cause.message; }
  return { id: journey.id, task: journey.task, route: journey.route, finalUrl: page.url(), status: error ? 'failed' : 'passed', steps, error, html };
}
export const formalJourneyCode = input => `async (page) => await (${runFormalJourney.toString()})(page, ${JSON.stringify(input)})`;

export async function runFormalAuthentication(page, input) {
  const { authentication, credentials, url } = input;
  if (new URL(page.url()).origin !== new URL(url).origin) throw new Error('authentication page is outside the application origin');
  await page.locator(authentication.usernameSelector).fill(credentials.username);
  await page.locator(authentication.passwordSelector).fill(credentials.password);
  await page.locator(authentication.submitSelector).click();
  await page.waitForTimeout(350);
  if (new URL(page.url()).origin !== new URL(url).origin) throw new Error('authentication left the application origin');
  return { authenticated: await page.locator(authentication.successSelector).first().isVisible() };
}
export const formalAuthenticationCode = input => `async (page) => await (${runFormalAuthentication.toString()})(page, ${JSON.stringify(input)})`;
