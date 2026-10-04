// CHESS — climb a ladder of 20 CPU rivals.
// VG-Remix cartridge. One self-contained ES module: rules engine, time-sliced AI, pixel-art UI.
//
// File map:
//   1. Engine constants and move encoding
//   2. Position (board, make/unmake, move generation, attack tests, FEN, hashing)
//   3. Evaluation (piece-square tables + per-rival personality terms)
//   4. AI search (iterative deepening alpha-beta as a generator, time-sliced across frames)
//   5. Rules helpers (game result, SAN notation)
//   6. Levels / rivals data
//   7. Pixel art (piece sprites, tiny icons, portraits)
//   8. boot(): game state machine, update, draw, audio

// ============================================================================
// 1. ENGINE CONSTANTS
// ============================================================================
// Board is 0x88: square = rank * 16 + file (rank 0 = white's back rank). `sq & 0x88` != 0 means off-board.
const WHITE = 0, BLACK = 1;
const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
const pieceCode = (color, type) => (color << 3) | type; // white 1..6, black 9..14
const typeOf = (p) => p & 7;
const colorOf = (p) => p >> 3;
const fileOf = (sq) => sq & 7;
const rankOf = (sq) => sq >> 4;
const offBoard = (sq) => (sq & 0x88) !== 0;
const sqName = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);

// Move = from | to<<7 | promo<<14 | flags<<17 (a plain integer).
const F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
const makeMove = (from, to, promo = 0, flags = 0) => from | (to << 7) | (promo << 14) | (flags << 17);
const mFrom = (m) => m & 127;
const mTo = (m) => (m >> 7) & 127;
const mPromo = (m) => (m >> 14) & 7;
const mFlags = (m) => m >> 17;

const KNIGHT_STEPS = [33, 31, 18, 14, -14, -18, -31, -33];
const KING_STEPS = [17, 16, 15, 1, -1, -15, -16, -17];
const DIAGONALS = [17, 15, -15, -17];
const ORTHOGONALS = [16, 1, -1, -16];

// Castling rights bits and the mask applied when a piece leaves/arrives on a square.
const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[7] = 15 & ~CASTLE_WK;
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_MASK[119] = 15 & ~CASTLE_BK;
CASTLE_MASK[112] = 15 & ~CASTLE_BQ;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const VALUE = [0, 100, 320, 330, 500, 900, 0];

// Zobrist keys: two 32-bit halves so repetition/TT collisions are practically impossible.
const ZOBRIST = (() => {
  let s = 0x2545f491;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; };
  const fill = (n) => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = rnd(); return a; };
  return {
    pieceLo: fill(16 * 128), pieceHi: fill(16 * 128),
    castleLo: fill(16), castleHi: fill(16),
    epLo: fill(8), epHi: fill(8),
    sideLo: rnd(), sideHi: rnd(),
  };
})();

// ============================================================================
// 2. POSITION
// ============================================================================
class Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.side = WHITE;
    this.castle = 0;
    this.ep = -1;          // en-passant target square, only set when a capture is actually possible
    this.half = 0;         // half-move clock for the 50-move rule
    this.full = 1;
    this.kings = [0, 0];
    this.lo = 0; this.hi = 0;  // zobrist hash
    this.undo = [];        // flat stack: move, captured, castle, ep, half (5 ints per ply)
    this.keys = [];        // hash history: lo, hi of each earlier position (for repetitions)
    this.loadFen(fen);
  }

  clone() {
    const p = Object.create(Position.prototype);
    p.board = new Int8Array(this.board);
    p.side = this.side; p.castle = this.castle; p.ep = this.ep;
    p.half = this.half; p.full = this.full; p.kings = this.kings.slice();
    p.lo = this.lo; p.hi = this.hi;
    p.undo = []; p.keys = this.keys.slice();
    return p;
  }

  loadFen(fen) {
    const [placement, side, castle, ep, half, full] = fen.trim().split(/\s+/);
    this.board.fill(0);
    let rank = 7, file = 0;
    for (const ch of placement) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '8') { file += +ch; continue; }
      const type = ' pnbrqk'.indexOf(ch.toLowerCase());
      const color = ch === ch.toLowerCase() ? BLACK : WHITE;
      const sq = rank * 16 + file;
      this.board[sq] = pieceCode(color, type);
      if (type === KING) this.kings[color] = sq;
      file++;
    }
    this.side = side === 'b' ? BLACK : WHITE;
    this.castle = 0;
    if (castle && castle !== '-') {
      if (castle.includes('K')) this.castle |= CASTLE_WK;
      if (castle.includes('Q')) this.castle |= CASTLE_WQ;
      if (castle.includes('k')) this.castle |= CASTLE_BK;
      if (castle.includes('q')) this.castle |= CASTLE_BQ;
    }
    this.ep = ep && ep !== '-' ? (ep.charCodeAt(1) - 49) * 16 + (ep.charCodeAt(0) - 97) : -1;
    this.half = +half || 0;
    this.full = +full || 1;
    this.undo = []; this.keys = [];
    this.computeHash();
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      const p = this.board[sq];
      if (!offBoard(sq) && p) { lo ^= ZOBRIST.pieceLo[p * 128 + sq]; hi ^= ZOBRIST.pieceHi[p * 128 + sq]; }
    }
    lo ^= ZOBRIST.castleLo[this.castle]; hi ^= ZOBRIST.castleHi[this.castle];
    if (this.ep >= 0) { lo ^= ZOBRIST.epLo[this.ep & 7]; hi ^= ZOBRIST.epHi[this.ep & 7]; }
    if (this.side === BLACK) { lo ^= ZOBRIST.sideLo; hi ^= ZOBRIST.sideHi; }
    this.lo = lo; this.hi = hi;
  }

  /** Is `sq` attacked by any piece of color `by`? */
  isAttacked(sq, by) {
    const b = this.board;
    if (by === WHITE) {
      if (!offBoard(sq - 15) && b[sq - 15] === 1) return true;
      if (!offBoard(sq - 17) && b[sq - 17] === 1) return true;
    } else {
      if (!offBoard(sq + 15) && b[sq + 15] === 9) return true;
      if (!offBoard(sq + 17) && b[sq + 17] === 9) return true;
    }
    const knight = pieceCode(by, KNIGHT), king = pieceCode(by, KING);
    for (let i = 0; i < 8; i++) {
      const t = sq + KNIGHT_STEPS[i];
      if (!offBoard(t) && b[t] === knight) return true;
      const k = sq + KING_STEPS[i];
      if (!offBoard(k) && b[k] === king) return true;
    }
    const bishop = pieceCode(by, BISHOP), rook = pieceCode(by, ROOK), queen = pieceCode(by, QUEEN);
    for (let i = 0; i < 4; i++) {
      let d = DIAGONALS[i], t = sq + d;
      while (!offBoard(t)) { const p = b[t]; if (p) { if (p === bishop || p === queen) return true; break; } t += d; }
      d = ORTHOGONALS[i]; t = sq + d;
      while (!offBoard(t)) { const p = b[t]; if (p) { if (p === rook || p === queen) return true; break; } t += d; }
    }
    return false;
  }

  inCheck(color = this.side) { return this.isAttacked(this.kings[color], color ^ 1); }

  /** Pseudo-legal moves into `list` (reused by the search to avoid garbage).
   *  noisyOnly = captures + queen promotions (for quiescence search). */
  genMoves(noisyOnly = false, list = []) {
    list.length = 0;
    const b = this.board, us = this.side, them = us ^ 1;
    const fwd = us === WHITE ? 16 : -16;
    const startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 7 : 0;
    const addPawnMove = (from, to, flags) => {
      if (rankOf(to) === lastRank) {
        list.push(makeMove(from, to, QUEEN, flags));
        if (!noisyOnly) {
          list.push(makeMove(from, to, KNIGHT, flags));
          list.push(makeMove(from, to, ROOK, flags));
          list.push(makeMove(from, to, BISHOP, flags));
        }
      } else if (!noisyOnly || flags) list.push(makeMove(from, to, 0, flags));
    };
    for (let sq = 0; sq < 120; sq++) {
      if (offBoard(sq)) { sq += 7; continue; }
      const p = b[sq];
      if (!p || colorOf(p) !== us) continue;
      const t = typeOf(p);
      if (t === PAWN) {
        const one = sq + fwd;
        if (!b[one]) {
          addPawnMove(sq, one, 0);
          if (!noisyOnly && rankOf(sq) === startRank && !b[one + fwd]) list.push(makeMove(sq, one + fwd, 0, F_DOUBLE));
        }
        for (let side = -1; side <= 1; side += 2) {
          const to = one + side;
          if (offBoard(to)) continue;
          const q = b[to];
          if (q && colorOf(q) === them) addPawnMove(sq, to, F_CAPTURE);
          else if (to === this.ep) list.push(makeMove(sq, to, 0, F_CAPTURE | F_EP));
        }
      } else if (t === KNIGHT || t === KING) {
        const steps = t === KNIGHT ? KNIGHT_STEPS : KING_STEPS;
        for (let i = 0; i < 8; i++) {
          const to = sq + steps[i];
          if (offBoard(to)) continue;
          const q = b[to];
          if (!q) { if (!noisyOnly) list.push(makeMove(sq, to)); }
          else if (colorOf(q) === them) list.push(makeMove(sq, to, 0, F_CAPTURE));
        }
      } else {
        const dirs = t === BISHOP ? DIAGONALS : t === ROOK ? ORTHOGONALS : KING_STEPS;
        for (const d of dirs) {
          let to = sq + d;
          while (!offBoard(to)) {
            const q = b[to];
            if (!q) { if (!noisyOnly) list.push(makeMove(sq, to)); }
            else { if (colorOf(q) === them) list.push(makeMove(sq, to, 0, F_CAPTURE)); break; }
            to += d;
          }
        }
      }
    }
    if (!noisyOnly) this.genCastles(list);
    return list;
  }

  genCastles(list) {
    const b = this.board, us = this.side, them = us ^ 1;
    const base = us === WHITE ? 0 : 112;
    const kingSide = us === WHITE ? CASTLE_WK : CASTLE_BK, queenSide = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
    if (!(this.castle & (kingSide | queenSide)) || b[base + 4] !== pieceCode(us, KING)) return;
    if (this.isAttacked(base + 4, them)) return;
    if ((this.castle & kingSide) && !b[base + 5] && !b[base + 6] && b[base + 7] === pieceCode(us, ROOK) &&
        !this.isAttacked(base + 5, them) && !this.isAttacked(base + 6, them))
      list.push(makeMove(base + 4, base + 6, 0, F_CASTLE));
    if ((this.castle & queenSide) && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === pieceCode(us, ROOK) &&
        !this.isAttacked(base + 3, them) && !this.isAttacked(base + 2, them))
      list.push(makeMove(base + 4, base + 2, 0, F_CASTLE));
  }

  /** Fully legal moves (pseudo-legal moves that don't leave our king in check). */
  legalMoves() {
    const out = [];
    for (const m of this.genMoves()) {
      this.make(m);
      if (!this.inCheck(this.side ^ 1)) out.push(m);
      this.unmake();
    }
    return out;
  }

  make(m) {
    const b = this.board, us = this.side, them = us ^ 1, Z = ZOBRIST;
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), flags = mFlags(m);
    const piece = b[from];
    let capSq = to, captured = b[to];
    if (flags & F_EP) { capSq = us === WHITE ? to - 16 : to + 16; captured = b[capSq]; }
    this.undo.push(m, captured, this.castle, this.ep, this.half);
    this.keys.push(this.lo, this.hi);

    let lo = this.lo ^ Z.castleLo[this.castle] ^ Z.sideLo;
    let hi = this.hi ^ Z.castleHi[this.castle] ^ Z.sideHi;
    if (this.ep >= 0) { lo ^= Z.epLo[this.ep & 7]; hi ^= Z.epHi[this.ep & 7]; }
    if (captured) { b[capSq] = 0; lo ^= Z.pieceLo[captured * 128 + capSq]; hi ^= Z.pieceHi[captured * 128 + capSq]; }
    const placed = promo ? pieceCode(us, promo) : piece;
    b[from] = 0; b[to] = placed;
    lo ^= Z.pieceLo[piece * 128 + from] ^ Z.pieceLo[placed * 128 + to];
    hi ^= Z.pieceHi[piece * 128 + from] ^ Z.pieceHi[placed * 128 + to];
    if (flags & F_CASTLE) {
      const rFrom = to > from ? to + 1 : to - 2, rTo = to > from ? to - 1 : to + 1;
      const rook = b[rFrom];
      b[rFrom] = 0; b[rTo] = rook;
      lo ^= Z.pieceLo[rook * 128 + rFrom] ^ Z.pieceLo[rook * 128 + rTo];
      hi ^= Z.pieceHi[rook * 128 + rFrom] ^ Z.pieceHi[rook * 128 + rTo];
    }
    if (typeOf(piece) === KING) this.kings[us] = to;
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = -1;
    if (flags & F_DOUBLE) {
      const enemyPawn = pieceCode(them, PAWN);
      if ((!offBoard(to - 1) && b[to - 1] === enemyPawn) || (!offBoard(to + 1) && b[to + 1] === enemyPawn)) {
        this.ep = (from + to) >> 1;
        lo ^= Z.epLo[this.ep & 7]; hi ^= Z.epHi[this.ep & 7];
      }
    }
    lo ^= Z.castleLo[this.castle]; hi ^= Z.castleHi[this.castle];
    this.half = captured || typeOf(piece) === PAWN ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.side = them;
    this.lo = lo; this.hi = hi;
  }

  unmake() {
    const u = this.undo, b = this.board;
    const half = u.pop(), ep = u.pop(), castle = u.pop(), captured = u.pop(), m = u.pop();
    this.hi = this.keys.pop(); this.lo = this.keys.pop();
    this.side ^= 1;
    const us = this.side;
    if (us === BLACK) this.full--;
    const from = mFrom(m), to = mTo(m), flags = mFlags(m);
    const piece = mPromo(m) ? pieceCode(us, PAWN) : b[to];
    b[from] = piece; b[to] = 0;
    if (flags & F_EP) b[us === WHITE ? to - 16 : to + 16] = captured;
    else b[to] = captured;
    if (flags & F_CASTLE) {
      const rFrom = to > from ? to + 1 : to - 2, rTo = to > from ? to - 1 : to + 1;
      b[rFrom] = b[rTo]; b[rTo] = 0;
    }
    if (typeOf(piece) === KING) this.kings[us] = from;
    this.castle = castle; this.ep = ep; this.half = half;
  }

  /** Has the current position occurred before since the last irreversible move? (search draw test) */
  isRepetition() {
    const k = this.keys, n = k.length;
    for (let i = n - 4, lim = n - 2 * this.half; i >= 0 && i >= lim; i -= 4)
      if (k[i] === this.lo && k[i + 1] === this.hi) return true;
    return false;
  }

  /** How many times the current position has appeared in the game (including now). */
  repetitionCount() {
    let c = 1;
    for (let i = this.keys.length - 2; i >= 0; i -= 2) if (this.keys[i] === this.lo && this.keys[i + 1] === this.hi) c++;
    return c;
  }
}

