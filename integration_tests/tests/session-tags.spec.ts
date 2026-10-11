import { test, expect, Page } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import { setupPairedCli } from '../helpers/pairing';
import { spawnDevseshStart, waitForSessionInApi, killTmuxSession } from '../helpers/session';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Session tags: editing them in the Details pane, showing them in the Sessions
 * pane and the dashboard, and filtering both lists by tag.
 *
 * Each test gets its own server, its own sessions and its own private tmux
 * server, so the tests can run in parallel.
 */

interface Ctx {
  server: ServerInstance;
  token: string;
  tempDir: string;
  sessionDir: string;
  // In creation order, so seq is 0, 1, 2, ...
  sessions: { id: string; name: string }[];
}

async function setup(page: Page, label: string, count: number): Promise<Ctx> {
  const server = await startServer();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `devsesh-tags-${label}-`));
  const configPath = path.join(tempDir, 'config.yml');
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const token = await setupPairedCli(page, server.url, `tags-${label}-${Date.now()}@example.com`, configPath, sessionDir);
  const sessions: Ctx['sessions'] = [];
  for (let i = 0; i < count; i++) {
    const name = `tag-${label}-${i}-${Date.now()}`;
    spawnDevseshStart(name, configPath, sessionDir, server.url, true);
    const s = await waitForSessionInApi(server.url, token, name, 60000);
    sessions.push({ id: s.id, name });
  }
  return { server, token, tempDir, sessionDir, sessions };
}

async function teardown(ctx: Ctx | undefined) {
  if (!ctx) return;
  for (const s of ctx.sessions) await killTmuxSession(s.name, ctx.sessionDir);
  await stopServer(ctx.server);
  if (fs.existsSync(ctx.tempDir)) fs.rmSync(ctx.tempDir, { recursive: true, force: true });
}

