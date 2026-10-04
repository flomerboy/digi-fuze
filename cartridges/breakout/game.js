// BRICKS — a VG-Remix cartridge.
// Paddle + ball + brick field. 20 hand-made stages with multi-hit, steel, explosive,
// regenerating and mystery bricks, sliding rows, and two boss fights.
//
// Sections:
//   1. Constants & tuning      5. Bricks, explosions & regen   9. Game flow (states)
//   2. Brick & power-up tables 6. Ball physics                 10. Update
//   3. Level data              7. Lasers, capsules, power-ups  11. Draw
//   4. Bosses                  8. Particles, popups, audio

export default function boot(api) {
  // ===========================================================================
  // 1. CONSTANTS & TUNING
  // ===========================================================================
  const W = api.W, H = api.H;
  const HUD_H = 13;
  const FIELD_L = 16, FIELD_R = 304, FIELD_T = 18;    // inner edges of the walls (grid spans the field)
  const COLS = 12, BRICK_W = 24, BRICK_H = 10;
  const GRID_X = 16, GRID_Y = 30;                      // top-left of brick column 0 / row 0
  const PADDLE_Y = 222, PADDLE_H = 6, PADDLE_SPEED = 4.4;
  const PADDLE_W = { normal: 40, wide: 62, small: 24 };
  const BALL = 4;                                      // ball is a 4x4 square
  const MAX_BALLS = 8;
  const MAX_BOUNCE_ANGLE = 1.1;                        // radians from vertical at paddle edge
  const MIN_VY_RATIO = 0.3;                            // keep the ball from going too flat
  const SPEED_MAX = 5.6;                               // px per tick
  const SPEED_PADDLE_RAMP = 0.035, SPEED_BRICK_RAMP = 0.012;
  const SLOW_FACTOR = 0.6;
  const POWER_TIME = 60 * 15, SHORT_POWER_TIME = 60 * 10;
  const START_LIVES = 3, MAX_LIVES = 9;
  const DEFAULT_DROP = 0.11, MAX_CAPSULES = 3;
  const DEFAULT_REGEN = 8;                             // seconds before a % brick returns
  const IDLE_NUDGE = 60 * 12;                          // ball stuck in a steel loop -> nudge it

  // ===========================================================================
  // 2. BRICK & POWER-UP TABLES
  // ===========================================================================
  // Map characters: letters = 1-hit colored, 2/3/4 = multi-hit, # steel, * TNT,
  // % regenerating, ? mystery (always drops a power-up), . empty.
  const BRICK_TYPES = {
    r: { hp: 1, color: '#ef5350', points: 10 },
    o: { hp: 1, color: '#ff9800', points: 10 },
    y: { hp: 1, color: '#fdd835', points: 10 },
    g: { hp: 1, color: '#66bb6a', points: 10 },
    c: { hp: 1, color: '#26c6da', points: 10 },
    b: { hp: 1, color: '#42a5f5', points: 10 },
    p: { hp: 1, color: '#ab47bc', points: 10 },
    m: { hp: 1, color: '#ec407a', points: 10 },
    w: { hp: 1, color: '#e0e0e0', points: 10 },
    '2': { hp: 2, color: '#b0bec5', points: 20, multi: true },
    '3': { hp: 3, color: '#ffca28', points: 30, multi: true },
    '4': { hp: 4, color: '#ff7043', points: 40, multi: true },
    '#': { hp: Infinity, color: '#607d8b', steel: true },
    '*': { hp: 1, color: '#c62828', points: 15, explosive: true },
    '%': { hp: 1, color: '#26a69a', points: 15, regen: true },
    '?': { hp: 1, color: '#ffffff', points: 25, mystery: true },
  };
  const MULTI_HP_COLORS = ['#78909c', '#78909c', '#b0bec5', '#ffca28', '#ff7043']; // by remaining hp
  const RAINBOW = ['#ef5350', '#ff9800', '#fdd835', '#66bb6a', '#26c6da', '#42a5f5', '#ab47bc'];

  const POWERUPS = {
    W: { name: 'WIDE', color: '#26a69a', weight: 18 },
    M: { name: 'MULTIBALL', color: '#ab47bc', weight: 16 },
    L: { name: 'LASER', color: '#fdd835', weight: 14 },
    C: { name: 'CATCH', color: '#5c6bc0', weight: 13 },
    S: { name: 'SLOW', color: '#29b6f6', weight: 14 },
    '+': { name: '1UP', color: '#ec407a', weight: 4, icon: '#ffffff' },
    '-': { name: 'SHRINK', color: '#5d4037', weight: 12, bad: true, icon: '#ff8a65' },
  };
  // 7x5 pixel icons drawn on capsules and in the HUD (keys = power-up ids above)
  const POWER_ICONS = {
    W: ['..x.x..', '.xx.xx.', 'xxx.xxx', '.xx.xx.', '..x.x..'],   // outward arrows
    M: ['...x...', '..xxx..', '.......', '.x...x.', 'xxx.xxx'],   // three balls
    L: ['...x...', '..xxx..', '.x.x.x.', '...x...', '...x...'],   // up arrow (shot)
    C: ['xx...xx', 'xx...xx', 'xx...xx', '.xx.xx.', '..xxx..'],   // magnet
    S: ['.xxxxx.', 'x..x..x', 'x..xx.x', 'x.....x', '.xxxxx.'],   // clock
    '+': ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..'], // heart
    '-': ['x.....x', 'xx...xx', 'xxx.xxx', 'xx...xx', 'x.....x'], // inward arrows
  };
  const PADDLE_COL = '#4db6ac';                        // solid mint paddle
  const POWER_KEYS = Object.keys(POWERUPS);
  const POWER_TOTAL = POWER_KEYS.reduce((s, k) => s + POWERUPS[k].weight, 0);

  // ===========================================================================
  // 3. LEVEL DATA
  // ===========================================================================
  // Each map row is 12 characters. Options:
  //   move: [row indices] that slide left/right   moveSpeed: radians per second
  //   sway: true -> the whole wall slides as one   regen: seconds for % bricks
  //   boss: 'guardian' | 'king'                     drop: power-up chance per brick
  const LEVELS = [
    { name: 'FIRST CONTACT', map: [
      '............',
      'rrrrrrrrrrrr',
      'oooooooooooo',
      'yyyyyyyyyyyy',
      'gggggggggggg',
      'bbbbbbbbbbbb',
    ] },
    { name: 'RAINBOW ARCH', map: [
      '....rrrr....',
      '..rroooorr..',
      '.rooyyyyoor.',
      'royyg..gyyor',
      'ryg......gyr',
      'rg........gr',
      '?..........?',
    ] },
    { name: 'TOUGH SHELL', map: [
      '............',
      '222222222222',
      'cccccccccccc',
      'c2c2c?c2c2c2',
      'bbbbbbbbbbbb',
      'pppp?pp?pppp',
    ] },
    { name: 'PYRAMID', map: [
      '.....33.....',
      '....2222....',
      '...yyyyyy...',
      '..oo?oo?oo..',
      '.rrrrrrrrrr.',
      'mmmmmmmmmmmm',
    ] },
    { name: 'STEEL BARS', map: [
      '............',
      'gggggggggggg',
      'gggggggggggg',
      '##.######.##',
      'cccccccccccc',
      'cccc?cc?cccc',
      '###.####.###',
      'pppppppppppp',
    ] },
    { name: 'DYNAMITE', map: [
      '............',
      'yyyyyyyyyyyy',
      'y*yyyyyyyy*y',
      'oooooooooooo',
      'ooo*oooo*ooo',
      'rrrrrrrrrrrr',
      'r*rrrr?rrr*r',
      '222222222222',
    ] },
    { name: 'CONVEYOR', moveSpeed: 1.1, move: [1, 2, 3, 4], map: [
      '............',
      'rrrr........',
      '........oooo',
      'yyyy........',
      '........gggg',
      'bbbbbbbbbbbb',
      '?..........?',
    ] },
    { name: 'BEETLE', sway: true, moveSpeed: 0.9, map: [
      '..y......y..',
      '...y.oo.y...',
      '....oooo....',
      '.gggg..gggg.',
      'g2ggg..ggg2g',
      '.gggg..gggg.',
      'g.ggg..ggg.g',
      '...gg..gg...',
    ] },
    { name: 'FORTRESS', map: [
      '............',
      '#.#.#..#.#.#',
      '############',
      '#3333333333#',
      '#3oooooooo3#',
      '#3o?o**o?o3#',
      '#3oooooooo3#',
      '####....####',
      'rrrrrrrrrrrr',
    ] },
    { name: 'GUARDIAN', boss: 'guardian', drop: 0.35, map: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '2.2.?..?.2.2',
    ] },
    { name: 'REGROWTH', regen: 8, map: [
      '............',
      '%%%%%%%%%%%%',
      'gggggggggggg',
      '%g%g%gg%g%g%',
      'cccccccccccc',
      '............',
      '....?..?....',
    ] },
    { name: 'CHECKMATE', map: [
      'b.b.b.b.b.b.',
      '.c.c.c.c.c.c',
      'b.b.*.b.*.b.',
      '.c.c.c.c.c.c',
      '2.2.2.2.2.2.',
      '.c.*.c.c.*.c',
      'b.b.b?b.b.b.',
      '.2.2.2.2.2.2',
    ] },
    { name: 'SLALOM', map: [
      'pppppppppppp',
      'pp*p?pp?p*pp',
      '#######.....',
      'ccccccccc*cc',
      'cc*ccccccccc',
      '.....#######',
      'bbbbbbbbbbbb',
    ] },
    { name: 'HEARTBEAT', map: [
      '............',
      '..mm....mm..',
      '.mmmm..mmmm.',
      'mm33mmmm33mm',
      'mmmmmmmmmmmm',
      'mmmmm??mmmmm',
      '.mmmm22mmmm.',
      '..mmmmmmmm..',
      '...mmmmmm...',
      '....mmmm....',
      '.....33.....',
    ] },
    { name: 'CROSSFIRE', moveSpeed: 1.6, move: [1, 2, 3, 4, 5], map: [
      '............',
      'yyy.........',
      '.........yyy',
      '..oo?oo?oo..',
      '222.........',
      '.........222',
      '##..####..##',
      '............',
      'cccccccccccc',
    ] },
    { name: 'MINEFIELD', regen: 10, map: [
      '%%%%%%%%%%%%',
      '2*22222222*2',
      '333333333333',
      '2222*22*2222',
      'oooooooooooo',
      '%%..%??%..%%',
    ] },
    { name: 'THE VAULT', map: [
      '############',
      '#3*44??44*3#',
      '#3333333333#',
      '###..##..###',
      '............',
      'y.y#y..y#y.y',
      'rrrrrrrrrrrr',
      'rrrrrrrrrrrr',
    ] },
    { name: 'SKULL', sway: true, moveSpeed: 1.2, map: [
      '...wwwwww...',
      '..wwwwwwww..',
      '.wwwwwwwwww.',
      '.ww**ww**ww.',
      '.ww**ww**ww.',
      '.wwwww2wwww.',
      '..wwww2www..',
      '...w2w2w2...',
      '...wwwwww...',
    ] },
    { name: 'GAUNTLET', regen: 9, moveSpeed: 1.5, move: [3, 4], map: [
      '%%%%%%%%%%%%',
      '333333333333',
      '2*22222222*2',
      'rrrr........',
      '........rrrr',
      '#.##.##.##.#',
      'oooooooooooo',
      '............',
      '?..........?',
    ] },
    { name: 'THE BRICK KING', boss: 'king', regen: 6, drop: 0.3, map: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '%%%%....%%%%',
      '............',
      '#....??....#',
    ] },
  ];
  const BG_COLORS = ['#0b1026', '#160b26', '#0b2022', '#26100b', '#101a0b'];

  // ===========================================================================
  // 4. BOSSES
  // ===========================================================================
  // Sprite chars: X body brick, O eye, W crown, T teeth.
  const BOSSES = {
    guardian: {
      name: 'GUARDIAN', hp: 16, cell: 5, y: 40, speed: 1, fireEvery: 95, color: '#7e57c2', pattern: 'aimed',
      sprite: [
        '..XXXXXXXX..',
        '.XXXXXXXXXX.',
        'XXXOOXXOOXXX',
        'XXXOOXXOOXXX',
        'XXXXXXXXXXXX',
        'XX.TTTTTT.XX',
        'X..XXXXXX..X',
        'X.X......X.X',
      ],
    },
    king: {
      name: 'BRICK KING', hp: 40, cell: 5, y: 34, speed: 1.3, fireEvery: 80, color: '#c62828', pattern: 'spread',
      sprite: [
        '.W....W..W....W.',
        '.WW..WWWWWW..WW.',
        '.WWWWWWWWWWWWWW.',
        '..XXXXXXXXXXXX..',
        '.XXXXXXXXXXXXXX.',
        'XXXOOOXXXXOOOXXX',
        'XXXXOXXXXXXOXXXX',
        'XXXXXXXXXXXXXXXX',
        'XX.TTTTTTTTTT.XX',
        '.XX.XXXXXXXX.XX.',
        '..X..........X..',
      ],
    },
  };

  // ===========================================================================
  // STATE
  // ===========================================================================
  let state = 'title';           // title | playing | paused | levelClear | gameOver | victory
  let stateT = 0;                // ticks spent in the current state
  let hi = api.storage.get('hi', 0) | 0;
  let best = Math.min(LEVELS.length - 1, Math.max(0, api.storage.get('best', 0) | 0));
  let selLevel = best;

  let score = 0, lives = START_LIVES, levelIdx = 0, level = LEVELS[0];
  let levelT = 0, combo = 0, clearBonus = 0;
  let bricks = [], rows = [], balls = [], lasers = [], capsules = [], bullets = [];
  let particles = [], popups = [], explosions = [];
  let boss = null;
  const paddle = { x: W / 2, w: PADDLE_W.normal, vx: 0, stun: 0, squash: 0 };
  const power = { wide: false, shrink: 0, laser: 0, catch: 0, slow: 0, laserCool: 0 };
  let bannerT = 0, dyingT = 0, shake = 0, flash = 0, sndBudget = 0;

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const overlaps = (ax, ay, aw, ah, b) => ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;

  const shadeCache = new Map();
  function shades(hex) {
    let s = shadeCache.get(hex);
    if (s) return s;
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, gr = (n >> 8) & 255, b = n & 255;
    const mix = (t, k) => `rgb(${Math.round(r + (t - r) * k)},${Math.round(gr + (t - gr) * k)},${Math.round(b + (t - b) * k)})`;
    s = { base: hex, hi: mix(255, 0.45), lo: mix(0, 0.45), dark: mix(0, 0.75) };
    shadeCache.set(hex, s);
    return s;
  }

  function saveProgress() {
    if (score > hi) { hi = score; api.storage.set('hi', hi); }
    const reached = Math.min(LEVELS.length - 1, levelIdx);
    if (reached > best) { best = reached; api.storage.set('best', best); }
  }

  // ===========================================================================
  // 5. BRICKS, EXPLOSIONS & REGEN
  // ===========================================================================
  function loadLevel(i) {
    levelIdx = i;
    level = LEVELS[i];
    levelT = 0;
    bricks = []; rows = []; lasers = []; capsules = []; bullets = []; explosions = [];
    level.map.forEach((rawLine, r) => {
      const line = rawLine.padEnd(COLS, '.').slice(0, COLS);
      let minC = COLS, maxC = -1;
      for (let c = 0; c < COLS; c++) {
        const type = BRICK_TYPES[line[c]];
        if (!type) continue;
        const bx = GRID_X + c * BRICK_W;
        bricks.push({ type, row: r, bx, x: bx, y: GRID_Y + r * BRICK_H, w: BRICK_W, h: BRICK_H,
          hp: type.hp, alive: true, flash: 0, regenT: 0 });
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
      const moving = maxC >= 0 && (level.sway || (level.move || []).includes(r));
      rows.push({ moving, lo: FIELD_L - (GRID_X + minC * BRICK_W), hi: FIELD_R - (GRID_X + (maxC + 1) * BRICK_W),
        phase: level.sway ? 0 : r * 1.9, offset: 0 });
    });
    if (level.sway) { // the whole wall slides together within the tightest range
      const used = rows.filter((rw) => rw.moving);
      const lo = Math.max(...used.map((rw) => rw.lo)), hiO = Math.min(...used.map((rw) => rw.hi));
      used.forEach((rw) => { rw.lo = lo; rw.hi = hiO; });
    }
    updateRows();
    boss = level.boss ? makeBoss(level.boss) : null;
    resetPaddleAndBall();
    bannerT = 150;
  }

  function updateRows() {
    const t = levelT / 60 * (level.moveSpeed || 1);
    for (const rw of rows) {
      if (!rw.moving) continue;
      rw.offset = rw.lo + (rw.hi - rw.lo) * (0.5 + 0.5 * Math.sin(t + rw.phase));
    }
    for (const br of bricks) br.x = br.bx + rows[br.row].offset;
  }

  function brickColor(br) {
    const T = br.type;
    if (T.mystery) return RAINBOW[Math.floor(api.frame / 5) % RAINBOW.length];
    if (T.multi) return MULTI_HP_COLORS[br.hp];
    if (T.explosive) return api.frame % 20 < 10 ? '#c62828' : '#e53935';
    return T.color;
  }

  // Something (ball, laser, blast) touched this brick.
  function hitBrick(br, src) {
    if (!br.alive) return;
    br.flash = 6;
    if (br.type.steel) {
      if (src !== 'blast') { sfx.steel(); sparks(br.x + br.w / 2, br.y + br.h / 2, '#cfd8dc', 3); }
      return;
    }
    br.hp -= src === 'blast' ? br.hp : 1;
    if (br.hp > 0) {
      score += 5;
      sfx.clink();
      sparks(br.x + br.w / 2, br.y + br.h / 2, brickColor(br), 4);
      return;
    }
    destroyBrick(br);
  }

  function destroyBrick(br) {
    const T = br.type;
    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    br.alive = false;
    combo++;
    const mult = 1 + Math.floor(combo / 4);
    score += T.points * mult;
    burst(cx, cy, T.mystery ? '#ffffff' : T.multi ? '#ffca28' : T.color, 9, 1.6);
    sfx.brick(combo);
    if (combo >= 5 && combo % 5 === 0) addPopup(cx, cy, `COMBO x${mult}`, '#fdd835');
    shake = Math.max(shake, 1.2);
    if (T.explosive) explosions.push({ x: cx, y: cy, t: 7 });
    if (T.regen) br.regenT = Math.round((level.regen || DEFAULT_REGEN) * 60);
    const dropRate = level.drop ?? DEFAULT_DROP;
    if ((T.mystery || Math.random() < dropRate) && capsules.length < MAX_CAPSULES) spawnCapsule(cx, cy);
  }

  function detonate(e) {
    shake = Math.max(shake, 5);
    flash = Math.max(flash, 0.35);
    sfx.boom();
    burst(e.x, e.y, '#ff9800', 18, 3);
    burst(e.x, e.y, '#fdd835', 10, 2);
    for (const br of bricks) {
      if (!br.alive || br.type.steel) continue;
      if (Math.abs(br.x + br.w / 2 - e.x) <= BRICK_W + 2 && Math.abs(br.y + br.h / 2 - e.y) <= BRICK_H + 2) hitBrick(br, 'blast');
    }
    if (boss && !boss.dying && Math.abs(boss.x + boss.w / 2 - e.x) < boss.w / 2 + 20 && Math.abs(boss.y + boss.h / 2 - e.y) < boss.h / 2 + 14) {
      damageBoss(2);
    }
  }

  function updateBricks() {
    for (let i = explosions.length - 1; i >= 0; i--) {
      if (--explosions[i].t <= 0) { const e = explosions[i]; explosions.splice(i, 1); detonate(e); }
    }
    const rooted = regenRooted();
    for (const br of bricks) {
      if (br.flash > 0) br.flash--;
      if (br.alive || !br.type.regen || !rooted) continue;
      if (--br.regenT > 0) continue;
      if (balls.some((b) => overlaps(b.x - 2, b.y - 2, BALL + 4, BALL + 4, br))) { br.regenT = 20; continue; }
      br.alive = true; br.hp = 1; br.flash = 10;
      burst(br.x + br.w / 2, br.y + br.h / 2, '#80cbc4', 6, 0.8);
      sfx.regen();
    }
  }

  // % bricks only regrow while something still feeds them: a living boss or any normal brick.
  const regenRooted = () => (boss ? !boss.dying && !boss.dead : bricks.some((br) => br.alive && !br.type.steel && !br.type.regen));
  const levelCleared = () => (boss ? boss.dead : !bricks.some((br) => br.alive && !br.type.steel));

  // ===========================================================================
  // BOSS LOGIC
  // ===========================================================================
  function makeBoss(kind) {
    const D = BOSSES[kind];
    const w = D.sprite[0].length * D.cell, h = D.sprite.length * D.cell;
    return { D, w, h, x: W / 2 - w / 2, y: D.y, hp: D.hp, phase: 0, fireT: 150, hurt: 0, cool: 0, dying: 0, dead: false };
  }

  function updateBoss() {
    if (!boss || boss.dead) return;
    const B = boss;
    if (B.dying > 0) {
      B.dying--;
      if (B.dying % 5 === 0) {
        const ex = B.x + rand(0, B.w), ey = B.y + rand(0, B.h);
        burst(ex, ey, B.dying % 10 ? '#ff9800' : B.D.color, 12, 2.5);
        sfx.boom();
        shake = Math.max(shake, 4);
      }
      if (B.dying === 0) { B.dead = true; burst(B.x + B.w / 2, B.y + B.h / 2, '#ffffff', 40, 4); flash = 0.8; }
      return;
    }
    const rage = 1 + (1 - B.hp / B.D.hp) * 0.9;
    B.phase += 0.012 * B.D.speed * rage;
    const span = (FIELD_R - FIELD_L - B.w) / 2 - 6;
    B.x = (FIELD_L + FIELD_R) / 2 - B.w / 2 + Math.sin(B.phase) * span;
    B.y = B.D.y + Math.sin(B.phase * 2.3) * 7;
    if (B.hurt > 0) B.hurt--;
    if (B.cool > 0) B.cool--;
    if (--B.fireT <= 0) {
      bossFire(B, rage);
      B.fireT = Math.round(B.D.fireEvery / rage);
    }
  }

  function bossFire(B, rage) {
    const mx = B.x + B.w / 2, my = B.y + B.h - 4;
    const aim = Math.atan2(PADDLE_Y - my, paddle.x - mx);
    const spd = 1.7 + rage * 0.4;
    let angles = [aim];
    if (B.D.pattern === 'spread') angles = rage > 1.45 ? [-0.5, -0.25, 0, 0.25, 0.5].map((a) => aim + a) : [aim - 0.3, aim, aim + 0.3];
    else if (rage > 1.5) angles = [aim - 0.2, aim + 0.2];
    for (const a of angles) bullets.push({ x: mx - 2, y: my, vx: Math.cos(a) * spd, vy: Math.max(0.6, Math.sin(a) * spd) });
    sfx.bossShoot();
  }

  function damageBoss(n) {
    if (!boss || boss.dying || boss.dead) return;
    boss.hp -= n;
    boss.hurt = 8;
    score += 100 * n;
    shake = Math.max(shake, 2.5);
    sfx.bossHit(boss.hp);
    if (boss.hp <= 0) {
      boss.hp = 0;
      boss.dying = 120;
      bullets = [];
      score += level.boss === 'king' ? 20000 : 5000;
      addPopup(boss.x + boss.w / 2, boss.y + boss.h, level.boss === 'king' ? '+20000' : '+5000', '#fdd835');
    }
  }

  function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const s = bullets[i];
      s.x += s.vx; s.y += s.vy;
      let gone = s.y > H || s.x < FIELD_L - 4 || s.x > FIELD_R;
      if (!gone) {
        const br = bricks.find((k) => k.alive && overlaps(s.x, s.y, 4, 4, k));
        if (br) { gone = true; br.flash = 4; sparks(s.x + 2, s.y + 2, '#ff9800', 4); }
      }
      if (!gone && !dyingT && paddleOverlap(s.x, s.y, 4, 4)) {
        gone = true;
        paddle.stun = 50;
        shake = Math.max(shake, 4);
        burst(s.x, s.y, '#4fc3f7', 10, 2);
        sfx.zap();
      }
      if (gone) bullets.splice(i, 1);
    }
  }

  // ===========================================================================
  // 6. BALL PHYSICS
  // ===========================================================================
  function makeBall(x, y, speed) {
    return { x, y, vx: 0, vy: 0, speed, stuck: false, stuckOff: 0, stuckT: 0, idle: 0, trail: [] };
  }

  function baseSpeed() { return 2.5 + levelIdx * 0.07; }

  function resetPaddleAndBall() {
    paddle.x = W / 2; paddle.vx = 0; paddle.stun = 0;
    power.wide = false; power.shrink = power.laser = power.catch = power.slow = 0;
    paddle.w = PADDLE_W.normal;
    const b = makeBall(paddle.x - BALL / 2, PADDLE_Y - BALL, baseSpeed());
    b.stuck = true; b.stuckOff = 6; b.stuckT = Infinity;
    balls = [b];
    combo = 0;
  }

  function setDir(b, angle) { // angle from straight up, positive = right
    b.vx = Math.sin(angle) * b.speed;
    b.vy = -Math.cos(angle) * b.speed;
  }

  function setSpeed(b, s) {
    const cur = Math.hypot(b.vx, b.vy) || 1;
    b.speed = Math.min(SPEED_MAX, s);
    b.vx *= b.speed / cur; b.vy *= b.speed / cur;
  }

  function fixAngle(b) { // never let the ball travel almost horizontally
    const minVy = b.speed * MIN_VY_RATIO;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -1 : 1) * minVy;
      b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(b.speed * b.speed - minVy * minVy);
    }
  }

  function launch(b) {
    b.stuck = false;
    b.stuckT = 0;
    const rel = clamp(b.stuckOff / (paddle.w / 2), -1, 1);
    setDir(b, rel * MAX_BOUNCE_ANGLE * 0.8 || 0.3);
    sfx.launch();
  }

  function paddleOverlap(x, y, w, h) {
    return x < paddle.x + paddle.w / 2 && x + w > paddle.x - paddle.w / 2 && y + h > PADDLE_Y && y < PADDLE_Y + PADDLE_H;
  }

  // Collect every solid (brick or boss) the ball overlaps; returns the first, damaging all.
  const hitList = [];
  function collideSolids(b) {
    hitList.length = 0;
    for (const br of bricks) if (br.alive && overlaps(b.x, b.y, BALL, BALL, br)) hitList.push(br);
    if (boss && !boss.dying && !boss.dead && overlaps(b.x, b.y, BALL, BALL, boss)) hitList.push(boss);
    if (!hitList.length) return null;
    const first = hitList[0];
    for (const r of hitList) {
      if (r === boss) { if (boss.cool === 0) { damageBoss(1); boss.cool = 6; } }
      else {
        if (!r.type.steel) { b.idle = 0; setSpeed(b, b.speed + SPEED_BRICK_RAMP); }
        hitBrick(r, 'ball');
      }
    }
    return first;
  }

  // A sliding row or the boss moved into the ball: push the ball out the shortest way.
  function resolveOverlap(b) {
    const r = collideSolids(b);
    if (!r) return;
    const ox1 = b.x + BALL - r.x, ox2 = r.x + r.w - b.x, oy1 = b.y + BALL - r.y, oy2 = r.y + r.h - b.y;
    const m = Math.min(ox1, ox2, oy1, oy2);
    if (m === ox1) { b.x -= ox1; b.vx = -Math.abs(b.vx); }
    else if (m === ox2) { b.x += ox2; b.vx = Math.abs(b.vx); }
    else if (m === oy1) { b.y -= oy1; b.vy = -Math.abs(b.vy); }
    else { b.y += oy2; b.vy = Math.abs(b.vy); }
    b.x = clamp(b.x, FIELD_L, FIELD_R - BALL);
  }

  // Sub-stepped, axis-separated movement: each step moves at most 2px, so a 4px ball can
  // never skip through a 10px brick, even at top speed.
  function moveBall(b) {
    const mult = power.slow > 0 ? SLOW_FACTOR : 1;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) * mult / 2));
    resolveOverlap(b);
    for (let s = 0; s < steps; s++) {
      // --- X axis
      b.x += b.vx * mult / steps;
      if (b.x < FIELD_L) { b.x = FIELD_L; b.vx = Math.abs(b.vx); sfx.wall(); }
      else if (b.x + BALL > FIELD_R) { b.x = FIELD_R - BALL; b.vx = -Math.abs(b.vx); sfx.wall(); }
      let r = collideSolids(b);
      if (r) {
        if (b.x + BALL / 2 < r.x + r.w / 2) { b.x = r.x - BALL; b.vx = -Math.abs(b.vx); }
        else { b.x = r.x + r.w; b.vx = Math.abs(b.vx); }
        fixAngle(b);
      }
      // --- Y axis
      b.y += b.vy * mult / steps;
      if (b.y < FIELD_T) { b.y = FIELD_T; b.vy = Math.abs(b.vy); sfx.wall(); }
      r = collideSolids(b);
      if (r) {
        if (b.y + BALL / 2 < r.y + r.h / 2) { b.y = r.y - BALL; b.vy = -Math.abs(b.vy); }
        else { b.y = r.y + r.h; b.vy = Math.abs(b.vy); }
        fixAngle(b);
      }
      // --- Paddle (only from above)
      if (b.vy > 0 && b.y + BALL <= PADDLE_Y + 4 && paddleOverlap(b.x, b.y, BALL, BALL)) {
        bouncePaddle(b);
        if (b.stuck) return;
      }
    }
  }

  function bouncePaddle(b) {
    const rel = clamp((b.x + BALL / 2 - paddle.x) / (paddle.w / 2 + 2), -1, 1);
    b.speed = Math.min(SPEED_MAX, b.speed + SPEED_PADDLE_RAMP);
    setDir(b, rel * MAX_BOUNCE_ANGLE);
    b.y = PADDLE_Y - BALL;
    b.idle = 0;
    combo = 0;
    paddle.squash = 6;
    sparks(b.x + BALL / 2, PADDLE_Y, '#ffffff', 3);
    sfx.paddle();
    if (power.catch > 0) {
      b.stuck = true;
      b.stuckOff = b.x + BALL / 2 - paddle.x;
      b.stuckT = 120;
    }
  }

  function updateBalls(input) {
    for (const b of balls) {
      if (b.stuck) {
        b.stuckOff = clamp(b.stuckOff, -paddle.w / 2 + 2, paddle.w / 2 - 2);
        b.x = paddle.x + b.stuckOff - BALL / 2;
        b.y = PADDLE_Y - BALL;
        if (input.pressed.a || --b.stuckT <= 0) { launch(b); bannerT = Math.min(bannerT, 20); }
        continue;
      }
      b.trail.push(b.x, b.y);
      if (b.trail.length > 10) b.trail.splice(0, 2);
      moveBall(b);
      if (++b.idle > IDLE_NUDGE) { // trapped bouncing between steel: tilt the ball a bit
        b.idle = 0;
        setDir(b, Math.atan2(b.vx, -b.vy) + rand(-0.5, 0.5));
        fixAngle(b);
      }
      if (b.y > H) b.dead = true;
    }
    balls = balls.filter((b) => !b.dead);
    if (balls.length === 0) loseLife();
  }

  // ===========================================================================
  // 7. LASERS, CAPSULES & POWER-UPS
  // ===========================================================================
  function updateLasers(input) {
    if (power.laserCool > 0) power.laserCool--;
    if (power.laser > 0 && input.b && power.laserCool === 0 && !paddle.stun) {
      const l = paddle.x - paddle.w / 2 + 3, rgt = paddle.x + paddle.w / 2 - 5;
      lasers.push({ x: l, y: PADDLE_Y - 6 }, { x: rgt, y: PADDLE_Y - 6 });
      power.laserCool = 14;
      sfx.laser();
    }
    for (let i = lasers.length - 1; i >= 0; i--) {
      const z = lasers[i];
      let gone = false;
      for (let s = 0; s < 2 && !gone; s++) {
        z.y -= 3.5;
        if (z.y < FIELD_T) { gone = true; break; }
        if (boss && !boss.dying && !boss.dead && overlaps(z.x, z.y, 2, 6, boss)) { damageBoss(1); gone = true; break; }
        for (const br of bricks) {
          if (br.alive && overlaps(z.x, z.y, 2, 6, br)) { hitBrick(br, 'laser'); gone = true; break; }
        }
      }
      if (gone) { sparks(z.x + 1, z.y, '#ff8a80', 2); lasers.splice(i, 1); }
    }
  }

  function spawnCapsule(x, y) {
    let r = Math.random() * POWER_TOTAL, type = POWER_KEYS[0];
    for (const k of POWER_KEYS) { r -= POWERUPS[k].weight; if (r < 0) { type = k; break; } }
    capsules.push({ x: x - 8, y: y - 3, type });
  }

  function updateCapsules() {
    for (let i = capsules.length - 1; i >= 0; i--) {
      const c = capsules[i];
      c.y += 1.1;
      if (!dyingT && paddleOverlap(c.x, c.y, 16, 7)) { capsules.splice(i, 1); applyPower(c.type); }
      else if (c.y > H) capsules.splice(i, 1);
    }
  }

  function applyPower(type) {
    const P = POWERUPS[type];
    score += 50;
    addPopup(paddle.x, PADDLE_Y - 10, P.name, P.color === '#5d4037' ? '#ff8a65' : P.color);
    burst(paddle.x, PADDLE_Y, P.color, 10, 1.5);
    if (P.bad) sfx.bad(); else sfx.power();
    switch (type) {
      case 'W': power.wide = true; power.shrink = 0; break;
      case '-': power.shrink = SHORT_POWER_TIME; power.wide = false; break;
      case 'L': power.laser = POWER_TIME; break;
      case 'C': power.catch = POWER_TIME; break;
      case 'S': power.slow = SHORT_POWER_TIME; break;
      case '+': lives = Math.min(MAX_LIVES, lives + 1); sfx.oneUp(); break;
      case 'M': multiball(); break;
    }
  }

  function multiball() {
    const src = balls.find((b) => !b.stuck) || balls[0];
    if (!src) return;
    if (src.stuck) launch(src);
    const ang = Math.atan2(src.vx, -src.vy);
    for (const d of [-0.45, 0.45]) {
      if (balls.length >= MAX_BALLS) break;
      const nb = makeBall(src.x, src.y, src.speed);
      setDir(nb, ang + d);
      if (src.vy > 0) nb.vy = Math.abs(nb.vy);
      fixAngle(nb);
      balls.push(nb);
    }
  }

  function updatePowerTimers() {
    if (power.shrink > 0) power.shrink--;
    if (power.laser > 0) power.laser--;
    if (power.slow > 0) power.slow--;
    if (power.catch > 0 && --power.catch === 0) {
      for (const b of balls) if (b.stuck && b.stuckT !== Infinity) launch(b);
    }
  }

  function updatePaddle(input) {
    let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (paddle.stun > 0) { paddle.stun--; dir = 0; }
    paddle.vx += (dir * PADDLE_SPEED - paddle.vx) * 0.45;
    const targetW = power.shrink > 0 ? PADDLE_W.small : power.wide ? PADDLE_W.wide : PADDLE_W.normal;
    paddle.w += (targetW - paddle.w) * 0.2;
    if (Math.abs(targetW - paddle.w) < 0.3) paddle.w = targetW;
    paddle.x = clamp(paddle.x + paddle.vx, FIELD_L + paddle.w / 2, FIELD_R - paddle.w / 2);
    if (paddle.squash > 0) paddle.squash--;
  }

  // ===========================================================================
  // 8. PARTICLES, POPUPS & AUDIO
  // ===========================================================================
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n && particles.length < 500; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(0.3, 1) * spd;
      const life = 20 + Math.random() * 25;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life, max: life, color, size: Math.random() < 0.3 ? 3 : 2 });
    }
  }
  function sparks(x, y, color, n) { burst(x, y, color, n, 1.2); }

  function addPopup(x, y, text, color) {
    popups.push({ x: clamp(x, 40, W - 40), y, text, color, life: 50 });
  }

  function updateFx() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.98;
      if (--p.life <= 0) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].y -= 0.5;
      if (--popups[i].life <= 0) popups.splice(i, 1);
    }
    shake *= 0.86; if (shake < 0.2) shake = 0;
    flash *= 0.85; if (flash < 0.02) flash = 0;
  }

  // Each sfx is a tiny synth recipe. sndBudget limits how many play in one tick (explosions).
  const tone = (f, d, o) => { if (sndBudget-- > 0) api.sound.tone(f, d, o); };
  const jingle = (notes, step, type = 'square', vol = 0.12) =>
    notes.forEach((f, i) => f && api.sound.tone(f, step * 1.1, { type, vol, delay: i * step }));
  const sfx = {
    brick: (c) => tone(330 * Math.pow(2, Math.min(c, 24) / 12), 0.07, { type: 'square', vol: 0.1 }),
    clink: () => tone(880, 0.04, { type: 'triangle', vol: 0.1 }),
    steel: () => tone(1400, 0.04, { type: 'triangle', vol: 0.07, slide: 1100 }),
    wall: () => tone(180, 0.03, { type: 'triangle', vol: 0.07 }),
    paddle: () => tone(200, 0.07, { type: 'square', vol: 0.1, slide: 320 }),
    launch: () => tone(300, 0.1, { type: 'square', vol: 0.1, slide: 600 }),
    laser: () => tone(1200, 0.06, { type: 'sawtooth', vol: 0.05, slide: 400 }),
    regen: () => tone(500, 0.12, { type: 'sine', vol: 0.06, slide: 900 }),
    boom: () => { if (sndBudget-- > 0) { api.sound.noise(0.35, { vol: 0.22, filter: 1200 }); api.sound.tone(120, 0.25, { type: 'sawtooth', vol: 0.1, slide: 40 }); } },
    zap: () => { api.sound.tone(90, 0.3, { type: 'sawtooth', vol: 0.12, slide: 60 }); api.sound.noise(0.15, { vol: 0.1, filter: 4000 }); },
    power: () => jingle([523, 659, 784, 1047], 0.05, 'square', 0.08),
    oneUp: () => jingle([784, 988, 1175, 1568], 0.07, 'triangle', 0.12),
    bad: () => jingle([400, 300, 200], 0.07, 'sawtooth', 0.08),
    bossHit: (hp) => { api.sound.tone(150 + hp * 8, 0.12, { type: 'square', vol: 0.12, slide: 80 }); api.sound.noise(0.08, { vol: 0.1 }); },
    bossShoot: () => api.sound.tone(500, 0.12, { type: 'sawtooth', vol: 0.06, slide: 200 }),
    lose: () => jingle([392, 330, 262, 196], 0.11, 'square', 0.12),
    clear: () => { jingle([523, 659, 784, 1047, 0, 784, 1047], 0.09, 'square', 0.1); jingle([262, 330, 392, 523, 0, 392, 523], 0.09, 'triangle', 0.1); },
    gameOver: () => jingle([392, 370, 349, 330, 0, 262, 196, 131], 0.16, 'triangle', 0.15),
    victory: () => {
      jingle([523, 523, 523, 659, 0, 784, 0, 659, 784, 1047, 1047], 0.12, 'square', 0.1);
      jingle([262, 262, 262, 330, 0, 392, 0, 330, 392, 523, 523], 0.12, 'triangle', 0.12);
    },
    menu: () => api.sound.tone(660, 0.05, { type: 'square', vol: 0.08 }),
    pause: () => api.sound.tone(440, 0.08, { type: 'triangle', vol: 0.1, slide: 660 }),
  };

  // ===========================================================================
  // 9. GAME FLOW (STATES)
  // ===========================================================================
  function setState(s) { state = s; stateT = 0; }

  function newGame(startLevel) {
    score = 0;
    lives = START_LIVES;
    particles = []; popups = [];
    loadLevel(startLevel);
    setState('playing');
  }

  function loseLife() {
    lives--;
    dyingT = 70;
    shake = 6;
    burst(paddle.x, PADDLE_Y + 3, PADDLE_COL, 20, 2.5);
    burst(paddle.x, PADDLE_Y + 3, '#e0f2f1', 12, 2);
    sfx.lose();
    lasers = []; capsules = []; bullets = []; explosions = [];
  }

  function finishDying() {
    dyingT = 0;
    if (lives <= 0) {
      saveProgress();
      sfx.gameOver();
      setState('gameOver');
    } else {
      resetPaddleAndBall();
      bannerT = 60;
    }
  }

  function startLevelClear() {
    clearBonus = 1000 + levelIdx * 250;
    score += clearBonus;
    lasers = []; capsules = []; bullets = [];
    for (let i = 0; i < 6; i++) burst(rand(60, 260), rand(60, 160), RAINBOW[i], 14, 2.5);
    sfx.clear();
    if (levelIdx + 1 >= LEVELS.length) {
      saveProgress();
      sfx.victory();
      setState('victory');
      return;
    }
    levelIdx++; // progress counts as reached once the stage is cleared
    saveProgress();
    levelIdx--;
    setState('levelClear');
  }

  // ===========================================================================
  // 10. UPDATE
  // ===========================================================================
  function updateTitle(input) {
    if (input.pressed.left && selLevel > 0) { selLevel--; sfx.menu(); }
    if (input.pressed.right && selLevel < best) { selLevel++; sfx.menu(); }
    if (input.pressed.start || input.pressed.a) { sfx.launch(); newGame(selLevel); }
  }

  function updatePlaying(input) {
    if (input.pressed.start) { sfx.pause(); setState('paused'); return; }
    if (bannerT > 0) bannerT--;
    if (dyingT > 0) {
      if (--dyingT === 0) finishDying();
      return;
    }
    levelT++;
    updatePaddle(input);
    updateRows();
    updateBricks();
    updateBoss();
    const frozen = boss && boss.dying > 0; // freeze play during the boss's death throes
    if (!frozen) {
      updateBalls(input);
      if (dyingT) return;
      updateLasers(input);
      updateBullets();
    }
    updateCapsules();
    updatePowerTimers();
    if (levelCleared()) startLevelClear();
  }

  function update(input) {
    sndBudget = 3;
    stateT++;
    switch (state) {
      case 'title': updateTitle(input); break;
      case 'playing': updatePlaying(input); break;
      case 'paused':
        if (input.pressed.start) { sfx.pause(); state = 'playing'; }
        else if (input.pressed.select) { saveProgress(); selLevel = Math.min(best, levelIdx); setState('title'); }
        return; // frozen: no fx update
      case 'levelClear':
        if (stateT > 200 || (stateT > 60 && (input.pressed.a || input.pressed.start))) {
          loadLevel(levelIdx + 1);
          setState('playing');
        }
        break;
      case 'gameOver':
      case 'victory':
        if (state === 'victory' && stateT % 25 === 0) {
          burst(rand(40, 280), rand(40, 140), RAINBOW[(stateT / 25) % RAINBOW.length | 0], 24, 2.5);
          api.sound.noise(0.15, { vol: 0.05, filter: 3000 });
        }
        if (stateT > 60 && (input.pressed.start || input.pressed.a)) { selLevel = best; setState('title'); }
        break;
    }
    updateFx();
  }

  // ===========================================================================
  // 11. DRAW
  // ===========================================================================
  function drawBackground(g) {
    g.fillStyle = BG_COLORS[levelIdx % BG_COLORS.length];
    g.fillRect(FIELD_L, FIELD_T, FIELD_R - FIELD_L, H - FIELD_T);
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = FIELD_L + 16; x < FIELD_R; x += 16) g.fillRect(x, FIELD_T, 1, H - FIELD_T);
    for (let y = FIELD_T + 16; y < H; y += 16) g.fillRect(FIELD_L, y, FIELD_R - FIELD_L, 1);
  }

  function drawWalls(g) {
    // muted slate brick wall (8x4 bricks, staggered rows) with a thin mint inner edge
    const pw = FIELD_L; // wall width (both sides are equal)
    g.fillStyle = '#161c20';
    g.fillRect(0, HUD_H, pw, H - HUD_H); g.fillRect(FIELD_R, HUD_H, pw, H - HUD_H); g.fillRect(0, HUD_H, W, FIELD_T - HUD_H);
    const brick = (x0, y0, x1, y1) => {
      for (let y = y0, r = 0; y < y1; y += 4, r++) {
        for (let x = x0 - (r % 2) * 4; x < x1; x += 8) {
          const bx = Math.max(x, x0), bw = Math.min(x + 7, x1) - bx;
          if (bw <= 0) continue;
          g.fillStyle = (x / 8 + r) % 3 === 0 ? '#3a464e' : '#323d44';
          g.fillRect(bx, y, bw, Math.min(3, y1 - y));
        }
      }
    };
    brick(0, HUD_H, pw, H); brick(FIELD_R, HUD_H, W, H); brick(pw, HUD_H, FIELD_R, FIELD_T);
    g.fillStyle = shades(PADDLE_COL).lo;
    g.fillRect(pw - 1, FIELD_T - 1, 1, H - FIELD_T + 1); g.fillRect(FIELD_R, FIELD_T - 1, 1, H - FIELD_T + 1);
    g.fillRect(pw - 1, FIELD_T - 1, FIELD_R - pw + 2, 1);
  }

  function drawBrick(g, br) {
    const x = Math.round(br.x), y = br.y, w = br.w - 1, h = br.h - 1;
    const T = br.type;
    const s = shades(br.flash > 0 ? '#ffffff' : brickColor(br));
    g.fillStyle = s.base; g.fillRect(x, y, w, h);
    g.fillStyle = s.hi; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);
    g.fillStyle = s.lo; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
    if (br.flash > 0) return;
    if (T.steel) {
      g.fillStyle = s.dark;
      g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + w - 3, y + 2, 1, 1);
      g.fillRect(x + 2, y + h - 3, 1, 1); g.fillRect(x + w - 3, y + h - 3, 1, 1);
      const sh = (api.frame + br.bx) % 120;
      if (sh < w - 4) { g.fillStyle = s.hi; g.fillRect(x + 2 + sh, y + 2, 2, h - 4); }
    } else if (T.multi) {
      g.fillStyle = s.dark;
      for (let i = 0; i < br.hp; i++) g.fillRect(x + w / 2 - br.hp * 2 + i * 4 + 1, y + 4, 2, 1);
      if (br.hp < T.hp) { // cracks
        g.fillRect(x + 4, y + 2, 1, 2); g.fillRect(x + 5, y + 4, 1, 2); g.fillRect(x + 4, y + 6, 1, 1);
        if (br.hp < T.hp - 1) { g.fillRect(x + w - 6, y + 3, 1, 2); g.fillRect(x + w - 7, y + 5, 1, 2); }
      }
    } else if (T.explosive) {
      g.fillStyle = '#fdd835';
      for (let i = 2; i < w - 3; i += 5) g.fillRect(x + i, y + 3, 2, 3);
      g.fillStyle = '#000'; g.fillRect(x + w / 2 - 3, y + 2, 6, h - 4);
      g.fillStyle = '#fdd835'; g.fillRect(x + w / 2 - 1, y + 3, 1, 2); g.fillRect(x + w / 2 - 1, y + 6, 1, 1);
    } else if (T.regen) {
      const p = 0.5 + 0.5 * Math.sin(api.frame * 0.12 + br.bx);
      g.fillStyle = `rgba(178,255,240,${0.25 + p * 0.45})`;
      g.fillRect(x + 4, y + 3, w - 8, h - 6);
    } else if (T.mystery) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 8, y + 1, 8, h - 2);
      api.text('?', x + w / 2 - 2, y + 1, { color: '#fff' });
    }
  }

  function drawBricks(g) {
    const rooted = regenRooted();
    for (const br of bricks) {
      if (br.alive) { drawBrick(g, br); continue; }
      if (rooted && br.type.regen && br.regenT > 0) { // ghost outline that solidifies before returning
        const total = (level.regen || DEFAULT_REGEN) * 60;
        const k = 1 - br.regenT / total;
        g.strokeStyle = `rgba(128,203,196,${0.1 + k * 0.5})`;
        g.lineWidth = 1;
        g.strokeRect(Math.round(br.x) + 0.5, br.y + 0.5, br.w - 2, br.h - 2);
        g.fillStyle = 'rgba(128,203,196,0.35)';
        g.fillRect(Math.round(br.x) + 2, br.y + 4, Math.round((br.w - 5) * k), 1);
      }
    }
  }

  function drawBoss(g) {
    if (!boss || boss.dead) return;
    const B = boss, D = B.D, c = D.cell;
    const body = shades(B.hurt > 0 ? '#ffffff' : D.color);
    const angry = B.hp < D.hp / 2;
    const bx = Math.round(B.x), by = Math.round(B.y);
    if (B.dying > 0 && B.dying % 6 < 3) return; // flicker while exploding
    for (let r = 0; r < D.sprite.length; r++) {
      const line = D.sprite[r];
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === '.') continue;
        const x = bx + k * c, y = by + r * c;
        let col = body.base;
        if (ch === 'O') col = angry ? (api.frame % 16 < 8 ? '#ff1744' : '#ffea00') : '#ffea00';
        else if (ch === 'W') col = '#ffca28';
        else if (ch === 'T') col = '#eceff1';
        if (B.hurt > 0) col = '#ffffff';
        g.fillStyle = col; g.fillRect(x, y, c - 1, c - 1);
        if (ch === 'X') { g.fillStyle = body.hi; g.fillRect(x, y, c - 1, 1); }
      }
    }
    // health bar
    const bw = 140, bxh = W / 2 - bw / 2, byh = FIELD_T + 3;
    g.fillStyle = '#000'; g.fillRect(bxh - 1, byh - 1, bw + 2, 6);
    g.fillStyle = '#4a148c'; g.fillRect(bxh, byh, bw, 4);
    g.fillStyle = angry ? '#ff1744' : '#e040fb'; g.fillRect(bxh, byh, Math.round(bw * B.hp / D.hp), 4);
    api.text(D.name, W / 2, byh + 7, { color: '#e1bee7', align: 'center', shadow: '#000' });
  }

  function drawPaddle(g) {
    if (dyingT > 0) return;
    const sq = paddle.squash > 0 ? 1 : 0;
    const w = Math.round(paddle.w + sq * 2), x = Math.round(paddle.x - w / 2), y = PADDLE_Y + sq, h = PADDLE_H - sq;
    const stunned = paddle.stun > 0;
    const bodyCol = stunned ? (api.frame % 6 < 3 ? '#4fc3f7' : '#ffffff') : power.shrink > 0 ? '#8d6e63' : PADDLE_COL;
    const s = shades(bodyCol);
    // one solid rounded bar with a soft top highlight and bottom shade
    g.fillStyle = s.base; g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
    g.fillStyle = s.hi; g.fillRect(x + 2, y, w - 4, 1);
    g.fillStyle = s.lo; g.fillRect(x + 2, y + h - 1, w - 4, 1);
    if (power.laser > 0) { // cannons
      g.fillStyle = '#fff59d';
      g.fillRect(x + 2, y - 3, 3, 3); g.fillRect(x + w - 5, y - 3, 3, 3);
    }
    if (power.catch > 0) { g.fillStyle = '#69f0ae'; g.fillRect(x + 6, y, w - 12, 1); }
  }

  function drawBalls(g) {
    const slow = power.slow > 0;
    for (const b of balls) {
      for (let i = 0; i < b.trail.length; i += 2) {
        g.fillStyle = slow ? `rgba(255,183,77,${0.08 + i * 0.03})` : `rgba(144,202,249,${0.08 + i * 0.03})`;
        g.fillRect(Math.round(b.trail[i]) + 1, Math.round(b.trail[i + 1]) + 1, 2, 2);
      }
      const x = Math.round(b.x), y = Math.round(b.y);
      g.fillStyle = slow ? '#ffcc80' : '#ffffff';
      g.fillRect(x + 1, y, 2, 4); g.fillRect(x, y + 1, 4, 2);
    }
  }

  function drawIcon(g, k, x, y, col) {
    const rows = POWER_ICONS[k];
    g.fillStyle = col;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === 'x') g.fillRect(x + c, y + r, 1, 1);
    }
  }

  function drawObjects(g) {
    for (const c of capsules) {
      const P = POWERUPS[c.type], s = shades(P.color), x = Math.round(c.x), y = Math.round(c.y);
      g.fillStyle = s.base; g.fillRect(x + 1, y, 14, 7); g.fillRect(x, y + 1, 16, 5);
      g.fillStyle = s.hi; g.fillRect(x + 2, y, 12, 1);
      g.fillStyle = s.lo; g.fillRect(x + 2, y + 6, 12, 1);
      drawIcon(g, c.type, x + 5, y + 1, P.icon || s.dark);
    }
    g.fillStyle = '#ff5252';
    for (const z of lasers) g.fillRect(Math.round(z.x), Math.round(z.y), 2, 6);
    for (const s of bullets) {
      g.fillStyle = api.frame % 8 < 4 ? '#ff9800' : '#ffeb3b';
      g.fillRect(Math.round(s.x), Math.round(s.y), 4, 4);
      g.fillStyle = '#fff'; g.fillRect(Math.round(s.x) + 1, Math.round(s.y) + 1, 2, 2);
    }
  }

  function drawParticles(g) {
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life / p.max * 1.5);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;
    for (const p of popups) api.text(p.text, p.x, Math.round(p.y), { color: p.color, align: 'center', shadow: '#000' });
  }

  function drawHUD(g) {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, HUD_H);
    api.text(String(score).padStart(7, '0'), 4, 3, { color: '#fff' });
    api.text(`STAGE ${String(levelIdx + 1).padStart(2, '0')}`, W / 2, 3, { color: '#ffcdd2', align: 'center' });
    for (let i = 0; i < Math.min(lives, 6); i++) {
      const x = W - 14 - i * 13;
      g.fillStyle = PADDLE_COL; g.fillRect(x + 1, 5, 9, 3); g.fillRect(x, 6, 11, 1);
    }
    if (lives > 6) api.text(`+${lives - 6}`, W - 94, 3, { color: '#cfd8dc', align: 'right' });
    // active power-up timers, bottom-left
    const active = [['L', power.laser, POWER_TIME], ['C', power.catch, POWER_TIME], ['S', power.slow, SHORT_POWER_TIME],
      ['-', power.shrink, SHORT_POWER_TIME]].filter((a) => a[1] > 0);
    if (power.wide) active.unshift(['W', 1, 1]);
    active.forEach(([k, t, max], i) => {
      const x = FIELD_L + 4 + i * 22, P = POWERUPS[k];
      if (t < 120 && api.frame % 10 < 5) return;
      drawIcon(g, k, x, H - 9, P.bad ? '#ff8a65' : P.color);
      g.fillStyle = P.bad ? '#ff8a65' : P.color;
      g.fillRect(x + 9, H - 6, Math.max(1, Math.round(11 * t / max)), 2);
    });
  }

  function panel(g, y, h) {
    g.fillStyle = 'rgba(0,0,0,0.72)';
    g.fillRect(0, y, W, h);
    g.fillStyle = '#c62828'; g.fillRect(0, y, W, 1); g.fillRect(0, y + h - 1, W, 1);
  }

  function drawOverlay(g) {
    const blink = api.frame % 60 < 40;
    if (state === 'playing' && bannerT > 0 && !dyingT) {
      panel(g, 120, 40);
      api.text(`STAGE ${levelIdx + 1}`, W / 2, 126, { color: '#ffcdd2', align: 'center' });
      api.text(level.name, W / 2, 138, { color: '#fff', align: 'center', scale: 2, shadow: '#c62828' });
      if (balls.some((b) => b.stuckT === Infinity) && blink) api.text('PRESS J TO LAUNCH', W / 2, 168, { color: '#fdd835', align: 'center', shadow: '#000' });
    } else if (state === 'playing' && !dyingT && balls.some((b) => b.stuckT === Infinity) && blink) {
      api.text('PRESS J TO LAUNCH', W / 2, 168, { color: '#fdd835', align: 'center', shadow: '#000' });
    }
    if (state === 'paused') {
      panel(g, 80, 80);
      api.text('PAUSED', W / 2, 92, { color: '#fff', align: 'center', scale: 3, shadow: '#c62828' });
      api.text(`STAGE ${levelIdx + 1}: ${level.name}`, W / 2, 122, { color: '#ffcdd2', align: 'center' });
      api.text('START  RESUME', W / 2, 136, { color: '#fdd835', align: 'center' });
      api.text('SELECT QUIT TO TITLE', W / 2, 146, { color: '#90a4ae', align: 'center' });
    }
    if (state === 'levelClear') {
      panel(g, 84, 72);
      api.text('STAGE CLEAR!', W / 2, 94, { color: '#fdd835', align: 'center', scale: 3, shadow: '#c62828' });
      api.text(`BONUS ${clearBonus}`, W / 2, 124, { color: '#fff', align: 'center' });
      api.text(`NEXT: ${LEVELS[levelIdx + 1].name}`, W / 2, 138, { color: '#ffcdd2', align: 'center' });
    }
    if (state === 'gameOver') {
      panel(g, 70, 100);
      api.text('GAME OVER', W / 2, 82, { color: '#ef5350', align: 'center', scale: 3, shadow: '#000' });
      api.text(`SCORE ${score}`, W / 2, 112, { color: '#fff', align: 'center' });
      api.text(score >= hi && score > 0 ? 'NEW HIGH SCORE!' : `HI ${hi}`, W / 2, 124, { color: '#fdd835', align: 'center' });
      api.text(`REACHED STAGE ${levelIdx + 1}`, W / 2, 136, { color: '#ffcdd2', align: 'center' });
      if (stateT > 60 && blink) api.text('PRESS START', W / 2, 154, { color: '#fff', align: 'center' });
    }
    if (state === 'victory') {
      panel(g, 60, 120);
      api.text('VICTORY!', W / 2, 72, { color: '#fdd835', align: 'center', scale: 4, shadow: '#c62828' });
      api.text('THE BRICK KING HAS FALLEN', W / 2, 108, { color: '#fff', align: 'center' });
      api.text(`FINAL SCORE ${score}`, W / 2, 124, { color: '#fff', align: 'center' });
      api.text(score >= hi ? 'NEW HIGH SCORE!' : `HI ${hi}`, W / 2, 136, { color: '#fdd835', align: 'center' });
      if (stateT > 60 && blink) api.text('PRESS START', W / 2, 160, { color: '#ffcdd2', align: 'center' });
    }
  }

  function drawTitle(g) {
    g.fillStyle = '#0b0610'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 16) g.fillRect(0, y, W, 1);
    // waving brick wall
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 14; c++) {
        const x = c * 24 - 8 + (r % 2) * 12, y = 14 + r * 11 + Math.round(Math.sin(api.time * 2 + c * 0.5 + r) * 2);
        const s = shades(RAINBOW[(c + r + Math.floor(api.time * 2)) % RAINBOW.length]);
        g.fillStyle = s.base; g.fillRect(x, y, 23, 10);
        g.fillStyle = s.hi; g.fillRect(x, y, 23, 1);
        g.fillStyle = s.lo; g.fillRect(x, y + 9, 23, 1);
      }
    }
    api.text('BRICKS', W / 2, 72, { color: '#ffffff', scale: 5, align: 'center', shadow: '#c62828' });
    // demo ball bouncing over a paddle
    const t = api.time;
    const bx = 160 + Math.sin(t * 1.3) * 120, by = 154 - Math.abs(Math.sin(t * 2.2)) * 16;
    g.fillStyle = PADDLE_COL; g.fillRect(Math.round(bx) - 19, 156, 38, 5); g.fillRect(Math.round(bx) - 20, 157, 40, 3);
    g.fillStyle = '#fff'; g.fillRect(Math.round(bx) - 1, Math.round(by) - 2, 2, 4); g.fillRect(Math.round(bx) - 2, Math.round(by) - 1, 4, 2);

    api.text('LEFT/RIGHT MOVE   J LAUNCH   K LASER', W / 2, 116, { color: '#b0bec5', align: 'center' });
    api.text('CATCH CAPSULES - DODGE THE BOSS FIRE', W / 2, 128, { color: '#78909c', align: 'center' });
    const L = LEVELS[selLevel];
    const arrows = best > 0;
    api.text(`${arrows && selLevel > 0 ? '< ' : '  '}STAGE ${String(selLevel + 1).padStart(2, '0')}: ${L.name}${arrows && selLevel < best ? ' >' : '  '}`,
      W / 2, 176, { color: '#ffcdd2', align: 'center' });
    api.text(`HI-SCORE ${String(hi).padStart(7, '0')}`, W / 2, 190, { color: '#fdd835', align: 'center' });
    if (api.frame % 60 < 40) api.text('PRESS START', W / 2, 210, { color: '#ffffff', scale: 2, align: 'center', shadow: '#c62828' });
  }

  function draw(g) {
    g.fillStyle = '#05060d';
    g.fillRect(0, 0, W, H);
    if (state === 'title') { drawTitle(g); return; }
    g.save();
    if (shake > 0) g.translate(Math.round(rand(-shake, shake)), Math.round(rand(-shake, shake)));
    drawBackground(g);
    drawBricks(g);
    drawBoss(g);
    drawObjects(g);
    drawPaddle(g);
    if (state !== 'levelClear' && state !== 'victory') drawBalls(g);
    drawParticles(g);
    drawWalls(g);
    g.restore();
    drawHUD(g);
    drawOverlay(g);
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash})`; g.fillRect(0, 0, W, H); }
  }

  return { update, draw };
}
