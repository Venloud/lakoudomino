import { randomInt } from "node:crypto";
import { Chess } from "chess.js";

export const ARCADE_GAME_IDS = [
  "mopyon", "box", "kay", "chess", "dame", "scrabble",
  "barricade", "four-in-a-row", "filler", "block-drop",
] as const;
export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];

type RecordValue = Record<string, unknown>;
type ValidationResult = { ok: true; state: unknown; turn: number } | { ok: false; error: string };

const SCRABBLE_SIZE = 15;
const SCRABBLE_LETTER_POINTS: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};
const SCRABBLE_TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, "?": 2,
};
const SCRABBLE_WORDS = new Set(
  "ACE ACT ADD AGE AIR AND ANT ANY ARE ARM ART ASK ATE BAD BAG BAN BAR BAT BAY BED BEE BEG BET BIG BIN BIT BOW BOX BOY BUS BUT BUY CAB CAN CAP CAR CAT COW CUP CUT DAY DEN DID DIG DIM DIN DIP DOG DOT DRY DUE EAR EAT EEL EGG EGO ELF END ERA EVE EYE FAN FAR FAT FED FEE FEW FIG FIT FIX FLY FOG FOR FOX FUN GAP GAS GET GIN GOD GOT GUM GUN GUY HAD HAM HAS HAT HAY HEN HER HID HIM HIP HIS HIT HOG HOT HOW HUG ICE ILL INK JAM JAR JET JOB JOY KEY KID KIT LAB LAD LAP LAW LAY LED LEG LET LID LIE LIP LIT LOG LOT LOW MAD MAN MAP MAT MAY MEN MET MIX MOB MOM MOP MUD MUG NAP NET NEW NOD NOR NOT NOW NUN OAK OAR OAT OFF OIL OLD ONE OUR OUT OWL OWN PAD PAL PAN PAT PAW PAY PEA PEN PET PIE PIG PIN PIT POD POT PUB PUP PUT RAG RAN RAP RAT RAW RED RIB RID RIG RIP ROB ROD ROT ROW RUB RUG RUN SAD SAG SAP SAW SAY SEA SEE SET SEW SHE SHY SIR SIT SIX SKI SKY SOB SON SOP SOW SPA SPY SUB SUE SUM SUN TAB TAG TAN TAP TAR TAX TEA THE TIE TIN TIP TOE TON TOO TOP TOY TRY TUB TUG TWO USE VAN VAT VET VEX VIA VIE WAG WAR WAS WAY WEB WED WET WHO WHY WIG WIN WIT WOE WON WOO WOW YAK YAM YAP YEA YES YET YOU ZAP ZEN ZIP ZOO GAME GAMES PLAY YARD GREEN FRIENDS TABLE TURN STONE ABLE ACID ALSO AREA ARMY AWAY BABY BACK BALL BAND BANK BASE BEAR BEAT BEEN BELL BELT BEST BILL BIRD BLOW BLUE BOAT BODY BONE BOOK BORN BOTH BOWL BURN CALL CALM CAME CAMP CARD CARE CASE CASH CAST CELL CHAT CHIP CITY CLUB COAL COAT CODE COLD COME COOK COOL COPE COPY COST CROP DARK DATA DATE DAWN DEAL DEAR DEBT DEEP DESK DIAL DIET DISH DOES DOOR DOWN DRAW DROP DUST EACH EARN EAST EASY EDGE ELSE EVEN EVER EXIT FACE FACT FAIL FAIR FALL FARM FAST FATE FEAR FEED FEEL FEET FELL FELT FILE FILL FILM FIND FINE FIRE FIRM FISH FIVE FLAT FLOW FOOD FOOT FORM FORT FOUR FREE FROM FULL FUND GATE GAVE GEAR GIFT GIRL GIVE GLAD GOAL GOES GOLD GONE GOOD GRAB GRAY GREW GROW HAIR HALF HAND HANG HARD HARM HATE HAVE HEAD HEAR HEAT HELD HELP HERE HERO HIGH HILL HIRE HOLD HOLE HOME HOPE HOST HOUR HUGE HUNG HUNT HURT IDEA INTO IRON ITEM JOIN JOKE JUMP JUST KEEP KEPT KICK KILL KIND KING KNEW KNOW LACK LADY LAKE LAND LANE LAST LATE LEAD LEFT LESS LIFE LIFT LIKE LINE LINK LIST LIVE LOAD LOAN LOCK LOGO LONG LOOK LORD LOSE LOSS LOST LOVE LUCK MADE MAIL MAIN MAKE MALE MANY MARK MASS MATE MEAL MEAN MENU MERE MESH MESS MILD MILL MIND MINE MISS MODE MOOD MOON MORE MOST MOVE MUCH MUST NAME NAVY NEAR NEAT NEED NEWS NEXT NICE NINE NONE NOSE NOTE ONCE ONLY OPEN OVER PACE PACK PAGE PAID PAIN PAIR PALE PALM PARK PART PASS PAST PATH PEAK PICK PILE PINK PLAN PLAY PLOT PLUS POEM POET POLE POLL POOL POOR PORT POST PURE PUSH QUIT RACE RACK RAIN RANK RATE READ REAL REAR REED REST RICE RICH RIDE RING RISE RISK ROAD ROCK ROLE ROLL ROSE RULE SAFE SAGE SAID SAIL SALE SAME SAND SAVE SEAT SEEK SEEM SEEN SELF SELL SEND SENT SHIP SHOP SHOW SHUT SIDE SIGN SILK SING SITE SIZE SKIN SLIP SLOW SNOW SOFT SOIL SOLD SOLE SOME SONG SOON SORT SOUL SPOT STAR STAY STEP STOP SUCH SUIT SURE SWIM TAKE TALE TALK TALL TANK TAPE TASK TEAM TEAR TELL TEND TERM TEST TEXT THAN THAT THEM THEY THIN THIS TILL TIME TINY TOLD TONE TOOK TOOL TOUR TOWN TREE TRIP TRUE TUBE TUNE TURN TYPE UNIT UPON USED USER VARY VAST VERY VIEW VOTE WAIT WAKE WALK WALL WANT WARM WASH WAVE WEAK WEAR WEEK WELL WENT WERE WEST WHAT WHEN WIDE WIFE WILD WILL WIND WINE WING WISH WITH WOOD WORD WORK YEAR YELL YOUR ZERO ZONE CATS DOGS WORDS".split(" "),
);

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, index) => equal(value, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return equal(ak, bk) && ak.every((key) => equal(a[key], b[key]));
}

