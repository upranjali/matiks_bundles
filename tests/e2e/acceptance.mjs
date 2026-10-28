// End-to-end acceptance run against the real app + database (PostgREST stand-in for Supabase).
// Usage: APP=http://localhost:5174 GW=http://localhost:54321 SHOTS=/path node tests/e2e/acceptance.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const APP = process.env.APP ?? 'http://localhost:5174';
const GW = process.env.GW ?? 'http://localhost:54321';
const SHOTS = process.env.SHOTS ?? '.';
const results = [];
const pages = {};
let failN = 0;
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); console.log('PASS', name); } catch (e) {
  results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 3).join(' | '));
  failN++; for (const [k, pg] of Object.entries(pages)) { try { await pg.screenshot({ path: `${SHOTS}/fail${failN}-${k}.png`, fullPage: true }); } catch {} }
} };

const browser = await chromium.launch();
async function adminContext(email = 'pranjali@matiks.com') {
  const session = await (await fetch(`${GW}/mint?email=${encodeURIComponent(email)}`)).json();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), session);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  return { ctx, token: session.access_token };
}
const anonKey = await (await fetch(`${GW}/anonkey`)).text();
const rest = (path, token, init = {}) => fetch(`${GW}/rest/v1/${path}`, { ...init, headers: { apikey: anonKey, authorization: `Bearer ${token ?? anonKey}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
const errors = [];

// ── unauthorized
await step('Signed-out visitors get the sign-in page, not admin data', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(APP);
  await p.getByRole('heading', { name: 'Admin sign-in' }).waitFor();
  assert.equal(await p.getByText('Weekly inspo').count(), 0);
  await p.getByLabel('Work email').fill('someone@gmail.com');
  await p.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await p.getByText('If someone@gmail.com is a Creator Hub admin').waitFor();
  await ctx.close();
});
await step('Direct API requests without admin sign-in are refused', async () => {
  for (const t of ['records', 'bundles', 'bundle_briefs', 'bundle_versions', 'creators', 'creator_links', 'admins', 'brief_comments']) {
    const r = await rest(`${t}?select=*`);
    assert.ok(r.status === 401 || r.status === 403, `${t} returned ${r.status}`);
  }
  const r = await rest('rpc/admin_preview_feed', undefined, { method: 'POST', body: '{"p_creator":"00000000-0000-0000-0000-000000000000"}' });
  assert.ok(r.status >= 400);
});
await step('A signed-in non-admin sees no data', async () => {
  const { ctx, token } = await adminContext('someone@gmail.com');
  const p = await ctx.newPage();
  await p.goto(APP);
  await p.getByRole('heading', { name: 'No admin access' }).waitFor();
  assert.deepEqual(await (await rest('records?select=id&limit=5', token)).json(), []);
  await ctx.close();
});

// ── admin library
const { ctx: adm } = await adminContext();
const a = await adm.newPage();
a.on('pageerror', (e) => errors.push('admin: ' + e.message));
pages.admin = a;
a.on('console', (m) => { if (m.type() === 'error') console.log('   [admin console]', m.text().slice(0, 200)); });
await step('Admin sees the imported library; Week 20 is current', async () => {
  await a.goto(APP);
  await a.getByText('Signed in as pranjali@matiks.com').waitFor();
  assert.equal(await a.locator('#week-select').inputValue(), '20');
  await a.locator('#week-select').selectOption('19');
  await a.getByText(/records in week 19/).waitFor();
  const t = await a.locator('.archive-count').textContent();
  assert.match(t, /^\d+ records in week 19/);
});
await step('Week 20 bundles are empty; historical weeks show their sheet bundles', async () => {
  await a.getByRole('button', { name: 'Bundles', exact: true }).click();
  await a.locator('#week-select').selectOption('20');
  await a.getByRole('heading', { name: 'Week 20 is a blank canvas' }).first().waitFor();
  await a.locator('#week-select').selectOption('18');
  await a.getByText(/\d+ records in week 18/).waitFor();
  assert.match(await a.locator('.archive-count').textContent(), /^(?!0 )\d+ records in week 18/);
});
await step('Personas are separate from formats (Unhinged / Hot girl / Gameplays filters)', async () => {
  await a.getByRole('button', { name: 'Personas', exact: true }).click();
  await a.getByText(/records in pages library/).waitFor();
  await a.locator('.chip-row').getByRole('button', { name: 'Gameplays' }).click();
  const n = Number((await a.locator('.archive-count').textContent()).split(' ')[0]);
  assert.ok(n > 0, 'no Gameplays records');
  assert.ok(await a.locator('.archive-controls label', { hasText: 'Format' }).count() > 0);
});
await step('Flagged rows and unmapped source cells are visible', async () => {
  await a.getByRole('button', { name: 'Weekly inspo' }).click();
  await a.locator('#week-select').selectOption('18');
  await a.getByRole('button', { name: /Needs mapping review/ }).click();
  await a.locator('.archive-card').first().getByText('Check mapping').waitFor();
  await a.locator('.archive-card').first().getByText('Read source details').click();
  await a.locator('.archive-card').first().locator('.archive-source').first().waitFor();
});
await step('Edits save online and survive a reload on another device', async () => {
  await a.locator('.archive-card').first().getByRole('button', { name: 'Edit' }).click();
  const title = a.locator('.archive-card').first().locator('input[name="title"]');
  await title.fill('Edited from device A');
  await a.locator('.archive-card').first().getByRole('button', { name: 'Save', exact: true }).click();
  await a.getByText('Saved').first().waitFor();
  const { ctx } = await adminContext('meenal@matiks.com');
  const p2 = await ctx.newPage();
  await p2.goto(APP);
  await p2.locator('#week-select').selectOption('18');
  await p2.getByPlaceholder('Hook, reference or note').fill('Edited from device A');
  await p2.getByRole('heading', { name: 'Edited from device A' }).waitFor();
  await ctx.close();
});

// ── import link
const TT = 'https://www.tiktok.com/@testcreator/video/7700000000000000001';
await step('Import link saves immediately even when details can’t be fetched', async () => {
  await a.locator('#week-select').selectOption('20');
  await a.getByLabel('Instagram, TikTok, YouTube or any link').fill(TT);
  await a.getByText(/tiktok · single video or post · @testcreator/).waitFor();
  await a.getByRole('button', { name: 'Add reference' }).click();
  await a.getByText(/The platform didn’t share details/).waitFor();
  await a.getByPlaceholder('Hook, reference or note').fill('testcreator');
  await a.getByText(/^1 records in week 20/).waitFor();
});
await step('Pasting the same link again warns and offers to attach instead of duplicating', async () => {
  await a.getByLabel('Instagram, TikTok, YouTube or any link').fill(TT + '?is_from_webapp=1');
  await a.getByRole('button', { name: 'Add reference' }).click();
  await a.getByText('Already in the library').waitFor();
  await a.locator('form').filter({ hasText: 'Already in the library' }).locator('select[name="persona"]').selectOption('Unhinged');
  await a.getByRole('button', { name: /Attach it to the week\/persona/ }).click();
  await a.getByText('Attached').waitFor();
});
await step('Bad links are rejected with a clear message', async () => {
  await a.getByLabel('Instagram, TikTok, YouTube or any link').fill('https://iktok.com/@x/video/1');
  await a.getByRole('button', { name: 'Add reference' }).click();
  await a.getByText(/looks misspelled/).waitFor();
  await a.getByLabel('Instagram, TikTok, YouTube or any link').fill('');
});

// ── creators, bundles, publishing
const links = {};
await step('Create two test creators and their private links', async () => {
  await a.getByRole('button', { name: 'Creators', exact: true }).click();
  for (const name of ['Test creator A', 'Test creator B']) {
    await a.getByLabel('Name shown on their page').fill(name);
    await a.getByRole('button', { name: 'Add creator' }).click();
    await a.getByText(name, { exact: true }).waitFor();
    const card = a.locator('.assign-group').filter({ hasText: name });
    await card.getByRole('button', { name: 'Create link' }).click();
    links[name] = (await card.locator('.link-box').textContent()).trim();
    assert.match(links[name], /\/c#[A-Za-z0-9_-]{43}$/);
  }
  assert.equal(await a.getByText('Real person').count(), 0);
});
await step('Draft Week 20 Bundle 1, assign both creators, publish v1', async () => {
  await a.getByRole('button', { name: 'Bundles', exact: true }).click();
  await a.locator('#week-select').selectOption('20');
  await a.getByRole('button', { name: '+ Bundle 1' }).click();
  await a.getByText('Draft · not published').waitFor();
  await a.locator('textarea[name="pi"]').fill('Subtitles on every video. Put this link in your bio: Brain Rot Meter.');
  await a.getByRole('button', { name: 'Save details' }).click();
  await a.getByRole('button', { name: '+ Blank brief' }).click();
  const brief = a.locator('.brief-edit').first();
  await brief.locator('input[name="format"]').fill('Long text');
  await brief.locator('input[name="title"]').fill('He forgot our 7 year anniversary');
  await brief.locator('textarea[name="inspo"]').fill('https://www.instagram.com/p/DeuCce9Ps8n/');
  await brief.locator('textarea[name="script"]').fill('chat. he forgot our 7 year anniversary.');
  await brief.locator('textarea[name="caption"]').fill('the silence was louder than the argument #matiks');
  await brief.locator('textarea[name="internal_notes"]').fill('INTERNAL do not show creators');
  await brief.getByRole('button', { name: 'Save brief' }).click();
  await a.getByText('Saved').first().waitFor();
  await a.locator('.creator-pill', { hasText: 'Test creator A' }).click();
  await a.locator('.creator-pill', { hasText: 'Test creator B' }).click();
  await a.getByRole('button', { name: 'Save assignments' }).click();
  await a.getByText('Assignments saved').waitFor();
  await a.getByRole('button', { name: 'Publish', exact: true }).click();
  await a.getByRole('button', { name: 'Yes' }).click();
  await a.getByText('Published v1').first().waitFor();
});

const ca = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ca.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
const pa = await ca.newPage();
pa.on('pageerror', (e) => errors.push('creatorA: ' + e.message));
pages.creator = pa;
await step('Creator A opens their link with no account and sees only their brief', async () => {
  await pa.goto(links['Test creator A']);
  await pa.getByRole('heading', { name: 'Hi Test creator A' }).waitFor();
  await pa.getByText('chat. he forgot our 7 year anniversary.').first().waitFor();
  const html = await pa.content();
  assert.ok(!html.includes('INTERNAL do not show'), 'internal note leaked');
  assert.ok(!html.includes('Test creator B'), 'other creator leaked');
  assert.ok(!html.includes('Weekly inspo'), 'admin UI leaked');
});
await step('Copy caption gives success feedback', async () => {
  await pa.getByRole('button', { name: 'Copy caption' }).click();
  await pa.getByRole('button', { name: 'Copied ✓' }).waitFor();
  assert.equal(await pa.evaluate(() => navigator.clipboard.readText()), 'the silence was louder than the argument #matiks');
});
await step('Creator A saves done, a comment and progress', async () => {
  await pa.getByRole('button', { name: 'Mark done' }).click();
  await pa.getByText('Done ✓').first().waitFor();
  await pa.getByLabel('Question or note for the Matiks team').fill('<img src=x onerror=alert(1)> can I use my own audio?');
  await pa.getByRole('button', { name: 'Send comment' }).click();
  await pa.getByText('can I use my own audio?').waitFor();
  assert.equal(await pa.locator('img[src="x"]').count(), 0, 'comment rendered as HTML');
  await pa.getByRole('button', { name: 'Filming' }).click();
  await pa.locator('.step-now', { hasText: 'Filming' }).waitFor();
  assert.ok(await pa.getByRole('button', { name: 'Approved' }).isDisabled());
  await pa.getByRole('button', { name: 'Got it' }).click();
});
await step('Creator B shares the bundle but has separate (empty) progress and comments', async () => {
  const cb = await browser.newContext();
  const pb = await cb.newPage();
  await pb.goto(links['Test creator B']);
  await pb.getByRole('heading', { name: 'Hi Test creator B' }).waitFor();
  assert.equal(await pb.getByText('can I use my own audio?').count(), 0);
  assert.equal(await pb.getByText('Done ✓').count(), 0);
  assert.equal(await pb.locator('.step-now').count(), 0);
  await cb.close();
});
await step('Creator A’s link cannot change Creator B’s records via the API', async () => {
  const tokA = links['Test creator A'].split('#')[1];
  const tokB = links['Test creator B'].split('#')[1];
  const feedB = await (await rest('rpc/creator_feed', undefined, { method: 'POST', body: JSON.stringify({ p_token: tokB }) })).json();
  const bundle = feedB.bundles[0];
  const r = await rest('rpc/creator_set_done', undefined, { method: 'POST', body: JSON.stringify({ p_token: tokA, p_bundle: bundle.bundle_id, p_brief: bundle.content.briefs[0].key, p_done: false }) });
  assert.equal(r.status, 200); // A is also assigned this bundle, so this only touches A's own row:
  const feedB2 = await (await rest('rpc/creator_feed', undefined, { method: 'POST', body: JSON.stringify({ p_token: tokB }) })).json();
  assert.deepEqual(feedB2.bundles[0].progress, []);
  const bad = await rest('rpc/creator_set_done', undefined, { method: 'POST', body: JSON.stringify({ p_token: 'x'.repeat(43), p_bundle: bundle.bundle_id, p_brief: bundle.content.briefs[0].key, p_done: true }) });
  assert.ok(bad.status >= 400);
  // restore A's done mark
  await rest('rpc/creator_set_done', undefined, { method: 'POST', body: JSON.stringify({ p_token: tokA, p_bundle: bundle.bundle_id, p_brief: bundle.content.briefs[0].key, p_done: true }) });
});
await step('Admin sees the saved comment, done mark and progress', async () => {
  await a.reload();
  await a.getByRole('button', { name: 'Bundles', exact: true }).click();
  await a.locator('#week-select').selectOption('20');
  await a.locator('.brief-edit summary').first().click();
  await a.getByText('can I use my own audio?').waitFor();
  await a.getByText('Test creator A: done').waitFor();
  await a.locator('.creator-pill', { hasText: /Test creator A \(test\) · Filming/ }).waitFor();
});
await step('Publishing a revision gives an update notice; v1 stays unchanged', async () => {
  const brief = a.locator('.brief-edit').first();
  await brief.locator('textarea[name="caption"]').fill('UPDATED caption #matiks');
  await brief.getByRole('button', { name: 'Save brief' }).click();
  await a.getByText('Edited since last publish').waitFor();
  await a.getByText(/Updated:.*\(Caption\)/).waitFor();
  await a.getByLabel('Note to creators (optional)').fill('Fixed the caption');
  await a.getByRole('button', { name: 'Publish update' }).click();
  await a.getByRole('button', { name: 'Yes' }).click();
  await a.getByText('Published v2').first().waitFor();
  await a.getByText(/v1 · .*by pranjali@matiks.com/).waitFor();
  await pa.reload();
  await pa.getByText('Updated to v2').waitFor();
  await pa.getByText('Fixed the caption').waitFor();
  await pa.locator('.brief-flag.updated').waitFor();
  await pa.getByText('Done · changed since').waitFor();
  await pa.getByText('UPDATED caption #matiks').waitFor();
});
await step('Creator page picks up a new publish automatically (no reload)', async () => {
  await pa.clock?.install?.();
  const brief = a.locator('.brief-edit').first();
  await brief.locator('textarea[name="audio"]').fill('Original audio');
  await brief.getByRole('button', { name: 'Save brief' }).click();
  await a.getByText('Edited since last publish').waitFor();
  await a.getByRole('button', { name: 'Publish update' }).click();
  await a.getByRole('button', { name: 'Yes' }).click();
  await a.getByText('Published v3').first().waitFor();
  await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pa.getByText('New briefs or updates were just published').waitFor({ timeout: 10000 });
  await pa.getByText('Original audio').first().waitFor();
});
await step('Admin “Creator view” preview matches the creator’s link', async () => {
  await a.getByRole('tab', { name: 'Creator view' }).click();
  await a.getByRole('button', { name: 'Test creator A' }).click();
  await a.getByText('UPDATED caption #matiks').waitFor();
  await a.getByRole('tab', { name: 'Admin view' }).click();
});
await step('Revoked links stop working', async () => {
  await a.getByRole('button', { name: 'Creators', exact: true }).click();
  const card = a.locator('.assign-group').filter({ hasText: 'Test creator B' });
  await card.getByRole('button', { name: 'Revoke' }).click();
  await card.getByRole('button', { name: 'Yes' }).click();
  await card.getByText('No active link').waitFor();
  const cb = await browser.newContext();
  const pb = await cb.newPage();
  await pb.goto(links['Test creator B']);
  await pb.getByRole('heading', { name: 'Link not active' }).waitFor();
  await cb.close();
});
await step('Mobile 320px and 390px: no sideways scrolling, controls fit', async () => {
  for (const width of [320, 390]) {
    for (const [name, page] of [['admin', a], ['creator', pa]]) {
      await page.setViewportSize({ width, height: 800 });
      if (name === 'admin') await a.getByRole('button', { name: 'Bundles', exact: true }).click();
      await page.waitForTimeout(300);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= width, `${name} at ${width}px scrolls sideways (${sw}px)`);
      await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: false });
    }
  }
  await a.setViewportSize({ width: 1280, height: 900 });
  await pa.setViewportSize({ width: 1280, height: 900 });
  await pa.screenshot({ path: `${SHOTS}/creator-1280.png`, fullPage: true });
  await a.getByRole('button', { name: 'Weekly inspo' }).click();
  await a.screenshot({ path: `${SHOTS}/admin-1280.png` });
});
await step('Keyboard: Tab moves focus to controls with a visible outline', async () => {
  await pa.keyboard.press('Tab'); await pa.keyboard.press('Tab');
  const outline = await pa.evaluate(() => { const el = document.activeElement; return el && el !== document.body ? getComputedStyle(el).outlineStyle : 'none'; });
  assert.notEqual(outline, 'none');
});
await step('No script errors in any page', async () => { assert.deepEqual(errors, []); });

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
