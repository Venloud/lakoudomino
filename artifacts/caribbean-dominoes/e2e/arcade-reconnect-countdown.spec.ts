import { expect, test, type WebSocketRoute } from '@playwright/test';
import { ARCADE_ROOM_RETENTION_MS } from '@workspace/api-zod';

const baseURL = process.env.DOMINO_E2E_BASE_URL;
test.skip(!baseURL, 'Set DOMINO_E2E_BASE_URL to a running 509 Yard preview to run the browser reconnect test.');

const roomCode = 'R6ND';
const game = 'mopyon';
const sessionKey = `509-yard-arcade-room:${game}`;

test('Arcade reconnect countdown ticks, pauses after reconnect, and clears expired room access', async ({ page }) => {
  let deadline = Date.now() + 60_000;
  let acceptReconnect = false;
  const sockets: WebSocketRoute[] = [];

  const room = () => ({
    code: roomCode,
    game,
    capacity: 2,
    status: 'waiting',
    players: [
      { name: 'Browser tester', seat: 0 },
      { name: 'Friend', seat: 1 },
    ],
    state: {},
    turn: 0,
    updatedAt: deadline - ARCADE_ROOM_RETENTION_MS,
    result: null,
  });

  await page.addInitScript(({ storageKey, access }) => {
    localStorage.setItem('yard-display-name', 'Browser tester');
    sessionStorage.setItem(storageKey, JSON.stringify(access));
  }, {
    storageKey: sessionKey,
    access: { code: roomCode, reconnectToken: 'browser-test-token', seat: 0, reconnectDeadline: deadline },
  });

  await page.route(`**/api/arcade/rooms/${roomCode}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: room() });
  });

  await page.routeWebSocket(/\/ws\?arcadeCode=R6ND(?:&|$)/, (socket) => {
    sockets.push(socket);
    if (sockets.length === 1 || acceptReconnect) {
      socket.send(JSON.stringify({ type: 'room', room: room() }));
    } else {
      void socket.close({ code: 1000, reason: 'Holding connection closed for test' });
    }
  });

  await page.goto('/games/mopyon');
  const panel = page.getByRole('region', { name: 'Online match' });
  await expect(panel.getByText('Waiting for players')).toBeVisible();

  deadline = Date.now() + 8_000;
  await sockets[0].close({ code: 1000, reason: 'Simulated disconnect' });
  const countdown = panel.locator('p[role="status"]').filter({ hasText: 'Reconnect within' });
  await expect(countdown).toContainText('Reconnect within');
  const initialCountdown = await countdown.textContent();
  await page.waitForTimeout(1_200);
  const laterCountdown = await countdown.textContent();
  const secondsRemaining = (text: string | null) => {
    const match = text?.match(/Reconnect within (\d+):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  expect(secondsRemaining(laterCountdown)).not.toBeNull();
  expect(secondsRemaining(laterCountdown)).toBeLessThan(secondsRemaining(initialCountdown)!);

  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return saved?.reconnectDeadline;
  }, sessionKey)).toBe(deadline);

  acceptReconnect = true;
  await page.reload();
  await expect(panel.getByText('Waiting for players')).toBeVisible();
  await expect(panel.locator('p[role="status"]').filter({ hasText: 'Reconnect within' })).toHaveCount(0);

  deadline = Date.now() + 2_500;
  await sockets[sockets.length - 1].close({ code: 1000, reason: 'Simulated final disconnect' });
  await expect(panel.getByText(/Your reconnect window expired/)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), sessionKey)).toBeNull();
  await expect(panel.getByRole('button', { name: 'Create private room' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Find a match' })).toBeEnabled();
});
