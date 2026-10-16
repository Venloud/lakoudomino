// Lakou Domino — practice table (you vs 3 bots). Uses the real engine from ../src.
import {
  applyAction, autoStep, awardCrowns, buildTally, createMatch, endsTotal, layoutBoard, legalActions,
  countedHalves, isScoringTotal, placeTile, standings, startNextHand, timeoutMove, targetScore, TALLY_STROKES,
  type Action, type ArmId, type GameEvent, type LaidTile, type MatchState, type Mode, type Tile, type BotLevel,
} from '../src/index';

const SEAT_COLORS = ['#2F6BFF', '#E63946', '#1FB65E', '#FFD23F'];
const NAMES = ['You', 'Bot 2', 'Bot 3', 'Bot 4'];
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

let match: MatchState;
let mode: Mode = 'points';
let rowBoxes = 10;
let level: BotLevel = 'hard';
/** Multiplies the 5-second pause after each play: slow 1.5, normal 1, fast 0.5. */
let pace = 1;

let selected: Tile | null = null;
let busy = false;
let timer: number | undefined;
let log: { text: string; seat: number }[] = [];
let status: Record<number, string> = {};
let lastPlayed = -1;
let gameId = 0;
/** Pips that light up after a score: which tile halves counted, and when. */
let glow: { halves: ReturnType<typeof countedHalves>; at: number } | null = null;
const GLOW_MS = 2000;
let lastPlayersHTML = '';

// ─── setup ────────────────────────────────────────────────────────────────
function newGame() {
  clearTimeout(timer);
  gameId++;
  const r = createMatch({ mode, playerCount: 4, rowBoxes });
  match = r.match;
  log = [];
  status = {};
  selected = null;
  lastPlayed = -1;
  hideOverlay();
  handleEvents(r.events);
  render();
  schedule();
}

/** Pause after every play so everyone can see the tile, the points and the animations. */
const AFTER_PLAY_MS = 5000;
/** Each real player gets 30 seconds to play. */
const TURN_MS = 30_000;
let tick: number | undefined;
let turnDeadline = 0;

function schedule() {
  clearTimeout(timer);
  clearInterval(tick);
  turnDeadline = 0;
  if (match.over || match.hand.over) return;
  const my = gameId;
  const opening = match.hand.board.history.length === 0;
  busy = true;
  render();
  timer = window.setTimeout(() => {
    if (my !== gameId) return;
    const humanTurn = match.hand.turn === 0;
    const forced = legalActions(match).every((a) => a.type !== 'play');
    if (humanTurn && !forced) return startHumanTurn(my);
    const r = autoStep(match, ['human', level, level, level]);
    if (!r) { busy = false; render(); return; }
    match = r.match;
    handleEvents(r.events);
    render();
    afterMove();
  }, opening ? 800 : AFTER_PLAY_MS * pace);
}

function startHumanTurn(my: number) {
  busy = false;
  turnDeadline = Date.now() + TURN_MS;
  render();
  updateClock();
  tick = window.setInterval(updateClock, 250);
  timer = window.setTimeout(() => {
    if (my !== gameId || match.hand.turn !== 0) return;
    clearInterval(tick);
    turnDeadline = 0;
    selected = null;
    log.unshift({ text: "You ran out of time — played for you", seat: 0 });
    const r = timeoutMove(match);
    match = r.match;
    handleEvents(r.events);
    render();
    afterMove();
  }, TURN_MS);
}

function updateClock() {
  const bar = $('#turnbar');
  const left = turnDeadline ? Math.max(0, turnDeadline - Date.now()) : 0;
  bar.hidden = !turnDeadline;
  if (!turnDeadline) return;
  const secs = Math.ceil(left / 1000);
  bar.style.setProperty('--p', `${(left / TURN_MS) * 100}%`);
  bar.classList.toggle('low', secs <= 10);
  $('#clock').textContent = `${secs}s`;
}

