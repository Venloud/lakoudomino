export type WordYardMode = "classic" | "speed" | "party";
export type LetterFeedback = "correct" | "present" | "absent";
export type WordYardGuess = { word: string; feedback: LetterFeedback[]; submittedAt: number };
export type WordYardRound = {
  answer: string;
  wordLength: number;
  startedAt: number;
  deadlineAt: number;
  guesses: WordYardGuess[];
  status: "playing" | "solved" | "failed" | "timed-out";
  completedAt: number | null;
};
export type WordYardRoundView = Omit<WordYardRound, "answer"> & { answer?: never };
export type WordYardMatchPlayer = {
  playerId: string;
  rounds: WordYardRound[];
  totalScore: number;
  completionTimes: number[];
};
export type WordYardMatch = {
  mode: WordYardMode;
  roundNumber: number;
  roundsToPlay: number;
  timeLimitMs: number;
  status: "playing" | "round-complete" | "finished";
  players: WordYardMatchPlayer[];
};
export type WordYardMatchPlayerView = {
  playerId: string;
  totalScore: number;
  guessesUsed: number;
  status: WordYardRound["status"];
  ownRound?: WordYardRoundView;
};
export type WordYardMatchView = {
  mode: WordYardMode;
  roundNumber: number;
  roundsToPlay: number;
  timeLimitMs: number;
  status: WordYardMatch["status"];
  players: WordYardMatchPlayerView[];
  answer?: string;
};

export const WORD_YARD_MAX_GUESSES = 6;
export const WORD_YARD_MIN_LENGTH = 4;
export const WORD_YARD_MAX_LENGTH = 7;

export function chooseWordYardAnswer(
  acceptedWords: ReadonlySet<string>,
  wordLength: number,
  random: () => number = Math.random,
): string {
  if (!Number.isInteger(wordLength) || wordLength < WORD_YARD_MIN_LENGTH || wordLength > WORD_YARD_MAX_LENGTH) {
    throw new RangeError("Word Yard word length must be 4–7 letters.");
  }
  const candidates = [...new Set([...acceptedWords].map((word) => word.toUpperCase()))]
    .filter((word) => word.length === wordLength && /^[A-Z]+$/.test(word))
    .sort();
  if (!candidates.length) throw new Error(`The accepted dictionary has no ${wordLength}-letter answers.`);
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("The random source must return a value in [0, 1).");
  return candidates[Math.floor(value * candidates.length)];
}

export function createWordYardRound(
  answer: string,
  startedAt: number,
  durationMs: number,
): WordYardRound {
  const normalized = answer.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized) || normalized.length < WORD_YARD_MIN_LENGTH || normalized.length > WORD_YARD_MAX_LENGTH) {
    throw new RangeError("Word Yard answers must be 4–7 letters.");
  }
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError("Word Yard rounds need a valid start time and time limit.");
  }
  return {
    answer: normalized,
    wordLength: normalized.length,
    startedAt,
    deadlineAt: startedAt + durationMs,
    guesses: [],
    status: "playing",
    completedAt: null,
  };
}

export function evaluateWordYardGuess(answer: string, guess: string): LetterFeedback[] {
  const target = answer.toUpperCase();
  const attempt = guess.toUpperCase();
  if (target.length !== attempt.length || !/^[A-Z]+$/.test(target) || !/^[A-Z]+$/.test(attempt)) {
    throw new RangeError("The guess and answer must be same-length alphabetic words.");
  }
  const feedback: LetterFeedback[] = Array(attempt.length).fill("absent");
  const remaining = new Map<string, number>();
  for (let i = 0; i < target.length; i++) {
    if (attempt[i] === target[i]) feedback[i] = "correct";
    else remaining.set(target[i], (remaining.get(target[i]) ?? 0) + 1);
  }
  for (let i = 0; i < attempt.length; i++) {
    if (feedback[i] === "correct") continue;
    const count = remaining.get(attempt[i]) ?? 0;
    if (count > 0) {
      feedback[i] = "present";
      remaining.set(attempt[i], count - 1);
    }
  }
  return feedback;
}

export function submitWordYardGuess(
  round: WordYardRound,
  guess: string,
  acceptedWords: ReadonlySet<string>,
  submittedAt: number,
): { round: WordYardRound; error?: never } | { round?: never; error: string } {
  if (round.status !== "playing") return { error: "This round is already over." };
  if (submittedAt >= round.deadlineAt) {
    return { round: { ...round, status: "timed-out", completedAt: round.deadlineAt } };
  }
  const word = guess.trim().toUpperCase();
  if (!new RegExp(`^[A-Z]{${round.wordLength}}$`).test(word)) {
    return { error: `Enter a ${round.wordLength}-letter word.` };
  }
  if (!acceptedWords.has(word)) return { error: "That word is not in the accepted word list." };
  if (round.guesses.some((entry) => entry.word === word)) return { error: "You already guessed that word." };

  const guesses = [...round.guesses, {
    word,
    feedback: evaluateWordYardGuess(round.answer, word),
    submittedAt,
  }];
  const solved = word === round.answer;
  const exhausted = !solved && guesses.length >= WORD_YARD_MAX_GUESSES;
  return {
    round: {
      ...round,
      guesses,
      status: solved ? "solved" : exhausted ? "failed" : "playing",
      completedAt: solved || exhausted ? submittedAt : null,
    },
  };
}

export function scoreWordYardRound(round: WordYardRound): { points: number; completionMs: number | null } {
  if (round.status !== "solved" || round.completedAt === null) return { points: 0, completionMs: null };
  return {
    points: 100 + (WORD_YARD_MAX_GUESSES - round.guesses.length) * 20,
    completionMs: Math.max(0, round.completedAt - round.startedAt),
  };
}

