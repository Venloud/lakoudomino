import {
  applyAction,
  autoStep,
  createMatch,
  IllegalMove,
  startNextHand,
  viewFor,
  type Action,
  type ArmId,
  type MatchConfig,
  type MatchState,
  type PlayerView,
  type SeatKind,
  type Tile,
  timeoutMove,
} from "lakou-engine";

export type EngineRoomState = {
  engineState: MatchState | null;
};

export type PublicEngineView = PlayerView & {
  /** The view is intentionally marked so callers cannot accidentally serialize MatchState. */
  engine: "lakou";
};

export function createRoomMatch(config: MatchConfig): { match: MatchState; events: unknown[] } {
  return createMatch(config);
}

export function publicView(match: MatchState, seat: number | null): PublicEngineView {
  return { ...viewFor(match, seat), engine: "lakou" };
}

function tileFromId(id: string): Tile | undefined {
  const parts = id.split("-");
  if (parts.length !== 2) return undefined;
  const left = Number(parts[0]);
  const right = Number(parts[1]);
  if (!Number.isInteger(left) || !Number.isInteger(right) ||
    left < 0 || left > 6 || right < 0 || right > 6) {
    return undefined;
  }
  return left <= right ? [left, right] : [right, left];
}

const armForSide: Record<string, ArmId> = {
  left: "W",
  right: "E",
  top: "N",
  bottom: "S",
};

/**
 * Convert the stable legacy socket payload into an engine Action. The engine
 * remains responsible for deciding whether the resulting action is legal.
 */
export function actionFromSocket(
  match: MatchState,
  seat: number,
  tileId: string,
  side: string,
): Action | undefined {
  if (match.hand.turn !== seat) throw new IllegalMove("It is not your turn");
  const tile = tileFromId(tileId);
  const arm = armForSide[side];
  if (!tile || !arm) return undefined;
  const legal = viewFor(match, seat).legal;
  return legal.find(
    (candidate) =>
      candidate.type === "play" &&
      (candidate.arm === arm || (candidate.arm === "center" && side === "left")) &&
      candidate.tile[0] === tile[0] &&
      candidate.tile[1] === tile[1],
  );
}

export function applySocketAction(
  match: MatchState,
  seat: number,
  tileId: string,
  side: string,
): { match: MatchState; events: unknown[] } {
  const action = actionFromSocket(match, seat, tileId, side);
  if (!action) throw new IllegalMove("That tile cannot be played on that end");
  return applyAction(match, action);
}

export function applySocketControlAction(
  match: MatchState,
  seat: number,
  type: "pass" | "draw",
): { match: MatchState; events: unknown[] } {
  if (match.hand.turn !== seat) throw new IllegalMove("It is not your turn");
  const action = viewFor(match, seat).legal.find((candidate) => candidate.type === type);
  if (!action) {
    throw new IllegalMove(type === "pass" ? "You cannot pass right now" : "You cannot draw right now");
  }
  return applyAction(match, action);
}

export function nextEngineHand(match: MatchState): { match: MatchState; events: unknown[] } {
  return startNextHand(match);
}

export function runAutomaticSteps(
  match: MatchState,
  seats: SeatKind[],
): { match: MatchState; events: unknown[] }[] {
  const changes: { match: MatchState; events: unknown[] }[] = [];
  let current = match;
  for (;;) {
    const step = autoStep(current, seats);
    if (!step) return changes;
    current = step.match;
    changes.push({ match: current, events: step.events });
  }
}

export function runTimeoutStep(match: MatchState): { match: MatchState; events: unknown[] } {
  return timeoutMove(match);
}

export { IllegalMove };