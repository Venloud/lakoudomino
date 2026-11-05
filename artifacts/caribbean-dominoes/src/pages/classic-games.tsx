import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { Chess, type Square } from 'chess.js';
import { LETTER_POINTS, WORD_BONUSES, WORD_BOARD_SIZE, createWordGame, passWordTurn, playWordTurn } from '../lib/word-yard';
import type { WordDirection, WordPlacement } from '../lib/word-yard';
import { loadWordDictionary } from '../lib/word-yard-dictionary';
import { createFillerBoard, playFillerMove, type FillerPlayer } from '@/lib/filler';
import { chooseChessBotMove } from '@/lib/chess-bot';
import { canClaimChessDraw, hasAutomaticChessDraw } from '@/lib/chess-rules';
import { createChessGame, type ChessGame, type ChessMove, type ChessPieceKind } from '@/lib/chess';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';
import './word-yard.css';

type GameId = 'box' | 'kay' | 'chess' | 'dame' | 'words' | 'four-in-a-row' | 'filler';
const CHESS_CLOCK_START_MS = 10 * 60 * 1000;
const CHESS_CLOCK_PRESETS = [
  { id: 'bullet-1', label: 'Bullet · 1+0', seconds: 60, increment: 0 },
  { id: 'blitz-3', label: 'Blitz · 3+2', seconds: 180, increment: 2 },
  { id: 'blitz-5', label: 'Blitz · 5+0', seconds: 300, increment: 0 },
  { id: 'rapid-10', label: 'Rapid · 10+0', seconds: 600, increment: 0 },
  { id: 'rapid-15', label: 'Rapid · 15+10', seconds: 900, increment: 10 },
  { id: 'classical-30', label: 'Classical · 30+0', seconds: 1800, increment: 0 },
];
type ChessArchive = { id: string; date: number; result: 'win' | 'loss' | 'draw'; pgn: string };

