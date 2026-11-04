import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { YardHeader } from './social';
import { createFillerBoard, playFillerMove } from '@/lib/filler';

type GameId = 'box' | 'kay' | 'chess' | 'dame' | 'words' | 'four-in-a-row' | 'filler';
type Piece = { side: 0 | 1; kind: string } | null;
const GAME_INFO: Record<GameId, { name: string; intro: string }> = {
  box: { name: 'Box', intro: 'Take turns drawing edges. Complete a square to claim it and play again.' },
  kay: { name: 'Kay', intro: 'Sow stones around the pits. Capture stones and finish with the larger store.' },
  chess: { name: 'Chess', intro: 'Move pieces and capture the opposing king. This first version uses basic piece movement.' },
  dame: { name: 'Dame', intro: 'Move diagonally, jump opponents, and crown a piece at the far edge.' },
  words: { name: 'Word Yard', intro: 'Use your letter rack to build a word and score its letter values.' },
  'four-in-a-row': { name: 'Four in a Row', intro: 'Drop a piece into a column and connect four in any direction.' },
  filler: { name: 'Filler', intro: 'Choose a new color to absorb connected tiles and claim more of the board than your opponent.' },
};
const COLORS = ['#56c746', '#e2b852', '#4e9de0', '#d86a72', '#a982da', '#42b7ad'];
const COLOR_NAMES = ['green', 'gold', 'blue', 'coral', 'violet', 'teal'];
const WORDS = new Set('ACE ACT ADD AGE AIR AND ANT ANY ARE ARM ART ASK ATE BAD BAG BAN BAR BAT BAY BED BEE BEG BET BIG BIN BIT BOW BOX BOY BUS BUT BUY CAB CAN CAP CAR CAT COW CUP CUT DAY DEN DID DIG DIM DIN DIP DOG DOT DRY DUE EAR EAT EEL EGG EGO ELF END ERA EVE EYE FAN FAR FAT FED FEE FEW FIG FIT FIX FLY FOG FOR FOX FUN GAP GAS GET GIN GOD GOT GUM GUN GUY HAD HAM HAS HAT HAY HEN HER HID HIM HIP HIS HIT HOG HOT HOW HUG ICE ILL INK JAM JAR JET JOB JOY KEY KID KIT LAB LAD LAP LAW LAY LED LEG LET LID LIE LIP LIT LOG LOT LOW MAD MAN MAP MAT MAY MEN MET MIX MOB MOM MOP MUD MUG NAP NET NEW NOD NOR NOT NOW NUN OAK OAR OAT OFF OIL OLD ONE OUR OUT OWL OWN PAD PAL PAN PAT PAW PAY PEA PEN PET PIE PIG PIN PIT POD POT PUB PUP PUT RAG RAN RAP RAT RAW RED RIB RID RIG RIP ROB ROD ROT ROW RUB RUG RUN SAD SAG SAP SAT SAW SAY SEA SEE SET SEW SHE SHY SIR SIT SIX SKI SKY SOB SON SOP SOW SPA SPY SUB SUE SUM SUN TAB TAG TAN TAP TAR TAX TEA TEN THE TIE TIN TIP TOE TON TOO TOP TOY TRY TUB TUG TWO USE VAN VAT VET VEX VIA VIE WAG WAR WAS WAY WEB WED WET WHO WHY WIG WIN WIT WOE WON WOO WOW YAK YAM YAP YEA YES YET YOU ZAP ZEN ZIP ZOO GAME GAMES PLAY YARD GREEN FRIENDS TABLE TURN STONE BOARD'.split(' '));
const LETTER_POINTS: Record<string, number> = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10 };
const newWordRacks = () => [['A', 'E', 'R', 'T', 'N', 'S', 'O'], ['I', 'L', 'D', 'C', 'M', 'P', 'U']];