function afterMove() {
  // Give everyone ~3 s to look at the revealed hands before the results sheet opens.
  if (match.over) { busy = false; render(); setTimeout(showMatchOver, 3000); return; }
  if (match.hand.over) { busy = false; render(); setTimeout(showHandOver, 3000); return; }
  schedule();
}

function humanPlay(action: Action) {
  if (busy || match.hand.turn !== 0) return;
  clearTimeout(timer);
  clearInterval(tick);
  turnDeadline = 0;
  updateClock();
  const r = applyAction(match, action);
  match = r.match;
  selected = null;
  handleEvents(r.events);
  render();
  afterMove();
}

// ─── events → log, pop-ups, seat status ─────────────────────────────────
function handleEvents(events: GameEvent[]) {
  for (const e of events) {
    switch (e.type) {
      case 'handStart':
        status = {};
        log.unshift({ text: `Hand ${e.hand} — ${NAMES[e.starter]} ${e.hand === 1 ? 'opens with the 6-6' : 'starts'}`, seat: e.starter });
        break;
      case 'play':
        status[e.seat] = '';
        lastPlayed = match.hand.board.history.length - 1;
        log.unshift({ text: `${NAMES[e.seat]} played ${e.tile[0]}-${e.tile[1]}`, seat: e.seat });
        break;
      case 'pass':
        status[e.seat] = 'Pass!';
        log.unshift({ text: `${NAMES[e.seat]} passed`, seat: e.seat });
        break;
      case 'score':
        log[0] && (log[0].text += `  ·  +${e.points}`);
        pop(`+${e.points}`, e.seat, 'score');
        glow = { halves: countedHalves(match.hand.board), at: performance.now() };
        break;
      case 'bonus': {
        const why = e.reason === 'pass' ? `${NAMES[e.passer!]} passed` : e.reason === 'domino' ? `went out · others had ${e.pipsLeft} pips` : e.reason === 'blockedDouble' ? `blocked ${NAMES[e.holder!]}'s ${e.double}-${e.double}` : e.reason === 'lockedGame' ? 'locked the game' : e.reason === 'allFour' ? `${e.doubled ? 'double all four' : 'all four'}, ends showing ${e.allFourValue}` : 'lowest hand';
        log.unshift({ text: `${NAMES[e.seat]} +${e.points} (${why})`, seat: e.seat });
        pop(`+${e.points}`, e.seat, 'bonus');
        if (e.reason === 'allFour') {
          // Big moment: show the bonus plus whatever the ends counted on that same play.
          const counted = events.find((x) => x.type === 'score' && x.seat === e.seat) as Extract<GameEvent, { type: 'score' }> | undefined;
          banner(`${e.doubled ? 'DOUBLE ALL FOUR' : 'ALL FOUR'}  +${e.points + (counted?.points ?? 0)}`, e.seat);
        }
        break;
      }
      case 'domino':
        banner('DOMINO!', e.seat);
        break;
      case 'locked':
        banner('Game locked', null);
        log.unshift({ text: 'Nobody can play — game locked', seat: -1 });
        break;
    }
  }
  log = log.slice(0, 40);
}

// ─── rendering ─────────────────────────────────────────────────────────────
function pipsHTML(n: number, lit = '') {
  const spots: Record<number, number[]> = {
    0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };
  let s = '';
  for (let i = 0; i < 9; i++) s += `<i class="${spots[n].includes(i) ? 'on' : ''}"></i>`;
  return `<span class="half${lit ? ' glow' : ''}"${lit}>${s}</span>`;
}

function tileHTML(first: number, second: number, orientation: 'h' | 'v', extra = '', litHalves: number[] = [], litAttr = '') {
  return `<span class="tile ${orientation} ${extra}">${pipsHTML(first, litHalves.includes(0) ? litAttr : '')}<span class="bar"></span>${pipsHTML(second, litHalves.includes(1) ? litAttr : '')}</span>`;
}

