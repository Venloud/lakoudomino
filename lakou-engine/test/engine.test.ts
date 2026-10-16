import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, awardCrowns, botMove, buildTally, createMatch, endsTotal, findOverlaps, fullSet,
  afterGame, acceptSeat, checkOffers, readyToStart, waitlistPosition, SEAT_OFFER_MS, roundTo5, autoStep, standings, countedHalves, emptyBoard, placeTile, headToHead, layoutBoard, legalActions, startNextHand, targetScore, tileKey, viewFor,
  type MatchConfig, type MatchState, type Tile, type GameEvent,
} from '../src/index';

// Helper: give every seat a chosen hand and make seat 0 start with the given opener.
function rig(config: MatchConfig, hands: Tile[][], opener: Tile | null = null): MatchState {
  const { match } = createMatch({ ...config, seed: 1 });
  match.hand.hands = hands.map((h) => h.map((t) => [...t] as Tile));
  match.hand.boneyard = [];
  match.hand.turn = 0;
  match.hand.starter = 0;
  match.hand.forcedOpener = opener;
  return match;
}
const play = (m: MatchState, tile: Tile, arm: any) => applyAction(m, { type: 'play', tile, arm });

test("Van's example: 6-6 spinner alone = 12 (no score), then 6-3 makes 15", () => {
  let m = rig({ mode: 'points', playerCount: 4 }, [[[6, 6], [0, 1]], [[6, 3], [0, 2]], [[1, 2], [0, 3]], [[2, 4], [0, 4]]], [6, 6]);
  let r = play(m, [6, 6], 'center');
  assert.equal(endsTotal(r.match.hand.board), 12);
  assert.ok(!r.events.some((e) => e.type === 'score'));
  r = play(r.match, [6, 3], 'E');
  assert.equal(endsTotal(r.match.hand.board), 15);
  const score = r.events.find((e) => e.type === 'score') as any;
  assert.equal(score.seat, 1);
  assert.equal(score.points, 15);
  assert.equal(r.match.scores[1], 15);
});

test('spinner opens N and S only after both sides have a tile', () => {
  let m = rig({ mode: 'points', playerCount: 4 }, [[[5, 5], [5, 1], [0, 0]], [[5, 2], [0, 1]], [[5, 3], [0, 2]], [[5, 4], [0, 6]]], [5, 5]);
  let r = play(m, [5, 5], 'center');
  assert.deepEqual([...new Set(legalActions(r.match).map((a: any) => a.arm))].sort(), ['E', 'W']);
  r = play(r.match, [5, 2], 'E');   // 10 (spinner) + 2 = 12
  r = applyAction(r.match, { type: 'play', tile: [5, 3], arm: 'W' }); // 2 + 3 = 5 -> too small, scores nothing
  assert.equal(r.match.scores[2], 0);
  assert.ok(!r.events.some((e) => e.type === 'score'), 'a total of 5 never scores');
  const arms = [...new Set(legalActions(r.match).map((a: any) => a.arm))].sort();
  assert.deepEqual(arms, ['N', 'S']); // seat 3 holds 5-4: only the spinner's sides have a 5
});

test('double at an end counts both halves; regular mode has no spinner', () => {
  let m = rig({ mode: 'points', playerCount: 4 }, [[[3, 6], [0, 1]], [[6, 6], [0, 2]], [[1, 2], [0, 3]], [[2, 4], [0, 4]]]);
  let r = play(m, [3, 6], 'center'); // 3 + 6 = 9
  r = play(r.match, [6, 6], 'E');     // 3 + 12 = 15, and 6-6 becomes the spinner
  assert.equal(r.match.scores[1], 15);
  assert.ok(r.match.hand.board.spinner);

  let reg = rig({ mode: 'regular', playerCount: 4 }, [[[6, 6], [0, 1]], [[6, 3], [0, 2]], [[1, 2], [0, 3]], [[2, 4], [0, 4]]], [6, 6]);
  const rr = play(reg, [6, 6], 'center');
  assert.equal(rr.match.hand.board.spinner, null);
});

