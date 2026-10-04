// SPARROW GLIDER: beat a barn swallow's wings through 20 sky courses of rock spires, kites,
// geese and thunderheads, then outfly the Sky Kraken. Beating course 20 unlocks endless mode.
//
// Sections: constants & tuning · themes · course data · helpers · swallow sprite · audio ·
// save data · state · course setup & spawning · update (per state) · draw (sky, world, HUD, screens).

export default function boot(api) {
  const { W, H } = api;

  // ===================== Constants & tuning =====================
  const SEA_Y = 220;          // top of the cloud sea; sinking into it costs a life
  const BIRD_X = 84;          // the swallow's fixed screen x; the sky scrolls past it
  const BODY_DX = 2, BODY_R = 4.5;       // body collision circle (the forked tail is forgiving)
  const GRAVITY = 0.17;
  const FLAP_KICK = -4;       // one wingbeat adds upward speed (pulling out of a dive takes two)...
  const FLAP_V = -3.2;        // ...capped at this climb rate
  const GLIDE_LIFT = 0.05;    // a moment of extra lift while the wings are still spread
  const MAX_VY = 5;
  const SPIRE_W = 26;         // rock spire footprint
  const TIP_LEN = 14;         // the tapering tip of each spire
  const START_LIVES = 3;
  const FIRST_X = 360;        // world x of the first spire pair
  const DRAFT = { up: -0.08, down: 0.08 };  // extra vertical force inside air columns
  const ZAP_CYCLE = 150, ZAP_WARN = 100, ZAP_FIRE = 130; // charged thunderhead timing
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];      // chime ladder (semitones)

  // ===================== Themes (palettes per sky) =====================
  // rock: [body, dark, light] · cap: tip highlight · far/near: mountain layers
  const THEMES = {
    dawn: {
      sky: ['#2a2350', '#f6a37a'], far: '#6b5a8e', near: '#4a3f6b', snow: '#e8d8f0',
      rock: ['#5a4048', '#2e1f28', '#9a7880'], cap: '#fdf3e7', cloud: '#ffd9c4', sea: ['#f3c6c0', '#fbe3dc'],
      orb: '#ffe7a8', orbY: 150,
    },
    sunset: {
      sky: ['#3a1c4f', '#ff7a45'], far: '#7a3355', near: '#4f2240', snow: '#ffc3a0',
      rock: ['#6e3b3b', '#43201f', '#b26a52'], cap: '#ffd2a8', cloud: '#ffb38a', sea: ['#e8866a', '#f7b08f'],
      orb: '#ffcf6b', orbY: 128,
    },
    night: {
      sky: ['#050816', '#1b2550'], far: '#1f2a4a', near: '#141c33', snow: '#8090c0',
      rock: ['#3a4466', '#232a40', '#6f7aa3'], cap: '#c5cff0', cloud: '#2c3864', sea: ['#2b3560', '#3d4a80'],
      orb: '#fffbe6', orbY: 36, stars: true, moon: true,
    },
    storm: {
      sky: ['#14161d', '#3d4656'], far: '#262c38', near: '#1b2029', snow: '#4a5262',
      rock: ['#3c4250', '#22262f', '#6b7384'], cap: '#9aa3b5', cloud: '#4a5163', sea: ['#4a5163', '#5e6679'],
      thunder: ['#353a47', '#22252e', '#575e70'], rain: true,
    },
    aurora: {
      sky: ['#04101c', '#0f2f3f'], far: '#173447', near: '#0f2433', snow: '#5c8aa3',
      rock: ['#7fb6d4', '#3f7391', '#d8f3ff'], cap: '#ffffff', cloud: '#2a4d63', sea: ['#2a4d63', '#3c6a84'],
      stars: true, aurora: true,
    },
    cavern: {
      sky: ['#120f1e', '#2a2140'], far: null, near: '#1c1730', snow: null,
      rock: ['#5b4f7a', '#2f2747', '#8a7cb0'], cap: '#ffb74d', cloud: null, sea: ['#3a3258', '#4b4470'],
      wall: ['#4b4466', '#7b72a0'],
    },
  };

  // ===================== Course data =====================
  // len: distance to the goal (px) · speed: scroll px/tick · gap: [start, end] gap height
  // spacing: px between spire pairs · move: spire drift amplitude · lanterns/kites/flocks/boost: chance per pair
  // wind: gust strength · drafts: [from, to, 'up'|'down'] air columns as fractions of len
  // cave: cloud-cavern walls · charged: chance a thunderhead fires lightning · boss: the Sky Kraken
  const COURSES = [
    { name: 'FIRST LIGHT', theme: 'dawn', len: 1500, speed: 1.5, gap: [88, 82], spacing: 160, hint: 'THREAD THE GAPS' },
    { name: 'MORNING AIR', theme: 'dawn', len: 1900, speed: 1.6, gap: [82, 76], spacing: 150, lanterns: 0.35, hint: 'LANTERNS ARE WORTH 5' },
    { name: 'LANTERN FESTIVAL', theme: 'dawn', len: 2100, speed: 1.6, gap: [78, 74], spacing: 145, lanterns: 1, hint: 'CATCH THEM ALL' },
    { name: 'DRIFTING ISLES', theme: 'dawn', len: 2200, speed: 1.6, gap: [82, 78], spacing: 155, move: 18, lanterns: 0.3, hint: 'THE ROCKS ARE ADRIFT' },
    { name: 'NEEDLE PASS', theme: 'dawn', len: 2300, speed: 1.7, gap: [84, 64], spacing: 145, lanterns: 0.3, hint: 'THE GAPS GET TIGHTER' },
    { name: 'CROSSWINDS', theme: 'sunset', len: 2400, speed: 1.6, gap: [82, 76], spacing: 155, wind: 1, hint: 'GUSTS SHOVE YOU AROUND' },
    { name: 'KITE COUNTRY', theme: 'sunset', len: 2500, speed: 1.7, gap: [80, 74], spacing: 165, kites: 0.7, lanterns: 0.3, hint: 'MIND THE KITES' },
    { name: 'THE FLOCK', theme: 'sunset', len: 2600, speed: 1.7, gap: [82, 76], spacing: 165, flocks: 0.6, lanterns: 0.3, hint: 'GEESE FLY IN V' },
    { name: 'RISING AIR', theme: 'sunset', len: 2600, speed: 1.6, gap: [84, 78], spacing: 160, drafts: [[0.25, 0.45, 'up'], [0.6, 0.8, 'down']], hint: 'UPDRAFTS AND DOWNDRAFTS' },
    { name: 'CLOUD CAVERN', theme: 'cavern', len: 2600, speed: 1.6, gap: [82, 76], spacing: 220, cave: true, lanterns: 0.5, hint: 'MIND THE CLOUD WALLS' },
    { name: 'STARLIGHT', theme: 'night', len: 2800, speed: 1.75, gap: [78, 70], spacing: 150, move: 22, lanterns: 0.4, hint: 'FLY BY THE STARS' },
    { name: 'JET STREAM', theme: 'dawn', len: 3600, speed: 2.2, gap: [86, 78], spacing: 180, boost: 0.6, lanterns: 0.3, hint: 'SWIRLS = SPEED + POINTS' },
    { name: 'MIGRATION', theme: 'night', len: 3000, speed: 1.8, gap: [80, 72], spacing: 170, move: 14, flocks: 0.7, kites: 0.3, hint: 'A CROWDED SKY' },
    { name: 'THERMAL MAZE', theme: 'sunset', len: 3000, speed: 1.7, gap: [82, 74], spacing: 160, wind: 0.8, drafts: [[0.15, 0.3, 'down'], [0.4, 0.55, 'up'], [0.68, 0.9, 'down']], hint: 'READ THE AIR' },
    { name: 'DEEP CAVERN', theme: 'cavern', len: 3000, speed: 1.75, gap: [78, 70], spacing: 200, cave: true, flocks: 0.5, lanterns: 0.4, hint: 'SOMETHING ROOSTS IN HERE' },
    { name: 'NORTHERN LIGHTS', theme: 'aurora', len: 3200, speed: 1.8, gap: [78, 70], spacing: 155, move: 18, wind: 1.2, hint: 'ICE SPIRES AND GALES' },
    { name: 'THUNDERHEAD', theme: 'storm', len: 3300, speed: 1.8, gap: [82, 72], spacing: 160, wind: 1, charged: 0.5, hint: 'SPARKS MEAN LIGHTNING' },
    { name: 'EYE OF THE STORM', theme: 'storm', len: 3400, speed: 1.8, gap: [82, 74], spacing: 165, move: 14, charged: 0.4, drafts: [[0.25, 0.5, 'down'], [0.65, 0.85, 'up']], hint: 'STAY LOW WHEN IT CRACKLES' },
    { name: 'THE GAUNTLET', theme: 'aurora', len: 3800, speed: 2.0, gap: [78, 66], spacing: 165, move: 18, flocks: 0.4, kites: 0.3, wind: 1, boost: 0.3, lanterns: 0.4, hint: 'EVERYTHING AT ONCE' },
    { name: 'SKY KRAKEN', theme: 'storm', len: 4000, speed: 1.85, gap: [94, 86], spacing: 180, boss: true, lanterns: 0.3, hint: 'DODGE ITS TENTACLES!' },
  ];
  const ENDLESS_INDEX = COURSES.length; // title menu entry after the last course
  const ENDLESS_THEMES = ['dawn', 'sunset', 'night', 'aurora', 'storm'];

  // ===================== Helpers =====================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (a, n) => ((a % n) + n) % n;
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  function makeRng(seed) { // mulberry32: deterministic course layouts
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function circleHitsRect(cx, cy, r, x, y, w, h) {
    const nx = clamp(cx, x, x + w), ny = clamp(cy, y, y + h);
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }
  function fillEllipse(g, cx, cy, rx, ry, color) { // pixel-row ellipse
    g.fillStyle = color;
    for (let dy = -ry; dy <= ry; dy += 2) {
      const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
      g.fillRect(Math.round(cx - hw), Math.round(cy + dy), hw * 2, 2);
    }
  }

  // ===================== Swallow sprite (pixel strings -> cached canvases) =====================
  // 20x12, facing right: long forked tail streamers, steel-blue back, rust throat, cream belly.
  const SWALLOW_BODY = [
    '',
    '',
    '..............kkk',
    'kk...........kbbbk',
    '.kdk.......kkbbbebkk',
    '..kddkkkkkkbbbbbrrk',
    '...kdddbbbbbbbbrrk',
    '..kdkkcccccccccck',
    '.kdk..kkkccccckk',
    'kk.......kkkkk',
  ];
  const SWALLOW_WINGS = [ // up, mid, down (overlaid on the body)
    ['.......kkkk', '......kddddk', '.......kdddbk', '........kddbbk', '.........kkbbk'],
    ['', '', '', '', '', '.....kkkkkkk', '....kddddddbk', '.....kkkkkkk'],
    ['', '', '', '', '', '', '', '.......kddddk', '........kdddk', '.........kddk', '..........kk'],
  ];
  const PAL_SWALLOW = { k: '#0b1026', b: '#3b70e0', d: '#1f3f95', e: '#000000', r: '#c8452c', c: '#f3e6cc' };
  function makeSprite(layers, pal) {
    const w = Math.max(...layers.flat().map((r) => r.length));
    const h = Math.max(...layers.map((l) => l.length));
    const cv = new OffscreenCanvas(w, h), c = cv.getContext('2d');
    for (const rows of layers)
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (pal[row[x]]) { c.fillStyle = pal[row[x]]; c.fillRect(x, y, 1, 1); }
      });
    return { cv, w, h };
  }
  const birdFrames = SWALLOW_WINGS.map((wing) => makeSprite([SWALLOW_BODY, wing], PAL_SWALLOW));
  const wingFrame = (t) => [0, 1, 2, 1][Math.floor(t / 4) % 4];

  // ===================== Audio =====================
  const sfx = {
    flap() {
      api.sound.noise(0.06, { vol: 0.08, filter: 2500 });
      api.sound.tone(330, 0.07, { type: 'sine', vol: 0.09, slide: 520 });
    },
    chime(combo) { // rising pentatonic ladder, with a sparkle every 5th gap
      const f = 660 * Math.pow(2, PENTA[combo % PENTA.length] / 12);
      api.sound.tone(f, 0.12, { type: 'triangle', vol: 0.1 });
      if (combo % 5 === 4) api.sound.tone(f * 1.5, 0.15, { type: 'sine', vol: 0.08, delay: 0.08 });
    },
    lantern() { api.sound.tone(1175, 0.06, { type: 'sine', vol: 0.1 }); api.sound.tone(1568, 0.14, { type: 'sine', vol: 0.1, delay: 0.06 }); },
    stream() { api.sound.tone(250, 0.35, { type: 'sine', vol: 0.1, slide: 900 }); api.sound.noise(0.3, { vol: 0.06, filter: 2500 }); },
    crash() {
      api.sound.noise(0.3, { vol: 0.25, filter: 3000 });
      api.sound.tone(500, 0.5, { type: 'sawtooth', vol: 0.1, slide: 70 });
    },
    gust: () => api.sound.noise(0.8, { vol: 0.07, filter: 500 }),
    thunder: () => api.sound.noise(1.2, { vol: 0.22, filter: 300, delay: 0.25 }),
    crackle: () => api.sound.noise(0.08, { vol: 0.05, filter: 5000 }),
    zap() { api.sound.noise(0.25, { vol: 0.2, filter: 4000 }); api.sound.tone(900, 0.2, { type: 'sawtooth', vol: 0.06, slide: 100 }); },
    draft: () => api.sound.tone(180, 0.3, { type: 'sine', vol: 0.1, slide: 360 }),
    rumble: () => api.sound.tone(70, 0.7, { type: 'sawtooth', vol: 0.12, slide: 45 }),
    lash: () => api.sound.noise(0.35, { vol: 0.15, filter: 1200 }),
    menu: () => api.sound.tone(587, 0.04, { type: 'triangle', vol: 0.08 }),
    pause: () => api.sound.tone(392, 0.08, { type: 'triangle', vol: 0.1 }),
    clear: () => [587, 740, 880, 1175].forEach((f, i) => api.sound.tone(f, 0.14, { type: 'triangle', vol: 0.11, delay: i * 0.1 })),
    gameOver: () => [440, 370, 294, 220].forEach((f, i) => api.sound.tone(f, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.18 })),
    victory: () => [587, 740, 880, 740, 880, 1175, 1480].forEach((f, i) => api.sound.tone(f, 0.18, { type: 'triangle', vol: 0.11, delay: i * 0.13 })),
  };

  // ===================== Save data =====================
  let hiScore = api.storage.get('hi', 0);
  let bestCourse = api.storage.get('best', 0);      // highest unlocked course index
  let endlessUnlocked = api.storage.get('endless', false);
  let endlessHi = api.storage.get('endlessHi', 0);

  // ===================== Game state =====================
  let state = 'title';   // title | playing | paused | crash | clear | gameOver | victory
  let stateT = 0;        // ticks in current state
  let sel = Math.min(bestCourse, COURSES.length - 1); // title menu selection
  let courseIdx = 0;
  let endless = false;
  let cfg = COURSES[0];  // active course settings (a copy, so endless can mutate it)
  let score = 0, scoreAtStart = 0, lives = START_LIVES, lanternsGot = 0, combo = 0, gapsPassed = 0;
  let camX = 0, playT = 0, ready = true;
  const bird = { y: 110, vy: 0, rot: 0, glide: 0, wingT: 0 };
  let spires = [], lanterns = [], kites = [], flocks = [], streams = [], particles = [], pops = [];
  let rng = makeRng(1), nextSpawnX = FIRST_X, spawnCount = 0, lastGapY = 110;
  let wind = { phase: 'calm', t: 200, dir: -1 };
  let storm = { t: 180, flash: 0, bolt: null };
  let kraken = null;
  let clearBonus = 0, boostT = 0, shake = 0, flash = 0, lastDraft = null, titleCam = 0, newRecord = false;

  // ===================== Course setup & spawning =====================
  function startRun(index) {
    endless = index === ENDLESS_INDEX;
    lives = endless ? 1 : START_LIVES;
    score = 0;
    newRecord = false;
    loadCourse(endless ? 0 : index);
  }

  function loadCourse(i) {
    courseIdx = i;
    cfg = endless
      ? { name: 'ENDLESS', theme: 'dawn', len: Infinity, speed: 1.6, gap: [86, 86], spacing: 155, lanterns: 0.4, drafts: [], hint: 'HOW FAR CAN YOU FLY?' }
      : { lanterns: 0, kites: 0, flocks: 0, move: 0, wind: 0, boost: 0, charged: 0, drafts: [], ...COURSES[i] };
    spires = []; lanterns = []; kites = []; flocks = []; streams = []; particles = []; pops = [];
    rng = makeRng(endless ? (Date.now() & 0xffff) : 2000 + i * 7919);
    nextSpawnX = FIRST_X; spawnCount = 0; lastGapY = 110;
    camX = 0; playT = 0; ready = true; boostT = 0; lastDraft = null;
    bird.y = 110; bird.vy = 0; bird.rot = 0; bird.glide = 0;
    scoreAtStart = score; lanternsGot = 0; combo = 0; gapsPassed = 0;
    wind = { phase: 'calm', t: 200, dir: -1 };
    storm = { t: 150, flash: 0, bolt: null };
    kraken = cfg.boss ? { state: 'lurk', t: 0, y: 110, lane: 110, reach: 0, hold: 0 } : null;
    setState('playing');
  }

  // Endless difficulty ramps with every spire pair spawned.
  function updateEndlessCfg(n) {
    cfg.speed = Math.min(2.4, 1.6 + n * 0.008);
    cfg.gap = [Math.max(64, 86 - n * 0.3), 0];
    cfg.move = n > 12 ? Math.min(24, (n - 12) * 1.2) : 0;
    cfg.flocks = n > 30 ? Math.min(0.6, (n - 30) * 0.02) : 0;
    cfg.kites = n > 20 ? 0.25 : 0;
    cfg.wind = n > 45 ? 1 : 0;
    cfg.theme = ENDLESS_THEMES[Math.floor(n / 20) % ENDLESS_THEMES.length];
    cfg.charged = cfg.theme === 'storm' ? 0.35 : 0;
  }

  const gapAt = (x) => (endless ? cfg.gap[0] : lerp(cfg.gap[0], cfg.gap[1], clamp(x / cfg.len, 0, 1)));
  const draftAt = (x) => { for (const [a, b, dir] of cfg.drafts) if (x >= a * cfg.len && x < b * cfg.len) return dir; return null; };
  const ceilAt = (x) => 34 + 18 * Math.sin(x / 90) + 10 * Math.sin(x / 37);
  const floorAt = (x) => SEA_Y - 28 - 18 * Math.sin(x / 110 + 2) - 8 * Math.sin(x / 41);
  const spireGapY = (p) => p.baseY + p.amp * Math.sin(playT * 0.03 + p.phase);
  const zapPhase = (p) => (p.charged ? (playT + p.zap) % ZAP_CYCLE : 0);
  const kiteY = (k) => k.baseY + k.amp * Math.sin(playT * 0.04 + k.phase);

  function spawnAhead() {
    while (nextSpawnX < camX + W + 80 && nextSpawnX < cfg.len - 160) {
      spawnSlot(nextSpawnX);
      nextSpawnX += cfg.spacing + Math.floor(rng() * 24);
    }
  }

  function spawnSlot(x) {
    if (endless) updateEndlessCfg(spawnCount);
    spawnCount++;
    const gap = gapAt(x);
    let top = 14, bot = SEA_Y - 14;
    if (cfg.cave) { top = ceilAt(x + SPIRE_W / 2) + 6; bot = floorAt(x + SPIRE_W / 2) - 6; }
    const lo = top + gap / 2, hi = Math.max(lo, bot - gap / 2);
    const y = clamp(clamp(lerp(lo, hi, rng()), lastGapY - 70, lastGapY + 70), lo, hi);
    let amp = cfg.move && rng() < 0.75 ? cfg.move : 0;
    amp = Math.max(0, Math.min(amp, y - lo, hi - y));
    const charged = cfg.charged && x > FIRST_X && rng() < cfg.charged;
    const spire = { x, baseY: y, gap, amp, phase: rng() * Math.PI * 2, passed: false, seed: Math.floor(rng() * 1000), charged, zap: Math.floor(rng() * ZAP_CYCLE) };
    spires.push(spire);
    const mid = x + cfg.spacing / 2 + SPIRE_W / 2;
    if (rng() < cfg.lanterns) lanterns.push({ x: x + SPIRE_W / 2, y, spire, got: false });
    if (rng() < cfg.lanterns * 0.6) lanterns.push({ x: mid, y: (y + lastGapY) / 2, spire: null, got: false });
    if (cfg.boost && rng() < cfg.boost) streams.push({ x: mid, y: clamp((y + lastGapY) / 2, 40, SEA_Y - 40), got: false });
    else if (cfg.kites && x > FIRST_X && rng() < cfg.kites)
      kites.push({ x: mid, baseY: clamp((y + lastGapY) / 2, 50, SEA_Y - 50), amp: 26, phase: rng() * 6 });
    else if (cfg.flocks && x > FIRST_X && rng() < cfg.flocks) {
      const n = 3 + Math.floor(rng() * 2);
      flocks.push({ x: mid + 150, baseY: lerp(50, SEA_Y - 60, rng()), y: 0, vx: 0.8 + rng() * 0.5, wob: rng() * 6, home: spawnCount > 8 ? 0.008 : 0, n, t: 0 });
    }
    lastGapY = y;
  }

  // ===================== State transitions & events =====================
  function setState(s) { state = s; stateT = 0; }

  function flap() {
    bird.vy = Math.max(FLAP_V, bird.vy + FLAP_KICK);
    bird.glide = 1; bird.wingT = 0;
    sfx.flap();
    for (let i = 0; i < 3; i++) // little air puffs pushed down and back by the wingbeat
      particles.push({ x: BIRD_X - 2, y: bird.y + 4, vx: -0.8 - Math.random(), vy: 0.4 + Math.random() * 0.5, life: 16, max: 16, color: '#ffffffb0', size: 2, kind: 'puff' });
  }

  function crash() {
    sfx.crash();
    shake = 12; flash = 0.8;
    const feathers = [PAL_SWALLOW.b, PAL_SWALLOW.d, PAL_SWALLOW.r, PAL_SWALLOW.c];
    for (let i = 0; i < 24; i++) { // a puff of feathers drifts away
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      particles.push({ x: BIRD_X, y: bird.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 70 + Math.random() * 40, max: 110, color: feathers[i % feathers.length], size: 3, kind: 'scrap', spin: Math.random() * 6 });
    }
    lives--;
    bird.vy = -2;
    setState('crash');
  }

  function courseClear() {
    const bonus = endless ? 0 : 10 + courseIdx * 2;
    score += bonus;
    clearBonus = bonus;
    for (let i = 0; i < 30; i++) // a flurry of sky lanterns rises past
      particles.push({ x: Math.random() * W, y: SEA_Y + Math.random() * 40, vx: (Math.random() - 0.5) * 0.4, vy: -0.6 - Math.random() * 0.8, life: 200, max: 200, color: ['#ffb74d', '#ff8a65', '#ffe082'][i % 3], size: 3, kind: 'lantern', spin: Math.random() * 6 });
    if (courseIdx + 1 > bestCourse && courseIdx + 1 < COURSES.length) { bestCourse = courseIdx + 1; api.storage.set('best', bestCourse); }
    saveHi();
    sfx.clear();
    setState('clear');
  }

  function saveHi() {
    if (score > hiScore) { hiScore = score; newRecord = true; api.storage.set('hi', hiScore); }
    if (endless && gapsPassed > endlessHi) { endlessHi = gapsPassed; newRecord = true; api.storage.set('endlessHi', endlessHi); }
  }

  function addPop(x, y, text, color = '#ffffff') { pops.push({ x, y, text, t: 0, color }); }

  // Collision against the swallow's body circle, in screen space.
  const hitsRect = (x, y, w, h) => circleHitsRect(BIRD_X + BODY_DX, bird.y, BODY_R, x, y, w, h);
  const hitsCircle = (x, y, r) => Math.hypot(x - BIRD_X - BODY_DX, y - bird.y) < r + BODY_R;
  function hitsSpire(p) {
    const cx = p.x - camX + SPIRE_W / 2;
    const gy = spireGapY(p), gt = gy - p.gap / 2, gb = gy + p.gap / 2;
    if (hitsRect(cx - 9, -40, 18, gt - 8 + 40) || hitsRect(cx - 5, gt - 8, 10, 8)) return true;   // hanging spire
    if (hitsRect(cx - 9, gb + 8, 18, SEA_Y + 40 - gb) || hitsRect(cx - 5, gb, 10, 8)) return true; // rising spire
    return zapPhase(p) >= ZAP_FIRE && hitsRect(cx - 3, gt, 6, p.gap * 0.45);                     // lightning bolt
  }

  // ===================== Update =====================
  function update(input) {
    stateT++;
    const tap = input.pressed.a || input.pressed.up;
    if (state === 'title') updateTitle(input);
    else if (state === 'playing') updatePlaying(input, tap);
    else if (state === 'paused') {
      if (input.pressed.start) { sfx.pause(); setState('playing'); }
      else if (input.pressed.select) { sfx.menu(); setState('title'); }
      return; // frozen
    } else if (state === 'crash') updateCrash(input, tap);
    else if (state === 'clear') updateClear(input, tap);
    else if ((state === 'gameOver' || state === 'victory') && stateT > 50 && (input.pressed.start || input.pressed.a)) {
      sfx.menu();
      if (state === 'gameOver' && input.pressed.a && !endless) startRun(courseIdx);
      else { sel = endless ? ENDLESS_INDEX : Math.min(bestCourse, COURSES.length - 1); setState('title'); }
    }
    updateEffects();
  }

  function updateTitle(input) {
    titleCam += 0.8;
    const maxSel = endlessUnlocked ? ENDLESS_INDEX : bestCourse;
    if (input.pressed.left) { sel = sel > 0 ? sel - 1 : maxSel; sfx.menu(); }
    if (input.pressed.right) { sel = sel < maxSel ? sel + 1 : 0; sfx.menu(); }
    if (stateT > 15 && (input.pressed.start || input.pressed.a)) startRun(sel);
  }

  function updatePlaying(input, tap) {
    if (input.pressed.start) { sfx.pause(); setState('paused'); return; }
    bird.wingT++;
    if (ready) { // hover until the first wingbeat
      bird.y = 110 + Math.sin(stateT * 0.08) * 4;
      if (tap) { ready = false; flap(); }
      return;
    }
    playT++;
    const wx = camX + BIRD_X;
    const draft = draftAt(wx);
    if (draft !== lastDraft) { if (draft) { sfx.draft(); flash = 0.15; } lastDraft = draft; }
    if (tap) flap();

    // physics: wingbeat kick + brief glide lift, gravity pulls down, air columns and gusts push
    bird.glide = Math.max(0, bird.glide - 0.08);
    bird.vy = clamp(bird.vy + GRAVITY - bird.glide * GLIDE_LIFT + (draft ? DRAFT[draft] : 0) + windForce(), -MAX_VY, MAX_VY);
    bird.y += bird.vy;
    bird.rot = clamp(bird.vy * 0.07, -0.35, 0.5);
    const speed = cfg.speed * (boostT > 0 ? 1.6 : 1);
    camX += speed;
    if (boostT > 0) {
      boostT--;
      if (boostT % 3 === 0) particles.push({ x: W + 5, y: 20 + Math.random() * 180, vx: -9, vy: 0, life: 40, max: 40, color: '#b2ebf2', size: 1, kind: 'streak' });
    }

    spawnAhead();
    updateHazards(speed);

    // collisions
    if (bird.y + BODY_R >= SEA_Y) return crash();
    if (cfg.cave) {
      if (bird.y - BODY_R < ceilAt(wx) || bird.y + BODY_R > floorAt(wx)) return crash();
    } else if (bird.y - BODY_R < 2) { bird.y = 2 + BODY_R; bird.vy = Math.max(bird.vy, 0.5); }
    for (const p of spires) {
      if (p.x > wx + 20 || p.x + SPIRE_W < wx - 20) continue;
      if (hitsSpire(p)) return crash();
    }
    for (const k of kites) if (hitsCircle(k.x - camX, kiteY(k), 5)) return crash();
    for (const f of flocks)
      for (let i = 0; i < f.n; i++) {
        const [ox, oy] = flockOffset(i);
        if (hitsCircle(f.x - camX + ox, f.y + oy, 3)) return crash();
      }
    if (kraken && kraken.reach > 0 && hitsRect(0, kraken.lane - 4, kraken.reach, 8)) return crash();

    // scoring
    for (const p of spires) {
      if (!p.passed && p.x + SPIRE_W < wx - 6) {
        p.passed = true;
        score++; gapsPassed++;
        sfx.chime(combo++);
        addPop(p.x + SPIRE_W / 2 - camX, spireGapY(p), '+1');
      }
    }
    for (const c of lanterns) {
      if (c.got) continue;
      const cy = c.spire ? spireGapY(c.spire) : c.y;
      if (hitsCircle(c.x - camX, cy, 5)) {
        c.got = true; score += 5; lanternsGot++;
        sfx.lantern();
        addPop(c.x - camX, cy - 10, '+5', '#ffb74d');
        for (let i = 0; i < 6; i++) particles.push({ x: c.x - camX, y: cy, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 20, max: 20, color: '#ffe082', size: 2, kind: 'spark' });
      }
    }
    for (const s of streams) {
      if (!s.got && Math.abs(s.x - wx) < 8 && Math.abs(s.y - bird.y) < 16) {
        s.got = true; score += 3; boostT = 120; sfx.stream(); flash = 0.2;
        addPop(s.x - camX, s.y - 20, 'TAILWIND +3', '#80deea');
      }
    }

    // cull what scrolled off the left edge
    spires = spires.filter((p) => p.x + SPIRE_W > camX - 10);
    lanterns = lanterns.filter((c) => !c.got && c.x > camX - 10);
    streams = streams.filter((s) => s.x > camX - 20);
    kites = kites.filter((k) => k.x > camX - 20);
    flocks = flocks.filter((f) => f.x > camX - 50);

    if (wx >= cfg.len) courseClear();
  }

  function windForce() {
    return cfg.wind && wind.phase === 'gust' ? wind.dir * cfg.wind * 0.06 : 0;
  }

  const flockOffset = (i) => [Math.ceil(i / 2) * 8, (i & 1 ? -1 : 1) * Math.ceil(i / 2) * 5]; // V formation

  function updateHazards(speed) {
    // gusts: calm -> warn (telegraph) -> gust
    if (cfg.wind) {
      if (--wind.t <= 0) {
        if (wind.phase === 'calm') { wind.phase = 'warn'; wind.t = 50; wind.dir = rng() < 0.5 ? -1 : 1; }
        else if (wind.phase === 'warn') { wind.phase = 'gust'; wind.t = 80; sfx.gust(); }
        else { wind.phase = 'calm'; wind.t = 150 + Math.floor(rng() * 120); }
      }
      if (wind.phase === 'gust' && playT % 2 === 0)
        particles.push({ x: Math.random() * W, y: wind.dir > 0 ? -4 : SEA_Y, vx: -speed, vy: wind.dir * 7, life: 40, max: 40, color: '#e0f7fa', size: 1, kind: 'streak' });
    }
    // background lightning (harmless, just drama)
    if (THEMES[cfg.theme].rain) {
      storm.flash = Math.max(0, storm.flash - 0.05);
      if (--storm.t <= 0) {
        storm.t = 160 + Math.floor(rng() * 200);
        storm.flash = 1;
        let bx = 40 + rng() * 240;
        storm.bolt = [];
        for (let y = 0; y < SEA_Y; y += 16) { storm.bolt.push([bx, y]); bx += (rng() - 0.5) * 30; }
        shake = Math.max(shake, 4);
        sfx.thunder();
      }
    }
    // charged thunderheads crackle, then discharge into the top half of their gap
    for (const p of spires) {
      if (!p.charged || p.x - camX > W || p.x - camX < -SPIRE_W) continue;
      const z = zapPhase(p);
      if (z === ZAP_WARN) sfx.crackle();
      if (z === ZAP_FIRE) { sfx.zap(); flash = Math.max(flash, 0.25); }
    }
    // flocks of geese fly toward you once on screen; later ones steer at you
    for (const f of flocks) {
      if (f.x - camX < W + 30) {
        f.x -= f.vx; f.t++;
        if (f.home) f.baseY += clamp(bird.y - f.baseY, -1, 1) * f.home * 40;
      }
      f.y = f.baseY + Math.sin(playT * 0.05 + f.wob) * 8;
    }
    if (kraken) updateKraken();
  }

  // The boss: lurks in the storm behind you, marks a lane, then lashes a tentacle across it.
  function updateKraken() {
    const k = kraken;
    k.t++;
    const progress = (camX + BIRD_X) / cfg.len;
    if (k.state === 'lurk') {
      k.y = lerp(k.y, bird.y, 0.03);
      k.reach = Math.max(0, k.reach - 8);
      if (k.t > lerp(160, 85, progress)) { k.state = 'warn'; k.t = 0; k.lane = clamp(bird.y + 1, 30, SEA_Y - 30); sfx.rumble(); }
    } else if (k.state === 'warn') {
      k.y = lerp(k.y, k.lane, 0.1);
      if (k.t > 65) { k.state = 'lash'; k.t = 0; sfx.lash(); }
    } else if (k.state === 'lash') {
      k.reach = Math.min(W + 10, k.reach + 11);
      if (k.reach >= W + 10 && k.t > 45) { k.state = 'lurk'; k.t = 0; shake = Math.max(shake, 3); }
    }
  }

  function updateCrash(input, tap) {
    // the stunned swallow tumbles into the cloud sea
    if (bird.y < SEA_Y + 14) {
      bird.vy = Math.min(bird.vy + 0.25, 5);
      bird.y += bird.vy;
      bird.rot += 0.2;
    }
    if (stateT > 100 || (stateT > 45 && (tap || input.pressed.start))) {
      if (lives <= 0) {
        saveHi();
        sfx.gameOver();
        setState('gameOver');
      } else {
        score = scoreAtStart;
        loadCourse(courseIdx);
      }
    }
  }

  function updateClear(input, tap) {
    camX += cfg.speed;
    bird.wingT++;
    bird.y = lerp(bird.y, 80 + Math.sin(stateT * 0.06) * 6, 0.05);
    bird.rot = lerp(bird.rot, 0, 0.1);
    if (kraken) { kraken.state = 'lurk'; kraken.reach = Math.max(0, kraken.reach - 8); kraken.y += 1.5; }
    if (stateT > 200 || (stateT > 60 && (tap || input.pressed.start))) {
      if (courseIdx + 1 >= COURSES.length) {
        endlessUnlocked = true; api.storage.set('endless', true);
        saveHi();
        sfx.victory();
        setState('victory');
      } else loadCourse(courseIdx + 1);
    }
  }

  function updateEffects() {
    shake = Math.max(0, shake - 0.6);
    flash = Math.max(0, flash - 0.05);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.life--;
      if (p.kind === 'scrap') { p.vy = Math.min(p.vy + 0.05, 1); p.vx *= 0.97; p.x += Math.sin(p.life * 0.15 + p.spin) * 0.6; }
      else if (p.kind === 'lantern') p.x += Math.sin(p.life * 0.05 + p.spin) * 0.3;
      else if (p.kind === 'puff') { p.vx *= 0.93; p.vy *= 0.93; }
    }
    particles = particles.filter((p) => p.life > 0);
    if (particles.length > 300) particles.splice(0, particles.length - 300);
    for (const p of pops) { p.t++; p.y -= 0.6; }
    pops = pops.filter((p) => p.t < 45);
    if (state === 'victory' && stateT % 25 === 0)
      for (let i = 0; i < 6; i++)
        particles.push({ x: Math.random() * W, y: H + 4, vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.6, life: 300, max: 300, color: ['#ffb74d', '#ff8a65', '#ffe082'][i % 3], size: 3, kind: 'lantern', spin: Math.random() * 6 });
  }

  // ===================== Draw: sky & distant layers =====================
  function drawSky(g, th, cam) {
    const grad = g.createLinearGradient(0, 0, 0, SEA_Y);
    grad.addColorStop(0, th.sky[0]);
    grad.addColorStop(1, th.sky[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    if (th.stars)
      for (let i = 0; i < 50; i++) {
        g.fillStyle = (api.frame + i * 13) % 90 < 8 ? '#90caf9' : '#ffffff';
        g.fillRect(Math.floor(mod(hash(i) * W - cam * 0.02, W)), Math.floor(hash(i + 50) * 130), 1, 1);
      }
    if (th.aurora) // slow ribbons of light
      for (let r = 0; r < 2; r++) {
        g.fillStyle = r ? '#ff6ec730' : '#5effc040';
        for (let x = 0; x < W; x += 3) {
          const y = 30 + r * 22 + 14 * Math.sin((x + cam * 0.05) / 40 + api.frame * 0.01 + r * 2);
          g.fillRect(x, Math.floor(y), 3, 18 + Math.floor(8 * Math.sin(x / 17 + api.frame * 0.02)));
        }
      }
    if (th.orb) { // sun low on the horizon, or a crescent moon
      const ox = 236, oy = th.orbY, r = th.moon ? 11 : 18;
      fillEllipse(g, ox, oy, r, r, th.orb);
      if (th.moon) fillEllipse(g, ox + 5, oy - 3, r - 2, r - 2, th.sky[0]);
      else { g.fillStyle = th.orb + '40'; g.fillRect(ox - 40, oy + 6, 80, 2); g.fillRect(ox - 30, oy + 12, 60, 2); }
    }
    if (th.cloud) // long thin cloud streaks
      for (let i = 0; i < 6; i++) {
        const cx = Math.floor(mod(i * 73 + hash(i) * 50 - cam * 0.07, W + 120) - 60);
        const cy = Math.floor(20 + hash(i + 9) * 80);
        g.fillStyle = th.cloud;
        g.fillRect(cx, cy, 56, 3);
        g.fillRect(cx + 10, cy - 2, 28, 2);
        g.fillRect(cx + 26, cy + 3, 40, 2);
      }
    // far mountain range with snowy peaks
    if (th.far)
      for (let x = 0; x < W; x += 3) {
        const wx = x + cam * 0.08;
        const y = Math.floor(118 + 26 * Math.sin(wx / 63) + 12 * Math.abs(Math.sin(wx / 19)));
        g.fillStyle = th.far; g.fillRect(x, y, 3, SEA_Y - y);
        if (y < 112) { g.fillStyle = th.snow; g.fillRect(x, y, 3, Math.min(6, 112 - y)); }
      }
    // nearer rolling ridges
    g.fillStyle = th.near;
    for (let x = 0; x < W; x += 4) {
      const wx = x + cam * 0.2;
      const y = Math.floor(170 + 14 * Math.sin(wx / 47 + 1) + 6 * Math.sin(wx / 15));
      g.fillRect(x, y, 4, SEA_Y - y);
    }
  }

  // The cloud sea: a rolling foreground layer hiding the spires' bases.
  function drawSea(g, th, cam) {
    for (let x = 0; x < W; x += 4) {
      const wx = x + cam;
      const y = Math.floor(SEA_Y - 2 + 3 * Math.sin(wx / 23) + 2 * Math.sin(wx / 9 + api.frame * 0.03));
      g.fillStyle = th.sea[1]; g.fillRect(x, y, 4, 3);
      g.fillStyle = th.sea[0]; g.fillRect(x, y + 3, 4, H - y);
    }
    g.fillStyle = th.sea[1];
    for (let i = 0; i < 8; i++) // drifting billows on the surface
      fillEllipse(g, mod(i * 47 - cam * 1.2, W + 40) - 20, SEA_Y + 8 + (i % 3) * 5, 10, 2, th.sea[1]);
  }

  // ===================== Draw: world =====================
  function drawCavern(g, th) {
    for (let sx = 0; sx < W; sx += 4) {
      const wx = camX + sx;
      const c = Math.floor(ceilAt(wx)), f = Math.floor(floorAt(wx));
      const bump = Math.floor(2 * Math.sin(wx / 6));
      g.fillStyle = th.wall[0];
      g.fillRect(sx, 0, 4, c + bump);
      g.fillRect(sx, f - bump, 4, SEA_Y - f + bump);
      g.fillStyle = th.wall[1];
      g.fillRect(sx, c + bump - 3, 4, 3);
      g.fillRect(sx, f - bump, 4, 3);
      if (hash(Math.floor(wx / 4)) > 0.93) { g.fillStyle = th.cap; g.fillRect(sx + 1, c + bump, 2, 4); } // glowing amber crystals
    }
  }

  function drawDrafts(g) {
    for (const [a, b, dir] of cfg.drafts) {
      const x0 = Math.floor(a * cfg.len - camX), x1 = Math.floor(b * cfg.len - camX);
      if (x1 < 0 || x0 > W) continue;
      const up = dir === 'up';
      g.fillStyle = up ? '#ffcc8028' : '#7fa8ff28';
      g.fillRect(x0, 0, x1 - x0, SEA_Y);
      const col = up ? '#ffd9a0' : '#b3c8ff';
      const drift = Math.floor(mod(api.frame * (up ? -1.5 : 1.5), 24));
      for (let x = Math.max(x0 + 8, -8 + mod(x0, 24)); x < Math.min(x1 - 4, W); x += 24)
        for (let y = drift - 24; y < SEA_Y; y += 24) {
          if (y < 0) continue;
          api.text(up ? '^' : 'v', x, y, { color: col });
        }
    }
  }

  // Spires: a stalactite hanging from a cloud bank above, a rock pinnacle rising from the sea below.
  function spireHalfW(d, seed) {
    return d < TIP_LEN ? 3 + (10 * d) / TIP_LEN : 13 + Math.floor(hash(seed + Math.floor(d / 6)) * 4) - 1;
  }
  function drawSpire(g, p, th) {
    const cx = Math.floor(p.x - camX + SPIRE_W / 2);
    const gy = spireGapY(p), gt = Math.floor(gy - p.gap / 2), gb = Math.floor(gy + p.gap / 2);
    const top = th.thunder || th.rock;
    for (let d = 0; gt - d > -3; d += 3) { // hanging part, from the tip upward
      const bump = th.thunder ? Math.round(2 * Math.sin(d * 0.5 + p.seed)) : 0;
      const hw = Math.round(spireHalfW(d, p.seed) + bump), y = gt - d - 3;
      g.fillStyle = top[1]; g.fillRect(cx - hw, y, hw * 2, 3);
      g.fillStyle = top[0]; g.fillRect(cx - hw + 1, y, hw * 2 - 3, 3);
      g.fillStyle = top[2]; g.fillRect(cx - hw + 2, y, 2, 3);
    }
    if (th.cloud) { // cloud bank the stalactite hangs from
      fillEllipse(g, cx - 10, 4, 14, 6, th.cloud);
      fillEllipse(g, cx + 9, 2, 15, 7, th.cloud);
    }
    for (let d = 0; gb + d < SEA_Y + 6; d += 3) { // rising part, from the tip downward
      const hw = Math.round(spireHalfW(d, p.seed + 500)), y = gb + d;
      g.fillStyle = th.rock[1]; g.fillRect(cx - hw, y, hw * 2, 3);
      g.fillStyle = th.rock[0]; g.fillRect(cx - hw + 1, y, hw * 2 - 3, 3);
      g.fillStyle = th.rock[2]; g.fillRect(cx - hw + 2, y, 2, 3);
    }
    g.fillStyle = th.cap; // frosted tip
    g.fillRect(cx - 3, gb, 6, 2); g.fillRect(cx - 5, gb + 2, 10, 2);
    if (p.amp) { g.fillStyle = '#ffffff60'; g.fillRect(cx - 1, gb - 4 - Math.floor(2 * Math.sin(playT * 0.1)), 2, 2); } // drifting pebble = moving spire
    if (p.charged) drawCharge(g, p, cx, gt);
  }

  function drawCharge(g, p, cx, gt) {
    const z = zapPhase(p);
    if (z >= ZAP_WARN && z < ZAP_FIRE) { // crackling sparks at the cloud tip
      g.fillStyle = (z >> 1) & 1 ? '#fff59d' : '#80d8ff';
      for (let i = 0; i < 4; i++) g.fillRect(cx - 6 + Math.floor(hash(z + i) * 12), gt - 4 + Math.floor(hash(z * 3 + i) * 8), 2, 1);
    } else if (z >= ZAP_FIRE) { // the bolt
      const len = p.gap * 0.45;
      g.fillStyle = '#80d8ff60'; g.fillRect(cx - 4, gt, 8, len);
      g.fillStyle = '#ffffff';
      let x = cx;
      for (let y = 0; y < len; y += 4) { g.fillRect(x - 1, gt + y, 2, 4); x = cx + Math.round((hash(y + z) - 0.5) * 4); }
    } else if ((playT >> 4) & 1) { g.fillStyle = '#80d8ff'; g.fillRect(cx - 1, gt + 1, 2, 2); } // dormant glint
  }

  function drawGoal(g) { // a string of pennants marks the course end
    const fx = Math.floor(cfg.len - camX);
    if (fx < -20 || fx > W + 20) return;
    g.fillStyle = '#ffffffa0'; g.fillRect(fx, 0, 1, SEA_Y);
    const cols = ['#ff7b39', '#2a9d8f', '#ffd166', '#e0457b'];
    for (let y = 4, i = 0; y < SEA_Y; y += 10, i++) {
      const sway = Math.round(Math.sin(api.frame * 0.1 + i) * 1.5);
      g.fillStyle = cols[i % 4];
      g.fillRect(fx + 1, y, 7 + sway, 2); g.fillRect(fx + 1, y + 2, 4 + sway, 2); g.fillRect(fx + 1, y + 4, 2, 1);
    }
    api.text('GOAL', fx + 4, 40, { color: '#ffd166', shadow: '#000', align: 'center' });
  }

  function drawBird(g, x, y, rot, scale, frame) {
    g.save();
    g.translate(Math.round(x), Math.round(y));
    if (rot) g.rotate(rot);
    if (scale !== 1) g.scale(scale, scale);
    g.drawImage(birdFrames[frame].cv, -10, -6);
    g.restore();
  }

  function drawKite(g, k) {
    const x = Math.floor(k.x - camX), y = Math.floor(kiteY(k));
    if (x < -20 || x > W + 20) return;
    g.fillStyle = '#ffffff50'; // string trails down to someone far below
    for (let i = 1; i < 14; i++) g.fillRect(x + i * 2, y + 7 + i * 4, 1, 3);
    for (let r = -7; r <= 7; r++) { // diamond
      const hw = 6 - Math.round(Math.abs(r) * 6 / 7);
      g.fillStyle = r < 0 ? '#ef476f' : '#118ab2';
      g.fillRect(x - hw, y + r, hw * 2 + 1, 1);
    }
    g.fillStyle = '#ffffff'; g.fillRect(x, y - 7, 1, 15); g.fillRect(x - 6, y, 13, 1);
    for (let i = 0; i < 4; i++) { // fluttering bow tail
      g.fillStyle = i & 1 ? '#ffd166' : '#ef476f';
      g.fillRect(x - 1 + Math.round(Math.sin(api.frame * 0.2 + i) * 2), y + 9 + i * 4, 3, 2);
    }
  }

  function drawFlock(g, f) {
    if (f.x - camX > W + 40) return;
    const flap = (f.t >> 3) & 1;
    g.fillStyle = '#1a1420';
    for (let i = 0; i < f.n; i++) {
      const [ox, oy] = flockOffset(i);
      const x = Math.floor(f.x - camX + ox), y = Math.floor(f.y + oy);
      g.fillRect(x - 2, y, 6, 2);                        // body
      g.fillRect(x - 5, y - 1, 3, 1);                    // long neck + head (they fly left)
      if (flap) { g.fillRect(x, y - 3, 2, 3); g.fillRect(x + 1, y - 5, 2, 2); }
      else { g.fillRect(x, y + 2, 2, 2); g.fillRect(x + 1, y + 4, 2, 2); }
    }
  }

  function drawKraken(g) {
    const k = kraken;
    if (k.state === 'warn') { // marked lane
      g.fillStyle = (stateT >> 2) & 1 ? '#e040fb' : '#e040fb50';
      for (let x = 40; x < W; x += 12) g.fillRect(x, Math.floor(k.lane), 6, 1);
      api.text('!', 44, k.lane - 18, { color: '#e040fb', scale: 2, shadow: '#000' });
    }
    if (k.reach > 0) { // the lashing tentacle
      const y0 = Math.floor(k.lane);
      for (let x = 10; x < k.reach; x += 3) {
        const t = x / Math.max(k.reach, 1);
        const th = Math.max(2, Math.round(lerp(10, 3, t)));
        const wy = y0 + Math.round(Math.sin(x * 0.08 - stateT * 0.3) * 2);
        g.fillStyle = '#5e1f6e'; g.fillRect(x, wy - th / 2, 3, th);
        g.fillStyle = '#9c3fb5'; g.fillRect(x, wy - th / 2, 3, Math.max(1, th / 2 - 1));
        if (x % 9 === 1 && th > 4) { g.fillStyle = '#f8bbd0'; g.fillRect(x, wy + 1, 2, 2); } // suckers
      }
    }
    const y = Math.floor(k.y), bob = Math.round(Math.sin(stateT * 0.05) * 3);
    for (let i = 0; i < 4; i++) { // dangling arms
      g.fillStyle = '#5e1f6e';
      for (let s = 0; s < 8; s++) g.fillRect(4 + i * 7 + Math.round(Math.sin(s * 0.6 + stateT * 0.08 + i) * 3), y + 16 + s * 4, 4, 4);
    }
    fillEllipse(g, -2, y + bob, 30, 22, '#5e1f6e');
    fillEllipse(g, -4, y + bob - 4, 26, 16, '#7b2d8e');
    fillEllipse(g, -8, y + bob - 12, 12, 5, '#9c3fb5');
    g.fillStyle = '#ffeb3b'; g.fillRect(16, y + bob + 2, 7, 6);
    g.fillStyle = '#1a0a1f'; g.fillRect(19, y + bob + 2, 2, 6);
  }

  function drawWorld(g) {
    const th = THEMES[cfg.theme];
    drawSky(g, th, camX);
    if (cfg.cave) drawCavern(g, th);
    drawDrafts(g);
    for (const p of spires) if (p.x - camX < W + 30) drawSpire(g, p, th);
    drawGoal(g);
    for (const c of lanterns) { // paper sky lanterns
      const cx = Math.floor(c.x - camX), cy = Math.floor(c.spire ? spireGapY(c.spire) : c.y) + Math.round(Math.sin(api.frame * 0.06 + c.x) * 2);
      if (cx < -8 || cx > W + 8) continue;
      g.fillStyle = '#ffb74d30'; g.fillRect(cx - 6, cy - 7, 12, 14);
      g.fillStyle = '#e65100'; g.fillRect(cx - 4, cy - 4, 8, 8); g.fillRect(cx - 3, cy - 5, 6, 10);
      g.fillStyle = (api.frame >> 3) & 1 ? '#ffb74d' : '#ffa726'; g.fillRect(cx - 3, cy - 4, 6, 8);
      g.fillStyle = '#ffe082'; g.fillRect(cx - 1, cy - 2, 2, 4);
      g.fillStyle = '#5d4037'; g.fillRect(cx - 3, cy - 6, 6, 1); g.fillRect(cx - 3, cy + 5, 6, 1);
    }
    for (const s of streams) { // jet-stream swirls
      const sx = Math.floor(s.x - camX), sy = Math.floor(s.y);
      if (sx < -16 || sx > W + 16) continue;
      for (let i = 0; i < 10; i++) {
        const a = i * 0.63 + api.frame * 0.12, r = 9 + (i & 1) * 4;
        g.fillStyle = s.got ? '#ffffff30' : i & 1 ? '#80deea' : '#e0f7fa';
        g.fillRect(sx + Math.round(Math.cos(a) * r * 0.6), sy + Math.round(Math.sin(a) * r), 2, 2);
      }
    }
    for (const k of kites) drawKite(g, k);
    for (const f of flocks) drawFlock(g, f);
    if (kraken) drawKraken(g);
    if (state !== 'victory') drawBird(g, BIRD_X, bird.y, bird.rot, 1, state === 'crash' ? 1 : wingFrame(bird.wingT));
    drawParticles(g);
    drawSea(g, th, camX);
    if (th.rain) {
      g.fillStyle = '#b0bec580';
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(mod(hash(i) * 400 - api.frame * 2 - camX * 0.5, W));
        const y = Math.floor(mod(hash(i + 99) * 300 + api.frame * 8, H));
        g.fillRect(x, y, 1, 6);
      }
    }
    if (storm.flash > 0 && storm.bolt) {
      g.fillStyle = `rgba(255,255,255,${(storm.flash * 0.45).toFixed(2)})`;
      g.fillRect(0, 0, W, H);
      if (storm.flash > 0.6) {
        g.fillStyle = '#e1f5fe';
        for (let i = 1; i < storm.bolt.length; i++) {
          const [x0, y0] = storm.bolt[i - 1], [x1] = storm.bolt[i];
          for (let s = 0; s < 16; s += 2) g.fillRect(Math.floor(lerp(x0, x1, s / 16)), y0 + s, 2, 2);
        }
      }
    }
  }

  function drawParticles(g) {
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life / (p.max * 0.4));
      g.fillStyle = p.color;
      if (p.kind === 'streak') g.fillRect(Math.floor(p.x), Math.floor(p.y), p.vy ? 1 : 8, p.vy ? 8 : 1);
      else if (p.kind === 'scrap') g.fillRect(Math.floor(p.x), Math.floor(p.y), Math.ceil(Math.abs(Math.sin(p.life * 0.2 + p.spin)) * 4 + 1), 3);
      else if (p.kind === 'lantern') {
        g.fillRect(Math.floor(p.x), Math.floor(p.y), 3, 4);
        g.fillStyle = '#fff8e1'; g.fillRect(Math.floor(p.x) + 1, Math.floor(p.y) + 1, 1, 2);
      } else g.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  // ===================== Draw: HUD & screens =====================
  function drawHud(g) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) // outlined score
      api.text(String(score), W / 2 + dx, 6 + dy, { scale: 2, align: 'center', color: '#1a0a1f' });
    api.text(String(score), W / 2, 6, { scale: 2, align: 'center', color: '#fff1d6' });
    api.text(endless ? 'ENDLESS' : `${courseIdx + 1}. ${cfg.name}`, 4, 4, { color: '#ffffff', shadow: '#000' });
    if (endless) api.text(`GAPS ${gapsPassed}`, 4, 13, { color: '#ffb74d', shadow: '#000' });
    else { // progress bar to the goal
      const p = clamp((camX + BIRD_X) / cfg.len, 0, 1);
      g.fillStyle = '#00000080'; g.fillRect(4, 14, 72, 4);
      g.fillStyle = '#ff9e40'; g.fillRect(5, 15, Math.floor(70 * p), 2);
      g.fillStyle = '#ffffff'; g.fillRect(4 + Math.floor(70 * p), 12, 2, 8);
    }
    for (let i = 0; i < lives; i++) { // lives as little swallow silhouettes
      const x = W - 14 - i * 13, y = 6;
      g.fillStyle = '#0b1026'; g.fillRect(x - 1, y - 1, 12, 6);
      g.fillStyle = PAL_SWALLOW.b; g.fillRect(x + 3, y + 1, 6, 2); g.fillRect(x, y, 3, 1); g.fillRect(x, y + 3, 3, 1);
      g.fillStyle = PAL_SWALLOW.r; g.fillRect(x + 8, y + 2, 2, 1);
    }
    if (lanternsGot) api.text(`*${lanternsGot}`, W - 4, 16, { color: '#ffb74d', align: 'right', shadow: '#000' });
    if (cfg.wind && wind.phase !== 'calm' && (wind.phase === 'gust' || (stateT >> 3) & 1))
      api.text(wind.dir < 0 ? 'GUST ^^' : 'GUST vv', W - 4, 27, { color: '#80deea', align: 'right', shadow: '#000' });
    if (lastDraft) api.text(lastDraft === 'up' ? 'UPDRAFT' : 'DOWNDRAFT', W / 2, SEA_Y - 14, { color: lastDraft === 'up' ? '#ffd9a0' : '#b3c8ff', align: 'center', shadow: '#000' });
    for (const p of pops)
      api.text(p.text, p.x, Math.floor(p.y), { color: p.t > 35 && (p.t & 2) ? '#00000000' : p.color, align: 'center', shadow: '#000' });
    if (ready && state === 'playing') {
      panel(g, 50, 132, 220, 64);
      api.text(endless ? 'ENDLESS MODE' : `COURSE ${courseIdx + 1}`, W / 2, 140, { color: '#ff9e40', align: 'center' });
      api.text(cfg.name, W / 2, 152, { scale: 2, align: 'center', shadow: '#000' });
      api.text(cfg.hint || '', W / 2, 170, { color: '#f8bbd0', align: 'center' });
      if ((stateT >> 4) & 1) api.text('J / UP: BEAT YOUR WINGS', W / 2, 182, { align: 'center' });
    }
  }

  function panel(g, x, y, w, h) {
    g.fillStyle = '#0b1026c8'; g.fillRect(x, y, w, h);
    g.fillStyle = '#e8643c'; g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
  }

  function drawTitle(g) {
    const th = THEMES.dawn;
    drawSky(g, th, titleCam);
    drawSea(g, th, titleCam);
    api.text('SPARROW', 116 + 2, 10 + 2, { scale: 4, align: 'center', color: '#0b1026' });
    api.text('SPARROW', 116, 10, { scale: 4, align: 'center', color: '#f3e6cc', shadow: '#17306e' });
    api.text('GLIDER', W / 2 + 40 + 2, 44 + 2, { scale: 4, align: 'center', color: '#0b1026' });
    api.text('GLIDER', W / 2 + 40, 44, { scale: 4, align: 'center', color: '#e8643c', shadow: '#5a1a10' });
    api.text('BEAT YOUR WINGS. RIDE THE STORM.', W / 2, 80, { align: 'center', color: '#fff1d6', shadow: '#000' });
    drawBird(g, 222, 22 + Math.sin(stateT * 0.05) * 4, Math.sin(stateT * 0.05) * -0.12, 3, wingFrame(stateT));
    panel(g, 40, 100, 240, 84);
    const isEndless = sel === ENDLESS_INDEX;
    api.text(isEndless ? 'ENDLESS MODE' : `COURSE ${sel + 1}`, W / 2, 108, { color: '#ff9e40', align: 'center' });
    api.text(isEndless ? `BEST: ${endlessHi} GAPS` : COURSES[sel].name, W / 2, 120, { scale: 2, align: 'center' });
    api.text('<', 50, 120, { scale: 2, color: '#f8bbd0' });
    api.text('>', 262, 120, { scale: 2, color: '#f8bbd0' });
    api.text('J OR UP BEATS YOUR WINGS', W / 2, 142, { color: '#f8bbd0', align: 'center' });
    api.text(`HI ${hiScore}   UNLOCKED ${bestCourse + 1}/${COURSES.length}`, W / 2, 154, { align: 'center' });
    if (!endlessUnlocked) api.text('BEAT COURSE 20 FOR ENDLESS', W / 2, 166, { color: '#9e9e9e', align: 'center' });
    else api.text('ENDLESS MODE UNLOCKED!', W / 2, 166, { color: '#80deea', align: 'center' });
    if ((stateT >> 5) & 1 || stateT < 20) api.text('PRESS START', W / 2, 196, { scale: 2, align: 'center', color: '#ffffff', shadow: '#000' });
  }

  function drawCenterScreen(g, title, color, lines, y = 56) {
    panel(g, 40, y, 240, 30 + lines.length * 12 + 20);
    api.text(title, W / 2, y + 10, { scale: 2, align: 'center', color, shadow: '#000' });
    lines.forEach(([t, c], i) => api.text(t, W / 2, y + 34 + i * 12, { align: 'center', color: c || '#ffffff' }));
  }

  function draw(g) {
    if (state === 'title') return drawTitle(g);
    g.save();
    if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
    drawWorld(g);
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${(flash * 0.6).toFixed(2)})`; g.fillRect(0, 0, W, H); }
    if (boostT > 0) { g.fillStyle = '#80deea'; g.fillRect(0, 0, W, 2); g.fillRect(0, H - 2, W, 2); }
    drawHud(g);
    const blink = (stateT >> 4) & 1;
    if (state === 'paused')
      drawCenterScreen(g, 'PAUSED', '#ff9e40', [[`COURSE ${courseIdx + 1}: ${cfg.name}`], ['START: RESUME', '#f8bbd0'], ['SELECT: QUIT TO TITLE', '#f8bbd0']]);
    else if (state === 'crash' && stateT > 30)
      api.text(lives > 0 ? `OOF!  ${lives} ${lives === 1 ? 'LIFE' : 'LIVES'} LEFT` : 'OOF!', W / 2, 100, { scale: 2, align: 'center', color: '#ff8a80', shadow: '#000' });
    else if (state === 'clear')
      drawCenterScreen(g, 'COURSE CLEAR!', '#80deea', [[cfg.name], [`LANTERNS ${lanternsGot}   BONUS +${clearBonus}`, '#ffb74d'], [stateT > 60 && blink ? 'PRESS J' : '', '#f8bbd0']], 124);
    else if (state === 'gameOver')
      drawCenterScreen(g, 'GAME OVER', '#ff8a80', [
        [endless ? `GAPS ${gapsPassed}   BEST ${endlessHi}` : `REACHED COURSE ${courseIdx + 1}`],
        [`SCORE ${score}   HI ${hiScore}`, '#ffb74d'],
        [newRecord ? 'NEW RECORD!' : '', '#80deea'],
        [stateT > 50 && blink ? (endless ? 'START: TITLE' : 'J: RETRY  START: TITLE') : '', '#f8bbd0'],
      ]);
    else if (state === 'victory') {
      drawBird(g, W / 2, 40 + Math.sin(stateT * 0.05) * 3, 0, 2, wingFrame(stateT));
      drawCenterScreen(g, 'KRAKEN OUTRUN!', '#ff9e40', [
        ['ALL 20 COURSES CLEARED'],
        [`FINAL SCORE ${score}`, '#ffb74d'],
        [newRecord ? 'NEW HIGH SCORE!' : `HI ${hiScore}`, '#80deea'],
        ['ENDLESS MODE UNLOCKED', '#f8bbd0'],
        [stateT > 50 && blink ? 'PRESS START' : '', '#f8bbd0'],
      ], 68);
    }
  }

  return { update, draw };
}