/** Which halves (0 = left/top, 1 = right/bottom) of this laid tile should glow right now. */
function litHalvesFor(t: LaidTile): number[] {
  if (!glow) return [];
  const out: number[] = [];
  for (const g of glow.halves) {
    if (g.order !== t.order) continue;
    if (g.half === 'both') out.push(0, 1);
    else if (g.half === 'first') out.push(0);
    else if (g.half === 'second') out.push(1);
    else out.push(t.outerHalf === 'first' ? 0 : 1);
  }
  return out;
}

function render() {
  mode = match.config.mode;
  renderSeats();
  renderBoard();
  renderHand();
  renderPanel();
  $('#modeLabel').textContent = mode === 'points' ? `Points · ${rowBoxes} boxes (${rowBoxes * 50})` : 'Regular';
  $('#handLabel').textContent = mode === 'points' ? `Hand ${match.hand.number}` : '';
  const ends = $('#ends');
  ends.hidden = mode !== 'points' || !match.hand.board.center;
  const total = endsTotal(match.hand.board);
  ends.innerHTML = `Ends <b>${total}</b>`;
  ends.classList.toggle('hot', isScoringTotal(total));
}

function renderSeats() {
  const wrap = $('#opponents');
  wrap.innerHTML = [1, 2, 3].map((s) => seatCard(s)).join('');
  $('#me').innerHTML = seatCard(0, true);
}

function seatCard(seat: number, me = false) {
  const h = match.hand;
  const turn = h.turn === seat && !h.over && !match.over;
  const count = h.hands[seat].length;
  // After the hand, everyone's leftover tiles are shown face up.
  const revealed = h.over || match.over;
  const backs = revealed
    ? `<span class="reveal">${count ? h.hands[seat].map((t) => tileHTML(t[0], t[1], 'v', 'mini')).join('') : '<em>Out!</em>'}</span>`
    : me ? '' : `<span class="backs">${'<b></b>'.repeat(Math.min(count, 9))}</span>`;
  const st = status[seat] ? `<span class="st">${status[seat]}</span>` : turn ? `<span class="st think">${me ? 'Your turn' : 'Thinking…'}</span>` : '';
  const score = mode === 'points' ? `<span class="sc">${match.scores[seat]}</span>` : '';
  return `<div class="seat ${turn ? 'turn' : ''}" style="--c:${SEAT_COLORS[seat]}" data-seat="${seat}">
    <span class="av">${NAMES[seat][0]}</span>
    <span class="who"><b>${NAMES[seat]}</b><small>${count} tile${count === 1 ? '' : 's'}</small></span>
    ${backs}${st}${score}</div>`;
}

interface Ghost { arm: ArmId | 'center'; tile: LaidTile }