test('50 to the player whose play made others pass — one per passer', () => {
  // Seat 0 opens 6-6; nobody else has a 6; seat 0 can play again.
  const m = rig({ mode: 'points', playerCount: 4 }, [
    [[6, 6], [6, 1], [2, 2]],
    [[0, 1], [0, 2]],
    [[1, 3], [0, 3]],
    [[2, 4], [0, 4]],
  ], [6, 6]);
  let r = play(m, [6, 6], 'center');
  const bonuses: GameEvent[] = [];
  for (let i = 0; i < 3; i++) {
    r = applyAction(r.match, { type: 'pass' });
    bonuses.push(...r.events.filter((e) => e.type === 'bonus'));
  }
  assert.equal(bonuses.length, 3);
  assert.ok(bonuses.every((b: any) => b.seat === 0 && b.reason === 'pass'));
  assert.equal(r.match.scores[0], 150);
  assert.equal(r.match.hand.turn, 0);
});

test('going out: other players\' pips rounded to the nearest 5, and the hand ends with a ranking by pips', () => {
  const m = rig({ mode: 'points', playerCount: 4 }, [
    [[6, 6]],
    [[6, 5], [0, 0]],
    [[4, 4], [3, 3]],
    [[1, 2], [0, 1]],
  ], [6, 6]);
  const r = play(m, [6, 6], 'center');
  assert.ok(r.events.some((e) => e.type === 'domino'));
  const dom = r.events.find((e: any) => e.type === 'bonus' && e.reason === 'domino') as any;
  // Others hold 11 + 14 + 4 = 29 pips -> rounded to the nearest 5 = 30 (not a flat 50).
  assert.equal(dom.pipsLeft, 29);
  assert.equal(dom.points, 30);
  assert.equal(r.match.scores[0], 30);
  assert.deepEqual(buildTally(r.match.scoreLog[0], 10).boxes[0], { kind: 'strokes', strokes: 6 }); // drawn as strokes
  assert.equal(roundTo5(27), 25);
  assert.equal(roundTo5(38), 40);
  assert.equal(r.match.hand.winner, 0);
  // pips left: seat1 11, seat2 14, seat3 4
  assert.deepEqual(r.match.hand.ranking, [0, 3, 1, 2]);
});

test('locked game: locker gets 150, everyone ranked by pips, lowest gets 50 in points mode', () => {
  // After 6-6 and 6-0... construct: ends 6 and 6 then nobody holds a 6.
  const m = rig({ mode: 'points', playerCount: 4 }, [
    [[6, 6], [1, 1]],
    [[6, 5], [2, 2]],
    [[0, 0], [3, 4]],
    [[1, 2], [0, 1]],
  ], [6, 6]);
  // Seat 1 plays 6-5 → ends 6 (spinner side) and 5. Nobody left has 6 or 5 → locked.
  let r = play(m, [6, 6], 'center');
  r = play(r.match, [5, 6], 'E');
  assert.ok(r.events.some((e) => e.type === 'locked'));
  // pips: seat0 2, seat1 4, seat2 7, seat3 4
  assert.deepEqual(r.match.hand.ranking, [0, 1, 3, 2]);
  assert.ok(r.events.some((e: any) => e.type === 'bonus' && e.reason === 'lowestLock' && e.seat === 0));
  // Seat 1 made the play that locked it: 50 for each of the 3 other players = 150.
  const lk = r.events.find((e: any) => e.reason === 'lockedGame') as any;
  assert.equal(lk.seat, 1);
  assert.equal(lk.points, 150);
  assert.equal(r.match.scores[1], 150 + 0);
});

test('regular mode: one hand = one game, placings follow the hand', () => {
  const m = rig({ mode: 'regular', playerCount: 4 }, [[[6, 6]], [[6, 5], [0, 0]], [[4, 4], [3, 3]], [[1, 2], [0, 1]]], [6, 6]);
  const r = play(m, [6, 6], 'center');
  assert.ok(r.match.over);
  assert.deepEqual(r.match.placings, [0, 3, 1, 2]);
  const crowns = awardCrowns(r.match);
  assert.deepEqual(crowns.map((c) => c.medal), ['gold', 'silver', 'bronze', null]);
  assert.deepEqual(crowns.map((c) => c.crownPoints), [3, 2, 1, 0]);
  assert.equal(headToHead(r.match).length, 6);
});

test('hand 1: holder of 6-6 must open with it', () => {
  for (let seed = 1; seed < 50; seed++) {
    const { match } = createMatch({ mode: 'points', playerCount: 4, seed });
    const holder = match.hand.hands.findIndex((h) => h.some((t) => tileKey(t) === '6-6'));
    assert.equal(match.hand.turn, holder);
    const acts = legalActions(match);
    assert.equal(acts.length, 1);
    assert.equal(tileKey((acts[0] as any).tile), '6-6');
  }
});