function initialBoard(id: GameId): Piece[] {
  const board: Piece[] = Array(64).fill(null);
  if (id === 'chess') {
    const row = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (let c = 0; c < 8; c++) {
      board[c] = { side: 1, kind: row[c] }; board[8 + c] = { side: 1, kind: 'P' };
      board[48 + c] = { side: 0, kind: 'P' }; board[56 + c] = { side: 0, kind: row[c] };
    }
  } else {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r * 8 + c] = { side: 1, kind: 'D' };
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r * 8 + c] = { side: 0, kind: 'D' };
  }
  return board;
}
function fourWinner(board: (number | null)[], at: number): number | null {
  const row = Math.floor(at / 7), col = at % 7, mark = board[at];
  if (mark === null) return null;
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r * 7 + c] === mark) { count++; r += dr * sign; c += dc * sign; }
    }
    if (count >= 4) return mark;
  }
  return null;
}
function pathIsClear(board: Piece[], from: number, to: number) {
  const fromRow = Math.floor(from / 8), fromCol = from % 8;
  const toRow = Math.floor(to / 8), toCol = to % 8;
  const dr = Math.sign(toRow - fromRow), dc = Math.sign(toCol - fromCol);
  let row = fromRow + dr, col = fromCol + dc;
  while (row !== toRow || col !== toCol) {
    if (board[row * 8 + col]) return false;
    row += dr; col += dc;
  }
  return true;
}

