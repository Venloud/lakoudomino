// Lakou Domino engine — shared types.
// Everything here is plain JSON so it can be stored, sent over WebSocket, or saved in a database.

/** A tile is two pip values, always stored low-high, e.g. [3, 6]. */
export type Tile = [number, number];

export type Mode = 'regular' | 'points';

/** Only used for 2 players: 'draw' = 7 each + boneyard you draw from; 'split' = 14 each. */
export type TwoPlayerVariant = 'draw' | 'split';

/** The four directions a line can grow on the table. W and E always exist; N and S only exist once a spinner is down. */
export type ArmId = 'W' | 'E' | 'N' | 'S';

export interface MatchConfig {
  mode: Mode;
  /** 2, 3 or 4 for Regular. Points mode is always 4 players. */
  playerCount: 2 | 3 | 4;
  /** Points mode only: number of 50-point boxes in each row. Min 5, default 10. */
  rowBoxes?: number;
  /** 2 players only. Default 'draw'. */
  twoPlayerVariant?: TwoPlayerVariant;
  /** Optional seed so games can be replayed exactly (tests, bug reports). */
  seed?: number;
}

export interface Placement {
  tile: Tile;
  /** The pip value that touches the tile before it (or null for the first tile). */
  inner: number | null;
  /** The pip value left open on the outside. */
  outer: number;
  seat: number;
  isDouble: boolean;
}

export interface Arm {
  id: ArmId;
  /** Tiles on this arm, going outward from the centre. */
  tiles: Placement[];
  /** Value a new tile must match on this arm. */
  value: number;
}

export interface Spinner {
  tile: Tile;
  /** 'center' if the spinner was the first tile; otherwise the arm it sits on and its index on that arm. */
  where: 'center' | { arm: ArmId; index: number };
}

export interface BoardState {
  /** First tile of the hand (sits in the middle). null before anyone plays. */
  center: Placement | null;
  arms: Partial<Record<ArmId, Arm>>;
  spinner: Spinner | null;
  /** Every play in order — the layout engine replays this to draw the table. */
  history: { seat: number; tile: Tile; arm: ArmId | 'center' }[];
}

export type Action =
  | { type: 'play'; tile: Tile; arm: ArmId | 'center' }
  | { type: 'pass' }
  | { type: 'draw' };

export type GameEvent =
  | { type: 'handStart'; hand: number; starter: number }
  | { type: 'play'; seat: number; tile: Tile; arm: ArmId | 'center' }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number }
  /** Points scored from the ends (multiple of 5). */
  | { type: 'score'; seat: number; points: number; endsTotal: number }
  /** A 50-point bonus. reason tells the UI which pop-up to show. */
  | { type: 'bonus'; seat: number; points: number; reason: 'pass' | 'domino' | 'lowestLock' | 'blockedDouble' | 'allFour' | 'lockedGame'; passer?: number;
      /** allFour: the number showing on all four ends. */
      allFourValue?: number;
      /** allFour: true when it was made by playing the double (200 instead of 100). */
      doubled?: boolean;
      /** domino: the other players' pips added up, before rounding to the nearest 5. */
      pipsLeft?: number;
      /** blockedDouble: which double got shut out (e.g. 4 = the 4-4) and who is stuck holding it. */
      double?: number; holder?: number }
  /** Someone played their last tile. */
  | { type: 'domino'; seat: number }
  /** Nobody can play. */
  | { type: 'locked'; pips: number[] }
  | { type: 'handOver'; hand: number; winner: number | null; ranking: number[]; pips: number[] }
  | { type: 'matchOver'; placings: number[] };

export interface HandState {
  number: number;
  hands: Tile[][];
  boneyard: Tile[];
  board: BoardState;
  turn: number;
  starter: number;
  /** Tile the starter is forced to open with (6-6 in hand 1), or null if any tile is allowed. */
  forcedOpener: Tile | null;
  /** Seat that made the most recent play (gets the 50 when others pass). */
  lastPlayer: number | null;
  /** Consecutive passes since the last play. */
  passesInRow: number;
  over: boolean;
  winner: number | null;
  ranking: number[] | null;
}

/** One entry in a player's scoreboard history. */
export interface ScoreEntry {
  kind: 'points' | 'bonus';
  amount: number;
  hand: number;
  /** Why these points were given (bonuses). Missing = counted from the ends. */
  reason?: 'pass' | 'domino' | 'lowestLock' | 'blockedDouble' | 'allFour' | 'lockedGame';
  /** domino: the other hands' pips added up, before rounding. */
  pipsLeft?: number;
  /** allFour: made with the double (200). */
  doubled?: boolean;
}

export interface MatchState {
  config: Required<Omit<MatchConfig, 'seed' | 'twoPlayerVariant'>> & { seed: number; twoPlayerVariant: TwoPlayerVariant };
  rngState: number;
  scores: number[];
  scoreLog: ScoreEntry[][];
  hand: HandState;
  handsPlayed: number;
  over: boolean;
  /** Seats from 1st to last, set when the match ends. */
  placings: number[] | null;
}

export type Medal = 'gold' | 'silver' | 'bronze';

export interface CrownAward {
  seat: number;
  place: number; // 1-based
  medal: Medal | null;
  crownPoints: number; // 3 / 2 / 1 / 0
  /** true for Points-mode crowns (drawn with the fancy outline). */
  fancy: boolean;
}