function renderBoard() {
  const board = match.hand.board;
  const table = $('#felt');
  const layout = layoutBoard(board, { halfWidth: 8, halfHeight: 8 });
  let ghosts: Ghost[] = [];

  if (selected && match.hand.turn === 0 && !busy) {
    const acts = legalActions(match).filter((a) => a.type === 'play' && sameTile(a.tile, selected!)) as Extract<Action, { type: 'play' }>[];
    ghosts = acts.map((a) => {
      const b2 = placeTile(board, match.config.mode, 0, a.tile, a.arm);
      const l2 = layoutBoard(b2, { halfWidth: 8, halfHeight: 8 });
      return { arm: a.arm, tile: l2.tiles[l2.tiles.length - 1] };
    });
  }

  const all = [...layout.tiles, ...ghosts.map((g) => g.tile)];
  const size = table.clientWidth - 24;
  if (!all.length) {
    table.innerHTML = `<div class="empty">${match.hand.turn === 0 ? 'Play the 6-6 to open the table' : 'Waiting for the opening tile…'}</div>`;
    return;
  }
  const minX = Math.min(...all.map((t) => t.x - t.w / 2)), maxX = Math.max(...all.map((t) => t.x + t.w / 2));
  const minY = Math.min(...all.map((t) => t.y - t.h / 2)), maxY = Math.max(...all.map((t) => t.y + t.h / 2));
  const unit = Math.min(size / (maxX - minX + 1), size / (maxY - minY + 1), 34);
  const offX = (table.clientWidth - (maxX - minX) * unit) / 2 - minX * unit;
  const offY = (table.clientHeight - (maxY - minY) * unit) / 2 - minY * unit;
  table.style.setProperty('--u', `${unit}px`);

  if (glow && performance.now() - glow.at > GLOW_MS) glow = null;
  // Re-renders during the glow keep the animation in step instead of restarting it.
  const litAttr = glow ? ` style="--glow-delay:-${Math.round(performance.now() - glow.at)}ms"` : '';
  const g = Math.max(1.5, unit * 0.06); // small gap so touching tiles read as separate pieces
  const place = (t: LaidTile) => `left:${offX + (t.x - t.w / 2) * unit + g}px;top:${offY + (t.y - t.h / 2) * unit + g}px;width:${t.w * unit - 2 * g}px;height:${t.h * unit - 2 * g}px`;
  let html = layout.tiles
    .map((t) => `<div class="laid ${t.order === lastPlayed ? 'new' : ''} ${t.isSpinner ? 'spin' : ''}" style="${place(t)};--c:${SEAT_COLORS[t.seat]}">${tileHTML(t.first, t.second, t.orientation, '', litHalvesFor(t), litAttr)}${
      t.order === lastPlayed ? `<span class="tag-name ${tagSide(t)}">${NAMES[t.seat]}</span>` : ''}</div>`)
    .join('');
  html += ghosts.map((g, i) => `<button class="ghost" data-ghost="${i}" style="${place(g.tile)}" aria-label="Play here">${tileHTML(g.tile.first, g.tile.second, g.tile.orientation)}</button>`).join('');
  // Hand over: lay everyone's leftover tiles face up on the table.
  const h = match.hand;
  if (h.over || match.over) {
    const order = h.ranking ?? [0, 1, 2, 3];
    html += `<div class="table-reveal">${order.map((s) => {
      const left = h.hands[s];
      const p = left.reduce((a, t) => a + t[0] + t[1], 0);
      return `<div class="rv" style="--c:${SEAT_COLORS[s]}"><span class="rv-name">${NAMES[s]}</span><span class="rv-tiles">${
        left.length ? left.map((t) => tileHTML(t[0], t[1], 'v')).join('') : '<em>Domino!</em>'}</span><span class="rv-pips">${left.length ? `${p} pips` : ''}</span></div>`;
    }).join('')}</div>`;
  }
  table.innerHTML = html;
  table.querySelectorAll<HTMLButtonElement>('.ghost').forEach((b) =>
    b.addEventListener('click', () => {
      const g = ghosts[+b.dataset.ghost!];
      humanPlay({ type: 'play', tile: selected!, arm: g.arm });
    }),
  );
}

/** Put the name on the open (outward) side of the newest tile, where nothing else sits. */
function tagSide(t: LaidTile) {
  if (t.order === 0) return 'bottom';
  if (Math.abs(t.x) > Math.abs(t.y)) return t.x > 0 ? 'right' : 'left';
  return t.y < 0 ? 'top' : 'bottom';
}

function renderHand() {
  const h = match.hand;
  const myTurn = h.turn === 0 && !busy && !h.over && !match.over;
  const legal = myTurn ? legalActions(match) : [];
  const playable = (t: Tile) => legal.some((a) => a.type === 'play' && sameTile(a.tile, t));
  const hand = $('#hand');
  hand.innerHTML = h.hands[0]
    .map((t, i) => {
      const can = playable(t);
      const sel = selected && sameTile(selected, t);
      return `<button class="mine ${can ? 'can' : ''} ${sel ? 'sel' : ''}" data-i="${i}" ${can ? '' : 'disabled'} aria-label="Tile ${t[0]}-${t[1]}">${tileHTML(t[0], t[1], 'v')}</button>`;
    })
    .join('');
  hand.querySelectorAll<HTMLButtonElement>('.mine.can').forEach((b) =>
    b.addEventListener('click', () => {
      const t = h.hands[0][+b.dataset.i!];
      const opts = legal.filter((a) => a.type === 'play' && sameTile(a.tile, t)) as Extract<Action, { type: 'play' }>[];
      if (opts.length === 1) return humanPlay(opts[0]);
      selected = selected && sameTile(selected, t) ? null : t;
      render();
    }),
  );
  const hint = $('#hint');
  hint.textContent = !myTurn ? '' : selected ? 'Tap a glowing spot on the table' : legal.some((a) => a.type === 'play') ? 'Your turn — tap a tile' : '';
}