test('deals: 4p 7 each, 3p 9 each without 0-0, 2p split 14 each, 2p draw 7 + boneyard 14', () => {
  const four = createMatch({ mode: 'regular', playerCount: 4, seed: 3 }).match.hand;
  assert.deepEqual(four.hands.map((h) => h.length), [7, 7, 7, 7]);
  const three = createMatch({ mode: 'regular', playerCount: 3, seed: 3 }).match.hand;
  assert.deepEqual(three.hands.map((h) => h.length), [9, 9, 9]);
  assert.ok(!three.hands.flat().some((t) => tileKey(t) === '0-0'));
  const split = createMatch({ mode: 'regular', playerCount: 2, twoPlayerVariant: 'split', seed: 3 }).match.hand;
  assert.deepEqual(split.hands.map((h) => h.length), [14, 14]);
  const draw = createMatch({ mode: 'regular', playerCount: 2, twoPlayerVariant: 'draw', seed: 3 }).match.hand;
  assert.deepEqual(draw.hands.map((h) => h.length), [7, 7]);
  assert.equal(draw.boneyard.length, 14);
});

test('tally: strokes fill the earliest box, 50 goes in the next EMPTY box', () => {
  const t = buildTally([
    { kind: 'points', amount: 15, hand: 1 },  // box 1: 3 strokes
    { kind: 'bonus', amount: 50, hand: 1 },   // box 2: "50"
    { kind: 'points', amount: 40, hand: 1 },  // box 1 gets 7 more -> full, 1 into box 3
  ], 5);
  assert.deepEqual(t.boxes, [
    { kind: 'strokes', strokes: 10 },
    { kind: 'fifty' },
    { kind: 'strokes', strokes: 1 },
    { kind: 'strokes', strokes: 0 },
    { kind: 'strokes', strokes: 0 },
  ]);
  assert.equal(t.total, 105);
  assert.equal(t.full, false);
});

test('tally: a full row is exactly total >= target, overflow shows the extra', () => {
  const log = [
    { kind: 'bonus' as const, amount: 50, hand: 1 },
    { kind: 'bonus' as const, amount: 50, hand: 1 },
    { kind: 'bonus' as const, amount: 50, hand: 1 },
    { kind: 'bonus' as const, amount: 50, hand: 1 },
    { kind: 'points' as const, amount: 15, hand: 1 },
    { kind: 'bonus' as const, amount: 50, hand: 2 }, // no empty box: fills the last box, 15 over
  ];
  const t = buildTally(log, 5);
  assert.equal(t.full, true);
  assert.equal(t.overflow, 15);
});

test('Points mode is 4 players only', () => {
  assert.throws(() => createMatch({ mode: 'points', playerCount: 3 }), /4 players/);
  assert.throws(() => createMatch({ mode: 'points', playerCount: 2 }), /4 players/);
  assert.doesNotThrow(() => createMatch({ mode: 'regular', playerCount: 3 }));
});

test('player view never leaks other hands', () => {
  const { match } = createMatch({ mode: 'points', playerCount: 4, seed: 9 });
  const v = viewFor(match, 2);
  assert.equal(v.myHand.length, 7);
  assert.deepEqual(v.handCounts, [7, 7, 7, 7]);
  assert.equal(v.revealedHands, null);
  const json = JSON.stringify(v);
  for (const seat of [0, 1, 3]) for (const t of match.hand.hands[seat]) {
    // other players' tiles only appear in the payload if they are on the board or in my hand
    assert.ok(!v.myHand.some((x) => tileKey(x) === tileKey(t)));
  }
  assert.ok(!json.includes('"hands"'));
});

test('waitlist: losers get up, next online person is offered the seat, host never leaves', () => {
  const online = (id: string) => id !== 'away1';
  let room = { hostId: 'van', seats: ['van', 'a', 'b', 'c'] as (string | null)[], waitlist: [{ id: 'x', notify: true }, { id: 'y', notify: false }], offers: [] };
  // van finished last, c 3rd -> c gets up (host never does)
  const r = afterGame(room, [1, 2, 3, 0], 1, 1000, online);
  assert.deepEqual(r.room.seats, ['van', 'a', 'b', null]);
  assert.deepEqual(r.room.offers, [{ seat: 3, playerId: 'x', expiresAt: 1000 + SEAT_OFFER_MS }]);
  assert.deepEqual(r.room.waitlist.map((w) => w.id), ['y', 'c']);
  assert.ok(r.events.some((e: any) => e.type === 'notifyGameOver' && e.playerIds[0] === 'x'));
  assert.equal(readyToStart(r.room), false);
  const a = acceptSeat(r.room, 'x');
  assert.deepEqual(a.room.seats, ['van', 'a', 'b', 'x']);
  assert.equal(readyToStart(a.room), true);
});