function nextPlayer(player: number, count: number): number {
  return (player + 1) % count;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function createScrabbleState(playerCount: number): RecordValue {
  const bag = shuffle(Object.entries(SCRABBLE_TILE_COUNTS).flatMap(([letter, count]) => Array(count).fill(letter)));
  const racks = Array.from({ length: playerCount }, () => bag.splice(0, 7));
  return {
    board: Array(SCRABBLE_SIZE * SCRABBLE_SIZE).fill(null),
    racks,
    bag,
    scores: Array(playerCount).fill(0),
    turn: 0,
    playerCount,
    passes: 0,
    winner: null,
  };
}

function createFillerState(playerCount: number): RecordValue {
  const colors = Array.from({ length: 64 }, () => randomInt(6));
  const starts = playerCount === 2 ? [0, 63] : playerCount === 3 ? [3, 56, 63] : [0, 7, 56, 63];
  const startColors = shuffle([0, 1, 2, 3, 4, 5]);
  const owners: (number | null)[] = Array(64).fill(null);
  starts.forEach((index, player) => {
    owners[index] = player;
    colors[index] = startColors[player];
  });
  return { turn: 0, winner: null, fillerPlayerCount: playerCount, fillerBoard: { colors, owners, playerCount, turn: 0 } };
}

function emptyBlockDrop(seed: number): RecordValue {
  const pieces = ["I", "O", "T", "J", "L", "S", "Z"] as const;
  const nextSeed = (value: number) => (Math.imul(value, 1664525) + 1013904223) >>> 0;
  const pieceFromSeed = (value: number) => {
    const index = Math.floor((value / 0x100000000) * pieces.length);
    return { type: pieces[index], seed: nextSeed(value) };
  };
  const first = pieceFromSeed(seed >>> 0);
  const second = pieceFromSeed(first.seed);
  const width = first.type === "I" ? 4 : first.type === "O" ? 2 : 3;
  return {
    board: Array.from({ length: 20 }, () => Array(10).fill(null)),
    active: { type: first.type, rotation: 0, x: Math.floor((10 - width) / 2), y: 0 },
    nextPiece: second.type,
    score: 0,
    lines: 0,
    level: 1,
    status: "playing",
    randomSeed: second.seed,
  };
}

function createDameBoard(): (RecordValue | null)[] {
  const board: (RecordValue | null)[] = Array(64).fill(null);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row * 8 + col] = { side: 1, kind: "D" };
  }
  for (let row = 5; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row * 8 + col] = { side: 0, kind: "D" };
  }
  return board;
}

function initialBarricadeState(): RecordValue {
  return {
    pawns: [0, 1].flatMap((player) => Array.from({ length: 5 }, (_, id) => ({ player, id, position: null }))),
    barriers: [3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53],
    turn: 0,
    roll: null,
    barrierMove: null,
    winner: null,
    message: "Roll the die, then choose one of your pawns.",
  };
}

export function createArcadeInitialState(game: ArcadeGameId, capacity: number): unknown {
  switch (game) {
    case "mopyon":
      return { board: Array(225).fill(null), currentPlayer: "X", winner: null, isDraw: false, winningLine: null, lastMove: null };
    case "box":
      return { turn: 0, winner: null, dots: [], edgeOwners: [], claimed: Array(9).fill(null) };
    case "kay":
      return { turn: 0, winner: null, pits: Array.from({ length: 14 }, (_, index) => index === 6 || index === 13 ? 0 : 4) };
    case "chess":
      return { fen: new Chess().fen(), turn: 0, winner: null, clocks: [600000, 600000] };
    case "dame":
      return { turn: 0, winner: null, pieces: createDameBoard() };
    case "scrabble":
      return createScrabbleState(capacity);
    case "barricade":
      return initialBarricadeState();
    case "four-in-a-row":
      return { turn: 0, winner: null, four: Array(42).fill(null) };
    case "filler":
      return createFillerState(capacity);
    case "block-drop":
      return Array.from({ length: capacity }, () => emptyBlockDrop(randomInt(0x100000000)));
  }
}

function reject(error: string): ValidationResult {
  return { ok: false, error };
}

function accept(state: unknown, turn: number): ValidationResult {
  return { ok: true, state, turn };
}

function validIndex(value: unknown, size: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < size;
}

function winLine(board: (string | null)[], index: number, mark: string): number[] | null {
  const row = Math.floor(index / 15);
  const col = index % 15;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [index];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r * 15 + c] === mark) {
        line.push(r * 15 + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

function validateMopyon(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) ||
      !Array.isArray(current.board) || current.board.length !== 225 ||
      !Array.isArray(proposed.board) || proposed.board.length !== 225) return reject("Invalid Mòpyon board.");
  const mark = current.currentPlayer;
  if ((mark !== "X" && mark !== "O") || mark !== (seat === 0 ? "X" : "O") || current.winner || current.isDraw) return reject("It is not your Mòpyon turn.");
  const oldBoard = current.board as unknown[];
  const newBoard = proposed.board as unknown[];
  const changed = newBoard.flatMap((value, index) => value !== oldBoard[index] ? [index] : []);
  if (changed.length !== 1 || current.board[changed[0]] !== null || proposed.board[changed[0]] !== mark ||
      proposed.board.some((cell) => cell !== null && cell !== "X" && cell !== "O")) return reject("That Mòpyon move is not legal.");
  const index = changed[0];
  const winningLine = winLine(newBoard as (string | null)[], index, mark);
  const isDraw = !winningLine && newBoard.every(Boolean);
  const nextMark = winningLine || isDraw ? mark : mark === "X" ? "O" : "X";
  const expected = { board: [...proposed.board], currentPlayer: nextMark, winner: winningLine ? mark : null, isDraw, winningLine, lastMove: index };
  return equal(expected, proposed) ? accept(expected, nextMark === "X" ? 0 : 1) : reject("That Mòpyon result does not match the move.");
}

