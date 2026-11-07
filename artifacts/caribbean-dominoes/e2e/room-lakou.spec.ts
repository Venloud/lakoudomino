import { expect, test, type Page } from '@playwright/test';

const baseURL = process.env.DOMINO_E2E_BASE_URL;
test.skip(!baseURL, 'Set DOMINO_E2E_BASE_URL to a running 509 Yard preview to run the browser room test.');

async function postJson(path: string, body: unknown) {
  const response = await fetch(new URL(path, baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) as Record<string, any> : {};
}

test('four-player Domino table stays readable on desktop and phones', async ({ browser }) => {
  let code = '';
  const players: Array<{ name: string; token: string }> = [];
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];

  try {
    const created = await postJson('/api/rooms', {
      displayName: 'Four-seat host',
      mode: 'regular',
      playerCount: 4,
      rowLength: 10,
      rowBoxes: 8,
      twoPlayerVariant: 'draw',
      isPrivate: true,
    });
    code = String(created.code);
    expect(code).toBeTruthy();
    players.push({ name: 'Four-seat host', token: String(created.reconnectToken) });
    expect(players[0]!.token).toBeTruthy();

    for (const name of ['Four-seat player 2', 'Four-seat player 3', 'Four-seat player 4']) {
      const joined = await postJson(`/api/rooms/${code}`, { displayName: name });
      players.push({ name, token: String(joined.reconnectToken) });
      expect(players.at(-1)!.token).toBeTruthy();
    }
    await postJson(`/api/rooms/${code}/start`, { reconnectToken: players[0]!.token });

    const viewports = [
      { width: 1440, height: 960 },
      { width: 390, height: 844, isMobile: true, hasTouch: true },
      { width: 412, height: 915, isMobile: true, hasTouch: true },
      { width: 1280, height: 900 },
    ] as const;
    const pages: Page[] = [];
    for (let index = 0; index < players.length; index += 1) {
      const player = players[index]!;
      const viewport = viewports[index]!;
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        ...(viewport.width < 560 ? { isMobile: true, hasTouch: true } : {}),
      });
      contexts.push(context);
      await context.addInitScript(({ roomCode, reconnectToken, displayName }) => {
        sessionStorage.setItem(`dominoes-reconnect-${roomCode}`, reconnectToken);
        sessionStorage.setItem(`dominoes-display-name-${roomCode}`, displayName);
      }, { roomCode: code, reconnectToken: player.token, displayName: player.name });
      pages.push(await context.newPage());
    }

    await Promise.all(pages.map((page) => page.goto(`/room/${code}`)));

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      const viewport = viewports[index]!;
      await expect(page.locator('.lk-felt')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('group', { name: 'Turn status' })).toBeVisible();
      await expect(page.locator('.lk-hand')).toBeVisible();
      await expect(page.locator('.lk-hand .lk-mine')).toHaveCount(7);
      const seatSelector = viewport.width < 560 ? '.lk-sheet-row' : '.lk-pcard-head';
      await expect(page.locator(seatSelector)).toHaveCount(4);
      for (const player of players) {
        await expect(page.locator(seatSelector).filter({ hasText: player.name })).toHaveCount(1);
      }
      const board = await page.locator('.lk-felt').boundingBox();
      const hand = await page.locator('.lk-hand').boundingBox();
      expect(board).not.toBeNull();
      expect(hand).not.toBeNull();
      expect(board!.x).toBeGreaterThanOrEqual(0);
      expect(board!.x + board!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(hand!.x).toBeGreaterThanOrEqual(0);
      expect(hand!.x + hand!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width + 1);
    }

    await expect.poll(async () =>
      (await Promise.all(pages.map((page) => page.locator('.lk-turn-copy b').innerText())))
        .filter((line) => line.startsWith('Your turn')).length,
    { timeout: 20_000 }).toBe(1);

    const activeIndex = (await Promise.all(
      pages.map((page) => page.locator('.lk-turn-copy b').innerText()),
    )).findIndex((line) => line.startsWith('Your turn'));
    const activePage = pages[activeIndex]!;
    const tile = activePage.locator('.lk-mine:not(:disabled)').first();
    const laidBefore = await activePage.locator('.lk-laid').count();
    const activateTile = () => viewports[activeIndex]!.width < 560 ? tile.tap() : tile.click();
    await activateTile();
    if (await activePage.locator('.lk-laid').count() === laidBefore) {
      const placements = activePage.locator('.lk-ghost');
      if (await placements.count()) {
        if (viewports[activeIndex]!.width < 560) await placements.first().tap();
        else await placements.first().click();
      } else {
        await activateTile();
      }
    }
    await expect(activePage.locator('.lk-laid')).toHaveCount(laidBefore + 1, { timeout: 15_000 });
  } finally {
    if (code) {
      for (const player of players) {
        await postJson(`/api/rooms/${code}/leave`, { reconnectToken: player.token }).catch(() => {});
      }
    }
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (code) {
      await expect.poll(async () => {
        const response = await fetch(new URL(`/api/rooms/${code}`, baseURL));
        return response.status;
      }, { timeout: 8_000 }).toBe(404);
    }
  }
});