test('waitlist: no answer in 1 minute -> next person gets the seat, the no-show goes to the back', () => {
  const room = { hostId: 'van', seats: ['van', 'a', 'b', 'c'] as (string | null)[], waitlist: [{ id: 'x', notify: false }, { id: 'y', notify: false }], offers: [] };
  let r = afterGame(room, [0, 1, 2, 3], 1, 0, () => true); // c lost
  assert.equal(r.room.offers[0].playerId, 'x');
  r = checkOffers(r.room, 30_000, () => true);             // still inside the minute
  assert.equal(r.room.offers[0].playerId, 'x');
  r = checkOffers(r.room, 60_000, () => true);             // minute is up
  assert.equal(r.room.offers[0].playerId, 'y');
  assert.deepEqual(r.room.waitlist.map((w) => w.id), ['c', 'x']);
});

test('waitlist: away players are skipped and seated away players get replaced', () => {
  const online = (id: string) => !['x', 'b'].includes(id); // x (1st in line) and b (seated) are away
  const room = { hostId: 'van', seats: ['van', 'a', 'b', 'c'] as (string | null)[], waitlist: [{ id: 'x', notify: false }, { id: 'y', notify: false }], offers: [] };
  const r = afterGame(room, [0, 1, 2, 3], 0, 0, online); // nobody "loses" a seat, but b is away
  assert.ok(r.events.some((e: any) => e.type === 'gotUp' && e.playerId === 'b' && e.reason === 'away'));
  assert.equal(r.room.offers[0].playerId, 'y'); // x skipped because away
  assert.equal(waitlistPosition(r.room, 'x'), 1);
  // Nobody waiting online -> nobody gets up.
  const r2 = afterGame(room, [0, 1, 2, 3], 2, 0, (id) => !['x', 'y'].includes(id));
  assert.deepEqual(r2.room.seats, room.seats);
});

// ────────────────────────────────────────────────────────────────────────────
// Fuzz: thousands of full bot games in every mode
// ────────────────────────────────────────────────────────────────────────────

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function checkInvariants(m: MatchState) {
  const h = m.hand;
  const onBoard = h.board.history.map((x) => tileKey(x.tile));
  const all = [...h.hands.flat().map(tileKey), ...h.boneyard.map(tileKey), ...onBoard];
  const expected = fullSet().map(tileKey).filter((k) => m.config.playerCount !== 3 || k !== '0-0');
  assert.equal(all.length, expected.length, 'tile count');
  assert.deepEqual([...all].sort(), [...expected].sort(), 'every tile exactly once');
  for (const s of m.scores) assert.equal(s % 5, 0, 'scores are multiples of 5');
  const layout = layoutBoard(h.board);
  assert.equal(layout.tiles.length, h.board.history.length, 'every tile is drawn');
  assert.deepEqual(findOverlaps(layout), [], `tiles overlap (seed ${m.config.seed}, hand ${h.number})`);
}

const configs: [string, MatchConfig, number][] = [
  ['4p regular', { mode: 'regular', playerCount: 4 }, 1500],
  ['4p points', { mode: 'points', playerCount: 4, rowBoxes: 10 }, 400],
  ['4p points short row', { mode: 'points', playerCount: 4, rowBoxes: 5 }, 400],
  ['3p regular', { mode: 'regular', playerCount: 3 }, 600],
  ['2p split regular', { mode: 'regular', playerCount: 2, twoPlayerVariant: 'split' }, 400],
  ['2p draw regular', { mode: 'regular', playerCount: 2, twoPlayerVariant: 'draw' }, 400],
];

