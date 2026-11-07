import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearSavedLocalArcadeMatch,
  hasSavedArcadeOnlineSession,
  loadSavedLocalArcadeMatch,
  localArcadeSaveKey,
  saveLocalArcadeMatch,
  type LocalArcadeGame,
} from './arcade-local-persistence.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const cases: { game: LocalArcadeGame; state: Record<string, unknown> }[] = [
  {
    game: 'box',
    state: {
      game: 'box', turn: 1, winner: null, dots: ['h:0:0'], edgeOwners: [['h:0:0', 0]],
      claimed: Array(9).fill(null),
    },
  },
  {
    game: 'kay',
    state: { game: 'kay', turn: 1, winner: null, pits: Array(14).fill(4).map((stones, index) => index === 6 || index === 13 ? 0 : stones) },
  },
  {
    game: 'dame',
    state: {
      game: 'dame', turn: 0, winner: null, pieces: Array(64).fill(null).map((_, index) =>
        index === 17 ? { side: 0, kind: 'D' } : index === 26 ? { side: 1, kind: 'K' } : null),
      forcedFrom: 17,
    },
  },
  {
    game: 'four-in-a-row',
    state: { game: 'four-in-a-row', turn: 1, winner: null, four: Array(42).fill(null).map((cell, index) => index === 35 ? 0 : cell) },
  },
  {
    game: 'filler',
    state: {
      game: 'filler', turn: 1, winner: null,
      fillerBoard: {
        colors: Array.from({ length: 64 }, (_, index) => index % 6),
        owners: Array(64).fill(null).map((owner, index) => index === 0 ? 0 : index === 63 ? 1 : owner),
        playerCount: 2,
      },
    },
  },
];

test('restores unfinished local matches for every supported game', () => {
  for (const { game, state } of cases) {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    assert.equal(saveLocalArcadeMatch(localStorage, sessionStorage, game, state, true), true, game);
    const restored = loadSavedLocalArcadeMatch(localStorage, sessionStorage, game);
    assert.deepEqual(restored, { game, playVsBot: true, state }, game);
  }
});

test('reports unavailable storage and resumes saving when storage becomes writable', () => {
  for (const { game, state } of cases) {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    localStorage.setItem = () => { throw new Error('Storage is unavailable'); };

    assert.equal(saveLocalArcadeMatch(localStorage, sessionStorage, game, state, true), false, game);

    localStorage.setItem = (key, value) => { localStorage.values.set(key, value); };
    assert.equal(saveLocalArcadeMatch(localStorage, sessionStorage, game, state, true), true, game);
    assert.deepEqual(loadSavedLocalArcadeMatch(localStorage, sessionStorage, game)?.state, state, game);
  }
});

test('starting a new match replaces the saved state and clearing it resets restoration', () => {
  for (const { game, state } of cases) {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    saveLocalArcadeMatch(localStorage, sessionStorage, game, state, false);
    const nextState = { ...state, turn: state.turn === 0 ? 1 : 0 };
    saveLocalArcadeMatch(localStorage, sessionStorage, game, nextState, true);
    assert.deepEqual(loadSavedLocalArcadeMatch(localStorage, sessionStorage, game)?.state, nextState, game);
    clearSavedLocalArcadeMatch(localStorage, game);
    assert.equal(loadSavedLocalArcadeMatch(localStorage, sessionStorage, game), null, game);
  }
});

test('finished matches are removed and cannot restore as active', () => {
  for (const { game, state } of cases) {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    saveLocalArcadeMatch(localStorage, sessionStorage, game, state, false);
    saveLocalArcadeMatch(localStorage, sessionStorage, game, { ...state, winner: 2 }, false);
    assert.equal(localStorage.getItem(localArcadeSaveKey(game)), null, game);
    assert.equal(loadSavedLocalArcadeMatch(localStorage, sessionStorage, game), null, game);
  }
});

test('online room sessions prevent local restore and never overwrite the local save', () => {
  for (const { game, state } of cases) {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    saveLocalArcadeMatch(localStorage, sessionStorage, game, state, false);
    const savedBeforeRoom = localStorage.getItem(localArcadeSaveKey(game));
    sessionStorage.setItem(`509-yard-arcade-room:${game}`, JSON.stringify({ roomId: 'room' }));
    assert.equal(hasSavedArcadeOnlineSession(sessionStorage, game), true);
    assert.equal(loadSavedLocalArcadeMatch(localStorage, sessionStorage, game), null);
    assert.equal(saveLocalArcadeMatch(localStorage, sessionStorage, game, { ...state, turn: 1 }, true), true);
    assert.equal(localStorage.getItem(localArcadeSaveKey(game)), savedBeforeRoom);
  }
});
