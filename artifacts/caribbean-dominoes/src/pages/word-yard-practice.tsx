import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { evaluateWordYardGuess, type LetterFeedback } from 'lakou-engine';
import { GameEndSequence } from '@/components/game-end-sequence';
import { loadWordDictionary } from '@/lib/word-yard-dictionary';
import { YardHeader } from './social';
import './word-yard-game.css';

type Guess = { word: string; feedback: LetterFeedback[] };

function feedbackFor(answer: string, word: string) {
  return evaluateWordYardGuess(answer, word);
}

export default function WordYardPracticePage() {
  const [dictionary, setDictionary] = useState<Set<string> | null>(null);
  const [answer, setAnswer] = useState('');
  const [guess, setGuess] = useState('');
  const [human, setHuman] = useState<Guess[]>([]);
  const [bot, setBot] = useState<Guess[]>([]);
  const [notice, setNotice] = useState('Loading the word list…');
  const [humanSolvedAt, setHumanSolvedAt] = useState<number | null>(null);
  const [botSolvedAt, setBotSolvedAt] = useState<number | null>(null);

  const words = useMemo(() => dictionary ? [...dictionary].filter((word) => word.length === 5) : [], [dictionary]);
  const finished = humanSolvedAt !== null || botSolvedAt !== null || human.length >= 6;
  const winner = humanSolvedAt !== null && botSolvedAt !== null
    ? humanSolvedAt <= botSolvedAt ? 'You' : 'Yard bot'
    : humanSolvedAt !== null ? 'You'
      : botSolvedAt !== null ? 'Yard bot' : null;

  useEffect(() => {
    let active = true;
    loadWordDictionary().then((loaded) => {
      if (!active) return;
      const normalized = [...loaded].map((word) => word.toUpperCase());
      const fiveLetterWords = normalized.filter((word) => word.length === 5);
      setDictionary(new Set(normalized));
      if (fiveLetterWords.length) {
        setAnswer(fiveLetterWords[Math.floor(Math.random() * fiveLetterWords.length)]);
        setNotice('Both players get six guesses. The bot only uses its own feedback.');
      } else {
        setNotice('The word list has no five-letter words.');
      }
    }).catch(() => {
      if (active) setNotice('The word list could not be loaded. Reload to try again.');
    });
    return () => { active = false; };
  }, []);

  const reset = () => {
    if (!words.length) return;
    setAnswer(words[Math.floor(Math.random() * words.length)]);
    setGuess('');
    setHuman([]);
    setBot([]);
    setHumanSolvedAt(null);
    setBotSolvedAt(null);
    setNotice('Both players get six guesses. The bot only uses its own feedback.');
  };

  const submit = () => {
    const word = guess.trim().toUpperCase();
    if (!dictionary || word.length !== 5 || !dictionary.has(word)) {
      setNotice('Enter a valid five-letter word.');
      return;
    }
    if (finished) return;
    const now = Date.now();
    const humanGuess = { word, feedback: feedbackFor(answer, word) };
    const nextHuman = [...human, humanGuess];
    setHuman(nextHuman);
    setGuess('');
    if (word === answer) setHumanSolvedAt(now);

    const possible = words.filter((candidate) => bot.every((prior) =>
      JSON.stringify(feedbackFor(candidate, prior.word)) === JSON.stringify(prior.feedback)));
    const botWord = possible[Math.floor(Math.random() * possible.length)] ?? answer;
    const botAt = now + 450;
    const botGuess = { word: botWord, feedback: feedbackFor(answer, botWord) };
    setBot((current) => [...current, botGuess]);
    if (botWord === answer) setBotSolvedAt(botAt);
    setNotice(botWord === answer ? 'The Yard bot solved it.' : `Yard bot guessed ${botWord}. Your turn.`);
  };

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {finished && <GameEndSequence gameName="Word Yard Practice" perspective={winner === 'You' ? 'winner' : winner === 'Yard bot' ? 'opponent' : 'draw'} winnerName={winner ?? 'Draw game'} opponentName={winner === 'You' ? 'Yard bot' : 'You'} detail={`You: ${human.length}/6 guesses · Yard bot: ${bot.length}/6 guesses`} onPlayAgain={reset} />}
    <main className="yard-main" style={{ maxWidth: 900 }}>
      <Link href="/games/words" className="yard-panel-link"><ArrowLeft size={14} /> Word Yard rooms</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}>
        <div><p className="yard-kicker">509 YARD / PRACTICE</p><h1>Word Yard</h1><p className="yard-subtitle">Race the Yard bot to the same five-letter word.</p></div>
        <button type="button" className="yard-button" onClick={reset} disabled={!words.length}><RotateCcw size={14} /> New word</button>
      </header>
      <section className="word-yard-panel">
        <div className="word-yard-panel-head"><h2>Practice match</h2><span>{human.length}/6 guesses</span></div>
        <div className="word-yard-panel-body" style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 18 }}>
            {([{ name: 'You', guesses: human }, { name: 'Yard bot', guesses: bot }] as const).map(({ name, guesses }) => <section key={name} aria-label={`${name} guesses`}>
              <h3>{name} · {guesses.length}/6</h3>
              <div style={{ display: 'grid', gap: 6 }}>
                {Array.from({ length: 6 }, (_, row) => <div key={row} style={{ display: 'flex', gap: 5 }}>
                  {Array.from({ length: 5 }, (_, column) => {
                    const entry = guesses[row];
                    const mark = entry?.feedback[column];
                    const color = mark === 'correct' ? '#45a63d' : mark === 'present' ? '#b88a27' : mark === 'absent' ? '#454a46' : '#252b27';
                    return <span key={column} style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', border: '1px solid #465149', borderRadius: 5, background: color, color: '#f7f5eb', fontWeight: 800 }}>{entry?.word[column] ?? ''}</span>;
                  })}
                </div>)}
              </div>
            </section>)}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); submit(); }} style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8 }}>
            <input className="yard-input" aria-label="Five-letter guess" value={guess} onChange={(event) => setGuess(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))} maxLength={5} disabled={!answer || finished} placeholder="TYPE A WORD" />
            <button className="word-yard-button is-primary" type="submit" disabled={!answer || finished || guess.length !== 5}>Submit guess</button>
          </form>
          <p role="status" aria-live="polite" className="word-yard-note" style={{ margin: 0, textAlign: 'center' }}>{notice}</p>
          <p className="word-yard-note" style={{ margin: 0, textAlign: 'center' }}>Green: correct letter and place · Gold: letter elsewhere · Gray: not in the word</p>
          {finished && <p className="word-yard-note" style={{ margin: 0, textAlign: 'center' }}>The answer was <strong>{answer}</strong>.</p>}
        </div>
      </section>
    </main>
  </div>;
}
