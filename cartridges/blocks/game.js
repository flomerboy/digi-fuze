// SPROUT SHOWER — a 20-level garden puzzle for the VG-Remix console.
//
// THE ONE RULE: flowers fall into a garden bed that already has some flowers planted
// in it. When a falling flower comes to rest TOUCHING a planted flower of the SAME
// kind (left, right, above or below), they bloom and disappear together.
// Bloom every planted flower to clear the level. If the bed fills to the top, you lose.
//
// There are three kinds (SUN, LEAF, BERRY). Each kind has ONE picture: the falling
// piece and the planted target look the same, the planted one just sits on a little
// soil mound. Pieces are single flowers or pairs. After a bloom, loose flowers drop
// into the gaps, which can set off more blooms.
//
// Controls:  LEFT/RIGHT move   DOWN fall faster   UP drop at once
//            A/B turn a pair   START pause
//
// File layout:
//   1. Constants & kinds       4. Pieces              7. Draw: bed & icons
//   2. Level data (LEVELS)     5. Blooms & falling    8. Draw: HUD & screens
//   3. Game state & setup      6. Update (states)     9. Audio

export default function boot(api) {
  const { W, H } = api;

  // ===========================================================================
  // 1. CONSTANTS & KINDS
  // ===========================================================================
  const COLS = 8, ROWS = 13, CELL = 16;          // the garden bed
  const BED_X = 96, BED_Y = 16;                  // top-left of the bed on screen
  const BED_W = COLS * CELL, BED_H = ROWS * CELL;
  const REPEAT_DELAY = 10, REPEAT_RATE = 3;      // LEFT/RIGHT auto-repeat (frames)
  const GROUND_FRAMES = 20;  // frames a resting piece waits before it lands for good
  const MAX_NUDGES = 10;     // moves/turns that may restart that wait
  const FAST_FALL = 0.45;    // rows per frame while DOWN is held
  const BLOOM_FRAMES = 24;   // bloom animation length
  const DROP_FRAMES = 3;     // frames per row when loose flowers drop after a bloom
  const DANGER_ROWS = 3;     // anything this high makes the bed frame pulse

  // Board cells: null | { k: FLOWER, s: kind, planted: bool } | { k: STONE }
  const FLOWER = 1, STONE = 2;

  // Each kind has its own color AND silhouette (see drawIcon).
  const KINDS = [
    { name: 'SUN',   main: '#ffd23f', dark: '#c77d0a', light: '#fff4b0' }, // round, rayed
    { name: 'LEAF',  main: '#62d65a', dark: '#23802a', light: '#c4ffb8' }, // pointed leaf
    { name: 'BERRY', main: '#ff4f7b', dark: '#9c1d3f', light: '#ffc2d2' }, // three berries
  ];

  // ===========================================================================
  // 2. LEVEL DATA
  // ===========================================================================
  // map:   rows of the bed, bottom-aligned (last string = bottom row), 8 chars each.
  //        '.' soil   '#' stone   's' sun   'l' leaf   'b' berry  (planted flowers)
  //        Planted flowers always sit on the floor, a stone or another planted flower.
  // kinds: how many kinds can fall (2 = sun+leaf, 3 adds berry)
  // speed: rows per frame        tip: optional one-liner on the level card
  const LEVELS = [
    { name: 'FIRST SPROUTS', kinds: 2, speed: 1 / 50, tip: 'SAME PICTURE = BLOOM',
      map: ['...s.l..'] },
    { name: 'GARDEN ROW', kinds: 2, speed: 1 / 46,
      map: ['s.l..s.l'] },
    { name: 'TWO TIERS', kinds: 2, speed: 1 / 44, tip: 'J/K TURNS A PAIR',
      map: ['.l....s.', '.s....l.'] },
    { name: 'CORNERS', kinds: 2, speed: 1 / 42,
      map: ['s......l', 'l.s..l.s'] },
    { name: 'BERRY SEASON', kinds: 3, speed: 1 / 42, tip: 'A THIRD KIND: BERRY',
      map: ['s.b..b.l'] },
    { name: 'STEPPING STONES', kinds: 3, speed: 1 / 40, tip: 'STONES NEVER MOVE',
      map: ['..s..b..', '..#..#..', 'l......l'] },
    { name: 'TERRACE', kinds: 3, speed: 1 / 38,
      map: ['s.......', '#....l..', '.....##.', 'b......b'] },
    { name: 'NARROW BEDS', kinds: 3, speed: 1 / 36,
      map: ['l.#..#.s', '#.s..b.#'] },
    { name: 'BIG HARVEST', kinds: 3, speed: 1 / 36,
      map: ['s.l.b.s.', 'l.b.s.l.'] },
    { name: 'STONE WELL', kinds: 3, speed: 1 / 34,
      map: ['#..s...#', '#..#.l.#', '##.b.###', '###b.###'] },
    { name: 'QUICK SHOWER', kinds: 3, speed: 1 / 24,
      map: ['b......b', 's.l##s.l'] },
    { name: 'TALL STEMS', kinds: 3, speed: 1 / 32,
      map: ['s......b', 'l......l', 'b..##..s', '#..##..#'] },
    { name: 'WINDOWS', kinds: 3, speed: 1 / 30,
      map: ['.s.lb.s.', '.#.##.#.', 'l..bs..l'] },
    { name: 'QUICK HANDS', kinds: 3, speed: 1 / 18,
      map: ['l.s..b.l', 's.b..l.s'] },
    { name: 'ROCK GARDEN', kinds: 3, speed: 1 / 28,
      map: ['.s..#.l.', '.#..#.#.', 'b..l...s', '#..#...#', '.l...b..'] },
    { name: 'HANGING GARDEN', kinds: 3, speed: 1 / 26,
      map: ['s......l', '#......#', '...bl...', '..####..', 'l......s', '##....##', 'b......b'] },
    { name: 'DEEP ROOTS', kinds: 3, speed: 1 / 24,
      map: ['..s..l..', '..#..#..', '.l....b.', '.#.bs.#.', 'b..##..l'] },
    { name: 'CROWDED BED', kinds: 3, speed: 1 / 20,
      map: ['l.b..s.l', 'sblsblsb'] },
    { name: 'STONE MAZE', kinds: 3, speed: 1 / 18,
      map: ['s.#..#.b', '#.l..s.#', '..#..#..', 'b.l..b.s', '#.#..#.#'] },
    { name: 'GRAND BLOOM', kinds: 3, speed: 1 / 14,
      map: ['s......b', '#..lb..#', 'b.####.s', 'l..##..l', 's.b..l.b'] },
  ];
  const LEVEL_HUES = [120, 140, 100, 160, 340, 30, 45, 90, 80, 200, 60, 150, 270, 20, 210, 170, 110, 320, 250, 15];

  // ===========================================================================
  // 3. GAME STATE & SETUP
  // ===========================================================================
  let state = 'title';     // title | intro | playing | paused | levelClear | gameOver | victory
  let stateT = 0;
  let levelIdx = 0, level = LEVELS[0];
  let titleSel = 0;
  let hiScore = api.storage.get('hi', 0);
  let best = Math.min(api.storage.get('best', 0), LEVELS.length - 1); // furthest unlocked level

  let board = [];          // board[r][c]
  let piece = null;        // { cells: [[dx, dy, kind]], x, y }
  let next = null;         // the upcoming piece (shown as the hint)
  let anim = null;         // { type: 'bloom', cells: [[r,c]], t } | { type: 'drop', t }
  let sproutsTotal = 0;

  let fallAcc = 0, groundT = 0, nudges = 0, lowestY = 0;
  let moveDir = 0, moveT = 0;
  let score = 0, levelStartScore = 0, chain = 0, clearBonus = 0;

  let particles = [], popups = [];
  let shakeT = 0, shakeMag = 0;
  let musicNext = 0, musicBar = 0;

  const rnd = (n) => Math.floor(Math.random() * n);
  const inBed = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const isPlanted = (v) => v && v.k === FLOWER && v.planted;
  const isLoose = (v) => v && v.k === FLOWER && !v.planted;

  // Soil speckles, computed once so the bed texture doesn't shimmer.
  const PEBBLES = [];
  for (let i = 0; i < 60; i++) PEBBLES.push({ x: rnd(BED_W), y: rnd(BED_H), s: 1 + rnd(2), c: ['#3a2716', '#45301b', '#2b1c10'][rnd(3)] });
  const titleDrops = [];
  for (let i = 0; i < 10; i++) titleDrops.push({ s: i % 3, x: 10 + Math.random() * (W - 20), y: Math.random() * H, v: 0.3 + Math.random() * 0.4 });

  function setState(s) { state = s; stateT = 0; }

  function parseMap(lv) {
    const b = [];
    for (let r = 0; r < ROWS; r++) b.push(new Array(COLS).fill(null));
    const top = ROWS - lv.map.length;
    lv.map.forEach((row, i) => {
      for (let c = 0; c < COLS; c++) {
        const ch = row[c], s = 'slb'.indexOf(ch);
        if (ch === '#') b[top + i][c] = { k: STONE };
        else if (s >= 0) b[top + i][c] = { k: FLOWER, s, planted: true };
      }
    });
    return b;
  }

  function startLevel(idx, keepScore) {
    levelIdx = idx;
    level = LEVELS[idx];
    if (!keepScore) score = 0;
    levelStartScore = score;
    board = parseMap(level);
    sproutsTotal = sproutsLeft();
    anim = null; chain = 0;
    particles = []; popups = [];
    moveDir = 0; moveT = 0;
    next = makePiece();
    spawnPiece();
    setState('intro');
    sfxLevelStart();
  }

  function sproutsLeft() {
    let n = 0;
    for (const row of board) for (const v of row) if (isPlanted(v)) n++;
    return n;
  }

  function topRowsBusy() {
    for (let r = 0; r < DANGER_ROWS; r++) if (board[r].some((v) => v)) return true;
    return false;
  }

  // ===========================================================================
  // 4. PIECES
  // ===========================================================================
  // Mostly drop kinds that still have a planted flower waiting, so pieces feel useful.
  function pickKind() {
    const wanted = [];
    for (const row of board) for (const v of row) if (isPlanted(v)) wanted.push(v.s);
    if (wanted.length && Math.random() < 0.8) return wanted[rnd(wanted.length)];
    return rnd(level.kinds);
  }

  // Singles early on; pairs become more common as levels go on.
  function makePiece() {
    const a = pickKind();
    if (Math.random() >= Math.min(0.65, levelIdx * 0.07)) return { cells: [[0, 0, a]] };
    const b = Math.random() < 0.5 ? a : pickKind();
    return { cells: [[0, 0, a], [0, -1, b]] };
  }

  function fits(cells, x, y) {
    for (const [dx, dy] of cells) {
      const c = x + dx, r = y + dy;
      if (c < 0 || c >= COLS || r >= ROWS) return false;
      if (r >= 0 && board[r][c]) return false;
    }
    return true;
  }

  function spawnPiece() {
    piece = next;
    next = makePiece();
    piece.x = 3;
    piece.y = -Math.min(...piece.cells.map((p) => p[1]));
    fallAcc = 0; groundT = 0; nudges = 0; lowestY = piece.y;
    if (!fits(piece.cells, piece.x, piece.y)) endGame();
  }

  function resting() { return !fits(piece.cells, piece.x, piece.y + 1); }

  function afterNudge() { if (resting() && nudges < MAX_NUDGES) { groundT = 0; nudges++; } }

  function tryMove(dx) {
    if (!fits(piece.cells, piece.x + dx, piece.y)) return;
    piece.x += dx;
    afterNudge();
    sfxMove();
  }

  // Pairs turn around their first flower; if blocked, try one step left, right, then up.
  function tryTurn(dir) {
    if (piece.cells.length < 2) return;
    const turned = piece.cells.map(([dx, dy, s]) => (dir > 0 ? [-dy, dx, s] : [dy, -dx, s]));
    for (const [nx, ny] of [[0, 0], [-1, 0], [1, 0], [0, -1]]) {
      if (fits(turned, piece.x + nx, piece.y + ny)) {
        piece.cells = turned; piece.x += nx; piece.y += ny;
        afterNudge();
        sfxTurn();
        return;
      }
    }
  }

  function stepDown() {
    if (!fits(piece.cells, piece.x, piece.y + 1)) return false;
    piece.y++;
    if (piece.y > lowestY) { lowestY = piece.y; nudges = 0; groundT = 0; }
    return true;
  }

  function dropNow() {
    let rows = 0;
    while (stepDown()) rows++;
    score += rows;
    shake(4, 1.5);
    lockPiece();
  }

  // The piece becomes loose flowers on the board, then everything settles.
  function lockPiece() {
    const p = piece;
    piece = null;
    for (const [dx, dy, s] of p.cells) {
      const r = p.y + dy, c = p.x + dx;
      if (r < 0) { endGame(); return; }
      board[r][c] = { k: FLOWER, s, planted: false };
      dirtPuff(r, c);
    }
    sfxLand();
    anim = { type: 'drop', t: DROP_FRAMES };
  }

  function endGame() {
    piece = null; anim = null;
    saveProgress();
    shake(14, 4);
    sfxGameOver();
    setState('gameOver');
  }

  // ===========================================================================
  // 5. BLOOMS & FALLING
  // ===========================================================================
  // Loose flowers fall one row per step into empty soil. Planted flowers and stones stay.
  function dropStep() {
    let moved = false;
    for (let r = ROWS - 2; r >= 0; r--) for (let c = 0; c < COLS; c++) {
      if (isLoose(board[r][c]) && !board[r + 1][c]) { board[r + 1][c] = board[r][c]; board[r][c] = null; moved = true; }
    }
    return moved;
  }

  // Every planted flower touched by a loose flower of its kind blooms, together with
  // those touching flowers. If nothing blooms, the turn is over.
  function resolveBoard() {
    const cells = new Map(), blooms = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (!isPlanted(v)) continue;
      const touching = NEIGHBORS.map(([dr, dc]) => [r + dr, c + dc])
        .filter(([nr, nc]) => inBed(nr, nc) && isLoose(board[nr][nc]) && board[nr][nc].s === v.s);
      if (!touching.length) continue;
      blooms.push([r, c]);
      cells.set(r * COLS + c, [r, c]);
      for (const [nr, nc] of touching) cells.set(nr * COLS + nc, [nr, nc]);
    }
    if (!blooms.length) {
      chain = 0;
      if (sproutsLeft() === 0) levelCleared();
      else spawnPiece();
      return;
    }
    chain++;
    const pts = (blooms.length * 100 + (cells.size - blooms.length) * 20) * chain;
    score += pts;
    const [br, bc] = blooms[0];
    popup(chain > 1 ? `CHAIN x${chain}!` : blooms.length > 1 ? 'DOUBLE BLOOM!' : 'BLOOM!', KINDS[board[br][bc].s].light, 2, bc);
    popup(`+${pts}`, '#fff', 1, bc);
    shake(5 + chain * 3, 1 + chain);
    sfxBloom(chain);
    anim = { type: 'bloom', cells: [...cells.values()], t: BLOOM_FRAMES };
  }

  function finishBloom() {
    for (const [r, c] of anim.cells) {
      const v = board[r][c];
      if (v.planted) petalBurst(r, c, v.s);
      board[r][c] = null;
    }
    anim = { type: 'drop', t: DROP_FRAMES };
  }

  function updateAnim() {
    if (--anim.t > 0) return;
    if (anim.type === 'bloom') { finishBloom(); return; }
    if (dropStep()) { anim.t = DROP_FRAMES; return; }
    anim = null;
    resolveBoard();
  }

  function levelCleared() {
    piece = null;
    clearBonus = 300 * (levelIdx + 1);
    score += clearBonus;
    if (levelIdx + 1 < LEVELS.length) best = Math.max(best, levelIdx + 1);
    saveProgress();
    if (levelIdx === LEVELS.length - 1) { setState('victory'); sfxVictory(); }
    else { setState('levelClear'); sfxLevelClear(); }
  }

  function saveProgress() {
    if (score > hiScore) { hiScore = score; api.storage.set('hi', hiScore); }
    api.storage.set('best', best);
  }

  // ===========================================================================
  // 6. UPDATE (state machine)
  // ===========================================================================
  function update(input) {
    stateT++;
    updateEffects();
    if (state === 'title') updateTitle(input);
    else if (state === 'intro') updateIntro(input);
    else if (state === 'playing') updatePlaying(input);
    else if (state === 'paused') updatePaused(input);
    else if (state === 'levelClear') updateLevelClear(input);
    else if (state === 'gameOver') updateGameOver(input);
    else if (state === 'victory') updateVictory(input);
  }

  function updateEffects() {
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life--; }
    particles = particles.filter((p) => p.life > 0);
    for (const pu of popups) pu.t++;
    popups = popups.filter((pu) => pu.t < 60);
    if (shakeT > 0) shakeT--; else shakeMag = 0;
  }

  function updateTitle(input) {
    for (const d of titleDrops) { d.y += d.v; if (d.y > H + 16) { d.y = -16; d.x = 10 + Math.random() * (W - 20); } }
    if (input.pressed.left && titleSel > 0) { titleSel--; sfxMove(); }
    if (input.pressed.right && titleSel < best) { titleSel++; sfxMove(); }
    if (input.pressed.start || input.pressed.a) startLevel(titleSel, false);
  }

  function updateIntro(input) {
    if ((stateT > 20 && (input.pressed.a || input.pressed.start)) || stateT > 150) {
      setState('playing');
      musicNext = api.frame; musicBar = 0;
    }
  }

  function updatePlaying(input) {
    if (input.pressed.start) { setState('paused'); api.sound.stopAll(); sfxPause(); return; }
    updateMusic();
    if (anim) { updateAnim(); return; }
    if (!piece) return;

    if (input.pressed.a) tryTurn(1);
    if (input.pressed.b) tryTurn(-1);

    const dir = input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
    if (dir === 0) { moveDir = 0; moveT = 0; }
    else if (dir !== moveDir) { moveDir = dir; moveT = 0; tryMove(dir); }
    else if (++moveT >= REPEAT_DELAY && (moveT - REPEAT_DELAY) % REPEAT_RATE === 0) tryMove(dir);

    if (input.pressed.up) { dropNow(); return; }

    fallAcc += input.down ? Math.max(level.speed, FAST_FALL) : level.speed;
    while (fallAcc >= 1) {
      fallAcc -= 1;
      if (!stepDown()) { fallAcc = 0; break; }
    }
    if (resting()) { if (++groundT >= GROUND_FRAMES) lockPiece(); }
    else groundT = 0;
  }

  function updatePaused(input) {
    if (input.pressed.start) { setState('playing'); sfxPause(); }
    else if (input.pressed.select) { saveProgress(); titleSel = Math.min(levelIdx, best); setState('title'); }
  }

  function updateLevelClear(input) {
    if (stateT % 12 === 0) petalBurst(4 + rnd(ROWS - 5), rnd(COLS), rnd(level.kinds));
    if ((stateT > 45 && (input.pressed.a || input.pressed.start)) || stateT > 300) startLevel(levelIdx + 1, true);
  }

  function updateGameOver(input) {
    if (stateT < 50) return;
    if (input.pressed.a) { score = levelStartScore; startLevel(levelIdx, true); }
    else if (input.pressed.start) { titleSel = Math.min(levelIdx, best); setState('title'); }
  }

  function updateVictory(input) {
    if (stateT % 18 === 0) {
      const x = 40 + Math.random() * (W - 80), y = 30 + Math.random() * 100, k = KINDS[rnd(3)];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        spawnParticle(x, y, Math.cos(a) * 1.8, Math.sin(a) * 1.8 - 0.8, i & 1 ? k.main : k.light, 55, 0.04);
      }
      api.sound.tone(800 + rnd(600), 0.08, { type: 'sine', vol: 0.04 });
    }
    if (stateT > 90 && input.pressed.start) { titleSel = Math.min(levelIdx, best); setState('title'); }
  }

  // --- juice helpers
  function spawnParticle(x, y, vx, vy, color, life, g = 0.12) {
    if (particles.length < 300) particles.push({ x, y, vx, vy, color, life, max: life, g });
  }
  function popup(text, color, scale, col) {
    popups.push({ text, color, scale, x: BED_X + (col + 0.5) * CELL, t: 0 });
    if (popups.length > 3) popups.shift();
  }
  function shake(t, mag) { shakeT = Math.max(shakeT, t); shakeMag = Math.max(shakeMag, mag); }
  function dirtPuff(r, c) {
    for (let k = 0; k < 3; k++) spawnParticle(BED_X + (c + Math.random()) * CELL, BED_Y + (r + 1) * CELL, (Math.random() - 0.5) * 1.2, -Math.random() * 1.2, '#8d6e4f', 14);
  }
  function petalBurst(r, c, s) {
    const k = KINDS[s];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      spawnParticle(BED_X + (c + 0.5) * CELL, BED_Y + (r + 0.5) * CELL, Math.cos(a) * 1.7, Math.sin(a) * 1.7 - 0.6, i & 1 ? k.main : k.light, 40, 0.05);
    }
  }

  // ===========================================================================
  // 7. DRAW: BED & ICONS
  // ===========================================================================
  function draw(g) {
    drawBackground(g);
    if (state === 'title') { drawTitle(g); return; }
    const ox = shakeT > 0 ? Math.round((Math.random() - 0.5) * shakeMag) : 0;
    const oy = shakeT > 0 ? Math.round((Math.random() - 0.5) * shakeMag) : 0;
    g.save();
    g.translate(ox, oy);
    drawBed(g);
    g.restore();
    drawHud(g);
    drawParticles(g);
    drawPopups(g);
    if (state === 'intro') drawIntro(g);
    else if (state === 'paused') drawPaused(g);
    else if (state === 'levelClear') drawLevelClear(g);
    else if (state === 'gameOver') drawGameOver(g);
    else if (state === 'victory') drawVictory(g);
  }

  // Dusky garden sky with soft hills, tinted per level.
  function drawBackground(g) {
    const hue = state === 'title' ? 130 : LEVEL_HUES[levelIdx];
    g.fillStyle = `hsl(${hue},28%,9%)`;
    g.fillRect(0, 0, W, H);
    g.fillStyle = `hsl(${hue},26%,12%)`;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(i * 110 - 20, H + 40, 110, 0, Math.PI * 2); g.fill(); }
  }

  function drawBed(g) {
    const danger = state === 'playing' && topRowsBusy();
    const pulse = danger ? 0.5 + 0.5 * Math.sin(api.frame * 0.2) : 0;
    g.fillStyle = danger ? `rgb(${130 + pulse * 100},50,40)` : '#6b4423'; // wooden planter
    g.fillRect(BED_X - 5, BED_Y - 4, BED_W + 10, BED_H + 8);
    g.fillStyle = '#8a5a2e';
    g.fillRect(BED_X - 5, BED_Y - 4, BED_W + 10, 2);
    g.fillStyle = '#24170c';                                                 // soil
    g.fillRect(BED_X, BED_Y, BED_W, BED_H);
    for (const p of PEBBLES) { g.fillStyle = p.c; g.fillRect(BED_X + p.x, BED_Y + p.y, p.s, p.s); }

    const blooming = anim && anim.type === 'bloom' ? new Set(anim.cells.map(([r, c]) => r * COLS + c)) : null;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (!v) continue;
      const x = BED_X + c * CELL, y = BED_Y + r * CELL;
      if (blooming && blooming.has(r * COLS + c)) drawBlooming(g, v, x, y);
      else if (v.k === STONE) drawStone(g, x, y);
      else if (v.planted) drawPlanted(g, v.s, x, y);
      else drawIcon(g, v.s, x + 8, y + 8, 1);
    }

    if (piece && state !== 'gameOver') {
      const blink = groundT > GROUND_FRAMES / 2 && (groundT >> 1) & 1;
      g.globalAlpha = blink ? 0.7 : 1;
      for (const [dx, dy, s] of piece.cells) {
        const r = piece.y + dy;
        if (r >= 0) drawIcon(g, s, BED_X + (piece.x + dx) * CELL + 8, BED_Y + r * CELL + 8, 1);
      }
      g.globalAlpha = 1;
    }
  }

  // Bloom: the planted flower swells and fades; the flowers that touched it shrink away.
  function drawBlooming(g, v, x, y) {
    const k = anim.t / BLOOM_FRAMES; // 1 -> 0
    g.globalAlpha = Math.min(1, k * 2);
    if (v.planted) {
      g.fillStyle = KINDS[v.s].light;
      g.globalAlpha *= 0.35;
      g.beginPath(); g.arc(x + 8, y + 8, 4 + (1 - k) * 12, 0, Math.PI * 2); g.fill();
      g.globalAlpha = Math.min(1, k * 2);
      drawIcon(g, v.s, x + 8, y + 8, 1 + (1 - k) * 0.9);
    } else drawIcon(g, v.s, x + 8, y + 8, 0.3 + 0.7 * k);
    g.globalAlpha = 1;
  }

  // THE icon for a kind, centered at (cx, cy); k = scale (1 fills a 16px cell).
  // Falling pieces and planted flowers both use it, so matches are obvious.
  function drawIcon(g, s, cx, cy, k) {
    const sp = KINDS[s];
    const dot = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    if (s === 0) {          // SUN: round flower with eight rays
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        dot(cx + Math.cos(a) * 5.5 * k, cy + Math.sin(a) * 5.5 * k, 1.7 * k, sp.dark);
      }
      dot(cx, cy, 5 * k, sp.main);
      dot(cx, cy, 2.2 * k, '#7a3e06');
    } else if (s === 1) {   // LEAF: pointed leaf with a vein
      g.save();
      g.translate(cx, cy); g.rotate(-Math.PI / 4);
      g.fillStyle = sp.dark;
      g.beginPath(); g.ellipse(0, 0, 7.5 * k, 4.5 * k, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = sp.main;
      g.beginPath(); g.ellipse(0, -0.5 * k, 6.5 * k, 3.5 * k, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = sp.dark;
      g.fillRect(-6 * k, -0.5 * k, 12 * k, Math.max(1, k));
      g.restore();
    } else {                // BERRY: cluster of three
      for (const [bx, by] of [[-3, 2], [3, 2], [0, -3]]) {
        dot(cx + bx * k, cy + (by + 0.5) * k, 3.8 * k, sp.dark);
        dot(cx + bx * k, cy + by * k, 3.3 * k, sp.main);
        g.fillStyle = sp.light;
        g.fillRect(Math.round(cx + (bx - 1.5) * k), Math.round(cy + (by - 1.5) * k), Math.max(1, Math.round(k)), Math.max(1, Math.round(k)));
      }
    }
  }

  // A planted flower: the same icon, a hair smaller, on a stem and a soil mound, swaying.
  function drawPlanted(g, s, x, y) {
    const cx = x + 8, sway = Math.round(Math.sin(api.frame * 0.05 + x * 0.3) * 0.8);
    g.fillStyle = '#6b4a2b';
    g.beginPath(); g.ellipse(cx, y + 16, 7, 3, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#4c8a2e';
    g.fillRect(cx, y + 10, 1, 4);
    drawIcon(g, s, cx + sway, y + 7, 0.9);
  }

  function drawStone(g, x, y) {
    g.fillStyle = '#4a4e57';
    g.fillRect(x + 1, y + 2, 14, 13); g.fillRect(x + 2, y + 1, 12, 15);
    g.fillStyle = '#7b818f';
    g.fillRect(x + 2, y + 2, 12, 10); g.fillRect(x + 3, y + 1, 10, 1);
    g.fillStyle = '#a3a9b6';
    g.fillRect(x + 3, y + 3, 4, 2);
  }

  function drawParticles(g) {
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    g.globalAlpha = 1;
  }

  function drawPopups(g) {
    popups.forEach((pu, i) => {
      const y = 70 + i * 18 - pu.t * 0.4;
      const x = Math.max(BED_X + 40, Math.min(BED_X + BED_W - 40, pu.x));
      if (pu.t > 48 && (pu.t >> 1) & 1) return;
      api.text(pu.text, x, Math.round(y), { scale: pu.scale, color: pu.color, align: 'center', shadow: '#000' });
    });
  }

  // ===========================================================================
  // 8. DRAW: HUD & SCREENS
  // ===========================================================================
  // Left: level + sprouts left. Right: score + next piece. Nothing else.
  function drawHud(g) {
    const lx = BED_X / 2, rx = BED_X + BED_W + (W - BED_X - BED_W) / 2;
    api.text('LEVEL', lx, 24, { color: '#c5b38a', align: 'center' });
    api.text(String(levelIdx + 1), lx, 36, { scale: 3, color: '#fff', align: 'center', shadow: '#000' });
    api.text('SPROUTS', lx, 84, { color: '#c5b38a', align: 'center' });
    api.text(String(sproutsLeft()), lx, 96, { scale: 3, color: '#b9f6ca', align: 'center', shadow: '#000' });
    api.text('SCORE', rx, 24, { color: '#c5b38a', align: 'center' });
    api.text(String(score), rx, 36, { scale: 2, color: '#fff', align: 'center', shadow: '#000' });
    api.text('NEXT', rx, 84, { color: '#c5b38a', align: 'center' });
    if (next && state !== 'gameOver' && state !== 'victory') {
      for (const [dx, dy, s] of next.cells) drawIcon(g, s, rx + dx * CELL, 112 + (dy + (next.cells.length > 1 ? 0.5 : 0)) * CELL, 1);
    }
  }

  function dimScreen(g, a) { g.fillStyle = `rgba(6,4,2,${a})`; g.fillRect(0, 0, W, H); }

  function centerCard(g, y, h) {
    g.fillStyle = 'rgba(16,12,6,0.92)';
    g.fillRect(30, y, W - 60, h);
    g.fillStyle = '#9ccc65';
    g.fillRect(30, y, W - 60, 2); g.fillRect(30, y + h - 2, W - 60, 2);
  }

  // Picture of the rule: falling flower + planted flower of the same kind = bloom.
  function drawRulePicture(g, cx, y) {
    drawIcon(g, 0, cx - 46, y + 6, 1);
    api.text('+', cx - 26, y + 3, { color: '#fff' });
    drawPlanted(g, 0, cx - 18, y - 2);
    api.text('= BLOOM!', cx + 24, y + 3, { color: KINDS[0].light, align: 'center' });
  }

  function drawIntro(g) {
    dimScreen(g, 0.35);
    centerCard(g, 56, 124);
    const slide = Math.max(0, 20 - stateT) * 6;
    api.text(`LEVEL ${levelIdx + 1}`, W / 2 - slide, 66, { scale: 2, color: '#c5e1a5', align: 'center', shadow: '#000' });
    const nameScale = api.textWidth(level.name, 3) > W - 70 ? 2 : 3;
    api.text(level.name, W / 2 + slide, 88, { scale: nameScale, color: '#fff', align: 'center', shadow: '#33691e' });
    drawRulePicture(g, W / 2, 118);
    api.text(level.tip || `BLOOM ALL ${sproutsTotal} SPROUTS`, W / 2, 142, { color: '#b9f6ca', align: 'center' });
    if ((stateT >> 4) & 1) api.text('PRESS J', W / 2, 160, { color: '#ffd54f', align: 'center' });
  }

  function drawPaused(g) {
    dimScreen(g, 0.78);
    api.text('PAUSED', W / 2, 80, { scale: 4, color: '#fff', align: 'center', shadow: '#33691e' });
    drawRulePicture(g, W / 2, 124);
    api.text('START  RESUME', W / 2, 160, { color: '#ffd54f', align: 'center' });
    api.text('SELECT QUIT TO TITLE', W / 2, 172, { color: '#a1887f', align: 'center' });
  }

  function drawLevelClear(g) {
    dimScreen(g, 0.4);
    centerCard(g, 70, 96);
    const bounce = Math.round(Math.abs(Math.sin(stateT * 0.12)) * -4);
    api.text('IN FULL BLOOM!', W / 2, 82 + bounce, { scale: 3, color: '#b9f6ca', align: 'center', shadow: '#1b5e20' });
    api.text(`BONUS +${clearBonus}`, W / 2, 112, { scale: 2, color: '#ffd54f', align: 'center' });
    if (stateT > 45 && (stateT >> 4) & 1) api.text(`PRESS J FOR LEVEL ${levelIdx + 2}`, W / 2, 140, { color: '#c5e1a5', align: 'center' });
  }

  function drawGameOver(g) {
    dimScreen(g, Math.min(0.55, stateT / 60));
    centerCard(g, 52, 140);
    const drop = Math.max(0, 30 - stateT) * 3;
    api.text('WILTED', W / 2, 64 - drop, { scale: 4, color: '#ff8a65', align: 'center', shadow: '#3e1a00' });
    api.text('THE BED IS FULL', W / 2, 104, { scale: 2, color: '#ffccbc', align: 'center' });
    api.text(`SCORE ${score}   HI ${hiScore}`, W / 2, 130, { color: '#fff', align: 'center' });
    if (stateT >= 50) {
      api.text('J: TRY THIS LEVEL AGAIN', W / 2, 156, { color: '#c5e1a5', align: 'center' });
      api.text('START: TITLE', W / 2, 170, { color: '#a1887f', align: 'center' });
    }
  }

  function drawVictory(g) {
    dimScreen(g, 0.85);
    const wob = Math.round(Math.sin(stateT * 0.08) * 3);
    api.text('THE GARDEN', W / 2, 52 + wob, { scale: 3, color: '#ffd54f', align: 'center', shadow: '#5d4037' });
    api.text('BLOOMS!', W / 2, 80 - wob, { scale: 4, color: '#b9f6ca', align: 'center', shadow: '#1b5e20' });
    api.text(`FINAL SCORE ${score}`, W / 2, 128, { scale: 2, color: '#fff', align: 'center' });
    api.text(score >= hiScore ? 'NEW HIGH SCORE!' : `HI ${hiScore}`, W / 2, 152, { color: '#ffd54f', align: 'center' });
    if (stateT > 90 && (stateT >> 4) & 1) api.text('PRESS START', W / 2, 190, { color: '#fff', align: 'center' });
    drawParticles(g);
  }

  function drawTitle(g) {
    g.globalAlpha = 0.18;
    for (const d of titleDrops) drawIcon(g, d.s, d.x, d.y, 1);
    g.globalAlpha = 1;
    g.fillStyle = '#24170c'; g.fillRect(0, 226, W, 14);           // soil strip with planted flowers
    g.fillStyle = '#3a2716'; g.fillRect(0, 226, W, 2);
    for (let i = 0; i < 10; i++) drawPlanted(g, i % 3, 8 + i * 31, 211);

    ['SPROUT', 'SHOWER'].forEach((word, wi) => {
      const scale = 4, adv = 6 * scale, x0 = W / 2 - (word.length * adv - scale) / 2;
      for (let i = 0; i < word.length; i++) {
        const bob = Math.round(Math.sin(api.time * 3 + i * 0.6 + wi) * 2);
        api.text(word[i], x0 + i * adv, 14 + wi * 32 + bob, { scale, color: KINDS[(i + wi) % 3].main, shadow: '#1a1206' });
      }
    });
    api.text('DROP SEEDS NEXT TO MATCHING SPROUTS', W / 2, 84, { color: '#c5e1a5', align: 'center' });
    drawRulePicture(g, W / 2, 102);

    const arrowL = titleSel > 0 ? '<' : ' ', arrowR = titleSel < best ? '>' : ' ';
    api.text(`${arrowL} LEVEL ${String(titleSel + 1).padStart(2, '0')} ${arrowR}`, W / 2, 126, { color: '#fff', align: 'center' });
    api.text(LEVELS[titleSel].name, W / 2, 137, { color: '#ffd54f', align: 'center' });
    if ((api.frame >> 5) & 1) api.text('PRESS START', W / 2, 156, { scale: 2, color: '#fff', align: 'center', shadow: '#33691e' });
    api.text(`HI ${hiScore}   BEST LEVEL ${best + 1}`, W / 2, 180, { color: '#c5b38a', align: 'center' });
    api.text('ARROWS MOVE  UP DROP  J/K TURN', W / 2, 194, { color: '#8d9e7f', align: 'center' });
  }

  // ===========================================================================
  // 9. AUDIO
  // ===========================================================================
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Original 4-bar pastoral loop in C major pentatonic (0 = rest), eighth notes.
  const MELODY = [
    72, 0, 76, 79, 81, 79, 76, 0,
    74, 76, 74, 72, 69, 0, 72, 0,
    67, 69, 72, 0, 76, 74, 72, 74,
    76, 0, 79, 76, 74, 0, 72, 0,
  ];
  const BASS = [48, 55, 52, 55, 45, 52, 48, 52, 41, 48, 45, 48, 43, 50, 47, 43];

  function updateMusic() {
    if (api.frame < musicNext) return;
    const eighthFrames = levelIdx >= 13 ? 8 : levelIdx >= 6 ? 9 : 10;
    const e = eighthFrames / 60, bar = musicBar % 4;
    for (let i = 0; i < 8; i++) {
      const m = MELODY[bar * 8 + i];
      if (!m) continue;
      const held = i < 7 && !MELODY[bar * 8 + i + 1] ? 1.8 : 0.9;
      api.sound.tone(midi(m), e * held, { type: 'triangle', vol: 0.045, delay: i * e });
    }
    for (let i = 0; i < 4; i++) api.sound.tone(midi(BASS[bar * 4 + i]), e * 1.7, { type: 'sine', vol: 0.07, delay: i * e * 2 });
    musicBar++;
    musicNext = api.frame + eighthFrames * 8;
  }

  function jingle(freqs, step = 0.07, type = 'triangle', vol = 0.1) {
    freqs.forEach((f, i) => api.sound.tone(f, step * 1.3, { type, vol, delay: i * step }));
  }
  function sfxMove() { api.sound.tone(330, 0.025, { type: 'triangle', vol: 0.05 }); }
  function sfxTurn() { api.sound.tone(520, 0.04, { type: 'sine', vol: 0.07, slide: 700 }); }
  function sfxLand() { api.sound.noise(0.06, { vol: 0.09, filter: 600 }); api.sound.tone(150, 0.05, { type: 'sine', vol: 0.06 }); }
  function sfxPause() { api.sound.tone(660, 0.06, { vol: 0.07 }); api.sound.tone(440, 0.08, { vol: 0.07, delay: 0.07 }); }
  function sfxBloom(n) {
    const base = [523, 587, 659, 784, 880, 1047][Math.min(n - 1, 5)];
    jingle([base, base * 1.25, base * 1.5, base * 2], 0.05, 'sine', 0.1);
  }
  function sfxLevelStart() { jingle([392, 523, 659, 784], 0.08); }
  function sfxLevelClear() { jingle([523, 659, 784, 1047, 880, 1047, 1319], 0.09, 'triangle', 0.12); }
  function sfxGameOver() {
    api.sound.stopAll();
    jingle([523, 466, 392, 330, 262], 0.16);
    api.sound.tone(130, 0.8, { type: 'sine', vol: 0.1, slide: 60, delay: 0.8 });
  }
  function sfxVictory() {
    api.sound.stopAll();
    jingle([523, 659, 784, 1047, 784, 1047, 1319, 1568, 1319, 1568, 2093], 0.1, 'triangle', 0.12);
  }

  return { update, draw };
}