const boxEdges = Array.from({ length: 24 }, (_, index) =>
  index < 12 ? `h:${Math.floor(index / 3)}:${index % 3}` : `v:${Math.floor((index - 12) / 4)}:${(index - 12) % 4}`,
);
function validateBox(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !Array.isArray(current.dots) ||
      !Array.isArray(current.claimed) || !Array.isArray(proposed.dots) || !Array.isArray(proposed.claimed) ||
      !Array.isArray(current.edgeOwners) || !Array.isArray(proposed.edgeOwners)) return reject("Invalid Box state.");
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Box turn.");
  const oldDots = new Set(current.dots);
  const newDots = new Set(proposed.dots);
  const added = [...newDots].filter((edge) => !oldDots.has(edge));
  if (added.length !== 1 || [...oldDots].some((edge) => !newDots.has(edge)) ||
      [...newDots].some((edge) => !boxEdges.includes(String(edge)))) return reject("That Box edge is not legal.");
  const edge = added[0] as string;
  const owners = new Map<string, number>(current.edgeOwners as [string, number][]);
  owners.set(edge, seat);
  const claimed = [...current.claimed] as (number | null)[];
  let scored = false;
  for (let box = 0; box < 9; box += 1) {
    if (claimed[box] !== null) continue;
    const row = Math.floor(box / 3), col = box % 3;
    const edges = [`h:${row}:${col}`, `h:${row + 1}:${col}`, `v:${row}:${col}`, `v:${row}:${col + 1}`];
    if (edges.every((candidate) => newDots.has(candidate))) {
      claimed[box] = seat;
      scored = true;
    }
  }
  const ended = newDots.size === 24;
  let winner: number | null = null;
  if (ended) {
    const p0 = claimed.filter((owner) => owner === 0).length;
    const p1 = claimed.filter((owner) => owner === 1).length;
    winner = p0 === p1 ? 2 : p0 > p1 ? 0 : 1;
  }
  const turn = ended || scored ? seat : nextPlayer(seat, 2);
  const expected = {
    turn, winner,
    dots: [...newDots].sort(),
    edgeOwners: [...owners].sort(([a], [b]) => a.localeCompare(b)),
    claimed,
  };
  return equal({ ...proposed, dots: [...new Set(proposed.dots)].sort(), edgeOwners: [...proposed.edgeOwners].sort(([a], [b]) => String(a).localeCompare(String(b))) }, expected)
    ? accept(expected, turn) : reject("That Box state does not match a legal edge.");
}

function calculateKay(pits: number[], seat: number, selected: number): { pits: number[]; turn: number; winner: number | null } | null {
  if (!validIndex(selected, 14) || (seat === 0 ? selected >= 6 : selected < 7 || selected >= 13) || pits[selected] <= 0) return null;
  const next = [...pits];
  let stones = next[selected];
  next[selected] = 0;
  let pos = selected;
  while (stones > 0) {
    pos = (pos + 1) % 14;
    if ((seat === 0 && pos === 13) || (seat === 1 && pos === 6)) continue;
    next[pos] += 1;
    stones -= 1;
  }
  const ownSide = seat === 0 ? pos < 6 : pos > 6 && pos < 13;
  const opposite = 12 - pos;
  const extra = (seat === 0 && pos === 6) || (seat === 1 && pos === 13);
  if (ownSide && next[pos] === 1 && next[opposite] > 0) {
    next[seat === 0 ? 6 : 13] += next[opposite] + 1;
    next[pos] = 0;
    next[opposite] = 0;
  }
  const ended = next.slice(0, 6).every((n) => n === 0) || next.slice(7, 13).every((n) => n === 0);
  if (ended) {
    next[6] += next.slice(0, 6).reduce((a, b) => a + b, 0);
    next[13] += next.slice(7, 13).reduce((a, b) => a + b, 0);
    for (let pit = 0; pit < 6; pit += 1) next[pit] = 0;
    for (let pit = 7; pit < 13; pit += 1) next[pit] = 0;
  }
  const winner = ended ? next[6] === next[13] ? 2 : next[6] > next[13] ? 0 : 1 : null;
  return { pits: next, turn: ended || extra ? seat : nextPlayer(seat, 2), winner };
}

function validateKay(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !Array.isArray(current.pits) || !Array.isArray(proposed.pits) ||
      current.pits.length !== 14 || proposed.pits.length !== 14) return reject("Invalid Kay state.");
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Kay turn.");
  for (let pit = 0; pit < 14; pit += 1) {
    const result = calculateKay(current.pits as number[], seat, pit);
    if (!result) continue;
    const expected = { ...result };
    if (equal(proposed, expected)) return accept(expected, result.turn);
  }
  return reject("That Kay sow is not legal.");
}

function fourWinner(board: (number | null)[], at: number): number | null {
  const row = Math.floor(at / 7), col = at % 7, mark = board[at];
  if (mark === null) return null;
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r * 7 + c] === mark) {
        count += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return mark;
  }
  return null;
}

function validateFour(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !Array.isArray(current.four) || !Array.isArray(proposed.four) ||
      current.four.length !== 42 || proposed.four.length !== 42) return reject("Invalid Four in a Row state.");
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Four in a Row turn.");
  const oldBoard = current.four as unknown[];
  const newBoard = proposed.four as unknown[];
  const changed = newBoard.flatMap((value, index) => value !== oldBoard[index] ? [index] : []);
  if (changed.length !== 1) return reject("That Four in a Row drop is not legal.");
  const index = changed[0], col = index % 7;
  let landing = 5;
  while (landing >= 0 && current.four[landing * 7 + col] !== null) landing -= 1;
  if (landing < 0 || index !== landing * 7 + col || proposed.four[index] !== seat) return reject("That Four in a Row column is full or out of turn.");
  const board = [...current.four] as (number | null)[];
  board[index] = seat;
  const winner = fourWinner(board, index) ?? (board.every((cell) => cell !== null) ? 2 : null);
  const turn = winner === null ? nextPlayer(seat, 2) : seat;
  const expected = { turn, winner, four: board };
  return equal(proposed, expected) ? accept(expected, turn) : reject("That Four in a Row result does not match the drop.");
}

