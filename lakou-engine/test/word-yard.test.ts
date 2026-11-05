import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWordYardRound,
  createWordYardMatch,
  chooseWordYardAnswer,
  evaluateWordYardGuess,
  rankWordYardPlayers,
  scoreWordYardRound,
  startNextWordYardMatchRound,
  submitWordYardMatchGuess,
  submitWordYardGuess,
  toWordYardMatchView,
  toWordYardRoundView,
  wordYardLeaderboard,
} from '../src/word-yard';

describe('Word Yard word guessing rules', () => {
  it('marks repeated letters without awarding more matches than the answer contains', () => {
    assert.deepEqual(evaluateWordYardGuess('APPLE', 'ALLEY'), [
      'correct', 'present', 'absent', 'present', 'absent',
    ]);
    assert.deepEqual(evaluateWordYardGuess('LEVEL', 'LEVER'), [
      'correct', 'correct', 'correct', 'correct', 'absent',
    ]);
  });

  it('supports variable word lengths and keeps the answer out of the public view', () => {
    const round = createWordYardRound('PLUM', 1_000, 60_000);
    assert.equal(round.wordLength, 4);
    assert.equal('answer' in toWordYardRoundView(round), false);
    assert.throws(() => createWordYardRound('TOO', 1_000, 60_000), RangeError);
  });

  it('selects only an accepted answer of the configured length', () => {
    const words = new Set(['PLUM', 'APPLE', 'Grape', 'APPLE']);
    assert.equal(chooseWordYardAnswer(words, 5, () => 0.99), 'GRAPE');
    assert.throws(() => chooseWordYardAnswer(words, 6), /no 6-letter answers/);
    assert.throws(() => chooseWordYardAnswer(words, 5, () => 1), RangeError);
  });

  it('rejects invalid and duplicate guesses without consuming attempts', () => {
    const round = createWordYardRound('APPLE', 1_000, 60_000);
    const words = new Set(['APPLE', 'AMPLE', 'APPLY']);
    assert.equal(submitWordYardGuess(round, 'NOPE', words, 2_000).round, undefined);
    assert.equal(round.guesses.length, 0);
    const first = submitWordYardGuess(round, 'AMPLE', words, 2_000);
    assert.ok(first.round);
    assert.equal(submitWordYardGuess(first.round, 'AMPLE', words, 3_000).round, undefined);
    assert.equal(first.round.guesses.length, 1);
  });

  it('scores solved rounds by attempts and ranks equal scores by completion time', () => {
    const words = new Set(['APPLE', 'AMPLE', 'APPLY']);
    let round = createWordYardRound('APPLE', 1_000, 60_000);
    round = submitWordYardGuess(round, 'AMPLE', words, 2_000).round!;
    round = submitWordYardGuess(round, 'APPLE', words, 4_000).round!;
    assert.deepEqual(scoreWordYardRound(round), { points: 180, completionMs: 3_000 });
    assert.deepEqual(rankWordYardPlayers([
      { playerId: 'slow', score: 180, completionMs: 4_000 },
      { playerId: 'fast', score: 180, completionMs: 3_000 },
    ]).map(({ playerId }) => playerId), ['fast', 'slow']);
  });

  it('times out at the server deadline and fails after six guesses', () => {
    const words = new Set(['AMPLE', 'APPLY', 'ALIEN', 'ANGER', 'AMUSE', 'AWAKE', 'ABIDE']);
    const timed = submitWordYardGuess(createWordYardRound('APPLE', 1_000, 5_000), 'AMPLE', words, 6_000);
    assert.equal(timed.round?.status, 'timed-out');
    let round = createWordYardRound('APPLE', 1_000, 60_000);
    for (const [index, guess] of ['AMPLE', 'APPLY', 'ALIEN', 'ANGER', 'AMUSE', 'AWAKE'].entries()) {
      round = submitWordYardGuess(round, guess, words, 2_000 + index).round!;
    }
    assert.equal(round.status, 'failed');
    assert.equal(scoreWordYardRound(round).points, 0);
  });

  it('gives every 2–4 player the same secret but returns only their own guesses', () => {
    for (const playerCount of [2, 3, 4]) {
      const match = createWordYardMatch({
        mode: 'classic', playerIds: Array.from({ length: playerCount }, (_, index) => `p${index}`),
        answer: 'APPLE', startedAt: 1_000, timeLimitMs: 60_000,
      });
      const firstView = toWordYardMatchView(match, 'p0');
      assert.equal(firstView.answer, undefined);
      assert.equal(firstView.players[0].ownRound?.guesses.length, 0);
      assert.equal(firstView.players[1].ownRound, undefined);
      assert.equal('answer' in firstView.players[0].ownRound!, false);
      const next = submitWordYardMatchGuess(match, 'p1', 'AMPLE', new Set(['AMPLE']), 2_000);
      assert.ok(next.match);
      assert.equal(toWordYardMatchView(next.match, 'p0').players[1].guessesUsed, 1);
      assert.equal(toWordYardMatchView(next.match, 'p0').players[1].ownRound, undefined);
    }
  });

  it('settles a party round, scores successful guesses, and advances with a shared new answer', () => {
    const accepted = new Set(['APPLE', 'AMPLE']);
    let match = createWordYardMatch({
      mode: 'party', playerIds: ['p1', 'p2'], answer: 'APPLE', startedAt: 1_000,
      timeLimitMs: 60_000,
    });
    match = submitWordYardMatchGuess(match, 'p1', 'APPLE', accepted, 2_000).match!;
    assert.equal(match.status, 'playing');
    match = submitWordYardMatchGuess(match, 'p2', 'AMPLE', accepted, 3_000).match!;
    match = submitWordYardMatchGuess(match, 'p2', 'APPLE', accepted, 4_000).match!;
    assert.equal(match.status, 'round-complete');
    assert.equal(toWordYardMatchView(match, 'p1').answer, 'APPLE');
    assert.equal(wordYardLeaderboard(match)[0].playerId, 'p1');
    match = startNextWordYardMatchRound(match, 'PLUM', 70_000);
    assert.equal(match.roundNumber, 2);
    assert.equal(match.players[0].rounds.at(-1)?.answer, 'PLUM');
    assert.equal(match.players[1].rounds.at(-1)?.answer, 'PLUM');
    assert.equal(match.status, 'playing');
  });
});
