import { expect, test, type Page } from '@playwright/test';

type GameId = 'box' | 'kay' | 'dame' | 'four-in-a-row' | 'filler';

const gameCases: Array<{
  game: GameId;
  boardSelector: string;
  move: (page: Page) => Promise<void>;
}> = [
  {
    game: 'box',
    boardSelector: 'button[aria-label^="Draw "]',
    move: async (page) => page.getByRole('button', { name: 'Draw horizontal edge 1, 1' }).click(),
  },
  {
    game: 'kay',
    boardSelector: '.yard-kay-board button.yard-kay-pit',
    move: async (page) => page.getByRole('button', { name: /^Player 1, pit 1,/ }).click(),
  },
  {
    game: 'dame',
    boardSelector: '.yard-dame-board button',
    move: async (page) => {
      await page.getByRole('button', { name: 'Square 41 player 1 man' }).click();
      await page.getByRole('button', { name: 'Square 34' }).click();
    },
  },
  {
    game: 'four-in-a-row',
    boardSelector: '.yard-connect-board [role="gridcell"]',
    move: async (page) => page.getByRole('button', { name: 'Drop into column 1' }).click(),
  },
  {
    game: 'filler',
    boardSelector: '[role="grid"][aria-label="Filler board"] [role="gridcell"]',
    move: async (page) => page.locator('button[aria-label^="Choose "]:not([disabled])').first().click(),
  },
];

const storageKey = (game: GameId) => `509-yard-local-arcade:${game}:v1`;

async function readSavedState(page: Page, game: GameId): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : null;
  }, storageKey(game));
}

async function readVisibleBoard(page: Page, selector: string): Promise<Array<[string | null, boolean | null]>> {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => [
    element.getAttribute('aria-label'),
    element instanceof HTMLButtonElement ? element.disabled : null,
  ]));
}

function expectFreshState(game: GameId, state: Record<string, unknown> | null): void {
  expect(state).not.toBeNull();
  expect(state?.turn).toBe(0);
  expect(state?.winner).toBeNull();
  if (game === 'box') {
    expect(state?.dots).toEqual([]);
    expect(state?.edgeOwners).toEqual([]);
    expect(state?.claimed).toEqual(Array(9).fill(null));
  } else if (game === 'kay') {
    expect(state?.pits).toEqual(Array.from({ length: 14 }, (_, index) => index === 6 || index === 13 ? 0 : 4));
  } else if (game === 'dame') {
    expect((state?.pieces as unknown[]).filter(Boolean)).toHaveLength(24);
    expect(state?.forcedFrom).toBeNull();
  } else if (game === 'four-in-a-row') {
    expect(state?.four).toEqual(Array(42).fill(null));
  } else {
    const board = state?.fillerBoard as { owners: Array<number | null> };
    expect(board.owners[0]).toBe(0);
    expect(board.owners[63]).toBe(1);
    expect(board.owners.filter((owner) => owner !== null)).toHaveLength(2);
  }
}

for (const { game, boardSelector, move } of gameCases) {
  test(`${game} restores a visible move after refresh and starts a clean new match`, async ({ page }) => {
    await page.goto(`/games/${game}`);
    const turnStatus = page.getByTestId('status-current-turn');
    await expect(turnStatus).toContainText('Player 1');
    const initialBoard = await readVisibleBoard(page, boardSelector);

    await move(page);
    await expect.poll(async () => (await readSavedState(page, game))?.turn).toBe(1);
    await expect(turnStatus).toContainText('Player 2');
    const movedState = await readSavedState(page, game);
    expect(movedState).not.toBeNull();
    const movedBoard = await readVisibleBoard(page, boardSelector);
    if (game !== 'filler') expect(movedBoard).not.toEqual(initialBoard);

    await page.reload();
    await expect(page.getByTestId('status-current-turn')).toContainText('Player 2');
    await expect.poll(async () => readSavedState(page, game)).toEqual(movedState);
    expect(await readVisibleBoard(page, boardSelector)).toEqual(movedBoard);

    await page.getByRole('button', { name: 'New game' }).click();
    await expect(page.getByTestId('status-current-turn')).toContainText('Player 1');
    await expect.poll(async () => {
      const state = await readSavedState(page, game);
      return state?.turn === 0 && state.winner === null;
    }).toBe(true);
    const freshState = await readSavedState(page, game);
    expectFreshState(game, freshState);
    const freshBoard = await readVisibleBoard(page, boardSelector);
    expect(freshBoard).not.toEqual(movedBoard);

    await page.reload();
    await expect(page.getByTestId('status-current-turn')).toContainText('Player 1');
    await expect.poll(async () => readSavedState(page, game)).toEqual(freshState);
    expect(await readVisibleBoard(page, boardSelector)).toEqual(freshBoard);
    expect(initialBoard.length).toBeGreaterThan(0);
  });
}

test('finished local matches are not restored', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      game: 'box',
      playVsBot: false,
      state: {
        game: 'box',
        turn: 0,
        winner: 0,
        dots: [],
        edgeOwners: [],
        claimed: Array(9).fill(null),
      },
    }));
  }, storageKey('box'));

  await page.goto('/games/box');
  await expect(page.getByTestId('status-current-turn')).toContainText('Player 1');
  await expect.poll(async () => readSavedState(page, 'box')).toMatchObject({
    game: 'box',
    turn: 0,
    winner: null,
    dots: [],
  });
  await expect(page.getByRole('button', { name: 'Draw horizontal edge 1, 1' })).toBeEnabled();
});

test('a saved online room session does not restore or overwrite a local match', async ({ page }) => {
  const roomCode = 'B0X123';
  const localMatch = {
    game: 'box',
    turn: 1,
    winner: null,
    dots: ['h:0:0'],
    edgeOwners: [['h:0:0', 0]],
    claimed: Array(9).fill(null),
  };
  await page.addInitScript(({ key, sessionKey, state, code }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, game: 'box', playVsBot: false, state }));
    sessionStorage.setItem(sessionKey, JSON.stringify({
      code,
      reconnectToken: 'browser-test-token',
      seat: 0,
      reconnectDeadline: Date.now() + 60_000,
    }));
  }, {
    key: storageKey('box'),
    sessionKey: '509-yard-arcade-room:box',
    state: localMatch,
    code: roomCode,
  });
  await page.route(`**/api/arcade/rooms/${roomCode}`, (route) =>
    route.fulfill({ status: 404, json: { error: 'Room unavailable in this isolated test.' } }));
  await page.routeWebSocket(new RegExp(`/ws\\?arcadeCode=${roomCode}(?:&|$)`), (socket) => {
    void socket.close({ code: 1000, reason: 'Isolated local restore test' });
  });

  await page.goto('/games/box');
  await expect(page.getByTestId('status-current-turn')).toContainText('Player 1');
  await expect(page.getByRole('button', { name: 'Draw horizontal edge 1, 1' })).toBeEnabled();
  await expect.poll(async () => readSavedState(page, 'box')).toMatchObject(localMatch);
});