function renderPanel() {
  const rows = [0, 1, 2, 3]
    .map((s) => {
      const tally = mode === 'points' ? buildTally(match.scoreLog[s], rowBoxes) : null;
      const boxes = tally
        ? `<div class="tally" style="--n:${Math.min(rowBoxes, 10)}">${tally.boxes.map((b, i) => { const tip = boxTip(b, i); return `<span class="box" tabindex="0" data-tip="${tip}" aria-label="${tip}">${boxSVG(b)}</span>`; }).join('')}${tally.overflow ? `<span class="over">+${tally.overflow}</span>` : ''}</div>`
        : '';
      return `<div class="prow" style="--c:${SEAT_COLORS[s]}"><div class="ptop"><span class="dot"></span><b>${NAMES[s]}</b>${
        mode === 'points' ? `<span class="pts">${match.scores[s]}<small> / ${targetScore(match)}</small></span>` : `<span class="pts">${match.hand.hands[s].length}<small> left</small></span>`
      }</div>${boxes}</div>`;
    })
    .join('');
  if (rows !== lastPlayersHTML) { $('#players').innerHTML = rows; lastPlayersHTML = rows; } // keep hover tooltips steady
  $('#log').innerHTML = log.map((l) => `<li style="--c:${l.seat >= 0 ? SEAT_COLORS[l.seat] : '#9A93A6'}">${l.text}</li>`).join('');
}

function boxTip(b: ReturnType<typeof buildTally>['boxes'][number], i: number) {
  if (b.kind === 'fifty') return `Box ${i + 1}: 50 pts (bonus)`;
  return b.strokes ? `Box ${i + 1}: ${b.strokes * 5} pts${b.strokes === 10 ? ' (full)' : ` · ${50 - b.strokes * 5} to fill`}` : `Box ${i + 1}: empty`;
}

function boxSVG(b: ReturnType<typeof buildTally>['boxes'][number]) {
  if (b.kind === 'fifty') return `<svg viewBox="0 0 30 30"><text x="15" y="16" dominant-baseline="middle" text-anchor="middle">50</text></svg>`;
  return `<svg viewBox="0 0 30 30">${TALLY_STROKES.slice(0, b.strokes).map(([a, c, d, e]) => `<line x1="${a * 30}" y1="${c * 30}" x2="${d * 30}" y2="${e * 30}"/>`).join('')}</svg>`;
}

// ─── pop-ups & overlays ────────────────────────────────────────────────────
function pop(text: string, seat: number, kind: string) {
  const card = document.querySelector(`.seat[data-seat="${seat}"]`) as HTMLElement | null;
  const el = document.createElement('div');
  el.className = `pop ${kind}`;
  el.textContent = text;
  el.style.setProperty('--c', SEAT_COLORS[seat]);
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    const target = (document.querySelector(`.seat[data-seat="${seat}"]`) as HTMLElement | null) ?? card;
    const r = target?.getBoundingClientRect();
    if (r) { el.style.left = `${r.left + r.width / 2}px`; el.style.top = `${r.top + window.scrollY}px`; }
  });
  setTimeout(() => el.remove(), 2200);
}

