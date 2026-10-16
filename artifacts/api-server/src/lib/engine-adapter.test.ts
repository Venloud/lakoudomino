import assert from "node:assert/strict";
import test from "node:test";
import { GetGameResponse } from "@workspace/api-zod";
import {
  afterGame,
  acceptSeat,
  applyAction,
  createMatch,
  startNextHand,
  viewFor,
  type MatchState,
} from "lakou-engine";
import { applySocketAction, applySocketControlAction, publicView } from "./lakou-engine-adapter.ts";
import { restoreRoom, serializeRoom } from "./room-persistence-codec.ts";
import {
  gameSnapshot,
  nextHandSeatEligibility,
  validateSocketMessage,
} from "./room-protocol.ts";
import type { PersistedRoomState } from "./room-types.ts";

const room = (engineState: MatchState): PersistedRoomState => ({
  code: "TEST", hostName: "Host", mode: "regular", rowLength: 10,
  playerCount: 2, rowBoxes: 10, twoPlayerVariant: "draw", status: "playing",
  seats: [0, 1, 2, 3].map((seat) => ({
    seat: seat as 0 | 1 | 2 | 3, status: seat < 2 ? "waiting" : "open",
    name: seat < 2 ? `P${seat}` : null, reconnectTokenHash: null,
  })), lastAction: null, engineState, waitlist: [], offers: [],
});

test("MatchState round-trips with room metadata and no duplicate gameplay fields", () => {
  const match = createMatch({ mode: "regular", playerCount: 2, twoPlayerVariant: "draw", rowBoxes: 10 }).match;
  const restored = restoreRoom(serializeRoom(room(match)));
  assert.deepEqual(restored.engineState, match);
  assert.equal("board" in (serializeRoom(room(match)) as object), false);
  assert.equal("hand" in (serializeRoom(room(match)).seats[0] as object), false);
});

test("view projection keeps spectator hands empty and player hand private", () => {
  const match = createMatch({ mode: "regular", playerCount: 2 }).match;
  assert.deepEqual(viewFor(match, null).myHand, []);
  assert.ok(viewFor(match, 0).myHand.length > 0);
  assert.deepEqual(publicView(match, null).myHand, []);
});

test("illegal socket moves do not mutate MatchState", () => {
  const match = createMatch({ mode: "regular", playerCount: 2 }).match;
  const before = JSON.stringify(match);
  assert.throws(() => applySocketAction(match, match.hand.turn, "6-6", "right"));
  assert.equal(JSON.stringify(match), before);
});

test("socket moves are restricted to the active seat and the opening center tile", () => {
  const match = createMatch({ mode: "regular", playerCount: 2 }).match;
  const seat = match.hand.turn;
  const opening = viewFor(match, seat).legal.find((action) => action.type === "play" && action.arm === "center");
  assert.ok(opening && opening.type === "play");

  const started = applySocketAction(match, seat, `${opening.tile[0]}-${opening.tile[1]}`, "left");
  assert.notDeepEqual(started.match, match);
  assert.throws(() =>
    applySocketAction(match, (seat + 1) % 2, `${opening.tile[0]}-${opening.tile[1]}`, "left"),
    /not your turn/i,
  );
});

test("pass and draw socket actions are accepted only when the engine marks them legal", () => {
  const match = createMatch({ mode: "regular", playerCount: 2, twoPlayerVariant: "draw" }).match;
  const initialSeat = match.hand.turn;
  const initialState = JSON.stringify(match);
  assert.throws(() => applySocketControlAction(match, initialSeat, "pass"));
  assert.throws(() => applySocketControlAction(match, initialSeat, "draw"));
  assert.equal(JSON.stringify(match), initialState);

  let current = match;
  let sawLegalControl = false;
  for (let index = 0; index < 400 && !sawLegalControl; index += 1) {
    const seat = current.hand.turn;
    const legal = viewFor(current, seat).legal;
    const control = legal.find((action) => action.type === "pass" || action.type === "draw");
    if (control) {
      const result = applySocketControlAction(current, seat, control.type);
      assert.notDeepEqual(result.match, current);
      sawLegalControl = true;
      break;
    }
    const play = legal.find((action) => action.type === "play");
    if (!play) break;
    current = applyAction(current, play).match;
  }
  assert.ok(sawLegalControl, "simulation should reach a legal pass or draw");
});

test("pass and draw socket messages require an authenticated seat", () => {
  for (const type of ["pass", "draw"] as const) {
    const message = JSON.stringify({ type });
    assert.equal(validateSocketMessage(message, undefined).ok, false);
    assert.equal(validateSocketMessage(message, 0).ok, true);
  }
});