function formatChessClock(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
type Piece = { side: 0 | 1; kind: string } | null;
const GAME_INFO: Record<GameId, { name: string; intro: string }> = {
  box: { name: 'Box', intro: 'Take turns drawing edges. Complete a square to claim it and play again.' },
  kay: { name: 'Kay', intro: 'Sow stones around the pits. Capture stones and finish with the larger store.' },
  chess: { name: 'Chess', intro: 'Play by full chess rules. Choose a friend or challenge the Yard bot.' },
  dame: { name: 'Dame', intro: 'Move diagonally, jump opponents, and crown a piece at the far edge.' },
  words: { name: 'Word Yard', intro: 'Build connected words on the shared board, score bonus squares, and use every tile in the bag.' },
  'four-in-a-row': { name: 'Four in a Row', intro: 'Drop a piece into a column and connect four in any direction.' },
  filler: { name: 'Filler', intro: 'Choose colors to absorb connected tiles and claim the largest territory in a 2–4 player match.' },
};
const COLORS = ['#56c746', '#e2b852', '#4e9de0', '#d86a72', '#a982da', '#42b7ad'];
const COLOR_NAMES = ['green', 'gold', 'blue', 'coral', 'violet', 'teal'];
const BOX_PLAYER_COLORS = ['#3b82f6', '#ef4444'];
const CONNECT_PLAYER_COLORS = ['#e64553', '#f3c744'];
const CHESS_GLYPHS = {
  white: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
  black: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' },
};
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

function chessGlyph(piece: Piece) {
  if (!piece) return '';
  const side = piece.side === 0 ? 'white' : 'black';
  return CHESS_GLYPHS[side][piece.kind as keyof typeof CHESS_GLYPHS.white];
}

function isChessGame(game: GameId): boolean {
  return game === 'chess';
}

function chessIndexToSquare(index: number) {
  return `${String.fromCharCode(97 + index % 8)}${8 - Math.floor(index / 8)}` as Square;
}
function chessSquareToIndex(square: Square) {
  return (8 - Number(square[1])) * 8 + square.charCodeAt(0) - 97;
}
function chessPieces(game: Chess): Piece[] {
  return game.board().flat().map((piece) => piece ? { side: piece.color === 'w' ? 0 : 1, kind: piece.type.toUpperCase() } : null);
}

function chessStateFromEngine(game: Chess): ChessGame {
  const fields = game.fen().split(' ');
  const castlingRights = fields[2] ?? '-';
  return {
    board: game.board().flat().map((piece) => piece
      ? { side: piece.color === 'w' ? 0 : 1, kind: piece.type.toUpperCase() as ChessPieceKind }
      : null),
    turn: game.turn() === 'w' ? 0 : 1,
    castling: {
      0: { kingSide: castlingRights.includes('K'), queenSide: castlingRights.includes('Q') },
      1: { kingSide: castlingRights.includes('k'), queenSide: castlingRights.includes('q') },
    },
    enPassant: fields[3] && fields[3] !== '-' ? chessSquareToIndex(fields[3] as Square) : null,
  };
}
function ChessSprite({ piece }: { piece: Piece }) {
  if (!piece) return null;
  const color = piece.side === 0 ? 'white' : 'black';
  const kind = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }[piece.kind as 'P' | 'N' | 'B' | 'R' | 'Q' | 'K'];
  return <img className="yard-chess-sprite" src={`${import.meta.env.BASE_URL}chess-pieces/${color}-${kind}.png`} alt="" draggable={false} />;
}
function KayPit({ index, count, owner, turn, winner, onPick, row, animating, active }: {
  index: number; count: number; owner: 0 | 1; turn: 0 | 1; winner: number | null;
  onPick: (index: number) => void; row: 'top' | 'bottom'; animating: boolean; active: boolean;
}) {
  return <button type="button" className={`yard-kay-pit ${row}${active ? ' sowing' : ''}`} aria-label={`Player ${owner + 1}, pit ${index + 1}, ${count} stones`}
    disabled={animating || winner !== null || turn !== owner || count === 0} onClick={() => onPick(index)}>
    <span className="yard-kay-stones" aria-hidden="true">{Array.from({ length: Math.min(count, 12) }, (_, i) => <i key={i} />)}</span>
    {active && <i className="yard-kay-arrival" aria-hidden="true" />}
    <b>{count}</b>
  </button>;
}
function KayStore({ player, count, active }: { player: 1 | 2; count: number; active: boolean }) {
  return <div className={`yard-kay-store player-${player}${active ? ' sowing' : ''}`} aria-label={`Player ${player} store, ${count} stones`}>
    <span>Player {player}</span><strong>{count}</strong>
    <i aria-hidden="true">{Array.from({ length: Math.min(count, 12) }, (_, i) => <b key={i} />)}</i>
  </div>;
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
  const [fourHoverCol, setFourHoverCol] = useState<number | null>(null);
  const [dots, setDots] = useState<Set<string>>(new Set());
  const [edgeOwners, setEdgeOwners] = useState<Map<string, number>>(new Map());
  const [claimed, setClaimed] = useState<(number | null)[]>(Array(9).fill(null));
  const [pits, setPits] = useState<number[]>(Array(14).fill(4).map((n, i) => i === 6 || i === 13 ? 0 : n));
  const [kayAnimatedPits, setKayAnimatedPits] = useState<number[] | null>(null);
  const [kayActivePit, setKayActivePit] = useState<number | null>(null);
  const [kayAnimating, setKayAnimating] = useState(false);
  const kayTimerRef = useRef<number | null>(null);
  const [fillerPlayerCount, setFillerPlayerCount] = useState<2 | 3 | 4>(2);
  const [fillerBoard, setFillerBoard] = useState(() => createFillerBoard(Math.random, 2));
  const [fillerTurn, setFillerTurn] = useState<FillerPlayer>(0);
  const [fillerWinner, setFillerWinner] = useState<FillerPlayer | 'draw' | null>(null);
  const [pieces, setPieces] = useState<Piece[]>(() => initialBoard(id === 'chess' ? 'chess' : 'dame'));
  const chessRef = useRef(new Chess());
  const [chessVersion, setChessVersion] = useState(0);
  const [playVsBot, setPlayVsBot] = useState(false);
  const [chessBotDifficulty, setChessBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [humanChessColor, setHumanChessColor] = useState<'w' | 'b'>('w');
  const [chessState, setChessState] = useState<ChessGame>(createChessGame);
  const [chessClockMs, setChessClockMs] = useState<[number, number]>([CHESS_CLOCK_START_MS, CHESS_CLOCK_START_MS]);
  const chessClockRef = useRef<[number, number]>([CHESS_CLOCK_START_MS, CHESS_CLOCK_START_MS]);
  const chessClockHistoryRef = useRef<[number, number][]>([]);
  const [chessClockPreset, setChessClockPreset] = useState('rapid-10');
  const [customClockMinutes, setCustomClockMinutes] = useState(20);
  const [customClockIncrement, setCustomClockIncrement] = useState(0);
  const [drawOfferBy, setDrawOfferBy] = useState<0 | 1 | null>(null);
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [chessArchive, setChessArchive] = useState<ChessArchive[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('509-yard-chess-history') ?? '[]');
      return Array.isArray(stored) ? stored.filter((entry): entry is ChessArchive =>
        entry && typeof entry.id === 'string' && typeof entry.date === 'number' &&
        ['win', 'loss', 'draw'].includes(entry.result) && typeof entry.pgn === 'string').slice(0, 50) : [];
    } catch { return []; }
  });
  const chessRecordIdRef = useRef(String(Date.now()));
  const recordedChessGameRef = useRef<string | null>(null);
  const chessTurnRef = useRef<0 | 1>(0);
  const chessClockUpdatedAtRef = useRef(Date.now());
  const [promotionMove, setPromotionMove] = useState<ChessMove | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [wordGame, setWordGame] = useState(createWordGame);
  const [wordDictionary, setWordDictionary] = useState<ReadonlySet<string> | null>(null);
  const [wordPlacements, setWordPlacements] = useState<WordPlacement[]>([]);
  const [selectedRackIndex, setSelectedRackIndex] = useState<number | null>(null);
  const [wordDirection, setWordDirection] = useState<WordDirection>('horizontal');
  const [blankLetter, setBlankLetter] = useState('A');
  const [wordFeedback, setWordFeedback] = useState('Select a rack tile, then choose an empty board square.');
  const chessClockControl = chessClockPreset === 'custom'
    ? { seconds: customClockMinutes * 60, increment: customClockIncrement }
    : CHESS_CLOCK_PRESETS.find((preset) => preset.id === chessClockPreset) ?? CHESS_CLOCK_PRESETS[3];
  const humanChessSide: 0 | 1 = humanChessColor === 'w' ? 0 : 1;
  const botChessSide: 0 | 1 = humanChessSide === 0 ? 1 : 0;
  const chessBoardIndices = Array.from({ length: 64 }, (_, index) =>
    playVsBot && humanChessColor === 'b' ? 63 - index : index);
  const applyChessClock = (seconds: number) => {
    const start = seconds * 1000;
    chessClockRef.current = [start, start];
    setChessClockMs([start, start]);
    chessClockUpdatedAtRef.current = Date.now();
  };

  useEffect(() => {
    if (id !== 'words') return;
    let active = true;
    loadWordDictionary().then((dictionary) => {
      if (active) setWordDictionary(dictionary);
    }).catch(() => {
      if (active) setWordFeedback('The word list could not be loaded. Reload this page to try again.');
    });
    return () => { active = false; };
  }, [id]);
  useEffect(() => () => { if (kayTimerRef.current !== null) window.clearTimeout(kayTimerRef.current); }, []);

  const advanceChessClock = useCallback(() => {
    const now = Date.now();
    const activeSide = chessTurnRef.current;
    const next: [number, number] = [...chessClockRef.current];
    next[activeSide] = Math.max(0, next[activeSide] - (now - chessClockUpdatedAtRef.current));
    chessClockUpdatedAtRef.current = now;
    chessClockRef.current = next;
    setChessClockMs(next);
    if (next[activeSide] === 0) {
      setWinner(activeSide === 0 ? 1 : 0);
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (id !== 'chess' || winner !== null) return;
    chessClockUpdatedAtRef.current = Date.now();
    const timer = window.setInterval(advanceChessClock, 250);
    return () => window.clearInterval(timer);
  }, [advanceChessClock, id, winner]);

  const reset = () => {
    if (id === 'filler') {
      setFillerBoard(createFillerBoard(Math.random, fillerPlayerCount));
      setFillerTurn(0);
      setFillerWinner(null);
      return;
    }
    if (id === 'chess') {
      chessRef.current = new Chess();
      chessRecordIdRef.current = `${Date.now()}-${Math.random()}`;
      recordedChessGameRef.current = null;
      setChessState(createChessGame());
      chessClockHistoryRef.current = [];
      chessTurnRef.current = 0;
      applyChessClock(chessClockControl.seconds);
      setPromotionMove(null);
      setDrawOfferBy(null);
      setReviewPly(null);
      setPieces(chessPieces(chessRef.current));
      setTurn(0); setWinner(null); setSelected(null); setChessVersion((version) => version + 1);
      return;
    }
    window.location.reload();
  };
  const activeTurn = id === 'words' ? wordGame.turn : id === 'filler' ? fillerTurn : turn;
  const fillerCurrentColors = Array.from({ length: fillerPlayerCount }, (_, player) =>
    fillerBoard.colors[fillerBoard.owners.findIndex((owner) => owner === player)]);
  const kayBoardPits = kayAnimatedPits ?? pits;
  const gameOver = id === 'words' ? wordGame.status === 'finished' : id === 'filler' ? fillerWinner !== null : winner !== null;
  const chessGame = chessRef.current;
  const chessHistoryMoves = chessGame.history({ verbose: true });
  const displayChessGame = reviewPly === null ? chessGame : (() => {
    const replay = new Chess();
    chessHistoryMoves.slice(0, reviewPly).forEach((move) => replay.move(move));
    return replay;
  })();
  const displayPieces = reviewPly === null ? pieces : chessPieces(displayChessGame);
  const chessLastMove = displayChessGame.history({ verbose: true }).at(-1);
  const chessLegalTargets = selected === null || id !== 'chess' || reviewPly !== null
    ? new Set<Square>()
    : new Set(chessGame.moves({ square: chessIndexToSquare(selected), verbose: true }).map((move) => move.to));
  const checkedKing = displayChessGame.isCheck()
    ? displayChessGame.board().flat().find((piece) => piece?.type === 'k' && piece.color === displayChessGame.turn())
    : undefined;
  const chessCheckedKing = checkedKing?.square;
  const chessStatus = id === 'chess'
    ? chessGame.isCheckmate() ? 'checkmate' : chessGame.isStalemate() ? 'stalemate' : chessGame.isCheck() ? 'check' : 'playing'
    : null;
  const turnLabel = id === 'filler'
    ? fillerWinner === 'draw' ? 'Draw game' : fillerWinner !== null ? `Player ${fillerWinner + 1} wins` : playVsBot && fillerTurn === 1 ? 'Yard bot to move' : `Player ${fillerTurn + 1} to move`
    : id === 'kay' && kayAnimating
    ? `Player ${turn + 1} is sowing…`
    : id === 'chess'
      ? winner === null
        ? `${playVsBot ? chessState.turn === humanChessSide ? 'Your turn' : 'Yard bot to move' : `${chessState.turn === 0 ? 'White' : 'Black'} to move`}${chessStatus === 'check' ? ' · Check' : ''}`
        : winner === 2 ? 'Draw' : chessStatus === 'checkmate'
          ? `Checkmate — ${playVsBot ? winner === humanChessSide ? 'You win' : 'Bot wins' : `${winner === 0 ? 'White' : 'Black'} wins`}`
          : playVsBot ? winner === humanChessSide ? 'You win' : 'Bot wins' : `${winner === 0 ? 'White' : 'Black'} wins`
    : id === 'words' && wordGame.status === 'finished'
      ? wordGame.winner === 2 ? 'Draw' : `Player ${(wordGame.winner ?? 0) + 1} wins`
        : gameOver ? winner === 2 ? 'Draw' : `Player ${(winner ?? 0) + 1} wins`
        : playVsBot && activeTurn === 1 ? 'Yard bot to move' : `Player ${activeTurn + 1} to move`;
  const playBoxEdge = (key: string, adjacentBoxes: number[], botMove = false) => {
    if ((playVsBot && turn === 1 && !botMove) || winner !== null || dots.has(key)) return;
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
  const finishChessMove = (move: ChessMove, promotion: ChessPieceKind = 'Q') => {
    if (!advanceChessClock()) return;
    const moving = chessState.board[move.from];
    chessClockHistoryRef.current.push([...chessClockRef.current]);
    try {
      chessGame.move({
        from: chessIndexToSquare(move.from),
        to: chessIndexToSquare(move.to),
        ...(moving?.kind === 'P' && [0, 7].includes(Math.floor(move.to / 8))
          ? { promotion: promotion.toLowerCase() }
          : {}),
      });
    } catch {
      chessClockHistoryRef.current.pop();
      return;
    }
    const next = chessStateFromEngine(chessGame);
    setChessState(next);
    setPieces(chessPieces(chessGame));
    const nextClock: [number, number] = [...chessClockRef.current];
    if (moving) nextClock[moving.side] += chessClockControl.increment * 1000;
    chessClockRef.current = nextClock;
    setChessClockMs(nextClock);
    chessTurnRef.current = next.turn;
    chessClockUpdatedAtRef.current = Date.now();
    setTurn(next.turn);
    setSelected(null);
    setPromotionMove(null);
    if (drawOfferBy !== null && drawOfferBy !== moving?.side) setDrawOfferBy(null);
    setReviewPly(null);
    setChessVersion((version) => version + 1);
    if (chessGame.isCheckmate()) setWinner(chessState.turn);
    else if (chessGame.isStalemate() || hasAutomaticChessDraw(chessGame)) setWinner(2);
  };

  const undoChessMove = () => {
    if (!chessGame.history().length) return;
    const pliesToUndo = playVsBot ? 2 : 1;
    for (let ply = 0; ply < pliesToUndo && chessGame.history().length; ply++) {
      chessGame.undo();
      const previousClock = chessClockHistoryRef.current.pop();
      if (previousClock) chessClockRef.current = previousClock;
    }
    setChessClockMs([...chessClockRef.current]);
    setChessState(chessStateFromEngine(chessGame));
    setPieces(chessPieces(chessGame));
    chessTurnRef.current = chessGame.turn() === 'w' ? 0 : 1;
    setTurn(chessTurnRef.current);
    chessClockUpdatedAtRef.current = Date.now();
    setWinner(null);
    setSelected(null);
    setPromotionMove(null);
    setDrawOfferBy(null);
    setReviewPly(null);
    setChessVersion((version) => version + 1);
  };

  const exportChessPgn = () => {
    const url = URL.createObjectURL(new Blob([chessGame.pgn()], { type: 'application/x-chess-pgn' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '509-yard-chess.pgn';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportArchivedPgn = (record: ChessArchive) => {
    const url = URL.createObjectURL(new Blob([record.pgn], { type: 'application/x-chess-pgn' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `509-yard-chess-${new Date(record.date).toISOString().slice(0, 10)}.pgn`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const drawOfferAction = () => {
    if (drawOfferBy !== null && drawOfferBy !== turn) {
      setWinner(2);
      setDrawOfferBy(null);
    } else {
      setDrawOfferBy(drawOfferBy === turn ? null : turn);
    }
  };

  const mayClaimDraw = canClaimChessDraw(chessGame);

  useEffect(() => {
    if (id !== 'chess' || !playVsBot || turn !== botChessSide || winner !== null) return;
    const timer = window.setTimeout(() => {
      const move = chooseChessBotMove(chessGame.fen(), botChessSide === 0 ? 'w' : 'b', chessBotDifficulty);
      if (!move) return;
      finishChessMove({
        from: chessSquareToIndex(move.from),
        to: chessSquareToIndex(move.to),
      }, (move.promotion?.toUpperCase() as ChessPieceKind | undefined) ?? 'Q');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [id, playVsBot, turn, winner, chessVersion, chessBotDifficulty, botChessSide]);

  useEffect(() => {
    if (id !== 'chess' || winner === null || recordedChessGameRef.current === chessRecordIdRef.current) return;
    const record: ChessArchive = {
      id: chessRecordIdRef.current,
      date: Date.now(),
      result: winner === 2 ? 'draw' : winner === 0 ? 'win' : 'loss',
      pgn: chessGame.pgn(),
    };
    recordedChessGameRef.current = record.id;
    setChessArchive((current) => {
      const next = [record, ...current].slice(0, 50);
      localStorage.setItem('509-yard-chess-history', JSON.stringify(next));
      return next;
    });
  }, [id, winner, playVsBot, chessVersion]);

  const makeMove = (index: number, botMove = false) => {
    if ((playVsBot && (id === 'chess' ? turn !== humanChessSide : turn === 1) && !botMove) || winner !== null) return;
    if (id === 'chess') {
      if (playVsBot && turn !== humanChessSide && !botMove) return;
      if (promotionMove) return;
      const piece = chessState.board[index];
      if (selected === null) { if (piece?.side === turn) setSelected(index); return; }
      if (piece?.side === turn) { setSelected(index); return; }
      const move = { from: selected, to: index };
      if (!chessGame.moves({ square: chessIndexToSquare(selected), verbose: true })
        .some((candidate) => candidate.to === chessIndexToSquare(index))) {
        setSelected(null);
        return;
      }
      const moving = chessState.board[selected];
      const row = Math.floor(index / 8);
      if (moving?.kind === 'P' && (row === 0 || row === 7)) {
        setPromotionMove(move);
        setSelected(null);
      } else finishChessMove(move);
      return;
    }
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
      if (kayAnimating) return;
      const own = turn === 0 ? index < 6 : index >= 7 && index < 13;
      if (!own || pits[index] === 0) return;
      const next = [...pits]; let stones = next[index]; next[index] = 0; let pos = index;
      const landings: { pit: number; pits: number[] }[] = [];
      while (stones > 0) {
        pos = (pos + 1) % 14;
        if ((turn === 0 && pos === 13) || (turn === 1 && pos === 6)) continue;
        next[pos]++; stones--;
        landings.push({ pit: pos, pits: [...next] });
      }
      const ownSide = turn === 0 ? pos < 6 : pos > 6 && pos < 13;
      const opposite = 12 - pos;
      const extra = (turn === 0 && pos === 6) || (turn === 1 && pos === 13);
      if (ownSide && next[pos] === 1 && next[opposite] > 0) { next[turn === 0 ? 6 : 13] += next[opposite] + 1; next[pos] = 0; next[opposite] = 0; }
      const p0Empty = next.slice(0, 6).every((n) => n === 0), p1Empty = next.slice(7, 13).every((n) => n === 0);
      const ended = p0Empty || p1Empty;
      if (ended) {
        next[6] += next.slice(0, 6).reduce((a, b) => a + b, 0);
        next[13] += next.slice(7, 13).reduce((a, b) => a + b, 0);
        for (let pit = 0; pit < 6; pit++) next[pit] = 0;
        for (let pit = 7; pit < 13; pit++) next[pit] = 0;
      }
      const finishMove = () => {
        setPits(next); setKayAnimatedPits(null); setKayActivePit(null); setKayAnimating(false);
        if (ended) setWinner(next[6] === next[13] ? 2 : next[6] > next[13] ? 0 : 1);
        else if (!extra) setTurn(turn === 0 ? 1 : 0);
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || landings.length === 0) finishMove();
      else {
        const start = [...pits]; start[index] = 0;
        setKayAnimatedPits(start); setKayAnimating(true);
        let step = 0;
        const delay = Math.max(180, Math.min(260, 3200 / landings.length));
        const sow = () => {
          const landing = landings[step++];
          setKayAnimatedPits(landing.pits); setKayActivePit(landing.pit);
          if (step < landings.length) kayTimerRef.current = window.setTimeout(sow, delay);
          else kayTimerRef.current = window.setTimeout(finishMove, 180);
        };
        kayTimerRef.current = window.setTimeout(sow, 120);
      }
    } else if (id === 'filler') {
      if (playVsBot && fillerTurn === 1 && !botMove) return;
      if (fillerWinner !== null) return;
      const next = playFillerMove(fillerBoard, fillerTurn, index);
      if (!next) return;
      setFillerBoard(next);
      setFillerTurn(next.turn);
      if (next.draw) setFillerWinner('draw');
      else if (next.winner !== null) setFillerWinner(next.winner);
    } else if (id === 'dame') {
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
      setPieces(next); setSelected(null);
      if (id === 'dame' && !next.some((candidate) => candidate?.side !== turn)) setWinner(turn);
      else setTurn(turn === 0 ? 1 : 0);
    }
  };

  useEffect(() => {
    if (!playVsBot || activeTurn !== 1 || gameOver || kayAnimating || id === 'chess' || id === 'words') return;
    const timer = window.setTimeout(() => {
      if (id === 'four-in-a-row') {
        const options = Array.from({ length: 7 }, (_, col) => col).filter((col) => four[col] === null || four[7 + col] === null);
        let chosen = options[Math.floor(options.length / 2)] ?? 3;
        for (const mark of [1, 0]) {
          const winning = options.find((col) => {
            let row = 5;
            while (row >= 0 && four[row * 7 + col] !== null) row--;
            if (row < 0) return false;
            const next = [...four]; next[row * 7 + col] = mark;
            return fourWinner(next, row * 7 + col) === mark;
          });
          if (winning !== undefined) { chosen = winning; break; }
        }
        makeMove(chosen, true);
      } else if (id === 'filler') {
        const colors = Array.from({ length: 6 }, (_, color) => color)
          .filter((color) => !fillerCurrentColors.includes(color));
        const chosen = colors.map((color) => ({ color, result: playFillerMove(fillerBoard, 1, color) }))
          .filter((entry) => entry.result)
          .sort((a, b) => (b.result?.scores[1] ?? 0) - (a.result?.scores[1] ?? 0))[0]?.color;
        if (chosen !== undefined) makeMove(chosen, true);
      } else if (id === 'kay') {
        const choices = pits.slice(7, 13).map((stones, offset) => ({ index: 12 - offset, stones }))
          .filter((entry) => entry.stones > 0).sort((a, b) => b.stones - a.stones);
        if (choices[0]) makeMove(choices[0].index, true);
      } else if (id === 'box') {
        const options: { key: string; adjacent: number[]; scoring: number; danger: number }[] = [];
        const add = (key: string, adjacent: number[]) => {
          if (dots.has(key)) return;
          const after = new Set(dots); after.add(key);
          const sides = (box: number) => {
            const r = Math.floor(box / 3), c = box % 3;
            return ['h:' + r + ':' + c, 'h:' + (r + 1) + ':' + c, 'v:' + r + ':' + c, 'v:' + r + ':' + (c + 1)]
              .filter((edge) => after.has(edge)).length;
          };
          options.push({ key, adjacent, scoring: adjacent.filter((box) => sides(box) === 4 && claimed[box] === null).length, danger: adjacent.filter((box) => sides(box) === 3 && claimed[box] === null).length });
        };
        for (let r = 0; r <= 3; r++) for (let c = 0; c < 3; c++) add(`h:${r}:${c}`, [r > 0 ? (r - 1) * 3 + c : -1, r < 3 ? r * 3 + c : -1].filter((n) => n >= 0));
        for (let r = 0; r < 3; r++) for (let c = 0; c <= 3; c++) add(`v:${r}:${c}`, [c > 0 ? r * 3 + c - 1 : -1, c < 3 ? r * 3 + c : -1].filter((n) => n >= 0));
        options.sort((a, b) => b.scoring - a.scoring || a.danger - b.danger);
        if (options[0]) playBoxEdge(options[0].key, options[0].adjacent, true);
      } else if (id === 'dame') {
        const moves: { from: number; to: number; capture: boolean }[] = [];
        pieces.forEach((piece, from) => {
          if (piece?.side !== 1) return;
          const r = Math.floor(from / 8), c = from % 8;
          for (const dr of (piece.kind === 'K' ? [-2, -1, 1, 2] : [1, 2])) for (const dc of [-Math.abs(dr), Math.abs(dr)]) {
            const nr = r + dr, nc = c + dc, to = nr * 8 + nc;
            if (nr < 0 || nr > 7 || nc < 0 || nc > 7 || pieces[to]) continue;
            const jumped = Math.abs(dr) === 2 ? pieces[(r + dr / 2) * 8 + c + dc / 2] : null;
            if (Math.abs(dr) === 2 ? jumped?.side === 0 : !jumped) moves.push({ from, to, capture: Boolean(jumped) });
          }
        });
        if (selected !== null && pieces[selected]?.side === 1) {
          const move = moves.find((candidate) => candidate.from === selected);
          if (move) makeMove(move.to, true);
        } else {
          const move = moves.sort((a, b) => Number(b.capture) - Number(a.capture))[0];
          if (move) makeMove(move.from, true);
          else setWinner(0);
        }
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [id, playVsBot, activeTurn, gameOver, kayAnimating, four, fillerBoard, fillerCurrentColors, pits, dots, claimed, pieces, selected]);

  const placeWordTile = (index: number) => {
    if (wordGame.status !== 'playing') return;
    const alreadyPlaced = wordPlacements.find((placement) => placement.index === index);
    if (alreadyPlaced) {
      setWordPlacements((current) => current.filter((placement) => placement.index !== index));
      setSelectedRackIndex(alreadyPlaced.rackIndex);
      setWordFeedback('Tile returned to your rack selection.');
      return;
    }
    if (wordGame.board[index] || selectedRackIndex === null) return;
    const rackLetter = wordGame.racks[wordGame.turn][selectedRackIndex];
    if (rackLetter === undefined) return;
    const letter = rackLetter === '?' ? blankLetter : rackLetter;
    setWordPlacements((current) => [...current, { index, rackIndex: selectedRackIndex, letter }]);
    setSelectedRackIndex(null);
    setWordFeedback('Tile placed. Add more tiles or play your word.');
  };
  const submitWord = () => {
    if (!wordDictionary) {
      setWordFeedback('The word list is still loading. Try again in a moment.');
      return;
    }
    const result = playWordTurn(wordGame, wordPlacements, wordDirection, wordDictionary);
    if (!result.ok) {
      setWordFeedback(result.reason);
      return;
    }
    setWordGame(result.state);
    setWordPlacements([]);
    setSelectedRackIndex(null);
    const ending = result.state.status === 'finished'
      ? result.state.winner === 2 ? ' The game is a draw.' : ` Player ${(result.state.winner ?? 0) + 1} wins.`
      : '';
    setWordFeedback(`${result.words.join(' · ')} scored ${result.score} points.${ending}`);
  };
  const passWordTurnHandler = () => {
    const next = passWordTurn(wordGame);
    setWordGame(next);
    setWordPlacements([]);
    setSelectedRackIndex(null);
    setWordFeedback(next.status === 'finished'
      ? `Two passes ended the game. Remaining rack values were deducted. ${next.winner === 2 ? 'The game is a draw.' : `Player ${(next.winner ?? 0) + 1} wins.`}`
      : 'Player passed. Another consecutive pass will end the round.');
  };

  if (isChessGame(id)) return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {winner !== null && <GameEndSequence gameName="Chess" perspective={winner === 2 ? 'draw' : playVsBot ? winner === 0 ? 'winner' : 'opponent' : 'local'} winnerName={playVsBot ? winner === 0 ? 'You' : 'The Yard bot' : winner === 2 ? 'Players' : winner === 0 ? 'White' : 'Black'} opponentName={playVsBot ? 'The Yard bot' : winner === 0 ? 'Black' : 'White'} onPlayAgain={reset} />}
    <main className="yard-main" style={{ maxWidth: 980 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}>
        <div><p className="yard-kicker">509 YARD / CHESS</p><h1>Chess</h1><p className="yard-subtitle">Full legal moves, check, checkmate, and a bot opponent.</p></div>
      </header>
      <section className="yard-panel" style={{ padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <strong role="status">{reviewPly === null ? turnLabel : `Reviewing position after move ${reviewPly}`}</strong>
          <button className="yard-button" type="button" onClick={reset}><RotateCcw size={14} /> New game</button>
        </div>
        <div className="yard-chess-tools">
          <div className="yard-chess-modes" role="group" aria-label="Choose opponent">
            <button className={`yard-button${playVsBot ? '' : ' primary'}`} type="button" aria-pressed={!playVsBot} onClick={() => setPlayVsBot(false)} disabled={chessGame.history().length > 0}>Two players</button>
            <button className={`yard-button${playVsBot ? ' primary' : ''}`} type="button" aria-pressed={playVsBot} onClick={() => setPlayVsBot(true)} disabled={chessGame.history().length > 0}>Play the bot</button>
            {playVsBot && <label>Bot strength <select className="yard-button" value={chessBotDifficulty} onChange={(event) => setChessBotDifficulty(event.target.value as 'easy' | 'medium' | 'hard')} disabled={chessGame.history().length > 0}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select></label>}
            {playVsBot && <label>You play as <select className="yard-button" value={humanChessColor} onChange={(event) => setHumanChessColor(event.target.value as 'w' | 'b')} disabled={chessGame.history().length > 0}>
              <option value="w">White</option><option value="b">Black</option>
            </select></label>}
          </div>
          <div className="yard-chess-modes" role="group" aria-label="Chess time control">
            <label>Time control <select className="yard-button" value={chessClockPreset} onChange={(event) => {
              const nextId = event.target.value;
              setChessClockPreset(nextId);
              const nextControl = nextId === 'custom' ? { seconds: customClockMinutes * 60, increment: customClockIncrement } : CHESS_CLOCK_PRESETS.find((preset) => preset.id === nextId) ?? CHESS_CLOCK_PRESETS[3];
              applyChessClock(nextControl.seconds);
            }} disabled={chessGame.history().length > 0}>
              {CHESS_CLOCK_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              <option value="custom">Custom</option>
            </select></label>
            {chessClockPreset === 'custom' && <>
              <label>Minutes <input className="yard-button" type="number" min={1} max={180} value={customClockMinutes} disabled={chessGame.history().length > 0} onChange={(event) => {
                const value = Math.max(1, Math.min(180, Number(event.target.value) || 1));
                setCustomClockMinutes(value); applyChessClock(value * 60);
              }} /></label>
              <label>Increment <input className="yard-button" type="number" min={0} max={60} value={customClockIncrement} disabled={chessGame.history().length > 0} onChange={(event) => setCustomClockIncrement(Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /></label>
            </>}
          </div>
          <div className="yard-chess-clocks" role="group" aria-label="Chess clocks">
            <div className={`yard-chess-clock${turn === 0 && winner === null ? ' active' : ''}${chessClockMs[0] <= 30_000 ? ' low' : ''}`} aria-label={`White ${formatChessClock(chessClockMs[0])}`}>
              <span>White</span><strong>{formatChessClock(chessClockMs[0])}</strong>
            </div>
            <div className={`yard-chess-clock${turn === 1 && winner === null ? ' active' : ''}${chessClockMs[1] <= 30_000 ? ' low' : ''}`} aria-label={`Black ${formatChessClock(chessClockMs[1])}`}>
              <span>Black</span><strong>{formatChessClock(chessClockMs[1])}</strong>
            </div>
          </div>
          <div className="yard-chess-modes" role="group" aria-label="Chess game actions">
            <button className="yard-button" type="button" onClick={undoChessMove} disabled={!chessGame.history().length || winner !== null}>Undo</button>
            {!playVsBot && <button className="yard-button" type="button" onClick={drawOfferAction} disabled={winner !== null}>
              {drawOfferBy !== null && drawOfferBy !== turn ? 'Accept draw' : drawOfferBy === turn ? 'Withdraw draw offer' : 'Offer draw'}
            </button>}
            <button className="yard-button" type="button" onClick={() => setWinner(2)} disabled={winner !== null || !mayClaimDraw}>Claim draw</button>
            <button className="yard-button" type="button" onClick={() => setWinner(turn === 0 ? 1 : 0)} disabled={winner !== null || (playVsBot && turn !== humanChessSide)}>Resign</button>
            <button className="yard-button" type="button" onClick={exportChessPgn} disabled={!chessGame.history().length}>Export PGN</button>
          </div>
          {drawOfferBy !== null && <p role="status" style={{ margin: 0, textAlign: 'center' }}>
            {drawOfferBy === turn ? 'A draw offer is waiting for the other player.' : 'Your opponent offers a draw.'}
          </p>}
          <p>{playVsBot ? `You are ${humanChessColor === 'w' ? 'White' : 'Black'}. The Yard bot is ${humanChessColor === 'w' ? 'Black' : 'White'}.` : 'White moves first. Select a piece to show its legal moves.'}</p>
          <div className="yard-chess-board" role="grid" aria-label="Chess board">
          {chessBoardIndices.map((i) => {
            const piece = displayPieces[i];
            const square = chessIndexToSquare(i);
            const isWhite = piece?.side === 0;
            const isLegal = chessLegalTargets.has(square);
            const isCheck = chessCheckedKing === square;
            const isLastMove = chessLastMove?.from === square || chessLastMove?.to === square;
            return <button
              key={square}
              type="button"
              role="gridcell"
              aria-label={`${square}${piece ? ` ${isWhite ? 'White' : 'Black'} ${piece.kind}` : ' empty'}${isLegal ? ', legal move' : ''}${isCheck ? ', king in check' : ''}`}
              onClick={() => makeMove(i)}
              draggable={Boolean(piece && piece.side === turn && winner === null && reviewPly === null)}
              onDragStart={() => { if (piece?.side === turn) setSelected(i); }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); makeMove(i); }}
              disabled={winner !== null || promotionMove !== null || (playVsBot && turn !== humanChessSide) || reviewPly !== null}
              className={`${(Math.floor(i / 8) + i % 8) % 2 ? 'dark' : 'light'}${piece ? ' occupied' : ''}${selected === i ? ' selected' : ''}${isLastMove ? ' last-move' : ''}${isCheck ? ' in-check' : ''}${isLegal ? ' legal' : ''}`}
            >{piece ? <ChessSprite piece={piece} /> : isLegal ? <i aria-hidden="true" /> : null}</button>;
          })}
          </div>
          <section className="yard-chess-history" aria-label="Move history">
            <strong>Moves</strong>
            {chessGame.history().length === 0 ? <span className="yard-chess-history-empty">Your moves will appear here.</span> :
              <ol>{Array.from({ length: Math.ceil(chessGame.history().length / 2) }, (_, i) => {
                const moves = chessGame.history();
                return <li key={i}><span>{i + 1}.</span>
                  <button className="yard-button" type="button" onClick={() => setReviewPly(i * 2 + 1)}>{moves[i * 2]}</button>
                  {moves[i * 2 + 1] && <button className="yard-button" type="button" onClick={() => setReviewPly(i * 2 + 2)}>{moves[i * 2 + 1]}</button>}
                </li>;
              })}</ol>}
            {chessGame.history().length > 0 && <div className="yard-chess-modes">
              <button className="yard-button" type="button" onClick={() => setReviewPly(0)} disabled={reviewPly === 0}>Start</button>
              <button className="yard-button" type="button" onClick={() => setReviewPly(Math.max(0, (reviewPly ?? chessGame.history().length) - 1))} disabled={(reviewPly ?? chessGame.history().length) === 0}>Previous</button>
              <button className="yard-button" type="button" onClick={() => setReviewPly(Math.min(chessGame.history().length, (reviewPly ?? chessGame.history().length) + 1))} disabled={(reviewPly ?? chessGame.history().length) >= chessGame.history().length}>Next</button>
              <button className="yard-button" type="button" onClick={() => setReviewPly(null)} disabled={reviewPly === null}>Live board</button>
              <button className="yard-button" type="button" onClick={exportChessPgn}>Download PGN</button>
            </div>}
            <details><summary>Current FEN</summary><code style={{ overflowWrap: 'anywhere' }}>{chessGame.fen()}</code></details>
            <details>
              <summary>Completed games · {chessArchive.length}</summary>
              <p>White perspective: {chessArchive.filter((record) => record.result === 'win').length} wins · {chessArchive.filter((record) => record.result === 'loss').length} losses · {chessArchive.filter((record) => record.result === 'draw').length} draws</p>
              {chessArchive.length === 0 ? <span className="yard-chess-history-empty">Finished matches will be saved on this device.</span> :
                <ul>{chessArchive.map((record) => <li key={record.id}>
                  <time dateTime={new Date(record.date).toISOString()}>{new Date(record.date).toLocaleDateString()}</time>
                  <b>{record.result}</b>
                  <button className="yard-button" type="button" onClick={() => exportArchivedPgn(record)}>PGN</button>
                </li>)}</ul>}
            </details>
          </section>
        </div>
        {promotionMove && <div role="group" aria-label="Choose a promotion piece" style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <strong style={{ alignSelf: 'center', color: '#f8f6ee' }}>Promote pawn:</strong>
          {(['Q', 'R', 'B', 'N'] as const).map((kind) => <button
            key={kind}
            type="button"
            className="yard-button"
            aria-label={`Promote to ${({ Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' } as const)[kind]}`}
            onClick={() => finishChessMove(promotionMove, kind)}
          >{chessGlyph({ side: chessState.turn, kind })} {{ Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' }[kind]}</button>)}
        </div>}
        <p style={{ maxWidth: 470, margin: '14px auto 0', textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>
          Green dots show legal moves. Gold rings mark captures; the red square marks a king in check. Castling, en passant, promotion, checkmate, and stalemate are handled by the rules engine.
        </p>
      </section>
    </main>
  </div>;

  const title = info.name;
  const fillerScores = Array.from({ length: fillerPlayerCount }, (_, player) =>
    fillerBoard.owners.filter((owner) => owner === player).length);
  const getFourColumnAt = (clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width === 0) return null;
    return Math.max(0, Math.min(6, Math.floor(((clientX - bounds.left) / bounds.width) * 7)));
  };
  const handleFourPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const col = getFourColumnAt(event.clientX, event.currentTarget);
    if (col !== null) setFourHoverCol((current) => current === col ? current : col);
  };
  const handleFourBoardClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const col = getFourColumnAt(event.clientX, event.currentTarget);
    if (col === null) return;
    makeMove(col);
  };
  const finalWinner = id === 'words' ? wordGame.winner : winner;
  const fillerDraw = id === 'filler' && fillerWinner === 'draw';
  const displayedWinner = id === 'filler' ? (typeof fillerWinner === 'number' ? fillerWinner : null) : finalWinner === 2 ? null : finalWinner;
  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {gameOver && <GameEndSequence
      gameName={title}
      perspective={fillerDraw || (id !== 'filler' && finalWinner === 2) ? 'draw' : 'local'}
      winnerName={fillerDraw || (id !== 'filler' && finalWinner === 2) ? 'Players' : id === 'chess' && playVsBot ? finalWinner === humanChessSide ? 'You' : 'Yard bot' : `Player ${(displayedWinner ?? 0) + 1}`}
      opponentName={id === 'filler' ? 'All players' : id === 'chess' && playVsBot ? finalWinner === humanChessSide ? 'Yard bot' : 'You' : displayedWinner === 0 ? 'Player 2' : 'Player 1'}
      score={id === 'words' ? `Player 1 ${wordGame.scores[0]} · Player 2 ${wordGame.scores[1]}` : id === 'filler' ? fillerScores.map((score, player) => `Player ${player + 1} ${score}`).join(' · ') : undefined}
      onPlayAgain={reset}
    />}
    <main className="yard-main" style={{ maxWidth: 980 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}><div><p className="yard-kicker">509 YARD / LOCAL FOUNDATION</p><h1>{title}</h1><p className="yard-subtitle">{info.intro}</p></div></header>
      <section className="yard-panel" style={{ padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}><strong role="status" data-testid="status-current-turn" style={id === 'box' && winner === null ? { color: BOX_PLAYER_COLORS[turn] } : id === 'four-in-a-row' && winner === null ? { color: CONNECT_PLAYER_COLORS[turn] } : undefined}>{id === 'words' ? `${turnLabel} · ${wordGame.scores[0]}–${wordGame.scores[1]}` : turnLabel}</strong><button className="yard-button" type="button" onClick={reset}><RotateCcw size={14} /> New game</button></div>
        {id !== 'chess' && id !== 'words' && <div role="group" aria-label="Choose opponent" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
          <button className={`yard-button${playVsBot ? '' : ' primary'}`} type="button" aria-pressed={!playVsBot} onClick={() => setPlayVsBot(false)}>Two players</button>
          <button className={`yard-button${playVsBot ? ' primary' : ''}`} type="button" aria-pressed={playVsBot} onClick={() => { setPlayVsBot(true); if (id === 'filler' && fillerPlayerCount !== 2) { setFillerPlayerCount(2); setFillerBoard(createFillerBoard(Math.random, 2)); setFillerTurn(0); setFillerWinner(null); } }}>Practice vs bot</button>
        </div>}
        {id === 'box' && <><div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 8, fontSize: 12 }}><span style={{ color: BOX_PLAYER_COLORS[0] }}>● Player 1 · Blue</span><span style={{ color: BOX_PLAYER_COLORS[1] }}>● Player 2 · Red</span></div><p style={{ textAlign: 'center' }}>Boxes claimed: Player 1 {claimed.filter((owner) => owner === 0).length} · Player 2 {claimed.filter((owner) => owner === 1).length}</p></>}
        {id === 'four-in-a-row' && <div className="yard-connect-four">
          <div className="yard-connect-legend"><span><i className="yard-connect-red" />Player 1 · Red</span><span><i className="yard-connect-yellow" />Player 2 · Yellow</span></div>
          <div className="yard-connect-controls" aria-label="Drop a piece into a column">
            {Array.from({ length: 7 }, (_, col) => <button key={col} type="button" className="yard-connect-drop" aria-label={`Drop into column ${col + 1}`} onClick={() => makeMove(col)} disabled={winner !== null || four[col] !== null}>Drop <span aria-hidden="true">↓</span></button>)}
          </div>
          <div className="yard-connect-interaction" role="group" aria-label="Move across the board to aim, then click to drop" onPointerMove={handleFourPointerMove} onPointerLeave={() => setFourHoverCol(null)} onClick={handleFourBoardClick}>
            {fourHoverCol !== null && winner === null && <i className={`yard-connect-cursor-piece ${turn === 0 ? 'yard-connect-red' : 'yard-connect-yellow'}`} style={{ left: `${((fourHoverCol + 0.5) / 7) * 100}%` }} aria-hidden="true" />}
            <div className="yard-connect-board" role="grid" aria-label="Four in a Row board">
              {four.map((cell, i) => <span key={i} role="gridcell" aria-label={`Row ${Math.floor(i / 7) + 1}, column ${i % 7 + 1}${cell === null ? ', empty' : cell === 0 ? ', red piece' : ', yellow piece'}`} className="yard-connect-slot">
                <i className={`yard-connect-disc${cell === 0 ? ' yard-connect-red' : cell === 1 ? ' yard-connect-yellow' : ''}`} />
              </span>)}
            </div>
          </div>
          <p className="yard-connect-hint">Move across the board to aim, then click to drop. Or use the column buttons above. Connect four horizontally, vertically, or diagonally.</p>
        </div>}
        {id === 'box' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(30px,48px))', gridTemplateRows: 'repeat(7,42px)', gap: 1, justifyContent: 'center', overflowX: 'auto' }}>{Array.from({ length: 49 }, (_, i) => {
          const row = Math.floor(i / 7), col = i % 7;
          if (row % 2 === 0 && col % 2 === 0) return <span key={i} style={{ alignSelf: 'center', justifySelf: 'center', width: 10, height: 10, borderRadius: 10, background: '#e5e7e7', zIndex: 1 }} />;
          if (row % 2 === 0) { const r = row / 2, c = Math.floor(col / 2), key = `h:${r}:${c}`; return <button key={i} aria-label={`Draw horizontal edge ${r + 1}, ${c + 1}`} disabled={dots.has(key) || winner !== null} onClick={() => playBoxEdge(key, [r > 0 ? (r - 1) * 3 + c : -1, r < 3 ? r * 3 + c : -1].filter((n) => n >= 0))} style={{ border: 0, background: dots.has(key) ? BOX_PLAYER_COLORS[edgeOwners.get(key) ?? 0] : '#34383a', cursor: 'pointer' }} />;
          }
          if (col % 2 === 0) { const r = Math.floor(row / 2), c = col / 2, key = `v:${r}:${c}`; return <button key={i} aria-label={`Draw vertical edge ${r + 1}, ${c + 1}`} disabled={dots.has(key) || winner !== null} onClick={() => playBoxEdge(key, [c > 0 ? r * 3 + c - 1 : -1, c < 3 ? r * 3 + c : -1].filter((n) => n >= 0))} style={{ border: 0, background: dots.has(key) ? BOX_PLAYER_COLORS[edgeOwners.get(key) ?? 0] : '#34383a', cursor: 'pointer' }} />;
          }
          const owner = claimed[Math.floor(row / 2) * 3 + Math.floor(col / 2)];
          return <span key={i} style={{ display: 'grid', placeItems: 'center', color: '#fff', background: owner === 0 ? '#173968' : owner === 1 ? '#5d252b' : 'transparent' }}>{owner === null ? '' : `P${owner + 1}`}</span>;
        })}</div>}
        {id === 'kay' && <div className="yard-kay-board" role="group" aria-label="Mancala board">
          <KayStore player={2} count={kayBoardPits[13]} active={kayAnimating && kayActivePit === 13} />
          {[...Array(6)].map((_, i) => <KayPit key={`top-${i}`} index={12 - i} count={kayBoardPits[12 - i]} owner={1} turn={turn} winner={winner} onPick={makeMove} row="top" animating={kayAnimating} active={kayActivePit === 12 - i} />)}
          <KayStore player={1} count={kayBoardPits[6]} active={kayAnimating && kayActivePit === 6} />
          {[...Array(6)].map((_, i) => <KayPit key={`bottom-${i}`} index={i} count={kayBoardPits[i]} owner={0} turn={turn} winner={winner} onPick={makeMove} row="bottom" animating={kayAnimating} active={kayActivePit === i} />)}
        </div>}
        {id === 'filler' && <div style={{ display: 'grid', gap: 12, justifyContent: 'center' }}>
          <div role="group" aria-label="Filler player count" style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            {([2, 3, 4] as const).map((count) => <button key={count} className="yard-button" type="button" aria-pressed={fillerPlayerCount === count} onClick={() => { setFillerPlayerCount(count); setFillerBoard(createFillerBoard(Math.random, count)); setFillerTurn(0); setWinner(null); setFillerWinner(null); }}>{count} players</button>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 18, color: '#ddd', fontSize: 12 }}>
            {fillerScores.map((score, player) => <span key={player} aria-current={fillerTurn === player ? 'step' : undefined}>Player {player + 1} · <b>{score}</b> tiles</span>)}
          </div>
          <div role="grid" aria-label="Filler board" style={{ display: 'grid', gridTemplateColumns: 'repeat(8,minmax(26px,44px))', gap: 3, justifyContent: 'center' }}>
            {fillerBoard.colors.map((color, i) => <div role="gridcell" key={i} aria-label={fillerBoard.owners[i] === null ? `Unclaimed ${COLOR_NAMES[color]} tile` : `Player ${fillerBoard.owners[i] + 1} territory, ${COLOR_NAMES[color]}`} style={{ aspectRatio: '1', borderRadius: 5, background: COLORS[color], outline: fillerBoard.owners[i] === null ? '1px solid #ffffff22' : '2px solid #fff' }} />)}
            <div style={{ gridColumn: 'span 8', display: 'flex', justifyContent: 'center', gap: 8, marginTop: 8 }}>
              {COLORS.map((color, i) => {
                const isCurrentColor = i === fillerCurrentColors[fillerTurn];
                const disabled = fillerWinner !== null || (playVsBot && fillerTurn === 1) || fillerCurrentColors.includes(i);
                return <button key={i} type="button" aria-label={`Choose ${COLOR_NAMES[i]}`} aria-pressed={isCurrentColor} disabled={disabled} onClick={() => makeMove(i)} style={{ width: 36, height: 36, borderRadius: 20, border: isCurrentColor ? '3px solid white' : '1px solid #ffffff88', background: color, opacity: disabled && !isCurrentColor ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }} />;
              })}
            </div>
          </div>
          <p style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>Choose a color not held by any player. Connected matching tiles join your territory; opponents cannot take owned cells. Largest territory wins when the board is full.</p>
        </div>}
        {id === 'chess' && <div className="yard-chess-tools">
          <div className="yard-chess-modes" role="group" aria-label="Choose opponent">
            <button className={`yard-button${playVsBot ? '' : ' primary'}`} type="button" onClick={() => setPlayVsBot(false)} disabled={chessGame.history().length > 0}>Two players</button>
            <button className={`yard-button${playVsBot ? ' primary' : ''}`} type="button" onClick={() => setPlayVsBot(true)} disabled={chessGame.history().length > 0}>Play the bot</button>
          </div>
          <p>{playVsBot ? 'You play White. The Yard bot plays Black.' : 'White moves first. Select a piece to see its legal moves.'}</p>
          <div className="yard-chess-board" role="grid" aria-label="Chess board">
            {pieces.map((piece, i) => {
              const square = chessIndexToSquare(i);
              const isLastMove = chessLastMove?.from === square || chessLastMove?.to === square;
              const isLegal = chessLegalTargets.has(square);
              const isCheck = chessCheckedKing === square;
              const disabled = winner !== null || (playVsBot && turn === 1);
              const light = (Math.floor(i / 8) + i % 8) % 2 === 0;
              return <button key={square} type="button" role="gridcell" aria-label={`${square}${piece ? ` ${piece.side === 0 ? 'white' : 'black'} ${piece.kind}` : ''}${isLegal ? ', legal move' : ''}${isCheck ? ', king in check' : ''}`} onClick={() => makeMove(i)} disabled={disabled} className={`${light ? 'light' : 'dark'}${piece ? ' occupied' : ''}${selected === i ? ' selected' : ''}${isLastMove ? ' last-move' : ''}${isCheck ? ' in-check' : ''}${isLegal ? ' legal' : ''}`}>
                {piece ? chessGlyph(piece) : isLegal ? <i aria-hidden="true" /> : null}
              </button>;
            })}
          </div>
        </div>}
        {id === 'dame' && <div className="yard-dame-board" style={{ display: 'grid', gridTemplateColumns: 'repeat(8,minmax(34px,60px))', justifyContent: 'center', border: '2px solid #58605c' }}>{pieces.map((piece, i) => <button key={i} aria-label={`Square ${i + 1}${piece ? ` player ${piece.side + 1} ${piece.kind}` : ''}`} onClick={() => makeMove(i)} style={{ aspectRatio: '1', border: selected === i ? '3px solid #75d64b' : '1px solid #121417', background: (Math.floor(i / 8) + i % 8) ? '#373b3c' : '#c9c6b8', cursor: 'pointer' }}>{piece ? <img className="yard-dame-piece" src={`${import.meta.env.BASE_URL}dame-pieces/player-${piece.side + 1}.png`} alt="" draggable={false} /> : ''}</button>)}</div>}
        {id === 'words' && <div className="word-yard" data-testid="word-yard-game">
          <div className="wy-layout">
            <div className="wy-main">
              <p className="wy-caption" style={{ textAlign: 'center', margin: '0 0 10px' }}>15 × 15 word board · first word covers the center</p>
              <div className="wy-board-frame">
                <div className="wy-board" role="grid" aria-label="Word Yard board">
                  {wordGame.board.map((boardTile, index) => {
                    const pendingTile = wordPlacements.find((placement) => placement.index === index);
                    const tile = pendingTile
                      ? { letter: pendingTile.letter, blank: wordGame.racks[wordGame.turn][pendingTile.rackIndex] === '?' }
                      : boardTile;
                    const bonus = !tile ? WORD_BONUSES.get(index) : undefined;
                    const bonusLabels = { 'double-letter': '2L', 'triple-letter': '3L', 'double-word': '2W', 'triple-word': '3W', center: '★' };
                    const row = Math.floor(index / WORD_BOARD_SIZE) + 1;
                    const col = index % WORD_BOARD_SIZE + 1;
                    const isPlayableCell = !gameOver && (!boardTile || !!pendingTile);
                    return <button
                      key={index}
                      type="button"
                      role="gridcell"
                      className="wy-cell"
                      data-bonus={bonus}
                      data-bonus-label={bonus ? bonusLabels[bonus] : undefined}
                      data-testid={`word-board-cell-${index}`}
                      aria-label={`Row ${row}, column ${col}${tile ? `, ${tile.letter}${tile.blank ? ', blank tile' : ''}` : bonus ? `, ${bonus.replace('-', ' ')}` : ', empty'}${pendingTile ? ', pending tile, click to return' : ''}`}
                      disabled={!isPlayableCell || (!tile && selectedRackIndex === null)}
                      onClick={() => placeWordTile(index)}
                    >{tile && <span className="wy-tile" aria-hidden="true">
                      <span className="wy-letter">{tile.letter}</span>
                      <span className="wy-value">{tile.blank ? 0 : LETTER_POINTS[tile.letter]}</span>
                    </span>}</button>;
                  })}
                </div>
              </div>
              <p className="wy-caption" style={{ margin: '10px 0 0', textAlign: 'center' }}>
                Bonuses count only on the turn a tile is placed. Empty bag: {wordGame.bag.length} tiles.
                {wordDictionary ? ` Dictionary: ${wordDictionary.size.toLocaleString()} words.` : ' Loading dictionary…'}
              </p>
            </div>
            <aside className="wy-sidebar" aria-label="Word Yard game controls">
              <section className="wy-rack-panel" aria-label={`Player ${wordGame.turn + 1} rack`}>
                <h2 className="wy-panel-heading"><span>Player {wordGame.turn + 1} rack</span><small>{wordGame.racks[wordGame.turn].length} tiles</small></h2>
                <div className="wy-rack" role="group" aria-label="Choose a tile from your rack">
                  {wordGame.racks[wordGame.turn].map((letter, index) => <button
                    key={`${letter}-${index}`}
                    type="button"
                    className={`wy-tile${selectedRackIndex === index ? ' is-selected' : ''}`}
                    aria-label={`Select ${letter === '?' ? 'blank tile' : `letter ${letter}, ${LETTER_POINTS[letter]} points`}`}
                    aria-pressed={selectedRackIndex === index}
                    data-testid={`word-rack-tile-${index}`}
                    disabled={gameOver || wordPlacements.some((placement) => placement.rackIndex === index)}
                    onClick={() => {
                      setSelectedRackIndex((current) => current === index ? null : index);
                      if (letter === '?') setBlankLetter('A');
                    }}
                  ><span className="wy-letter">{letter}</span><span className="wy-value">{LETTER_POINTS[letter]}</span></button>)}
                </div>
                {selectedRackIndex !== null && wordGame.racks[wordGame.turn][selectedRackIndex] === '?' && <label className="wy-word-entry">
                  Choose a letter for the blank tile
                  <select value={blankLetter} onChange={(event) => setBlankLetter(event.target.value)} data-testid="select-blank-letter">
                    {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => <option key={letter} value={letter}>{letter}</option>)}
                  </select>
                </label>}
                <p className="wy-caption" style={{ margin: '10px 0 0' }}>
                  {selectedRackIndex === null ? 'Select a tile, then tap a square.' : 'Now choose an empty square on the board.'}
                </p>
              </section>
              <section className="wy-score-panel" aria-label="Player scores">
                <span className={`wy-score-label${wordGame.turn === 0 && !gameOver ? ' is-active' : ''}`}>Player 1</span>
                <span className={`wy-score-value${wordGame.turn === 0 && !gameOver ? ' is-active' : ''}`} data-testid="word-score-player-1">{wordGame.scores[0]}</span>
                <span className={`wy-score-label${wordGame.turn === 1 && !gameOver ? ' is-active' : ''}`}>Player 2</span>
                <span className={`wy-score-value${wordGame.turn === 1 && !gameOver ? ' is-active' : ''}`} data-testid="word-score-player-2">{wordGame.scores[1]}</span>
              </section>
              <section className="wy-rack-panel" aria-label="Play controls">
                <div className="wy-play-row" style={{ marginTop: 0 }}>
                  <button className="wy-action" type="button" aria-pressed={wordDirection === 'horizontal'} disabled={gameOver} onClick={() => setWordDirection('horizontal')}>Across</button>
                  <button className="wy-action" type="button" aria-pressed={wordDirection === 'vertical'} disabled={gameOver} onClick={() => setWordDirection('vertical')}>Down</button>
                </div>
                <div className="wy-play-row">
                  <button className="wy-action wy-action-primary" type="button" data-testid="button-play-word" onClick={submitWord} disabled={gameOver || !wordDictionary || wordPlacements.length === 0}>Play word</button>
                  <button className="wy-action" type="button" data-testid="button-pass-word" onClick={passWordTurnHandler} disabled={gameOver}>Pass</button>
                  <button className="wy-action" type="button" data-testid="button-clear-word" onClick={() => { setWordPlacements([]); setSelectedRackIndex(null); setWordFeedback('Draft cleared.'); }} disabled={gameOver || (!wordPlacements.length && selectedRackIndex === null)}>Clear</button>
                </div>
                <p className="wy-message" data-state={wordFeedback.includes('scored') ? 'success' : wordFeedback.includes('not ') || wordFeedback.includes('must') || wordFeedback.includes('Place') ? 'error' : undefined} role="status" aria-live="polite" data-testid="status-word-feedback">{wordFeedback}</p>
              </section>
            </aside>
          </div>
        </div>}
      </section>
      <p className="yard-subtitle" style={{ marginTop: 12 }}>Local pass-and-play foundation. Online play and advanced rules can be added later.</p>
    </main>
  </div>;
}
