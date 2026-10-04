// JUMPER — a VG-Remix cartridge.
// A compact side-scrolling platformer: run, jump and reach the door across 20 short levels in
// four acts. A new element arrives every few levels: spikes, bugs, one-way ledges, springs,
// sliding platforms, crumbling floors, hoppers and lifts.
//
// Sections: 1. constants & tuning  2. palettes  3. level data (chunks + levels)  4. sprites
//           5. audio  6. save data & state  7. level setup  8. tile physics  9. player
//           10. world (enemies, platforms, crumbles)  11. state machine / update  12. drawing

export default function boot(api) {
  const { W, H } = api;

  /* ============================== 1. CONSTANTS & TUNING ============================== */

  const TILE = 16, ROWS = 10;
  const TOP = H - ROWS * TILE;      // world rows fill the bottom 160px; the sky above is open air
  const PW = 8, PH = 14;            // player hitbox
  const GRAVITY = 0.3, MAX_FALL = 6;
  const JUMP_V = -5.4;              // apex ~48px (3 tiles), ~36 ticks of air time
  const JUMP_CUT = -2;              // releasing A early clamps upward speed to this
  const SPRING_V = -8.4;            // apex ~117px
  const STOMP_V = -4;
  const WALK_MAX = 1.6, RUN_MAX = 2.3;
  const ACCEL = 0.15, AIR_ACCEL = 0.1, FRICTION = 0.2, TURN_ACCEL = 0.3;
  const COYOTE = 6, BUFFER = 6;     // ticks of grace for late jumps / early presses
  const CRUMBLE_DELAY = 24, CRUMBLE_RESPAWN = 200;
  const PLAT_W = 48, SLIDE_RANGE = 32, LIFT_RANGE = 64;
  const START_LIVES = 3, GEMS_PER_LIFE = 50;
  const SOLID = '#~J';              // ground, crumble, spring ('=' is one-way, '^' is spikes)

  /* ================================== 2. PALETTES ==================================== */

  const ACTS = [
    { name: 'MEADOW', sky: ['#16213e', '#3f5d8a'], far: '#25395c', near: '#24493f', top: '#7ccf5a', dirt: '#6b4a32',
      dark: '#4d3322', plank: '#d9a866', orb: '#ffe9a8', fx: 'cloud' },
    { name: 'CAVERN', sky: ['#0d0a18', '#2a2040'], far: '#1d1630', near: '#2c2246', top: '#b48cf0', dirt: '#4b3d6b',
      dark: '#30264a', plank: '#a593d0', orb: null, fx: 'drip' },
    { name: 'FROST', sky: ['#06102a', '#1d3a63'], far: '#173052', near: '#28496e', top: '#e6f4ff', dirt: '#56799f',
      dark: '#3b5a7d', plank: '#a9d2f0', orb: '#f0f6ff', fx: 'snow' },
    { name: 'EMBER', sky: ['#150606', '#55190f'], far: '#33100b', near: '#47180e', top: '#ff9a3c', dirt: '#5e2b1e',
      dark: '#3d1b13', plank: '#d48a4a', orb: '#ff6a3a', fx: 'ember' },
  ];

  /* ================================= 3. LEVEL DATA =================================== */

  // Levels are strips of reusable CHUNKS (tile string arrays, bottom-aligned, padded with air up
  // to ROWS rows), so every level's rows stay the same width.
  // Tiles: '.' air  '#' ground  '=' one-way ledge  '^' spikes  '~' crumbling floor  'J' spring
  // Things: 'P' start  'D' exit door  '*' gem  'w' walker bug  'h' hopper
  //         'M' sliding platform (3 tiles, left/right)  'V' lift (3 tiles, up/down)
  const CHUNKS = {
    start: ['P.....', '######', '######'],
    flat: ['######', '######'],
    gems: ['.*.*.*..', '########', '########'],
    arc: ['...**...', '..*..*..', '########', '########'],
    gap2: ['##..##', '##..##'],
    gap3: ['##...##', '##...##'],
    gap3g: ['...*...', '.......', '##...##', '##...##'],
    step: ['....##', '..####', '######', '######'],
    pyramid: ['...**...', '...##...', '..####..', '.######.', '########', '########'],
    pillars: ['...##...##...', '##.##...##.##', '##.##...##.##'],
    spikes: ['...^^...', '########', '########'],
    spikePit: ['...*...', '.......', '##^^^##', '#######'],
    walker: ['..*....*..', '..........', '.....w....', '##########', '##########'],
    ledge: ['....***...', '...====...', '..........', '.====.....', '..........', '##########', '##########'],
    spring: ['.......**....', '......####...', '......####...', '......####...', '......####...', '.....J####...', '#############', '#############'],
    moving: ['.....*......', '............', '....M.......', '##........##', '##........##'],
    moving2: ['....M.....M.....', '##............##', '##............##'],
    crumble: ['....*.....', '..........', '##~~~~~~##', '##......##'],
    crumbleSteps: ['......**..', '......~~..', '..........', '...~~.....', '..........', '##......##', '##......##'],
    hopper: ['...*...*..', '..........', '......h...', '##########', '##########'],
    vert: ['........**....', '.......####...', '.......####...', '.......####...', '.......####...', '...V...####...', '##.....#######', '##.....#######'],
    door: ['....D...', '########', '########'],
  };

  // act: palette index · hint: shown on the level card (introduces the new element)
  const LEVELS = [
    { name: 'FIRST STEPS', act: 0, hint: 'ARROWS RUN, J JUMPS', map: 'start gems flat gap2 arc flat step flat gap2 gems door' },
    { name: 'HOP SKIP', act: 0, hint: 'HOLD J TO JUMP HIGHER', map: 'start arc gap2 pyramid gap3 gems gap3g step flat gap3 pillars door' },
    { name: 'THORN PATCH', act: 0, hint: 'SPIKES! JUMP OVER THEM', map: 'start gems spikes flat gap2 spikes arc spikePit flat gap3g spikes door' },
    { name: 'BUG MEADOW', act: 0, hint: 'LAND ON BUGS TO BOP THEM', map: 'start flat walker gap2 gems walker spikes pyramid walker gap3 door' },
    { name: 'GREEN DASH', act: 0, hint: 'HOLD K TO RUN FASTER', map: 'start walker spikePit arc walker pillars gap3g spikes walker step flat door' },
    { name: 'HOLLOW LEDGES', act: 1, hint: 'JUMP UP THROUGH LEDGES', map: 'start ledge flat gap3 ledge walker spikes ledge gap3g door' },
    { name: 'ECHO HALL', act: 1, hint: 'HIGH ROAD OR LOW ROAD', map: 'start ledge spikePit walker ledge pillars spikes ledge walker gap3 door' },
    { name: 'BOING CAVERN', act: 1, hint: 'SPRINGS LAUNCH YOU UP', map: 'start flat spring gap2 gems spring walker gap3 door' },
    { name: 'SPRING WELL', act: 1, hint: 'BOUNCE TO NEW HEIGHTS', map: 'start spring spikePit walker spring ledge spikes spring gap3g door' },
    { name: 'SLIDING STONES', act: 1, hint: 'RIDE THE SLIDING STONES', map: 'start flat moving gems walker moving spikes moving2 door' },
    { name: 'COLD DRIFT', act: 2, hint: 'TIME YOUR HOPS', map: 'start moving2 walker spikePit moving ledge moving2 spring flat door' },
    { name: 'THIN ICE', act: 2, hint: 'CRACKED FLOORS CRUMBLE!', map: 'start crumble gems crumble walker crumbleSteps spikes crumble door' },
    { name: 'CRACKED PEAKS', act: 2, hint: 'KEEP MOVING', map: 'start crumbleSteps moving crumble walker spring crumbleSteps moving2 door' },
    { name: 'HOPPER HILL', act: 2, hint: 'HOPPERS LEAP AT YOU', map: 'start hopper flat gap2 hopper spikes pyramid hopper gap3 walker door' },
    { name: 'FROSTBITE', act: 2, hint: 'WATCH THEIR TIMING', map: 'start hopper crumble moving hopper ledge walker crumbleSteps hopper door' },
    { name: 'ASH LIFTS', act: 3, hint: 'LIFTS CARRY YOU UP', map: 'start vert flat walker vert spikes hopper vert moving door' },
    { name: 'CINDER STEPS', act: 3, hint: 'HOT FOOT, LIGHT STEP', map: 'start crumbleSteps hopper vert spikePit walker moving2 spring hopper door' },
    { name: 'EMBER BRIDGE', act: 3, hint: 'DON\'T LOOK DOWN', map: 'start crumble crumble walker moving2 hopper crumbleSteps vert spikes door' },
    { name: 'LAST LIGHT', act: 3, hint: 'ALMOST THERE', map: 'start spring hopper moving2 crumble walker vert spikePit hopper crumbleSteps ledge door' },
    { name: 'THE SUMMIT', act: 3, hint: 'EVERYTHING AT ONCE', map: 'start gems moving2 spikePit hopper vert crumbleSteps walker spring moving crumble hopper pillars spikes vert crumbleSteps door' },
  ];

  function buildRows(def) {
    const rows = Array.from({ length: ROWS }, () => '');
    for (const name of def.map.split(' ')) {
      const ch = CHUNKS[name] || CHUNKS.flat;
      for (let r = 0; r < ROWS; r++) {
        const k = r - (ROWS - ch.length);
        rows[r] += k >= 0 ? ch[k] : '.'.repeat(ch[0].length);
      }
    }
    return rows;
  }

  /* =================================== 4. SPRITES ==================================== */

  const GUY_BODY = [
    '...kkkk...',
    '..kcccck..',
    '..kccccckk',
    '..kssssk..',
    '..ksssek..',
    '...kssk...',
    '..kbbbbk..',
    '.sbbbbbbs.',
    '..kbbbbk..',
    '..kbbbbk..',
  ];
  const GUY_LEGS = { // rows 10-13, overlaid under the body
    stand: ['..kppppk..', '..kp..pk..', '..kp..pk..', '..kk..kk..'],
    walkA: ['..kppppk..', '.kpp..ppk.', '.kp....pk.', '.kk....kk.'],
    walkB: ['..kppppk..', '...kppk...', '...kppk...', '...kkkk...'],
    walkC: ['..kppppk..', '..kpp.pk..', '.kpp..pk..', '.kk...kk..'],
    jump: ['..kppppk..', '..kpp.ppk.', '.kpp...kk.', '.kk.......'],
  };
  const PAL_GUY = { k: '#1a1020', c: '#2fbf8f', s: '#ffcf9e', e: '#20203a', b: '#f08a3d', p: '#3a3366' };
  const PAL_WHITE = new Proxy({}, { get: () => '#ffffff' });

  const WALKER = [
    '....kkkk....',
    '..kkggggkk..',
    '.kgglggglgk.',
    '.kggggggggk.',
    'kgggwwgggggk',
    'kgggwkgggggk',
    'kggggggggggk',
    '.kkkkkkkkkk.',
  ];
  const WALKER_FEET = [['', '', '', '', '', '', '', '', '..kk....kk..'], ['', '', '', '', '', '', '', '', '...kk..kk...']];
  const PAL_WALKER = { k: '#1c0e12', g: '#e0603a', l: '#ffb08a', w: '#ffffff' };
  const HOPPER = [
    '.kkkkkkkk.',
    'kbbbbbbbbk',
    'kbwkbbwkbk',
    'kbbbbbbbbk',
    'kbbbmmbbbk',
    '.kkkkkkkk.',
  ];
  const HOPPER_LEGS = [['', '', '', '', '', '', '..k....k..', '.kk....kk.'], ['', '', '', '', '', '', '..k....k..', '..k....k..', '..k....k..', '.kk....kk.']];
  const PAL_HOPPER = { k: '#0b1a1a', b: '#33c4a8', w: '#ffffff', m: '#0b1a1a' };

  function makeSprite(layers, pal, dy = []) {
    const w = Math.max(...layers.flat().map((r) => r.length));
    const h = Math.max(...layers.map((l, i) => l.length + (dy[i] || 0)));
    const cv = new OffscreenCanvas(w, h);
    const c = cv.getContext('2d');
    layers.forEach((rows, li) => rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = row[x] !== '.' && pal[row[x]];
        if (col) { c.fillStyle = col; c.fillRect(x, y + (dy[li] || 0), 1, 1); }
      }
    }));
    return { cv, w, h };
  }
  const guy = {}, guyWhite = {};
  for (const k in GUY_LEGS) {
    guy[k] = makeSprite([GUY_BODY, GUY_LEGS[k]], PAL_GUY, [0, 10]);
    guyWhite[k] = makeSprite([GUY_BODY, GUY_LEGS[k]], PAL_WHITE, [0, 10]);
  }
  const WALK_CYCLE = ['walkA', 'walkB', 'walkC', 'walkB'];
  const walkerFrames = WALKER_FEET.map((f) => makeSprite([WALKER, f], PAL_WALKER));
  const hopperFrames = HOPPER_LEGS.map((l) => makeSprite([HOPPER, l], PAL_HOPPER));

  /* ==================================== 5. AUDIO ===================================== */

  const tone = (f, d, o) => api.sound.tone(f, d, o);
  const sfx = {
    jump: () => tone(330, 0.09, { type: 'square', vol: 0.07, slide: 620 }),
    land: () => api.sound.noise(0.04, { vol: 0.05, filter: 700 }),
    step: () => tone(110, 0.02, { type: 'triangle', vol: 0.03 }),
    gem(n) { const f = 1046 * Math.pow(2, (n % 5) / 12); tone(f, 0.05, { vol: 0.07 }); tone(f * 1.5, 0.09, { vol: 0.06, delay: 0.05 }); },
    stomp: () => { tone(520, 0.08, { type: 'square', vol: 0.09, slide: 180 }); api.sound.noise(0.06, { vol: 0.08, filter: 1500 }); },
    spring: () => tone(200, 0.25, { type: 'sine', vol: 0.12, slide: 900 }),
    crack: () => api.sound.noise(0.12, { vol: 0.07, filter: 2500 }),
    crumble: () => api.sound.noise(0.25, { vol: 0.1, filter: 600 }),
    hop: () => tone(260, 0.06, { type: 'triangle', vol: 0.05, slide: 420 }),
    die() { tone(500, 0.5, { type: 'sawtooth', vol: 0.1, slide: 80 }); api.sound.noise(0.2, { vol: 0.12, filter: 1200 }); },
    oneUp: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.08, { vol: 0.08, delay: i * 0.07 })),
    menu: () => tone(660, 0.04, { vol: 0.07 }),
    pause: () => tone(440, 0.08, { type: 'triangle', vol: 0.1 }),
    door: () => tone(180, 0.3, { type: 'triangle', vol: 0.1, slide: 90 }),
    clear: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.11, { vol: 0.09, delay: i * 0.09 })),
    gameOver: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.13, delay: i * 0.17 })),
    victory: () => [523, 659, 784, 1047, 988, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.15, { vol: 0.09, delay: i * 0.12 })),
  };

  /* ============================== 6. SAVE DATA & STATE =============================== */

  let hiScore = api.storage.get('hi', 0);
  let best = Math.max(1, Math.min(LEVELS.length, api.storage.get('best', 1))); // furthest level reached (1-based)

  let state = 'title';   // title | ready | playing | paused | dying | clear | gameOver | victory
  let stateT = 0, sel = best - 1;
  let levelIdx = 0, def = LEVELS[0], act = ACTS[0];
  let map = [], cols = 0, start = { x: 0, y: 0 };
  let gems = [], enemies = [], plats = [], crumbles = new Map(), springs = new Map(), door = null;
  let particles = [], pops = [];
  let score = 0, scoreAtStart = 0, lives = START_LIVES, gemTotal = 0, gemsGot = 0;
  let levelT = 0, worldT = 0, clearBonus = 0, newRecord = false;
  let camX = 0, camLook = 0, shake = 0, flash = 0;
  const player = { x: 0, y: 0, w: PW, h: PH, vx: 0, vy: 0, ground: false, plat: null, face: 1, coyote: 0, buffer: 0, canCut: false, anim: 0, under: [] };

  /* ================================= 7. LEVEL SETUP ================================== */

  function setState(s) { state = s; stateT = 0; }

  function startRun(i) {
    score = 0; lives = START_LIVES; gemTotal = 0; newRecord = false;
    loadLevel(i);
  }

  function loadLevel(i) {
    levelIdx = i; def = LEVELS[i]; act = ACTS[def.act];
    const rows = buildRows(def);
    cols = rows[0].length;
    map = rows.map((r) => r.split(''));
    gems = []; enemies = []; plats = []; crumbles = new Map(); springs = new Map(); door = null;
    particles = []; pops = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < cols; c++) {
        const ch = map[r][c], x = c * TILE, y = TOP + r * TILE;
        if (!'PD*whMV'.includes(ch)) continue;
        map[r][c] = '.';
        if (ch === 'P') start = { x: x + 4, y: y + TILE - PH };
        else if (ch === 'D') door = { x, y: y + TILE - 24, open: 0 };
        else if (ch === '*') gems.push({ x: x + 8, y: y + 8, ph: c * 0.7 });
        else if (ch === 'w') enemies.push({ kind: 'walker', x: x + 2, y: y + TILE - 9, w: 12, h: 9, vx: -0.45, vy: 0, t: 0, dead: false });
        else if (ch === 'h') enemies.push({ kind: 'hopper', x: x + 3, y: y + TILE - 8, w: 10, h: 8, vx: 0, vy: 0, t: 0, wait: 50, dead: false });
        else plats.push({ axis: ch === 'M' ? 'x' : 'y', bx: x, by: y, x, y, dx: 0, dy: 0, phase: plats.length * 1.9 });
      }
    scoreAtStart = score; gemsGot = 0; levelT = 0; worldT = 0;
    Object.assign(player, { x: start.x, y: start.y, vx: 0, vy: 0, ground: false, plat: null, face: 1, coyote: 0, buffer: 0, canCut: false, anim: 0 });
    camX = clamp(player.x - W * 0.4, 0, maxCam()); camLook = 0;
    setState('ready');
  }

  /* ================================= 8. TILE PHYSICS ================================= */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const maxCam = () => Math.max(0, cols * TILE - W);
  const colOf = (x) => Math.floor(x / TILE);
  const rowOf = (y) => Math.floor((y - TOP) / TILE);

  function tileAt(c, r) {
    if (c < 0 || c >= cols) return '#';          // level edges are walls
    if (r < 0 || r >= ROWS) return '.';          // open sky above, bottomless below
    return map[r][c];
  }
  const isSolid = (t) => SOLID.includes(t);

  // Horizontal move with tile collision. Returns true when blocked.
  function moveX(a, dx) {
    a.x += dx;
    const r0 = rowOf(a.y), r1 = rowOf(a.y + a.h - 0.01);
    if (dx > 0) {
      const c = colOf(a.x + a.w - 0.01);
      for (let r = r0; r <= r1; r++) if (isSolid(tileAt(c, r))) { a.x = c * TILE - a.w; return true; }
    } else if (dx < 0) {
      const c = colOf(a.x);
      for (let r = r0; r <= r1; r++) if (isSolid(tileAt(c, r))) { a.x = (c + 1) * TILE; return true; }
    }
    return false;
  }

  // Vertical move: lands on solids and one-way ledges, bumps heads. Fills a.under with landed tiles.
  function moveY(a) {
    const prevBottom = a.y + a.h;
    a.y += a.vy;
    a.ground = false;
    a.under = [];
    const c0 = colOf(a.x), c1 = colOf(a.x + a.w - 0.01);
    if (a.vy >= 0) {
      const r = rowOf(a.y + a.h - 0.01), top = TOP + r * TILE;
      for (let c = c0; c <= c1; c++) {
        const t = tileAt(c, r);
        if (isSolid(t) || (t === '=' && prevBottom <= top + 0.01)) { a.y = top - a.h; a.vy = 0; a.ground = true; a.under.push([t, c, r]); }
      }
    } else {
      const r = rowOf(a.y);
      for (let c = c0; c <= c1; c++) if (isSolid(tileAt(c, r))) { a.y = TOP + (r + 1) * TILE; a.vy = 0; }
    }
  }

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function touchingSpikes(a) {
    for (let c = colOf(a.x); c <= colOf(a.x + a.w - 0.01); c++)
      for (let r = rowOf(a.y); r <= rowOf(a.y + a.h - 0.01); r++)
        if (tileAt(c, r) === '^' && overlaps(a, { x: c * TILE + 2, y: TOP + r * TILE + 8, w: 12, h: 8 })) return true;
    return false;
  }

  /* ==================================== 9. PLAYER ==================================== */

  function updatePlayer(input) {
    const p = player;
    if (p.plat) { moveX(p, p.plat.dx); p.y += p.plat.dy; }   // ride the platform we stand on

    // run with light momentum; B raises the top speed
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const max = input.b ? RUN_MAX : WALK_MAX, prevSpeed = Math.abs(p.vx);
    if (dir) {
      const turning = p.vx * dir < 0;
      p.face = dir;
      p.vx += dir * (p.ground ? (turning ? TURN_ACCEL : ACCEL) : AIR_ACCEL);
      if (turning && p.ground && Math.abs(p.vx) > 0.8 && stateT % 3 === 0) dust(p.x + PW / 2, p.y + PH, 1);
    } else p.vx = approach(p.vx, 0, p.ground ? FRICTION : AIR_ACCEL * 0.5);
    if (Math.abs(p.vx) > max) p.vx = Math.sign(p.vx) * Math.max(max, prevSpeed - 0.08); // ease down after letting go of B

    // jump: coyote time, input buffer, variable height
    p.coyote = p.ground ? COYOTE : p.coyote - 1;
    p.buffer = input.pressed.a ? BUFFER : p.buffer - 1;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V; p.buffer = 0; p.coyote = 0; p.ground = false; p.plat = null; p.canCut = true;
      sfx.jump(); dust(p.x + PW / 2, p.y + PH, 4);
    }
    if (p.canCut && !input.a && p.vy < JUMP_CUT) { p.vy = JUMP_CUT; p.canCut = false; }
    if (p.vy >= 0) p.canCut = false;
    p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);

    // move & collide
    if (moveX(p, p.vx)) p.vx = 0;
    const prevBottom = p.y + p.h, wasGround = p.ground, fallV = p.vy;
    moveY(p);
    p.plat = null;
    if (!p.ground && p.vy >= 0)
      for (const pl of plats)
        if (p.x + p.w > pl.x && p.x < pl.x + PLAT_W && prevBottom <= pl.y + Math.abs(pl.dy) + 0.5 && p.y + p.h >= pl.y) {
          p.y = pl.y - p.h; p.vy = 0; p.ground = true; p.plat = pl;
        }
    for (const [t, c, r] of p.under) {
      if (t === '~') triggerCrumble(c, r);
      if (t === 'J') {
        p.vy = SPRING_V; p.ground = false; p.coyote = 0; p.canCut = false;
        springs.set(r * cols + c, 12); sfx.spring(); shake = Math.max(shake, 2);
      }
    }
    if (p.ground && !wasGround && fallV > 1.5) { sfx.land(); dust(p.x + PW / 2, p.y + PH, 3); }

    // animation & footsteps
    if (p.ground && Math.abs(p.vx) > 0.1) {
      const before = Math.floor(p.anim);
      p.anim += Math.abs(p.vx) * 0.11;
      if (Math.floor(p.anim) !== before && Math.floor(p.anim) % 2 === 0) sfx.step();
    } else if (p.ground) p.anim = 0;

    // hazards
    if (touchingSpikes(p) || p.y > H + 8) killPlayer();
  }

  function killPlayer() {
    if (state !== 'playing') return;
    sfx.die();
    shake = 8; flash = 0.5;
    player.vy = -4.5; player.vx = 0;
    burst(player.x + PW / 2, player.y + PH / 2, 14, ['#ffffff', PAL_GUY.c, PAL_GUY.b]);
    setState('dying');
  }

  /* ========================= 10. WORLD: ENEMIES, PLATFORMS ========================== */

  function updatePlatforms() {
    for (const pl of plats) {
      const k = worldT * 0.02 + pl.phase;
      const nx = pl.axis === 'x' ? pl.bx + Math.sin(k) * SLIDE_RANGE : pl.bx;
      const ny = pl.axis === 'y' ? pl.by - (1 - Math.cos(k * 0.9)) / 2 * LIFT_RANGE : pl.by;
      pl.dx = nx - pl.x; pl.dy = ny - pl.y; pl.x = nx; pl.y = ny;
    }
  }

  function triggerCrumble(c, r) {
    const key = r * cols + c;
    if (crumbles.has(key)) return;
    crumbles.set(key, { c, r, t: 0, gone: false });
    sfx.crack();
  }

  function updateCrumbles() {
    for (const [key, cr] of crumbles) {
      cr.t++;
      if (!cr.gone && cr.t >= CRUMBLE_DELAY) {
        cr.gone = true; cr.t = 0; map[cr.r][cr.c] = '.';
        sfx.crumble();
        burst(cr.c * TILE + 8, TOP + cr.r * TILE + 8, 6, [act.plank, act.dark], 1);
      } else if (cr.gone && cr.t >= CRUMBLE_RESPAWN &&
                 !overlaps(player, { x: cr.c * TILE, y: TOP + cr.r * TILE, w: TILE, h: TILE })) {
        map[cr.r][cr.c] = '~';
        crumbles.delete(key);
      }
    }
    for (const [key, t] of springs) t > 1 ? springs.set(key, t - 1) : springs.delete(key);
  }

  function updateEnemies() {
    const p = player;
    for (const e of enemies) {
      if (e.dead) { e.vy += 0.25; e.y += e.vy; e.x += e.vx; continue; }
      if (e.x > camX + W + 40) continue;  // asleep until close to the screen
      e.t++;
      e.vy = Math.min(e.vy + GRAVITY, MAX_FALL);
      if (e.kind === 'walker') {
        if (moveX(e, e.vx)) e.vx = -e.vx;
        moveY(e);
        const aheadC = colOf(e.vx > 0 ? e.x + e.w + 1 : e.x - 1), belowR = rowOf(e.y + e.h + 1);
        const t = tileAt(aheadC, belowR);
        if (e.ground && !isSolid(t) && t !== '=') e.vx = -e.vx;   // turn at ledges
      } else {
        if (moveX(e, e.vx)) e.vx = 0;
        moveY(e);
        if (e.ground) {
          e.vx = 0;
          if (--e.wait <= 0 && Math.abs(p.x - e.x) < 150) {   // leap toward the player
            e.vy = -4.6; e.vx = Math.sign(p.x - e.x) * 1.1; e.wait = 70; sfx.hop();
          }
        }
      }
      if (e.y > H + 20) e.dead = true;
      if (state === 'playing' && overlaps(p, e)) {
        if (p.vy > 0 && p.y + p.h - p.vy <= e.y + 4) stomp(e);
        else killPlayer();
      }
    }
    enemies = enemies.filter((e) => e.y < H + 40);
  }

  function stomp(e) {
    e.dead = true; e.vy = -2.5; e.vx = player.face * 0.6;
    player.vy = STOMP_V; player.coyote = 0; player.canCut = false;
    score += 50; addPop(e.x + e.w / 2 - camX, e.y - 6, '+50', '#ffe066');
    sfx.stomp(); shake = Math.max(shake, 3);
    burst(e.x + e.w / 2, e.y + e.h / 2, 6, ['#ffffff', '#ffe066'], 1);
  }

  function updateGems() {
    const cx = player.x + PW / 2, cy = player.y + PH / 2;
    for (const gm of gems) {
      if (gm.got || Math.abs(gm.x - cx) > 8 || Math.abs(gm.y - cy) > 11) continue;
      gm.got = true; gemsGot++; gemTotal++; score += 10;
      sfx.gem(gemsGot);
      burst(gm.x, gm.y, 6, ['#9ff6ff', '#ffffff'], 1);
      if (gemTotal % GEMS_PER_LIFE === 0) { lives++; sfx.oneUp(); addPop(gm.x - camX, gm.y - 12, '1UP', '#9cff8a'); }
    }
  }

  function dust(x, y, n) {
    for (let i = 0; i < n; i++)
      particles.push({ x, y: y - 1, vx: (Math.random() - 0.5) * 1.4, vy: -Math.random() * 0.6, life: 16, max: 16, color: '#d8d0c0', size: 2, grav: 0 });
  }
  function burst(x, y, n, colors, size = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 2;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 30 + Math.random() * 20, max: 50, color: colors[i % colors.length], size, grav: 0.08 });
    }
  }
  function addPop(x, y, text, color) { pops.push({ x, y, text, color, t: 0 }); }

  /* =========================== 11. STATE MACHINE / UPDATE ============================ */

  function update(input) {
    stateT++;
    if (state === 'title') updateTitle(input);
    else if (state === 'ready') {
      updateCamera();
      if (stateT > 100 || (stateT > 20 && (input.pressed.a || input.pressed.start))) setState('playing');
    } else if (state === 'playing') updatePlaying(input);
    else if (state === 'paused') {
      if (input.pressed.start) { sfx.pause(); setState('playing'); }
      else if (input.pressed.select) { sfx.menu(); sel = levelIdx; setState('title'); }
      return;
    } else if (state === 'dying') updateDying();
    else if (state === 'clear') updateClear(input);
    else if (state === 'gameOver' || state === 'victory') {
      if (stateT > 50 && (input.pressed.start || input.pressed.a)) {
        sfx.menu();
        if (state === 'gameOver' && input.pressed.a) startRun(levelIdx);
        else { sel = best - 1; setState('title'); }
      }
    }
    updateEffects();
  }

  function updateTitle(input) {
    if (input.pressed.left) { sel = (sel + best - 1) % best; sfx.menu(); }
    if (input.pressed.right) { sel = (sel + 1) % best; sfx.menu(); }
    if (stateT > 15 && (input.pressed.start || input.pressed.a)) { sfx.menu(); startRun(sel); }
  }

  function updatePlaying(input) {
    if (input.pressed.start) { sfx.pause(); setState('paused'); return; }
    levelT++; worldT++;
    updatePlatforms();
    updatePlayer(input);
    updateCrumbles();
    updateEnemies();
    updateGems();
    updateCamera();
    if (state === 'playing' && door && player.x + PW / 2 > door.x + 3 && player.x + PW / 2 < door.x + 13 &&
        player.y + PH > door.y + 8 && player.y < door.y + 24) levelClear();
  }

  function updateCamera() {
    camLook = lerp(camLook, player.face * 28, 0.04);
    camX = lerp(camX, clamp(player.x + PW / 2 - W / 2 + camLook, 0, maxCam()), 0.12);
  }

  function updateDying() {
    player.vy += 0.25; player.y += player.vy;
    if (stateT < 80) return;
    lives--;
    if (lives <= 0) { saveProgress(); sfx.gameOver(); setState('gameOver'); }
    else { score = scoreAtStart; loadLevel(levelIdx); }
  }

  function levelClear() {
    const par = Math.ceil((cols * TILE) / 60);                     // seconds at a relaxed 1px/tick
    const timeBonus = Math.max(0, par - Math.floor(levelT / 60)) * 10;
    const allGems = gemsGot === gems.length && gems.length ? 200 : 0;
    clearBonus = 100 + timeBonus + allGems;
    score += clearBonus;
    if (levelIdx + 2 > best && levelIdx + 1 < LEVELS.length) best = levelIdx + 2;
    saveProgress();
    player.vx = 0;
    sfx.door(); sfx.clear();
    setState('clear');
  }

  function updateClear(input) {
    door.open = Math.min(1, door.open + 0.05);
    updateCamera();
    worldT++; updatePlatforms();
    if (stateT % 6 === 0) burst(door.x + 8, door.y + 4, 2, ['#ffe066', '#9ff6ff', '#ff8ad8'], 1);
    if (stateT > 170 || (stateT > 60 && (input.pressed.a || input.pressed.start))) {
      if (levelIdx + 1 >= LEVELS.length) { saveProgress(); sfx.victory(); setState('victory'); }
      else loadLevel(levelIdx + 1);
    }
  }

  function saveProgress() {
    if (score > hiScore) { hiScore = score; newRecord = true; api.storage.set('hi', hiScore); }
    api.storage.set('best', best);
  }

  function updateEffects() {
    shake = Math.max(0, shake - 0.5);
    flash = Math.max(0, flash - 0.04);
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.life--; }
    particles = particles.filter((p) => p.life > 0);
    if (particles.length > 250) particles.splice(0, particles.length - 250);
    for (const p of pops) { p.t++; p.y -= 0.5; }
    pops = pops.filter((p) => p.t < 45);
    if (state === 'victory' && stateT % 15 === 0)
      for (let i = 0; i < 8; i++)
        particles.push({ x: Math.random() * W + camX, y: -4, vx: (Math.random() - 0.5), vy: 1 + Math.random(), life: 220, max: 220,
          color: ['#ff6b6b', '#ffe066', '#7ccf5a', '#5ec8ff', '#c38cff'][i % 5], size: 2, grav: 0 });
  }

  /* ================================== 12. DRAWING ==================================== */

  // Pre-rendered 16x16 tiles per act palette.
  const tileCache = new Map();
  function tilesFor(a) {
    if (tileCache.has(a)) return tileCache.get(a);
    const mk = (fn) => { const cv = new OffscreenCanvas(TILE, TILE); fn(cv.getContext('2d')); return cv; };
    const specks = (c, seed) => {
      c.fillStyle = a.dark;
      for (let i = 0; i < 7; i++) c.fillRect(Math.floor(hash(seed + i) * 14) + 1, Math.floor(hash(seed + i + 40) * 10) + 5, 2, 1);
    };
    const t = {
      fill: mk((c) => { c.fillStyle = a.dirt; c.fillRect(0, 0, 16, 16); specks(c, 3); }),
      top: mk((c) => {
        c.fillStyle = a.dirt; c.fillRect(0, 0, 16, 16); specks(c, 9);
        c.fillStyle = a.top; c.fillRect(0, 0, 16, 4);
        for (let x = 0; x < 16; x += 3) c.fillRect(x, 4, 2, 1 + (x % 2));
        c.fillStyle = '#ffffff40'; c.fillRect(0, 0, 16, 1);
      }),
      ledge: mk((c) => {
        c.fillStyle = a.plank; c.fillRect(0, 0, 16, 5);
        c.fillStyle = a.dark; c.fillRect(0, 5, 16, 1); c.fillRect(7, 1, 1, 3);
        c.fillStyle = '#ffffff50'; c.fillRect(0, 0, 16, 1);
      }),
      crumble: mk((c) => {
        c.fillStyle = a.plank; c.fillRect(0, 0, 16, 16);
        c.fillStyle = a.dark; c.fillRect(0, 15, 16, 1); c.fillRect(15, 0, 1, 16);
        c.fillRect(4, 2, 1, 4); c.fillRect(5, 6, 3, 1); c.fillRect(8, 7, 1, 5); c.fillRect(11, 3, 1, 3);
        c.fillStyle = '#ffffff50'; c.fillRect(0, 0, 15, 1);
      }),
      spikes: mk((c) => {
        for (let i = 0; i < 4; i++) {
          c.fillStyle = '#c9d1dc';
          for (let y = 0; y < 8; y++) { const hw = Math.floor(y / 4) + 1; c.fillRect(i * 4 + 2 - hw, 8 + y, hw * 2, 1); }
          c.fillStyle = '#ffffff'; c.fillRect(i * 4 + 1, 9, 1, 2);
        }
      }),
    };
    tileCache.set(a, t);
    return t;
  }

  function drawBackground(g, a, cam) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, a.sky[0]); grad.addColorStop(1, a.sky[1]);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {    // stars
      g.fillStyle = (api.frame + i * 17) % 120 < 6 ? '#8fa0d0' : '#ffffff90';
      g.fillRect(Math.floor((hash(i) * W * 2 - cam * 0.03) % W + W) % W, Math.floor(hash(i + 70) * 110), 1, 1);
    }
    if (a.orb) {
      g.fillStyle = a.orb;
      g.fillRect(244, 26, 20, 20); g.fillRect(240, 30, 28, 12); g.fillRect(248, 22, 12, 28);
    }
    for (const [par, base, amp, col] of [[0.15, 120, 22, a.far], [0.35, 150, 16, a.near]]) {   // parallax hills
      g.fillStyle = col;
      for (let x = 0; x < W; x += 4) {
        const wx = x + cam * par;
        const y = Math.floor(base + amp * Math.sin(wx / 70) + amp * 0.5 * Math.sin(wx / 23 + par * 9));
        g.fillRect(x, y, 4, H - y);
      }
    }
    const t = api.frame;
    for (let i = 0; i < 24; i++) {   // act ambience: clouds / drips / snow / embers
      const hx = hash(i * 3.3), hy = hash(i * 7.1);
      if (a.fx === 'cloud' && i < 6) {
        g.fillStyle = '#ffffff18';
        const x = Math.floor(((hx * 500 - cam * 0.08 - t * 0.1) % 400 + 400) % 400) - 40, y = 20 + Math.floor(hy * 50);
        g.fillRect(x, y, 36, 6); g.fillRect(x + 8, y - 4, 18, 4);
      } else if (a.fx === 'snow') {
        g.fillStyle = '#ffffffa0';
        g.fillRect(Math.floor(((hx * W + Math.sin(t * 0.02 + i) * 8 - cam * 0.5) % W + W) % W), Math.floor((hy * H + t * (0.4 + hx * 0.4)) % H), 1, 1);
      } else if (a.fx === 'ember') {
        g.fillStyle = i % 3 ? '#ff8a3c' : '#ffd166';
        g.fillRect(Math.floor(((hx * W - cam * 0.5) % W + W) % W), Math.floor(H - (hy * H + t * (0.3 + hx * 0.5)) % H), 1, 2);
      } else if (a.fx === 'drip' && i < 12) {
        g.fillStyle = '#8f7ac040';
        const x = Math.floor(((hx * W * 2 - cam * 0.35) % W + W) % W);
        g.fillRect(x, 0, 6, 10 + Math.floor(hy * 30)); g.fillRect(x + 2, 10 + Math.floor(hy * 30), 2, 4);
      }
    }
  }

  function drawTiles(g, cam) {
    const t = tilesFor(act);
    const c0 = Math.max(0, colOf(cam)), c1 = Math.min(cols - 1, colOf(cam + W));
    for (let r = 0; r < ROWS; r++)
      for (let c = c0; c <= c1; c++) {
        const ch = map[r][c];
        if (ch === '.') continue;
        let x = c * TILE - cam, y = TOP + r * TILE;
        if (ch === '#') g.drawImage(isSolid(tileAt(c, r - 1)) ? t.fill : t.top, x, y);
        else if (ch === '=') g.drawImage(t.ledge, x, y);
        else if (ch === '^') g.drawImage(t.spikes, x, y);
        else if (ch === '~') {
          const cr = crumbles.get(r * cols + c);
          if (cr) { x += ((cr.t >> 1) & 1) ? 1 : -1; y += cr.t > CRUMBLE_DELAY / 2 ? 1 : 0; }
          g.drawImage(t.crumble, x, y);
        } else if (ch === 'J') drawSpring(g, x, y, springs.get(r * cols + c) || 0);
      }
  }

  function drawSpring(g, x, y, t) {
    const lift = t > 0 ? Math.min(6, t) : 0;
    g.fillStyle = '#5a5a6a'; g.fillRect(x + 1, y + 13, 14, 3);
    g.fillStyle = '#c9d1dc';
    for (let i = 0; i < 3; i++) g.fillRect(x + 4, y + 11 - i * (3 + lift / 3), 8, 1);
    g.fillStyle = '#ff5a6e'; g.fillRect(x + 1, y + 2 - lift, 14, 4);
    g.fillStyle = '#ffb3bd'; g.fillRect(x + 2, y + 2 - lift, 12, 1);
  }

  function drawDoor(g, cam) {
    const x = Math.round(door.x - cam), y = door.y;
    if (x < -20 || x > W + 4) return;
    g.fillStyle = '#7d8597'; g.fillRect(x - 2, y - 2, 20, 26);
    g.fillRect(x + 2, y - 5, 12, 3);
    g.fillStyle = '#0b0b14'; g.fillRect(x + 1, y + 1, 14, 23);
    const glow = 0.5 + 0.5 * Math.sin(api.frame * 0.1);
    g.fillStyle = `rgba(255,224,102,${(0.25 + glow * 0.35 + door.open * 0.4).toFixed(2)})`;
    g.fillRect(x + 1, y + 1, 14, 23);
    const w = Math.round(14 * (1 - door.open));   // the wooden door swings open on clear
    if (w > 0) {
      g.fillStyle = '#8a5a34'; g.fillRect(x + 1, y + 1, w, 23);
      g.fillStyle = '#6a4224'; g.fillRect(x + 1, y + 8, w, 1); g.fillRect(x + 1, y + 16, w, 1);
      g.fillStyle = '#ffe066'; if (w > 10) g.fillRect(x + w - 2, y + 13, 2, 2);
    }
  }

  function drawPlayer(g, cam) {
    const p = player;
    if (state === 'clear' && stateT > 20) return;   // walked through the door
    let key = 'stand';
    if (state === 'dying' || !p.ground) key = 'jump';
    else if (Math.abs(p.vx) > 0.1) key = WALK_CYCLE[Math.floor(p.anim) % 4];
    const white = state === 'dying' && (stateT >> 2) % 2 === 0;
    const spr = (white ? guyWhite : guy)[key];
    g.save();
    g.translate(Math.round(p.x + PW / 2 - cam), Math.round(p.y + PH - spr.h));
    if (p.face < 0) g.scale(-1, 1);
    g.drawImage(spr.cv, -5, 0);
    g.restore();
  }

  function drawWorld(g) {
    const cam = Math.round(camX);
    drawBackground(g, act, cam);
    drawTiles(g, cam);
    if (door) drawDoor(g, cam);
    for (const pl of plats) {
      const x = Math.round(pl.x - cam), y = Math.round(pl.y);
      if (x < -PLAT_W || x > W) continue;
      g.fillStyle = act.dark; g.fillRect(x, y, PLAT_W, 8);
      g.fillStyle = act.plank; g.fillRect(x, y, PLAT_W, 6);
      g.fillStyle = '#ffffff60'; g.fillRect(x, y, PLAT_W, 1);
      g.fillStyle = act.dark;
      for (const bx of [3, 22, 43]) g.fillRect(x + bx, y + 2, 2, 2);
      g.fillStyle = '#ffffff30'; g.fillRect(x + 20, y + 8, 8, 1);
    }
    for (const gm of gems) {
      if (gm.got) continue;
      const x = Math.round(gm.x - cam), y = Math.round(gm.y + Math.sin(api.frame * 0.08 + gm.ph) * 2);
      if (x < -8 || x > W + 8) continue;
      g.fillStyle = '#1a6f8a'; g.fillRect(x - 3, y - 4, 7, 8);
      g.fillStyle = '#5ee7ff'; g.fillRect(x - 2, y - 3, 5, 6); g.fillRect(x - 3, y - 1, 7, 2);
      g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 3, 1, 2);
      if ((api.frame + gm.ph * 10) % 60 < 6) { g.fillRect(x + 3, y - 6, 1, 3); g.fillRect(x + 2, y - 5, 3, 1); }
    }
    for (const e of enemies) {
      const x = Math.round(e.x - cam);
      if (x < -16 || x > W + 4) continue;
      const fr = e.kind === 'walker' ? walkerFrames[(e.t >> 3) & 1] : hopperFrames[e.ground ? 0 : 1];
      g.save();
      g.translate(x + e.w / 2, Math.round(e.y + e.h));
      if (e.dead) g.scale(1, -1);                              // flipped over when bopped
      if (e.kind === 'walker' && e.vx > 0) g.scale(-1, 1);
      g.drawImage(fr.cv, -Math.floor(fr.w / 2), e.dead ? 0 : -fr.h);
      g.restore();
    }
    if (state !== 'title') drawPlayer(g, cam);
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life / (p.max * 0.4));
      g.fillStyle = p.color;
      g.fillRect(Math.floor(p.x - cam), Math.floor(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  function panel(g, x, y, w, h) {
    g.fillStyle = '#000000b8'; g.fillRect(x, y, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
  }

  function drawHud(g) {
    g.fillStyle = '#00000090'; g.fillRect(0, 0, W, 13);
    g.drawImage(guy.stand.cv, 0, 0, 10, 9, 3, 2, 10, 9);
    api.text(`x${lives}`, 15, 3);
    g.fillStyle = '#5ee7ff'; g.fillRect(44, 4, 5, 6); g.fillRect(43, 6, 7, 2);
    api.text(`${gemsGot}/${gems.length}`, 53, 3, { color: '#9ff6ff' });
    api.text(String(score).padStart(6, '0'), W / 2, 3, { align: 'center' });
    api.text(`L${levelIdx + 1}  ${Math.floor(levelT / 60)}S`, W - 4, 3, { align: 'right', color: '#ffe066' });
    for (const p of pops)
      api.text(p.text, p.x, Math.floor(p.y), { color: p.color, align: 'center', shadow: '#000' });
  }

  function drawCenter(g, title, color, lines, y = 64) {
    panel(g, 40, y, 240, 36 + lines.length * 12);
    api.text(title, W / 2, y + 10, { scale: 2, align: 'center', color, shadow: '#000' });
    lines.forEach(([t, c], i) => api.text(t, W / 2, y + 32 + i * 12, { align: 'center', color: c || '#ffffff' }));
  }

  function drawTitle(g) {
    const t = stateT;
    drawBackground(g, ACTS[(sel / 5) | 0], t * 0.6);
    g.fillStyle = ACTS[(sel / 5) | 0].dirt; g.fillRect(0, 208, W, 32);
    g.fillStyle = ACTS[(sel / 5) | 0].top; g.fillRect(0, 208, W, 4);
    api.text('JUMPER', W / 2 + 3, 30 + 3, { scale: 6, align: 'center', color: '#00000080' });
    api.text('JUMPER', W / 2, 30, { scale: 6, align: 'center', color: '#ffe066', shadow: '#5a2a14' });
    const hop = Math.abs(Math.sin(t * 0.06)) * 18;    // the little guy hops along the ground
    const spr = guy[hop > 2 ? 'jump' : WALK_CYCLE[(t >> 3) % 4]];
    g.drawImage(spr.cv, Math.floor((t * 0.8) % (W + 20)) - 10, Math.floor(208 - spr.h - hop));
    panel(g, 40, 92, 240, 92);
    api.text(`LEVEL ${sel + 1}`, W / 2, 100, { color: '#ffe066', align: 'center' });
    api.text(LEVELS[sel].name, W / 2, 112, { scale: 2, align: 'center' });
    if (best > 1) { api.text('<', 52, 112, { scale: 2, color: '#5ee7ff' }); api.text('>', 258, 112, { scale: 2, color: '#5ee7ff' }); }
    api.text('ARROWS RUN   J JUMP   K FAST', W / 2, 136, { align: 'center', color: '#b8c4ff' });
    api.text('GRAB GEMS. REACH THE DOOR.', W / 2, 148, { align: 'center', color: '#b8c4ff' });
    api.text(`HI ${hiScore}   REACHED ${best}/${LEVELS.length}`, W / 2, 166, { align: 'center' });
    if ((t >> 5) & 1 || t < 20) api.text('PRESS START', W / 2, 192, { scale: 2, align: 'center', shadow: '#000' });
  }

  function draw(g) {
    if (state === 'title') return drawTitle(g);
    g.save();
    if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
    drawWorld(g);
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${(flash * 0.5).toFixed(2)})`; g.fillRect(0, 0, W, H); }
    drawHud(g);
    const blink = (stateT >> 4) & 1;
    if (state === 'ready')
      drawCenter(g, def.name, '#ffe066', [[`LEVEL ${levelIdx + 1} - ${act.name}`, '#b8c4ff'], [def.hint, '#9cff8a']], 70);
    else if (state === 'paused')
      drawCenter(g, 'PAUSED', '#ffe066', [[`LEVEL ${levelIdx + 1}: ${def.name}`], ['START: RESUME', '#b8c4ff'], ['SELECT: QUIT TO TITLE', '#b8c4ff']]);
    else if (state === 'dying' && stateT > 30)
      api.text(lives > 1 ? `OOPS!  ${lives - 1} LEFT` : 'OOPS!', W / 2, 90, { scale: 2, align: 'center', color: '#ff8a80', shadow: '#000' });
    else if (state === 'clear')
      drawCenter(g, 'LEVEL CLEAR!', '#9cff8a', [[def.name], [`GEMS ${gemsGot}/${gems.length}   BONUS +${clearBonus}`, '#9ff6ff'], [stateT > 60 && blink ? 'PRESS J' : '', '#b8c4ff']], 60);
    else if (state === 'gameOver')
      drawCenter(g, 'GAME OVER', '#ff8a80', [[`REACHED LEVEL ${levelIdx + 1}`], [`SCORE ${score}   HI ${hiScore}`, '#ffe066'],
        [newRecord ? 'NEW RECORD!' : '', '#9cff8a'], [stateT > 50 && blink ? 'J: RETRY   START: TITLE' : '', '#b8c4ff']]);
    else if (state === 'victory')
      drawCenter(g, 'YOU MADE IT!', '#ffe066', [['ALL 20 LEVELS CLEARED'], [`FINAL SCORE ${score}`, '#9ff6ff'],
        [newRecord ? 'NEW HIGH SCORE!' : `HI ${hiScore}`, '#9cff8a'], [stateT > 50 && blink ? 'PRESS START' : '', '#b8c4ff']]);
  }

  return { update, draw };
}