function validateDame(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !Array.isArray(current.pieces) ||
      !Array.isArray(proposed.pieces) || current.pieces.length !== 64 || proposed.pieces.length !== 64) {
    return reject("Invalid Dame board.");
  }
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Dame turn.");
  const board = current.pieces as (RecordValue | null)[];
  for (let from = 0; from < 64; from += 1) {
    const moving = board[from];
    if (!moving || moving.side !== seat) continue;
    const row = Math.floor(from / 8), col = from % 8;
    for (const dr of moving.kind === "K" ? [-2, -1, 1, 2] : [seat === 0 ? -2 : 2, seat === 0 ? -1 : 1]) {
      for (const dc of [-Math.abs(dr), Math.abs(dr)]) {
        const toRow = row + dr, toCol = col + dc, to = toRow * 8 + toCol;
        if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7 || board[to]) continue;
        let captured: number | null = null;
        if (Math.abs(dr) === 2) {
          const middle = (row + dr / 2) * 8 + col + dc / 2;
          if (!board[middle] || board[middle]?.side === seat) continue;
          captured = middle;
        }
        const next = [...board];
        next[to] = moving;
        next[from] = null;
        if (captured !== null) next[captured] = null;
        if ((seat === 0 && toRow === 0) || (seat === 1 && toRow === 7)) next[to] = { ...moving, kind: "K" };
        const winner = next.every((piece) => piece === null || piece.side === seat) ? seat : null;
        const turn = winner === null ? nextPlayer(seat, 2) : seat;
        const expected = { turn, winner, pieces: next };
        if (equal(proposed, expected)) return accept(expected, turn);
      }
    }
  }
  return reject("That Dame move is not legal.");
}

function validateChess(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) ||
      typeof current.fen !== "string" || typeof proposed.fen !== "string" ||
      !Array.isArray(current.clocks) || !Array.isArray(proposed.clocks) ||
      current.clocks.length !== 2 || proposed.clocks.length !== 2) return reject("Invalid Chess position.");
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Chess turn.");
  try {
    const game = new Chess(current.fen);
    const activeColor = game.turn();
    const nextSeat = activeColor === "w" ? 0 : 1;
    if (nextSeat !== seat) return reject("The room turn does not match the Chess position.");
    for (const candidate of game.moves({ verbose: true })) {
      if (candidate.from === candidate.to) continue;
      const next = new Chess(current.fen);
      const move = next.move({
        from: candidate.from,
        to: candidate.to,
        ...(candidate.promotion ? { promotion: candidate.promotion } : {}),
      });
      if (!move || next.fen() !== proposed.fen) continue;
      const winner = next.isCheckmate() ? seat : next.isDraw() ? 2 : null;
      const clocks = proposed.clocks as unknown[];
      const oldClocks = current.clocks as unknown[];
      const isFirstMove = current.fen === new Chess().fen();
      if (clocks.some((clock) => typeof clock !== "number" || !Number.isFinite(clock) || clock < 0 || clock > 180 * 60 * 1000) ||
          (!isFirstMove && (clocks[1 - seat] !== oldClocks[1 - seat] ||
            (clocks[seat] as number) > (oldClocks[seat] as number) + 10_000)) ||
          (isFirstMove && (clocks[seat] as number) > (clocks[1 - seat] as number) + 10_000)) {
        return reject("Invalid Chess clock update.");
      }
      const turn = winner === null ? 1 - seat : seat;
      const expected = { fen: next.fen(), turn, winner, clocks: [...clocks] };
      return equal(proposed, expected) ? accept(expected, turn) : reject("That Chess result does not match a legal move.");
    }
  } catch {
    return reject("Invalid Chess position.");
  }
  return reject("That Chess move is not legal.");
}

function fillerMove(board: RecordValue, player: number, color: number): RecordValue | null {
  const colors = board.colors as number[];
  const owners = board.owners as (number | null)[];
  const playerCount = board.playerCount as number;
  if (!Number.isInteger(color) || color < 0 || color >= 6 || board.turn !== player ||
      owners.length !== 64 || colors.length !== 64) return null;
  const activeColors = new Set(owners.flatMap((owner, index) => owner !== null && owner < playerCount ? [colors[index]] : []));
  const start = owners.findIndex((owner) => owner === player);
  if (start < 0 || activeColors.has(color)) return null;
  const nextColors = [...colors];
  const nextOwners = [...owners];
  const frontier = owners.flatMap((owner, index) => owner === player ? [index] : []);
  for (const index of frontier) nextColors[index] = color;
  for (let cursor = 0; cursor < frontier.length; cursor += 1) {
    const index = frontier[cursor];
    const row = Math.floor(index / 8), col = index % 8;
    const neighbors = [
      ...(row > 0 ? [index - 8] : []),
      ...(row < 7 ? [index + 8] : []),
      ...(col > 0 ? [index - 1] : []),
      ...(col < 7 ? [index + 1] : []),
    ];
    for (const adjacent of neighbors) {
      if (nextOwners[adjacent] === null && nextColors[adjacent] === color) {
        nextOwners[adjacent] = player;
        frontier.push(adjacent);
      }
    }
  }
  const scores = Array.from({ length: playerCount }, (_, index) => nextOwners.filter((owner) => owner === index).length);
  const leaders = scores.flatMap((score, index) => score === Math.max(...scores) ? [index] : []);
  const complete = nextOwners.every((owner) => owner !== null);
  const winner = complete && leaders.length === 1 ? leaders[0] : null;
  return {
    colors: nextColors,
    owners: nextOwners,
    playerCount,
    turn: nextPlayer(player, playerCount),
    scores,
    winner,
    draw: complete && leaders.length > 1,
  };
}

function validateFiller(current: unknown, proposed: unknown, seat: number, capacity: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !isRecord(current.fillerBoard) ||
      !isRecord(proposed.fillerBoard) || !Array.isArray(current.fillerBoard.colors) ||
      !Array.isArray(current.fillerBoard.owners) || !Array.isArray(proposed.fillerBoard.colors) ||
      !Array.isArray(proposed.fillerBoard.owners)) return reject("Invalid Filler board.");
  if (current.turn !== seat || current.winner !== null || current.fillerPlayerCount !== capacity ||
      current.fillerBoard.turn !== seat) return reject("It is not your Filler turn.");
  const board = current.fillerBoard;
  for (let color = 0; color < 6; color += 1) {
    const result = fillerMove(board, seat, color);
    if (!result) continue;
    const winner = result.draw ? "draw" : result.winner;
    const expected = { turn: result.turn, winner, fillerPlayerCount: capacity, fillerBoard: result };
    if (equal(proposed, expected)) return accept(expected, Number(result.turn));
  }
  return reject("That Filler color choice is not legal.");
}