// ============================================================================
// 3. EVALUATION
// ============================================================================
// Piece-square tables from white's point of view, rank 8 first (classic "simplified evaluation").
const PST_SRC = {
  [PAWN]: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [KNIGHT]: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [BISHOP]: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [ROOK]: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [QUEEN]: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [KING]: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  kingEnd: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};
// Expand to 0x88-indexed tables per color: PST[color][type][sq]; index 7 = king endgame.
const PST = [WHITE, BLACK].map((color) => {
  const tables = [];
  for (let t = 1; t <= 7; t++) {
    const src = t === 7 ? PST_SRC.kingEnd : PST_SRC[t];
    const out = new Int16Array(128);
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++)
      out[r * 16 + f] = src[(color === WHITE ? 7 - r : r) * 8 + f];
    tables[t] = out;
  }
  return tables;
});
const PASSED_BONUS = [0, 5, 10, 20, 35, 60, 100, 0];
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const CENTER = (sq) => { const f = fileOf(sq), r = rankOf(sq); return f >= 2 && f <= 5 && r >= 2 && r <= 5; };
const chebyshev = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
const centerDistance = (sq) => Math.max(3 - Math.min(fileOf(sq), 7 - fileOf(sq)), 3 - Math.min(rankOf(sq), 7 - rankOf(sq)));

// Scratch arrays reused by evaluate() (avoids allocations in the hot path).
const pawnMaxRank = [new Int8Array(8), new Int8Array(8)];
const pawnMinRank = [new Int8Array(8), new Int8Array(8)];
const pawnCount = [new Int8Array(8), new Int8Array(8)];
const pawnList = new Int16Array(32);
const mg = new Int32Array(2), eg = new Int32Array(2), bishops = new Int32Array(2), material = new Int32Array(2);

/**
 * Static evaluation in centipawns from the side to move's point of view.
 * `ai` supplies the rival's personality (applied to the CPU's own pieces only) and eval noise.
 */
function evaluate(pos, ai) {
  const b = pos.board, style = ai.style, cpu = ai.cpu;
  mg.fill(0); eg.fill(0); bishops.fill(0); material.fill(0);
  let phase = 0, nPawns = 0;
  for (let c = 0; c < 2; c++) { pawnMaxRank[c].fill(-1); pawnMinRank[c].fill(8); pawnCount[c].fill(0); }

  for (let sq = 0; sq < 120; sq++) {
    if (offBoard(sq)) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const c = colorOf(p), t = typeOf(p);
    const isCpu = c === cpu;
    const value = isCpu ? style.values[t] : VALUE[t];
    material[c] += value;
    phase += PHASE_WEIGHT[t];
    if (t === KING) { mg[c] += PST[c][KING][sq]; eg[c] += PST[c][7][sq]; continue; }
    const pst = PST[c][t][sq];
    mg[c] += value + pst; eg[c] += value + pst;
    if (t === PAWN) {
      const f = fileOf(sq), r = rankOf(sq);
      pawnCount[c][f]++;
      if (r > pawnMaxRank[c][f]) pawnMaxRank[c][f] = r;
      if (r < pawnMinRank[c][f]) pawnMinRank[c][f] = r;
      pawnList[nPawns++] = sq;
      if (isCpu && style.pawnPush) mg[c] += (c === WHITE ? r - 1 : 6 - r) * style.pawnPush;
    } else if (t === BISHOP) bishops[c]++;
    if (isCpu) {
      if (style.aggro && t !== PAWN) mg[c] += (7 - chebyshev(sq, pos.kings[c ^ 1])) * style.aggro;
      if (style.center && CENTER(sq) && t !== ROOK) mg[c] += style.center;
    }
  }

  // Pawn structure: passed and doubled pawns.
  for (let i = 0; i < nPawns; i++) {
    const sq = pawnList[i], c = colorOf(b[sq]), f = fileOf(sq), r = rankOf(sq);
    let passed = true;
    for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
      if (c === WHITE ? pawnMaxRank[BLACK][ff] > r : pawnMinRank[WHITE][ff] < r) { passed = false; break; }
    }
    if (passed) {
      const rel = c === WHITE ? r : 7 - r;
      mg[c] += PASSED_BONUS[rel] >> 1; eg[c] += PASSED_BONUS[rel];
    }
  }
  for (let c = 0; c < 2; c++) {
    for (let f = 0; f < 8; f++) if (pawnCount[c][f] > 1) { mg[c] -= 10; eg[c] -= 15; }
    if (bishops[c] >= 2) { mg[c] += 30; eg[c] += 40; }
  }

  // Personality: rook files and king shelter for the CPU.
  if (style.rookOpen || style.shield) {
    const k = pos.kings[cpu], fwd = cpu === WHITE ? 16 : -16;
    for (let sq = 0; sq < 120; sq++) {
      if (offBoard(sq)) { sq += 7; continue; }
      if (style.rookOpen && b[sq] === pieceCode(cpu, ROOK) && !pawnCount[cpu][fileOf(sq)]) mg[cpu] += style.rookOpen;
    }
    if (style.shield) for (let d = fwd - 1; d <= fwd + 1; d++) {
      if (!offBoard(k + d) && b[k + d] === pieceCode(cpu, PAWN)) mg[cpu] += style.shield;
      else if (!offBoard(k + d + fwd) && b[k + d + fwd] === pieceCode(cpu, PAWN)) mg[cpu] += style.shield >> 1;
    }
  }

  // Mop-up: when far ahead in the endgame, drive the enemy king to the edge and walk ours closer.
  if (phase < 8) {
    const diff = material[WHITE] - material[BLACK];
    if (Math.abs(diff) >= 300) {
      const strong = diff > 0 ? WHITE : BLACK, weak = strong ^ 1;
      eg[strong] += centerDistance(pos.kings[weak]) * 15 + (7 - chebyshev(pos.kings[0], pos.kings[1])) * 8;
    }
  }

  if (phase > 24) phase = 24;
  let score = ((mg[WHITE] - mg[BLACK]) * phase + (eg[WHITE] - eg[BLACK]) * (24 - phase)) / 24;
  if (ai.noise) {
    // Deterministic per-position noise: weak rivals "misjudge" positions in a consistent way.
    const n = (((Math.imul(pos.lo ^ ai.salt, 0x9e3779b1) >>> 0) / 4294967296) * 2 - 1) * ai.noise;
    score += cpu === WHITE ? n : -n;
  }
  return (pos.side === WHITE ? score : -score) | 0;
}

// ============================================================================
// 4. AI SEARCH (time-sliced)
// ============================================================================
// The search is a generator: it `yield`s whenever its per-frame time slice is used up, and the game
// resumes it on the next update(). So even a deep search never blocks a frame for more than ~5ms.
const INF = 100000, MATE = 30000, MAX_PLY = 64;
const TT_BITS = 17, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
const SLICE_MS = 4;   // search time per frame; leaves headroom for drawing at 60 fps
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let TT = null;  // transposition table, allocated on first use
function ttReset() {
  if (!TT) TT = { key: new Int32Array(TT_SIZE), move: new Int32Array(TT_SIZE), score: new Int32Array(TT_SIZE),
    depth: new Int8Array(TT_SIZE), flag: new Uint8Array(TT_SIZE) };
  TT.flag.fill(0);
}

/** Create a search for the side to move in `pos` (which the search may mutate: pass a clone). */
function createSearch(pos, rival, cpuColor, frameCap) {
  const ai = {
    pos, cpu: cpuColor,
    style: { values: rival.values || VALUE, aggro: 0, center: 0, pawnPush: 0, rookOpen: 0, shield: 0, ...rival.style },
    maxDepth: rival.depth, qs: rival.qs || 0, noise: rival.noise || 0,
    salt: (Math.random() * 0x7fffffff) | 0,
    nodes: 0, nodeLimit: rival.nodes || 5000, nextCheck: 0, deadline: 0, stop: false,
    frames: 0, maxFrames: Math.min(rival.maxFrames || 240, frameCap || 9999),
    minFrames: rival.think || 30,
    best: 0, bestScore: 0, depthDone: 0, considering: 0, done: false,
    killers: new Int32Array(MAX_PLY * 2), history: new Int32Array(128 * 128),
    // One reusable move/score list per ply: the search allocates almost nothing (no GC hitches).
    moveBuf: Array.from({ length: MAX_PLY }, () => []), scoreBuf: Array.from({ length: MAX_PLY }, () => []),
  };
  ai.rootMoves = pos.legalMoves();
  if (rival.blunder && Math.random() < rival.blunder && ai.rootMoves.length) {
    // Weak rivals sometimes just play whatever catches their eye.
    ai.best = ai.rootMoves[(Math.random() * ai.rootMoves.length) | 0];
    ai.gen = null; ai.done = true;
  } else ai.gen = searchRoot(ai);
  return ai;
}

/** Advance a search by one time slice. Call once per update(). */
function stepSearch(ai) {
  if (ai.done) return;
  ai.frames++;
  if (ai.frames > ai.maxFrames) ai.stop = true;
  ai.deadline = now() + SLICE_MS;
  const r = ai.gen.next();
  if (r.done) ai.done = true;
}

function* searchRoot(ai) {
  const pos = ai.pos, moves = ai.rootMoves;
  if (moves.length === 0) return;
  ai.best = moves[0];
  if (moves.length === 1) return;
  orderMoves(pos, moves, 0, ai, 0);
  for (let depth = 1; depth <= ai.maxDepth; depth++) {
    let alpha = -INF, bestThis = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      ai.considering = m;
      pos.make(m);
      let score;
      if (i === 0) score = -(yield* negamax(ai, depth - 1, -INF, -alpha, 1));
      else {
        score = -(yield* negamax(ai, depth - 1, -alpha - 1, -alpha, 1));   // null-window probe
        if (score > alpha && !ai.stop) score = -(yield* negamax(ai, depth - 1, -INF, -alpha, 1));
      }
      pos.unmake();
      if (ai.stop) break;
      if (score > alpha) {
        alpha = score; bestThis = m;
        moves.splice(i, 1); moves.unshift(m);  // keep the best move first for the next iteration
      }
    }
    if (bestThis) { ai.best = bestThis; ai.bestScore = alpha; }
    if (ai.stop) break;
    ai.depthDone = depth;
    if (Math.abs(alpha) > MATE - 100) break;            // found a forced mate
    if (ai.nodes > ai.nodeLimit * 0.4) break;            // next iteration would blow the budget
  }
  ai.considering = 0;
}

