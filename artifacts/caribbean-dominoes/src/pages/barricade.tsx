import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';

type Player = 0 | 1;
type Pawn = { player: Player; id: number; position: number | null };
type BarrierMove = { pawnIndex: number; oldBarrier: number };

const ROWS = 9;
const COLS = 7;
const PATH: number[] = [];
for (let row = ROWS - 1; row >= 0; row--) {
  const cols = row % 2 === 0 ? Array.from({ length: COLS }, (_, i) => i) : Array.from({ length: COLS }, (_, i) => COLS - 1 - i);
  for (const col of cols) PATH.push(row * COLS + col);
}
const START_BARRIERS = [3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53];
const PLAYER_COLORS = ['#74cc50', '#e2b852'];
const newPawns = (): Pawn[] => [0, 1].flatMap((player) => Array.from({ length: 5 }, (_, id) => ({ player: player as Player, id, position: null })));

export default function BarricadePage() {
  const [pawns, setPawns] = useState<Pawn[]>(newPawns);
  const [barriers, setBarriers] = useState<number[]>(START_BARRIERS);
  const [turn, setTurn] = useState<Player>(0);
  const [roll, setRoll] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [barrierMove, setBarrierMove] = useState<BarrierMove | null>(null);
  const [winner, setWinner] = useState<Player | null>(null);
  const [message, setMessage] = useState('Roll the die, then choose one of your pawns.');

  const reset = () => {
    setPawns(newPawns());
    setBarriers(START_BARRIERS);
    setTurn(0);
    setRoll(null);
    setSelected(null);
    setBarrierMove(null);
    setWinner(null);
    setMessage('Roll the die, then choose one of your pawns.');
  };

  const rollDie = () => {
    if (winner !== null || barrierMove) return;
    const value = Math.floor(Math.random() * 6) + 1;
    setRoll(value);
    setSelected(null);
    setMessage(`Player ${turn + 1} rolled ${value}. Choose a pawn.`);
  };

  const targetFor = (pawn: Pawn, direction: 1 | -1) => {
    if (pawn.position === null) return direction === 1 && roll ? roll - 1 : null;
    if (!roll) return null;
    const target = pawn.position + roll * direction;
    return target >= 0 && target < PATH.length ? target : null;
  };

  const canMove = (pawnIndex: number, direction: 1 | -1) => {
    const pawn = pawns[pawnIndex];
    if (!pawn || pawn.player !== turn || roll === null || winner !== null) return false;
    const target = targetFor(pawn, direction);
    if (target === null) return false;
    const from = pawn.position ?? -1;
    for (let step = from + direction; direction === 1 ? step <= target : step >= target; step += direction) {
      if (barriers.includes(step) && step !== target) return false;
    }
    const blocker = pawns.find((other, index) => index !== pawnIndex && other.position === target);
    if (blocker?.player === turn) return false;
    return true;
  };

  const movePawn = (direction: 1 | -1) => {
    if (selected === null || !canMove(selected, direction) || roll === null) return;
    const pawn = pawns[selected];
    const target = targetFor(pawn, direction)!;
    const barrierAtTarget = barriers.includes(target);
    const nextPawns = [...pawns];
    const captured = nextPawns.findIndex((other, index) => index !== selected && other.position === target && other.player !== turn);
    if (captured >= 0) nextPawns[captured] = { ...nextPawns[captured], position: null };
    nextPawns[selected] = { ...pawn, position: target };
    setPawns(nextPawns);
    setSelected(null);
    setRoll(null);

    if (target === PATH.length - 1) {
      setWinner(turn);
      setMessage(`Player ${turn + 1} reached the finish and wins!`);
    } else if (barrierAtTarget) {
      setBarriers((current) => current.filter((position) => position !== target));
      setBarrierMove({ pawnIndex: selected, oldBarrier: target });
      setMessage('Move the barricade to any empty track space.');
    } else {
      setTurn(turn === 0 ? 1 : 0);
      setMessage(captured >= 0 ? 'You sent an opponent pawn back to base.' : 'Move complete. Next player, roll the die.');
    }
  };

  const moveBarrier = (target: number) => {
    if (!barrierMove || pawns.some((pawn) => pawn.position === target) || barriers.includes(target) || target === PATH.length - 1) return;
    setBarriers((current) => [...current, target]);
    setBarrierMove(null);
    setTurn(turn === 0 ? 1 : 0);
    setMessage('Barricade placed. Next player, roll the die.');
  };

  const cellByPosition = new Map(PATH.map((cell, index) => [cell, index]));
  const pawnAt = (position: number) => pawns.findIndex((pawn) => pawn.position === position);

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {winner !== null && <GameEndSequence gameName="Barricade" perspective="local" winnerName={`Player ${winner + 1}`} opponentName={`Player ${winner === 0 ? 2 : 1}`} onPlayAgain={reset} />}
    <main className="yard-main" style={{ maxWidth: 850 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}>
        <div><p className="yard-kicker">509 YARD / LOCAL FOUNDATION</p><h1>Barricade</h1><p className="yard-subtitle">Race your pawns to the finish, capture rivals, and move the barricades in your way.</p></div>
      </header>
      <section className="yard-panel" style={{ padding: 16, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <strong role="status">Player {turn + 1}{winner === null ? ' to move' : winner === turn ? ' wins' : ''}</strong>
          <button className="yard-button" type="button" onClick={reset}><RotateCcw size={14} /> New game</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button className="yard-button primary" type="button" disabled={winner !== null || roll !== null || barrierMove !== null} onClick={rollDie}>Roll die</button>
          <strong aria-live="polite" style={{ minWidth: 75, textAlign: 'center' }}>{roll === null ? '—' : `Rolled ${roll}`}</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, minmax(30px, 56px))`, gap: 3, justifyContent: 'center', overflowX: 'auto' }}>
          {Array.from({ length: ROWS * COLS }, (_, cell) => {
            const position = cellByPosition.get(cell);
            const pawnIndex = position === undefined ? -1 : pawnAt(position);
            const pawn = pawnIndex >= 0 ? pawns[pawnIndex] : null;
            const hasBarrier = position !== undefined && barriers.includes(position);
            const canPlaceBarrier = barrierMove !== null && position !== undefined && !pawn && !hasBarrier && position !== PATH.length - 1;
            return <button key={cell} type="button" aria-label={position === undefined ? 'Off track' : `Track space ${position + 1}${pawn ? `, Player ${pawn.player + 1} pawn` : ''}${hasBarrier ? ', barricade' : ''}`} disabled={position === undefined || (barrierMove ? !canPlaceBarrier : pawnIndex < 0 || pawns[pawnIndex].player !== turn || roll === null)} onClick={() => {
              if (barrierMove && position !== undefined) moveBarrier(position);
              else if (pawnIndex >= 0) setSelected(pawnIndex);
            }} style={{ aspectRatio: '1', minWidth: 30, display: 'grid', placeItems: 'center', padding: 2, border: selected === pawnIndex && pawnIndex >= 0 ? '3px solid #75d64b' : '1px solid #52564f', borderRadius: 6, color: '#f5f4ee', background: position === PATH.length - 1 ? '#765b2f' : position === 0 ? '#354a31' : '#202522', cursor: position !== undefined ? 'pointer' : 'default', opacity: position === undefined ? 0.12 : 1 }}>
              {hasBarrier ? <span style={{ fontSize: 17, fontWeight: 900, color: '#f1eee4' }}>■</span> : pawn ? <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', borderRadius: '50%', background: PLAYER_COLORS[pawn.player], color: '#172016', fontSize: 10, fontWeight: 900 }}>{pawn.player + 1}{String.fromCharCode(65 + pawn.id)}</span> : position === PATH.length - 1 ? 'FIN' : position === 0 ? 'START' : canPlaceBarrier ? '＋' : ''}
            </button>;
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 16, margin: '14px 0', fontSize: 12 }}>
          {[0, 1].map((player) => <div key={player} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <b style={{ color: PLAYER_COLORS[player] }}>P{player + 1} base</b>
            {pawns.map((pawn, index) => pawn.player === player && pawn.position === null ? (
              player === turn && roll !== null && winner === null && !barrierMove
                ? <button key={pawn.id} type="button" onClick={() => setSelected(index)} aria-label={`Select player ${player + 1} pawn ${String.fromCharCode(65 + pawn.id)}`} style={{ border: selected === index ? '2px solid #75d64b' : '1px solid #596057', borderRadius: 5, padding: '3px 6px', background: PLAYER_COLORS[player], color: '#172016', fontWeight: 800 }}>{String.fromCharCode(65 + pawn.id)}</button>
                : <span key={pawn.id} style={{ color: PLAYER_COLORS[player], padding: '0 3px' }}>{String.fromCharCode(65 + pawn.id)}</span>
            ) : null)}
          </div>)}
        </div>
        {selected !== null && roll !== null && <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
          <button className="yard-button primary" disabled={!canMove(selected, 1)} onClick={() => movePawn(1)}>Toward finish</button>
          <button className="yard-button" disabled={!canMove(selected, -1)} onClick={() => movePawn(-1)}>Toward base</button>
          {!canMove(selected, 1) && !canMove(selected, -1) && <button className="yard-button" onClick={() => { setRoll(null); setSelected(null); setTurn(turn === 0 ? 1 : 0); setMessage('No legal move. Turn passed.'); }}>Pass turn</button>}
        </div>}
        {barrierMove && <p style={{ textAlign: 'center', color: '#e7c77a' }}>Choose an empty track space to place the barricade.</p>}
        <p role="status" style={{ minHeight: 18, margin: 0, textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>{message}</p>
      </section>
      <p className="yard-subtitle" style={{ marginTop: 12 }}>Local two-player foundation. Roll, move one pawn, capture by landing, and relocate a barricade when you land on it.</p>
    </main>
  </div>;
}