function multiset(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sameMultiset(left: string[], right: string[]): boolean {
  return equal([...multiset(left)].sort(), [...multiset(right)].sort());
}

function premiumAt(index: number): "TW" | "DW" | "TL" | "DL" | null {
  const row = Math.floor(index / 15), col = index % 15;
  const key = `${row},${col}`;
  if (new Set(["0,0", "0,7", "0,14", "7,0", "7,14", "14,0", "14,7", "14,14"]).has(key)) return "TW";
  if (new Set(["1,1", "2,2", "3,3", "4,4", "7,7", "10,10", "11,11", "12,12", "13,13", "13,1", "12,2", "11,3", "10,4", "4,10", "3,11", "2,12", "1,13"]).has(key)) return "DW";
  if (new Set(["1,5", "1,9", "5,1", "5,5", "5,9", "5,13", "9,1", "9,5", "9,9", "9,13", "13,5", "13,9"]).has(key)) return "TL";
  if (new Set(["0,3", "0,11", "2,6", "2,8", "3,0", "3,7", "3,14", "6,2", "6,6", "6,8", "6,12", "7,3", "7,11", "8,2", "8,6", "8,8", "8,12", "11,0", "11,7", "11,14", "12,6", "12,8", "14,3", "14,11"]).has(key)) return "DL";
  return null;
}

function scrabbleWord(board: (RecordValue | null)[], start: number, vertical: boolean): { indexes: number[]; word: string } {
  const delta = vertical ? 15 : 1;
  const inBounds = (index: number) => index >= 0 && index < 225 && (vertical || Math.floor(index / 15) === Math.floor(start / 15));
  let first = start;
  while (inBounds(first - delta) && board[first - delta]) first -= delta;
  const indexes: number[] = [];
  let cursor = first;
  while (inBounds(cursor) && board[cursor]) {
    indexes.push(cursor);
    cursor += delta;
  }
  return { indexes, word: indexes.map((index) => String(board[index]?.letter ?? "")).join("") };
}

function wordScore(board: (RecordValue | null)[], indexes: number[], fresh: Set<number>): number {
  let sum = 0, multiplier = 1;
  for (const index of indexes) {
    const tile = board[index]!;
    const points = Number(tile.points);
    if (!fresh.has(index)) {
      sum += points;
      continue;
    }
    const premium = premiumAt(index);
    sum += points * (premium === "DL" ? 2 : premium === "TL" ? 3 : 1);
    if (premium === "DW") multiplier *= 2;
    if (premium === "TW") multiplier *= 3;
  }
  return sum * multiplier;
}

function validateScrabble(current: unknown, proposed: unknown, seat: number, capacity: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !Array.isArray(current.board) || !Array.isArray(proposed.board) ||
      !Array.isArray(current.racks) || !Array.isArray(proposed.racks) || !Array.isArray(current.bag) ||
      !Array.isArray(proposed.bag) || !Array.isArray(current.scores) || !Array.isArray(proposed.scores) ||
      current.board.length !== 225 || proposed.board.length !== 225 ||
      current.playerCount !== capacity || proposed.playerCount !== capacity) return reject("Invalid Scrabble state.");
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Scrabble turn.");
  const nextTurn = nextPlayer(seat, capacity);
  const oldRacks = current.racks as string[][];
  const nextRacks = proposed.racks as string[][];
  const oldBoard = current.board as (RecordValue | null)[];
  const nextBoard = proposed.board as (RecordValue | null)[];
  const oldBag = current.bag as string[];
  const nextBag = proposed.bag as string[];
  const oldScores = current.scores as number[];
  const nextScores = proposed.scores as number[];
  if (oldRacks.length !== capacity || nextRacks.length !== capacity || oldScores.length !== capacity ||
      nextScores.length !== capacity || oldRacks.some((rack) => !Array.isArray(rack))) return reject("Invalid Scrabble racks.");

  const unchangedBoard = equal(oldBoard, nextBoard);
  const unchangedNonTurnRacks = oldRacks.every((rack, index) => index === seat || equal(rack, nextRacks[index]));
  const unchangedScores = equal(oldScores, nextScores);
  const winnerAfterPass = (passes: number, scores: number[]) => {
    if (passes < capacity * 2) return null;
    const finalScores = scores.map((score, player) =>
      score - (oldRacks[player] ?? []).reduce((sum, letter) => sum + (SCRABBLE_LETTER_POINTS[letter] ?? 0), 0));
    const high = Math.max(...finalScores);
    const leaders = finalScores.flatMap((score, player) => score === high ? [player] : []);
    return { scores: finalScores, winner: leaders.length === 1 ? leaders[0] : "draw" };
  };

  // Passing is a legal move only when the full board, racks, and bag remain unchanged.
  if (unchangedBoard && unchangedNonTurnRacks && equal(oldBag, nextBag) && unchangedScores &&
      equal(nextRacks[seat], oldRacks[seat]) && proposed.turn === nextTurn &&
      proposed.passes === (current.passes as number) + 1) {
    const finished = winnerAfterPass(proposed.passes as number, oldScores);
    const scores = finished?.scores ?? oldScores;
    const winner = finished?.winner ?? null;
    const expected = { ...current, turn: nextTurn, passes: proposed.passes, scores, winner };
    return equal(proposed, expected) ? accept(expected, nextTurn) : reject("That Scrabble pass is invalid.");
  }

  if (unchangedBoard) {
    const before = oldRacks[seat];
    const after = nextRacks[seat];
    if (!Array.isArray(before) || !Array.isArray(after) || oldBag.length < 7 ||
        after.length !== before.length || !unchangedNonTurnRacks || !unchangedScores ||
        proposed.turn !== nextTurn || proposed.passes !== 0) {
      return reject("That Scrabble exchange is not legal.");
    }
    let exchange: string[] | null = null;
    for (let count = 1; count <= Math.min(7, before.length); count += 1) {
      if (count > oldBag.length) break;
      for (let mask = 1; mask < (1 << before.length); mask += 1) {
        if (mask.toString(2).replaceAll("0", "").length !== count) continue;
        const kept = before.filter((_, index) => (mask & (1 << index)) === 0);
        const exchanged = before.filter((_, index) => (mask & (1 << index)) !== 0);
        if (equal(after, [...kept, ...oldBag.slice(0, count)]) &&
            sameMultiset(nextBag, [...oldBag.slice(count), ...exchanged])) {
          exchange = exchanged;
          break;
        }
      }
      if (exchange) break;
    }
    if (!exchange) return reject("That Scrabble exchange is invalid.");
    const expected = {
      ...current,
      racks: nextRacks,
      bag: shuffle([...oldBag.slice(exchange.length), ...exchange]),
      turn: nextTurn,
      passes: 0,
    };
    const proposedWithoutBag = { ...proposed, bag: expected.bag };
    return equal(proposedWithoutBag, expected) ? accept(expected, nextTurn) : reject("That Scrabble exchange is invalid.");
  }

  const fresh = nextBoard.flatMap((tile, index) => oldBoard[index] === null && tile !== null ? [index] : []);
  if (fresh.length < 1 || fresh.length > 7 || oldBoard.some((tile, index) => tile !== null && !equal(tile, nextBoard[index])) ||
      !unchangedNonTurnRacks ||
      proposed.turn !== nextTurn || proposed.passes !== 0) return reject("That Scrabble word placement is not legal.");
  const freshSet = new Set(fresh);
  const allFreshSameRow = fresh.every((index) => Math.floor(index / 15) === Math.floor(fresh[0] / 15));
  const allFreshSameCol = fresh.every((index) => index % 15 === fresh[0] % 15);
  if (!allFreshSameRow && !allFreshSameCol) return reject("Scrabble tiles must be placed in one line.");
  const rack = [...oldRacks[seat]];
  for (const index of fresh) {
    const tile = nextBoard[index];
    if (!isRecord(tile) || typeof tile.letter !== "string" || !/^[A-Z]$/.test(tile.letter) ||
        !Number.isInteger(tile.points)) return reject("Invalid Scrabble tile.");
    let rackIndex = rack.indexOf(tile.letter);
    if (rackIndex >= 0) {
      if (tile.points !== SCRABBLE_LETTER_POINTS[tile.letter]) return reject("Scrabble tile points were changed.");
    } else {
      rackIndex = rack.indexOf("?");
      if (rackIndex < 0 || tile.points !== 0) return reject("That tile is not in your Scrabble rack.");
    }
    rack.splice(rackIndex, 1);
  }
  const combinedBefore = [...oldBag, ...oldRacks[seat]];
  for (const index of fresh) {
    const letter = String(nextBoard[index]?.letter);
    const fromRackIndex = Number(nextBoard[index]?.points) === 0 ? -1 : combinedBefore.indexOf(letter);
    if (fromRackIndex >= 0) combinedBefore.splice(fromRackIndex, 1);
    else {
      const blankIndex = combinedBefore.indexOf("?");
      if (blankIndex < 0) return reject("That tile is not available.");
      combinedBefore.splice(blankIndex, 1);
    }
  }
  const drawCount = Math.min(7 - rack.length, oldBag.length);
  const expectedBag = oldBag.slice(drawCount);
  const expectedRack = [...rack, ...oldBag.slice(0, drawCount)];
  if (!equal(nextBag, expectedBag) || !equal(nextRacks[seat], expectedRack) ||
      !sameMultiset([...nextBag, ...nextRacks[seat]], combinedBefore)) {
    return reject("The Scrabble rack refill is invalid.");
  }

  const orientations = [
    ...(allFreshSameRow ? [false] : []),
    ...(allFreshSameCol ? [true] : []),
  ];
  const vertical = orientations.find((candidate) => {
    const word = scrabbleWord(nextBoard, fresh[0], candidate);
    return word.indexes.length >= 2 && fresh.every((index) => word.indexes.includes(index)) && SCRABBLE_WORDS.has(word.word);
  });
  if (vertical === undefined) return reject("That Scrabble word is not legal.");
  const main = scrabbleWord(nextBoard, fresh[0], vertical);
  const firstMove = oldBoard.every((tile) => tile === null);
  if (firstMove && !freshSet.has(112)) return reject("The first Scrabble word must cover the center.");
  if (!firstMove) {
    const touches = fresh.some((index) => [
      index - 15, index + 15, index - 1, index + 1,
    ].some((adjacent) => adjacent >= 0 && adjacent < 225 &&
      (Math.abs(Math.floor(adjacent / 15) - Math.floor(index / 15)) + Math.abs(adjacent % 15 - index % 15) === 1) &&
      oldBoard[adjacent] !== null));
    if (!touches) return reject("A Scrabble word must connect to the board.");
  }
  const formed = [main];
  for (const index of fresh) {
    const cross = scrabbleWord(nextBoard, index, !vertical);
    if (cross.indexes.length > 1) {
      if (!SCRABBLE_WORDS.has(cross.word)) return reject("A Scrabble cross-word is not legal.");
      formed.push(cross);
    }
  }
  let gained = formed.reduce((sum, word) => sum + wordScore(nextBoard, word.indexes, freshSet), 0);
  if (fresh.length === 7) gained += 50;
  const scores = [...oldScores];
  scores[seat] += gained;
  const finalRack = nextRacks[seat];
  const emptied = nextBag.length === 0 && finalRack.length === 0;
  let winner: number | string | null = null;
  if (emptied) {
    let opponentLeftover = 0;
    for (let player = 0; player < capacity; player += 1) {
      if (player === seat) continue;
      const leftover = oldRacks[player].reduce((sum, letter) => sum + (SCRABBLE_LETTER_POINTS[letter] ?? 0), 0);
      scores[player] -= leftover;
      opponentLeftover += leftover;
    }
    scores[seat] += opponentLeftover;
    const high = Math.max(...scores);
    const leaders = scores.flatMap((score, player) => score === high ? [player] : []);
    winner = leaders.length === 1 ? leaders[0] : "draw";
  }
  const expected = {
    ...current,
    board: nextBoard,
    racks: nextRacks,
    bag: nextBag,
    scores,
    turn: nextTurn,
    passes: 0,
    winner,
  };
  return equal(proposed, expected) ? accept(expected, nextTurn) : reject("The Scrabble score or state does not match that word.");
}