for (const [name, cfg, games] of configs) {
  test(`fuzz: ${games} full games — ${name}`, () => {
    let locks = 0, dominos = 0, hands = 0, scoreEvents = 0;
    for (let g = 0; g < games; g++) {
      const rnd = seeded(g * 7919 + 13);
      let { match } = createMatch({ ...cfg, seed: g + 1 });
      let steps = 0;
      while (!match.over) {
        if (match.hand.over) {
          checkInvariants(match);
          ({ match } = startNextHand(match));
          continue;
        }
        const level = match.hand.turn % 2 === 0 ? 'hard' : 'easy';
        const r = applyAction(match, botMove(match, level, rnd));
        for (const e of r.events) {
          if (e.type === 'locked') locks++;
          if (e.type === 'domino') dominos++;
          if (e.type === 'handOver') hands++;
          if (e.type === 'score') { scoreEvents++; assert.equal(e.points % 5, 0); assert.ok(e.points >= 10, 'smallest score is 10'); }
        }
        match = r.match;
        checkInvariants(match);
        assert.ok(++steps < 20000, 'game should finish');
      }
      // match over
      const placings = match.placings!;
      assert.deepEqual([...placings].sort(), [...Array(cfg.playerCount).keys()]);
      const crowns = awardCrowns(match);
      assert.equal(crowns.filter((c) => c.medal).length, cfg.playerCount - 1);
      assert.equal(crowns[crowns.length - 1].medal, null);
      if (cfg.mode === 'points') {
        const winner = placings[0];
        assert.ok(match.scores[winner] >= targetScore(match), 'winner filled the row');
        match.scores.forEach((s, seat) => {
          const t = buildTally(match.scoreLog[seat], match.config.rowBoxes);
          assert.equal(t.total, s);
          const inBoxes = t.boxes.reduce((a, b) => a + (b.kind === 'fifty' ? 50 : b.strokes * 5), 0);
          assert.equal(inBoxes, Math.min(s, targetScore(match)));
          assert.equal(t.full, s >= targetScore(match));
          assert.equal(inBoxes + t.overflow, s);
        });
        assert.equal(crowns[0].fancy, true);
      }
    }
    assert.ok(dominos > 0 && hands > 0);
    if (cfg.mode === 'points') assert.ok(scoreEvents > 0);
    console.log(`  ${name}: ${games} games, ${hands} hands, ${dominos} dominos, ${locks} locks, ${scoreEvents} scoring plays`);
  });
}

test('autoStep runs a whole Points match with 4 bots; stops for humans', () => {
  const next = startNextHand;
  let { match } = createMatch({ mode: 'points', playerCount: 4, seed: 42, rowBoxes: 5 });
  let guard = 0;
  while (!match.over && guard++ < 5000) {
    if (match.hand.over) { ({ match } = next(match)); continue; }
    const r = autoStep(match, ['hard', 'easy', 'hard', 'easy']);
    assert.ok(r);
    match = r!.match;
  }
  assert.ok(match.over);
  // A human seat with real choices makes autoStep return null.
  const fresh = createMatch({ mode: 'regular', playerCount: 4, seed: 5 }).match;
  const humanSeats = ['human', 'human', 'human', 'human'] as const;
  const first = autoStep(fresh, [...humanSeats]);
  assert.equal(first, null); // opener must click the 6-6 themselves
});

test('standings: ordered by total points with places', () => {
  const m = rig({ mode: 'points', playerCount: 4 }, [[[6, 6]], [[6, 5], [0, 0]], [[4, 4], [3, 3]], [[1, 2], [0, 1]]], [6, 6]);
  m.scores = [100, 250, 460, 130];
  const r = play(m, [6, 6], 'center'); // seat 0 goes out: others hold 29 pips -> +30
  const st = standings(r.match);
  assert.deepEqual(st.map((x) => x.seat), [2, 1, 0, 3]);
  assert.deepEqual(st.map((x) => x.place), [1, 2, 3, 4]);
  assert.equal(st[2].total, 130); // ties seat 3 on 130, but did better this hand
  assert.equal(st[2].thisHand, 30);
  assert.equal(st[0].toGo, 40);
});

