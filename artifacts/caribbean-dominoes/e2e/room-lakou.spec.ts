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

async function playFirstTile(page: Page, useTouch: boolean) {
  const laidBefore = await page.locator('.lk-laid').count();
  const tile = page.locator('.lk-mine:not(:disabled)').first();
  await expect(tile).toBeVisible();
  if (useTouch) await tile.tap();
  else await tile.click();

  await expect.poll(async () =>
    (await page.locator('.lk-laid').count()) > laidBefore ||
    (await page.locator('.lk-ghost').count()) > 0,
  { timeout: 10_000 }).toBe(true);
  if (await page.locator('.lk-laid').count() === laidBefore) {
    const placement = page.locator('.lk-ghost').first();
    await expect(placement).toBeVisible();
    if (useTouch) await placement.tap();
    else await placement.click();
  }
  await expect(page.locator('.lk-laid')).toHaveCount(laidBefore + 1, { timeout: 15_000 });
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

test('phone player can tap a tile and place it on the live board', async ({ browser }) => {
  let code = '';
  const players: Array<{ name: string; token: string }> = [];
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];

  try {
    const created = await postJson('/api/rooms', {
      displayName: 'Touch test host',
      mode: 'regular',
      playerCount: 2,
      rowLength: 10,
      rowBoxes: 8,
      twoPlayerVariant: 'draw',
      isPrivate: true,
    });
    code = String(created.code);
    expect(code).toBeTruthy();
    players.push({ name: 'Touch test host', token: String(created.reconnectToken) });

    const joined = await postJson(`/api/rooms/${code}`, { displayName: 'Touch test phone' });
    players.push({ name: 'Touch test phone', token: String(joined.reconnectToken) });
    expect(players.every((player) => player.token)).toBe(true);
    await postJson(`/api/rooms/${code}/start`, { reconnectToken: players[0]!.token });

    const hostContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    contexts.push(hostContext, phoneContext);
    for (const [context, player] of [[hostContext, players[0]!], [phoneContext, players[1]!]] as const) {
      await context.addInitScript(({ roomCode, reconnectToken, displayName }) => {
        sessionStorage.setItem(`dominoes-reconnect-${roomCode}`, reconnectToken);
        sessionStorage.setItem(`dominoes-display-name-${roomCode}`, displayName);
      }, { roomCode: code, reconnectToken: player.token, displayName: player.name });
    }

    const host = await hostContext.newPage();
    const phone = await phoneContext.newPage();
    await Promise.all([host.goto(`/room/${code}`), phone.goto(`/room/${code}`)]);
    for (const page of [host, phone]) {
      await expect(page.locator('.lk-felt')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('group', { name: 'Turn status' })).toBeVisible();
      await expect(page.locator('.lk-hand .lk-mine')).toHaveCount(7);
    }

    const hostTurn = host.locator('.lk-turn-copy b');
    const phoneTurn = phone.locator('.lk-turn-copy b');
    await expect.poll(async () =>
      Number((await hostTurn.innerText()).startsWith('Your turn')) +
      Number((await phoneTurn.innerText()).startsWith('Your turn')),
    { timeout: 20_000 }).toBe(1);

    if ((await hostTurn.innerText()).startsWith('Your turn')) {
      await playFirstTile(host, false);
    }
    await expect(phoneTurn).toContainText('Your turn', { timeout: 20_000 });

    const hostBoardBeforePhoneMove = await host.locator('.lk-laid').count();
    const phoneBoardBeforePhoneMove = await phone.locator('.lk-laid').count();
    await playFirstTile(phone, true);
    await expect(phone.locator('.lk-laid')).toHaveCount(phoneBoardBeforePhoneMove + 1);
    await expect(host.locator('.lk-laid')).toHaveCount(hostBoardBeforePhoneMove + 1, { timeout: 15_000 });
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

test('seated players see watcher counts update across disconnects and reconnects', async ({ browser }) => {
  let code = '';
  const players: Array<{ name: string; token: string }> = [];
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];

  try {
    const created = await postJson('/api/rooms', {
      displayName: 'Watcher UI host',
      mode: 'regular',
      playerCount: 2,
      rowLength: 10,
      rowBoxes: 8,
      twoPlayerVariant: 'draw',
      isPrivate: true,
    });
    code = String(created.code);
    expect(code).toBeTruthy();
    players.push({ name: 'Watcher UI host', token: String(created.reconnectToken) });

    const joined = await postJson(`/api/rooms/${code}`, { displayName: 'Watcher UI guest' });
    players.push({ name: 'Watcher UI guest', token: String(joined.reconnectToken) });

    const hostContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const watcherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    contexts.push(hostContext, guestContext, watcherContext);
    for (const [context, player] of [[hostContext, players[0]!], [guestContext, players[1]!]] as const) {
      await context.addInitScript(({ roomCode, reconnectToken, displayName }) => {
        sessionStorage.setItem(`dominoes-reconnect-${roomCode}`, reconnectToken);
        sessionStorage.setItem(`dominoes-display-name-${roomCode}`, displayName);
      }, { roomCode: code, reconnectToken: player.token, displayName: player.name });
    }

    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    await watcherContext.addInitScript(({ roomCode }) => {
      sessionStorage.setItem(`dominoes-display-name-${roomCode}`, 'Watcher UI spectator');
    }, { roomCode: code });
    await Promise.all([host.goto(`/room/${code}`), guest.goto(`/room/${code}`)]);
    const hostCount = host.locator('.lk-watcher-count');
    const guestCount = guest.locator('.lk-watcher-count');
    await expect(hostCount).toHaveText('0 watching', { timeout: 20_000 });
    await expect(guestCount).toHaveText('0 watching', { timeout: 20_000 });

    const watchUrl = `/room/${code}?watch=1`;
    let watcher = await watcherContext.newPage();
    await watcher.goto(watchUrl);
    await expect(watcher.getByTestId('status-watch-waiting')).toBeVisible({ timeout: 20_000 });
    await expect(hostCount).toHaveText('1 watching', { timeout: 15_000 });
    await expect(guestCount).toHaveText('1 watching', { timeout: 15_000 });
    await expect(watcher.locator('.lk-watcher-count')).toHaveCount(0);
    await expect(host.getByText('Watcher UI spectator', { exact: true })).toHaveCount(0);

    await watcher.close();
    await expect(hostCount).toHaveText('0 watching', { timeout: 15_000 });
    await expect(guestCount).toHaveText('0 watching', { timeout: 15_000 });

    watcher = await watcherContext.newPage();
    await watcher.goto(watchUrl);
    await expect(watcher.getByTestId('status-watch-waiting')).toBeVisible({ timeout: 20_000 });
    await expect(hostCount).toHaveText('1 watching', { timeout: 15_000 });
    await expect(guestCount).toHaveText('1 watching', { timeout: 15_000 });
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (code) {
      for (const player of [...players].reverse()) {
        await postJson(`/api/rooms/${code}/leave`, { reconnectToken: player.token }).catch(() => {});
      }
      await expect.poll(async () => {
        const response = await fetch(new URL(`/api/rooms/${code}`, baseURL));
        return response.status;
      }, { timeout: 8_000 }).toBe(404);
    }
  }
});