function barricadeTarget(position: number | null, roll: number, direction: number): number | null {
  if (position === null) return direction === 1 ? roll - 1 : null;
  const target = position + roll * direction;
  return target >= 0 && target < 63 ? target : null;
}

function barricadeCanMove(state: RecordValue, pawnIndex: number, direction: number, seat: number): boolean {
  const pawns = state.pawns as RecordValue[];
  const pawn = pawns[pawnIndex];
  const roll = state.roll;
  if (!pawn || pawn.player !== seat || !Number.isInteger(roll) || state.winner !== null) return false;
  const target = barricadeTarget(pawn.position as number | null, roll as number, direction);
  if (target === null) return false;
  const from = (pawn.position as number | null) ?? -1;
  const barriers = state.barriers as number[];
  for (let step = from + direction; direction > 0 ? step <= target : step >= target; step += direction) {
    if (barriers.includes(step) && step !== target) return false;
  }
  const blocker = pawns.find((other, index) => index !== pawnIndex && other.position === target);
  return blocker?.player !== seat;
}

function sameBarricadeCore(proposed: RecordValue, expected: RecordValue): boolean {
  return equal(
    { pawns: proposed.pawns, barriers: proposed.barriers, turn: proposed.turn, roll: proposed.roll, barrierMove: proposed.barrierMove, winner: proposed.winner },
    { pawns: expected.pawns, barriers: expected.barriers, turn: expected.turn, roll: expected.roll, barrierMove: expected.barrierMove, winner: expected.winner },
  );
}