function* negamax(ai, depth, alpha, beta, ply) {
  const pos = ai.pos;
  if (pos.half >= 100 || pos.isRepetition()) return 0;
  const inCheck = pos.inCheck();
  if (inCheck && ply < 30) depth++;                       // check extension
  if (depth <= 0) return ai.qs ? quiesce(ai, alpha, beta, 0, ply) : evaluate(pos, ai);

  ai.nodes++;
  if (ai.nodes >= ai.nextCheck) {
    ai.nextCheck = ai.nodes + 48;
    if (ai.nodes > ai.nodeLimit) ai.stop = true;
    else if (now() > ai.deadline) yield 0;               // out of time this frame: resume next frame
  }
  if (ai.stop) return 0;

  // Transposition table probe.
  const slot = pos.lo & TT_MASK;
  let ttMove = 0;
  if (TT.flag[slot] && TT.key[slot] === pos.hi) {
    ttMove = TT.move[slot];
    if (TT.depth[slot] >= depth) {
      let s = TT.score[slot];
      if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
      const f = TT.flag[slot];
      if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
    }
  }

  const moves = pos.genMoves(false, ai.moveBuf[ply]);
  const scores = orderMoves(pos, moves, ttMove, ai, ply, ai.scoreBuf[ply]);
  const alpha0 = alpha;
  let best = -INF, bestMove = 0, legal = 0;
  for (let i = 0; i < moves.length; i++) {
    // Selection sort: pick the best remaining move lazily (cutoffs often happen early).
    let bi = i;
    for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[bi]) bi = j;
    const m = moves[bi]; moves[bi] = moves[i]; moves[i] = m;
    const sc = scores[bi]; scores[bi] = scores[i]; scores[i] = sc;

    pos.make(m);
    if (pos.inCheck(pos.side ^ 1)) { pos.unmake(); continue; }
    legal++;
    const score = -(yield* negamax(ai, depth - 1, -beta, -alpha, ply + 1));
    pos.unmake();
    if (ai.stop) return 0;
    if (score > best) {
      best = score; bestMove = m;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          if (!(mFlags(m) & F_CAPTURE)) {
            if (ai.killers[ply * 2] !== m) { ai.killers[ply * 2 + 1] = ai.killers[ply * 2]; ai.killers[ply * 2] = m; }
            ai.history[mFrom(m) * 128 + mTo(m)] += depth * depth;
          }
          break;
        }
      }
    }
  }
  if (!legal) return inCheck ? -MATE + ply : 0;

  let stored = best;
  if (stored > MATE - 200) stored += ply; else if (stored < -MATE + 200) stored -= ply;
  TT.key[slot] = pos.hi; TT.move[slot] = bestMove; TT.score[slot] = stored; TT.depth[slot] = depth;
  TT.flag[slot] = best >= beta ? TT_LOWER : best > alpha0 ? TT_EXACT : TT_UPPER;
  return best;
}