function banner(text: string, seat: number | null) {
  const b = $('#banner');
  b.textContent = text;
  b.style.setProperty('--c', seat === null ? '#F4EFE6' : SEAT_COLORS[seat]);
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

function showHandOver() {
  const h = match.hand;
  const pipsLeft = h.hands.map((x) => x.reduce((s, t) => s + t[0] + t[1], 0));
  const title = h.board.history.length && h.hands[h.winner!].length === 0 ? `${NAMES[h.winner!]} went out` : 'Game locked';
  const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const rows = standings(match).map((st) => {
    const s = st.seat;
    const note = h.hands[s].length === 0 ? 'went out' : `${pipsLeft[s]} pips left`;
    return `<li style="--c:${SEAT_COLORS[s]}"><span class="place">${ord(st.place)}</span><span class="dot"></span><span class="nm"><b>${NAMES[s]}</b><small>${note}${st.thisHand ? ` · <em>+${st.thisHand}</em> this hand` : ''}</small>${h.hands[s].length ? `<span class="reveal">${h.hands[s].map((t) => tileHTML(t[0], t[1], 'v', 'mini')).join('')}</span>` : ''}</span><span class="tot">${st.total}<small>${st.toGo} to go</small></span></li>`;
  }).join('');
  overlay(`
    <h2>${title}</h2>
    <p class="sub">Hand ${h.number} · ${h.winner === 0 ? 'You start' : `${NAMES[h.winner!]} starts`} the next hand</p>
    <p class="lead">Standings</p>
    <ol class="rank standings">${rows}</ol>
    <button class="primary" id="nextHand">Next hand</button>`);
  $('#nextHand').addEventListener('click', () => {
    const r = startNextHand(match);
    match = r.match;
    lastPlayed = -1;
    hideOverlay();
    handleEvents(r.events);
    render();
    schedule();
  });
}

function showMatchOver() {
  const crowns = awardCrowns(match);
  const medal = (m: string | null) => (m ? `<span class="crown ${m} ${mode === 'points' ? 'fancy' : ''}">${crownSVG()}</span>` : '<span class="crown none"></span>');
  const winner = match.placings![0];
  overlay(`
    <h2>${winner === 0 ? 'You won!' : `${NAMES[winner]} won`}</h2>
    <p class="sub">${mode === 'points' ? `First to fill the row (${targetScore(match)})` : 'Regular game'}</p>
    <ol class="rank">${crowns.map((c) => `<li style="--c:${SEAT_COLORS[c.seat]}">${medal(c.medal)}<b>${NAMES[c.seat]}</b><span>${c.crownPoints ? `+${c.crownPoints} crown pts` : 'gets up'}</span>${mode === 'points' ? `<span class="tot">${match.scores[c.seat]}</span>` : ''}</li>`).join('')}</ol>
    <button class="primary" id="again">Play again</button>`);
  $('#again').addEventListener('click', newGame);
}

function crownSVG() {
  return `<svg viewBox="0 0 24 18"><path d="M2 16 L3 5 L8 10 L12 2 L16 10 L21 5 L22 16 Z"/></svg>`;
}

function overlay(html: string) {
  $('#sheet').innerHTML = html;
  $('#overlay').hidden = false;
}
function hideOverlay() {
  $('#overlay').hidden = true;
}

const sameTile = (a: Tile, b: Tile) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

// ─── controls ──────────────────────────────────────────────────────────────
function bindSeg(id: string, onPick: (v: string) => void) {
  document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      onPick(b.dataset.v!);
    }),
  );
}
bindSeg('modeSeg', (v) => { mode = v as Mode; $('#rowCtl').hidden = mode !== 'points'; newGame(); });
bindSeg('botSeg', (v) => { level = v as BotLevel; });
bindSeg('speedSeg', (v) => { pace = +v; });
$('#rowMinus').addEventListener('click', () => { rowBoxes = Math.max(5, rowBoxes - 1); $('#rowVal').textContent = `${rowBoxes}`; newGame(); });
$('#rowPlus').addEventListener('click', () => { rowBoxes = Math.min(20, rowBoxes + 1); $('#rowVal').textContent = `${rowBoxes}`; newGame(); });
$('#newGame').addEventListener('click', newGame);
$('#felt').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.ghost')) return;
  if (selected) { selected = null; render(); }
});
window.addEventListener('resize', () => renderBoard());

newGame();