test("nextHand socket messages require an authenticated seat", () => {
  const message = JSON.stringify({ type: "nextHand" });
  assert.equal(validateSocketMessage(message, undefined).ok, false);
  assert.equal(validateSocketMessage(message, 0).ok, true);
});

test("waiting-room setting changes require an authenticated seat", () => {
  const message = JSON.stringify({
    type: "changeSettings", mode: "regular", rowBoxes: 10, turnSeconds: 30, isPrivate: false,
  });
  assert.equal(validateSocketMessage(message, undefined).ok, false);
  assert.equal(validateSocketMessage(message, 0).ok, true);
});

function finishPointsHand(): MatchState {
  let match = createMatch({ mode: "points", playerCount: 4, seed: 29 }).match;
  for (let index = 0; index < 500 && !match.hand.over && !match.over; index += 1) {
    const legal = viewFor(match, match.hand.turn).legal;
    const action = legal.find((candidate) => candidate.type === "play") ??
      legal.find((candidate) => candidate.type === "draw") ??
      legal.find((candidate) => candidate.type === "pass");
    assert.ok(action, "engine exposes a legal action until the hand ends");
    match = applyAction(match, action).match;
  }
  assert.equal(match.hand.over, true, "simulation should reach the standings");
  assert.equal(match.over, false, "a single Points hand should not finish the match");
  return match;
}

test("next-hand start permission is host-only for friend tables and shared for Play Now or bot tables", () => {
  const match = finishPointsHand();
  const friendRoom: PersistedRoomState = {
    ...room(match),
    mode: "points",
    playerCount: 4,
    status: "finished",
    seats: [0, 1, 2, 3].map((seat) => ({
      seat: seat as 0 | 1 | 2 | 3,
      status: "waiting",
      name: `P${seat}`,
      reconnectTokenHash: `seat-${seat}`,
    })),
  };
  assert.equal(nextHandSeatEligibility(friendRoom, 0).allowed, true);
  assert.equal(nextHandSeatEligibility(friendRoom, 1).allowed, false);

  const botRoom: PersistedRoomState = {
    ...friendRoom,
    seats: friendRoom.seats.map((seat) =>
      seat.seat === 3 ? { ...seat, status: "bot", reconnectTokenHash: null } : seat),
  };
  assert.equal(nextHandSeatEligibility(botRoom, 1).allowed, true);
  assert.equal(nextHandSeatEligibility(botRoom, 3).allowed, false);

  assert.equal(nextHandSeatEligibility({ ...friendRoom, playNow: true }, 1).allowed, true);
});

test("starting the next Points hand clears the ended hand and deals immediately", () => {
  const finished = finishPointsHand();
  const result = startNextHand(finished);
  assert.equal(result.match.hand.number, finished.hand.number + 1);
  assert.equal(result.match.hand.over, false);
  assert.ok(result.events.some((event) => event.type === "handStart"));
});

test("finished game snapshots serialize revealed hands as public domino objects", () => {
  let match = createMatch({ mode: "regular", playerCount: 2, twoPlayerVariant: "draw" }).match;
  for (let index = 0; index < 400 && !match.hand.over && !match.over; index += 1) {
    const legal = viewFor(match, match.hand.turn).legal;
    const action = legal.find((candidate) => candidate.type === "play") ??
      legal.find((candidate) => candidate.type === "draw") ??
      legal.find((candidate) => candidate.type === "pass");
    assert.ok(action, "engine exposes a legal action until the hand ends");
    match = applyAction(match, action).match;
  }
  assert.ok(match.hand.over || match.over, "simulated game should reach a finished hand");
  const snapshot = gameSnapshot(room(match));
  const parsed = GetGameResponse.parse(snapshot);
  assert.ok(parsed.engine);
  const revealedTile = parsed.engine.revealedHands?.[0]?.[0];
  if (revealedTile) {
    assert.equal(typeof revealedTile.id, "string");
    assert.equal(Array.isArray(revealedTile), false);
  }
});

test("room lifecycle offers a released seat and accepts it", () => {
  const identity = "waiter";
  const lifecycle = afterGame({
    hostId: "host", seats: ["host", "loser", null, null],
    waitlist: [{ id: identity, notify: true }], offers: [],
  }, [0, 1], 1, 1000, (id) => id === identity);
  assert.equal(lifecycle.room.offers[0]?.playerId, identity);
  const accepted = acceptSeat(lifecycle.room, identity);
  assert.equal(accepted.events[0]?.type, "seated");
  assert.equal(accepted.room.seats[1], identity);
});