test('blocking a double: 50 to the player whose play shuts it out for good', () => {
  const build = () => {
    let b = emptyBoard();
    const moves: [Tile, any][] = [[[4, 6], 'center'], [[1, 4], 'W'], [[2, 6], 'E'], [[2, 4], 'E'], [[3, 4], 'E'], [[0, 1], 'W'], [[0, 4], 'W']];
    for (const [t, arm] of moves) b = placeTile(b, 'points', 3, t, arm);
    return b;
  };
  // Seat 1 holds the 4-4. Seat 0 plays the last 4 (4-5) on the only open 4 end.
  const m = rig({ mode: 'points', playerCount: 4 }, [[[4, 5], [1, 1]], [[4, 4], [2, 2]], [[5, 5], [3, 3]], [[6, 6], [0, 0]]]);
  m.hand.board = build();
  m.hand.forcedOpener = null;
  const r = play(m, [4, 5], 'W');
  const b = r.events.find((e: any) => e.type === 'bonus' && e.reason === 'blockedDouble') as any;
  assert.ok(b, 'bonus given');
  assert.equal(b.seat, 0);
  assert.equal(b.double, 4);
  assert.equal(b.holder, 1);
  assert.equal(r.match.scores[0], 50);

  // Blocking your OWN double pays nothing.
  const own = rig({ mode: 'points', playerCount: 4 }, [[[4, 5], [4, 4]], [[1, 1], [2, 2]], [[5, 5], [3, 3]], [[6, 6], [0, 0]]]);
  own.hand.board = build();
  own.hand.forcedOpener = null;
  const r2 = play(own, [4, 5], 'W');
  assert.ok(!r2.events.some((e: any) => e.reason === 'blockedDouble'));
});

test('countedHalves: marks exactly the halves that were added up', () => {
  let b = emptyBoard();
  b = placeTile(b, 'points', 0, [6, 6], 'center');
  b = placeTile(b, 'points', 1, [6, 3], 'E');
  assert.deepEqual(countedHalves(b), [{ order: 0, half: 'both' }, { order: 1, half: 'outer' }]);
  const L = layoutBoard(b);
  assert.equal(L.tiles[1].outerHalf, 'second'); // 6-3 going right: the 3 is on the right half
  assert.equal(L.tiles[1].second, 3);
});

test('All four: 100 (plus the normal count); made with the double it is 200', () => {
  // Centre 6-6 spinner; W 6-2, E 6-2, N 6-2 already down. Seat 0 plays 6-2 on S -> all four ends show 2.
  let b = emptyBoard();
  b = placeTile(b, 'points', 1, [6, 6], 'center');
  b = placeTile(b, 'points', 1, [2, 6], 'W');
  b = placeTile(b, 'points', 2, [0, 6], 'E');
  b = placeTile(b, 'points', 2, [0, 2], 'E');
  b = placeTile(b, 'points', 3, [1, 6], 'N');
  b = placeTile(b, 'points', 3, [1, 2], 'N');
  const m = rig({ mode: 'points', playerCount: 4 }, [[[3, 6], [2, 2]], [[5, 5], [4, 4]], [[5, 4], [3, 3]], [[1, 1], [0, 0]]]);
  m.hand.board = b;
  m.hand.forcedOpener = null;
  // S arm: 6-3 -> S shows 3, no bonus
  let r = play(m, [3, 6], 'S');
  assert.ok(!r.events.some((e: any) => e.reason === 'allFour'));

  // Now a real All four: W=2, E=2, N=2, S needs a 2 -> rebuild with S ending in 2.
  const m2 = rig({ mode: 'points', playerCount: 4 }, [[[2, 6], [3, 3]], [[5, 5], [2, 2]], [[5, 4], [2, 3]], [[1, 1], [0, 0]]]);
  let b2 = b;
  m2.hand.board = b2;
  m2.hand.forcedOpener = null;
  r = play(m2, [2, 6], 'S'); // ends: 2+2+2+2 = 8 (no count) + All four 100
  const k = r.events.find((e: any) => e.reason === 'allFour') as any;
  assert.ok(k, 'all four awarded');
  assert.equal(k.points, 100);
  assert.equal(k.doubled, false);
  assert.equal(k.allFourValue, 2);
  assert.equal(r.match.scores[0], 100);
  const t = buildTally(r.match.scoreLog[0], 10);
  assert.equal(t.boxes.filter((x) => x.kind === 'fifty').length, 2);

  // Next player doubles it up: 2-2 onto a 2 end keeps all four at 2 -> double all four 200,
  // plus the count (2-2 at an end counts 4, + 2 + 2 + 2 = 10).
  r = play(r.match, [2, 2], 'W');
  const d = r.events.find((e: any) => e.reason === 'allFour') as any;
  assert.equal(d.points, 200);
  assert.equal(d.doubled, true);
  assert.equal(r.match.scores[1], 210);
});
