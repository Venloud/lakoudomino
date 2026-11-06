import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import {
  createArcadeInitialState,
  getArcadeBotTransition,
  validateArcadeTransition,
} from "./arcade-validation.ts";

const move = (
  game: Parameters<typeof createArcadeInitialState>[0],
  current: unknown,
  proposed: unknown,
  seat: number,
  capacity = 2,
  currentTurn = seat,
  submittedTurn: unknown = currentTurn,
) => validateArcadeTransition(game, current, proposed, seat, capacity, currentTurn, submittedTurn);

function privateScrabbleView(state: Record<string, unknown>, seat: number): Record<string, unknown> {
  return {
    ...state,
    racks: (state.racks as string[][]).map((rack, index) => index === seat ? [...rack] : []),
    bag: (state.bag as string[]).map(() => ""),
  };
}

test("Mòpyon accepts one turn-correct mark and rejects overwritten or multi-cell boards", () => {
  const current = createArcadeInitialState("mopyon", 2) as Record<string, unknown>;
  const board = [...current.board as unknown[]];
  board[0] = "X";
  const legal = { ...current, board, currentPlayer: "O", lastMove: 0 };
  assert.equal(move("mopyon", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("mopyon", current, { ...legal, board: board.map(() => "X") }, 0, 2, 0, 1).ok, false);
  assert.equal(move("mopyon", current, legal, 1, 2, 0, 1).ok, false);
});

test("Box checks edge ownership, scoring, and extra turns", () => {
  const current = createArcadeInitialState("box", 2) as Record<string, unknown>;
  const legal = { ...current, dots: ["h:0:0"], edgeOwners: [["h:0:0", 0]], turn: 1 };
  assert.equal(move("box", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("box", current, { ...legal, claimed: Array(9).fill(0) }, 0, 2, 0, 1).ok, false);
  assert.equal(move("box", current, legal, 1, 2, 0, 1).ok, false);
});

test("Kay validates sowing instead of trusting submitted pit counts", () => {
  const current = createArcadeInitialState("kay", 2) as Record<string, unknown>;
  const pits = [...current.pits as number[]];
  pits[0] = 0;
  pits[1] += 1;
  pits[2] += 1;
  pits[3] += 1;
  pits[4] += 1;
  const legal = { turn: 1, winner: null, pits };
  assert.equal(move("kay", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("kay", current, { ...legal, pits: pits.map((n, i) => i === 0 ? n + 99 : n) }, 0, 2, 0, 1).ok, false);
});

test("Chess accepts a legal move but rejects forged FENs and clocks", () => {
  const current = createArcadeInitialState("chess", 2) as Record<string, unknown>;
  const chess = new Chess(String(current.fen));
  chess.move("e4");
  const legal = { ...current, fen: chess.fen(), turn: 1 };
  assert.equal(move("chess", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("chess", current, { ...legal, fen: new Chess().fen() }, 0, 2, 0, 1).ok, false);
  assert.equal(move("chess", current, { ...legal, clocks: [700000, 600000] }, 0, 2, 0, 1).ok, false);
});

test("Dame only accepts a legal diagonal step from the active side", () => {
  const current = createArcadeInitialState("dame", 2) as Record<string, unknown>;
  const pieces = [...current.pieces as (Record<string, unknown> | null)[]];
  pieces[33] = pieces[40];
  pieces[40] = null;
  const legal = { turn: 1, winner: null, pieces };
  assert.equal(move("dame", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("dame", current, { ...legal, pieces: [...pieces.slice(0, 32), { side: 0, kind: "Q" }, ...pieces.slice(33)] }, 0, 2, 0, 1).ok, false);
});

test("Scrabble recalculates submitted scores from the trusted room state", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  const legal = { ...privateScrabbleView(current, 0), turn: 1, passes: 1 };
  const result = move("scrabble", current, legal, 0, 2, 0, 1);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  const forgedScore = move("scrabble", current, { ...legal, scores: [999, 0] }, 0, 2, 0, 1);
  assert.equal(forgedScore.ok, true, forgedScore.ok ? undefined : forgedScore.error);
  if (forgedScore.ok) assert.deepEqual((forgedScore.state as Record<string, unknown>).scores, current.scores);
});

test("Scrabble accepts a private player view and restores hidden state from the server", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  const racks = [...current.racks as string[][]].map((rack) => [...rack]);
  racks[0] = ["C", "A", "T", "S", "E", "R", "N"];
  racks[1] = ["Q", "Q", "Q", "Q", "Q", "Q", "Q"];
  current.racks = racks;
  current.bag = ["B", "D", "E", "F", "G", "H"];

  const board = [...current.board as (Record<string, unknown> | null)[]];
  board[112] = { letter: "C", points: 3 };
  board[113] = { letter: "A", points: 1 };
  board[114] = { letter: "T", points: 1 };
  const projectedMove = {
    ...privateScrabbleView(current, 0),
    board,
    racks: [["S", "E", "R", "N", "", "", ""], []],
    bag: ["", "", ""],
    scores: [10, 0],
    turn: 1,
    passes: 0,
  };

  const result = move("scrabble", current, projectedMove, 0, 2, 0, 1);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (result.ok) {
    const accepted = result.state as Record<string, unknown>;
    assert.deepEqual(accepted.racks, [["S", "E", "R", "N", "B", "D", "E"], racks[1]]);
    assert.deepEqual(accepted.bag, ["F", "G", "H"]);
  }
});

test("Scrabble replays a connected word and validates its score, rack refill, and turn", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  const racks = [...current.racks as string[][]].map((rack) => [...rack]);
  racks[0] = ["C", "A", "T", "B", "D", "E", "F"];
  current.racks = racks;
  const bag = [...current.bag as string[]];
  const board = [...current.board as (Record<string, unknown> | null)[]];
  const nextRacks = racks.map((rack) => [...rack]);
  board[112] = { letter: "C", points: 3 };
  board[113] = { letter: "A", points: 1 };
  board[114] = { letter: "T", points: 1 };
  nextRacks[0] = [...nextRacks[0].slice(3), ...bag.slice(0, 3)];
  const nextBag = bag.slice(3);
  const legal = {
    ...privateScrabbleView(current, 0),
    board,
    racks: [[...nextRacks[0].slice(0, 4), "", "", ""], []],
    bag: nextBag.map(() => ""),
    scores: [10, 0],
    turn: 1,
    passes: 0,
  };
  const result = move("scrabble", current, legal, 0, 2, 0, 1);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  const forgedScore = move("scrabble", current, { ...legal, scores: [999, 0] }, 0, 2, 0, 1);
  assert.equal(forgedScore.ok, true, forgedScore.ok ? undefined : forgedScore.error);
  if (forgedScore.ok) assert.deepEqual((forgedScore.state as Record<string, unknown>).scores, [10, 0]);
});

test("Scrabble exchanges only tiles from the active rack and shuffles the return bag server-side", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  const racks = [...current.racks as string[][]].map((rack) => [...rack]);
  racks[0] = ["A", "B", "C", "D", "E", "F", "G"];
  current.racks = racks;
  const bag = [...current.bag as string[]];
  const privateCurrent = privateScrabbleView(current, 0);
  const proposed = {
    ...privateCurrent,
    racks: [[...racks[0].slice(1), ""], []],
    bag: bag.map(() => ""),
    turn: 1,
    passes: 0,
  };
  const result = move("scrabble", current, proposed, 0, 2, 0, 1);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (result.ok) {
    const returnedBag = (result.state as Record<string, unknown>).bag as string[];
    assert.equal(returnedBag.length, bag.length);
    assert.deepEqual([...returnedBag].sort(), [...bag.slice(1), "A"].sort());
  }
  assert.equal(move("scrabble", current, { ...current, turn: 1, passes: 0 }, 0, 2, 0, 1).ok, false);
});

test("Barricade accepts a bounded die roll but does not accept altered pawns", () => {
  const current = createArcadeInitialState("barricade", 2) as Record<string, unknown>;
  const legal = { ...current, roll: 4, message: "Player 1 rolled 4. Choose a pawn." };
  const result = move("barricade", current, legal, 0, 2, 0, 0);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok([1, 2, 3, 4, 5, 6].includes((result.state as Record<string, number>).roll));
  assert.equal(move("barricade", current, { ...legal, pawns: [] }, 0, 2, 0, 0).ok, false);
});

test("Four in a Row enforces gravity and turn order", () => {
  const current = createArcadeInitialState("four-in-a-row", 2) as Record<string, unknown>;
  const four = [...current.four as (number | null)[]];
  four[35] = 0;
  const legal = { turn: 1, winner: null, four };
  assert.equal(move("four-in-a-row", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("four-in-a-row", current, { ...legal, four: four.map((cell, index) => index === 0 ? 0 : cell) }, 0, 2, 0, 1).ok, false);
});

test("Filler validates the selected color and computes the territory from the server board", () => {
  const current = createArcadeInitialState("filler", 2) as Record<string, unknown>;
  const fillerBoard = current.fillerBoard as Record<string, unknown>;
  const colors = [...fillerBoard.colors as number[]];
  const owners = [...fillerBoard.owners as (number | null)[]];
  const occupiedColors = new Set(owners.flatMap((owner, index) => owner === null ? [] : [colors[index]]));
  const color = [0, 1, 2, 3, 4, 5].find((candidate) => !occupiedColors.has(candidate))!;
  const nextColors = [...colors];
  const nextOwners = [...owners];
  const frontier = owners.flatMap((owner, index) => owner === 0 ? [index] : []);
  for (const index of frontier) nextColors[index] = color;
  for (let cursor = 0; cursor < frontier.length; cursor += 1) {
    const index = frontier[cursor], row = Math.floor(index / 8), col = index % 8;
    const neighbors = [row > 0 ? index - 8 : -1, row < 7 ? index + 8 : -1, col > 0 ? index - 1 : -1, col < 7 ? index + 1 : -1].filter((n) => n >= 0);
    for (const neighbor of neighbors) if (nextOwners[neighbor] === null && nextColors[neighbor] === color) {
      nextOwners[neighbor] = 0;
      frontier.push(neighbor);
    }
  }
  const scores = [nextOwners.filter((owner) => owner === 0).length, nextOwners.filter((owner) => owner === 1).length];
  const nested = {
    colors: nextColors, owners: nextOwners, playerCount: 2, turn: 1, scores,
    winner: null, draw: nextOwners.every((owner) => owner !== null) && scores[0] === scores[1],
  };
  if (nested.draw) nested.winner = null;
  const legal = { turn: 1, winner: nested.draw ? "draw" : null, fillerPlayerCount: 2, fillerBoard: nested };
  assert.equal(move("filler", current, legal, 0, 2, 0, 1).ok, true);
  assert.equal(move("filler", current, { ...legal, fillerBoard: { ...nested, owners: Array(64).fill(0) } }, 0, 2, 0, 1).ok, false);
});

test("Block Drop accepts a legal move for the sender and protects the other race board", () => {
  const current = createArcadeInitialState("block-drop", 2) as Record<string, unknown>[];
  const own = structuredClone(current[0]) as Record<string, unknown>;
  const active = own.active as Record<string, unknown>;
  own.active = { ...active, x: Number(active.x) - 1 };
  assert.equal(move("block-drop", current, own, 0, 2, 0, 0).ok, true);
  assert.equal(move("block-drop", current, { ...own, score: 1000 }, 0, 2, 0, 0).ok, false);
});

test("Scrabble takeover bot makes a validated legal word play from its server rack", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  current.racks = [
    ["C", "A", "T", "S", "E", "R", "N"],
    ["Q", "Q", "Q", "Q", "Q", "Q", "Q"],
  ];
  const result = getArcadeBotTransition("scrabble", current, 0, 2);
  assert.ok(result);
  const state = result.state as Record<string, unknown>;
  assert.equal(result.turn, 1);
  assert.equal(state.turn, 1);
  assert.equal(state.passes, 0);
  assert.ok((state.board as unknown[]).some((tile) => tile !== null));
  assert.ok((state.scores as number[])[0] > 0);
  assert.deepEqual((state.racks as string[][])[1], ["Q", "Q", "Q", "Q", "Q", "Q", "Q"]);
});

test("Scrabble takeover bot passes when no rack word can be played", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  current.racks = [
    ["Q", "Q", "Q", "Q", "Q", "Q", "Q"],
    ["A", "A", "A", "A", "A", "A", "A"],
  ];
  const result = getArcadeBotTransition("scrabble", current, 0, 2);
  assert.ok(result);
  const state = result.state as Record<string, unknown>;
  assert.equal(state.turn, 1);
  assert.equal(state.passes, 1);
  assert.deepEqual(state.board, current.board);
});

test("Scrabble takeover bot applies trusted end-game scoring on its final play", () => {
  const current = createArcadeInitialState("scrabble", 2) as Record<string, unknown>;
  const board = [...current.board as (Record<string, unknown> | null)[]];
  board[112] = { letter: "C", points: 3 };
  board[113] = { letter: "A", points: 1 };
  board[114] = { letter: "T", points: 1 };
  current.board = board;
  current.racks = [["Q"], ["S"]];
  current.bag = [];
  current.scores = [0, 0];
  current.turn = 1;

  const result = getArcadeBotTransition("scrabble", current, 1, 2);
  assert.ok(result);
  const state = result.state as Record<string, unknown>;
  assert.equal(state.winner, 1);
  assert.deepEqual(state.scores, [-10, 16]);
  assert.deepEqual(state.racks, [["Q"], []]);
});
