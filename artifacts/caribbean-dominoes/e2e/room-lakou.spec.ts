import { expect, test } from '@playwright/test';

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

test('live Domino table fits desktop and phone and accepts a tile', async ({ browser }) => {
  let code = '';
  let hostToken = '';
  let guestToken = '';
  let hostContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let guestContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    const created = await postJson('/api/rooms', {
      displayName: 'Browser test host',
      mode: 'regular',
      playerCount: 2,
      rowLength: 10,
      rowBoxes: 8,
      twoPlayerVariant: 'draw',
      isPrivate: true,
    });
    code = String(created.code);
    hostToken = String(created.reconnectToken);
    expect(code).toBeTruthy();
    expect(hostToken).toBeTruthy();

    const joined = await postJson(`/api/rooms/${code}`, { displayName: 'Browser test guest' });
    guestToken = String(joined.reconnectToken);
    expect(guestToken).toBeTruthy();
    await postJson(`/api/rooms/${code}/start`, { reconnectToken: hostToken });

    hostContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    guestContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    for (const [context, token, name] of [
      [hostContext, hostToken, 'Browser test host'],
      [guestContext, guestToken, 'Browser test guest'],
    ] as const) {
      await context.addInitScript(({ roomCode, reconnectToken, displayName }) => {
        sessionStorage.setItem(`dominoes-reconnect-${roomCode}`, reconnectToken);
        sessionStorage.setItem(`dominoes-display-name-${roomCode}`, displayName);
      }, { roomCode: code, reconnectToken: token, displayName: name });
    }

    const desktop = await hostContext.newPage();
    const phone = await guestContext.newPage();
    await Promise.all([
      desktop.goto(`/room/${code}`),
      phone.goto(`/room/${code}`),
    ]);

    for (const page of [desktop, phone]) {
      await expect(page.locator('.lk-felt')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('group', { name: 'Turn status' })).toBeVisible();
      await expect(page.locator('.lk-hand')).toBeVisible();
      const board = await page.locator('.lk-felt').boundingBox();
      expect(board).not.toBeNull();
      expect(board!.x).toBeGreaterThanOrEqual(0);
      expect(board!.x + board!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }

    await expect.poll(async () =>
      (await desktop.locator('.lk-mine:not(:disabled)').count()) +
      (await phone.locator('.lk-mine:not(:disabled)').count()),
    { timeout: 20_000 }).toBeGreaterThan(0);

    const activePage = await desktop.locator('.lk-mine:not(:disabled)').count() > 0 ? desktop : phone;
    const tile = activePage.locator('.lk-mine:not(:disabled)').first();
    const laidBefore = await activePage.locator('.lk-laid').count();
    const activateTile = () => activePage === phone ? tile.tap() : tile.click();
    await activateTile();
    if (await activePage.locator('.lk-laid').count() === laidBefore) {
      const placements = activePage.locator('.lk-ghost');
      if (await placements.count()) {
        if (activePage === phone) await placements.first().tap();
        else await placements.first().click();
      } else {
        await activateTile();
      }
    }
    await expect(activePage.locator('.lk-laid')).toHaveCount(laidBefore + 1, { timeout: 15_000 });
  } finally {
    if (code && hostToken) await postJson(`/api/rooms/${code}/leave`, { reconnectToken: hostToken }).catch(() => {});
    if (code && guestToken) await postJson(`/api/rooms/${code}/leave`, { reconnectToken: guestToken }).catch(() => {});
    await hostContext?.close();
    await guestContext?.close();
    if (code && hostToken && guestToken) {
      await expect.poll(async () => {
        const response = await fetch(new URL(`/api/rooms/${code}`, baseURL));
        return response.status;
      }, { timeout: 8_000 }).toBe(404);
    }
  }
});