const auth = (ctx: Ctx) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` });

async function apiSessions(ctx: Ctx): Promise<{ id: string; seq: number; tags: string[] }[]> {
  const r = await fetch(`${ctx.server.url}/api/v1/sessions`, { headers: auth(ctx) });
  return r.json();
}

async function apiPutTags(ctx: Ctx, id: string, body: unknown) {
  const r = await fetch(`${ctx.server.url}/api/v1/sessions/${id}/tags`, {
    method: 'PUT',
    headers: auth(ctx),
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}

async function tagsOf(ctx: Ctx, id: string): Promise<string[]> {
  return (await apiSessions(ctx)).find((s) => s.id === id)!.tags;
}

async function seqOf(ctx: Ctx): Promise<Record<string, number>> {
  return Object.fromEntries((await apiSessions(ctx)).map((s) => [s.id, s.seq]));
}

async function openSessionPage(page: Page, ctx: Ctx, id: string) {
  await page.goto(`${ctx.server.url}/sessions/${id}`);
  await expect(page.getByTestId('session-detail-panel')).toBeVisible({ timeout: 15000 });
}

const panelOf = (page: Page) => page.getByTestId('session-detail-panel');

async function openSessionsTab(page: Page) {
  await panelOf(page).getByRole('tab', { name: 'Sessions' }).click();
}

async function addTag(page: Page, tag: string) {
  const input = panelOf(page).getByTestId('tag-input');
  await input.fill(tag);
  await input.press('Enter');
}

async function toggleFilterTag(page: Page, tag: string) {
  await page.getByTestId('tag-filter-button').click();
  await page.getByTestId(`tag-filter-option-${tag}`).click();
  // Close the dropdown so it does not cover the list.
  await page.keyboard.press('Escape');
}

// Row numbers shown in the Sessions pane, top to bottom, as "<index>:<session id>".
async function paneRows(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="session-item-"]').evaluateAll((rows) =>
    rows.map((r) => {
      const idx = r.querySelector('[data-ui="session-index"]')?.textContent?.trim() ?? '?';
      return `${idx}:${(r.getAttribute('data-testid') ?? '').replace('session-item-', '')}`;
    })
  );
}

// Dashboard row order (session ids, top to bottom).
async function dashboardOrder(page: Page): Promise<string[]> {
  return page.locator('tbody a[href^="/sessions/"]').evaluateAll((els) =>
    els.map((e) => (e.getAttribute('href') || '').replace('/sessions/', ''))
  );
}

// Native HTML5 drag of one Sessions-pane row onto another, driven with the same
// events a browser fires.
async function dragRow(page: Page, fromId: string, toId: string) {
  const from = page.getByTestId(`session-item-${fromId}`);
  const to = page.getByTestId(`session-item-${toId}`);
  const handle = from.locator('[aria-label="Drag to reorder"]');
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  await to.dispatchEvent('dragenter', { dataTransfer: dt });
  await to.dispatchEvent('dragover', { dataTransfer: dt });
  await to.dispatchEvent('drop', { dataTransfer: dt });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
}

test.describe('Session tags', () => {
  test('tags are edited in the Details pane, persist, and show in the Sessions pane', async ({ page }) => {
    test.setTimeout(150000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'edit', 2);
      const [a, b] = ctx.sessions;
      await openSessionPage(page, ctx, a.id);

      // Add a plain tag and an emoji tag (trimmed on the way in).
      await addTag(page, '  work ');
      await expect(panelOf(page).getByTestId('tag-chip-work')).toBeVisible();
      await addTag(page, '🔥 urgent');
      await expect(panelOf(page).getByTestId('tag-chip-🔥 urgent')).toBeVisible();
      await expect(panelOf(page).getByTestId('tag-input')).toHaveValue('');

      // Stored in the database, in order, and still there after a reload.
      await expect.poll(() => tagsOf(ctx!, a.id)).toEqual(['work', '🔥 urgent']);
      await page.reload();
      await expect(panelOf(page).getByTestId('tag-chip-work')).toBeVisible({ timeout: 15000 });
      await expect(panelOf(page).getByTestId('tag-chip-🔥 urgent')).toBeVisible();
      expect(await tagsOf(ctx, b.id)).toEqual([]);

      // The Sessions pane shows the tags on A's row and none on B's.
      await openSessionsTab(page);
      const rowA = page.getByTestId(`session-item-${a.id}`);
      await expect(rowA.getByText('work', { exact: true })).toBeVisible();
      await expect(rowA.getByText('🔥 urgent', { exact: true })).toBeVisible();
      await expect(page.getByTestId(`session-item-${b.id}`).getByTestId('tag-chips')).toHaveCount(0);

      // Removing a tag from the Details pane updates storage and the list.
      await panelOf(page).getByRole('tab', { name: 'Details' }).click();
      await panelOf(page).getByLabel('Remove tag work').click();
      await expect(panelOf(page).getByTestId('tag-chip-work')).toHaveCount(0);
      await expect.poll(() => tagsOf(ctx!, a.id)).toEqual(['🔥 urgent']);
    } finally {
      await teardown(ctx);
    }
  });

  test('rejected tags show an error and change nothing; the API normalizes and validates', async ({ page }) => {
    test.setTimeout(150000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'valid', 1);
      const [a] = ctx.sessions;
      await openSessionPage(page, ctx, a.id);
      await addTag(page, 'Work');
      await expect(panelOf(page).getByTestId('tag-chip-Work')).toBeVisible();

      // Each of these is refused in the form with a message.
      for (const bad of ['a,b', 'WORK', 'x'.repeat(33)]) {
        await addTag(page, bad);
        await expect(panelOf(page).getByTestId('tag-error')).toBeVisible();
      }
      await expect(panelOf(page).getByTestId('tag-input')).not.toHaveValue('');
      expect(await tagsOf(ctx, a.id)).toEqual(['Work']);

      // The server enforces the same rules and normalizes what it accepts.
      expect((await apiPutTags(ctx, a.id, { tags: ['a,b'] })).status).toBe(400);
      expect((await apiPutTags(ctx, a.id, { tags: [''] })).status).toBe(400);
      expect((await apiPutTags(ctx, a.id, { tags: ['x'.repeat(33)] })).status).toBe(400);
      expect((await apiPutTags(ctx, a.id, {})).status).toBe(400);
      expect((await apiPutTags(ctx, a.id, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
      expect(await tagsOf(ctx, a.id)).toEqual(['Work']);

      const ok = await apiPutTags(ctx, a.id, { tags: ['  Spaced  ', 'spaced', '🚀'] });
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.text)).toEqual({ tags: ['Spaced', '🚀'] });
      expect(await tagsOf(ctx, a.id)).toEqual(['Spaced', '🚀']);

      // An unknown session is not found, and a missing token is refused.
      const unknown = await fetch(`${ctx.server.url}/api/v1/sessions/does-not-exist/tags`, {
        method: 'PUT',
        headers: auth(ctx),
        body: JSON.stringify({ tags: [] }),
      });
      expect([403, 404]).toContain(unknown.status);
      const anon = await fetch(`${ctx.server.url}/api/v1/sessions/${a.id}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [] }),
      });
      expect(anon.status).toBe(401);
    } finally {
      await teardown(ctx);
    }
  });

  test('a tag change shows up live in another open page', async ({ page }) => {
    test.setTimeout(150000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'live', 2);
      const [a, b] = ctx.sessions;

      // Page 2 watches from session B's page, with the Sessions tab open.
      const page2 = await page.context().newPage();
      await openSessionPage(page2, ctx, b.id);
      await openSessionsTab(page2);
      const rowA2 = page2.getByTestId(`session-item-${a.id}`);
      await expect(rowA2).toBeVisible({ timeout: 15000 });
      await expect(rowA2.getByTestId('tag-chips')).toHaveCount(0);

      // Page 1 edits A's tags; page 2 updates without a reload.
      await openSessionPage(page, ctx, a.id);
      await addTag(page, 'late');
      await expect(rowA2.getByText('late', { exact: true })).toBeVisible({ timeout: 15000 });
      await panelOf(page).getByLabel('Remove tag late').click();
      await expect(rowA2.getByTestId('tag-chips')).toHaveCount(0, { timeout: 15000 });
      await page2.close();
    } finally {
      await teardown(ctx);
    }
  });

  test('the Sessions pane filter shows sessions with ANY selected tag and renumbers without gaps', async ({ page }) => {
    test.setTimeout(180000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'filter', 4);
      const [a, b, c, d] = ctx.sessions;
      expect((await apiPutTags(ctx, a.id, { tags: ['work'] })).status).toBe(200);
      expect((await apiPutTags(ctx, b.id, { tags: ['home'] })).status).toBe(200);
      expect((await apiPutTags(ctx, c.id, { tags: ['work', 'ops'] })).status).toBe(200);
      // d has no tags.
      const seqBefore = await seqOf(ctx);
      expect(seqBefore).toEqual({ [a.id]: 0, [b.id]: 1, [c.id]: 2, [d.id]: 3 });

      await openSessionPage(page, ctx, a.id);
      await openSessionsTab(page);
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${b.id}`, `3:${c.id}`, `4:${d.id}`]);
      await expect(page.getByTestId('filter-summary')).toHaveCount(0);

      // Filter by "work": B and D are hidden and the rest are renumbered 1, 2.
      await toggleFilterTag(page, 'work');
      await expect(page.getByTestId('tag-filter-count')).toHaveText('1');
      await expect(page.getByTestId('filter-summary')).toHaveText('2 of 4');
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${c.id}`]);

      // The stored order did not change.
      expect(await seqOf(ctx)).toEqual(seqBefore);

      // Add "home": ANY of the two, so B comes back, numbered by position.
      await toggleFilterTag(page, 'home');
      await expect(page.getByTestId('filter-summary')).toHaveText('3 of 4');
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${b.id}`, `3:${c.id}`]);

      // Only "ops": just C, which becomes number 1.
      await toggleFilterTag(page, 'work');
      await toggleFilterTag(page, 'home');
      await toggleFilterTag(page, 'ops');
      expect(await paneRows(page)).toEqual([`1:${c.id}`]);
      expect(await seqOf(ctx)).toEqual(seqBefore);

      // Clearing from the dropdown restores the full list.
      await page.getByTestId('tag-filter-button').click();
      await page.getByTestId('tag-filter-clear').click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('tag-filter-count')).toHaveCount(0);
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${b.id}`, `3:${c.id}`, `4:${d.id}`]);
    } finally {
      await teardown(ctx);
    }
  });

  test('the filter is remembered across reloads and shared with the dashboard', async ({ page }) => {
    test.setTimeout(150000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'persist', 3);
      const [a, b, c] = ctx.sessions;
      await apiPutTags(ctx, a.id, { tags: ['work'] });
      await apiPutTags(ctx, c.id, { tags: ['work'] });
      await apiPutTags(ctx, b.id, { tags: ['home'] });

      await openSessionPage(page, ctx, a.id);
      await openSessionsTab(page);
      await toggleFilterTag(page, 'work');
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${c.id}`]);

      // Survives a reload (it is saved in the browser).
      await page.reload();
      await expect(panelOf(page)).toBeVisible({ timeout: 15000 });
      await openSessionsTab(page);
      await expect(page.getByTestId('tag-filter-count')).toHaveText('1');
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${c.id}`]);

      // The dashboard applies the same filter.
      await page.goto(`${ctx.server.url}/dashboard`);
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
      expect(await dashboardOrder(page)).toEqual([a.id, c.id]);
      await expect(page.getByTestId('tag-filter-count')).toHaveText('1');

      // Once no session has the tag any more, the saved filter is ignored
      // instead of leaving an empty list nobody can explain.
      await apiPutTags(ctx, a.id, { tags: [] });
      await apiPutTags(ctx, c.id, { tags: [] });
      await page.reload();
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
      expect(await dashboardOrder(page)).toEqual([a.id, b.id, c.id]);
      await expect(page.getByTestId('tag-filter-count')).toHaveCount(0);
    } finally {
      await teardown(ctx);
    }
  });

  test('reordering a filtered list keeps hidden sessions in place', async ({ page }) => {
    test.setTimeout(180000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'reorder', 4);
      const [a, b, c, d] = ctx.sessions;
      await apiPutTags(ctx, a.id, { tags: ['work'] });
      await apiPutTags(ctx, c.id, { tags: ['work'] });
      await apiPutTags(ctx, d.id, { tags: ['work'] });
      // b is hidden by the filter below. Order is a, b, c, d.

      await openSessionPage(page, ctx, a.id);
      await openSessionsTab(page);
      await toggleFilterTag(page, 'work');
      expect(await paneRows(page)).toEqual([`1:${a.id}`, `2:${c.id}`, `3:${d.id}`]);
      const seqBefore = await seqOf(ctx);

      // Nothing is stored just from filtering. Drag D above A.
      await dragRow(page, d.id, a.id);
      await expect.poll(() => paneRows(page)).toEqual([`1:${d.id}`, `2:${a.id}`, `3:${c.id}`]);

      // The visible sessions reordered among their own slots (0, 2, 3); B kept slot 1.
      await expect.poll(() => seqOf(ctx!)).toEqual({ [d.id]: 0, [b.id]: 1, [a.id]: 2, [c.id]: 3 });
      expect(seqBefore).toEqual({ [a.id]: 0, [b.id]: 1, [c.id]: 2, [d.id]: 3 });

      // With the filter cleared the full list shows that order.
      await page.getByTestId('tag-filter-button').click();
      await page.getByTestId('tag-filter-clear').click();
      await page.keyboard.press('Escape');
      expect(await paneRows(page)).toEqual([`1:${d.id}`, `2:${b.id}`, `3:${a.id}`, `4:${c.id}`]);
    } finally {
      await teardown(ctx);
    }
  });

  test('the dashboard shows tags and has the same filter', async ({ page }) => {
    test.setTimeout(150000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'dash', 3);
      const [a, b, c] = ctx.sessions;
      await apiPutTags(ctx, a.id, { tags: ['work', '🔥'] });
      await apiPutTags(ctx, b.id, { tags: ['home'] });
      // c has no tags.

      await page.goto(`${ctx.server.url}/dashboard`);
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
      const rowOf = (id: string) => page.locator('tbody tr', { has: page.locator(`a[href="/sessions/${id}"]`) });
      await expect(rowOf(a.id).getByText('work', { exact: true })).toBeVisible();
      await expect(rowOf(a.id).getByText('🔥', { exact: true })).toBeVisible();
      await expect(rowOf(b.id).getByText('home', { exact: true })).toBeVisible();
      await expect(rowOf(c.id).getByTestId('tag-chips')).toHaveCount(0);

      // Filter to "home": one row, with a summary.
      await toggleFilterTag(page, 'home');
      expect(await dashboardOrder(page)).toEqual([b.id]);
      await expect(page.getByTestId('filter-summary')).toHaveText('1 of 3');

      // Two tags means ANY of them.
      await toggleFilterTag(page, '🔥');
      expect(await dashboardOrder(page)).toEqual([a.id, b.id]);

      // Clearing shows all three again, in the stored order.
      await page.getByTestId('tag-filter-button').click();
      await page.getByTestId('tag-filter-clear').click();
      await page.keyboard.press('Escape');
      expect(await dashboardOrder(page)).toEqual([a.id, b.id, c.id]);

      // A tag edited elsewhere reaches the open dashboard live.
      const page2 = await page.context().newPage();
      await openSessionPage(page2, ctx, c.id);
      await addTag(page2, 'fresh');
      await expect(rowOf(c.id).getByText('fresh', { exact: true })).toBeVisible({ timeout: 15000 });
      await page2.close();
    } finally {
      await teardown(ctx);
    }
  });

  test('the Sessions pane has "+" and the filter funnel on one line; New session is no longer above the tabs', async ({ page }) => {
    test.setTimeout(150000);
    let ctx: Ctx | undefined;
    try {
      ctx = await setup(page, 'layout', 1);
      const [a] = ctx.sessions;
      await openSessionPage(page, ctx, a.id);
      const panel = panelOf(page);

      // On the Details tab there is no New session button at all.
      await expect(panel.getByRole('button', { name: 'New session' })).toHaveCount(0);

      await openSessionsTab(page);
      const plus = panel.getByRole('button', { name: 'New session' });
      const funnel = panel.getByTestId('tag-filter-button');
      await expect(plus).toBeVisible();
      await expect(funnel).toBeVisible();

      // Icon only: no visible label on the "+" button.
      expect((await plus.innerText()).trim()).toBe('');

      // Same line, "+" to the left of the funnel.
      const [pb, fb] = [(await plus.boundingBox())!, (await funnel.boundingBox())!];
      expect(Math.abs(pb.y + pb.height / 2 - (fb.y + fb.height / 2))).toBeLessThan(2);
      expect(pb.x).toBeLessThan(fb.x);

      // And the "+" opens the new-session dialog.
      await plus.click();
      await expect(page.getByRole('dialog', { name: 'New session' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('dialog', { name: 'New session' })).toHaveCount(0);
    } finally {
      await teardown(ctx);
    }
  });
});