function validateBarricade(current: unknown, proposed: unknown, seat: number): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed) || !Array.isArray(current.pawns) ||
      !Array.isArray(proposed.pawns) || !Array.isArray(current.barriers) || !Array.isArray(proposed.barriers) ||
      current.pawns.length !== 10) return reject("Invalid Barricade state.");
  if (current.turn !== seat || current.winner !== null) return reject("It is not your Barricade turn.");
  const common = {
    pawns: current.pawns,
    barriers: current.barriers,
    turn: current.turn,
    roll: current.roll,
    barrierMove: current.barrierMove,
    winner: current.winner,
  };
  if (current.roll === null && current.barrierMove === null && proposed.roll !== null &&
      Number.isInteger(proposed.roll) && (proposed.roll as number) >= 1 && (proposed.roll as number) <= 6 &&
      equal({ ...proposed, roll: null, message: current.message }, { ...common, message: current.message })) {
    const roll = randomInt(1, 7);
    const expected = { ...common, roll, message: `Player ${seat + 1} rolled ${roll}. Choose a pawn.` };
    return accept(expected, seat);
  }

  if (current.barrierMove && proposed.barrierMove === null && proposed.roll === null &&
      Array.isArray(proposed.barriers) && proposed.barriers.length === (current.barriers as number[]).length + 1 &&
      equal(proposed.pawns, current.pawns) && proposed.winner === null) {
    const pending = current.barrierMove as RecordValue;
    const oldBarrier = pending.oldBarrier;
    const barriers = proposed.barriers as number[];
    const added = barriers.filter((position) => !(current.barriers as number[]).includes(position));
    const removedOld = !(current.barriers as number[]).includes(oldBarrier as number);
    const target = added[0];
    const occupied = (current.pawns as RecordValue[]).some((pawn) => pawn.position === target);
    if (added.length === 1 && removedOld && Number.isInteger(target) && target >= 0 && target < 62 &&
        !occupied && !barriers.slice(0, -1).includes(target)) {
      const expected = {
        ...common,
        barriers: [...current.barriers as number[], target],
        turn: nextPlayer(seat, 2),
        roll: null,
        barrierMove: null,
        winner: null,
        message: "Barricade placed. Next player, roll the die.",
      };
      if (sameBarricadeCore(proposed, expected)) return accept(expected, expected.turn as number);
    }
    return reject("That Barricade placement is not legal.");
  }

  if (Number.isInteger(current.roll) && (current.roll as number) >= 1 && current.barrierMove === null) {
    const canMoveAny = (current.pawns as RecordValue[]).some((pawn, index) =>
      pawn.player === seat && (barricadeCanMove(current, index, 1, seat) || barricadeCanMove(current, index, -1, seat)));
    if (!canMoveAny && proposed.roll === null && proposed.turn === nextPlayer(seat, 2) &&
        equal(proposed.pawns, current.pawns) && equal(proposed.barriers, current.barriers) &&
        proposed.barrierMove === null && proposed.winner === null) {
      const expected = { ...common, turn: nextPlayer(seat, 2), roll: null, message: "No legal move. Turn passed." };
      if (sameBarricadeCore(proposed, expected)) return accept(expected, expected.turn as number);
    }

    const pawns = current.pawns as RecordValue[];
    for (let pawnIndex = 0; pawnIndex < pawns.length; pawnIndex += 1) {
      for (const direction of [1, -1]) {
        if (!barricadeCanMove(current, pawnIndex, direction, seat)) continue;
        const pawn = pawns[pawnIndex];
        const target = barricadeTarget(pawn.position as number | null, current.roll as number, direction)!;
        const barrierAtTarget = (current.barriers as number[]).includes(target);
        const nextPawns = pawns.map((entry) => ({ ...entry }));
        const captured = nextPawns.findIndex((other, index) =>
          index !== pawnIndex && other.position === target && other.player !== seat);
        if (captured >= 0) nextPawns[captured] = { ...nextPawns[captured], position: null };
        nextPawns[pawnIndex] = { ...pawn, position: target };
        const won = target === 62;
        const barriers = barrierAtTarget
          ? (current.barriers as number[]).filter((position) => position !== target)
          : [...current.barriers as number[]];
        const barrierMove = barrierAtTarget ? { pawnIndex, oldBarrier: target } : null;
        const turn = won || barrierAtTarget ? seat : nextPlayer(seat, 2);
        const message = won
          ? `Player ${seat + 1} reached the finish and wins!`
          : barrierAtTarget
            ? "Move the barricade to any empty track space."
            : captured >= 0 ? "You sent an opponent pawn back to base." : "Move complete. Next player, roll the die.";
        const expected = { pawns: nextPawns, barriers, turn, roll: null, barrierMove, winner: won ? seat : null, message };
        if (sameBarricadeCore(proposed, expected)) return accept(expected, turn);
      }
    }
  }
  return reject("That Barricade move is not legal.");
}

const BLOCK_DROP_SHAPES: Record<string, string[]> = {
  I: ["####"], O: ["##", "##"], T: [".#.", "###"], J: ["#..", "###"],
  L: ["..#", "###"], S: [".##", "##."], Z: ["##.", ".##"],
};
function blockShape(type: string, rotation: number): string[] {
  let cells = (BLOCK_DROP_SHAPES[type] ?? []).map((row) => row.split(""));
  for (let turn = 0; turn < rotation % 4; turn += 1) {
    const height = cells.length, width = cells[0]?.length ?? 0;
    cells = Array.from({ length: width }, (_, row) =>
      Array.from({ length: height }, (_, col) => cells[height - col - 1][row]));
  }
  return cells.map((row) => row.join(""));
}

