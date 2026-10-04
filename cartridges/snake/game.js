// SNAKE — a VG-Remix cartridge.
// Classic grid snake across 20 levels: walls, wrap-around edges, portals, poison fruit,
// rotting apples, speed pads, shrink pills, sliding saw blocks and levels played in the dark.
//
// Sections: 1. constants & tuning  2. level data  3. game state  4. level setup
//           5. gameplay rules  6. state machine / update  7. drawing  8. audio

export default function boot(api) {
  const { W, H } = api;

  /* ============================== 1. CONSTANTS & TUNING ============================== */

  const CELL = 8;                    // pixels per grid cell
  const COLS = 40, ROWS = 28;        // 320 x 224 play field
  const TOP = 16;                    // HUD height; the field starts below it
  const N = COLS * ROWS;

  const START_LIVES = 3, MAX_LIVES = 5;
  const START_GROW = 3;              // the snake hatches from one cell and grows out to 4
  const GROW_PER_APPLE = 2;
  const SPEED_PER_APPLE = 0.12;      // cells/second added per apple eaten this level
  const BOOST_TICKS = 180, BOOST_MULT = 1.6;
  const COMBO_TICKS = 180, MAX_COMBO = 5;
  const BONUS_TICKS = 420;           // gold star lifetime
  const PILL_TICKS = 600;            // shrink pill lifetime
  const PILL_SHRINK = 6;
  const POISON_SHRINK = 3;
  const POISON_SHUFFLE_TICKS = 300;  // one poison fruit hops elsewhere this often
  const INTRO_TICKS = 200, CLEAR_TICKS = 150;

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const PORTAL_COLORS = ['#4dd0e1', '#f06292', '#ffb74d', '#aed581'];

  const THEMES = [
    { wall: '#3d7a4a', hi: '#74c483', lo: '#1f4527', bg1: '#09120c', bg2: '#0c1710', accent: '#a5d6a7' }, // meadow
    { wall: '#3b6e8f', hi: '#74acd0', lo: '#1e3a4d', bg1: '#090f15', bg2: '#0c141b', accent: '#90caf9' }, // ice
    { wall: '#8a5a2b', hi: '#c99257', lo: '#4a2f14', bg1: '#130d08', bg2: '#18110b', accent: '#ffcc80' }, // desert
    { wall: '#6a3d8f', hi: '#a476cc', lo: '#371d4d', bg1: '#0f0915', bg2: '#140c1b', accent: '#ce93d8' }, // void
    { wall: '#8f3b3b', hi: '#cc7474', lo: '#4d1e1e', bg1: '#140909', bg2: '#1a0c0c', accent: '#ef9a9a' }, // lava
  ];

  /* ================================== 2. LEVEL DATA ================================== */

  // Layout builders draw walls into the grid with a tiny builder: rect / clear / box.
  const LAYOUTS = {
    open() {},
    pillars(b) {
      for (const [x, y] of [[8, 6], [29, 6], [8, 19], [29, 19]]) b.rect(x, y, 3, 3);
    },
    cross(b) { b.rect(19, 4, 2, 20); b.rect(6, 13, 28, 2); },
    corners(b) {
      b.rect(4, 4, 6, 1); b.rect(4, 4, 1, 4); b.rect(30, 4, 6, 1); b.rect(35, 4, 1, 4);
      b.rect(4, 23, 6, 1); b.rect(4, 20, 1, 4); b.rect(30, 23, 6, 1); b.rect(35, 20, 1, 4);
    },
    corridors(b) { b.rect(0, 6, 33, 1); b.rect(7, 13, 33, 1); b.rect(0, 20, 33, 1); },
    halves(b) { b.rect(19, 0, 2, ROWS); },
    bars(b) { b.rect(10, 7, 20, 1); b.rect(10, 20, 20, 1); },
    track(b) { b.rect(9, 8, 22, 12); },
    rooms(b) {
      b.rect(19, 0, 2, ROWS); b.rect(0, 13, COLS, 2);
      b.clear(19, 5, 2, 3); b.clear(19, 20, 2, 3); b.clear(8, 13, 3, 2); b.clear(29, 13, 3, 2);
    },
    sealed(b) { b.rect(19, 0, 2, ROWS); b.rect(0, 13, COLS, 2); },
    rings(b) {
      b.box(4, 4, 32, 20); b.clear(4, 12, 1, 4);    // outer ring, door on the left
      b.box(9, 9, 22, 10); b.clear(30, 12, 1, 4);   // inner ring, door on the right
      b.rect(14, 13, 12, 2);                        // core bar
    },
    posts(b) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) b.rect(6 + i * 9, 5 + j * 8, 2, 2);
    },
    pit(b) {
      for (const [x, y] of [[6, 5], [32, 5], [6, 21], [32, 21], [19, 13]]) b.rect(x, y, 2, 2);
      b.rect(13, 9, 1, 3); b.rect(26, 16, 1, 3); b.rect(26, 9, 1, 3); b.rect(13, 16, 1, 3);
    },
    labyrinth: buildLabyrinth,
    overdrive(b) { b.rect(12, 6, 16, 1); b.rect(12, 21, 16, 1); b.rect(4, 10, 1, 8); b.rect(35, 10, 1, 8); },
    gauntlet(b) { b.rect(19, 3, 2, 9); b.rect(19, 16, 2, 9); b.rect(4, 13, 12, 2); b.rect(24, 13, 12, 2); },
  };

  // A braided maze of 3-wide corridors on a 10x7 room lattice, always generated from the same seed.
  function buildLabyrinth(b) {
    let seed = 20261;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const CW = 10, CH = 7;
    for (let i = 0; i < CW - 1; i++) b.rect(i * 4 + 3, 0, 1, ROWS);
    for (let j = 0; j < CH - 1; j++) b.rect(0, j * 4 + 3, COLS, 1);
    const span = (c, last) => (c === last ? 4 : 3);   // the last room in a row/column is 4 wide
    const open = (ax, ay, bx, by) => {
      if (ax !== bx) b.clear(Math.min(ax, bx) * 4 + 3, ay * 4, 1, span(ay, CH - 1));
      else b.clear(ax * 4, Math.min(ay, by) * 4 + 3, span(ax, CW - 1), 1);
    };
    const seen = new Uint8Array(CW * CH);
    const stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1], cx = c % CW, cy = (c / CW) | 0;
      const options = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => [cx + dx, cy + dy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < CW && y < CH && !seen[y * CW + x]);
      if (!options.length) { stack.pop(); continue; }
      const [nx, ny] = options[Math.floor(rnd() * options.length)];
      open(cx, cy, nx, ny);
      seen[ny * CW + nx] = 1;
      stack.push(ny * CW + nx);
    }
    // Braid: knock out extra walls so there are loops instead of deadly dead ends.
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      if (x < CW - 1 && rnd() < 0.3) open(x, y, x + 1, y);
      if (y < CH - 1 && rnd() < 0.3) open(x, y, x, y + 1);
    }
  }

  // Level fields: name, goal (apples), speed (cells/s), layout, theme, tip (1-2 lines),
  // optional: start [x,y,dir], wrap, portals [[ax,ay,bx,by]], pads [[x,y]], movers [[x,y,dx,dy,ticksPerMove]],
  //           expire (apple lifetime s), poison (count), bonus (star every N apples), shrink (pill every N), dark.
  const LEVELS = [
    { name: 'GARDEN', goal: 5, speed: 6.5, layout: 'open', theme: 0,
      tip: ['EAT APPLES TO GROW.', 'DON\'T HIT THE FENCE OR YOURSELF!'] },
    { name: 'NO FENCE', goal: 6, speed: 7, layout: 'open', theme: 0, wrap: true,
      tip: ['NO FENCE HERE: THE EDGES', 'WRAP AROUND TO THE OTHER SIDE.'] },
    { name: 'PILLARS', goal: 8, speed: 7.5, layout: 'pillars', theme: 0, bonus: 4,
      tip: ['GOLD STARS POP UP NOW AND THEN.', 'GRAB THEM FOR BIG POINTS!'] },
    { name: 'CROSSROADS', goal: 8, speed: 8, layout: 'cross', theme: 2, wrap: true, bonus: 4, start: [8, 6, 'right'],
      tip: ['EAT QUICKLY TO BUILD A COMBO', 'MULTIPLIER, UP TO X5.'] },
    { name: 'TICK TOCK', goal: 8, speed: 8, layout: 'corners', theme: 2, expire: 7, bonus: 4,
      tip: ['APPLES ROT! EAT EACH ONE', 'BEFORE ITS TIMER RUNS OUT.'] },
    { name: 'CORRIDORS', goal: 10, speed: 8.5, layout: 'corridors', theme: 2, bonus: 4, start: [4, 24, 'right'],
      tip: ['WIND YOUR WAY THROUGH', 'THE GAPS AT THE ENDS.'] },
    { name: 'WORMHOLES', goal: 10, speed: 8.5, layout: 'halves', theme: 1, bonus: 4, start: [6, 14, 'right'],
      portals: [[9, 6, 30, 21], [9, 21, 30, 6]],
      tip: ['PORTALS OF THE SAME COLOR', 'ARE LINKED. DIVE IN!'] },
    { name: 'BITTER FRUIT', goal: 10, speed: 9, layout: 'bars', theme: 1, wrap: true, poison: 4, bonus: 4,
      tip: ['PURPLE FRUIT IS POISON: IT', 'SHRINKS YOU AND UNDOES AN APPLE.'] },
    { name: 'SPEEDWAY', goal: 12, speed: 8, layout: 'track', theme: 1, bonus: 4, start: [5, 4, 'right'],
      pads: [[19, 3], [20, 3], [19, 24], [20, 24], [4, 13], [4, 14], [35, 13], [35, 14]],
      tip: ['AMBER PADS GIVE A SPEED', 'BOOST AND DOUBLE POINTS.'] },
    { name: 'FOUR ROOMS', goal: 12, speed: 9, layout: 'rooms', theme: 3, bonus: 2, start: [5, 6, 'right'],
      tip: ['FIND THE DOORWAYS.', 'STARS ARE EVERYWHERE HERE!'] },
    { name: 'SLIDERS', goal: 10, speed: 9, layout: 'open', theme: 3, bonus: 4, start: [4, 14, 'right'],
      movers: [[10, 1, 0, 1, 9], [20, 26, 0, -1, 9], [30, 1, 0, 1, 9]],
      tip: ['SAW BLOCKS SLIDE BACK AND', 'FORTH. ONE TOUCH IS DEATH.'] },
    { name: 'LIGHTS OUT', goal: 10, speed: 8.5, layout: 'pillars', theme: 3, wrap: true, dark: true, bonus: 4,
      tip: ['YOU ONLY SEE WHAT IS NEAR.', 'APPLES GLOW IN THE DARK.'] },
    { name: 'SPIRAL', goal: 12, speed: 9.5, layout: 'rings', theme: 2, shrink: 3, bonus: 4, start: [2, 1, 'right'],
      tip: ['BLUE PILLS SHRINK YOUR TAIL.', 'USE THEM IN TIGHT SPOTS.'] },
    { name: 'PORTAL MAZE', goal: 12, speed: 9.5, layout: 'sealed', theme: 1, bonus: 4, start: [8, 6, 'right'],
      portals: [[15, 4, 24, 23], [15, 23, 24, 4], [4, 9, 35, 9], [4, 18, 35, 18]],
      tip: ['FOUR SEALED ROOMS. ONLY', 'PORTALS LINK THEM TOGETHER.'] },
    { name: 'GRINDER', goal: 12, speed: 10, layout: 'corridors', theme: 4, bonus: 4, start: [3, 25, 'right'],
      movers: [[20, 2, 1, 0, 10], [10, 9, -1, 0, 10], [25, 16, 1, 0, 10], [15, 23, -1, 0, 10]],
      tip: ['A SAW PATROLS EVERY HALL.', 'TIME YOUR DASH.'] },
    { name: 'SNAKE PIT', goal: 14, speed: 10.5, layout: 'pit', theme: 0, wrap: true, poison: 7, expire: 7, bonus: 4,
      tip: ['POISON EVERYWHERE, AND THE', 'APPLES ROT. STAY SHARP.'] },
    { name: 'NIGHT RUN', goal: 12, speed: 9.5, layout: 'posts', theme: 3, dark: true, bonus: 4, start: [2, 2, 'right'],
      movers: [[11, 1, 0, 1, 10], [28, 26, 0, -1, 10], [2, 9, 1, 0, 12]],
      tip: ['SAWS IN THE DARK. WATCH', 'FOR THEIR RED EYES.'] },
    { name: 'LABYRINTH', goal: 14, speed: 9.5, layout: 'labyrinth', theme: 2, shrink: 3, bonus: 4, start: [1, 13, 'right'],
      portals: [[1, 1, 37, 25], [37, 1, 1, 25]],
      tip: ['A MAZE OF NARROW HALLS.', 'CORNER PORTALS CUT ACROSS.'] },
    { name: 'OVERDRIVE', goal: 15, speed: 11.5, layout: 'overdrive', theme: 4, wrap: true, expire: 6, bonus: 3, start: [6, 3, 'right'],
      pads: [[9, 13], [14, 14], [19, 13], [20, 14], [25, 13], [30, 14], [20, 2], [20, 25]],
      tip: ['FULL THROTTLE. APPLES ROT', 'FAST, AND THE PADS GO FASTER.'] },
    { name: 'THE GAUNTLET', goal: 20, speed: 10.5, layout: 'gauntlet', theme: 4, poison: 3, expire: 8, shrink: 4, bonus: 4,
      start: [24, 6, 'right'], portals: [[2, 2, 37, 25], [37, 2, 2, 25]],
      movers: [[10, 2, 0, 1, 10], [29, 25, 0, -1, 10], [2, 20, 1, 0, 12]],
      tip: ['EVERYTHING AT ONCE.', 'GOOD LUCK, SNAKE.'] },
  ];

  /* ================================== 3. GAME STATE ================================== */

  // Static per-level grids (cell index = y * COLS + x).
  const grid = new Uint8Array(N);       // 1 = wall
  const occ = new Uint16Array(N);       // how many snake segments sit in each cell
  const portalTo = new Int16Array(N);   // partner cell of a portal, or -1
  const portalCol = new Int8Array(N);   // which portal pair (for color)
  const padAt = new Uint8Array(N);      // 1 = speed pad
  const reach = new Uint8Array(N);      // 1 = reachable from the start (items only spawn here)
  let spawnCells = [];

  let state = 'title';                  // title | intro | playing | paused | dying | clear | gameOver | victory
  let stateT = 0;                       // ticks spent in the current state
  let levelIdx = 0, L = LEVELS[0], theme = THEMES[0];
  let score = 0, lives = START_LIVES;
  let hiScore = api.storage.get('hi', 0);
  let furthest = Math.min(api.storage.get('furthest', 0), LEVELS.length - 1);
  let titleSel = furthest;
  let newHigh = false, gotExtraLife = false, clearBonus = 0;

  // Snake: cell indices, head first.
  let snake = [], dir = 'right', lastStepDir = 'right', queue = [];
  let grow = 0, started = false, stepAcc = 0;
  let eaten = 0, combo = 1, comboT = 0, boostT = 0;

  // Items are { i, life, max } (life 0 = never expires). Movers are { i, dx, dy, every, t }.
  let food = null, bonus = null, pill = null, poisons = [], movers = [];
  let applesSinceBonus = 0, applesSincePill = 0, poisonShuffleT = 0;

  // Juice.
  const particles = [], popups = [];
  let shake = 0, flash = 0, flashColor = '#fff';
  let deathCause = '', deathIdx = 0;
  let boardCanvas = null, darkCanvas = null;

  const cellX = (i) => i % COLS;
  const cellY = (i) => (i / COLS) | 0;
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ================================== 4. LEVEL SETUP ================================== */

  function makeBuilder() {
    const fill = (x, y, w, h, v) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
        if (i >= 0 && j >= 0 && i < COLS && j < ROWS) grid[j * COLS + i] = v;
    };
    return {
      rect: (x, y, w, h) => fill(x, y, w, h, 1),
      clear: (x, y, w, h) => fill(x, y, w, h, 0),
      box(x, y, w, h) { fill(x, y, w, 1, 1); fill(x, y + h - 1, w, 1, 1); fill(x, y, 1, h, 1); fill(x + w - 1, y, 1, h, 1); },
    };
  }

  function loadLevel(idx) {
    levelIdx = idx;
    L = LEVELS[idx];
    theme = THEMES[L.theme];
    grid.fill(0); occ.fill(0); portalTo.fill(-1); padAt.fill(0);
    LAYOUTS[L.layout](makeBuilder());
    (L.portals || []).forEach(([ax, ay, bx, by], k) => {
      const a = ay * COLS + ax, b = by * COLS + bx;
      grid[a] = grid[b] = 0;
      portalTo[a] = b; portalTo[b] = a;
      portalCol[a] = portalCol[b] = k;
    });
    for (const [x, y] of L.pads || []) { grid[y * COLS + x] = 0; padAt[y * COLS + x] = 1; }

    const [sx, sy, sd] = L.start || [8, 14, 'right'];
    const s = sy * COLS + sx;
    grid[s] = 0;
    snake = [s]; occ[s] = 1;
    dir = lastStepDir = sd; queue = [];
    grow = START_GROW; started = false; stepAcc = 0;
    eaten = 0; combo = 1; comboT = 0; boostT = 0;
    computeReach(s);

    movers = (L.movers || []).map(([x, y, dx, dy, every]) => ({ i: y * COLS + x, dx, dy, every, t: 0 }));
    bonus = pill = null;
    applesSinceBonus = applesSincePill = 0;
    food = spawnItem(appleLife());
    poisons = [];
    for (let k = 0; k < (L.poison || 0); k++) { const p = spawnItem(0); if (p) poisons.push(p); }
    poisonShuffleT = POISON_SHUFFLE_TICKS;
    particles.length = 0; popups.length = 0;
    renderBoard();
  }

  // Flood fill from the start (following wrap edges and portals) so items never spawn out of reach.
  function computeReach(start) {
    reach.fill(0);
    const queueCells = [start];
    reach[start] = 1;
    while (queueCells.length) {
      const c = queueCells.pop();
      for (const [dx, dy] of Object.values(DIRS)) {
        let x = cellX(c) + dx, y = cellY(c) + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) {
          if (!L.wrap) continue;
          x = (x + COLS) % COLS; y = (y + ROWS) % ROWS;
        }
        const i = y * COLS + x;
        if (grid[i] || reach[i]) continue;
        reach[i] = 1;
        queueCells.push(i);
        const p = portalTo[i];
        if (p >= 0 && !reach[p]) { reach[p] = 1; queueCells.push(p); }
      }
    }
    // Spawnable: reachable, not a wall/portal/pad, and not a dead end (3+ walls around).
    spawnCells = [];
    for (let i = 0; i < N; i++) {
      if (!reach[i] || grid[i] || portalTo[i] >= 0 || padAt[i]) continue;
      let walls = 0;
      for (const [dx, dy] of Object.values(DIRS)) if (isWall(cellX(i) + dx, cellY(i) + dy)) walls++;
      if (walls < 3) spawnCells.push(i);
    }
  }

  function isWall(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return !L.wrap;
    return grid[y * COLS + x] === 1;
  }

  function cellBusy(i) {
    return occ[i] > 0 || (food && food.i === i) || (bonus && bonus.i === i) || (pill && pill.i === i)
      || poisons.some((p) => p.i === i) || movers.some((m) => m.i === i);
  }

  // Random free spawn cell, preferring cells at least 5 steps from the head. -1 if none.
  function randomCell() {
    if (!spawnCells.length) return -1;
    const h = snake[0];
    for (let tries = 0; tries < 300; tries++) {
      const i = spawnCells[Math.floor(Math.random() * spawnCells.length)];
      if (cellBusy(i)) continue;
      if (tries < 150 && Math.abs(cellX(i) - cellX(h)) + Math.abs(cellY(i) - cellY(h)) < 5) continue;
      return i;
    }
    return -1;
  }

  function spawnItem(lifeTicks) {
    const i = randomCell();
    return i < 0 ? null : { i, life: lifeTicks, max: lifeTicks };
  }

  const appleLife = () => (L.expire ? L.expire * 60 : 0);

  /* ================================= 5. GAMEPLAY RULES ================================= */

  function newGame(idx) {
    score = 0; lives = START_LIVES; newHigh = false;
    loadLevel(idx);
    enter('intro');
    sfx.start();
  }

  function enter(s) { state = s; stateT = 0; }

  // Queue up to two turns; ignore repeats and 180-degree reversals (relative to the last queued turn).
  function readTurns(input) {
    for (const d of ['up', 'down', 'left', 'right']) {
      if (!input.pressed[d]) continue;
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (d === last && started) continue;
      if (d === OPPOSITE[last] && snake.length > 1) continue;
      if (queue.length < 2) queue.push(d);
    }
  }

  const currentSpeed = () => (L.speed + eaten * SPEED_PER_APPLE) * (boostT > 0 ? BOOST_MULT : 1);

  function stepSnake() {
    if (queue.length) dir = queue.shift();
    const [dx, dy] = DIRS[dir];
    const head = snake[0];
    let x = cellX(head) + dx, y = cellY(head) + dy;
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) {
      if (!L.wrap) return killSnake('YOU HIT THE FENCE');
      x = (x + COLS) % COLS; y = (y + ROWS) % ROWS;
    }
    let next = y * COLS + x;
    if (grid[next]) return killSnake('YOU HIT A WALL');
    if (portalTo[next] >= 0) {
      burst(next, PORTAL_COLORS[portalCol[next]], 8);
      next = portalTo[next];
      burst(next, PORTAL_COLORS[portalCol[next]], 10);
      sfx.portal();
    }
    if (movers.some((m) => m.i === next)) return killSnake('A SAW GOT YOU');
    const tail = snake[snake.length - 1];
    const tailLeaves = grow === 0 && next === tail && occ[tail] === 1;
    if (occ[next] && !tailLeaves) return killSnake('YOU BIT YOURSELF');

    snake.unshift(next);
    occ[next]++;
    if (grow > 0) grow--;
    else occ[snake.pop()]--;
    if (dir !== lastStepDir) { sfx.turn(); lastStepDir = dir; }
    collect(next);
  }

  function collect(i) {
    if (padAt[i]) {
      if (boostT < BOOST_TICKS - 30) { sfx.boost(); burst(i, '#ffca28', 6); }
      boostT = BOOST_TICKS;
    }
    if (bonus && bonus.i === i) eatBonus();
    if (pill && pill.i === i) eatPill();
    const p = poisons.findIndex((q) => q.i === i);
    if (p >= 0) eatPoison(p);
    if (food && food.i === i) eatApple();
  }

  function eatApple() {
    combo = comboT > 0 ? Math.min(MAX_COMBO, combo + 1) : 1;
    comboT = COMBO_TICKS;
    const pts = (10 + levelIdx * 2) * combo * (boostT > 0 ? 2 : 1);
    addScore(pts, food.i, combo > 1 ? `+${pts} X${combo}` : `+${pts}`, '#fff59d');
    burst(food.i, '#ff5252', 12);
    sfx.eat(combo);
    grow += GROW_PER_APPLE;
    eaten++;
    food = null;
    if (eaten >= L.goal) { levelClear(); return; }
    food = spawnItem(appleLife());
    if (L.bonus && !bonus && ++applesSinceBonus >= L.bonus) {
      bonus = spawnItem(BONUS_TICKS); applesSinceBonus = 0;
      if (bonus) sfx.bonusAppear();
    }
    if (L.shrink && !pill && ++applesSincePill >= L.shrink) { pill = spawnItem(PILL_TICKS); applesSincePill = 0; }
  }

  function eatBonus() {
    const pts = (50 + Math.ceil(bonus.life / 6)) * (boostT > 0 ? 2 : 1);
    addScore(pts, bonus.i, `+${pts}`, '#ffd54f');
    burst(bonus.i, '#ffd54f', 18);
    sfx.bonus();
    flash = 4; flashColor = '#fff3c4';
    bonus = null;
  }

  function eatPill() {
    addScore(25, pill.i, 'SHRINK!', '#80deea');
    burst(pill.i, '#4dd0e1', 14);
    shrinkBy(PILL_SHRINK, '#80deea');
    sfx.pill();
    pill = null;
  }

  function eatPoison(k) {
    const p = poisons[k];
    score = Math.max(0, score - 30);
    eaten = Math.max(0, eaten - 1);
    popup(p.i, '-1 APPLE', '#ce93d8');
    burst(p.i, '#ab47bc', 16);
    shrinkBy(POISON_SHRINK, '#ab47bc');
    sfx.poison();
    shake = 6; flash = 6; flashColor = '#7b1fa2';
    combo = 1; comboT = 0;
    const replacement = spawnItem(0);
    if (replacement) poisons[k] = replacement; else poisons.splice(k, 1);
  }

  // Cancel pending growth first, then drop tail segments (never below 2 segments).
  function shrinkBy(n, color) {
    for (let k = 0; k < n; k++) {
      if (grow > 0) { grow--; continue; }
      if (snake.length <= 2) break;
      const t = snake.pop();
      occ[t]--;
      burst(t, color, 3);
    }
  }

  function addScore(pts, cell, label, color) {
    score += pts;
    popup(cell, label, color);
  }

  function updateMovers() {
    for (const m of movers) {
      if (++m.t < m.every) continue;
      m.t = 0;
      let next = moverTarget(m);
      if (next < 0) { m.dx = -m.dx; m.dy = -m.dy; next = moverTarget(m); }
      if (next < 0) continue;
      if (next === snake[0]) { m.i = next; killSnake('A SAW GOT YOU'); return; }
      m.i = next;
    }
  }

  // Next cell for a mover, or -1 if it must bounce (edges, walls, portals, the snake's body, other saws).
  function moverTarget(m) {
    const x = cellX(m.i) + m.dx, y = cellY(m.i) + m.dy;
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return -1;
    const i = y * COLS + x;
    if (grid[i] || portalTo[i] >= 0) return -1;
    if (i === snake[0]) return i;
    if (occ[i] || movers.some((o) => o.i === i)) return -1;
    return i;
  }

  function killSnake(cause) {
    deathCause = cause;
    deathIdx = 0;
    shake = 14; flash = 8; flashColor = '#ff1744';
    sfx.die();
    enter('dying');
  }

  function levelClear() {
    clearBonus = 50 * (levelIdx + 1) + snake.length * 5;
    score += clearBonus;
    gotExtraLife = (levelIdx + 1) % 5 === 0 && lives < MAX_LIVES && levelIdx + 1 < LEVELS.length;
    if (gotExtraLife) lives++;
    if (levelIdx + 1 < LEVELS.length && levelIdx + 1 > furthest) {
      furthest = levelIdx + 1;
      api.storage.set('furthest', furthest);
    }
    saveHigh();
    sfx.clear();
    enter('clear');
  }

  function saveHigh() {
    if (score > hiScore) { hiScore = score; newHigh = true; api.storage.set('hi', hiScore); }
  }

  /* ============================ 6. STATE MACHINE / UPDATE ============================ */

  function update(input) {
    stateT++;
    if (state === 'title') updateTitle(input);
    else if (state === 'intro') updateIntro(input);
    else if (state === 'playing') updatePlaying(input);
    else if (state === 'paused') updatePaused(input);
    else if (state === 'dying') updateDying();
    else if (state === 'clear') updateClear();
    else if (state === 'gameOver' || state === 'victory') updateEnd(input);
    updateEffects();
  }

  function updateTitle(input) {
    if (input.pressed.left && titleSel > 0) { titleSel--; sfx.blip(); }
    if (input.pressed.right && titleSel < furthest) { titleSel++; sfx.blip(); }
    if (input.pressed.start || input.pressed.a) newGame(titleSel);
  }

  function updateIntro(input) {
    const dirPressed = ['up', 'down', 'left', 'right'].some((d) => input.pressed[d]);
    if (stateT > 15 && (input.pressed.a || input.pressed.start || dirPressed)) {
      enter('playing');
      readTurns(input);
    } else if (stateT >= INTRO_TICKS) enter('playing');
  }

  function updatePlaying(input) {
    if (input.pressed.start) { enter('paused'); sfx.pause(); return; }
    readTurns(input);
    if (!started) {
      if (!queue.length) return;      // the snake waits for the first direction
      started = true;
      stepAcc = 1;
    }
    if (comboT > 0 && --comboT === 0) combo = 1;
    if (boostT > 0) boostT--;
    tickItems();
    updateMovers();
    if (state !== 'playing') return;
    stepAcc += currentSpeed() / 60;
    while (stepAcc >= 1 && state === 'playing') { stepAcc -= 1; stepSnake(); }
  }

  function tickItems() {
    if (food && food.max && --food.life <= 0) {
      burst(food.i, '#8d6e63', 10);
      popup(food.i, 'ROTTEN', '#bcaaa4');
      sfx.rot();
      combo = 1; comboT = 0;
      food = null;
    }
    if (!food) food = spawnItem(appleLife());
    if (bonus && --bonus.life <= 0) { burst(bonus.i, '#8d7a3a', 6); bonus = null; }
    if (pill && --pill.life <= 0) { burst(pill.i, '#37707a', 6); pill = null; }
    if (poisons.length && --poisonShuffleT <= 0) {
      poisonShuffleT = POISON_SHUFFLE_TICKS;
      const k = Math.floor(Math.random() * poisons.length);
      const moved = spawnItem(0);
      if (moved) { burst(poisons[k].i, '#4a148c', 5); poisons[k] = moved; }
    }
  }

  function updatePaused(input) {
    if (input.pressed.start) { enter('playing'); sfx.pause(); }
    else if (input.pressed.select) { saveHigh(); titleSel = Math.min(levelIdx, furthest); enter('title'); sfx.blip(); }
  }

  function updateDying() {
    // Burst the snake one segment at a time, head to tail.
    if (stateT > 20 && stateT % 2 === 0 && deathIdx < snake.length) {
      burst(snake[deathIdx], deathIdx === 0 ? '#ffffff' : segmentColor(deathIdx, snake.length), 6);
      if (deathIdx % 3 === 0) sfx.pop();
      deathIdx++;
    }
    if (deathIdx >= snake.length && stateT > 20 + snake.length * 2 + 70) {
      lives--;
      if (lives <= 0) { saveHigh(); sfx.over(); enter('gameOver'); }
      else { loadLevel(levelIdx); enter('intro'); }
    }
  }

  function updateClear() {
    if (stateT % 4 === 0) burst(snake[Math.floor(Math.random() * snake.length)], '#fff59d', 3);
    if (stateT < CLEAR_TICKS) return;
    if (levelIdx + 1 >= LEVELS.length) { saveHigh(); sfx.win(); enter('victory'); }
    else { loadLevel(levelIdx + 1); enter('intro'); }
  }

  function updateEnd(input) {
    if (state === 'victory' && stateT % 18 === 0) {
      const colors = ['#ff5252', '#ffd54f', '#69f0ae', '#40c4ff', '#e040fb'];
      const c = colors[Math.floor(Math.random() * colors.length)];
      burstAt(30 + Math.random() * (W - 60), 40 + Math.random() * 120, c, 24, 2.2);
      sfx.firework();
    }
    if (stateT > 45 && (input.pressed.start || input.pressed.a)) {
      titleSel = furthest;
      enter('title');
      sfx.blip();
    }
  }

  function updateEffects() {
    for (let k = particles.length - 1; k >= 0; k--) {
      const p = particles[k];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy = p.vy * 0.94 + 0.04;
      if (--p.life <= 0) particles.splice(k, 1);
    }
    for (let k = popups.length - 1; k >= 0; k--) {
      popups[k].y -= 0.4;
      if (--popups[k].life <= 0) popups.splice(k, 1);
    }
    if (shake > 0) shake--;
    if (flash > 0) flash--;
  }

  function burst(cell, color, n) {
    burstAt(cellX(cell) * CELL + 4, TOP + cellY(cell) * CELL + 4, color, n, 1.4);
  }

  function burstAt(x, y, color, n, power) {
    for (let k = 0; k < n && particles.length < 400; k++) {
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * power;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 20 + Math.random() * 25, color });
    }
  }

  function popup(cell, text, color) {
    popups.push({ x: cellX(cell) * CELL + 4, y: TOP + cellY(cell) * CELL - 4, text, color, life: 50 });
  }

  /* ==================================== 7. DRAWING ==================================== */

  function draw(g) {
    g.fillStyle = '#050805';
    g.fillRect(0, 0, W, H);
    if (state === 'title') { drawTitle(g); return; }

    g.save();
    if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * shake * 0.6), Math.round((Math.random() - 0.5) * shake * 0.6));
    drawField(g);
    g.restore();
    drawHud(g);

    if (state === 'intro') drawIntroCard(g);
    else if (state === 'playing' && !started) drawStartHint(g);
    else if (state === 'paused') drawPaused(g);
    else if (state === 'dying') drawDeathText(g);
    else if (state === 'clear') drawClear(g);
    else if (state === 'gameOver') drawGameOver(g);
    else if (state === 'victory') drawVictory(g);

    if (flash > 0) {
      g.globalAlpha = flash / 16;
      g.fillStyle = flashColor;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  // Static background + walls, cached per level.
  function renderBoard() {
    if (!boardCanvas) boardCanvas = new OffscreenCanvas(W, ROWS * CELL);
    const b = boardCanvas.getContext('2d');
    b.fillStyle = theme.bg1;
    b.fillRect(0, 0, W, ROWS * CELL);
    b.fillStyle = theme.bg2;
    for (let y = 0; y < ROWS; y++) for (let x = (y & 1); x < COLS; x += 2) b.fillRect(x * CELL, y * CELL, CELL, CELL);
    const wallAt = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y * COLS + x] === 1;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!grid[y * COLS + x]) continue;
      const px = x * CELL, py = y * CELL;
      b.fillStyle = theme.wall; b.fillRect(px, py, CELL, CELL);
      b.fillStyle = theme.hi;
      if (!wallAt(x, y - 1)) b.fillRect(px, py, CELL, 1);
      if (!wallAt(x - 1, y)) b.fillRect(px, py, 1, CELL);
      b.fillStyle = theme.lo;
      if (!wallAt(x, y + 1)) b.fillRect(px, py + 7, CELL, 1);
      if (!wallAt(x + 1, y)) b.fillRect(px + 7, py, 1, CELL);
      if ((x + y) % 2 === 0) b.fillRect(px + 3, py + 3, 2, 2);
    }
    const fh = ROWS * CELL;
    if (L.wrap) {
      // Dashed edge = open border.
      b.fillStyle = theme.accent;
      b.globalAlpha = 0.35;
      for (let x = 0; x < W; x += 6) { b.fillRect(x, 0, 3, 1); b.fillRect(x, fh - 1, 3, 1); }
      for (let y = 0; y < fh; y += 6) { b.fillRect(0, y, 1, 3); b.fillRect(W - 1, y, 1, 3); }
      b.globalAlpha = 1;
    } else {
      b.fillStyle = theme.hi;
      b.fillRect(0, 0, W, 1); b.fillRect(0, fh - 1, W, 1); b.fillRect(0, 0, 1, fh); b.fillRect(W - 1, 0, 1, fh);
    }
  }

  function drawField(g) {
    if (boardCanvas) g.drawImage(boardCanvas, 0, TOP);
    const t = api.frame;

    for (let i = 0; i < N; i++) {
      if (padAt[i]) drawPad(g, cellX(i) * CELL, TOP + cellY(i) * CELL, t);
      else if (portalTo[i] >= 0) drawPortal(g, cellX(i) * CELL, TOP + cellY(i) * CELL, PORTAL_COLORS[portalCol[i]], t);
    }
    for (const p of poisons) drawPoison(g, p.i, t);
    if (pill) drawPill(g, pill, t);
    if (bonus) drawStar(g, bonus, t);
    if (food) drawApple(g, food, t);
    for (const m of movers) drawSaw(g, m.i, t);

    const dead = state === 'dying' || state === 'gameOver';
    if (!(state === 'gameOver')) {
      drawSnake(g, snake, TOP, dir, {
        from: dead ? deathIdx : 0,
        flashWhite: (state === 'dying' && stateT < 20 && (stateT >> 2) % 2 === 0) || (state === 'clear' && (stateT >> 3) % 2 === 0),
        boost: boostT > 0,
      });
    }

    for (const p of particles) {
      g.fillStyle = p.color;
      g.globalAlpha = Math.min(1, p.life / 15);
      g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    g.globalAlpha = 1;

    if (L.dark && state !== 'clear') drawDarkness(g, t);

    for (const p of popups) {
      g.globalAlpha = Math.min(1, p.life / 15);
      api.text(p.text, p.x, Math.round(p.y), { color: p.color, align: 'center', shadow: '#000' });
    }
    g.globalAlpha = 1;
  }

  // Snake body as joined 6x6 blocks; segments next to each other get a connector filling the gap.
  function segmentColor(k, n) {
    const t = n > 1 ? k / (n - 1) : 0;
    return `hsl(${125 - t * 25}, 62%, ${(k % 2 ? 50 : 56) - t * 22}%)`;
  }

  function drawSnake(g, segs, top, headDir, opts) {
    const n = segs.length;
    for (let k = n - 1; k >= opts.from; k--) {
      const i = segs[k], x = cellX(i), y = cellY(i);
      const px = x * CELL, py = top + y * CELL;
      g.fillStyle = opts.flashWhite ? '#ffffff' : opts.boost ? `hsl(${48 - (k % 2) * 8}, 90%, ${60 - (k / n) * 18}%)` : segmentColor(k, n);
      g.fillRect(px + 1, py + 1, 6, 6);
      if (k > opts.from) {
        const j = segs[k - 1], dx = cellX(j) - x, dy = cellY(j) - y;
        if (dx === 1 && dy === 0) g.fillRect(px + 7, py + 1, 2, 6);
        else if (dx === -1 && dy === 0) g.fillRect(px - 1, py + 1, 2, 6);
        else if (dy === 1 && dx === 0) g.fillRect(px + 1, py + 7, 6, 2);
        else if (dy === -1 && dx === 0) g.fillRect(px + 1, py - 1, 6, 2);
      }
      if (k > 0 && k % 3 === 1 && !opts.flashWhite) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(px + 3, py + 3, 2, 2);
      }
    }
    if (opts.from > 0 || !n) return;

    // Head: eyes looking where we're going, plus a flicking tongue.
    const h = segs[0], px = cellX(h) * CELL, py = top + cellY(h) * CELL;
    const [dx, dy] = DIRS[headDir];
    const eyes = dx !== 0
      ? [[dx > 0 ? px + 4 : px + 1, py + 1], [dx > 0 ? px + 4 : px + 1, py + 5]]
      : [[px + 1, dy > 0 ? py + 4 : py + 1], [px + 5, dy > 0 ? py + 4 : py + 1]];
    for (const [ex, ey] of eyes) {
      g.fillStyle = '#ffffff'; g.fillRect(ex, ey, 2, 2);
      g.fillStyle = '#102010'; g.fillRect(ex + (dx > 0 ? 1 : 0), ey + (dy > 0 ? 1 : 0), 1, 1);
    }
    if (api.frame % 70 < 8) {
      g.fillStyle = '#ff4d6d';
      if (dx > 0) g.fillRect(px + 7, py + 3, 3, 1);
      else if (dx < 0) g.fillRect(px - 2, py + 4, 3, 1);
      else if (dy > 0) g.fillRect(px + 4, py + 7, 1, 3);
      else g.fillRect(px + 3, py - 2, 1, 3);
    }
  }

  function itemPos(item) { return [cellX(item.i) * CELL, TOP + cellY(item.i) * CELL]; }

  // Expiring items blink in their last two seconds and show a shrinking timer bar.
  function fading(item, t) {
    return item.max > 0 && item.life < 120 && (t >> 2) % 2 === 0;
  }

  function drawTimerBar(g, item, px, py) {
    if (!item.max) return;
    const frac = item.life / item.max;
    g.fillStyle = frac > 0.35 ? '#81c784' : '#ff7043';
    g.fillRect(px, py + 8, Math.max(1, Math.round(8 * frac)), 1);
  }

  function drawApple(g, item, t) {
    const [px, py] = itemPos(item);
    drawTimerBar(g, item, px, py);
    if (!fading(item, t)) drawAppleAt(g, px, py, t);
  }

  function drawAppleAt(g, px, py, t) {
    const bob = (t >> 4) % 2;
    g.fillStyle = '#e53935';
    g.fillRect(px + 1, py + 3 - bob, 6, 4);
    g.fillRect(px + 2, py + 2 - bob, 4, 6);
    g.fillStyle = '#ff8a80';
    g.fillRect(px + 2, py + 3 - bob, 1, 2);
    g.fillStyle = '#6d4c41';
    g.fillRect(px + 4, py + 1 - bob, 1, 2);
    g.fillStyle = '#66bb6a';
    g.fillRect(px + 5, py + 1 - bob, 2, 1);
  }

  function drawStar(g, item, t) {
    const [px, py] = itemPos(item);
    drawTimerBar(g, item, px, py);
    if (fading(item, t)) return;
    g.fillStyle = (t >> 3) % 2 ? '#ffd54f' : '#ffecb3';
    g.fillRect(px + 3, py, 2, 8);
    g.fillRect(px, py + 3, 8, 2);
    g.fillRect(px + 2, py + 2, 4, 4);
    g.fillStyle = '#ff8f00';
    g.fillRect(px + 3, py + 3, 2, 2);
  }

  function drawPill(g, item, t) {
    const [px, py] = itemPos(item);
    drawTimerBar(g, item, px, py);
    if (fading(item, t)) return;
    g.fillStyle = '#26c6da';
    g.fillRect(px + 1, py + 2, 3, 4);
    g.fillStyle = '#e0f7fa';
    g.fillRect(px + 4, py + 2, 3, 4);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    if ((t >> 4) % 2) g.fillRect(px + 2, py + 3, 1, 1);
  }

  function drawPoison(g, i, t) {
    const px = cellX(i) * CELL, py = TOP + cellY(i) * CELL;
    const wob = (t >> 5) % 2;
    g.fillStyle = '#8e24aa';
    g.fillRect(px + 1, py + 2, 6, 5);
    g.fillRect(px + 2, py + 1 + wob, 4, 7 - wob);
    g.fillStyle = '#e1bee7';     // little skull face
    g.fillRect(px + 2, py + 3, 1, 1); g.fillRect(px + 5, py + 3, 1, 1);
    g.fillRect(px + 3, py + 5, 2, 1);
  }

  function drawPad(g, px, py, t) {
    g.fillStyle = '#3e2c00';
    g.fillRect(px, py, CELL, CELL);
    const r = (t >> 3) % 4;          // a square ripple pulsing out from the center
    g.fillStyle = '#ffb300';
    g.fillRect(px + 3 - r, py + 3 - r, 2 + r * 2, 1); g.fillRect(px + 3 - r, py + 4 + r, 2 + r * 2, 1);
    g.fillRect(px + 3 - r, py + 3 - r, 1, 2 + r * 2); g.fillRect(px + 4 + r, py + 3 - r, 1, 2 + r * 2);
    g.fillStyle = '#fff176';
    g.fillRect(px + 3, py + 3, 2, 2);
  }

  function drawPortal(g, px, py, color, t) {
    g.fillStyle = color;
    g.fillRect(px + 2, py, 4, 1); g.fillRect(px + 2, py + 7, 4, 1);
    g.fillRect(px, py + 2, 1, 4); g.fillRect(px + 7, py + 2, 1, 4);
    g.fillRect(px + 1, py + 1, 1, 1); g.fillRect(px + 6, py + 1, 1, 1);
    g.fillRect(px + 1, py + 6, 1, 1); g.fillRect(px + 6, py + 6, 1, 1);
    g.fillStyle = '#000';
    g.fillRect(px + 1, py + 2, 6, 4); g.fillRect(px + 2, py + 1, 4, 6);
    // A spark orbiting inside.
    const a = t * 0.2;
    g.fillStyle = '#fff';
    g.fillRect(px + 3 + Math.round(Math.cos(a) * 2), py + 3 + Math.round(Math.sin(a) * 2), 2, 2);
  }

  function drawSaw(g, i, t) {
    const px = cellX(i) * CELL, py = TOP + cellY(i) * CELL;
    const spin = (t >> 2) % 2;
    g.fillStyle = '#9e9e9e';
    g.fillRect(px + 1, py + 1, 6, 6);
    g.fillStyle = '#e0e0e0';      // teeth alternate to look like spinning
    if (spin) { g.fillRect(px + 3, py, 2, 1); g.fillRect(px + 3, py + 7, 2, 1); g.fillRect(px, py + 3, 1, 2); g.fillRect(px + 7, py + 3, 1, 2); }
    else { g.fillRect(px, py, 1, 1); g.fillRect(px + 7, py, 1, 1); g.fillRect(px, py + 7, 1, 1); g.fillRect(px + 7, py + 7, 1, 1); }
    g.fillStyle = (t >> 3) % 2 ? '#ff1744' : '#b71c1c';
    g.fillRect(px + 3, py + 3, 2, 2);
  }

  function drawDarkness(g, t) {
    const fh = ROWS * CELL;
    if (!darkCanvas) darkCanvas = new OffscreenCanvas(W, fh);
    const d = darkCanvas.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, fh);
    d.fillStyle = 'rgba(2,3,6,0.97)';
    d.fillRect(0, 0, W, fh);
    d.globalCompositeOperation = 'destination-out';
    const h = snake[0];
    const cx = cellX(h) * CELL + 4, cy = cellY(h) * CELL + 4;
    const r = 46 + Math.sin(t * 0.1) * 2 + (boostT > 0 ? 10 : 0);
    const grad = d.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = grad;
    d.fillRect(cx - r, cy - r, r * 2, r * 2);
    d.globalCompositeOperation = 'source-over';
    g.drawImage(darkCanvas, 0, TOP);

    // Things that glow: apples, stars, portals and the saws' red eyes.
    const glow = (i, color, size) => {
      g.fillStyle = color;
      g.fillRect(cellX(i) * CELL + 4 - (size >> 1), TOP + cellY(i) * CELL + 4 - (size >> 1), size, size);
    };
    const pulse = (t >> 4) % 2 ? 3 : 2;
    if (food) glow(food.i, '#ff5252', pulse);
    if (bonus) glow(bonus.i, '#ffd54f', pulse);
    for (const m of movers) if ((t >> 3) % 2) glow(m.i, '#ff1744', 2);
    for (let i = 0; i < N; i++) if (portalTo[i] >= 0) glow(i, PORTAL_COLORS[portalCol[i]], 1);
  }

  function drawHud(g) {
    g.fillStyle = '#060b07';
    g.fillRect(0, 0, W, TOP);
    g.fillStyle = theme.lo;
    g.fillRect(0, TOP - 1, W, 1);
    api.text(`LV${pad2(levelIdx + 1)}`, 4, 4, { color: theme.accent });
    for (let k = 0; k < lives; k++) drawHeart(g, 32 + k * 9, 4);
    // Apple progress.
    const ax = 84;
    g.fillStyle = '#e53935'; g.fillRect(ax, 5, 6, 5); g.fillRect(ax + 1, 4, 4, 7);
    g.fillStyle = '#66bb6a'; g.fillRect(ax + 3, 2, 2, 2);
    api.text(`${eaten}/${L.goal}`, ax + 9, 4, { color: '#ffffff' });
    const bx = 130, bw = 70;
    g.fillStyle = '#1b261d'; g.fillRect(bx, 6, bw, 4);
    g.fillStyle = theme.accent; g.fillRect(bx, 6, Math.round(bw * Math.min(1, eaten / L.goal)), 4);
    if (boostT > 0 && (boostT > 50 || (api.frame >> 2) % 2)) api.text('BOOST', 206, 4, { color: '#ffca28' });
    else if (combo > 1) api.text(`X${combo}`, 214, 4, { color: '#fff59d' });
    api.text(String(score).padStart(6, '0'), W - 4, 4, { color: '#ffffff', align: 'right' });
  }

  function drawHeart(g, x, y) {
    g.fillStyle = '#ff5272';
    g.fillRect(x, y + 1, 7, 3); g.fillRect(x + 1, y, 2, 1); g.fillRect(x + 4, y, 2, 1);
    g.fillRect(x + 1, y + 4, 5, 1); g.fillRect(x + 2, y + 5, 3, 1); g.fillRect(x + 3, y + 6, 1, 1);
    g.fillStyle = '#ffc1cc'; g.fillRect(x + 1, y + 1, 1, 1);
  }

  function panel(g, x, y, w, h) {
    g.fillStyle = 'rgba(4,8,6,0.92)';
    g.fillRect(x, y, w, h);
    g.fillStyle = theme.accent;
    g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
  }

  function dim(g, a) {
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(0, TOP, W, H - TOP);
  }

  function drawIntroCard(g) {
    dim(g, 0.45);
    const x = 30, y = 50, w = 260, h = 142;
    panel(g, x, y, w, h);
    const cx = W / 2;
    api.text(`LEVEL ${levelIdx + 1} OF ${LEVELS.length}`, cx, y + 10, { color: '#9e9e9e', align: 'center' });
    api.text(L.name, cx, y + 24, { color: theme.accent, scale: 2, align: 'center', shadow: '#000' });
    api.text(`GOAL: EAT ${L.goal} APPLES`, cx, y + 48, { color: '#ffffff', align: 'center' });
    api.text(L.wrap ? 'EDGES WRAP AROUND' : 'SOLID FENCE', cx, y + 60, { color: L.wrap ? '#80cbc4' : '#ef9a9a', align: 'center' });
    L.tip.forEach((line, k) => api.text(line, cx, y + 80 + k * 10, { color: '#fff59d', align: 'center' }));
    for (let k = 0; k < lives; k++) drawHeart(g, cx - lives * 5 + k * 10, y + 106);
    if ((stateT >> 4) % 2 === 0) api.text('PRESS A DIRECTION TO GO', cx, y + 124, { color: '#ffffff', align: 'center' });
  }

  function drawStartHint(g) {
    if ((api.frame >> 4) % 2) return;
    const h = snake[0];
    const y = cellY(h) > ROWS / 2 ? TOP + 20 : H - 28;
    api.text('PRESS A DIRECTION TO START', W / 2, y, { color: '#ffffff', align: 'center', shadow: '#000' });
  }

  function drawPaused(g) {
    dim(g, 0.6);
    panel(g, 70, 80, 180, 82);
    api.text('PAUSED', W / 2, 92, { color: theme.accent, scale: 2, align: 'center' });
    api.text(`${L.name}: ${eaten}/${L.goal} APPLES`, W / 2, 116, { color: '#ffffff', align: 'center' });
    api.text('START  RESUME', W / 2, 134, { color: '#bdbdbd', align: 'center' });
    api.text('SELECT QUIT', W / 2, 146, { color: '#bdbdbd', align: 'center' });
  }

  function drawDeathText(g) {
    if (stateT < 30) return;
    api.text(deathCause, W / 2, 100, { color: '#ff5252', scale: 2, align: 'center', shadow: '#000' });
    const left = lives - 1;
    api.text(left > 0 ? `${left} ${left === 1 ? 'LIFE' : 'LIVES'} LEFT` : 'NO LIVES LEFT', W / 2, 124, { color: '#ffffff', align: 'center', shadow: '#000' });
  }

  function drawClear(g) {
    const y = 84;
    panel(g, 60, y, 200, gotExtraLife ? 74 : 62);
    api.text('LEVEL CLEAR!', W / 2, y + 10, { color: '#fff59d', scale: 2, align: 'center', shadow: '#000' });
    api.text(`CLEAR BONUS +${clearBonus}`, W / 2, y + 34, { color: '#ffffff', align: 'center' });
    api.text(`LENGTH ${snake.length}`, W / 2, y + 46, { color: '#a5d6a7', align: 'center' });
    if (gotExtraLife && (stateT >> 3) % 2) api.text('EXTRA LIFE!', W / 2, y + 58, { color: '#69f0ae', align: 'center' });
  }

  function drawGameOver(g) {
    dim(g, 0.7);
    panel(g, 50, 64, 220, 116);
    api.text('GAME OVER', W / 2, 76, { color: '#ff5252', scale: 3, align: 'center', shadow: '#000' });
    api.text(`SCORE ${score}`, W / 2, 112, { color: '#ffffff', align: 'center' });
    api.text(`BEST  ${hiScore}`, W / 2, 124, { color: '#bdbdbd', align: 'center' });
    api.text(`REACHED ${L.name} (LV${levelIdx + 1})`, W / 2, 136, { color: '#9e9e9e', align: 'center' });
    if (newHigh) api.text('NEW HIGH SCORE!', W / 2, 150, { color: (api.frame >> 3) % 2 ? '#fff59d' : '#ffb300', align: 'center' });
    if (stateT > 45 && (api.frame >> 4) % 2 === 0) api.text('PRESS START', W / 2, 165, { color: '#ffffff', align: 'center' });
  }

  function drawVictory(g) {
    dim(g, 0.8);
    for (const p of particles) { g.fillStyle = p.color; g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); }
    api.text('YOU WIN!', W / 2, 60, { color: '#fff59d', scale: 4, align: 'center', shadow: '#5d4037' });
    api.text('ALL 20 LEVELS CLEARED.', W / 2, 106, { color: '#ffffff', align: 'center' });
    api.text('LONGEST SNAKE IN THE LAND!', W / 2, 118, { color: '#a5d6a7', align: 'center' });
    api.text(`FINAL SCORE ${score}`, W / 2, 140, { color: '#ffffff', align: 'center', scale: 2 });
    if (newHigh) api.text('NEW HIGH SCORE!', W / 2, 162, { color: '#ffb300', align: 'center' });
    if (stateT > 45 && (api.frame >> 4) % 2 === 0) api.text('PRESS START', W / 2, 190, { color: '#ffffff', align: 'center' });
  }

  // Title: a snake slithers around the screen border while you pick a level.
  const TITLE_PATH = (() => {
    const p = [];
    const x0 = 1, y0 = 1, x1 = COLS - 2, y1 = 28;
    for (let x = x0; x < x1; x++) p.push([x, y0, 'right']);
    for (let y = y0; y < y1; y++) p.push([x1, y, 'down']);
    for (let x = x1; x > x0; x--) p.push([x, y1, 'left']);
    for (let y = y1; y > y0; y--) p.push([x0, y, 'up']);
    return p;
  })();
  const TITLE_LEN = 22;

  function drawTitle(g) {
    g.fillStyle = '#08110a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0b170e';
    for (let y = 0; y < 30; y++) for (let x = (y & 1); x < COLS; x += 2) g.fillRect(x * CELL, y * CELL, CELL, CELL);

    const P = TITLE_PATH.length;
    const headPos = Math.floor(api.time * 11) % P;
    const segs = [];
    for (let k = 0; k < TITLE_LEN; k++) {
      const [x, y] = TITLE_PATH[(headPos - k + P) % P];
      segs.push(y * COLS + x);
    }
    // An apple waits just ahead of the snake.
    const [ax, ay] = TITLE_PATH[(headPos + 14) % P];
    drawAppleAt(g, ax * CELL, ay * CELL, api.frame);
    drawSnake(g, segs, 0, TITLE_PATH[headPos][2], { from: 0, flashWhite: false, boost: false });

    api.text('SNAKE', W / 2, 30, { color: '#66bb6a', scale: 6, align: 'center', shadow: '#1b5e20' });
    api.text('GROW LONG. DON\'T BITE YOURSELF.', W / 2, 82, { color: '#a5d6a7', align: 'center' });

    const sel = LEVELS[titleSel];
    panel(g, 60, 100, 200, 40);
    api.text('START AT', W / 2, 106, { color: '#9e9e9e', align: 'center' });
    api.text(`LV${pad2(titleSel + 1)} ${sel.name}`, W / 2, 120, { color: '#ffffff', align: 'center' });
    if (titleSel > 0) api.text('<', 70, 120, { color: '#fff59d' });
    if (titleSel < furthest) api.text('>', 245, 120, { color: '#fff59d' });

    api.text(`HI-SCORE ${String(hiScore).padStart(6, '0')}`, W / 2, 152, { color: '#ffd54f', align: 'center' });
    if ((api.frame >> 5) % 2 === 0) api.text('PRESS START', W / 2, 172, { color: '#ffffff', scale: 2, align: 'center', shadow: '#1b5e20' });
    api.text('ARROWS STEER   START PAUSE', W / 2, 198, { color: '#81c784', align: 'center' });
    api.text(furthest > 0 ? 'LEFT/RIGHT: CHOOSE LEVEL' : '20 LEVELS TO CONQUER', W / 2, 210, { color: '#558b2f', align: 'center' });
  }

  /* ===================================== 8. AUDIO ===================================== */

  const tone = (f, d, o) => api.sound.tone(f, d, o);
  const jingle = (notes, step, o) => notes.forEach((f, k) => tone(f, step * 1.2, { ...o, delay: k * step }));

  const sfx = {
    turn: () => tone(170, 0.025, { type: 'triangle', vol: 0.05 }),
    eat: (c) => {
      const f = 440 * Math.pow(1.19, c - 1);
      tone(f, 0.06, { vol: 0.12, slide: f * 1.5 });
      tone(f * 2, 0.05, { type: 'triangle', vol: 0.06, delay: 0.05 });
    },
    bonusAppear: () => jingle([1175, 1568, 2093], 0.05, { type: 'triangle', vol: 0.07 }),
    bonus: () => jingle([523, 659, 784, 1047, 1319], 0.04, { vol: 0.1 }),
    pill: () => { tone(900, 0.15, { type: 'sine', vol: 0.12, slide: 300 }); tone(300, 0.12, { type: 'sine', vol: 0.1, slide: 700, delay: 0.13 }); },
    poison: () => { tone(320, 0.3, { type: 'sawtooth', vol: 0.12, slide: 70 }); api.sound.noise(0.15, { vol: 0.08, filter: 700 }); },
    rot: () => tone(240, 0.2, { type: 'triangle', vol: 0.1, slide: 110 }),
    portal: () => tone(300, 0.16, { type: 'sine', vol: 0.12, slide: 1500 }),
    boost: () => { api.sound.noise(0.2, { vol: 0.07, filter: 4000 }); tone(200, 0.22, { type: 'sawtooth', vol: 0.07, slide: 1000 }); },
    die: () => { api.sound.noise(0.5, { vol: 0.2, filter: 1400 }); tone(440, 0.6, { type: 'sawtooth', vol: 0.12, slide: 40 }); },
    pop: () => api.sound.noise(0.05, { vol: 0.06, filter: 3000 }),
    clear: () => jingle([523, 659, 784, 1047, 784, 1047, 1319], 0.08, { vol: 0.1 }),
    over: () => jingle([392, 330, 262, 196], 0.2, { type: 'triangle', vol: 0.14 }),
    win: () => { jingle([523, 523, 523, 659, 784, 659, 784, 1047], 0.12, { vol: 0.1 }); jingle([262, 330, 392, 523], 0.24, { type: 'triangle', vol: 0.08 }); },
    firework: () => api.sound.noise(0.25, { vol: 0.05, filter: 1800 }),
    blip: () => tone(660, 0.04, { vol: 0.08 }),
    start: () => jingle([262, 392, 523, 784], 0.07, { vol: 0.1 }),
    pause: () => tone(440, 0.07, { type: 'triangle', vol: 0.1, slide: 660 }),
  };

  return { update, draw };
}
