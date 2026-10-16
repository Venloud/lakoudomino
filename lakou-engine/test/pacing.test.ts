import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, nextStep, autoStep, startNextHand, PACE, PACE_SOLO, isForced, recordOwnPlay, type GameEvent, type MatchState, type SeatKind } from '../src/index';

const bots: SeatKind[] = ['human', 'hard', 'hard', 'hard'];

test('first tile: bot opens in about 1.5–3 s, never waits for a turn timer', () => {
  for (let seed = 1; seed < 40; seed++) {
    const m = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10, seed }).match;
    const s = nextStep(m, bots, []);
    if (s.type === 'bot') { assert.ok(s.delayMs >= PACE_SOLO.openingMs + PACE_SOLO.botThinkMinMs && s.delayMs <= PACE_SOLO.openingMs + PACE_SOLO.botThinkMaxMs); }
    else if (s.type === 'human') { assert.equal(s.delayMs, PACE_SOLO.openingMs); assert.equal(s.turnMs, 30000); }
  }
});

test('whole bot game: every step has a delay, bots never instant, human clock only after the pause', () => {
  let m: MatchState = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10, seed: 5 }).match;
  let events: GameEvent[] = [];
  const seats: SeatKind[] = ['hard', 'hard', 'hard', 'hard'];
  let steps = 0;
  while (!m.over && steps++ < 4000) {
    if (m.hand.over) { assert.equal(nextStep(m, seats, events).type, 'none'); m = startNextHand(m).match; events = []; continue; }
    const s = nextStep(m, seats, events);
    assert.notEqual(s.type, 'none');
    if (s.type === 'bot') assert.ok(s.delayMs >= 800); // solo table: never instant
    if (s.type === 'forced') assert.ok(isForced(m) && s.delayMs >= 500);
    if (events.some((e) => e.type === 'play') && s.type !== 'none') assert.ok(s.delayMs >= PACE_SOLO.afterPlayMs);
    const r = autoStep(m, seats)!; m = r.match; events = r.events;
  }
  assert.ok(m.over);
});

test('a pass is quicker than a play; speed setting scales the pause', () => {
  const m = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10, seed: 2 }).match;
  const r = autoStep(m, ['hard', 'hard', 'hard', 'hard'])!;
  const human: SeatKind[] = ['human', 'human', 'human', 'human'];
  const afterPlay = nextStep(r.match, human, r.events);
  const afterPass = nextStep(r.match, human, [{ type: 'pass', seat: 0 }]);
  if (afterPlay.type === 'human' && afterPass.type === 'human') {
    assert.equal(afterPlay.delayMs, 5000);
    assert.equal(afterPass.delayMs, 1500);
    const slow = nextStep(r.match, human, r.events, { speed: 1.5 });
    assert.equal(slow.type === 'human' && slow.delayMs, 7500);
  }
});

import { createAfk, recordTimeout, afkTurnMs, onlyBotsLeft } from '../src/index';

test('idle player: turn time drops 25% per auto-pick, then a bot takes the seat', () => {
  let afk = createAfk(4);
  const seen = [afkTurnMs(afk, 0)];
  let replaced = false, n = 0;
  while (!replaced && n++ < 20) {
    const r = recordTimeout(afk, 0);
    afk = r.afk; replaced = r.replacedByBot;
    if (!replaced) seen.push(r.nextTurnMs);
  }
  assert.deepEqual(seen, [30000, 23000, 17000, 13000, 9000, 7000, 5000]);
  assert.equal(n, 7);
  assert.equal(afkTurnMs(afk, 1), 30000); // other seats untouched
  assert.equal(onlyBotsLeft(['hard', 'hard', 'easy', 'hard']), true);
  assert.equal(onlyBotsLeft(['hard', 'human', 'hard', 'hard']), false);
});

test('nextStep hands the idle player their shorter clock', () => {
  const m = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10, seed: 9 }).match;
  let afk = createAfk(4);
  afk = recordTimeout(afk, m.hand.turn).afk;
  const s = nextStep(m, ['human', 'human', 'human', 'human'], [], { afk });
  if (s.type === 'human') assert.equal(s.turnMs, 23000);
});

import { emptyBoard, placeTile, placementsEquivalent, type Tile as T } from '../src/index';

test('double-tap: same result on both ends → auto; a double on one end → player picks', () => {
  const play = (b: ReturnType<typeof emptyBoard>, mode: 'points' | 'regular', moves: [T, 'center' | 'W' | 'E'][]) =>
    moves.reduce((acc, [t, arm]) => placeTile(acc, mode, 0, t, arm), b);
  // 6-6 in the middle: a 6 on either side is the same.
  const spin = play(emptyBoard(), 'points', [[[6, 6], 'center']]);
  assert.equal(placementsEquivalent(spin, 'points', 0, [6, 3], ['W', 'E']), true);
  // Both ends show a plain 6.
  const plain = play(emptyBoard(), 'regular', [[[6, 4], 'center'], [[4, 6], 'E']]);
  assert.equal(placementsEquivalent(plain, 'regular', 0, [6, 1], ['W', 'E']), true);
  // One end is the 6-6 double: covering it changes the count → not the same.
  const dbl = play(emptyBoard(), 'regular', [[[6, 4], 'center'], [[4, 5], 'E'], [[5, 6], 'E'], [[6, 6], 'E']]);
  assert.equal(placementsEquivalent(dbl, 'regular', 0, [6, 1], ['W', 'E']), false);
});

test('2+ real players keep the 5 s pause; just you + bots is about 3 s per bot', () => {
  const m = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10, seed: 2 }).match;
  const r = autoStep(m, ['hard', 'hard', 'hard', 'hard'])!;
  const two = nextStep(r.match, ['human', 'human', 'hard', 'hard'], r.events, { random: () => 0 });
  const solo = nextStep(r.match, ['human', 'hard', 'hard', 'hard'], r.events, { random: () => 0 });
  assert.ok(two.type !== 'none' && two.delayMs >= 5000);
  assert.ok(solo.type !== 'none' && solo.delayMs >= 2500 && solo.delayMs < 4000);
});

test('playing yourself resets the idle clock; a 15 s table shrinks from 15', () => {
  let afk = createAfk(4);
  afk = recordTimeout(afk, 0, 15000).afk;
  assert.equal(afkTurnMs(afk, 0, 15000), 11000);
  afk = recordOwnPlay(afk, 0);
  assert.equal(afkTurnMs(afk, 0, 15000), 15000);
});