function blockDropCollision(board: unknown[][], piece: RecordValue): boolean {
  if (!Array.isArray(board) || typeof piece.type !== "string" ||
      !Number.isInteger(piece.x) || !Number.isInteger(piece.y) || !Number.isInteger(piece.rotation)) return true;
  const shape = blockShape(piece.type, piece.rotation as number);
  for (let row = 0; row < shape.length; row += 1) {
    for (let col = 0; col < shape[row].length; col += 1) {
      if (shape[row][col] !== "#") continue;
      const y = (piece.y as number) + row, x = (piece.x as number) + col;
      if (x < 0 || x >= 10 || y >= 20 || (y >= 0 && board[y]?.[x] !== null)) return true;
    }
  }
  return false;
}

function blockDropTick(state: RecordValue): RecordValue {
  if (state.status !== "playing" || !isRecord(state.active)) return state;
  const candidate = { ...state.active, y: (state.active.y as number) + 1 };
  if (!blockDropCollision(state.board as unknown[][], candidate)) return { ...state, active: candidate };
  return lockBlockDrop(state);
}

function blockDropLock(state: RecordValue): RecordValue {
  const active = state.active as RecordValue | null;
  if (!active) return state;
  const board = (state.board as unknown[][]).map((row) => [...row]);
  const shape = blockShape(String(active.type), Number(active.rotation));
  for (let row = 0; row < shape.length; row += 1) {
    for (let col = 0; col < shape[row].length; col += 1) {
      if (shape[row][col] !== "#") continue;
      const y = Number(active.y) + row, x = Number(active.x) + col;
      if (y < 0) return { ...state, active: null, status: "gameover" };
      board[y][x] = active.type;
    }
  }
  const remaining = board.filter((row) => !row.every((cell) => cell !== null));
  const cleared = board.length - remaining.length;
  const nextBoard = [...Array.from({ length: cleared }, () => Array(10).fill(null)), ...remaining];
  const lines = Number(state.lines) + cleared;
  const level = Math.floor(lines / 10) + 1;
  const scoreByLines = [0, 100, 300, 500, 800][cleared] ?? cleared * 200;
  const nextSeed = (Math.imul(Number(state.randomSeed), 1664525) + 1013904223) >>> 0;
  const pieces = ["I", "O", "T", "J", "L", "S", "Z"];
  const nextType = pieces[Math.floor((Number(state.randomSeed) / 0x100000000) * pieces.length)];
  const newActive = {
    type: state.nextPiece,
    rotation: 0,
    x: Math.floor((10 - (state.nextPiece === "I" ? 4 : state.nextPiece === "O" ? 2 : 3)) / 2),
    y: 0,
  };
  const expected = {
    ...state,
    board: nextBoard,
    active: newActive,
    nextPiece: nextType,
    lines,
    level,
    score: Number(state.score) + scoreByLines * Number(state.level),
    randomSeed: nextSeed,
  };
  return blockDropCollision(nextBoard, newActive) ? { ...expected, active: null, status: "gameover" } : expected;
}

function lockBlockDrop(state: RecordValue): RecordValue {
  return blockDropLock(state);
}

function blockDropMove(state: RecordValue, dx: number, dy: number): RecordValue {
  if (state.status !== "playing" || !isRecord(state.active)) return state;
  const candidate = { ...state.active, x: Number(state.active.x) + dx, y: Number(state.active.y) + dy };
  return blockDropCollision(state.board as unknown[][], candidate) ? state : { ...state, active: candidate };
}

function blockDropRotate(state: RecordValue): RecordValue {
  if (state.status !== "playing" || !isRecord(state.active)) return state;
  const rotated: RecordValue = { ...state.active, rotation: (Number(state.active.rotation) + 1) % 4 };
  for (const kick of [0, -1, 1, -2, 2]) {
    const candidate = { ...rotated, x: Number(rotated.x) + kick };
    if (!blockDropCollision(state.board as unknown[][], candidate)) return { ...state, active: candidate };
  }
  return state;
}

function blockDropHardDrop(state: RecordValue): RecordValue {
  if (state.status !== "playing" || !isRecord(state.active)) return state;
  let active = state.active;
  while (!blockDropCollision(state.board as unknown[][], { ...active, y: Number(active.y) + 1 })) {
    active = { ...active, y: Number(active.y) + 1 };
  }
  return blockDropLock({ ...state, active });
}

function validateBlockDrop(current: unknown, proposed: unknown): ValidationResult {
  if (!isRecord(current) || !isRecord(proposed)) return reject("Invalid Block Drop state.");
  const moves = [
    blockDropMove(current, -1, 0),
    blockDropMove(current, 1, 0),
    blockDropTick(current),
    blockDropRotate(current),
    blockDropHardDrop(current),
    current.status === "gameover" ? current : { ...current, status: current.status === "paused" ? "playing" : "paused" },
  ];
  if (moves.some((candidate) => !equal(candidate, current) && equal(candidate, proposed))) return accept(proposed, 0);
  return reject("That Block Drop update is not a legal move.");
}

export function validateArcadeTransition(
  game: ArcadeGameId,
  current: unknown,
  proposed: unknown,
  seat: number,
  capacity: number,
  currentTurn: number,
  submittedTurn: unknown,
): ValidationResult {
  if (!Number.isInteger(seat) || seat < 0 || seat >= capacity) return reject("That room seat is invalid.");
  if (game === "block-drop") {
    if (!Array.isArray(current) || current.length !== capacity || submittedTurn !== currentTurn) {
      return reject("Invalid Block Drop update.");
    }
    const result = validateBlockDrop(current[seat], proposed);
    if (!result.ok) return result;
    const next = [...current];
    next[seat] = result.state;
    return accept(next, currentTurn);
  }

  if (seat !== currentTurn) return reject("Wait for your turn before sending a move.");
  let result: ValidationResult;
  switch (game) {
    case "mopyon": result = validateMopyon(current, proposed, seat); break;
    case "box": result = validateBox(current, proposed, seat); break;
    case "kay": result = validateKay(current, proposed, seat); break;
    case "chess": result = validateChess(current, proposed, seat); break;
    case "dame": result = validateDame(current, proposed, seat); break;
    case "scrabble": result = validateScrabble(current, proposed, seat, capacity); break;
    case "barricade": result = validateBarricade(current, proposed, seat); break;
    case "four-in-a-row": result = validateFour(current, proposed, seat); break;
    case "filler": result = validateFiller(current, proposed, seat, capacity); break;
  }
  if (!result.ok) return result;
  if (submittedTurn !== result.turn) return reject("The submitted turn does not match the legal move.");
  return result;
}