export function createWordYardMatch(input: {
  mode: WordYardMode;
  playerIds: string[];
  answer: string;
  startedAt: number;
  timeLimitMs: number;
  roundsToPlay?: number;
}): WordYardMatch {
  const uniqueIds = [...new Set(input.playerIds)];
  if (uniqueIds.length < 2 || uniqueIds.length > 4 || uniqueIds.length !== input.playerIds.length ||
      uniqueIds.some((id) => !id.trim())) {
    throw new RangeError("Word Yard matches require 2–4 unique players.");
  }
  const roundsToPlay = input.roundsToPlay ?? (input.mode === "party" ? 3 : 1);
  if (!Number.isInteger(roundsToPlay) || roundsToPlay < 1 || roundsToPlay > 10) {
    throw new RangeError("Word Yard matches can have 1–10 rounds.");
  }
  const template = createWordYardRound(input.answer, input.startedAt, input.timeLimitMs);
  return {
    mode: input.mode,
    roundNumber: 1,
    roundsToPlay,
    timeLimitMs: input.timeLimitMs,
    status: "playing",
    players: uniqueIds.map((playerId) => ({
      playerId,
      rounds: [{ ...template, guesses: [] }],
      totalScore: 0,
      completionTimes: [],
    })),
  };
}

function closeWordYardMatchRound(match: WordYardMatch): WordYardMatch {
  const players = match.players.map((player) => {
    const round = player.rounds.at(-1)!;
    const result = scoreWordYardRound(round);
    return {
      ...player,
      totalScore: player.totalScore + result.points,
      completionTimes: [...player.completionTimes, ...(result.completionMs === null ? [] : [result.completionMs])],
    };
  });
  return {
    ...match,
    players,
    status: match.roundNumber >= match.roundsToPlay ? "finished" : "round-complete",
  };
}

export function submitWordYardMatchGuess(
  match: WordYardMatch,
  playerId: string,
  guess: string,
  acceptedWords: ReadonlySet<string>,
  submittedAt: number,
): { match: WordYardMatch; error?: never } | { match?: never; error: string } {
  if (match.status !== "playing") return { error: "This Word Yard round is not accepting guesses." };
  const playerIndex = match.players.findIndex((player) => player.playerId === playerId);
  if (playerIndex < 0) return { error: "You are not seated in this Word Yard match." };
  const player = match.players[playerIndex];
  const result = submitWordYardGuess(player.rounds.at(-1)!, guess, acceptedWords, submittedAt);
  if (!result.round) return { error: result.error };
  const players = [...match.players];
  players[playerIndex] = { ...player, rounds: [...player.rounds.slice(0, -1), result.round] };
  const updated = { ...match, players };
  const settled = players.every((entry) => entry.rounds.at(-1)!.status !== "playing");
  return { match: settled ? closeWordYardMatchRound(updated) : updated };
}

export function settleWordYardDeadline(match: WordYardMatch, now: number): WordYardMatch {
  if (match.status !== "playing" || now < Math.max(...match.players.map((player) => player.rounds.at(-1)!.deadlineAt))) return match;
  const players = match.players.map((player) => {
    const round = player.rounds.at(-1)!;
    return round.status === "playing"
      ? { ...player, rounds: [...player.rounds.slice(0, -1), { ...round, status: "timed-out" as const, completedAt: round.deadlineAt }] }
      : player;
  });
  return closeWordYardMatchRound({ ...match, players });
}

export function startNextWordYardMatchRound(match: WordYardMatch, answer: string, startedAt: number): WordYardMatch {
  if (match.status !== "round-complete") throw new Error("The current Word Yard round must finish first.");
  const template = createWordYardRound(answer, startedAt, match.timeLimitMs);
  return {
    ...match,
    roundNumber: match.roundNumber + 1,
    status: "playing",
    players: match.players.map((player) => ({ ...player, rounds: [...player.rounds, { ...template, guesses: [] }] })),
  };
}

export function toWordYardMatchView(match: WordYardMatch, viewerId: string): WordYardMatchView {
  const reveal = match.status !== "playing";
  return {
    mode: match.mode,
    roundNumber: match.roundNumber,
    roundsToPlay: match.roundsToPlay,
    timeLimitMs: match.timeLimitMs,
    status: match.status,
    answer: reveal ? match.players[0]?.rounds.at(-1)?.answer : undefined,
    players: match.players.map((player) => {
      const round = player.rounds.at(-1)!;
      return {
        playerId: player.playerId,
        totalScore: player.totalScore,
        guessesUsed: round.guesses.length,
        status: round.status,
        ownRound: player.playerId === viewerId ? toWordYardRoundView(round) : undefined,
      };
    }),
  };
}

export type WordYardStanding = { playerId: string; score: number; completionMs: number | null };

export function rankWordYardPlayers(players: readonly WordYardStanding[]): WordYardStanding[] {
  return [...players].sort((a, b) =>
    b.score - a.score ||
    (a.completionMs ?? Number.POSITIVE_INFINITY) - (b.completionMs ?? Number.POSITIVE_INFINITY) ||
    a.playerId.localeCompare(b.playerId),
  );
}

export function wordYardLeaderboard(match: WordYardMatch): WordYardStanding[] {
  return rankWordYardPlayers(match.players.map((player) => ({
    playerId: player.playerId,
    score: player.totalScore,
    completionMs: player.completionTimes.length
      ? player.completionTimes.reduce((sum, elapsed) => sum + elapsed, 0)
      : null,
  })));
}

export function toWordYardRoundView(round: WordYardRound): WordYardRoundView {
  const { answer: _answer, ...view } = round;
  return view;
}
