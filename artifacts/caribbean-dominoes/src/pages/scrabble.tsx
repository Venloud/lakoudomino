import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';
import { canRestoreScrabbleDraft, createScrabbleGame, exchangeScrabbleTiles, hasScrabbleDraft, passScrabbleTurn, playScrabbleWord, premiumAt, SCRABBLE_SIZE, shouldRecoverScrabbleDraft, type ScrabbleDirection, type ScrabbleDraft, type ScrabbleGame, type ScrabblePlayer } from '@/lib/scrabble';
import { WORDS } from '@/lib/word-game-data';
import { ArcadeOnlinePanel } from '@/components/arcade-online-panel';

const premiumColors = { TW: '#733c35', DW: '#754951', TL: '#355a72', DL: '#3c6252' };

export default function ScrabblePage() {
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [game, setGame] = useState(() => createScrabbleGame());
  const [word, setWord] = useState('');
  const [start, setStart] = useState(7 * SCRABBLE_SIZE + 7);
  const [direction, setDirection] = useState<ScrabbleDirection>('horizontal');
  const [message, setMessage] = useState('Start at the center star. Words must connect to the tiles already played.');
  const [selectedRackTiles, setSelectedRackTiles] = useState<number[]>([]);
  const [recoveredDraft, setRecoveredDraft] = useState<ScrabbleDraft | null>(null);
  const [practiceBot, setPracticeBot] = useState(false);
  const [onlineSession, setOnlineSession] = useState<{ seat: number; connected: boolean; turn: number | null } | null>(null);
  const onlineSessionRef = useRef(onlineSession);
  onlineSessionRef.current = onlineSession;
  const gameRef = useRef(game);
  gameRef.current = game;
  const draftPlayer = (onlineSession?.seat ?? game.turn) as ScrabblePlayer;
  const draftRef = useRef<ScrabbleDraft>({
    word, start, direction, selectedRackTiles, player: draftPlayer, rack: [...(game.racks[draftPlayer] ?? [])],
  });
  draftRef.current = {
    word, start, direction, selectedRackTiles, player: draftPlayer, rack: [...(game.racks[draftPlayer] ?? [])],
  };
  const botTurn = practiceBot && !onlineSession && game.turn === 1 && game.winner === null;
  const canAct = onlineSession === null || (onlineSession.connected && onlineSession.seat === game.turn);
  const handleRoomChange = useCallback((session: { seat: number; connected: boolean; turn: number | null } | null) => {
    onlineSessionRef.current = session;
    setOnlineSession(session);
    if (session) setPracticeBot(false);
  }, []);
  const applyRemoteGame = useCallback((state: unknown) => {
    if (state && typeof state === 'object' && Array.isArray((state as ScrabbleGame).board) &&
      Array.isArray((state as ScrabbleGame).racks) && typeof (state as ScrabbleGame).turn === 'number') {
      const remote = state as ScrabbleGame;
      if (onlineSessionRef.current !== null && shouldRecoverScrabbleDraft(gameRef.current, remote, draftRef.current)) {
        setRecoveredDraft(draftRef.current);
      }
      setGame({
        ...remote,
        bag: [],
        bagCount: typeof remote.bagCount === 'number' ? remote.bagCount : Array.isArray(remote.bag) ? remote.bag.length : 0,
      });
      setSelectedRackTiles([]);
      setWord('');
    }
  }, []);
  useEffect(() => {
    if (!botTurn) return;
    const timer = window.setTimeout(() => {
      let best: ScrabbleGame | null = null;
      const available = [...game.racks[1], ...game.board.flatMap((tile) => tile ? [tile.letter] : [])];
      const candidates = [...WORDS].filter((candidate) => {
        if (candidate.length < 2 || candidate.length > 7) return false;
        const tiles = [...available];
        let blanks = tiles.filter((letter) => letter === '?').length;
        for (const letter of candidate) {
          const index = tiles.indexOf(letter);
          if (index >= 0) tiles.splice(index, 1);
          else if (blanks > 0) blanks--;
          else return false;
        }
        return true;
      }).sort((a, b) => b.length - a.length);
      for (const candidate of candidates) {
        for (const direction of ['horizontal', 'vertical'] as const) {
          for (let row = 0; row < SCRABBLE_SIZE; row++) for (let col = 0; col < SCRABBLE_SIZE; col++) {
            const result = playScrabbleWord(game, { word: candidate, row, col, direction });
            if (result.game && (!best || result.game.scores[1] > best.scores[1])) best = result.game;
          }
        }
      }
      if (best) { setGame(best); setMessage(`Yard bot played a word for ${best.scores[1] - game.scores[1]} points.`); }
      else { setGame((current) => passScrabbleTurn(current)); setMessage('Yard bot passed.'); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [botTurn, game]);
  const preview = word.trim().toUpperCase();
  const turnLabel = game.winner === null ? botTurn ? 'Yard bot to move' : `Player ${game.turn + 1} to move` : game.winner === 'draw' ? 'Draw game' : `Player ${game.winner + 1} wins`;
  const newGame = (count = playerCount) => {
    setRecoveredDraft(null);
    draftRef.current = { ...draftRef.current, word: '', selectedRackTiles: [] };
    setPlayerCount(count as 2 | 3 | 4);
    setGame(createScrabbleGame(Math.random, count as 2 | 3 | 4));
    setWord('');
    setStart(7 * SCRABBLE_SIZE + 7);
    setDirection('horizontal');
    setSelectedRackTiles([]);
    setMessage('Start at the center star. Words must connect to the tiles already played.');
  };

  const handlePlay = () => {
    if (botTurn || !canAct) return;
    const result = playScrabbleWord(game, {
      word: preview,
      row: Math.floor(start / SCRABBLE_SIZE),
      col: start % SCRABBLE_SIZE,
      direction,
    });
    if (!result.game) { setMessage(result.error); return; }
    setRecoveredDraft(null);
    draftRef.current = { ...draftRef.current, word: '', selectedRackTiles: [] };
    const gained = result.game.scores[game.turn] - game.scores[game.turn];
    setGame(result.game);
    setWord('');
    setSelectedRackTiles([]);
    setMessage(`Word played for ${gained} points.`);
  };

  const handlePass = () => {
    if (botTurn || !canAct) return;
    setRecoveredDraft(null);
    draftRef.current = { ...draftRef.current, word: '', selectedRackTiles: [] };
    setGame((current) => passScrabbleTurn(current));
    setSelectedRackTiles([]);
    setMessage('Turn passed.');
  };
  const handleExchange = () => {
    if (botTurn || !canAct) return;
    const tiles = selectedRackTiles.map((index) => game.racks[game.turn][index]).filter(Boolean);
    const result = exchangeScrabbleTiles(game, tiles);
    if (!result.game) { setMessage(result.error); return; }
    setRecoveredDraft(null);
    draftRef.current = { ...draftRef.current, word: '', selectedRackTiles: [] };
    setGame(result.game);
    setSelectedRackTiles([]);
    setMessage(`${tiles.length} tile${tiles.length === 1 ? '' : 's'} exchanged. Turn passed.`);
  };
  const restoreDraft = () => {
    if (!recoveredDraft) return;
    setWord(recoveredDraft.word);
    setStart(recoveredDraft.start);
    setDirection(recoveredDraft.direction);
    const rackStillMatches = canRestoreScrabbleDraft(recoveredDraft, game);
    setSelectedRackTiles(rackStillMatches ? recoveredDraft.selectedRackTiles : []);
    setMessage(rackStillMatches
      ? 'Recovered your unplayed word and rack selection.'
      : 'Recovered your word and board position. The rack changed, so reselect tiles before playing.');
    setRecoveredDraft(null);
  };
  const rackPlayer = onlineSession ? onlineSession.seat : game.turn;

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {game.winner !== null && <GameEndSequence gameName="Scrabble" perspective={game.winner === 'draw' ? 'draw' : practiceBot ? game.winner === 0 ? 'winner' : 'opponent' : 'local'} winnerName={game.winner === 'draw' ? 'Draw game' : practiceBot ? game.winner === 0 ? 'You' : 'Yard bot' : `Player ${game.winner + 1}`} opponentName={practiceBot ? game.winner === 0 ? 'Yard bot' : 'You' : 'Your opponents'} score={game.scores.map((score, index) => `${practiceBot && index === 1 ? 'Yard bot' : `Player ${index + 1}`} ${score}`).join(' · ')} onPlayAgain={() => newGame()} />}
    <main className="yard-main" style={{ maxWidth: 1050 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}>
         <div><p className="yard-kicker">509 YARD / LOCAL FOUNDATION</p><h1>Scrabble</h1><p className="yard-subtitle">Play connected words for 2–4 players, score bonuses, exchange tiles, and finish with the highest score.</p></div>
      </header>
      <ArcadeOnlinePanel game="scrabble" playerCount={playerCount} turn={game.turn} state={game} onRemoteState={applyRemoteGame} onRoomChange={handleRoomChange} />
      <section className="yard-panel" style={{ padding: 16, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <strong role="status">{botTurn ? 'Yard bot is thinking…' : turnLabel}</strong>
           <button className="yard-button" type="button" onClick={() => newGame()}><RotateCcw size={14} /> New game</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12, fontSize: 13 }}>
          <span>Players</span>{([2, 3, 4] as const).map((count) => <button key={count} type="button" className="yard-button" aria-pressed={playerCount === count} disabled={practiceBot || onlineSession !== null} onClick={() => newGame(count)}>{count}</button>)}
        </div>
        <div role="group" aria-label="Choose opponent" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <button type="button" className={`yard-button${!practiceBot ? ' primary' : ''}`} aria-pressed={!practiceBot} disabled={onlineSession !== null} onClick={() => setPracticeBot(false)}>Two players</button>
          <button type="button" className={`yard-button${practiceBot ? ' primary' : ''}`} aria-pressed={practiceBot} disabled={onlineSession !== null} onClick={() => { setPracticeBot(true); if (playerCount !== 2) newGame(2); }}>Practice vs bot</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 18, marginBottom: 12, fontSize: 13 }}>
          {game.scores.map((score, index) => <span key={index} aria-current={game.turn === index ? 'step' : undefined}>Player {index + 1} <b>{score}</b></span>)}<span>Tiles left <b>{game.bagCount}</b></span>
        </div>
        <div role="grid" aria-label="Scrabble board" className="yard-scrabble-board" style={{ display: 'grid', gridTemplateColumns: `repeat(${SCRABBLE_SIZE}, minmax(0,1fr))`, gap: 2, width: 'min(100%, 660px)', margin: '0 auto', padding: 5, borderRadius: 8, background: '#0e1112' }}>
          {game.board.map((tile, index) => {
            const row = Math.floor(index / SCRABBLE_SIZE), col = index % SCRABBLE_SIZE;
            const previewOffset = direction === 'horizontal' ? col - (start % SCRABBLE_SIZE) : row - Math.floor(start / SCRABBLE_SIZE);
            const inPreview = previewOffset >= 0 && previewOffset < preview.length
              && (direction === 'horizontal' ? row === Math.floor(start / SCRABBLE_SIZE) : col === start % SCRABBLE_SIZE);
            const premium = premiumAt(row, col);
            const letter = tile?.letter ?? (inPreview ? preview[previewOffset] : '');
            const isSelected = index === start;
            return <button
              key={index}
              type="button"
              role="gridcell"
              aria-label={`${tile ? `${tile.letter}, ` : ''}row ${row + 1}, column ${col + 1}${premium ? `, ${premium}` : ''}`}
              disabled={botTurn || !canAct}
              onClick={() => setStart(index)}
              style={{
                position: 'relative', display: 'grid', placeItems: 'center', minWidth: 0, aspectRatio: '1',
                padding: 0, border: isSelected ? '2px solid #75d64b' : '1px solid #29302d',
                borderRadius: 2, color: '#f7f5eb', background: tile ? '#d9d4c7' : premium ? premiumColors[premium] : '#344239',
                fontSize: 'clamp(7px, 1.3vw, 13px)', fontWeight: 800, cursor: 'pointer',
              }}
            >
              {letter && <span style={{ color: tile ? '#1c1d1e' : '#fff' }}>{letter}</span>}
              {!letter && premium && <span style={{ fontSize: 'clamp(5px, .75vw, 8px)' }}>{premium}</span>}
              {tile && <small style={{ position: 'absolute', right: 1, bottom: 0, color: '#26272a', fontSize: 'clamp(5px, .55vw, 7px)', lineHeight: 1 }}>{tile.points}</small>}
            </button>;
          })}
        </div>
        <div style={{ maxWidth: 660, margin: '14px auto 0', display: 'grid', gap: 12 }}>
          {recoveredDraft && <section className="wy-challenge-panel" role="status" aria-label="Recovered Scrabble draft" data-testid="scrabble-draft-recovery">
            <div>
              <strong>Your unplayed draft was saved</strong>
              <p style={{ margin: '4px 0 0', color: '#c8c8ce', fontSize: 12 }}>
                {recoveredDraft.word ? `“${recoveredDraft.word}”` : 'Rack tile selection'} · row {Math.floor(recoveredDraft.start / SCRABBLE_SIZE) + 1}, column {recoveredDraft.start % SCRABBLE_SIZE + 1} · {recoveredDraft.direction === 'horizontal' ? 'Across' : 'Down'}
              </p>
            </div>
            <button className="yard-button primary" type="button" onClick={restoreDraft}>Restore draft</button>
            <button className="yard-button" type="button" onClick={() => setRecoveredDraft(null)}>Dismiss</button>
          </section>}
          <div style={{ margin: 0, textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>{practiceBot && game.turn === 1 ? 'Yard bot rack: ' : `Player ${rackPlayer + 1} rack: `}{game.racks[rackPlayer].map((letter, i) => <button type="button" key={`${letter}-${i}`} disabled={botTurn || !canAct} aria-pressed={selectedRackTiles.includes(i)} onClick={() => setSelectedRackTiles((current) => current.includes(i) ? current.filter((index) => index !== i) : [...current, i])} style={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 36, margin: '0 2px', borderRadius: 4, border: selectedRackTiles.includes(i) ? '2px solid #75d64b' : '1px solid #9e947f', background: '#e5dfd1', color: '#202124' }}>{letter === '?' ? '☆' : letter}<small style={{ fontSize: 8 }}>{letter === '?' ? 0 : undefined}</small></button>)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Word <input className="yard-input" value={word} onChange={(event) => setWord(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} maxLength={15} placeholder="e.g. WORD" style={{ width: 150 }} disabled={game.winner !== null || botTurn} /></label>
            <button type="button" className="yard-button" aria-pressed={direction === 'horizontal'} disabled={botTurn} onClick={() => setDirection('horizontal')}>Across</button>
            <button type="button" className="yard-button" aria-pressed={direction === 'vertical'} disabled={botTurn} onClick={() => setDirection('vertical')}>Down</button>
            <button type="button" className="yard-button primary" onClick={handlePlay} disabled={game.winner !== null || botTurn || !canAct}>Play word</button>
            <button type="button" className="yard-button" onClick={handleExchange} disabled={game.winner !== null || botTurn || !canAct || selectedRackTiles.length === 0 || game.bagCount < 7}>Exchange selected</button>
            <button type="button" className="yard-button" onClick={handlePass} disabled={game.winner !== null || botTurn || !canAct}>Pass</button>
          </div>
          <p role="status" style={{ minHeight: 18, margin: 0, textAlign: 'center', color: '#b7b8b9', fontSize: 12 }}>{message}</p>
          <p style={{ margin: 0, textAlign: 'center', color: '#85878b', fontSize: 11 }}>Local pass-and-play. Starter dictionary; premium squares apply once when a tile is placed.</p>
        </div>
      </section>
    </main>
  </div>;
}