/** Capture-only search so the CPU doesn't stop thinking in the middle of an exchange. */
function quiesce(ai, alpha, beta, qd, ply) {
  const pos = ai.pos;
  ai.nodes++;
  const stand = evaluate(pos, ai);
  if (stand >= beta) return stand;
  if (qd >= ai.qs || ply >= MAX_PLY - 1) return stand;
  if (stand > alpha) alpha = stand;
  const moves = pos.genMoves(true, ai.moveBuf[ply]);
  const scores = orderMoves(pos, moves, 0, ai, -1, ai.scoreBuf[ply]);
  for (let i = 0; i < moves.length; i++) {
    let bi = i;
    for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[bi]) bi = j;
    const m = moves[bi]; moves[bi] = moves[i]; moves[i] = m;
    const sc = scores[bi]; scores[bi] = scores[i]; scores[i] = sc;
    pos.make(m);
    if (pos.inCheck(pos.side ^ 1)) { pos.unmake(); continue; }
    const score = -quiesce(ai, -beta, -alpha, qd + 1, ply + 1);
    pos.unmake();
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Run one small search right away so the JIT has compiled the engine before the first real game. */
function warmUpEngine() {
  ttReset();
  const pos = new Position('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  const style = { aggro: 1, center: 1, pawnPush: 1, rookOpen: 1, shield: 1 };  // touch every eval path
  const ai = createSearch(pos, { depth: 5, nodes: 25000, qs: 8, noise: 5, style, maxFrames: 1000 }, WHITE);
  for (let i = 0; i < 1000 && !ai.done; i++) stepSearch(ai);
  ttReset();
}

/** Score moves for ordering: hash move, then captures (MVV-LVA), promotions, killers, history. */
function orderMoves(pos, moves, ttMove, ai, ply, scores = []) {
  const b = pos.board;
  scores.length = moves.length;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    let s;
    if (m === ttMove) s = 1000000;
    else if (mFlags(m) & F_CAPTURE) {
      const victim = mFlags(m) & F_EP ? PAWN : typeOf(b[mTo(m)]);
      s = 100000 + VALUE[victim] * 10 - typeOf(b[mFrom(m)]);
    } else if (mPromo(m)) s = 90000 + mPromo(m);
    else if (ply >= 0 && m === ai.killers[ply * 2]) s = 80000;
    else if (ply >= 0 && m === ai.killers[ply * 2 + 1]) s = 79000;
    else s = ai.history[mFrom(m) * 128 + mTo(m)];
    scores[i] = s;
  }
  if (ply === 0) { // root: sort the array itself
    const idx = [...moves.keys()].sort((a, c) => scores[c] - scores[a]);
    const copy = moves.slice();
    idx.forEach((k, i) => { moves[i] = copy[k]; });
  }
  return scores;
}

// ============================================================================
// 5. RULES HELPERS
// ============================================================================
function insufficientMaterial(pos) {
  const minors = [];
  for (let sq = 0; sq < 120; sq++) {
    if (offBoard(sq)) { sq += 7; continue; }
    const t = typeOf(pos.board[sq]);
    if (!t || t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors.push({ t, shade: (fileOf(sq) + rankOf(sq)) & 1 });
  }
  if (minors.length <= 1) return true;
  return minors.every((m) => m.t === BISHOP && m.shade === minors[0].shade);
}

/** Returns null if the game goes on, else { winner: WHITE|BLACK|null, reason }. */
function gameResult(pos, legal) {
  if (legal.length === 0)
    return pos.inCheck() ? { winner: pos.side ^ 1, reason: 'CHECKMATE' } : { winner: null, reason: 'STALEMATE' };
  if (pos.half >= 100) return { winner: null, reason: '50-MOVE RULE' };
  if (pos.repetitionCount() >= 3) return { winner: null, reason: 'REPETITION' };
  if (insufficientMaterial(pos)) return { winner: null, reason: 'NO MATING MATERIAL' };
  return null;
}

/** Standard algebraic notation, split for drawing: { icon (piece type or 0), text, promo, suffix }. */
function sanFor(pos, m, legal) {
  const from = mFrom(m), to = mTo(m), flags = mFlags(m), type = typeOf(pos.board[from]);
  let icon = 0, text, promo = mPromo(m);
  if (flags & F_CASTLE) text = to > from ? 'O-O' : 'O-O-O';
  else if (type === PAWN) text = (flags & F_CAPTURE ? 'abcdefgh'[fileOf(from)] + 'x' : '') + sqName(to) + (promo ? '=' : '');
  else {
    icon = type;
    const rivals = legal.filter((o) => o !== m && mTo(o) === to && typeOf(pos.board[mFrom(o)]) === type);
    let dis = '';
    if (rivals.length) {
      if (!rivals.some((o) => fileOf(mFrom(o)) === fileOf(from))) dis = 'abcdefgh'[fileOf(from)];
      else if (!rivals.some((o) => rankOf(mFrom(o)) === rankOf(from))) dis = String(rankOf(from) + 1);
      else dis = sqName(from);
    }
    text = dis + (flags & F_CAPTURE ? 'x' : '') + sqName(to);
  }
  pos.make(m);
  const check = pos.inCheck();
  const suffix = check ? (pos.legalMoves().length ? '+' : '#') : '';
  pos.unmake();
  return { icon, text, promo, suffix };
}

// ============================================================================
// 6. LEVELS — the ladder of rivals
// ============================================================================
// kind: 'match' (win to advance), 'puzzle' (mate in N or fail), 'blitz' (chess clocks).
// depth/nodes/qs/noise/blunder tune strength; style/values tune personality (applied to the CPU's pieces).
// short: name used in speech lines. look: procedural portrait. lines: things they say (intro quote, capture, lostPiece, check, win, lose).
const LEVELS = [
  { name: 'PIP THE PAGE', short: 'PIP', title: 'SQUIRE IN TRAINING', depth: 1, nodes: 2000, noise: 160, blunder: 0.3, think: 45,
    look: { skin: '#f2c49b', hair: '#e8b040', hairStyle: 1, hat: 0, eyes: 0, beard: 0, shirt: '#4a90d9', bg: '#24425e' },
    lines: { intro: 'IS THE HORSEY THE ONE THAT JUMPS?', capture: 'OOPS! WAS THAT YOURS?', lostPiece: 'HEY! I WAS USING THAT!',
      check: 'CHECK! I THINK?', win: 'I WON?! WAIT TILL I TELL MUM!', lose: 'GOOD GAME, SIR!' } },
  { name: 'SIR BLUNDERLY', short: 'BLUNDERLY', title: 'KNIGHT OF THE OOPS', depth: 2, nodes: 3000, noise: 90, blunder: 0.12, think: 45,
    look: { skin: '#e8b48a', hair: '#8a5a30', hairStyle: 0, hat: 2, eyes: 0, beard: 1, shirt: '#7a7a8a', bg: '#3a3a4a' },
    lines: { intro: 'HAVE AT THEE! ER... WHICH SIDE AM I?', capture: 'HUZZAH!', lostPiece: 'A MERE FLESH WOUND!',
      check: 'YIELD, KNAVE!', win: 'VICTORY! SOMEHOW!', lose: 'I SHALL SULK IN MY TOWER.' } },
  { name: 'GRANNY PAWNSWORTH', short: 'GRANNY', title: 'KNITS. PUSHES PAWNS.', depth: 2, nodes: 4000, noise: 50, think: 50,
    style: { pawnPush: 12 },
    look: { skin: '#f0c8a8', hair: '#d8d8e0', hairStyle: 2, hat: 0, eyes: 1, beard: 0, shirt: '#b04a7a', bg: '#4a2a3a' },
    lines: { intro: 'MY LITTLE PAWNS WILL MARCH, DEARIE.', capture: 'TEA AND CRUMPETS!', lostPiece: 'OH, FIDDLESTICKS.',
      check: 'MIND YOUR MANNERS, DEAR.', win: 'MORE COCOA, DEARIE?', lose: 'WHAT A CLEVER CHILD!' } },
  { name: 'THE SPHINX', short: 'SPHINX', title: 'RIDDLE: BACK RANK', kind: 'puzzle', mateIn: 2, depth: 4, nodes: 20000, qs: 4, think: 30,
    fen: '2r3k1/pb3ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1',
    look: { skin: '#d8a860', hair: '#3050a0', hairStyle: 3, hat: 0, eyes: 0, beard: 0, shirt: '#c09030', bg: '#3a3010' },
    lines: { intro: 'MATE ME IN TWO MOVES, OR BE DEVOURED.', capture: 'PREDICTABLE.', lostPiece: 'HMM.',
      check: 'RIDDLE ME THIS.', win: 'WRONG ANSWER, MORTAL.', lose: 'YOU MAY PASS.' } },
  { name: 'KNIGHTLEY', short: 'KNIGHTLEY', title: 'FOUR HORSES, NO BISHOPS', depth: 2, nodes: 6000, qs: 2, noise: 40, think: 45,
    fen: 'rnnqknnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', values: [0, 100, 350, 330, 500, 900, 0],
    look: { skin: '#e0b090', hair: '#202020', hairStyle: 1, hat: 0, eyes: 0, beard: 0, shirt: '#3a7a3a', bg: '#1e3a24' },
    lines: { intro: 'NEIGH! MY STABLE IS FULL TODAY.', capture: 'GALLOP AND CHOMP!', lostPiece: 'MY POOR PONY!',
      check: 'HOOVES AT YOUR DOOR!', win: 'BACK TO THE STABLES, LOSER.', lose: 'WHOA... WELL RIDDEN.' } },
  { name: 'QUEENLESS QUINN', short: 'QUINN', title: 'PLAYS WITHOUT A QUEEN', depth: 3, nodes: 9000, qs: 3, noise: 30, think: 40,
    fen: 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', style: { aggro: 3 },
    look: { skin: '#c88a60', hair: '#c03020', hairStyle: 2, hat: 0, eyes: 0, beard: 0, shirt: '#2a2a2a', bg: '#4a1a1a' },
    lines: { intro: 'WHO NEEDS A QUEEN? NOT ME.', capture: 'SEE? DON\'T NEED HER.', lostPiece: 'OK MAYBE I NEED HER.',
      check: 'HANDS UP, KING!', win: 'QUEENS ARE OVERRATED.', lose: 'SHE\'D HAVE HELPED, HUH.' } },
  { name: 'BISHOP BONNIE', short: 'BONNIE', title: 'FOUR BISHOPS, NO KNIGHTS', depth: 3, nodes: 10000, qs: 3, noise: 25, think: 40,
    fen: 'rbbqkbbr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', values: [0, 100, 300, 350, 500, 900, 0],
    look: { skin: '#f0c098', hair: '#f0f0f0', hairStyle: 0, hat: 3, eyes: 1, beard: 0, shirt: '#8a2a8a', bg: '#3a1a4a' },
    lines: { intro: 'BLESS YOUR HEART. ALL THE DIAGONALS!', capture: 'AMEN TO THAT.', lostPiece: 'GOODNESS GRACIOUS!',
      check: 'REPENT, KING!', win: 'GO IN PEACE, CHILD.', lose: 'THE LORD TESTS ME.' } },
  { name: 'THE SPHINX', short: 'SPHINX', title: 'RIDDLE: SMOTHERED', kind: 'puzzle', mateIn: 2, depth: 4, nodes: 20000, qs: 4, think: 30,
    fen: 'r6k/pp4pp/8/3Q2N1/2B5/8/5PPP/6K1 w - - 0 1',
    look: { skin: '#d8a860', hair: '#3050a0', hairStyle: 3, hat: 0, eyes: 0, beard: 0, shirt: '#c09030', bg: '#3a3010' },
    lines: { intro: 'A KING CAN DROWN IN HIS OWN CROWD.', capture: 'PREDICTABLE.', lostPiece: 'HMM.',
      check: 'RIDDLE ME THIS.', win: 'WRONG ANSWER, MORTAL.', lose: 'CLEVER. YOU MAY PASS.' } },
  { name: 'HUGO THE HORDE', short: 'HUGO', title: 'FOUR EXTRA PAWNS', depth: 3, nodes: 12000, qs: 3, noise: 20, think: 40,
    fen: 'rnbqkbnr/pppppppp/1pp2pp1/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', style: { pawnPush: 5 },
    look: { skin: '#d09870', hair: '#5a3010', hairStyle: 3, hat: 2, eyes: 0, beard: 1, shirt: '#8a5a20', bg: '#3a2410' },
    lines: { intro: 'MORE PAWNS! MORE! HUGO SMASH!', capture: 'HUGO TAKE!', lostPiece: 'HUGO HAVE MANY MORE.',
      check: 'HUGO KNOCK KNOCK!', win: 'HUGO HORDE WINS!', lose: 'HUGO... SAD.' } },
  { name: 'BROTHER FORTRESS', short: 'BROTHER', title: 'NEVER LEAVES HOME', depth: 3, nodes: 14000, qs: 4, noise: 15, think: 40,
    style: { shield: 25, aggro: -2 },
    look: { skin: '#e0b088', hair: '#5a4030', hairStyle: 0, hat: 4, eyes: 0, beard: 0, shirt: '#6a4a2a', bg: '#2a2418' },
    lines: { intro: 'MY WALLS ARE THICK. MY WILL, THICKER.', capture: 'A SMALL TITHE.', lostPiece: 'A STONE FALLS.',
      check: 'KNOCK, BROTHER.', win: 'THE WALLS HOLD.', lose: 'THE GATE IS BREACHED.' } },
  { name: 'DUCHESS DASH', short: 'DUCHESS', title: 'YOU PLAY BLACK', playerColor: BLACK, depth: 3, nodes: 16000, qs: 4, noise: 15, think: 40,
    style: { aggro: 6 },
    look: { skin: '#f4d0b0', hair: '#f0c030', hairStyle: 2, hat: 1, eyes: 0, beard: 0, shirt: '#d03050', bg: '#4a1028' },
    lines: { intro: 'WHITE MOVES FIRST, DARLING. ME.', capture: 'MINE NOW, DARLING.', lostPiece: 'HOW RUDE!',
      check: 'CURTSY, YOUR MAJESTY.', win: 'TA-TA, DARLING!', lose: 'WELL! I NEVER!' } },
  { name: 'FLASH FREDDY', short: 'FREDDY', title: 'BLITZ: 3 MINUTES', kind: 'blitz', clock: 180, depth: 3, nodes: 12000, qs: 4, noise: 12,
    think: 20, maxFrames: 90, style: { aggro: 3 },
    look: { skin: '#c88a60', hair: '#f06020', hairStyle: 3, hat: 0, eyes: 1, beard: 0, shirt: '#f0d020', bg: '#4a3a08' },
    lines: { intro: 'TICK TOCK! THINK FAST OR LOSE FASTER!', capture: 'ZOOM!', lostPiece: 'NO TIME TO CRY!',
      check: 'CHECK! HURRY HURRY!', win: 'TOO SLOW, SLOWPOKE!', lose: 'YOU\'RE QUICK, KID.' } },
  { name: 'ROOK ROCCO', short: 'ROCCO', title: 'OWNS THE OPEN FILES', depth: 4, nodes: 30000, qs: 5, noise: 10, think: 40,
    style: { rookOpen: 25 },
    look: { skin: '#d8a078', hair: '#303030', hairStyle: 1, hat: 0, eyes: 2, beard: 1, shirt: '#404858', bg: '#202838' },
    lines: { intro: 'NICE BOARD. SHAME IF A ROOK WAS ON IT.', capture: 'NOTHING PERSONAL.', lostPiece: 'YOU\'LL REGRET THAT.',
      check: 'WE NEED TO TALK.', win: 'FORGET ABOUT IT.', lose: 'RESPECT, KID.' } },
  { name: 'THE SPHINX', short: 'SPHINX', title: 'RIDDLE: BODEN\'S BITE', kind: 'puzzle', mateIn: 2, depth: 4, nodes: 20000, qs: 4, think: 30,
    fen: '2kr3r/pp1n1ppp/2n5/8/5B2/5Q2/PPP1BPPP/6K1 w - - 0 1',
    look: { skin: '#d8a860', hair: '#3050a0', hairStyle: 3, hat: 0, eyes: 0, beard: 0, shirt: '#c09030', bg: '#3a3010' },
    lines: { intro: 'TWO BISHOPS CROSS. A KING FALLS.', capture: 'PREDICTABLE.', lostPiece: 'HMM.',
      check: 'RIDDLE ME THIS.', win: 'WRONG ANSWER, MORTAL.', lose: 'YOU ARE WORTHY.' } },
  { name: 'COUNTESS GAMBIT', short: 'COUNTESS', title: 'SACRIFICES EVERYTHING', depth: 4, nodes: 40000, qs: 5, noise: 8, think: 40,
    style: { aggro: 10 }, values: [0, 85, 300, 310, 480, 880, 0],
    look: { skin: '#e8e0e8', hair: '#101018', hairStyle: 2, hat: 0, eyes: 0, beard: 0, shirt: '#600818', bg: '#200810' },
    lines: { intro: 'MATERIAL IS FOR THE TIMID.', capture: 'DELICIOUS.', lostPiece: 'A GIFT. ENJOY IT.',
      check: 'YOUR KING SMELLS LOVELY.', win: 'BEAUTY OVER BEANS.', lose: 'HOW... PRACTICAL.' } },
  { name: 'PROFESSOR TEMPO', short: 'PROFESSOR', title: 'CONTROLS THE CENTER', depth: 4, nodes: 55000, qs: 6, noise: 6, think: 40,
    style: { center: 12, shield: 10 },
    look: { skin: '#f0c8a0', hair: '#a0a0a0', hairStyle: 0, hat: 0, eyes: 1, beard: 1, shirt: '#5a6a3a', bg: '#28301a' },
    lines: { intro: 'THE CENTER, MY DEAR, IS EVERYTHING.', capture: 'AS THE TEXTBOOK SAYS.', lostPiece: 'A PEDAGOGICAL SACRIFICE.',
      check: 'CHAPTER SEVEN: CHECK.', win: 'SEE ME AFTER CLASS.', lose: 'TOP MARKS, STUDENT.' } },
  { name: 'LIGHTNING LENA', short: 'LENA', title: 'BLITZ: 2 MINUTES', kind: 'blitz', clock: 120, depth: 4, nodes: 30000, qs: 6, noise: 5,
    think: 20, maxFrames: 100, style: { aggro: 4 },
    look: { skin: '#b07850', hair: '#f8f8ff', hairStyle: 3, hat: 0, eyes: 0, beard: 0, shirt: '#3050f0', bg: '#101848' },
    lines: { intro: 'BLINK AND YOU LOSE.', capture: 'ZAP!', lostPiece: 'STATIC SHOCK.',
      check: 'THUNDER CHECK!', win: 'STRUCK DOWN!', lose: 'YOU OUTRAN LIGHTNING?!' } },
  { name: 'IRON BARON', short: 'BARON', title: 'COLD. CALCULATING.', depth: 5, nodes: 140000, qs: 8, noise: 4, think: 40, maxFrames: 360,
    style: { shield: 15 },
    look: { skin: '#c8c0b8', hair: '#606060', hairStyle: 0, hat: 2, eyes: 2, beard: 1, shirt: '#404040', bg: '#181818' },
    lines: { intro: 'I HAVE CALCULATED YOUR DEFEAT.', capture: 'ACCEPTABLE LOSSES. YOURS.', lostPiece: 'WITHIN TOLERANCE.',
      check: 'CHECK. INEVITABLE.', win: 'AS COMPUTED.', lose: 'ERROR. ERROR.' } },
  { name: 'THE ORACLE', short: 'ORACLE', title: 'SEES ALL. YOU PLAY BLACK', playerColor: BLACK, depth: 5, nodes: 220000, qs: 8, noise: 3,
    think: 40, maxFrames: 420, style: { center: 6 },
    look: { skin: '#a0d0e0', hair: '#e0f0ff', hairStyle: 2, hat: 3, eyes: 0, beard: 1, shirt: '#203a6a', bg: '#0a1a3a' },
    lines: { intro: 'I HAVE SEEN HOW THIS ENDS.', capture: 'FORETOLD.', lostPiece: 'THE MISTS... DECEIVE.',
      check: 'YOUR FATE TIGHTENS.', win: 'IT WAS WRITTEN.', lose: 'A FUTURE I DID NOT SEE.' } },
  { name: 'GM KASIMIR', short: 'KASIMIR', title: 'GRANDMASTER. FINAL BOUT', depth: 6, nodes: 400000, qs: 10, noise: 2, think: 40,
    maxFrames: 540, style: { center: 4, shield: 10 },
    look: { skin: '#e8c0a0', hair: '#202020', hairStyle: 1, hat: 1, eyes: 0, beard: 1, shirt: '#101010', bg: '#3a2a08' },
    lines: { intro: 'SO. THE LADDER ENDS WITH ME.', capture: 'OF COURSE.', lostPiece: 'INTERESTING.',
      check: 'CHECK.', win: 'STUDY HARDER, YOUNGSTER.', lose: 'BRAVO. THE CROWN IS YOURS.' } },
];

// ============================================================================
// 7. PIXEL ART
// ============================================================================
// Piece sprites, 16x18. '#' outline, 'o' body, '+' highlight, '-' shade, '.' clear.
const SPRITES = {
  [PAWN]: [
    '................',
    '................',
    '................',
    '......####......',
    '.....#+ooo#.....',
    '....#+oooo-#....',
    '....#ooooo-#....',
    '.....#ooo-#.....',
    '....##oooo##....',
    '....#+oooo-#....',
    '.....#+oo-#.....',
    '.....#+oo-#.....',
    '....#+oooo-#....',
    '...#+oooooo-#...',
    '..#+oooooooo-#..',
    '..#oooooooooo#..',
    '..############..',
    '................'],
  [KNIGHT]: [
    '................',
    '.......#.##.....',
    '......#+#oo#....',
    '.....#+ooooo#...',
    '....#+oo#oooo#..',
    '...#+ooooooooo#.',
    '..#+oooooooooo-#',
    '..#oo#+ooooooo-#',
    '...##.#+ooooo-#.',
    '.....#+oooooo-#.',
    '....#+oooooo-#..',
    '....#+ooooooo-#.',
    '...#+ooooooo-#..',
    '..#+ooooooooo-#.',
    '.#+oooooooooo-#.',
    '.#oooooooooooo#.',
    '.##############.',
    '................'],
  [BISHOP]: [
    '.......##.......',
    '......#++#......',
    '.......##.......',
    '......#+o#......',
    '.....#+oo-#.....',
    '....#+oo#o-#....',
    '....#+o#oo-#....',
    '....#+oooo-#....',
    '.....#+oo-#.....',
    '....########....',
    '.....#+oo-#.....',
    '.....#+oo-#.....',
    '....#+oooo-#....',
    '...#+oooooo-#...',
    '..#+oooooooo-#..',
    '..#oooooooooo#..',
    '..############..',
    '................'],
  [ROOK]: [
    '................',
    '................',
    '..###.####.###..',
    '..#+#.#oo#.#-#..',
    '..#+###oo###-#..',
    '..#+oooooooo-#..',
    '...##########...',
    '....#+oooo-#....',
    '....#+oooo-#....',
    '....#+oooo-#....',
    '....#+oooo-#....',
    '....#+oooo-#....',
    '...##########...',
    '..#+oooooooo-#..',
    '.#+oooooooooo-#.',
    '.#oooooooooooo#.',
    '.##############.',
    '................'],
  [QUEEN]: [
    '.......##.......',
    '.##...#++#...##.',
    '#++#...##...#++#',
    '.##..#.##.#..##.',
    '.#+#.#+##-#.#-#.',
    '.#+o#+oooo-#o-#.',
    '..#+ooooooooo#..',
    '..#+ooooooooo#..',
    '...#+oooooo-#...',
    '...##########...',
    '....#+oooo-#....',
    '....#+oooo-#....',
    '...#+oooooo-#...',
    '..#+oooooooo-#..',
    '.#+oooooooooo-#.',
    '.#oooooooooooo#.',
    '.##############.',
    '................'],
  [KING]: [
    '.......##.......',
    '......#++#......',
    '.....##++##.....',
    '.....#++++#.....',
    '.....##++##.....',
    '..####.##.####..',
    '.#+ooo#oo#ooo-#.',
    '.#+oooo##oooo-#.',
    '.#+ooooooooo-#..',
    '..#+oooooooo-#..',
    '...##########...',
    '....#+oooo-#....',
    '....#+oooo-#....',
    '...#+oooooo-#...',
    '..#+oooooooo-#..',
    '.#+oooooooooo-#.',
    '.##############.',
    '................'],
};
const PIECE_COLORS = [
  { '#': '#2a1a10', o: '#f4ead2', '+': '#ffffff', '-': '#c8b088' },   // white pieces
  { '#': '#0a0605', o: '#3e3028', '+': '#76604e', '-': '#221812' },   // black pieces
];
// Tiny 5x6 icons for captured pieces and the move list.
const ICONS = {
  [PAWN]: ['.....', '..#..', '.###.', '..#..', '.###.', '#####'],
  [KNIGHT]: ['.##..', '####.', '#.##.', '..##.', '.###.', '#####'],
  [BISHOP]: ['..#..', '.#.#.', '.##.#', '.###.', '..#..', '#####'],
  [ROOK]: ['#.#.#', '#####', '.###.', '.###.', '.###.', '#####'],
  [QUEEN]: ['#.#.#', '#.#.#', '#####', '.###.', '.###.', '#####'],
  [KING]: ['..#..', '.###.', '..#..', '#####', '.###.', '#####'],
};
const ICON_COLORS = ['#f4ead2', '#5a4436'];
const HEART = ['.#.#.', '#####', '#####', '.###.', '..#..'];

// ============================================================================
// 8. BOOT — game state machine, update, draw, audio
// ============================================================================
export default function boot(api) {
  const { W, H } = api;

  // ---------- Layout & palette ----------
  const SQ = 26;              // board square size
  const BX = 9, BY = 12;      // board origin
  const PX = 222;             // side panel x
  const PANEL_BOTTOM = 237;
  const COL = {
    bg: '#16100c', panel: '#241a14', panelEdge: '#5d4037', light: '#ecd3a8', dark: '#a8774e',
    frame: '#3a2618', text: '#ffe0b2', dim: '#a08870', gold: '#ffd54f', red: '#ff5252', green: '#69f0ae',
    blue: '#64b5f6', last: 'rgba(255,214,79,0.42)', sel: 'rgba(100,200,255,0.55)', ghost: 'rgba(230,120,255,0.35)',
  };

  warmUpEngine();

  // ---------- Save data ----------
  let hiScore = api.storage.get('hiScore', 0);
  let bestLevel = Math.min(api.storage.get('bestLevel', 0), LEVELS.length - 1);

  // ---------- Pre-rendered art ----------
  const canCanvas = typeof OffscreenCanvas !== 'undefined';
  function bitmapCanvas(rows, palette, shadow) {
    if (!canCanvas) return null;
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    const c = new OffscreenCanvas(w + 1, h + 1);
    const g = c.getContext('2d');
    if (!g) return null;
    if (shadow) {
      g.fillStyle = shadow;
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') g.fillRect(x + 1, y + 1, 1, 1); }));
    }
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || !palette[ch]) return;
      g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1);
    }));
    return c;
  }
  const sprites = [0, 1].map((c) => {
    const out = [];
    for (let t = 1; t <= 6; t++) out[t] = bitmapCanvas(SPRITES[t], PIECE_COLORS[c], 'rgba(0,0,0,0.35)');
    return out;
  });
  const icons = [0, 1].map((c) => {
    const out = [];
    for (let t = 1; t <= 6; t++) out[t] = bitmapCanvas(ICONS[t], { '#': ICON_COLORS[c] }, c ? '#c8a888' : '#000');
    return out;
  });
  const heartFull = bitmapCanvas(HEART, { '#': COL.red }, '#000');
  const heartEmpty = bitmapCanvas(HEART, { '#': '#4a3028' }, null);

  function drawSprite(g, img, x, y) { if (img) g.drawImage(img, Math.round(x), Math.round(y)); }
  function drawPiece(g, piece, x, y) { drawSprite(g, sprites[colorOf(piece)][typeOf(piece)], x + 5, y + 4); }

  // ---------- Audio ----------
  const sfx = {
    cursor() { api.sound.tone(660, 0.02, { type: 'triangle', vol: 0.05 }); },
    select() { api.sound.tone(520, 0.05, { type: 'square', vol: 0.08 }); api.sound.tone(780, 0.05, { vol: 0.07, delay: 0.04 }); },
    cancel() { api.sound.tone(400, 0.06, { type: 'triangle', vol: 0.08, slide: 250 }); },
    deny() { api.sound.tone(140, 0.12, { type: 'sawtooth', vol: 0.08 }); },
    move() { api.sound.noise(0.04, { vol: 0.18, filter: 900 }); api.sound.tone(220, 0.05, { type: 'triangle', vol: 0.12 }); },
    capture() {
      api.sound.noise(0.12, { vol: 0.25, filter: 1600 });
      api.sound.tone(180, 0.12, { type: 'square', vol: 0.1, slide: 70 });
    },
    castle() { this.move(); api.sound.noise(0.04, { vol: 0.15, filter: 900, delay: 0.09 }); },
    check() {
      api.sound.tone(880, 0.08, { type: 'square', vol: 0.1 });
      api.sound.tone(1175, 0.12, { type: 'square', vol: 0.1, delay: 0.08 });
    },
    promote() { [523, 659, 784, 1047].forEach((f, i) => api.sound.tone(f, 0.07, { type: 'triangle', vol: 0.12, delay: i * 0.05 })); },
    think() { api.sound.tone(1400 + Math.random() * 400, 0.015, { type: 'sine', vol: 0.025 }); },
    tick() { api.sound.tone(1800, 0.015, { type: 'square', vol: 0.04 }); },
    pause() { api.sound.tone(440, 0.06, { vol: 0.08 }); api.sound.tone(330, 0.08, { vol: 0.08, delay: 0.06 }); },
    win() {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
        api.sound.tone(f, i === 6 ? 0.4 : 0.11, { type: 'square', vol: 0.11, delay: i * 0.11 }));
      [262, 330, 392, 523].forEach((f, i) => api.sound.tone(f, 0.2, { type: 'triangle', vol: 0.12, delay: i * 0.22 }));
    },
    lose() { [392, 370, 349, 262].forEach((f, i) => api.sound.tone(f, i === 3 ? 0.5 : 0.2, { type: 'sawtooth', vol: 0.09, delay: i * 0.22 })); },
    draw() { [440, 440, 349].forEach((f, i) => api.sound.tone(f, 0.15, { type: 'triangle', vol: 0.12, delay: i * 0.16 })); },
    fanfare() { [392, 523, 659, 784].forEach((f, i) => api.sound.tone(f, 0.12, { type: 'square', vol: 0.09, delay: i * 0.09 })); },
    victory() {
      const tune = [523, 523, 784, 784, 880, 880, 784, 0, 698, 698, 659, 659, 587, 587, 523];
      tune.forEach((f, i) => { if (f) api.sound.tone(f, 0.16, { type: 'square', vol: 0.1, delay: i * 0.18 }); });
      tune.forEach((f, i) => { if (f) api.sound.tone(f / 2, 0.16, { type: 'triangle', vol: 0.1, delay: i * 0.18 }); });
    },
  };

  // ---------- Global game state ----------
  let state = 'title';          // title | intro | playing | paused | levelClear | rematch | gameOver | victory
  let stateT = 0;               // frames since entering the state
  let levelIdx = 0;             // current rival (0-based)
  let selLevel = bestLevel;     // title-screen level select
  let score = 0, lives = 3;
  let match = null;             // current game, see newMatch()
  let pauseSel = 0;
  let clearInfo = null;         // score breakdown for level-clear screen
  const particles = [];
  let shake = 0, flash = 0, flashColor = COL.red;
  const held = { up: 0, down: 0, left: 0, right: 0 };

  function setState(s) { state = s; stateT = 0; }

  /** Persist the high score and the furthest rival unlocked. */
  function saveProgress(unlocked = levelIdx) {
    if (score > hiScore) { hiScore = score; api.storage.set('hiScore', hiScore); }
    if (unlocked > bestLevel) { bestLevel = unlocked; api.storage.set('bestLevel', bestLevel); }
  }

  /** Auto-repeating D-pad: true on press, then every 4 frames after a short hold. */
  function repeatPress(input, dir) {
    if (!input[dir]) { held[dir] = 0; return false; }
    held[dir]++;
    return held[dir] === 1 || (held[dir] > 14 && held[dir] % 4 === 0);
  }

  // ---------- Match setup ----------
  function newMatch() {
    const L = LEVELS[levelIdx];
    const pos = new Position(L.fen || START_FEN);
    const player = L.playerColor ?? WHITE;
    ttReset();
    match = {
      pos, player, cpu: player ^ 1, level: L,
      phase: 'start', t: 0,
      legal: pos.legalMoves(),
      cursor: { x: 4, y: 6 },          // screen cell (0..7)
      flip: player === BLACK,
      selected: -1, targets: [],
      lastMove: 0,
      history: [],                     // SAN entries in order
      startFull: pos.full, startSide: pos.side,
      captured: [[], []],              // captured[c] = pieces captured BY color c
      anim: null, ai: null, promo: null,
      clocks: L.kind === 'blitz' ? [L.clock * 60, L.clock * 60] : null,
      playerMoves: 0,
      result: null, endTimer: 0,
      say: { text: L.lines.intro, t: 240 },
      mood: 0,                         // rival's feeling: -1 losing, 0 neutral, 1 winning
    };
    match.cursor = match.flip ? { x: 3, y: 6 } : { x: 4, y: 6 };
  }

  function squareAt(cx, cy) {
    const M = match;
    return M.flip ? (cy) * 16 + (7 - cx) : (7 - cy) * 16 + cx;
  }
  function cellOf(sq) {
    const M = match;
    return M.flip ? { x: 7 - fileOf(sq), y: rankOf(sq) } : { x: fileOf(sq), y: 7 - rankOf(sq) };
  }
  const cellX = (cx) => BX + cx * SQ;
  const cellY = (cy) => BY + cy * SQ;

  function say(key, chance = 1) {
    const line = match.level.lines[key];
    if (line && Math.random() < chance) match.say = { text: line, t: 180 };
  }

  // ---------- Effects ----------
  function burst(sq, piece, n = 18) {
    const c = cellOf(sq), x = cellX(c.x) + SQ / 2, y = cellY(c.y) + SQ / 2;
    const pal = PIECE_COLORS[colorOf(piece)];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 2.2;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 30 + Math.random() * 25,
        color: [pal.o, pal['#'], pal['+']][i % 3], size: 2 });
    }
  }
  function confetti(n = 60) {
    const cols = [COL.gold, COL.red, COL.green, COL.blue, '#fff', '#ff80ab'];
    for (let i = 0; i < n; i++) particles.push({ x: Math.random() * W, y: -10 - Math.random() * 60,
      vx: (Math.random() - 0.5) * 1.5, vy: 0.5 + Math.random() * 1.5, life: 140 + Math.random() * 80,
      color: cols[i % cols.length], size: 2 + (i % 2), confetti: true });
  }
  function updateFx() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += p.confetti ? 0.01 : 0.12;
      if (p.confetti) p.vx += Math.sin((p.life + i) * 0.1) * 0.03;
      if (--p.life <= 0) particles.splice(i, 1);
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
    if (shake > 0) shake--;
    if (flash > 0) flash--;
  }

  // ---------- Playing a move (player or CPU) ----------
  function playMove(m) {
    const M = match, pos = M.pos;
    const san = sanFor(pos, m, M.legal);
    const mover = pos.side, from = mFrom(m), to = mTo(m), flags = mFlags(m);
    const capSq = flags & F_EP ? (mover === WHITE ? to - 16 : to + 16) : to;
    const captured = flags & F_CAPTURE ? pos.board[capSq] : 0;
    pos.make(m);
    M.history.push(san);
    M.lastMove = m;
    M.selected = -1; M.targets = [];
    M.legal = pos.legalMoves();
    const anims = [{ piece: pos.board[to], from, to }];
    if (flags & F_CASTLE) {
      const rFrom = to > from ? to + 1 : to - 2, rTo = to > from ? to - 1 : to + 1;
      anims.push({ piece: pos.board[rTo], from: rFrom, to: rTo });
    }
    M.anim = { list: anims, t: 0, dur: 9, captured, capSq };

    if (captured) {
      M.captured[mover].push(typeOf(captured));
      M.captured[mover].sort((a, b) => VALUE[b] - VALUE[a] || b - a);
      sfx.capture();
      say(mover === M.cpu ? 'capture' : 'lostPiece', typeOf(captured) >= KNIGHT ? 0.8 : 0.3);
    } else if (flags & F_CASTLE) sfx.castle();
    else sfx.move();
    if (mPromo(m)) sfx.promote();
    if (mover === M.player) M.playerMoves++;
    M.phase = 'anim';
  }

  function onMoveLanded() {
    const M = match, pos = M.pos, A = M.anim;
    if (A.captured) { burst(A.capSq, A.captured); shake = 6; }
    if (mPromo(M.lastMove)) burst(mTo(M.lastMove), pos.board[mTo(M.lastMove)], 24);
    M.anim = null;
    const res = gameResult(pos, M.legal);
    if (pos.inCheck() && (!res || res.reason !== 'CHECKMATE')) {
      sfx.check(); flash = 24; flashColor = COL.red;
      if (pos.side === M.player) say('check', 0.7);
    }
    if (res) {
      endMatch(res.winner === null ? 'draw' : res.winner === M.player ? 'win' : 'lose', res.reason);
      return;
    }
    if (M.level.kind === 'puzzle' && pos.side === M.cpu && M.playerMoves >= M.level.mateIn) {
      endMatch('lose', 'NOT MATE IN ' + M.level.mateIn);
      return;
    }
    beginTurn();
  }

  function beginTurn() {
    const M = match;
    if (M.pos.side === M.player) { M.phase = 'player'; return; }
    M.phase = 'cpu';
    let frameCap = 9999;
    if (M.clocks) frameCap = Math.max(10, Math.floor(M.clocks[M.cpu] / 25)); // never flag in blitz
    M.ai = createSearch(M.pos.clone(), M.level, M.cpu, frameCap);
  }

  function endMatch(outcome, reason) {
    const M = match;
    M.result = { outcome, reason };
    M.phase = 'ended'; M.endTimer = 150;
    M.ai = null;
    if (outcome === 'win') { sfx.win(); flash = 30; flashColor = COL.gold; confetti(40); say('lose'); M.mood = -1; }
    else if (outcome === 'lose') { sfx.lose(); flash = 30; flashColor = COL.red; shake = 14; say('win'); M.mood = 1; }
    else { sfx.draw(); }
  }

  function finishMatch() {
    const M = match, L = M.level, outcome = M.result.outcome;
    if (outcome === 'win') {
      const moves = M.pos.full - M.startFull;
      const parts = [['VICTORY', 500 + levelIdx * 100]];
      if (L.kind === 'puzzle') parts.push(['RIDDLE SOLVED', 600]);
      else parts.push(['QUICK MATE', Math.max(0, 60 - moves) * 10]);
      const matDiff = materialOf(M.pos, M.player) - materialOf(M.pos, M.cpu);
      if (matDiff > 0 && L.kind !== 'puzzle') parts.push(['MATERIAL', Math.min(1000, matDiff)]);
      if (M.clocks) parts.push(['TIME LEFT', Math.floor(M.clocks[M.player] / 60) * 5]);
      if (lives === 3) parts.push(['FLAWLESS', 250]);
      clearInfo = { parts, total: parts.reduce((s, p) => s + p[1], 0) };
      score += clearInfo.total;
      const last = levelIdx === LEVELS.length - 1;
      saveProgress(last ? levelIdx : levelIdx + 1);
      if (last) { setState('victory'); sfx.victory(); confetti(120); }
      else setState('levelClear');
    } else if (outcome === 'lose') {
      lives--;
      saveProgress();
      setState(lives > 0 ? 'rematch' : 'gameOver');
    } else setState('rematch');
  }

  function materialOf(pos, color) {
    let s = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (offBoard(sq)) { sq += 7; continue; }
      const p = pos.board[sq];
      if (p && colorOf(p) === color) s += VALUE[typeOf(p)];
    }
    return s;
  }

  // ---------- UPDATE ----------
  function update(input) {
    stateT++;
    updateFx();
    switch (state) {
      case 'title': updateTitle(input); break;
      case 'intro': updateIntro(input); break;
      case 'playing': updatePlaying(input); break;
      case 'paused': updatePaused(input); break;
      case 'levelClear': updateLevelClear(input); break;
      case 'rematch': updateRematch(input); break;
      case 'gameOver': if (stateT > 40 && (input.pressed.a || input.pressed.start)) setState('title'); break;
      case 'victory':
        if (stateT % 90 === 0) confetti(30);
        if (stateT > 90 && (input.pressed.a || input.pressed.start)) setState('title');
        break;
    }
  }

  function updateTitle(input) {
    if (repeatPress(input, 'left') && selLevel > 0) { selLevel--; sfx.cursor(); }
    if (repeatPress(input, 'right') && selLevel < bestLevel) { selLevel++; sfx.cursor(); }
    if (input.pressed.start || (input.pressed.a && stateT > 20)) {
      levelIdx = selLevel; score = 0; lives = 3;
      sfx.fanfare();
      setState('intro');
    }
  }

  function updateIntro(input) {
    if (stateT > 20 && (input.pressed.a || input.pressed.start)) {
      newMatch();
      setState('playing');
      sfx.select();
    }
    if (input.pressed.b && stateT > 10) setState('title');
  }

  function updatePlaying(input) {
    const M = match;
    if (input.pressed.start && M.phase !== 'ended') { setState('paused'); pauseSel = 0; sfx.pause(); return; }
    if (input.pressed.select) { M.flip = !M.flip; sfx.cursor(); }
    M.t++;
    if (M.say.t > 0) M.say.t--;

    // Chess clocks tick for whoever is on move.
    if (M.clocks && (M.phase === 'player' || M.phase === 'promo' || M.phase === 'cpu')) {
      const c = M.pos.side;
      M.clocks[c]--;
      if (c === M.player && M.clocks[c] < 600 && M.clocks[c] % 60 === 0) sfx.tick();
      if (M.clocks[c] <= 0) { M.clocks[c] = 0; endMatch(c === M.player ? 'lose' : 'win', 'TIME OUT'); return; }
    }

    switch (M.phase) {
      case 'start': if (M.t > 30) beginTurn(); break;
      case 'player': updatePlayerTurn(input); break;
      case 'promo': updatePromo(input); break;
      case 'anim':
        if (++M.anim.t >= M.anim.dur) onMoveLanded();
        break;
      case 'cpu': updateCpu(); break;
      case 'ended':
        M.endTimer--;
        if (M.endTimer <= 0 || (M.endTimer < 110 && (input.pressed.a || input.pressed.start))) finishMatch();
        break;
    }
  }

  function updatePlayerTurn(input) {
    const M = match, c = M.cursor;
    let moved = false;
    if (repeatPress(input, 'left') && c.x > 0) { c.x--; moved = true; }
    if (repeatPress(input, 'right') && c.x < 7) { c.x++; moved = true; }
    if (repeatPress(input, 'up') && c.y > 0) { c.y--; moved = true; }
    if (repeatPress(input, 'down') && c.y < 7) { c.y++; moved = true; }
    if (moved) sfx.cursor();

    if (input.pressed.b && M.selected >= 0) { M.selected = -1; M.targets = []; sfx.cancel(); return; }
    if (!input.pressed.a) return;

    const sq = squareAt(c.x, c.y), p = M.pos.board[sq];
    if (M.selected >= 0) {
      const options = M.legal.filter((m) => mFrom(m) === M.selected && mTo(m) === sq);
      if (options.length > 1) {  // promotion: open the picker
        M.promo = { options, index: 0 };
        M.phase = 'promo'; sfx.select();
        return;
      }
      if (options.length === 1) { playMove(options[0]); return; }
    }
    if (p && colorOf(p) === M.player) {
      if (sq === M.selected) { M.selected = -1; M.targets = []; sfx.cancel(); return; }
      const targets = M.legal.filter((m) => mFrom(m) === sq);
      if (targets.length) { M.selected = sq; M.targets = targets.map(mTo); sfx.select(); }
      else { sfx.deny(); shake = 3; }
    } else if (M.selected >= 0) { M.selected = -1; M.targets = []; sfx.cancel(); }
    else sfx.deny();
  }

  const PROMO_ORDER = [QUEEN, ROOK, BISHOP, KNIGHT];
  function updatePromo(input) {
    const M = match, P = M.promo;
    if (repeatPress(input, 'left')) { P.index = (P.index + 3) % 4; sfx.cursor(); }
    if (repeatPress(input, 'right')) { P.index = (P.index + 1) % 4; sfx.cursor(); }
    if (input.pressed.b) { M.promo = null; M.phase = 'player'; sfx.cancel(); return; }
    if (input.pressed.a) {
      const m = P.options.find((o) => mPromo(o) === PROMO_ORDER[P.index]);
      M.promo = null;
      playMove(m);
    }
  }

  function updateCpu() {
    const M = match, ai = M.ai;
    stepSearch(ai);
    if (!ai.done && ai.frames % 9 === 0) sfx.think();
    if (ai.done && ai.frames >= ai.minFrames) {
      const m = M.legal.includes(ai.best) ? ai.best : M.legal[0];
      // Mood from the CPU's own evaluation (shown on its portrait).
      M.mood = ai.bestScore > 150 ? 1 : ai.bestScore < -150 ? -1 : 0;
      M.ai = null;
      playMove(m);
    } else if (ai.done) ai.frames++;
  }

  function updatePaused(input) {
    if (repeatPress(input, 'up')) { pauseSel = (pauseSel + 2) % 3; sfx.cursor(); }
    if (repeatPress(input, 'down')) { pauseSel = (pauseSel + 1) % 3; sfx.cursor(); }
    if (input.pressed.start || input.pressed.b) { setState('playing'); sfx.pause(); return; }
    if (input.pressed.a) {
      if (pauseSel === 0) { setState('playing'); sfx.pause(); }
      else if (pauseSel === 1) { setState('playing'); endMatch('lose', 'RESIGNED'); }
      else { saveProgress(); setState('title'); }
    }
  }

  function updateLevelClear(input) {
    if (stateT > 50 && (input.pressed.a || input.pressed.start)) {
      levelIdx++;
      selLevel = Math.min(bestLevel, levelIdx);
      sfx.fanfare();
      setState('intro');
    }
  }

  function updateRematch(input) {
    if (stateT < 40) return;
    if (input.pressed.a || input.pressed.start) { setState('intro'); sfx.select(); }
    else if (input.pressed.b) { saveProgress(); setState('title'); }
  }

  // ---------- DRAW ----------
  function draw(g) {
    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    switch (state) {
      case 'title': drawTitle(g); break;
      case 'intro': drawIntro(g); break;
      case 'playing': case 'paused': drawPlaying(g); if (state === 'paused') drawPause(g); break;
      case 'levelClear': drawPlaying(g); drawLevelClear(g); break;
      case 'rematch': drawPlaying(g); drawRematch(g); break;
      case 'gameOver': drawGameOver(g); break;
      case 'victory': drawVictory(g); break;
    }
    drawParticles(g);
    if (flash > 0) {
      g.globalAlpha = Math.min(0.35, flash / 60);
      g.fillStyle = flashColor;
      g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3); g.fillRect(0, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
      g.globalAlpha = Math.min(0.15, flash / 120);
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  function drawParticles(g) {
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life / 20);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  function panelBox(g, x, y, w, h, fill = COL.panel) {
    g.fillStyle = COL.panelEdge; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = fill; g.fillRect(x, y, w, h);
  }

  function blink(period = 40) { return (api.frame % period) < period * 0.6; }

  // ----- Title -----
  function drawTitle(g) {
    // Scrolling checkerboard backdrop.
    const off = (api.frame * 0.25) % 32;
    for (let y = -32; y < H + 32; y += 16) for (let x = -32; x < W + 32; x += 16) {
      if (((x + y) / 16) & 1) continue;
      g.fillStyle = '#1f1611'; g.fillRect(x + off, y + off, 16, 16);
    }
    api.text('CHESS', W / 2, 26, { scale: 6, align: 'center', color: COL.gold, shadow: '#5d4037' });
    api.text('LADDER OF RIVALS', W / 2, 74, { scale: 1, align: 'center', color: COL.text });
    // Parade of bobbing pieces.
    const order = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
    order.forEach((t, i) => {
      const bob = Math.round(Math.sin(api.time * 3 + i * 0.7) * 3);
      drawSprite(g, sprites[i < 4 ? WHITE : BLACK][t], 40 + i * 30, 88 + bob);
    });
    // Level select.
    const L = LEVELS[selLevel];
    panelBox(g, 40, 118, 240, 46);
    drawPortrait(g, L.look, 44, 122, 2, 0, false);
    api.text(`RIVAL ${String(selLevel + 1).padStart(2, '0')}/${LEVELS.length}`, 80, 124, { color: COL.dim });
    api.text(L.name, 80, 134, { color: COL.gold });
    api.text(L.title, 80, 144, { color: COL.text });
    if (bestLevel > 0) {
      api.text(selLevel > 0 ? '<' : ' ', 30, 137, { color: COL.gold, scale: 1 });
      api.text(selLevel < bestLevel ? '>' : ' ', 286, 137, { color: COL.gold });
      api.text('LEFT/RIGHT: CHOOSE RIVAL', W / 2, 168, { align: 'center', color: COL.dim });
    }
    if (blink()) api.text('PRESS START', W / 2, 182, { scale: 2, align: 'center', color: '#fff', shadow: '#000' });
    api.text('D-PAD: CURSOR  J: PICK/PLACE  K: CANCEL', W / 2, 206, { align: 'center', color: COL.dim });
    api.text('CHECKMATE EVERY RIVAL TO CLIMB THE LADDER', W / 2, 216, { align: 'center', color: COL.dim });
    api.text(`HI SCORE ${hiScore}`, W / 2, 229, { align: 'center', color: COL.gold });
  }

  // ----- Rival intro card -----
  function drawIntro(g) {
    const L = LEVELS[levelIdx];
    g.fillStyle = L.look.bg; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 4) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y, W, 2); }
    const slide = Math.max(0, 40 - stateT * 3);
    api.text(`RIVAL ${levelIdx + 1} OF ${LEVELS.length}`, W / 2, 12, { align: 'center', color: COL.text, shadow: '#000' });
    panelBox(g, 24 - slide, 30, 92, 92, '#00000055');
    drawPortrait(g, L.look, 26 - slide, 32, 6, (stateT >> 5) % 3 === 0 ? 1 : 0, false);
    api.text(L.name, 128 + slide, 40, { scale: 2, color: COL.gold, shadow: '#000' });
    api.text(L.title, 128 + slide, 62, { color: '#fff', shadow: '#000' });
    const tags = [];
    if (L.kind === 'puzzle') tags.push(['PUZZLE: MATE IN ' + L.mateIn, COL.green]);
    if (L.kind === 'blitz') tags.push([`BLITZ: ${L.clock / 60} MIN EACH`, COL.red]);
    if ((L.playerColor ?? WHITE) === BLACK) tags.push(['YOU PLAY BLACK', COL.blue]);
    if (L.fen && L.kind !== 'puzzle') tags.push(['SPECIAL SETUP', COL.gold]);
    tags.forEach(([t, c], i) => api.text(t, 128 + slide, 78 + i * 10, { color: c, shadow: '#000' }));
    const stars = Math.min(5, 1 + Math.floor(levelIdx / 4));
    api.text('STRENGTH ' + '*'.repeat(stars) + '-'.repeat(5 - stars), 128 + slide, 110, { color: COL.gold, shadow: '#000' });
    // Speech bubble with the intro quote (typewriter effect).
    const q = L.lines.intro.slice(0, Math.floor(stateT / 1.5));
    panelBox(g, 16, 138, W - 32, 26, '#fff');
    g.fillStyle = '#fff'; g.fillRect(60, 132, 8, 6); g.fillRect(62, 130, 4, 2);
    api.text(q, W / 2, 147, { align: 'center', color: '#1a1a1a' });
    const lifeY = 180;
    api.text('LIVES', 120, lifeY, { color: COL.text, shadow: '#000' });
    for (let i = 0; i < 3; i++) drawSprite(g, i < lives ? heartFull : heartEmpty, 158 + i * 8, lifeY + 1);
    api.text(`SCORE ${score}`, W / 2, 194, { align: 'center', color: COL.text, shadow: '#000' });
    if (stateT > 20 && blink()) api.text('J: BEGIN   K: TITLE', W / 2, 216, { align: 'center', color: '#fff', shadow: '#000' });
  }

  // ----- Portrait: 15x15 grid of "pixels" drawn at scale s. mood: -1 sad, 0 neutral, 1 smug -----
  function drawPortrait(g, look, x, y, s, mood, thinking) {
    const px = (cx, cy, w, h, c) => { g.fillStyle = c; g.fillRect(x + cx * s, y + cy * s, w * s, h * s); };
    px(0, 0, 15, 15, look.bg);
    px(1, 13, 13, 2, look.shirt); px(2, 12, 11, 1, look.shirt);
    px(6, 11, 3, 1, look.skin);
    px(4, 3, 7, 8, look.skin); px(3, 5, 1, 3, look.skin); px(11, 5, 1, 3, look.skin); // head + ears
    const hc = look.hair;
    if (look.hairStyle === 0) { px(3, 3, 1, 2, hc); px(11, 3, 1, 2, hc); }
    else if (look.hairStyle === 1) { px(4, 2, 7, 2, hc); px(3, 3, 1, 2, hc); px(11, 3, 1, 2, hc); }
    else if (look.hairStyle === 2) { px(4, 2, 7, 2, hc); px(3, 3, 1, 8, hc); px(11, 3, 1, 8, hc); px(2, 6, 1, 5, hc); px(12, 6, 1, 5, hc); }
    else { px(4, 2, 7, 2, hc); px(4, 1, 1, 1, hc); px(6, 0, 1, 2, hc); px(8, 1, 1, 1, hc); px(10, 0, 1, 2, hc); }
    if (look.beard) { px(4, 9, 7, 2, hc); px(5, 11, 5, 1, hc); }
    // Eyes (look up while thinking, blink occasionally).
    const blinkNow = api.frame % 180 < 6;
    const ey = thinking ? 5 : 6, ex = thinking ? Math.round(Math.sin(api.time * 4)) : 0;
    if (blinkNow) { px(5, 6, 2, 1, '#2a1a10'); px(8, 6, 2, 1, '#2a1a10'); }
    else {
      px(5, 5, 2, 2, '#fff'); px(8, 5, 2, 2, '#fff');
      px(5 + (ex > 0 ? 1 : 0), ey, 1, 1, '#101010'); px(8 + (ex > 0 ? 1 : 0), ey, 1, 1, '#101010');
    }
    if (look.eyes === 1) { px(4, 5, 7, 1, '#202020'); px(4, 6, 1, 1, '#202020'); px(7, 6, 1, 1, '#202020'); px(10, 6, 1, 1, '#202020'); }
    if (look.eyes === 2) { px(7, 4, 4, 1, COL.gold); px(7, 7, 4, 1, COL.gold); px(10, 5, 1, 2, COL.gold); }
    // Mouth by mood.
    const mc = '#7a2a20';
    if (thinking) px(7, 9, 1, 1, mc);
    else if (mood > 0) { px(5, 8, 1, 1, mc); px(6, 9, 3, 1, mc); px(9, 8, 1, 1, mc); }
    else if (mood < 0) { px(5, 10, 1, 1, mc); px(6, 9, 3, 1, mc); px(9, 10, 1, 1, mc); px(11, 3, 1, 2, '#80d8ff'); }
    else px(6, 9, 3, 1, mc);
    // Hats.
    if (look.hat === 1) { px(4, 0, 7, 2, COL.gold); px(4, 0, 1, 1, look.bg); px(6, 0, 1, 1, look.bg); px(8, 0, 1, 1, look.bg); px(10, 0, 1, 1, look.bg); px(7, 1, 1, 1, COL.red); }
    if (look.hat === 2) { px(3, 1, 9, 3, '#9aa0a8'); px(4, 4, 7, 1, '#6a7078'); px(7, 0, 1, 1, '#c0c8d0'); }
    if (look.hat === 3) { px(5, 0, 5, 1, '#e8e0f8'); px(4, 1, 7, 2, '#e8e0f8'); px(7, 0, 1, 2, COL.gold); }
    if (look.hat === 4) { px(2, 1, 11, 3, '#4a3424'); px(2, 4, 2, 8, '#4a3424'); px(11, 4, 2, 8, '#4a3424'); }
  }

  // ----- Board + panel -----
  function drawPlaying(g) {
    const M = match;
    g.save();
    if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * shake * 0.6), Math.round((Math.random() - 0.5) * shake * 0.6));
    drawTopBar(g);
    drawBoard(g);
    drawPanel(g);
    if (M.phase === 'promo') drawPromo(g);
    if (M.phase === 'ended') drawResultBanner(g);
    g.restore();
  }

  function drawTopBar(g) {
    const L = match.level;
    api.text(`${String(levelIdx + 1).padStart(2, '0')} ${L.name}`, BX, 2, { color: COL.gold });
    for (let i = 0; i < 3; i++) drawSprite(g, i < lives ? heartFull : heartEmpty, PX + i * 7, 3);
    api.text(String(score).padStart(6, '0'), 318, 2, { align: 'right', color: COL.text });
  }

  function drawBoard(g) {
    const M = match, pos = M.pos;
    // Frame + coordinates.
    g.fillStyle = COL.frame; g.fillRect(BX - 3, BY - 3, SQ * 8 + 6, SQ * 8 + 6);
    g.fillStyle = '#6d4c33'; g.fillRect(BX - 1, BY - 1, SQ * 8 + 2, SQ * 8 + 2);
    for (let i = 0; i < 8; i++) {
      const sqF = squareAt(i, 7), sqR = squareAt(0, i);
      api.text('ABCDEFGH'[fileOf(sqF)], cellX(i) + SQ / 2, BY + SQ * 8 + 5, { align: 'center', color: COL.dim });
      api.text(String(rankOf(sqR) + 1), 1, cellY(i) + 10, { color: COL.dim });
    }
    const animTo = new Set(M.anim ? M.anim.list.map((a) => a.to) : []);
    const lmFrom = M.lastMove ? mFrom(M.lastMove) : -1, lmTo = M.lastMove ? mTo(M.lastMove) : -1;
    const checkSq = pos.inCheck() ? pos.kings[pos.side] : -1;
    const ghost = M.ai && M.ai.considering && (M.t >> 3) % 2 === 0 ? M.ai.considering : 0;
    const cursorSq = M.phase === 'player' ? squareAt(M.cursor.x, M.cursor.y) : -1;

    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
      const sq = squareAt(cx, cy), x = cellX(cx), y = cellY(cy);
      const light = (fileOf(sq) + rankOf(sq)) & 1;
      g.fillStyle = light ? COL.light : COL.dark;
      g.fillRect(x, y, SQ, SQ);
      if (sq === lmFrom || sq === lmTo) { g.fillStyle = COL.last; g.fillRect(x, y, SQ, SQ); }
      if (sq === M.selected) { g.fillStyle = COL.sel; g.fillRect(x, y, SQ, SQ); }
      if (ghost && (sq === mFrom(ghost) || sq === mTo(ghost))) { g.fillStyle = COL.ghost; g.fillRect(x, y, SQ, SQ); }
      if (sq === checkSq) {
        const pulse = 0.45 + 0.3 * Math.sin(api.time * 10);
        g.fillStyle = `rgba(255,40,40,${pulse.toFixed(2)})`; g.fillRect(x, y, SQ, SQ);
        g.fillStyle = 'rgba(255,40,40,0.35)'; g.fillRect(x + 3, y + 3, SQ - 6, SQ - 6);
      }
    }
    // Pieces.
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
      const sq = squareAt(cx, cy), p = pos.board[sq];
      if (!p || animTo.has(sq)) continue;
      let lift = 0;
      if (sq === M.selected) lift = 2 + Math.round(Math.sin(api.time * 8));
      drawPiece(g, p, cellX(cx), cellY(cy) - lift);
    }
    // Legal targets: dots for quiet moves, corner marks for captures.
    if (M.selected >= 0) for (const to of M.targets) {
      const c = cellOf(to), x = cellX(c.x), y = cellY(c.y);
      if (pos.board[to] || to === pos.ep) {
        g.fillStyle = 'rgba(200,30,30,0.75)';
        for (const [ox, oy] of [[0, 0], [SQ - 6, 0], [0, SQ - 6], [SQ - 6, SQ - 6]]) {
          g.fillRect(x + ox + (ox ? 3 : 0), y + oy, 3, 6); g.fillRect(x + ox, y + oy + (oy ? 3 : 0), 6, 3);
        }
      } else {
        g.fillStyle = 'rgba(30,60,30,0.55)'; g.fillRect(x + 10, y + 10, 6, 6);
        g.fillStyle = 'rgba(105,240,174,0.7)'; g.fillRect(x + 11, y + 11, 4, 4);
      }
    }
    // Moving piece(s).
    if (M.anim) {
      const k = M.anim.t / M.anim.dur, e = k * k * (3 - 2 * k);
      for (const a of M.anim.list) {
        const f = cellOf(a.from), t = cellOf(a.to);
        const x = cellX(f.x) + (cellX(t.x) - cellX(f.x)) * e, y = cellY(f.y) + (cellY(t.y) - cellY(f.y)) * e - Math.sin(k * Math.PI) * 6;
        drawPiece(g, a.piece, x, y);
      }
    }
    // Cursor brackets.
    if (cursorSq >= 0) {
      const x = cellX(M.cursor.x), y = cellY(M.cursor.y), o = (api.frame >> 4) % 2;
      const onTarget = M.targets.includes(cursorSq);
      g.fillStyle = onTarget ? COL.green : M.selected >= 0 ? COL.blue : COL.gold;
      const L = 7, a = -1 - o, b = SQ + 1 + o;
      g.fillRect(x + a, y + a, L, 2); g.fillRect(x + a, y + a, 2, L);
      g.fillRect(x + b - L, y + a, L, 2); g.fillRect(x + b - 2, y + a, 2, L);
      g.fillRect(x + a, y + b - 2, L, 2); g.fillRect(x + a, y + b - L, 2, L);
      g.fillRect(x + b - L, y + b - 2, L, 2); g.fillRect(x + b - 2, y + b - L, 2, L);
    }
  }

  function drawPanel(g) {
    const M = match, L = M.level, ai = M.ai;
    const x = PX, w = W - PX - 2;
    panelBox(g, x, 12, w, PANEL_BOTTOM - 12);
    // Portrait + status.
    const thinking = M.phase === 'cpu';
    drawPortrait(g, L.look, x + 2, 14, 2, M.mood, thinking);
    let status, sc = COL.text;
    if (M.phase === 'ended') {
      const o = M.result.outcome;
      status = o === 'win' ? 'YOU WIN!' : o === 'lose' ? 'YOU LOSE' : 'DRAW';
      sc = o === 'win' ? COL.gold : o === 'lose' ? COL.red : COL.blue;
    } else if (thinking) {
      status = 'THINKING' ; sc = COL.blue;
    } else if (M.phase === 'player' || M.phase === 'promo') {
      status = M.pos.inCheck() ? 'CHECK!' : 'YOUR MOVE';
      sc = M.pos.inCheck() ? (blink(16) ? COL.red : '#fff') : COL.green;
    } else status = M.pos.side === M.player ? 'YOUR MOVE' : 'WAIT...';
    api.text(status, x + 35, 16, { color: sc });
    if (thinking) {
      const dots = '.'.repeat(1 + ((M.t >> 3) % 3));
      api.text(dots, x + 35, 26, { color: COL.blue });
      // Hourglass that flips while the search runs.
      const hx = x + 80, hy = 24, flipIt = (M.t >> 5) & 1;
      g.fillStyle = COL.gold; g.fillRect(hx, hy, 9, 1); g.fillRect(hx, hy + 9, 9, 1);
      g.fillStyle = '#ffe9a8';
      const fillTop = flipIt ? (M.t & 31) / 32 : 1 - (M.t & 31) / 32;
      const th = Math.round(3 * fillTop);
      g.fillRect(hx + 2, hy + 1 + (3 - th), 5, th); g.fillRect(hx + 4, hy + 4, 1, 2); g.fillRect(hx + 2, hy + 9 - (3 - th), 5, 3 - th);
      if (ai && ai.depthDone) api.text(`D${ai.depthDone}`, x + 35, 36, { color: COL.dim });
    } else {
      const sideName = M.player === WHITE ? 'AS WHITE' : 'AS BLACK';
      api.text(sideName, x + 35, 26, { color: COL.dim });
      if (L.kind === 'puzzle') api.text(`MATE IN ${L.mateIn}`, x + 35, 36, { color: COL.green });
    }
    // Captured pieces: what you took (top) and what they took (bottom).
    drawCaptured(g, M.captured[M.player], M.cpu, x + 3, 47);
    drawCaptured(g, M.captured[M.cpu], M.player, x + 3, 56);
    // Speech bubble (or control hints when the rival is quiet).
    drawSpeech(g, x + 2, 69, w - 4);
    // Clocks / puzzle counter.
    let y = 105;
    if (M.clocks) {
      const fmt = (f) => { const s = Math.ceil(f / 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      const pLow = M.clocks[M.player] < 1200;
      const youColor = pLow && blink(20) ? COL.red : M.pos.side === M.player ? '#fff' : COL.dim;
      api.text('YOU', x + 3, y, { color: youColor });
      api.text(fmt(M.clocks[M.player]), x + w - 4, y, { color: youColor, align: 'right' });
      api.text(L.short, x + 3, y + 9, { color: M.pos.side === M.cpu ? '#fff' : COL.dim });
      api.text(fmt(M.clocks[M.cpu]), x + w - 4, y + 9, { color: M.pos.side === M.cpu ? '#fff' : COL.dim, align: 'right' });
      y += 20;
    } else if (L.kind === 'puzzle') {
      api.text(`MOVES ${Math.min(M.playerMoves, L.mateIn)}/${L.mateIn}`, x + 3, y, { color: COL.green });
      y += 10;
    }
    // Move list (last lines).
    g.fillStyle = '#1a120e'; g.fillRect(x + 2, y, w - 4, PANEL_BOTTOM - y - 2);
    const lines = [];
    const firstBlack = M.startSide === BLACK;
    for (let i = 0, n = M.startFull; i < M.history.length;) {
      const line = { n, w: null, b: null };
      if (i === 0 && firstBlack) { line.b = M.history[i++]; }
      else { line.w = M.history[i++]; if (i < M.history.length) line.b = M.history[i++]; }
      lines.push(line); n++;
    }
    const maxLines = Math.floor((PANEL_BOTTOM - y - 6) / 9);
    const shown = lines.slice(-maxLines);
    shown.forEach((ln, i) => {
      const ly = y + 3 + i * 9;
      api.text(String(ln.n).padStart(2, ' '), x + 3, ly, { color: COL.dim });
      if (ln.w) drawSan(g, ln.w, x + 18, ly, WHITE);
      else api.text('..', x + 18, ly, { color: COL.dim });
      if (ln.b) drawSan(g, ln.b, x + 55, ly, BLACK);
    });
    if (!lines.length) api.text('NO MOVES', x + 3, y + 3, { color: '#5a4636' });
  }

  /** Row of tiny icons for pieces of `color` that were captured. */
  function drawCaptured(g, list, color, x, y) {
    const step = list.length > 15 ? 5 : 6;
    list.forEach((t, i) => drawSprite(g, icons[color][t], x + i * step, y));
  }

  function drawSan(g, s, x, y, color) {
    const textColor = color === WHITE ? '#fff' : '#c8b8a8';
    if (s.icon) { drawSprite(g, icons[color][s.icon], x, y + 1); x += 6; }
    api.text(s.text, x, y, { color: textColor });
    x += api.textWidth(s.text) + 1;
    if (s.promo) { drawSprite(g, icons[color][s.promo], x, y + 1); x += 6; }
    if (s.suffix) api.text(s.suffix, x, y, { color: s.suffix === '#' ? COL.gold : COL.red });
  }

  /** Greedy word wrap for the 6px font. */
  function wrap(text, maxChars) {
    const lines = [];
    let cur = '';
    for (const word of text.split(' ')) {
      if (cur && (cur + ' ' + word).length > maxChars) { lines.push(cur); cur = word; }
      else cur = cur ? cur + ' ' + word : word;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawSpeech(g, x, y, w) {
    const M = match;
    if (M.say.t > 0) {
      const typed = Math.floor((180 - M.say.t) * 1.5) + 1;
      g.fillStyle = '#fff4dc'; g.fillRect(x, y, w, 32);
      g.fillRect(x + 12, y - 3, 4, 3); g.fillRect(x + 13, y - 5, 2, 2);   // tail toward the portrait
      let n = 0;
      wrap(M.say.text, 15).slice(0, 3).forEach((line, i) => {
        const visible = line.slice(0, Math.max(0, typed - n));
        n += line.length + 1;
        api.text(visible, x + 3, y + 3 + i * 10, { color: '#2a1a10' });
      });
    } else if (M.phase === 'player') {
      const hints = M.selected >= 0 ? ['J: MOVE HERE', 'K: CANCEL', 'START: MENU'] : ['J: PICK PIECE', 'D-PAD: CURSOR', 'START: MENU'];
      hints.forEach((h, i) => api.text(h, x + 2, y + 3 + i * 10, { color: '#7a6450' }));
    } else if (M.phase === 'promo') {
      ['LEFT/RIGHT', 'J: PROMOTE', 'K: BACK'].forEach((h, i) => api.text(h, x + 2, y + 3 + i * 10, { color: '#7a6450' }));
    }
  }

  function drawPromo(g) {
    const M = match, P = M.promo;
    const w = 4 * 30 + 8, x = BX + (SQ * 8 - w) / 2, y = BY + 80;
    panelBox(g, x, y, w, 48, '#2a1e16');
    api.text('PROMOTE TO', x + w / 2, y + 4, { align: 'center', color: COL.gold });
    PROMO_ORDER.forEach((t, i) => {
      const cx = x + 4 + i * 30, cy = y + 14;
      g.fillStyle = i === P.index ? COL.gold : '#4a3628'; g.fillRect(cx, cy, 28, 30);
      g.fillStyle = i === P.index ? '#fff1c4' : COL.light; g.fillRect(cx + 1, cy + 1, 26, 28);
      drawPiece(g, pieceCode(M.player, t), cx + 1, cy + 2 - (i === P.index ? Math.round(Math.abs(Math.sin(api.time * 6)) * 2) : 0));
    });
  }

  function drawResultBanner(g) {
    const M = match, o = M.result.outcome;
    const k = Math.min(1, (150 - M.endTimer) / 15);
    const h = Math.round(40 * k), y = BY + SQ * 4 - h / 2;
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(BX, y, SQ * 8, h);
    if (k < 1) return;
    const title = o === 'win' ? 'VICTORY!' : o === 'lose' ? 'DEFEAT' : 'DRAW';
    const c = o === 'win' ? COL.gold : o === 'lose' ? COL.red : COL.blue;
    api.text(title, BX + SQ * 4, y + 6, { scale: 2, align: 'center', color: c, shadow: '#000' });
    api.text(M.result.reason, BX + SQ * 4, y + 26, { align: 'center', color: '#fff' });
  }

  function drawPause(g) {
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, W, H);
    panelBox(g, 90, 70, 140, 96);
    api.text('PAUSED', W / 2, 80, { scale: 2, align: 'center', color: COL.gold });
    ['RESUME', 'RESIGN', 'QUIT TO TITLE'].forEach((s, i) => {
      const sel = i === pauseSel;
      api.text((sel ? '> ' : '  ') + s, 110, 108 + i * 14, { color: sel ? '#fff' : COL.dim });
    });
    api.text('SELECT: FLIP BOARD', W / 2, 152, { align: 'center', color: '#6a5646' });
  }

  function drawLevelClear(g) {
    g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(0, 0, W, H);
    panelBox(g, 50, 40, 220, 160);
    api.text('RIVAL DEFEATED!', W / 2, 50, { scale: 2, align: 'center', color: COL.gold, shadow: '#000' });
    drawPortrait(g, match.level.look, 60, 72, 2, -1, false);
    api.text(match.level.name, 96, 76, { color: '#fff' });
    api.text(`"${match.level.lines.lose}"`.slice(0, 28), 96, 88, { color: COL.dim });
    clearInfo.parts.forEach(([label, pts], i) => {
      if (stateT < 15 + i * 10) return;
      api.text(label, 70, 110 + i * 11, { color: COL.text });
      api.text('+' + pts, 250, 110 + i * 11, { align: 'right', color: COL.green });
    });
    const ty = 110 + clearInfo.parts.length * 11 + 4;
    if (stateT > 15 + clearInfo.parts.length * 10) {
      api.text('SCORE', 70, ty, { color: COL.gold });
      api.text(String(score), 250, ty, { align: 'right', color: COL.gold });
    }
    if (stateT > 50 && blink()) api.text('J: NEXT RIVAL', W / 2, 186, { align: 'center', color: '#fff' });
  }

  function drawRematch(g) {
    const M = match, draw = M.result.outcome === 'draw';
    g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(0, 0, W, H);
    panelBox(g, 50, 60, 220, 120);
    api.text(draw ? 'DRAW!' : 'DEFEATED', W / 2, 70, { scale: 2, align: 'center', color: draw ? COL.blue : COL.red, shadow: '#000' });
    api.text(M.result.reason, W / 2, 92, { align: 'center', color: '#fff' });
    drawPortrait(g, M.level.look, 64, 108, 2, draw ? 0 : 1, false);
    api.text(`"${draw ? 'AGAIN! I INSIST.' : M.level.lines.win}"`.slice(0, 30), 100, 116, { color: COL.dim });
    api.text('LIVES', 100, 130, { color: COL.text });
    for (let i = 0; i < 3; i++) drawSprite(g, i < lives ? heartFull : heartEmpty, 136 + i * 8, 131);
    if (stateT > 40 && blink()) api.text('J: REMATCH   K: TITLE', W / 2, 160, { align: 'center', color: '#fff' });
  }

  function drawGameOver(g) {
    const L = LEVELS[levelIdx];
    api.text('GAME OVER', W / 2, 40, { scale: 3, align: 'center', color: COL.red, shadow: '#000' });
    drawPortrait(g, L.look, W / 2 - 30, 80, 4, 1, false);
    // Your toppled king.
    g.save();
    g.translate(W / 2 + 56, 132);
    g.rotate(Math.PI / 2 * Math.min(1, stateT / 30));
    drawSprite(g, sprites[WHITE][KING], -8, -17);
    g.restore();
    api.text(`${L.name} WINS`, W / 2, 148, { align: 'center', color: COL.gold });
    api.text(`REACHED RIVAL ${levelIdx + 1}   SCORE ${score}`, W / 2, 164, { align: 'center', color: COL.text });
    api.text(`HI SCORE ${hiScore}`, W / 2, 176, { align: 'center', color: COL.dim });
    if (stateT > 40 && blink()) api.text('PRESS START', W / 2, 204, { scale: 2, align: 'center', color: '#fff' });
  }

  function drawVictory(g) {
    const off = (api.frame * 0.5) % 32;
    for (let y = -32; y < H + 32; y += 16) for (let x = -32; x < W + 32; x += 16) {
      if (((x + y) / 16) & 1) continue;
      g.fillStyle = '#2a1f0a'; g.fillRect(x + off, y - off, 16, 16);
    }
    api.text('CHAMPION!', W / 2, 30, { scale: 4, align: 'center', color: COL.gold, shadow: '#5d4037' });
    const bob = Math.round(Math.sin(api.time * 4) * 4);
    drawSprite(g, sprites[WHITE][KING], W / 2 - 8, 80 + bob);
    drawSprite(g, sprites[WHITE][QUEEN], W / 2 - 40, 84 - bob);
    drawSprite(g, sprites[WHITE][ROOK], W / 2 + 24, 84 - bob);
    api.text('ALL 20 RIVALS DEFEATED', W / 2, 120, { align: 'center', color: '#fff' });
    api.text('YOU ARE THE GRANDMASTER OF THE LADDER', W / 2, 132, { align: 'center', color: COL.text });
    api.text(`FINAL SCORE ${score}`, W / 2, 156, { scale: 2, align: 'center', color: COL.gold });
    api.text(`HI SCORE ${hiScore}`, W / 2, 178, { align: 'center', color: COL.dim });
    if (stateT > 90 && blink()) api.text('PRESS START', W / 2, 210, { align: 'center', color: '#fff' });
  }

  return { update, draw };
}