export default function ClassicGamesPage() {
  const [location] = useLocation();
  const rawGame = location.split(/[?#]/, 1)[0].split('/').filter(Boolean).at(-1);
  const id = (rawGame ?? 'box') as GameId;
  const info = GAME_INFO[id] ?? GAME_INFO.box;
  const [turn, setTurn] = useState<0 | 1>(0);
  const [winner, setWinner] = useState<number | null>(null);
  const [four, setFour] = useState<(number | null)[]>(Array(42).fill(null));
  const [dots, setDots] = useState<Set<string>>(new Set());
  const [edgeOwners, setEdgeOwners] = useState<Map<string, number>>(new Map());
  const [claimed, setClaimed] = useState<(number | null)[]>(Array(9).fill(null));
  const [pits, setPits] = useState<number[]>(Array(14).fill(4).map((n, i) => i === 6 || i === 13 ? 0 : n));
  const [fillerBoard, setFillerBoard] = useState(createFillerBoard);
  const [pieces, setPieces] = useState<Piece[]>(() => initialBoard(id === 'chess' ? 'chess' : 'dame'));
  const [selected, setSelected] = useState<number | null>(null);
  const [racks, setRacks] = useState(newWordRacks);
  const [letterBag, setLetterBag] = useState('EEEEEEEEEEEEAAAAAAAIIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTLLLLSSSSUUUUDDDDGGGBCMMPPFHHVVWWYYKJXQZ');
  const [word, setWord] = useState('');
  const [wordError, setWordError] = useState('');
  const [wordScores, setWordScores] = useState<[number, number]>([0, 0]);
  const [lastWord, setLastWord] = useState('');
  const [consecutivePasses, setConsecutivePasses] = useState(0);

  const reset = () => window.location.reload();
  const turnLabel = winner === null ? `Player ${turn + 1} to move` : winner === 2 ? 'Draw' : `Player ${winner + 1} wins`;
  const playBoxEdge = (key: string, adjacentBoxes: number[]) => {
    if (winner !== null || dots.has(key)) return;
    const nextEdges = new Set(dots);
    nextEdges.add(key);
    setEdgeOwners((old) => new Map(old).set(key, turn));
    const nextClaims = [...claimed];
    let scored = false;
    for (const box of adjacentBoxes) {
      const row = Math.floor(box / 3), col = box % 3;
      const complete = nextEdges.has(`h:${row}:${col}`)
        && nextEdges.has(`h:${row + 1}:${col}`)
        && nextEdges.has(`v:${row}:${col}`)
        && nextEdges.has(`v:${row}:${col + 1}`);
      if (complete && nextClaims[box] === null) { nextClaims[box] = turn; scored = true; }
    }
    setDots(nextEdges);
    setClaimed(nextClaims);
    if (nextEdges.size === 24) {
      const p0 = nextClaims.filter((owner) => owner === 0).length;
      const p1 = nextClaims.filter((owner) => owner === 1).length;
      setWinner(p0 === p1 ? 2 : p0 > p1 ? 0 : 1);
    } else if (!scored) setTurn(turn === 0 ? 1 : 0);
  };
  const makeMove = (index: number) => {
    if (winner !== null) return;
    if (id === 'four-in-a-row') {
      const col = index % 7; let row = 5;
      while (row >= 0 && four[row * 7 + col] !== null) row--;
      if (row < 0) return;
      const next = [...four]; next[row * 7 + col] = turn; setFour(next);
      const won = fourWinner(next, row * 7 + col);
      if (won !== null) setWinner(won); else if (next.every((cell) => cell !== null)) setWinner(2);
      else setTurn((turn === 0 ? 1 : 0));
    } else if (id === 'box') {
      playBoxEdge(`e${index}`, []);
    } else if (id === 'kay') {
      const own = turn === 0 ? index < 6 : index >= 7 && index < 13;
      if (!own || pits[index] === 0) return;
      const next = [...pits]; let stones = next[index]; next[index] = 0; let pos = index;
      while (stones > 0) { pos = (pos + 1) % 14; if ((turn === 0 && pos === 13) || (turn === 1 && pos === 6)) continue; next[pos]++; stones--; }
      const ownSide = turn === 0 ? pos < 6 : pos > 6 && pos < 13;
      const opposite = 12 - pos;
      const extra = (turn === 0 && pos === 6) || (turn === 1 && pos === 13);
      if (ownSide && next[pos] === 1 && next[opposite] > 0) { next[turn === 0 ? 6 : 13] += next[opposite] + 1; next[pos] = 0; next[opposite] = 0; }
      const p0Empty = next.slice(0, 6).every((n) => n === 0), p1Empty = next.slice(7, 13).every((n) => n === 0);
      if (p0Empty || p1Empty) {
        next[6] += next.slice(0, 6).reduce((a, b) => a + b, 0);
        next[13] += next.slice(7, 13).reduce((a, b) => a + b, 0);
        for (let pit = 0; pit < 6; pit++) next[pit] = 0;
        for (let pit = 7; pit < 13; pit++) next[pit] = 0;
        setWinner(next[6] === next[13] ? 2 : next[6] > next[13] ? 0 : 1);
      }
      setPits(next); if (!extra && winner === null) setTurn(turn === 0 ? 1 : 0);
    } else if (id === 'filler') {
      const next = playFillerMove(fillerBoard, turn, index);
      if (!next) return;
      setFillerBoard({ colors: next.colors, owners: next.owners });
      if (next.winner !== null) setWinner(next.winner);
      else setTurn(turn === 0 ? 1 : 0);
    } else if (id === 'chess' || id === 'dame') {
      const piece = pieces[index];
      if (selected === null) { if (piece?.side === turn) setSelected(index); return; }
      if (piece?.side === turn) { setSelected(index); return; }
      const fromR = Math.floor(selected / 8), fromC = selected % 8, toR = Math.floor(index / 8), toC = index % 8;
      const moving = pieces[selected];
      if (!moving || (piece && piece.side === turn)) return;
      const dr = toR - fromR, dc = toC - fromC;
      let valid = false;
      let capturedIndex: number | null = null;
      if (id === 'dame') {
        const direction = turn === 0 ? -1 : 1;
        const allowedDirection = moving.kind === 'K' ? Math.abs(dr) === 1 || Math.abs(dr) === 2 : dr === direction || dr === 2 * direction;
        valid = allowedDirection && Math.abs(dc) === Math.abs(dr) && (Math.abs(dr) === 1 ? !piece : !piece && !!pieces[(fromR + dr / 2) * 8 + fromC + dc / 2] && pieces[(fromR + dr / 2) * 8 + fromC + dc / 2]?.side !== turn);
        if (valid && Math.abs(dr) === 2) capturedIndex = (fromR + dr / 2) * 8 + fromC + dc / 2;
      }
      else {
        const kind = moving.kind;
        valid = kind === 'N' ? Math.abs(dr * dc) === 2
          : kind === 'K' ? Math.max(Math.abs(dr), Math.abs(dc)) === 1
          : kind === 'P' ? (dc === 0 && !piece && dr === (turn === 0 ? -1 : 1)) || (dc === 0 && !piece && fromR === (turn === 0 ? 6 : 1) && dr === (turn === 0 ? -2 : 2) && !pieces[(fromR + (turn === 0 ? -1 : 1)) * 8 + fromC]) || (Math.abs(dc) === 1 && dr === (turn === 0 ? -1 : 1) && !!piece)
          : (kind === 'R' ? (dr === 0 || dc === 0) : kind === 'B' ? Math.abs(dr) === Math.abs(dc) : dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) && pathIsClear(pieces, selected, index);
      }
      if (!valid) { setSelected(null); return; }
      const next = [...pieces]; next[index] = moving; next[selected] = null;
      if (capturedIndex !== null) next[capturedIndex] = null;
      if (id === 'dame' && ((turn === 0 && toR === 0) || (turn === 1 && toR === 7))) next[index] = { ...moving, kind: 'K' };
      if (id === 'chess' && moving.kind === 'P' && (toR === 0 || toR === 7)) next[index] = { ...moving, kind: 'Q' };
      setPieces(next); setSelected(null);
      if (piece?.kind === 'K' && id === 'chess') setWinner(turn);
      else if (id === 'dame' && !next.some((candidate) => candidate?.side !== turn)) setWinner(turn);
      else setTurn(turn === 0 ? 1 : 0);
    }
  };

  const submitWord = () => {
    const value = word.toUpperCase().replace(/[^A-Z]/g, '');
    const available = [...racks[turn]];
    if (value.length < 2 || !WORDS.has(value) || !value.split('').every((letter) => {
      const position = available.indexOf(letter);
      if (position < 0) return false;
      available.splice(position, 1);
      return true;
    })) { setWordError('Use a word from the starter list and only letters in your rack.'); return; }
    const nextRacks = racks.map((rack, player) => player === turn ? [...rack] : rack) as string[][];
    for (const letter of value) nextRacks[turn].splice(nextRacks[turn].indexOf(letter), 1);
    let nextBag = letterBag;
    while (nextRacks[turn].length < 7 && nextBag.length) {
      const drawAt = Math.floor(Math.random() * nextBag.length);
      nextRacks[turn].push(nextBag[drawAt]);
      nextBag = nextBag.slice(0, drawAt) + nextBag.slice(drawAt + 1);
    }
    setLetterBag(nextBag);
    setRacks(nextRacks);
    const points = [...value].reduce((sum, letter) => sum + LETTER_POINTS[letter], 0);
    setWordScores((old) => { const next: [number, number] = [...old]; next[turn] += points; return next; });
    setLastWord(value); setWord(''); setWordError(''); setConsecutivePasses(0); setTurn(turn === 0 ? 1 : 0);
  };
  const passWordTurn = () => {
    setWord(''); setWordError('');
    if (consecutivePasses >= 1) setWinner(wordScores[0] === wordScores[1] ? 2 : wordScores[0] > wordScores[1] ? 0 : 1);
    else { setConsecutivePasses((value) => value + 1); setTurn(turn === 0 ? 1 : 0); }
  };

  const title = info.name;
  const fillerScores = [
    fillerBoard.owners.filter((owner) => owner === 0).length,
    fillerBoard.owners.filter((owner) => owner === 1).length,
  ];
  const fillerCurrentColors = [
    fillerBoard.colors[fillerBoard.owners.findIndex((owner) => owner === 0)],
    fillerBoard.colors[fillerBoard.owners.findIndex((owner) => owner === 1)],
  ];
  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    <main className="yard-main" style={{ maxWidth: 980 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}><div><p className="yard-kicker">509 YARD / LOCAL FOUNDATION</p><h1>{title}</h1><p className="yard-subtitle">{info.intro}</p></div></header>
      <section className="yard-panel" style={{ padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}><strong role="status">{id === 'words' ? `${turnLabel} · ${wordScores[0]}–${wordScores[1]}` : turnLabel}</strong><button className="yard-button" type="button" onClick={reset}><RotateCcw size={14} /> New game</button></div>
        {id === 'box' && <p style={{ textAlign: 'center' }}>Boxes claimed: Player 1 {claimed.filter((owner) => owner === 0).length} · Player 2 {claimed.filter((owner) => owner === 1).length}</p>}
        {id === 'four-in-a-row' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(36px,64px))', gap: 6, justifyContent: 'center' }}>{four.map((cell, i) => <button key={i} aria-label={`Column ${i % 7 + 1}, row ${Math.floor(i / 7) + 1}`} className="yard-button" style={{ height: 58, borderRadius: 50, background: cell === 0 ? '#70ce52' : cell === 1 ? '#e2b852' : '#111318' }} onClick={() => makeMove(i)} disabled={winner !== null} />)}</div>}
        {id === 'box' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(30px,48px))', gridTemplateRows: 'repeat(7,42px)', gap: 1, justifyContent: 'center', overflowX: 'auto' }}>{Array.from({ length: 49 }, (_, i) => {
          const row = Math.floor(i / 7), col = i % 7;
          if (row % 2 === 0 && col % 2 === 0) return <span key={i} style={{ alignSelf: 'center', justifySelf: 'center', width: 10, height: 10, borderRadius: 10, background: '#e5e7e7', zIndex: 1 }} />;
          if (row % 2 === 0) { const r = row / 2, c = Math.floor(col / 2), key = `h:${r}:${c}`; return <button key={i} aria-label={`Draw horizontal edge ${r + 1}, ${c + 1}`} disabled={dots.has(key) || winner !== null} onClick={() => playBoxEdge(key, [r > 0 ? (r - 1) * 3 + c : -1, r < 3 ? r * 3 + c : -1].filter((n) => n >= 0))} style={{ border: 0, background: dots.has(key) ? edgeOwners.get(key) === 0 ? '#75d54d' : '#e2b852' : '#34383a', cursor: 'pointer' }} />;
          }
          if (col % 2 === 0) { const r = Math.floor(row / 2), c = col / 2, key = `v:${r}:${c}`; return <button key={i} aria-label={`Draw vertical edge ${r + 1}, ${c + 1}`} disabled={dots.has(key) || winner !== null} onClick={() => playBoxEdge(key, [c > 0 ? r * 3 + c - 1 : -1, c < 3 ? r * 3 + c : -1].filter((n) => n >= 0))} style={{ border: 0, background: dots.has(key) ? edgeOwners.get(key) === 0 ? '#75d54d' : '#e2b852' : '#34383a', cursor: 'pointer' }} />;
          }
          const owner = claimed[Math.floor(row / 2) * 3 + Math.floor(col / 2)];
          return <span key={i} style={{ display: 'grid', placeItems: 'center', color: '#fff', background: owner === 0 ? '#25491e' : owner === 1 ? '#58451c' : 'transparent' }}>{owner === null ? '' : `P${owner + 1}`}</span>;
        })}</div>}
        {id === 'kay' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(42px,72px))', gap: 8, justifyContent: 'center' }}><div style={{ gridColumn: 'span 6', textAlign: 'center' }}>Stores: Player 2 <b>{pits[13]}</b> · Player 1 <b>{pits[6]}</b></div>{[...Array(6)].map((_, i) => { const top = 12 - i; const bottom = i; return <button key={`t${i}`} className="yard-button" disabled={winner !== null || turn !== 1 || pits[top] === 0} onClick={() => makeMove(top)}> {pits[top]} </button>; })}{[...Array(6)].map((_, i) => <button key={`b${i}`} className="yard-button" disabled={winner !== null || turn !== 0 || pits[i] === 0} onClick={() => makeMove(i)}>{pits[i]}</button>)}</div>}
        {id === 'filler' && <div style={{ display: 'grid', gap: 12, justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 18, color: '#ddd', fontSize: 12 }}>
            <span>Player 1 · <b>{fillerScores[0]}</b> tiles</span>
            <span>Player 2 · <b>{fillerScores[1]}</b> tiles</span>
          </div>
          <div role="grid" aria-label="Filler board" style={{ display: 'grid', gridTemplateColumns: 'repeat(8,minmax(26px,44px))', gap: 3, justifyContent: 'center' }}>
            {fillerBoard.colors.map((color, i) => <div role="gridcell" key={i} aria-label={fillerBoard.owners[i] === null ? `Unclaimed ${COLOR_NAMES[color]} tile` : `Player ${fillerBoard.owners[i] + 1} territory, ${COLOR_NAMES[color]}`} style={{ aspectRatio: '1', borderRadius: 5, background: COLORS[color], outline: fillerBoard.owners[i] === null ? '1px solid #ffffff22' : '2px solid #fff' }} />)}
            <div style={{ gridColumn: 'span 8', display: 'flex', justifyContent: 'center', gap: 8, marginTop: 8 }}>
              {COLORS.map((color, i) => {
                const disabled = winner !== null || i === fillerCurrentColors[turn] || i === fillerCurrentColors[turn === 0 ? 1 : 0];
                return <button key={i} type="button" aria-label={`Choose ${COLOR_NAMES[i]}`} aria-pressed={i === fillerCurrentColors[turn]} disabled={disabled} onClick={() => makeMove(i)} style={{ width: 36, height: 36, borderRadius: 20, border: i === fillerCurrentColors[turn] ? '3px solid white' : '1px solid #ffffff88', background: color, opacity: disabled && i !== fillerCurrentColors[turn] ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }} />;
              })}
            </div>
          </div>
          <p style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>Choose a color different from both current territories. Connected tiles of your chosen color join your side. Most tiles wins when the board is full.</p>
        </div>}
        {(id === 'chess' || id === 'dame') && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,minmax(34px,60px))', justifyContent: 'center', border: '2px solid #58605c' }}>{pieces.map((piece, i) => <button key={i} aria-label={`Square ${i + 1}${piece ? ` ${piece.side === 0 ? 'player one' : 'player two'} ${piece.kind}` : ''}`} onClick={() => makeMove(i)} style={{ aspectRatio: '1', border: selected === i ? '3px solid #75d64b' : '1px solid #121417', background: (Math.floor(i / 8) + i % 8) % 2 ? '#373b3c' : '#c9c6b8', color: piece?.side === 0 ? '#141517' : '#f7f5eb', fontSize: 25, textShadow: '0 1px 2px #000', cursor: 'pointer' }}>{piece ? (id === 'chess' ? ({ K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' } as Record<string, string>)[piece.kind] : '●') : ''}</button>)}</div>}
        {id === 'words' && <div style={{ maxWidth: 540, margin: 'auto', display: 'grid', gap: 14 }}><p>Your rack: <b>{racks[turn].join(' · ')}</b></p><label>Build a word from your letters<input className="yard-input" value={word} onChange={(event) => { setWord(event.target.value); setWordError(''); }} maxLength={7} /></label><div style={{ display: 'flex', gap: 8 }}><button className="yard-button primary" onClick={submitWord} disabled={winner !== null}>Play word</button><button className="yard-button" onClick={passWordTurn} disabled={winner !== null}>Pass</button></div><p role={wordError ? 'alert' : 'status'}>{wordError || (lastWord ? `${lastWord} scored ${[...lastWord].reduce((sum, letter) => sum + LETTER_POINTS[letter], 0)} points.` : 'Starter dictionary and letter scores. Two consecutive passes end the game.')}</p></div>}
      </section>
      <p className="yard-subtitle" style={{ marginTop: 12 }}>Local pass-and-play foundation. Online play and advanced rules can be added later.</p>
    </main>
  </div>;
}
