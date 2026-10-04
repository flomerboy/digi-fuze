// PADDLE: TOURNAMENT
// You (left paddle) face 20 CPU rivals in a row. Each rival has a personality:
// reaction speed, aim error, paddle size, aggression, and a special trick
// (curve shots, two balls, moving walls, gravity wells, invisible ball, mirrored controls...).
// First to N points wins the match. Lose a match and the tournament is over.
//
// Controls: UP/DOWN move. A serves, and pressing A just before the ball reaches you swings
// for a SMASH (power shot). Moving the paddle while hitting puts SPIN (curve) on the ball.
// START pauses. On the title screen LEFT/RIGHT pick any unlocked match.

export default function boot(api) {
  const { W, H } = api;

  // ===========================================================================
  // CONSTANTS / TUNING
  // ===========================================================================
  const TOP = 26;              // arena top wall (HUD sits above)
  const BOT = H - 4;           // arena bottom wall
  const CY = (TOP + BOT) / 2;  // arena vertical center
  const PW = 5;                // paddle width
  const PLAYER_X = 10;         // left edge of player paddle
  const CPU_X = W - 10 - PW;   // left edge of CPU paddle
  const BALL_R = 3;            // ball half-size
  const PLAYER_SIZE = 38;
  const PLAYER_SPEED = 3.6;
  const PLAYER_ACCEL = 0.35;   // how fast paddle velocity approaches target (0..1)
  const SPIN_K = 0.008;        // spin added per px/frame of paddle velocity
  const SPIN_DECAY = 0.985;
  const MAX_BOUNCE = 1.0;      // max bounce angle in radians (edge of paddle)
  const SWING_FRAMES = 10;     // smash window after pressing A
  const SMASH_COOLDOWN = 32;
  const SMASH_MULT = 1.55;
  const SPEED_CAP = 10;        // absolute ball speed cap (px/frame)
  const MIN_VX = 1.3;          // ball never stalls horizontally
  const MIN_PADDLE = 14;       // shrink limit
  const POINT_FRAMES = 80;     // pause after a point
  const AUTO_SERVE = 360;      // player auto-serves after 6 s
  const SPLIT_SEG = 24;        // boss split-paddle segment height

  const C = {
    bg: '#070a10',
    arena: '#0c111b',
    line: '#1e2838',
    wall: '#37474f',
    text: '#eceff1',
    dim: '#78909c',
    player: '#4dd0e1',
    ball: '#ffffff',
    hot: '#ffab40',
    gold: '#ffd54f',
    good: '#69f0ae',
    bad: '#ff5252',
  };

  // ===========================================================================
  // LEVEL DATA: one entry per rival. Unlisted fields fall back to BASE.
  //   cpuSpeed  max paddle speed (px/frame)     react  frames between AI re-thinks
  //   err       random aim error (px)            size   CPU paddle height
  //   miss      chance the CPU whiffs a return (grows with rally length, doubled-ish by smashes)
  //   aim       0..1 how hard it angles shots     smash  chance (0..1) of a CPU power shot
  //   ballSpeed serve speed   accel  speed gained per hit in a rally   maxSpeed  rally speed cap
  //   curve     CPU spin strength (0 = none)     twoBalls  a second ball every serve
  //   obstacles moving walls in the middle      shrink  paddles shrink on every hit
  //   well      gravity well strength (negative = repels)   invisible  ball hidden in middle third
  //   mirror    player's UP/DOWN swapped         wind   vertical wind strength
  //   split     boss paddle split in two with a pulsing gap
  //   face      [eyes, mouth, hair color] for the portrait
  // ===========================================================================
  const BASE = {
    to: 5, miss: 0.15, cpuSpeed: 2, react: 8, err: 14, size: 36, aim: 0.3, smash: 0,
    ballSpeed: 3, accel: 0.08, maxSpeed: 7, curve: 0, twoBalls: false, obstacles: [],
    shrink: false, well: 0, invisible: false, mirror: false, wind: 0, split: false,
  };

  const LEVELS = [
    { name: 'ROOKIE RAY', miss: 0.25, quote: 'I JUST LEARNED THE RULES!', trick: 'A FRIENDLY WARM-UP.', color: '#8bc34a',
      face: ['dot', 'smile', '#6d4c41'], cpuSpeed: 1.5, react: 16, err: 26, size: 40, aim: 0, ballSpeed: 2.6, accel: 0.05 },
    { name: 'STEADY SUE', miss: 0.2, quote: 'SLOW AND STEADY WINS.', trick: 'SOLID BASICS. FEW MISTAKES.', color: '#ffca28',
      face: ['dot', 'flat', '#ff8f00'], cpuSpeed: 2.0, react: 12, err: 18, size: 38, aim: 0.2, ballSpeed: 2.8 },
    { name: 'CURVY CURT', miss: 0.18, quote: 'WATCH THE SPIN, KID.', trick: 'CURVE SHOTS! MOVE AS YOU HIT TO CURVE BACK.', color: '#ab47bc',
      face: ['angry', 'grin', '#4a148c'], curve: 1, cpuSpeed: 2.2, react: 11, err: 16, ballSpeed: 2.9 },
    { name: 'TURBO TINA', miss: 0.16, quote: 'EVERY HIT GETS FASTER!', trick: 'THE BALL SPEEDS UP EACH RALLY HIT.', color: '#ff7043',
      face: ['shades', 'grin', '#d84315'], accel: 0.22, maxSpeed: 8.5, cpuSpeed: 2.6, react: 9, err: 15, ballSpeed: 2.8 },
    { name: 'TWIN TOM', miss: 0.14, quote: 'TWO BALLS. TWICE THE FUN.', trick: 'TWO BALLS IN PLAY EVERY SERVE.', color: '#d4e157',
      face: ['dot', 'o', '#827717'], twoBalls: true, cpuSpeed: 2.6, react: 9, err: 14, ballSpeed: 2.6 },
    { name: 'BLOCKER BO', miss: 0.15, quote: 'MY WALL. MY RULES.', trick: 'A MOVING WALL GUARDS THE NET.', color: '#8d6e63',
      face: ['angry', 'flat', '#3e2723'], obstacles: [{ x: W / 2, h: 40, amp: 62, spd: 0.025, ph: 0 }],
      cpuSpeed: 2.7, react: 9, err: 13, ballSpeed: 3 },
    { name: 'SHRINKING SHAWN', miss: 0.14, quote: 'WE BOTH GET SMALLER...', trick: 'PADDLES SHRINK WITH EVERY HIT.', color: '#90a4ae',
      face: ['dot', 'o', '#546e7a'], shrink: true, cpuSpeed: 2.9, react: 8, err: 12, size: 40, ballSpeed: 3 },
    { name: 'GRAVITY GRETA', miss: 0.13, quote: 'FEEL THE PULL.', trick: 'A GRAVITY WELL BENDS THE BALL.', color: '#7e57c2',
      face: ['shades', 'smile', '#311b92'], well: 70, cpuSpeed: 2.9, react: 8, err: 12, ballSpeed: 3 },
    { name: 'PHANTOM PIA', miss: 0.13, quote: 'NOW YOU SEE IT...', trick: 'THE BALL VANISHES IN THE MIDDLE.', color: '#b0bec5',
      face: ['x', 'smile', '#eceff1'], invisible: true, cpuSpeed: 3.0, react: 8, err: 12, ballSpeed: 3 },
    { name: 'MIRROR MAX', miss: 0.16, quote: 'UP IS DOWN. DOWN IS UP.', trick: 'YOUR CONTROLS ARE MIRRORED!', color: '#ec407a',
      face: ['dot', 'grin', '#880e4f'], mirror: true, cpuSpeed: 2.6, react: 10, err: 14, ballSpeed: 2.8 },
    { name: 'SMASH SALLY', miss: 0.1, quote: 'I HIT HARD. REALLY HARD.', trick: 'AGGRESSIVE: FREQUENT POWER SMASHES.', color: '#f44336',
      face: ['angry', 'grin', '#b71c1c'], smash: 0.35, aim: 0.8, to: 7, cpuSpeed: 3.1, react: 7, err: 11, ballSpeed: 3.1 },
    { name: 'GALE GIL', miss: 0.1, quote: 'THE WIND IS MY FRIEND.', trick: 'SHIFTING WIND PUSHES THE BALL.', color: '#64b5f6',
      face: ['dot', 'o', '#0d47a1'], wind: 1, to: 7, cpuSpeed: 3.1, react: 7, err: 11, ballSpeed: 3.1 },
    { name: 'TINY TIM', miss: 0.08, quote: 'SMALL PADDLE. FAST HANDS.', trick: 'TINY PADDLE, LIGHTNING REFLEXES.', color: '#ffee58',
      face: ['dot', 'smile', '#f9a825'], size: 18, cpuSpeed: 4.2, react: 3, err: 7, aim: 0.6, to: 7, ballSpeed: 3.2 },
    { name: 'WALL WANDA', miss: 0.09, quote: 'TWO WALLS ARE BETTER.', trick: 'TWIN WALLS SWING IN THE MIDDLE.', color: '#a1887f',
      face: ['angry', 'flat', '#5d4037'], to: 7, cpuSpeed: 3.2, react: 7, err: 10, ballSpeed: 3.2,
      obstacles: [{ x: W / 2 - 40, h: 34, amp: 64, spd: 0.03, ph: 0 }, { x: W / 2 + 40, h: 34, amp: 64, spd: 0.03, ph: Math.PI }] },
    { name: 'DOUBLE DORA', miss: 0.08, quote: 'TWO BALLS, ALL CURVES.', trick: 'TWO BALLS, BOTH WITH CURVE.', color: '#b388ff',
      face: ['shades', 'smile', '#4527a0'], twoBalls: true, curve: 1.2, to: 7, cpuSpeed: 3.2, react: 7, err: 10, ballSpeed: 2.8 },
    { name: 'VOID VERA', miss: 0.07, quote: 'THE VOID HUNGERS.', trick: 'A HUNGRY WELL. FAST RALLIES.', color: '#651fff',
      face: ['x', 'flat', '#1a0033'], well: 110, accel: 0.14, maxSpeed: 8, to: 7, cpuSpeed: 3.4, react: 6, err: 9, ballSpeed: 3.2 },
    { name: 'GHOST GUS', miss: 0.07, quote: 'BOO. YOU MISSED.', trick: 'INVISIBLE MIDDLE + CURVE SHOTS.', color: '#cfd8dc',
      face: ['x', 'o', '#90a4ae'], invisible: true, curve: 1.3, to: 7, cpuSpeed: 3.5, react: 6, err: 9, ballSpeed: 3.2 },
    { name: 'REPULSA RITA', miss: 0.06, quote: 'STAY AWAY FROM ME!', trick: 'A REPULSOR FIELD AND GUSTY WIND.', color: '#ff4081',
      face: ['angry', 'smile', '#ad1457'], well: -90, wind: 0.7, smash: 0.2, to: 7, cpuSpeed: 3.6, react: 5, err: 8, ballSpeed: 3.3 },
    { name: 'CHAOS CARL', miss: 0.06, quote: 'RULES ARE FOR LOSERS.', trick: 'MIRRORED, A WALL, AND SHRINKING.', color: '#ffab00',
      face: ['shades', 'grin', '#e65100'], mirror: true, shrink: true, to: 7, cpuSpeed: 3.4, react: 6, err: 9, ballSpeed: 3.1,
      obstacles: [{ x: W / 2, h: 30, amp: 70, spd: 0.035, ph: 1 }] },
    { name: 'THE HYDRA', miss: 0.05, quote: 'TWO HEADS. ONE DESTINY.', trick: 'BOSS: SPLIT PADDLE. AIM FOR THE GAP!', color: '#00e676',
      face: ['angry', 'grin', '#1b5e20'], split: true, curve: 1.2, smash: 0.25, aim: 0.8, accel: 0.12, maxSpeed: 8.5,
      to: 9, cpuSpeed: 3.8, react: 5, err: 6, ballSpeed: 3.3 },
  ].map((l) => ({ ...BASE, ...l }));

  function clampLevel(i) { return Math.max(0, Math.min(LEVELS.length - 1, i | 0)); }

  // ===========================================================================
  // STATE
  // ===========================================================================
  let state = 'title';      // title | intro | playing | paused | levelClear | gameOver | victory
  let stateTime = 0;        // frames spent in the current state
  let levelIdx = 0;
  let L = LEVELS[0];        // current level data
  let score = 0;
  let hiScore = api.storage.get('hi', 0);
  let furthest = clampLevel(api.storage.get('furthest', 0)); // highest unlocked level index
  let titleSel = Math.min(furthest, LEVELS.length - 1);
  let newHi = false;

  // match state
  let pScore = 0, cScore = 0;
  let phase = 'serve';      // serve | rally | point
  let phaseTime = 0;
  let server = 'p';
  let rally = 0, bestRally = 0;
  let lastPointBy = 'p';
  let matchBonus = 0;
  let playTime = 0;         // drives obstacle / well / wind animation

  const player = makePaddle(PLAYER_X, PLAYER_SIZE);
  const cpu = makePaddle(CPU_X, 36);
  let balls = [];
  let obstacles = [];

  // effects
  let particles = [];
  let popups = [];
  let shake = 0;
  let flash = 0, flashColor = '#fff';
  const windStreaks = Array.from({ length: 22 }, () => ({ x: Math.random() * W, y: TOP + Math.random() * (BOT - TOP), len: 4 + Math.random() * 8 }));
  const confetti = [];

  // title-screen attract mode
  const demo = { bx: W / 2, by: CY, vx: 2.4, vy: 1.5, ly: CY, ry: CY };

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function setState(s) { state = s; stateTime = 0; }

  function makePaddle(x, h) {
    return { x, y: CY, h, vy: 0, swing: 0, cd: 0, target: CY, think: 0, errOff: 0, aimOff: 0 };
  }

  // Saves the high score, and unlocks `reached` (a level index) for the title level select.
  function saveProgress(reached = levelIdx) {
    if (score > hiScore) { hiScore = score; newHi = true; api.storage.set('hi', hiScore); }
    reached = Math.min(reached, LEVELS.length - 1);
    if (reached > furthest) { furthest = reached; api.storage.set('furthest', furthest); }
  }

  // Size of the boss split-paddle gap; pulses open and closed.
  function splitGap() { return 14 + (Math.sin(playTime * 0.022) + 1) * 12; }

  // Collision segments of a paddle (one normally, two for the split boss).
  function segments(p) {
    if (p === cpu && L.split) {
      const off = splitGap() / 2 + SPLIT_SEG / 2;
      return [{ cy: p.y - off, h: SPLIT_SEG }, { cy: p.y + off, h: SPLIT_SEG }];
    }
    return [{ cy: p.y, h: p.h }];
  }

  // Half of the paddle's total vertical extent (for clamping to the arena).
  function halfExtent(p) {
    return p === cpu && L.split ? splitGap() / 2 + SPLIT_SEG : p.h / 2;
  }

  // Where a ball will cross x = targetX, following straight lines and wall bounces only
  // (it ignores spin, gravity and wind, which is part of why the CPU makes mistakes).
  function predictY(b, targetX) {
    if (Math.abs(b.vx) < 0.01) return b.y;
    const t = (targetX - b.x) / b.vx;
    if (t < 0) return b.y;
    const lo = TOP + BALL_R, span = BOT - TOP - 2 * BALL_R;
    let m = (b.y + b.vy * t - lo) % (2 * span);
    if (m < 0) m += 2 * span;
    if (m > span) m = 2 * span - m;
    return lo + m;
  }

  // ===========================================================================
  // MATCH SETUP
  // ===========================================================================
  function startRun(idx) {
    score = 0;
    newHi = false;
    loadLevel(idx);
  }

  function loadLevel(idx) {
    levelIdx = idx;
    L = LEVELS[idx];
    pScore = 0; cScore = 0;
    bestRally = 0;
    server = 'p';
    playTime = 0;
    obstacles = L.obstacles.map((o) => ({ ...o, y: CY, w: 6 }));
    player.y = CY; player.vy = 0; player.h = PLAYER_SIZE; player.swing = 0; player.cd = 0;
    cpu.y = CY; cpu.vy = 0; cpu.h = L.size; cpu.swing = 0;
    particles = []; popups = [];
    setupServe();
    setState('intro');
    sfxIntro();
  }

  function setupServe() {
    phase = 'serve';
    phaseTime = 0;
    rally = 0;
    player.h = PLAYER_SIZE;
    cpu.h = L.size;
    cpu.target = CY + rand(-40, 40);
    balls = [makeBall()];
  }

  function makeBall() {
    return { x: W / 2, y: CY, vx: 0, vy: 0, spin: 0, hot: false, trail: [] };
  }

  function launchServe(angle, spin) {
    const b = balls[0];
    const dir = server === 'p' ? 1 : -1;
    b.vx = Math.cos(angle) * L.ballSpeed * dir;
    b.vy = Math.sin(angle) * L.ballSpeed;
    b.spin = spin;
    if (L.twoBalls) {
      // the second ball starts at the net and heads for the server, so both sides defend at once
      const b2 = makeBall();
      b2.y = rand(TOP + 40, BOT - 40);
      b2.vx = -dir * L.ballSpeed * 0.85;
      b2.vy = rand(-1, 1);
      balls.push(b2);
    }
    phase = 'rally';
    phaseTime = 0;
    rollCpuError();
    api.sound.tone(520, 0.06, { type: 'square', vol: 0.12 });
    api.sound.tone(780, 0.06, { type: 'square', vol: 0.1, delay: 0.05 });
  }

  // Re-rolls where the CPU will be "wrong" for the next return. Sometimes it whiffs on purpose:
  // more often in long rallies and against smashes, so pressure and power shots pay off.
  function rollCpuError(smashed = false) {
    const chance = L.miss + rally * 0.005 + (smashed ? 0.2 : 0);
    if (Math.random() < chance) cpu.errOff = (Math.random() < 0.5 ? -1 : 1) * (cpu.h / 2 + BALL_R + rand(3, 12));
    else cpu.errOff = rand(-L.err, L.err);
    cpu.aimOff = rand(-1, 1) * L.aim * cpu.h * 0.4;
  }

  // ===========================================================================
  // UPDATE: PLAYER
  // ===========================================================================
  function updatePlayer(input) {
    let dir = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (L.mirror) dir = -dir;
    player.vy += (dir * PLAYER_SPEED - player.vy) * PLAYER_ACCEL;
    const ext = halfExtent(player);
    player.y = clamp(player.y + player.vy, TOP + ext, BOT - ext);
    if (player.y === TOP + ext || player.y === BOT - ext) player.vy *= 0.5;
    if (player.swing > 0) player.swing--;
    if (player.cd > 0) player.cd--;

    if (phase === 'rally' && input.pressed.a && player.cd === 0) {
      player.swing = SWING_FRAMES;
      player.cd = SMASH_COOLDOWN;
      api.sound.noise(0.06, { vol: 0.05, filter: 3500 });
    }
  }

  // ===========================================================================
  // UPDATE: CPU AI
  // ===========================================================================
  function updateCpu() {
    if (cpu.swing > 0) cpu.swing--;
    if (--cpu.think <= 0) {
      cpu.think = L.react;
      // pick the most urgent ball heading our way
      let threat = null, best = Infinity;
      for (const b of balls) {
        if (b.vx <= 0) continue;
        const t = (CPU_X - b.x) / b.vx;
        if (t >= 0 && t < best) { best = t; threat = b; }
      }
      if (phase === 'rally' && threat) {
        let y = predictY(threat, CPU_X - BALL_R) + cpu.errOff - cpu.aimOff;
        if (L.split) {
          // line up a solid segment with the ball, not the gap
          const off = splitGap() / 2 + SPLIT_SEG / 2;
          y += y < CY ? off : -off;
        }
        cpu.target = y;
      } else if (phase === 'rally') {
        // drift toward the middle, leaning toward the ball
        const b = balls[0];
        cpu.target = CY + ((b ? b.y : CY) - CY) * 0.35;
      }
    }
    const dy = cpu.target - cpu.y;
    cpu.vy = clamp(dy * 0.3, -L.cpuSpeed, L.cpuSpeed);
    const ext = halfExtent(cpu);
    cpu.y = clamp(cpu.y + cpu.vy, TOP + ext, BOT - ext);
  }

  // ===========================================================================
  // UPDATE: BALLS + COLLISIONS
  // ===========================================================================
  function updateObstacles() {
    for (const o of obstacles) o.y = CY + Math.sin(playTime * o.spd + o.ph) * o.amp;
  }

  function windForce() {
    return L.wind ? Math.sin(playTime * 0.012) * 0.03 * L.wind : 0;
  }

  function updateBall(b) {
    // field forces
    b.vy += b.spin;
    b.spin *= SPIN_DECAY;
    b.vy += windForce();
    if (L.well) {
      const dx = W / 2 - b.x, dy = CY - b.y;
      const d2 = Math.max(dx * dx + dy * dy, 400);
      const d = Math.sqrt(d2);
      const acc = L.well / d2;
      b.vx += (dx / d) * acc;
      b.vy += (dy / d) * acc;
    }
    // keep it moving sideways, and under the speed cap
    if (Math.abs(b.vx) < MIN_VX) b.vx = (b.vx < 0 ? -1 : 1) * MIN_VX;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > SPEED_CAP) { b.vx *= SPEED_CAP / sp; b.vy *= SPEED_CAP / sp; }
    if (Math.abs(b.vy) > Math.abs(b.vx) * 2.2) b.vy = Math.sign(b.vy) * Math.abs(b.vx) * 2.2;

    // substeps so fast balls never tunnel through a paddle
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / 2));
    for (let i = 0; i < n; i++) {
      b.x += b.vx / n;
      b.y += b.vy / n;
      if (b.y - BALL_R < TOP) { b.y = TOP + BALL_R; b.vy = Math.abs(b.vy); b.spin *= -0.6; sfxWall(); }
      if (b.y + BALL_R > BOT) { b.y = BOT - BALL_R; b.vy = -Math.abs(b.vy); b.spin *= -0.6; sfxWall(); }
      for (const o of obstacles) collideObstacle(b, o);
      if (collidePaddle(b, player, 'p') || collidePaddle(b, cpu, 'c')) break;
    }

    b.trail.push(b.x, b.y);
    if (b.trail.length > 16) b.trail.splice(0, 2);
  }

  function collideObstacle(b, o) {
    const hw = o.w / 2 + BALL_R, hh = o.h / 2 + BALL_R;
    const dx = b.x - o.x, dy = b.y - o.y;
    if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) return;
    // push out along the axis of least overlap
    if (hw - Math.abs(dx) < hh - Math.abs(dy)) {
      b.x = o.x + Math.sign(dx || 1) * hw;
      b.vx = Math.sign(dx || 1) * Math.abs(b.vx);
    } else {
      b.y = o.y + Math.sign(dy || 1) * hh;
      b.vy = Math.sign(dy || 1) * Math.abs(b.vy);
    }
    sparks(b.x, b.y, L.color, 5, 1.5);
    api.sound.tone(160, 0.05, { type: 'square', vol: 0.1 });
  }

  // Returns true if the ball hit the paddle this substep.
  function collidePaddle(b, p, side) {
    const poke = p.swing > 0 ? 4 : 0; // a swinging paddle juts forward
    if (side === 'p') {
      const front = p.x + PW + poke;
      if (b.vx >= 0 || b.x - BALL_R > front || b.x < p.x - 2) return false;
      for (const s of segments(p)) if (Math.abs(b.y - s.cy) <= s.h / 2 + BALL_R) { hitBall(b, p, s, 'p', front + BALL_R); return true; }
    } else {
      const front = p.x - poke;
      if (b.vx <= 0 || b.x + BALL_R < front || b.x > p.x + PW + 2) return false;
      for (const s of segments(p)) if (Math.abs(b.y - s.cy) <= s.h / 2 + BALL_R) { hitBall(b, p, s, 'c', front - BALL_R); return true; }
    }
    return false;
  }

  function hitBall(b, p, seg, side, newX) {
    const off = clamp((b.y - seg.cy) / (seg.h / 2), -1, 1);
    const ang = off * MAX_BOUNCE;
    rally++;
    bestRally = Math.max(bestRally, rally);

    let smash = false;
    if (side === 'p') smash = p.swing > 0;
    else if (Math.random() < L.smash) { smash = true; p.swing = 6; }

    let sp = Math.min(L.maxSpeed, L.ballSpeed + rally * L.accel);
    if (smash) sp = Math.min(sp * SMASH_MULT, SPEED_CAP);
    const dir = side === 'p' ? 1 : -1;
    b.vx = dir * Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    b.x = newX;
    b.hot = smash;

    if (side === 'p') {
      b.spin = p.vy * SPIN_K;
      score += 10 + rally * 2 + (smash ? 50 : 0);
      rollCpuError(smash);
    } else {
      // curve rivals put spin on the ball, bending it away from the player's paddle
      b.spin = L.curve ? Math.sign(player.y - b.y || 1) * -rand(0.012, 0.03) * L.curve : 0;
    }
    if (L.shrink) p.h = Math.max(MIN_PADDLE, p.h - 4);

    // juice
    const color = side === 'p' ? C.player : L.color;
    sparks(b.x, b.y, smash ? C.hot : color, smash ? 18 : 8, smash ? 3.5 : 2);
    if (smash) {
      shake = Math.max(shake, 7);
      flash = 0.35; flashColor = C.hot;
      popup(side === 'p' ? 'SMASH! +50' : 'SMASH!', b.x + dir * 20, b.y - 10, C.hot);
      sfxSmash();
    } else {
      sfxHit(side, rally);
    }
    if (rally % 10 === 0) {
      popup('RALLY ' + rally + '!', W / 2, TOP + 24, C.gold);
      sfxOoh();
    }
  }

  // ===========================================================================
  // UPDATE: POINTS + MATCH FLOW
  // ===========================================================================
  function scorePoint(who, x, y) {
    phase = 'point';
    phaseTime = 0;
    lastPointBy = who;
    sparks(clamp(x, 4, W - 4), y, who === 'p' ? C.player : L.color, 30, 4);
    shake = Math.max(shake, 6);
    balls = [];
    if (who === 'p') {
      pScore++;
      const pts = 100 + rally * 10;
      score += pts;
      popup('+' + pts, W - 60, y, C.good);
      flash = 0.25; flashColor = C.player;
      sfxCheer();
    } else {
      cScore++;
      flash = 0.25; flashColor = C.bad;
      sfxGroan();
    }
    server = who === 'p' ? 'c' : 'p'; // the side that lost the point serves
  }

  function afterPoint() {
    if (pScore >= L.to) {
      matchBonus = 500 + levelIdx * 100 + (L.to - cScore) * 100;
      score += matchBonus;
      const last = levelIdx === LEVELS.length - 1;
      saveProgress(levelIdx + 1);
      if (last) { setState('victory'); sfxVictory(); }
      else { setState('levelClear'); sfxClear(); }
    } else if (cScore >= L.to) {
      saveProgress();
      setState('gameOver');
      sfxGameOver();
    } else {
      setupServe();
    }
  }

  function updatePlaying(input) {
    if (input.pressed.start) { setState('paused'); api.sound.tone(440, 0.08, { type: 'triangle', vol: 0.12 }); return; }
    playTime++;
    phaseTime++;
    updatePlayer(input);
    updateObstacles();

    if (phase === 'serve') {
      const b = balls[0];
      if (server === 'p') {
        b.x = PLAYER_X + PW + BALL_R + 1; b.y = player.y;
        if ((input.pressed.a && phaseTime > 10) || phaseTime > AUTO_SERVE) {
          launchServe(clamp(player.vy * 0.12, -0.6, 0.6) + rand(-0.1, 0.1), player.vy * SPIN_K);
        }
      } else {
        b.x = CPU_X - BALL_R - 1; b.y = cpu.y;
        if (L.split) b.y = cpu.y - splitGap() / 2 - SPLIT_SEG / 2;
        if (phaseTime > 55) launchServe(rand(-0.5, 0.5), L.curve ? rand(-0.02, 0.02) : 0);
      }
    } else if (phase === 'rally') {
      for (const b of balls) updateBall(b);
      for (const b of balls) {
        if (b.x < -8) { scorePoint('c', b.x, b.y); break; }
        if (b.x > W + 8) { scorePoint('p', b.x, b.y); break; }
      }
    } else if (phase === 'point' && phaseTime > POINT_FRAMES) {
      afterPoint();
      return;
    }
    updateCpu();
  }

  // ===========================================================================
  // UPDATE: EFFECTS
  // ===========================================================================
  function sparks(x, y, color, n, spd) {
    for (let i = 0; i < n && particles.length < 300; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * spd;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(15, 35), color });
    }
  }

  function popup(text, x, y, color) {
    popups.push({ text, x: clamp(x, 40, W - 40), y: clamp(y, TOP + 10, BOT - 10), life: 50, color });
  }

  function updateEffects() {
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) { p.y -= 0.4; p.life--; }
    popups = popups.filter((p) => p.life > 0);
    shake *= 0.85; if (shake < 0.3) shake = 0;
    flash = Math.max(0, flash - 0.03);
    if (L.wind) {
      const w = windForce() * 120;
      for (const s of windStreaks) {
        s.y += w; s.x += 0.2;
        if (s.y < TOP) s.y = BOT; if (s.y > BOT) s.y = TOP;
        if (s.x > W) s.x = 0;
      }
    }
  }

  function updateDemo() {
    const d = demo;
    d.bx += d.vx; d.by += d.vy;
    if (d.by < TOP + 4 || d.by > BOT - 4) d.vy = -d.vy;
    if (d.bx < 22) { d.vx = Math.abs(d.vx); d.vy = rand(-2, 2); }
    if (d.bx > W - 22) { d.vx = -Math.abs(d.vx); d.vy = rand(-2, 2); }
    d.ly += clamp(d.by - d.ly, -2.2, 2.2);
    d.ry += clamp(d.by - d.ry, -2.2, 2.2);
  }

  // ===========================================================================
  // UPDATE: STATE MACHINE
  // ===========================================================================
  function update(input) {
    stateTime++;
    const p = input.pressed;
    switch (state) {
      case 'title':
        updateDemo();
        if (p.left || p.right) {
          const n = furthest + 1;
          titleSel = (titleSel + (p.right ? 1 : -1) + n) % n;
          api.sound.tone(660, 0.04, { type: 'square', vol: 0.08 });
        }
        if ((p.start || p.a) && stateTime > 15) startRun(titleSel);
        break;
      case 'intro':
        updateEffects();
        if (((p.start || p.a) && stateTime > 30) || stateTime > 300) setState('playing');
        break;
      case 'playing':
        updatePlaying(input);
        updateEffects();
        break;
      case 'paused':
        if (p.start) { setState('playing'); api.sound.tone(660, 0.08, { type: 'triangle', vol: 0.12 }); }
        else if (p.select) { saveProgress(); titleSel = Math.min(furthest, levelIdx); setState('title'); }
        break;
      case 'levelClear':
        updateEffects();
        if ((p.start || p.a) && stateTime > 60) loadLevel(levelIdx + 1);
        break;
      case 'gameOver':
        updateEffects();
        if ((p.start || p.a) && stateTime > 60) { titleSel = Math.min(furthest, levelIdx); setState('title'); }
        break;
      case 'victory':
        updateConfetti();
        if ((p.start || p.a) && stateTime > 90) { titleSel = furthest; setState('title'); }
        break;
    }
  }

  function updateConfetti() {
    if (confetti.length < 120 && api.frame % 2 === 0) {
      confetti.push({ x: rand(0, W), y: -4, vy: rand(0.6, 1.6), vx: rand(-0.4, 0.4), c: LEVELS[(Math.random() * LEVELS.length) | 0].color });
    }
    for (const c of confetti) { c.x += c.vx + Math.sin((api.frame + c.y) * 0.05) * 0.3; c.y += c.vy; if (c.y > H) c.y = -4; }
  }

  // ===========================================================================
  // AUDIO
  // ===========================================================================
  function sfxHit(side, n) {
    const f = (side === 'p' ? 440 : 330) + Math.min(n, 30) * 10;
    api.sound.tone(f, 0.05, { type: 'square', vol: 0.13 });
  }
  function sfxWall() { api.sound.tone(220, 0.03, { type: 'triangle', vol: 0.1 }); }
  function sfxSmash() {
    api.sound.noise(0.18, { vol: 0.2, filter: 4500 });
    api.sound.tone(900, 0.2, { type: 'sawtooth', vol: 0.1, slide: 200 });
  }
  // crowd-ish cheering: a filtered noise swell plus scattered claps
  function sfxCheer() {
    api.sound.noise(0.8, { vol: 0.09, filter: 1300 });
    api.sound.noise(0.5, { vol: 0.06, filter: 3000, delay: 0.12 });
    for (let i = 0; i < 7; i++) api.sound.noise(0.025, { vol: 0.09, filter: 6000, delay: 0.1 + i * 0.08 + Math.random() * 0.04 });
    api.sound.tone(523, 0.08, { type: 'square', vol: 0.09 });
    api.sound.tone(784, 0.12, { type: 'square', vol: 0.09, delay: 0.08 });
  }
  function sfxGroan() {
    api.sound.noise(0.7, { vol: 0.08, filter: 450 });
    api.sound.tone(240, 0.5, { type: 'sawtooth', vol: 0.05, slide: 130 });
  }
  function sfxOoh() {
    api.sound.tone(300, 0.45, { type: 'sine', vol: 0.07, slide: 460 });
    api.sound.noise(0.45, { vol: 0.05, filter: 900 });
  }
  function sfxIntro() {
    [392, 523, 659].forEach((f, i) => api.sound.tone(f, 0.09, { type: 'square', vol: 0.1, delay: i * 0.09 }));
  }
  function sfxClear() {
    [523, 659, 784, 1047].forEach((f, i) => api.sound.tone(f, 0.12, { type: 'square', vol: 0.12, delay: i * 0.1 }));
    api.sound.noise(1.0, { vol: 0.08, filter: 1500, delay: 0.1 });
  }
  function sfxGameOver() {
    [392, 330, 262, 196].forEach((f, i) => api.sound.tone(f, 0.2, { type: 'triangle', vol: 0.14, delay: i * 0.18 }));
  }
  function sfxVictory() {
    const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
    notes.forEach((f, i) => api.sound.tone(f, 0.12, { type: 'square', vol: 0.12, delay: i * 0.12 }));
    api.sound.noise(1.6, { vol: 0.1, filter: 1500, delay: 0.2 });
  }

  // ===========================================================================
  // DRAW: PRIMITIVES
  // ===========================================================================
  let g = null; // current context (set in draw)

  function rect(x, y, w, h, color) { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  function textBox(x, y, w, h, border) {
    rect(x, y, w, h, '#05080e');
    g.strokeStyle = border; g.lineWidth = 1;
    g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }

  // Word-wraps text into lines of at most maxChars, 9px apart.
  function wrapText(str, x, y, maxChars, color) {
    let line = '';
    for (const word of str.split(' ')) {
      if (line && (line + ' ' + word).length > maxChars) { api.text(line, x, y, { color }); y += 9; line = word; }
      else line = line ? line + ' ' + word : word;
    }
    if (line) api.text(line, x, y, { color });
  }

  // 8x8 pixel portrait of a rival. face = [eyes, mouth, hairColor]
  function drawFace(x, y, s, lvl) {
    const [eyes, mouth, hair] = lvl.face;
    const px = (cx, cy, color, w = 1, h = 1) => rect(x + cx * s, y + cy * s, w * s, h * s, color);
    px(1, 1, lvl.color, 6, 7);            // head
    px(0, 2, lvl.color, 8, 4);
    px(1, 0, hair, 6, 2);                 // hair
    px(0, 1, hair, 1, 2); px(7, 1, hair, 1, 2);
    const ink = '#101418';
    if (eyes === 'dot') { px(2, 3, ink); px(5, 3, ink); }
    else if (eyes === 'angry') { px(2, 3, ink); px(5, 3, ink); px(1, 2, ink); px(6, 2, ink); }
    else if (eyes === 'shades') { px(1, 3, ink, 6, 1); px(2, 4, ink); px(5, 4, ink); }
    else if (eyes === 'x') { px(2, 3, ink); px(5, 3, ink); px(2, 3, '#fff', 1, 1); px(5, 3, '#fff'); px(1, 4, ink); px(6, 4, ink); }
    if (mouth === 'smile') { px(2, 6, ink, 4, 1); px(1, 5, ink); px(6, 5, ink); }
    else if (mouth === 'flat') px(2, 6, ink, 4, 1);
    else if (mouth === 'grin') { px(2, 5, ink, 4, 2); px(3, 5, '#fff', 2, 1); }
    else if (mouth === 'o') px(3, 5, ink, 2, 2);
  }

  // Portrait centered on cx (the boss gets two heads).
  function drawPortrait(cx, y, s, lvl) {
    if (lvl.split) { drawFace(cx - 9 * s, y, s, lvl); drawFace(cx + s, y, s, lvl); }
    else drawFace(cx - 4 * s, y, s, lvl);
  }

  // ===========================================================================
  // DRAW: ARENA + ENTITIES
  // ===========================================================================
  function drawArena() {
    rect(0, TOP, W, BOT - TOP, L.mirror ? '#130b18' : C.arena);
    // invisible zone: a foggy band where the ball disappears
    if (L.invisible) {
      rect(W / 3, TOP, W / 3, BOT - TOP, '#15121f');
      for (let i = 0; i < 26; i++) {
        const fx = W / 3 + ((i * 37 + playTime * 0.3) % (W / 3));
        const fy = TOP + ((i * 53 + playTime * 0.15 * (i % 3 + 1)) % (BOT - TOP));
        rect(fx, fy, 2, 1, '#2a2440');
      }
    }
    // center net
    for (let y = TOP + 4; y < BOT; y += 12) rect(W / 2 - 1, y, 2, 6, C.line);
    // walls
    rect(0, TOP - 2, W, 2, C.wall);
    rect(0, BOT, W, 2, C.wall);
    rect(0, TOP - 2, W, 1, L.color);

    if (L.well) drawWell();
    if (L.wind) {
      g.globalAlpha = 0.35;
      const dir = Math.sign(windForce());
      for (const s of windStreaks) rect(s.x, s.y, 1, s.len * Math.abs(windForce()) * 40 + 1, dir < 0 ? '#81d4fa' : '#4fc3f7');
      g.globalAlpha = 1;
      const arrow = windForce() < 0 ? '^ WIND ^' : 'V WIND V';
      api.text(arrow, W / 2, BOT - 10, { color: '#37617a', align: 'center' });
    }
    if (L.mirror) api.text('MIRRORED', 22, BOT - 10, { color: '#5c3a66' });
    for (const o of obstacles) {
      rect(o.x - o.w / 2 - 1, o.y - o.h / 2 - 1, o.w + 2, o.h + 2, '#000');
      rect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h, L.color);
      rect(o.x - o.w / 2, o.y - o.h / 2, 2, o.h, '#ffffff55');
    }
  }

  function drawWell() {
    const sign = L.well > 0 ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const r = 10 + k * 11 + (sign > 0 ? -(playTime * 0.3) % 11 : (playTime * 0.3) % 11);
      const n = 10 + k * 2;
      g.globalAlpha = 0.6 - k * 0.12;
      for (let i = 0; i < n; i++) {
        const a = playTime * 0.02 * sign * (4 - k) * 0.5 + (i / n) * Math.PI * 2;
        rect(W / 2 + Math.cos(a) * r - 1, CY + Math.sin(a) * r - 1, 2, 2, L.color);
      }
    }
    g.globalAlpha = 1;
    rect(W / 2 - 2, CY - 2, 4, 4, sign > 0 ? '#000' : '#fff');
  }

  function drawPaddle(p, color) {
    const isP = p === player;
    const poke = p.swing > 0 ? (isP ? 4 : -4) : 0;
    const segs = segments(p);
    if (p === cpu && L.split && segs.length === 2) {
      // energy beam across the gap: decorative, the ball passes through it
      const top = segs[0].cy + segs[0].h / 2, bot = segs[1].cy - segs[1].h / 2;
      if ((playTime >> 2) % 2) rect(p.x + 2, top, 1, bot - top, '#00e67655');
    }
    for (const s of segs) {
      rect(p.x + poke - 1, s.cy - s.h / 2 - 1, PW + 2, s.h + 2, '#000');
      rect(p.x + poke, s.cy - s.h / 2, PW, s.h, p.swing > 0 ? '#ffffff' : color);
      rect(p.x + poke + (isP ? PW - 1 : 0), s.cy - s.h / 2, 1, s.h, '#ffffff88');
    }
    // smash-ready pip under the player paddle
    if (isP && phase === 'rally') rect(p.x, p.y + p.h / 2 + 3, PW, 2, p.cd === 0 ? C.hot : '#3a2a1a');
  }

  function ballVisible(b) {
    return !(L.invisible && b.x > W / 3 && b.x < (W * 2) / 3);
  }

  function drawBall(b) {
    const color = b.hot ? C.hot : C.ball;
    if (ballVisible(b)) {
      for (let i = 0; i < b.trail.length; i += 2) {
        const tx = b.trail[i], ty = b.trail[i + 1];
        if (L.invisible && tx > W / 3 && tx < (W * 2) / 3) continue;
        g.globalAlpha = (i / b.trail.length) * 0.4;
        rect(tx - 2, ty - 2, 4, 4, color);
      }
      g.globalAlpha = 1;
      rect(b.x - BALL_R, b.y - BALL_R, BALL_R * 2, BALL_R * 2, color);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      g.globalAlpha = Math.min(1, p.life / 20);
      rect(p.x, p.y, 2, 2, p.color);
    }
    g.globalAlpha = 1;
    for (const p of popups) {
      api.text(p.text, p.x, p.y, { color: p.color, align: 'center', shadow: '#000' });
    }
  }

  function drawHud() {
    rect(0, 0, W, TOP - 2, C.bg);
    api.text(String(pScore), 6, 5, { color: C.player, scale: 2 });
    api.text('YOU', 24, 3, { color: C.player });
    api.text(String(score).padStart(6, '0'), 24, 13, { color: C.text });
    api.text(String(cScore), W - 6, 5, { color: L.color, scale: 2, align: 'right' });
    api.text(L.name, W - 24, 3, { color: L.color, align: 'right' });
    api.text('FIRST TO ' + L.to, W - 24, 13, { color: C.dim, align: 'right' });
    api.text('MATCH ' + pad2(levelIdx + 1) + '/' + LEVELS.length, W / 2, 3, { color: C.dim, align: 'center' });
    if (rally >= 2) api.text('RALLY ' + rally, W / 2, 13, { color: rally >= 10 ? C.gold : C.text, align: 'center' });
  }

  function drawPlayfield() {
    drawArena();
    drawPaddle(player, C.player);
    drawPaddle(cpu, L.color);
    for (const b of balls) drawBall(b);
    drawParticles();
    // phase captions
    if (phase === 'serve' && server === 'p' && state === 'playing' && (api.frame >> 4) % 2 === 0) {
      api.text('PRESS J TO SERVE', W / 2, BOT - 26, { color: C.text, align: 'center', shadow: '#000' });
    }
    if (phase === 'point' && state === 'playing') {
      const mine = lastPointBy === 'p';
      const msg = mine ? 'POINT!' : L.name + ' SCORES';
      const sc = api.textWidth(msg, 2) <= W - 20 ? 2 : 1;
      api.text(msg, W / 2, CY - 20, { color: mine ? C.good : C.bad, scale: sc, align: 'center', shadow: '#000' });
      api.text(pScore + ' - ' + cScore, W / 2, CY + 2, { color: C.text, scale: 2, align: 'center', shadow: '#000' });
    }
    drawHud();
  }

  // ===========================================================================
  // DRAW: SCREENS
  // ===========================================================================
  function drawTitle() {
    rect(0, 0, W, H, C.bg);
    // attract-mode rally in the background
    g.globalAlpha = 0.35;
    for (let y = TOP + 4; y < BOT; y += 12) rect(W / 2 - 1, y, 2, 6, C.line);
    rect(14, demo.ly - 16, 4, 32, C.player);
    rect(W - 18, demo.ry - 16, 4, 32, '#ec407a');
    rect(demo.bx - 2, demo.by - 2, 4, 4, '#fff');
    g.globalAlpha = 1;

    const bob = Math.round(Math.sin(api.time * 2) * 2);
    api.text('PADDLE', W / 2 + 3, 22 + bob + 3, { color: '#263238', scale: 7, align: 'center' });
    api.text('PADDLE', W / 2, 22 + bob, { color: '#eceff1', scale: 7, align: 'center' });
    api.text('TOURNAMENT OF 20 RIVALS', W / 2, 80, { color: C.gold, align: 'center' });

    api.text('UP/DOWN: MOVE    J: SERVE / SMASH', W / 2, 98, { color: C.text, align: 'center' });
    api.text('PRESS J JUST BEFORE THE BALL HITS = SMASH', W / 2, 108, { color: C.dim, align: 'center' });
    api.text('MOVE WHILE HITTING TO CURVE THE BALL', W / 2, 118, { color: C.dim, align: 'center' });

    // level select
    const lvl = LEVELS[titleSel];
    textBox(40, 134, W - 80, 52, lvl.color);
    drawPortrait(68, lvl.split ? 148 : 144, lvl.split ? 3 : 4, lvl);
    api.text('MATCH ' + pad2(titleSel + 1), 100, 144, { color: C.dim });
    api.text(lvl.name, 100, 154, { color: lvl.color, scale: 1 });
    wrapText(lvl.trick, 100, 166, 28, C.text);
    if (furthest > 0) {
      api.text('<', 30, 156, { color: C.text });
      api.text('>', W - 35, 156, { color: C.text });
      api.text('LEFT/RIGHT: PICK UNLOCKED MATCH', W / 2, 190, { color: C.dim, align: 'center' });
    }

    if ((api.frame >> 5) % 2 === 0) api.text('PRESS START', W / 2, 206, { color: C.text, scale: 2, align: 'center', shadow: '#263238' });
    api.text('HI ' + String(hiScore).padStart(6, '0'), 8, H - 10, { color: C.gold });
    api.text('BEST: MATCH ' + pad2(furthest + 1), W - 8, H - 10, { color: C.dim, align: 'right' });
  }

  function drawIntro() {
    drawPlayfield();
    rect(0, 0, W, H, 'rgba(0,0,0,0.6)');
    const slide = Math.max(0, 30 - stateTime) * 8;
    const x = 30 + slide;
    textBox(x, 46, W - 60, 140, L.color);
    api.text('MATCH ' + (levelIdx + 1) + ' OF ' + LEVELS.length + (L.split ? ' - FINAL BOSS' : ''), x + (W - 60) / 2, 54, { color: C.dim, align: 'center' });
    drawPortrait(x + (W - 60) / 2, 68, 4, L);
    api.text(L.name, x + (W - 60) / 2, 106, { color: L.color, scale: 2, align: 'center', shadow: '#000' });
    api.text('"' + L.quote + '"', x + (W - 60) / 2, 126, { color: C.text, align: 'center' });
    api.text(L.trick, x + (W - 60) / 2, 142, { color: C.gold, align: 'center' });
    api.text('FIRST TO ' + L.to + ' POINTS', x + (W - 60) / 2, 156, { color: C.dim, align: 'center' });
    if (stateTime > 30 && (api.frame >> 4) % 2 === 0) api.text('PRESS J', x + (W - 60) / 2, 172, { color: C.text, align: 'center' });
  }

  function drawPaused() {
    drawPlayfield();
    rect(0, 0, W, H, 'rgba(0,0,0,0.6)');
    textBox(80, 80, 160, 80, C.text);
    api.text('PAUSED', W / 2, 92, { color: C.text, scale: 2, align: 'center' });
    api.text('VS ' + L.name, W / 2, 114, { color: L.color, align: 'center' });
    api.text('START: RESUME', W / 2, 130, { color: C.text, align: 'center' });
    api.text('SELECT: QUIT', W / 2, 142, { color: C.dim, align: 'center' });
  }

  function drawLevelClear() {
    drawPlayfield();
    rect(0, 0, W, H, 'rgba(0,0,0,0.55)');
    textBox(50, 56, W - 100, 128, C.good);
    api.text('MATCH WON!', W / 2, 66, { color: C.good, scale: 2, align: 'center', shadow: '#000' });
    api.text('YOU ' + pScore + ' - ' + cScore + ' ' + L.name, W / 2, 90, { color: C.text, align: 'center' });
    api.text('BEST RALLY  ' + bestRally, W / 2, 104, { color: C.dim, align: 'center' });
    api.text('MATCH BONUS +' + matchBonus, W / 2, 116, { color: C.gold, align: 'center' });
    api.text('SCORE ' + String(score).padStart(6, '0'), W / 2, 130, { color: C.text, align: 'center' });
    const next = LEVELS[levelIdx + 1];
    api.text('NEXT: ' + next.name, W / 2, 148, { color: next.color, align: 'center' });
    if (stateTime > 60 && (api.frame >> 4) % 2 === 0) api.text('PRESS J', W / 2, 166, { color: C.text, align: 'center' });
  }

  function drawGameOver() {
    drawPlayfield();
    rect(0, 0, W, H, 'rgba(20,0,0,0.65)');
    textBox(50, 50, W - 100, 140, C.bad);
    api.text('GAME OVER', W / 2, 60, { color: C.bad, scale: 2, align: 'center', shadow: '#000' });
    drawPortrait(W / 2, 80, 4, L);
    api.text('ELIMINATED BY ' + L.name, W / 2, 118, { color: L.color, align: 'center' });
    api.text('MATCH ' + (levelIdx + 1) + '   ' + pScore + ' - ' + cScore, W / 2, 130, { color: C.dim, align: 'center' });
    api.text('SCORE ' + String(score).padStart(6, '0'), W / 2, 146, { color: C.text, align: 'center' });
    api.text(newHi ? 'NEW HIGH SCORE!' : 'HI ' + String(hiScore).padStart(6, '0'), W / 2, 158, { color: C.gold, align: 'center' });
    if (stateTime > 60 && (api.frame >> 4) % 2 === 0) api.text('PRESS START', W / 2, 174, { color: C.text, align: 'center' });
  }

  function drawVictory() {
    rect(0, 0, W, H, C.bg);
    for (const c of confetti) rect(c.x, c.y, 3, 2, c.c);
    const bob = Math.round(Math.sin(api.time * 3) * 3);
    // trophy
    const tx = W / 2, ty = 40 + bob;
    rect(tx - 18, ty, 36, 6, C.gold);
    rect(tx - 14, ty + 6, 28, 18, C.gold);
    rect(tx - 24, ty + 4, 6, 12, C.gold); rect(tx + 18, ty + 4, 6, 12, C.gold);
    rect(tx - 10, ty + 24, 20, 4, C.gold);
    rect(tx - 4, ty + 28, 8, 8, C.gold);
    rect(tx - 14, ty + 36, 28, 6, '#a1887f');
    rect(tx - 10, ty + 8, 3, 12, '#fff59d');
    api.text('CHAMPION!', W / 2, 98, { color: C.gold, scale: 3, align: 'center', shadow: '#5d4037' });
    api.text('ALL 20 RIVALS DEFEATED', W / 2, 128, { color: C.text, align: 'center' });
    api.text('THE HYDRA FALLS ' + pScore + ' - ' + cScore, W / 2, 140, { color: L.color, align: 'center' });
    api.text('FINAL SCORE ' + String(score).padStart(6, '0'), W / 2, 158, { color: C.text, scale: 1, align: 'center' });
    api.text(newHi ? 'NEW HIGH SCORE!' : 'HI ' + String(hiScore).padStart(6, '0'), W / 2, 170, { color: C.gold, align: 'center' });
    if (stateTime > 90 && (api.frame >> 4) % 2 === 0) api.text('PRESS START', W / 2, 196, { color: C.text, scale: 2, align: 'center' });
  }

  function draw(ctx) {
    g = ctx;
    rect(0, 0, W, H, C.bg);
    g.save();
    if (shake > 0) g.translate(Math.round(rand(-shake, shake)), Math.round(rand(-shake, shake)));
    switch (state) {
      case 'title': drawTitle(); break;
      case 'intro': drawIntro(); break;
      case 'playing': drawPlayfield(); break;
      case 'paused': drawPaused(); break;
      case 'levelClear': drawLevelClear(); break;
      case 'gameOver': drawGameOver(); break;
      case 'victory': drawVictory(); break;
    }
    g.restore();
    if (flash > 0) {
      g.globalAlpha = flash;
      rect(0, 0, W, H, flashColor);
      g.globalAlpha = 1;
    }
  }

  return { update, draw };
}
