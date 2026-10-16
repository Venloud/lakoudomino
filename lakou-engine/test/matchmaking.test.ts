import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, joinQueue, leaveQueue, queueStatus, tickQueue, QUEUE_WAIT_MS, createMatch, autoStep, startNextHand, type PlayQueue } from '../src/index';

const join = (q: PlayQueue, ids: string[], mode: 'points' | 'regular', at: number) => ids.reduce((acc, id, i) => joinQueue(acc, id, mode, at + i), q);

test('4 people for the same mode get a table right away, no bots', () => {
  const q = join(createQueue(), ['a', 'b', 'c', 'd'], 'points', 0);
  const r = tickQueue(q, 10);
  assert.equal(r.matches.length, 1);
  assert.deepEqual(r.matches[0].players, ['a', 'b', 'c', 'd']);
  assert.equal(r.matches[0].bots, 0);
  assert.equal(r.queue.entries.length, 0);
});

test('alone: nothing before the wait, then 3 bots', () => {
  const q = join(createQueue(), ['a'], 'points', 1000);
  assert.equal(tickQueue(q, 1000 + QUEUE_WAIT_MS - 1).matches.length, 0);
  const r = tickQueue(q, 1000 + QUEUE_WAIT_MS);
  assert.equal(r.matches.length, 1);
  assert.deepEqual(r.matches[0].seats, ['human', 'hard', 'hard', 'hard']);
  assert.equal(r.queue.entries.length, 0);
});

test('someone who joins while you wait plays with you, bots fill the rest', () => {
  let q = joinQueue(createQueue(), 'a', 'points', 0);
  q = joinQueue(q, 'b', 'points', 15_000);
  const s = queueStatus(q, 'b')!;
  assert.equal(s.found, 2);
  assert.equal(s.botsAt, QUEUE_WAIT_MS); // clock runs from the first person in line
  const r = tickQueue(q, QUEUE_WAIT_MS);
  assert.deepEqual(r.matches[0].players, ['a', 'b']);
  assert.equal(r.matches[0].bots, 2);
});

test('modes are matched separately; 6 people → one full table, 2 keep waiting', () => {
  let q = join(createQueue(), ['a', 'b', 'c', 'd', 'e', 'f'], 'points', 0);
  q = joinQueue(q, 'r', 'regular', 0);
  const r = tickQueue(q, 5);
  assert.equal(r.matches.length, 1);
  assert.deepEqual(r.queue.entries.map((e) => e.id).sort(), ['e', 'f', 'r']);
  const later = tickQueue(r.queue, QUEUE_WAIT_MS + 10);
  assert.equal(later.matches.length, 2);
  assert.ok(later.matches.some((m) => m.mode === 'regular' && m.bots === 3));
  assert.ok(later.matches.some((m) => m.mode === 'points' && m.players.join() === 'e,f'));
});

test('leaving, offline players, re-joining keeps your place, switching mode resets it', () => {
  let q = join(createQueue(), ['a', 'b'], 'points', 0);
  assert.equal(joinQueue(q, 'a', 'points', 9999), q);
  q = joinQueue(q, 'a', 'regular', 50);
  assert.equal(queueStatus(q, 'a')!.mode, 'regular');
  q = leaveQueue(q, 'a');
  assert.equal(queueStatus(q, 'a'), null);
  const r = tickQueue(q, 10, { isOnline: (id) => id !== 'b' });
  assert.equal(r.queue.entries.length, 0);
  assert.equal(r.matches.length, 0);
});

test('a bot-filled Points match plays to the end with the returned seats', () => {
  const r = tickQueue(joinQueue(createQueue(), 'a', 'points', 0), QUEUE_WAIT_MS);
  const seats = r.matches[0].seats.map((s) => (s === 'human' ? 'hard' : s)) as ('hard' | 'easy')[];
  let m = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10, seed: 3 }).match;
  let guard = 0;
  while (!m.over && guard++ < 3000) {
    if (m.hand.over) { m = startNextHand(m).match; continue; }
    m = autoStep(m, seats)!.match;
  }
  assert.ok(m.over);
});

import { setBotsOk, startNow } from '../src/index';

test('wait for real players: never matched with bots; start now skips the countdown', () => {
  let q = joinQueue(createQueue(), 'a', 'points', 0, { botsOk: false });
  q = joinQueue(q, 'b', 'points', 0);
  const r = tickQueue(q, QUEUE_WAIT_MS * 10);
  assert.equal(r.matches.length, 1);
  assert.deepEqual(r.matches[0].players, ['b']);
  assert.deepEqual(r.queue.entries.map((e) => e.id), ['a']);
  assert.equal(queueStatus(r.queue, 'a', QUEUE_WAIT_MS, 5000)!.botsAt, null);
  // 3 more real people show up → a full table with 'a'.
  let q2 = ['c', 'd', 'e'].reduce((acc, id) => joinQueue(acc, id, 'points', 100), r.queue);
  assert.equal(tickQueue(q2, 101).matches[0].players.join(), 'a,c,d,e');
  // Start now.
  q2 = startNow(joinQueue(createQueue(), 'z', 'regular', 0), 'z');
  assert.equal(tickQueue(q2, 1).matches[0].bots, 3);
  // Turning bots back on restarts the countdown.
  const q3 = setBotsOk(joinQueue(createQueue(), 'y', 'points', 0, { botsOk: false }), 'y', true, 50_000);
  assert.equal(queueStatus(q3, 'y', QUEUE_WAIT_MS, 50_000)!.botsAt, 50_000 + QUEUE_WAIT_MS);
});
