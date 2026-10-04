// ============================================================================
// ROCKS — a VG-Remix cartridge
//
// Vector-style inertia shooter. Rotate, thrust, shoot, and warp through
// 20 sectors: rock fields, armored rocks, seeker rocks, ring drones, crystal shards, mines,
// black holes, a scrolling rock belt and a ring-station boss every 5 sectors.
//
// Controls: LEFT/RIGHT rotate, UP thrust, A fire, B warp, START pause.
//
// File layout:
//   1. Constants & tuning      5. Collisions & damage
//   2. Sector data (LEVELS)    6. Game states (title/play/pause/clear/over/win)
//   3. Helpers & audio         7. Drawing
//   4. Entities (make/update)
// ============================================================================

export default function boot(api) {
  const W = api.W;
  const H = api.H;
  const DT = 1 / 60;
  const TAU = Math.PI * 2;

  // ==========================================================================
  // 1. CONSTANTS & TUNING
  // ==========================================================================
  const SHIP_TURN = 4.6;          // radians per second
  const SHIP_THRUST = 210;        // px/s^2
  const SHIP_DRAG = 0.55;         // fraction of speed lost per second
  const SHIP_MAX_SPEED = 240;     // px/s
  const SHIP_RADIUS = 5;
  const START_LIVES = 3;
  const MAX_LIVES = 6;
  const EXTRA_LIFE_EVERY = 10000;
  const RESPAWN_DELAY = 1.6;      // seconds after death before respawning
  const INVULN_TIME = 2.5;        // seconds of blinking invulnerability
  const WARP_TIME = 0.45;        // seconds spent "in warp"
  const WARP_COOLDOWN = 1.2;

  const BULLET_SPEED = 300;
  const BULLET_LIFE = 0.85;
  const GUNS = {
    normal: { cooldown: 11, max: 5 },
    rapid: { cooldown: 4, max: 14 },
  };
  const SPREAD_ANGLE = 0.22;
  const POWER_TIME = 12;          // spread / rapid duration (s)
  const SHIELD_TIME = 8;

  // Rock sizes: 3 = large, 2 = medium, 1 = small
  const ROCK = {
    3: { r: 20, speed: 28, score: 20, mass: 7 },
    2: { r: 11, speed: 46, score: 50, mass: 3 },
    1: { r: 5.5, speed: 70, score: 100, mass: 1 },
  };
  const ROCK_DROP_CHANCE = 0.035;

  const DRONE = {
    big: { r: 11, speed: 48, score: 200, fireEvery: 1.3, drop: 0.5 },
    small: { r: 6, speed: 72, score: 1000, fireEvery: 1.0, drop: 1.0 },
  };
  const ENEMY_BULLET_SPEED = 120;

  const MINE_RADIUS = 6;
  const MINE_TRIGGER = 54;        // ship distance that arms a mine
  const MINE_FUSE = 1.0;
  const MINE_BLAST = 40;
  const MINE_SCORE = 150;

  const HOLE_G = 300000;          // black-hole pull strength
  const HOLE_HORIZON = 9;         // radius that destroys whatever falls in

  const C = {
    bg: '#02030a',
    star1: '#2a3050', star2: '#4a5480', star3: '#8c96c8',
    ship: '#e8f4ff', flame: '#ffb347', flame2: '#ff5a36',
    bullet: '#ffffff',
    rock: '#c9d6ff', armor: '#9fb4c8', armorIn: '#56687c', homing: '#ff6b4a',
    mine: '#ff3d7f', drone: '#ff9f43', shard: '#9dfff0',
    ebullet: '#ff4fd8', boss: '#b18cff', bossCore: '#ff4fd8', turret: '#7de3ff',
    hole: '#9a5cff', shield: '#5cffb0',
    white: '#ffffff', dim: '#7880a8', accent: '#c5cae9', warn: '#ff5a5a', gold: '#ffd84a',
  };

  const POWERUPS = {
    spread: { color: '#4ff0ff', letter: 'S', name: 'SPREAD', weight: 3 },
    rapid: { color: '#ffd84a', letter: 'R', name: 'RAPID', weight: 3 },
    shield: { color: '#5cffb0', letter: 'H', name: 'SHIELD', weight: 2 },
    life: { color: '#ff7ae0', letter: '1', name: '1UP', weight: 1 },
  };

  // Ship outline in local space (nose points along +x): rounded pod with twin rear fins
  const SHIP_PTS = [8, 0, 7, -2.2, 4.5, -3.8, 1, -4.3, -2.5, -4, -4, -6.5, -7, -6.5, -5, -2.5,
    -5, 2.5, -7, 6.5, -4, 6.5, -2.5, 4, 1, 4.3, 4.5, 3.8, 7, 2.2];
  const SHIP_WINDOW = [3, 0];      // cockpit bubble (local space)
  // Ring station: a central hub joined by truss arms to two counter-spinning
  // spoked rings. Turret mount points are in local space.
  const BOSS_RINGS = [[-38, 0, 12, 1], [38, 0, 12, -1]];   // [x, y, radius, spin dir]
  const BOSS_HUB_R = 15;
  const BOSS_TURRETS = [[-38, 0], [38, 0], [0, 12], [-20, -9], [20, -9]];
  const BOSS_CORE_Y = -4;

  // ==========================================================================
  // 2. SECTOR DATA
  //   rocks:   number of large rocks at start      speed: rock speed multiplier
  //   armor:   chance a rock is armored            homing: chance a rock seeks you
  //   mines:   number of proximity mines           droneEvery/shardEvery: enemy interval (s)
  //   holes:   black holes {x, y, power, orbit?}   belt: scrolling stream sector
  //   boss:    ring-station tier (1-4)               spawn: ship start point [x, y]
  // ==========================================================================
  const LEVELS = [
    { name: 'FIRST CONTACT', hint: 'SHOOT EVERY ROCK TO CLEAR THE SECTOR', rocks: 3, speed: 1.0 },
    { name: 'LOOSE GRAVEL', hint: 'BIG ROCKS SPLIT. KEEP MOVING.', rocks: 5, speed: 1.15 },
    { name: 'IRON FIELD', hint: 'GREY ROCKS ARE ARMORED', rocks: 4, speed: 1.05, armor: 0.5 },
    { name: 'DRONE ALLEY', hint: 'DRONES DROP POWER-UPS', rocks: 4, speed: 1.15, droneEvery: 10 },
    { name: 'STATION', hint: 'KILL THE TURRETS TO OPEN THE CORE', boss: 1, rocks: 2 },
    { name: 'MINEFIELD', hint: 'MINES ARM WHEN YOU GET CLOSE', rocks: 3, speed: 1.1, mines: 7 },
    { name: 'SEEKERS', hint: 'RED ROCKS HUNT YOU', rocks: 4, speed: 1.1, homing: 0.5 },
    { name: 'EVENT HORIZON', hint: 'STAY OUT OF THE BLACK HOLE', rocks: 5, speed: 1.1,
      holes: [{ x: 160, y: 120, power: 1 }], spawn: [50, 120] },
    { name: 'THE BELT', hint: 'SURVIVE THE ROCK STREAM',
      belt: { time: 35, every: 0.85, speed: 55 }, spawn: [60, 120] },
    { name: 'STATION II', hint: 'IT BROUGHT FRIENDS', boss: 2, rocks: 3, droneEvery: 16 },
    { name: 'SNIPER NEST', hint: 'SHARDS AIM TRUE', rocks: 5, speed: 1.2, shardEvery: 11 },
    { name: 'HEAVY METAL', hint: 'ALMOST ALL ARMOR', rocks: 6, speed: 1.15, armor: 0.8 },
    { name: 'HUNTER PACK', hint: 'SEEKERS AND MINES', rocks: 5, speed: 1.2, homing: 0.6, mines: 4 },
    { name: 'SINGULARITY', hint: 'A HUNGRIER HOLE', rocks: 6, speed: 1.2, droneEvery: 10,
      holes: [{ x: 160, y: 120, power: 1.5 }], spawn: [50, 120] },
    { name: 'STATION III', hint: 'THE CORE FIGHTS BACK', boss: 3, mines: 4 },
    { name: 'DEEP BELT', hint: 'FASTER, DENSER, HARDER',
      belt: { time: 45, every: 0.55, speed: 75, armor: 0.3, homing: 0.15 }, spawn: [60, 120] },
    { name: 'CROSSFIRE', hint: 'DRONES AND SHARDS ON ALL SIDES', rocks: 7, speed: 1.3, droneEvery: 9, shardEvery: 10 },
    { name: 'TWIN HOLES', hint: 'TWO HOLES, ONE ORBIT', rocks: 6, speed: 1.25, armor: 0.3, spawn: [160, 222],
      holes: [{ power: 1.1, orbit: { rx: 80, ry: 45, speed: 0.3, phase: 0 } },
              { power: 1.1, orbit: { rx: 80, ry: 45, speed: 0.3, phase: Math.PI } }] },
    { name: 'THE GAUNTLET', hint: 'EVERYTHING AT ONCE', rocks: 7, speed: 1.35, armor: 0.3, homing: 0.3,
      mines: 5, shardEvery: 9 },
    { name: 'STATION PRIME', hint: 'END OF THE LINE', boss: 4, rocks: 2, shardEvery: 12 },
  ];

  // ==========================================================================
  // 3. HELPERS & AUDIO
  // ==========================================================================
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
  const chance = (p) => Math.random() < p;

  // Shortest delta on the wrapping playfield
  function wrapDX(dx) { return dx > W / 2 ? dx - W : dx < -W / 2 ? dx + W : dx; }
  function wrapDY(dy) { return dy > H / 2 ? dy - H : dy < -H / 2 ? dy + H : dy; }
  function dist2(ax, ay, bx, by) {
    const dx = wrapDX(bx - ax);
    const dy = wrapDY(by - ay);
    return dx * dx + dy * dy;
  }
  function wrapPos(o) {
    if (o.x < 0) o.x += W; else if (o.x >= W) o.x -= W;
    if (o.y < 0) o.y += H; else if (o.y >= H) o.y -= H;
  }

  const sfx = {
    fire(spread) { api.sound.tone(spread ? 1100 : 900, 0.07, { type: 'square', vol: 0.05, slide: 200 }); },
    thrust() { api.sound.noise(0.09, { vol: 0.045, filter: 420 }); },
    boom(size) {
      api.sound.noise(0.12 + size * 0.12, { vol: 0.1 + size * 0.04, filter: 2600 - size * 600 });
      if (size >= 3) api.sound.tone(75, 0.3, { type: 'sine', vol: 0.12, slide: 35 });
    },
    clink() { api.sound.tone(1700, 0.04, { type: 'triangle', vol: 0.07, slide: 1100 }); },
    shipDie() {
      api.sound.noise(1.0, { vol: 0.25, filter: 1000 });
      api.sound.tone(420, 0.9, { type: 'sawtooth', vol: 0.08, slide: 40 });
    },
    warp() {
      api.sound.tone(180, 0.3, { type: 'sine', vol: 0.12, slide: 1800 });
      api.sound.tone(1800, 0.2, { type: 'sine', vol: 0.06, slide: 300, delay: 0.3 });
    },
    respawn() { [392, 523, 659].forEach((f, i) => api.sound.tone(f, 0.08, { type: 'triangle', vol: 0.08, delay: i * 0.07 })); },
    power() { [660, 880, 1320].forEach((f, i) => api.sound.tone(f, 0.07, { type: 'square', vol: 0.07, delay: i * 0.06 })); },
    life() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => api.sound.tone(f, 0.08, { type: 'square', vol: 0.07, delay: i * 0.07 })); },
    tick(p) { api.sound.tone(420 + 520 * p, 0.035, { type: 'triangle', vol: 0.035 + 0.035 * p, slide: 460 + 560 * p }); },
    droneHum(small) { api.sound.tone(small ? 1500 : 210, small ? 0.04 : 0.09, { type: small ? 'sine' : 'triangle', vol: 0.025, slide: small ? 1750 : 230 }); },
    enemyFire() { api.sound.tone(620, 0.09, { type: 'sawtooth', vol: 0.045, slide: 260 }); },
    mineArm() { api.sound.tone(1300, 0.04, { type: 'square', vol: 0.05 }); },
    blast() {
      api.sound.noise(0.6, { vol: 0.22, filter: 800 });
      api.sound.tone(110, 0.45, { type: 'sine', vol: 0.15, slide: 30 });
    },
    bossHit() { api.sound.tone(240, 0.06, { type: 'square', vol: 0.06, slide: 120 }); },
    bossDie() {
      api.sound.noise(2.2, { vol: 0.3, filter: 600 });
      api.sound.tone(200, 2.0, { type: 'sawtooth', vol: 0.12, slide: 30 });
    },
    start() { [262, 330, 392, 523].forEach((f, i) => api.sound.tone(f, 0.1, { type: 'square', vol: 0.08, delay: i * 0.08 })); },
    clear() { [523, 659, 784, 1047, 1319].forEach((f, i) => api.sound.tone(f, 0.12, { type: 'triangle', vol: 0.1, delay: i * 0.09 })); },
    gameOver() { [392, 330, 262, 196].forEach((f, i) => api.sound.tone(f, 0.25, { type: 'sawtooth', vol: 0.08, delay: i * 0.22 })); },
    victory() {
      [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) =>
        api.sound.tone(f, 0.16, { type: 'square', vol: 0.08, delay: i * 0.13 }));
    },
    blip() { api.sound.tone(660, 0.05, { type: 'square', vol: 0.06 }); },
  };

  // ==========================================================================
  // GAME STATE
  // ==========================================================================
  let state = 'title';            // title | playing | paused | levelClear | gameOver | victory
  let stateT = 0;                 // seconds in the current state
  let level = 0;                  // index into LEVELS
  let score = 0;
  let lives = 0;
  let nextLifeAt = EXTRA_LIFE_EVERY;
  let hiScore = api.storage.get('hiScore', 0);
  let maxSector = clamp(api.storage.get('maxSector', 1), 1, LEVELS.length);
  let selSector = 1;
  let newHigh = false;
  let clearBonus = 0;
  let gameOverT = 0;              // countdown after final death before the game-over screen

  let ship = makeShip(W / 2, H / 2);
  ship.dead = true;
  let bullets = [];
  let ebullets = [];
  let rocks = [];
  let mines = [];
  let drones = [];
  let holes = [];
  let powerups = [];
  let particles = [];
  let blasts = [];
  let popups = [];
  let boss = null;
  let bossSpawned = false;
  let belt = null;
  let droneTimer = { big: 0, small: 0 };

  let bannerT = 0;
  let tickT = 1;                  // countdown to the next tension tick
  let initialMass = 1;
  let shake = 0;
  let flashT = 0;
  let flashColor = C.white;
  let starScroll = 0;
  const stars = [];
  for (let i = 0; i < 80; i++) stars.push({ x: rand(0, W), y: rand(0, H), d: rand(0.2, 1) });

  // ==========================================================================
  // 4. ENTITIES
  // ==========================================================================

  // ---- Particles, blasts, popups -------------------------------------------
  function addParticle(x, y, vx, vy, life, color, len = 0) {
    if (particles.length > 500) return;
    particles.push({ x, y, vx, vy, life, max: life, color, len, ang: rand(0, TAU), spin: rand(-8, 8) });
  }
  function burst(x, y, n, color, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(0.2, 1) * speed;
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.5, 1), color);
    }
  }
  function debris(x, y, n, color, speed, maxLen) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(0.3, 1) * speed;
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1.1), color, rand(2, maxLen));
    }
  }
  function updateParticles() {
    for (const p of particles) {
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.ang += p.spin * DT;
      p.life -= DT;
      wrapPos(p);
    }
    particles = particles.filter((p) => p.life > 0);
    for (const b of blasts) b.t += DT;
    blasts = blasts.filter((b) => b.t < 0.45);
    for (const p of popups) { p.t -= DT; p.y -= 12 * DT; }
    popups = popups.filter((p) => p.t > 0);
  }
  function popup(x, y, text, color = C.gold) { popups.push({ x, y, text, color, t: 1.1 }); }

  function addShake(n) { shake = Math.max(shake, n); }
  function flash(t, color = C.white) { flashT = t; flashColor = color; }

  function addScore(n) {
    score += n;
    while (score >= nextLifeAt) {
      nextLifeAt += EXTRA_LIFE_EVERY;
      if (lives < MAX_LIVES) {
        lives++;
        sfx.life();
        popup(ship.x, ship.y - 12, '1UP', POWERUPS.life.color);
      }
    }
  }

  // ---- Black holes ---------------------------------------------------------
  let gx = 0; // gravity output of gravityAt (kept in variables to avoid allocations)
  let gy = 0;
  function gravityAt(x, y, mult) {
    gx = 0;
    gy = 0;
    for (const h of holes) {
      const dx = h.x - x;
      const dy = h.y - y;
      const d2 = Math.max(dx * dx + dy * dy, 144);
      const d = Math.sqrt(d2);
      const f = Math.min(700, (HOLE_G * h.power * mult) / d2);
      gx += (dx / d) * f;
      gy += (dy / d) * f;
    }
  }
  function updateHoles() {
    for (const h of holes) {
      h.spin += DT;
      if (h.orbit) {
        const a = h.orbit.phase + h.spin * h.orbit.speed;
        h.x = W / 2 + Math.cos(a) * h.orbit.rx;
        h.y = H / 2 + Math.sin(a) * h.orbit.ry;
      }
    }
  }
  function nearHole(x, y, extra) {
    for (const h of holes) {
      const dx = h.x - x;
      const dy = h.y - y;
      if (dx * dx + dy * dy < (HOLE_HORIZON + extra) ** 2) return true;
    }
    return false;
  }

  // ---- Ship ----------------------------------------------------------------
  function makeShip(x, y) {
    return {
      x, y, vx: 0, vy: 0, a: -Math.PI / 2,
      dead: false, respawnT: 0, invuln: INVULN_TIME,
      warpT: 0, warpCd: 0, hx: 0, hy: 0,
      fireCd: 0, thrusting: false,
      spread: 0, rapid: 0, shield: 0,
    };
  }
  function shipActive() { return !ship.dead && ship.warpT <= 0; }
  function spawnPoint() { return LEVELS[level].spawn || [W / 2, H / 2]; }

  // Is (x, y) a reasonably safe place for the ship to appear?
  function isSafe(x, y) {
    for (const r of rocks) if (dist2(x, y, r.x, r.y) < (r.r + 40) ** 2) return false;
    for (const s of drones) if (dist2(x, y, s.x, s.y) < 45 * 45) return false;
    for (const m of mines) if (dist2(x, y, m.x, m.y) < 60 * 60) return false;
    for (const b of ebullets) if (dist2(x, y, b.x, b.y) < 30 * 30) return false;
    if (nearHole(x, y, 45)) return false;
    if (bossTouches(x, y, 30)) return false;
    return true;
  }

  function updateShip(input, hazards) {
    const s = ship;
    if (s.dead) {
      s.respawnT -= DT;
      if (lives > 0 && s.respawnT <= 0) {
        const [sx, sy] = spawnPoint();
        if (isSafe(sx, sy) || s.respawnT < -3) {
          ship = makeShip(sx, sy);
          sfx.respawn();
          burst(sx, sy, 16, C.ship, 60, 0.5);
        }
      }
      return;
    }
    if (s.warpT > 0) {
      s.warpT -= DT;
      if (s.warpT <= 0) exitWarp();
      return;
    }

    s.invuln = Math.max(0, s.invuln - DT);
    s.warpCd -= DT;
    s.fireCd--;
    s.spread = Math.max(0, s.spread - DT);
    s.rapid = Math.max(0, s.rapid - DT);
    s.shield = Math.max(0, s.shield - DT);

    if (input.left) s.a -= SHIP_TURN * DT;
    if (input.right) s.a += SHIP_TURN * DT;
    s.thrusting = input.up;
    if (s.thrusting) {
      s.vx += Math.cos(s.a) * SHIP_THRUST * DT;
      s.vy += Math.sin(s.a) * SHIP_THRUST * DT;
      if (api.frame % 6 === 0) sfx.thrust();
      if (api.frame % 2 === 0) {
        const ba = s.a + Math.PI + rand(-0.3, 0.3);
        addParticle(s.x - Math.cos(s.a) * 6, s.y - Math.sin(s.a) * 6,
          Math.cos(ba) * 70 + s.vx, Math.sin(ba) * 70 + s.vy, rand(0.15, 0.3), chance(0.5) ? C.flame : C.flame2);
      }
    }
    if (hazards && holes.length) {
      gravityAt(s.x, s.y, 1);
      s.vx += gx * DT;
      s.vy += gy * DT;
    }
    s.vx *= 1 - SHIP_DRAG * DT;
    s.vy *= 1 - SHIP_DRAG * DT;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > SHIP_MAX_SPEED) {
      s.vx *= SHIP_MAX_SPEED / sp;
      s.vy *= SHIP_MAX_SPEED / sp;
    }
    s.x += s.vx * DT;
    s.y += s.vy * DT;
    wrapPos(s);

    const gun = s.rapid > 0 ? GUNS.rapid : GUNS.normal;
    const maxBullets = gun.max * (s.spread > 0 ? 3 : 1);
    if (input.a && s.fireCd <= 0 && bullets.length < maxBullets) fire(gun);
    if (input.pressed.b && s.warpCd <= 0) enterWarp();
  }

  function fire(gun) {
    const s = ship;
    s.fireCd = gun.cooldown;
    const angles = s.spread > 0 ? [-SPREAD_ANGLE, 0, SPREAD_ANGLE] : [0];
    for (const da of angles) {
      const a = s.a + da;
      bullets.push({
        x: s.x + Math.cos(s.a) * 9, y: s.y + Math.sin(s.a) * 9,
        vx: Math.cos(a) * BULLET_SPEED + s.vx * 0.6, vy: Math.sin(a) * BULLET_SPEED + s.vy * 0.6,
        life: BULLET_LIFE, dead: false,
      });
    }
    sfx.fire(s.spread > 0);
  }

  function enterWarp() {
    const s = ship;
    s.warpT = WARP_TIME;
    s.warpCd = WARP_COOLDOWN;
    burst(s.x, s.y, 20, C.accent, 90, 0.4);
    let x = rand(20, W - 20);
    let y = rand(20, H - 20);
    for (let i = 0; i < 15 && !isSafe(x, y); i++) {
      x = rand(20, W - 20);
      y = rand(20, H - 20);
    }
    s.hx = x;
    s.hy = y;
    sfx.warp();
  }
  function exitWarp() {
    const s = ship;
    s.x = s.hx;
    s.y = s.hy;
    s.vx *= 0.4;
    s.vy *= 0.4;
    s.invuln = Math.max(s.invuln, 0.3);
    burst(s.x, s.y, 20, C.accent, 90, 0.4);
  }

  function killShip() {
    const s = ship;
    if (s.dead) return;
    s.dead = true;
    s.respawnT = RESPAWN_DELAY;
    // Ship outline breaks into spinning line segments
    debris(s.x, s.y, 6, C.ship, 60, 9);
    burst(s.x, s.y, 30, C.flame, 110, 0.9);
    addShake(10);
    flash(0.3);
    sfx.shipDie();
    lives--;
    if (lives <= 0) gameOverT = 2.6;
  }

  function updateBullets(hazards) {
    for (const b of bullets) {
      if (hazards && holes.length) {
        gravityAt(b.x, b.y, 1.5);
        b.vx += gx * DT;
        b.vy += gy * DT;
        if (nearHole(b.x, b.y, 0)) b.dead = true;
      }
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      wrapPos(b);
      b.life -= DT;
      if (b.life <= 0) b.dead = true;
    }
    bullets = bullets.filter((b) => !b.dead);

    for (const b of ebullets) {
      if (holes.length) {
        gravityAt(b.x, b.y, 0.6);
        b.vx += gx * DT;
        b.vy += gy * DT;
        if (nearHole(b.x, b.y, 0)) b.dead = true;
      }
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      b.life -= DT;
      if (b.life <= 0 || b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) b.dead = true;
    }
    ebullets = ebullets.filter((b) => !b.dead);
  }

  function enemyShot(x, y, angle, speed) {
    ebullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 4, dead: false });
  }
  function angleToShip(x, y) {
    return Math.atan2(wrapDY(ship.y - y), wrapDX(ship.x - x));
  }

  // ---- Rocks ---------------------------------------------------------------
  function makeRock(size, x, y, kind, vx, vy) {
    const def = ROCK[size];
    const n = size === 1 ? 7 : size === 2 ? 9 : 11;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.2, 0.2);
      const rr = def.r * rand(0.72, 1.12);
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return {
      x, y, vx, vy, size, kind, pts,
      r: def.r,
      hp: kind === 'armor' ? size + 1 : 1,
      rot: rand(0, TAU), spin: rand(-1.2, 1.2) / size,
      flash: 0, dead: false, belt: false,
    };
  }
  function rockKind(armorChance, homingChance) {
    if (chance(armorChance || 0)) return 'armor';
    if (chance(homingChance || 0)) return 'homing';
    return 'normal';
  }
  function rockSpeedMult() { return LEVELS[level].speed || 1; }

  function spawnFieldRock(size, kind) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 40; i++) {
      x = rand(0, W);
      y = rand(0, H);
      if (dist2(x, y, ship.x, ship.y) > 95 * 95 && !nearHole(x, y, 70)) break;
    }
    const a = rand(0, TAU);
    const sp = ROCK[size].speed * rockSpeedMult() * rand(0.7, 1.3);
    rocks.push(makeRock(size, x, y, kind, Math.cos(a) * sp, Math.sin(a) * sp));
  }

  function updateRocks(hazards) {
    const mult = rockSpeedMult();
    for (const r of rocks) {
      if (r.dead) continue;
      if (hazards && r.kind === 'homing' && shipActive()) {
        const dx = wrapDX(ship.x - r.x);
        const dy = wrapDY(ship.y - r.y);
        const d = Math.hypot(dx, dy) || 1;
        const acc = 26 + (3 - r.size) * 10;
        r.vx += (dx / d) * acc * DT;
        r.vy += (dy / d) * acc * DT;
        const max = ROCK[r.size].speed * mult * 1.5;
        const sp = Math.hypot(r.vx, r.vy);
        if (sp > max) { r.vx *= max / sp; r.vy *= max / sp; }
      }
      if (hazards && holes.length) {
        gravityAt(r.x, r.y, 0.1);
        r.vx += gx * DT;
        r.vy += gy * DT;
        if (nearHole(r.x, r.y, r.r * 0.5)) {
          // Swallowed: no score, no split
          r.dead = true;
          burst(r.x, r.y, 14, C.hole, 50, 0.6);
          sfx.boom(1);
          continue;
        }
      }
      r.x += r.vx * DT;
      r.y += r.vy * DT;
      r.rot += r.spin * DT;
      r.flash = Math.max(0, r.flash - DT);
      if (r.belt) {
        if (r.y < 0) r.y += H; else if (r.y >= H) r.y -= H;
        if (r.x < -r.r - 10 || r.x > W + r.r + 40) r.dead = true;
      } else {
        wrapPos(r);
      }
    }
    rocks = rocks.filter((r) => !r.dead);
  }

  // Damage a rock. Returns true if it was destroyed.
  function hitRock(r, award, pushX = 0, pushY = 0) {
    if (r.dead) return false;
    r.hp--;
    if (r.hp > 0) {
      // Armor absorbs the hit
      r.flash = 0.12;
      r.vx += pushX * 0.05;
      r.vy += pushY * 0.05;
      burst(r.x, r.y, 5, C.white, 80, 0.25);
      sfx.clink();
      return false;
    }
    destroyRock(r, award);
    return true;
  }

  function destroyRock(r, award, split = true) {
    r.dead = true;
    const color = r.kind === 'armor' ? C.armor : r.kind === 'homing' ? C.homing : C.rock;
    burst(r.x, r.y, 6 + r.size * 5, color, 40 + r.size * 15, 0.7);
    debris(r.x, r.y, r.size * 2, color, 50, r.r * 0.6);
    addShake(r.size * 1.5);
    sfx.boom(r.size);
    if (award) {
      let pts = ROCK[r.size].score;
      if (r.kind === 'armor') pts *= 2;
      if (r.kind === 'homing') pts = Math.floor(pts * 1.5);
      addScore(pts);
    }
    if (split && r.size > 1) {
      const child = r.size - 1;
      const mult = rockSpeedMult();
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU);
        const sp = ROCK[child].speed * mult * rand(0.8, 1.3);
        const c = makeRock(child, r.x, r.y, r.kind, r.vx * 0.5 + Math.cos(a) * sp, r.vy * 0.5 + Math.sin(a) * sp);
        c.belt = r.belt;
        rocks.push(c);
      }
    }
    if (award && r.size < 3 && chance(ROCK_DROP_CHANCE)) dropPowerup(r.x, r.y);
  }

  function rockMass() {
    let m = mines.length * 2;
    for (const r of rocks) m += ROCK[r.size].mass;
    return m;
  }

  // ---- Rock belt (scrolling stream sector) -----------------------------
  function spawnBeltRock(x) {
    const cfg = belt.cfg;
    const roll = Math.random();
    const size = roll < 0.4 ? 3 : roll < 0.8 ? 2 : 1;
    const r = ROCK[size].r;
    const vx = -cfg.speed * rand(0.6, 1.4) * (size === 1 ? 1.3 : 1);
    const rock = makeRock(size, x ?? W + r + 2, rand(10, H - 10), rockKind(cfg.armor, cfg.homing), vx, rand(-18, 18));
    rock.belt = true;
    rocks.push(rock);
  }
  function updateBelt() {
    if (!belt) return;
    belt.t = Math.max(0, belt.t - DT);
    if (belt.t > 0) {
      belt.spawnT -= DT;
      if (belt.spawnT <= 0) {
        spawnBeltRock();
        belt.spawnT = belt.cfg.every * rand(0.6, 1.4);
      }
    }
  }

  // ---- Mines ---------------------------------------------------------------
  function spawnMine() {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 40; i++) {
      x = rand(10, W - 10);
      y = rand(10, H - 10);
      if (dist2(x, y, ship.x, ship.y) > 100 * 100 && !nearHole(x, y, 60)) break;
    }
    const a = rand(0, TAU);
    mines.push({ x, y, vx: Math.cos(a) * 8, vy: Math.sin(a) * 8, armT: -1, beepT: 0, spin: rand(0, TAU), dead: false });
  }
  function updateMines() {
    for (const m of mines) {
      if (m.dead) continue;
      m.x += m.vx * DT;
      m.y += m.vy * DT;
      m.spin += DT * (m.armT >= 0 ? 6 : 1);
      wrapPos(m);
      if (m.armT < 0) {
        if (shipActive() && dist2(m.x, m.y, ship.x, ship.y) < MINE_TRIGGER * MINE_TRIGGER) {
          m.armT = MINE_FUSE;
          m.beepT = 0;
        }
      } else {
        m.armT -= DT;
        m.beepT -= DT;
        if (m.beepT <= 0) {
          sfx.mineArm();
          m.beepT = 0.05 + m.armT * 0.22;
        }
        if (m.armT <= 0) detonate(m, false);
      }
    }
    mines = mines.filter((m) => !m.dead);
  }

  // A mine explodes: it hurts everything in the blast radius, including you.
  function detonate(m, byPlayer) {
    if (m.dead) return;
    m.dead = true;
    blasts.push({ x: m.x, y: m.y, t: 0 });
    burst(m.x, m.y, 30, C.mine, 120, 0.6);
    burst(m.x, m.y, 15, C.gold, 70, 0.5);
    addShake(7);
    sfx.blast();
    if (byPlayer) addScore(MINE_SCORE);
    const R2 = MINE_BLAST * MINE_BLAST;
    if (shipActive() && ship.invuln <= 0 && ship.shield <= 0 && dist2(m.x, m.y, ship.x, ship.y) < R2) killShip();
    for (const r of rocks) {
      if (!r.dead && dist2(m.x, m.y, r.x, r.y) < (MINE_BLAST + r.r) ** 2) hitRock(r, byPlayer);
    }
    for (const s of drones) {
      if (!s.dead && dist2(m.x, m.y, s.x, s.y) < (MINE_BLAST + s.r) ** 2) destroyDrone(s, byPlayer);
    }
    for (const o of mines) {
      if (!o.dead && dist2(m.x, m.y, o.x, o.y) < (MINE_BLAST + 12) ** 2 && (o.armT < 0 || o.armT > 0.15)) {
        o.armT = 0.15; // chain reaction
        o.beepT = 1;
      }
    }
  }

  // ---- Drones & shards ----------------------------------------------------------
  function spawnDrone(small) {
    const def = small ? DRONE.small : DRONE.big;
    const fromLeft = chance(0.5);
    drones.push({
      small, r: def.r,
      x: fromLeft ? -def.r : W + def.r, y: rand(25, H - 25),
      vx: (fromLeft ? 1 : -1) * def.speed, vy: 0,
      turnT: rand(0.6, 1.4), fireT: def.fireEvery, soundT: 0, dead: false,
    });
  }
  function updateDrones(allowSpawn) {
    const cfg = LEVELS[level];
    for (const kind of ['big', 'small']) {
      const every = kind === 'big' ? cfg.droneEvery : cfg.shardEvery;
      if (!every || !allowSpawn) continue;
      droneTimer[kind] -= DT;
      if (droneTimer[kind] <= 0 && !drones.some((s) => s.small === (kind === 'small'))) {
        spawnDrone(kind === 'small');
        droneTimer[kind] = every * rand(0.8, 1.2);
      }
    }
    for (const s of drones) {
      if (s.dead) continue;
      const def = s.small ? DRONE.small : DRONE.big;
      s.x += s.vx * DT;
      s.y += s.vy * DT;
      if (s.y < 0) s.y += H; else if (s.y >= H) s.y -= H;
      if (s.x < -s.r - 4 || s.x > W + s.r + 4) { s.dead = true; continue; }
      s.turnT -= DT;
      if (s.turnT <= 0) {
        s.vy = [-1, 0, 1][Math.floor(rand(0, 3))] * def.speed * 0.6;
        s.turnT = rand(0.7, 1.6);
      }
      s.soundT -= DT;
      if (s.soundT <= 0) { sfx.droneHum(s.small); s.soundT = 0.18; }
      s.fireT -= DT;
      if (s.fireT <= 0 && shipActive()) {
        s.fireT = def.fireEvery * rand(0.8, 1.2);
        let a;
        if (s.small) {
          const err = Math.max(0.04, 0.35 - level * 0.016);
          a = angleToShip(s.x, s.y) + rand(-err, err);
        } else {
          a = rand(0, TAU);
        }
        enemyShot(s.x, s.y, a, ENEMY_BULLET_SPEED + level * 3);
        sfx.enemyFire();
      }
    }
    drones = drones.filter((s) => !s.dead);
  }
  function destroyDrone(s, award) {
    if (s.dead) return;
    s.dead = true;
    const def = s.small ? DRONE.small : DRONE.big;
    const color = s.small ? C.shard : C.drone;
    burst(s.x, s.y, 25, color, 100, 0.8);
    debris(s.x, s.y, 6, color, 70, 8);
    addShake(5);
    sfx.boom(2);
    if (award) {
      addScore(def.score);
      popup(s.x, s.y - 10, String(def.score));
      if (chance(def.drop)) dropPowerup(s.x, s.y);
    }
  }

  // ---- Ring station boss --------------------------------------------------
  function makeBoss(tier) {
    const n = Math.min(BOSS_TURRETS.length, tier + 1);
    const turrets = BOSS_TURRETS.slice(0, n).map(([dx, dy]) => ({
      dx, dy, hp: 4 + tier * 2, fireT: rand(1.5, 3), flash: 0,
    }));
    return {
      tier, turrets, x: W / 2, y: -30, baseY: -30, t: 0,
      coreHp: 20 + tier * 8, coreMax: 20 + tier * 8,
      hpMax: 20 + tier * 8 + n * (4 + tier * 2),
      flash: 0, dying: 0, boomT: 0,
      burstT: 4, burstSpin: 0, spawnT: 6, mineT: 7,
    };
  }
  function bossTurretsAlive(b) { return b.turrets.some((t) => t.hp > 0); }
  function bossHpFrac(b) {
    let hp = Math.max(0, b.coreHp);
    for (const t of b.turrets) hp += Math.max(0, t.hp);
    return hp / b.hpMax;
  }

  function updateBoss() {
    const b = boss;
    if (!b) return;
    b.t += DT;
    b.flash = Math.max(0, b.flash - DT);
    for (const t of b.turrets) t.flash = Math.max(0, t.flash - DT);

    if (b.dying > 0) {
      b.dying -= DT;
      b.x += rand(-1, 1);
      b.boomT -= DT;
      if (b.boomT <= 0) {
        b.boomT = 0.1;
        const ex = b.x + rand(-45, 45);
        const ey = b.y + rand(-14, 14);
        burst(ex, ey, 14, chance(0.5) ? C.boss : C.gold, 90, 0.5);
        sfx.boom(2);
        addShake(4);
      }
      if (b.dying <= 0) finishBoss();
      return;
    }

    // Movement: descend into view, then sway
    b.baseY = Math.min(56, b.baseY + 30 * DT);
    b.x = W / 2 + Math.sin(b.t * (0.45 + 0.08 * b.tier)) * (70 + b.tier * 8);
    b.y = b.baseY + Math.sin(b.t * 0.9) * 12 + (b.tier >= 3 ? Math.sin(b.t * 0.31) * 26 : 0);
    if (b.baseY < 56) return; // still entering

    const canShoot = shipActive();
    // Turrets: aimed shots
    for (const t of b.turrets) {
      if (t.hp <= 0) continue;
      t.fireT -= DT;
      if (t.fireT <= 0) {
        t.fireT = rand(1.8, 2.8) - b.tier * 0.25;
        if (canShoot) {
          const tx = b.x + t.dx;
          const ty = b.y + t.dy;
          enemyShot(tx, ty, angleToShip(tx, ty), 95 + b.tier * 12);
          sfx.enemyFire();
        }
      }
    }
    // Core: radial bursts (always from tier 3, otherwise once exposed)
    const exposed = !bossTurretsAlive(b);
    if (exposed || b.tier >= 3) {
      b.burstT -= DT;
      if (b.burstT <= 0) {
        b.burstT = exposed ? 3.2 - b.tier * 0.4 : 5;
        const n = 10 + b.tier * 2;
        b.burstSpin += 0.3;
        for (let i = 0; i < n; i++) enemyShot(b.x, b.y + BOSS_CORE_Y, b.burstSpin + (i / n) * TAU, 75 + b.tier * 6);
        api.sound.tone(180, 0.25, { type: 'sawtooth', vol: 0.08, slide: 600 });
      }
    }
    // Exposed core launches seeker rocks
    if (exposed) {
      b.spawnT -= DT;
      if (b.spawnT <= 0 && rocks.length < 12) {
        b.spawnT = 6 - b.tier;
        const r = makeRock(1, b.x, b.y + 16, 'homing', rand(-30, 30), 50);
        rocks.push(r);
      }
    }
    // Final station seeds mines
    if (b.tier >= 4) {
      b.mineT -= DT;
      if (b.mineT <= 0 && mines.length < 4) {
        b.mineT = 7;
        mines.push({ x: b.x, y: b.y + 16, vx: rand(-20, 20), vy: 25, armT: -1, beepT: 0, spin: 0, dead: false });
      }
    }
  }

  // Player bullet vs boss. Returns true if the bullet was absorbed.
  function bulletHitsBoss(bl) {
    const b = boss;
    if (!b || b.dying > 0) return false;
    const lx = bl.x - b.x;
    const ly = bl.y - b.y;
    for (const t of b.turrets) {
      if (t.hp <= 0) continue;
      if ((lx - t.dx) ** 2 + (ly - t.dy) ** 2 < 7 * 7) {
        t.hp--;
        t.flash = 0.1;
        sfx.bossHit();
        burst(bl.x, bl.y, 4, C.turret, 60, 0.25);
        if (t.hp <= 0) {
          burst(b.x + t.dx, b.y + t.dy, 24, C.turret, 110, 0.7);
          debris(b.x + t.dx, b.y + t.dy, 5, C.turret, 70, 6);
          addShake(6);
          sfx.boom(2);
          addScore(500);
          popup(b.x + t.dx, b.y + t.dy - 8, '500');
          if (chance(0.5)) dropPowerup(b.x + t.dx, b.y + t.dy);
          if (!bossTurretsAlive(b)) {
            popup(b.x, b.y - 24, 'CORE EXPOSED', C.bossCore);
            b.burstT = 1.5;
          }
        }
        return true;
      }
    }
    if (lx * lx + (ly - BOSS_CORE_Y) ** 2 < 9 * 9) {
      if (bossTurretsAlive(b)) {
        sfx.clink();
        burst(bl.x, bl.y, 3, C.white, 60, 0.2);
      } else {
        b.coreHp--;
        b.flash = 0.08;
        sfx.bossHit();
        burst(bl.x, bl.y, 5, C.bossCore, 70, 0.3);
        if (b.coreHp <= 0) killBoss();
      }
      return true;
    }
    if ((lx / 52) ** 2 + (ly / 16) ** 2 < 1) {
      burst(bl.x, bl.y, 2, C.boss, 40, 0.2);
      return true;
    }
    return false;
  }
  function bossTouches(x, y, pad) {
    const b = boss;
    if (!b || b.dying > 0) return false;
    return ((x - b.x) / (52 + pad)) ** 2 + ((y - b.y) / (16 + pad)) ** 2 < 1;
  }
  function killBoss() {
    const b = boss;
    b.dying = 2.2;
    b.boomT = 0;
    ebullets = [];
    addScore(2000 * b.tier);
    popup(b.x, b.y - 26, String(2000 * b.tier));
    sfx.bossDie();
    flash(0.25, C.bossCore);
  }
  function finishBoss() {
    const b = boss;
    burst(b.x, b.y, 80, C.boss, 180, 1.2);
    burst(b.x, b.y, 50, C.gold, 140, 1.0);
    debris(b.x, b.y, 18, C.boss, 120, 16);
    addShake(16);
    flash(0.45);
    sfx.boom(3);
    boss = null;
    // The fleet goes down with its station
    for (const r of rocks) if (!r.dead) destroyRock(r, true, false);
    for (const m of mines) detonate(m, true);
    for (const s of drones) destroyDrone(s, true);
  }

  // ---- Power-ups -----------------------------------------------------------
  function dropPowerup(x, y) {
    const pool = Object.keys(POWERUPS).filter((k) => k !== 'life' || lives < MAX_LIVES);
    let total = 0;
    for (const k of pool) total += POWERUPS[k].weight;
    let roll = rand(0, total);
    let type = pool[0];
    for (const k of pool) {
      roll -= POWERUPS[k].weight;
      if (roll <= 0) { type = k; break; }
    }
    const a = rand(0, TAU);
    powerups.push({ x, y, vx: Math.cos(a) * 15, vy: Math.sin(a) * 15, type, t: 10 });
  }
  function updatePowerups() {
    for (const p of powerups) {
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      wrapPos(p);
      p.t -= DT;
      if (shipActive() && dist2(p.x, p.y, ship.x, ship.y) < 14 * 14) {
        p.t = 0;
        collectPowerup(p.type);
      }
    }
    powerups = powerups.filter((p) => p.t > 0);
  }
  function collectPowerup(type) {
    const def = POWERUPS[type];
    popup(ship.x, ship.y - 12, def.name, def.color);
    burst(ship.x, ship.y, 14, def.color, 70, 0.4);
    if (type === 'spread') ship.spread = POWER_TIME;
    else if (type === 'rapid') ship.rapid = POWER_TIME;
    else if (type === 'shield') ship.shield = SHIELD_TIME;
    if (type === 'life') {
      lives = Math.min(MAX_LIVES, lives + 1);
      sfx.life();
    } else {
      sfx.power();
    }
    addScore(100);
  }

  // ==========================================================================
  // 5. COLLISIONS
  // ==========================================================================
  function collide() {
    // Player bullets vs everything
    for (const bl of bullets) {
      for (const r of rocks) {
        if (!r.dead && dist2(bl.x, bl.y, r.x, r.y) < r.r * r.r) {
          bl.dead = true;
          hitRock(r, true, bl.vx, bl.vy);
          break;
        }
      }
      if (bl.dead) continue;
      for (const m of mines) {
        if (!m.dead && dist2(bl.x, bl.y, m.x, m.y) < (MINE_RADIUS + 2) ** 2) {
          bl.dead = true;
          detonate(m, true);
          break;
        }
      }
      if (bl.dead) continue;
      for (const s of drones) {
        if (!s.dead && dist2(bl.x, bl.y, s.x, s.y) < s.r * s.r) {
          bl.dead = true;
          destroyDrone(s, true);
          break;
        }
      }
      if (!bl.dead && bulletHitsBoss(bl)) bl.dead = true;
    }

    // Drones crash into rocks
    for (const s of drones) {
      for (const r of rocks) {
        if (!s.dead && !r.dead && dist2(s.x, s.y, r.x, r.y) < (s.r + r.r * 0.8) ** 2) {
          destroyDrone(s, false);
          hitRock(r, false);
        }
      }
    }

    if (!shipActive()) return;
    const s = ship;

    // Black holes ignore shields
    if (nearHole(s.x, s.y, 2)) {
      burst(s.x, s.y, 20, C.hole, 60, 0.8);
      killShip();
      return;
    }

    const safe = s.invuln > 0;
    const shielded = s.shield > 0;
    for (const r of rocks) {
      if (r.dead || dist2(s.x, s.y, r.x, r.y) >= (r.r * 0.85 + SHIP_RADIUS) ** 2) continue;
      if (shielded) {
        hitRock(r, true, s.vx, s.vy);
        s.vx = -s.vx * 0.5;
        s.vy = -s.vy * 0.5;
      } else if (!safe) {
        hitRock(r, true);
        killShip();
        return;
      }
    }
    for (const m of mines) {
      if (!m.dead && dist2(s.x, s.y, m.x, m.y) < (MINE_RADIUS + SHIP_RADIUS) ** 2 && !safe) detonate(m, true);
    }
    if (s.dead) return;
    for (const u of drones) {
      if (u.dead || dist2(s.x, s.y, u.x, u.y) >= (u.r + SHIP_RADIUS) ** 2) continue;
      if (shielded) destroyDrone(u, true);
      else if (!safe) { destroyDrone(u, true); killShip(); return; }
    }
    for (const b of ebullets) {
      if (b.dead || dist2(s.x, s.y, b.x, b.y) >= (SHIP_RADIUS + 2) ** 2) continue;
      if (shielded) { b.dead = true; burst(b.x, b.y, 4, C.shield, 50, 0.3); }
      else if (!safe) { b.dead = true; killShip(); return; }
    }
    if (bossTouches(s.x, s.y, SHIP_RADIUS)) {
      if (shielded || safe) {
        const a = Math.atan2(s.y - boss.y, s.x - boss.x);
        s.vx = Math.cos(a) * 120;
        s.vy = Math.sin(a) * 120;
      } else {
        killShip();
      }
    }
  }

  // ==========================================================================
  // 6. GAME STATES
  // ==========================================================================
  function setState(s) {
    state = s;
    stateT = 0;
  }

  function enterTitle() {
    setState('title');
    resetWorld();
    ship.dead = true;
    level = 0;
    selSector = maxSector;
    for (let i = 0; i < 6; i++) {
      const size = 1 + Math.floor(rand(0, 3));
      const a = rand(0, TAU);
      rocks.push(makeRock(size, rand(0, W), rand(0, H), 'normal', Math.cos(a) * 20, Math.sin(a) * 20));
    }
  }

  function resetWorld() {
    bullets = [];
    ebullets = [];
    rocks = [];
    mines = [];
    drones = [];
    holes = [];
    powerups = [];
    blasts = [];
    popups = [];
    boss = null;
    belt = null;
  }

  function newGame(startSector) {
    score = 0;
    lives = START_LIVES;
    nextLifeAt = EXTRA_LIFE_EVERY;
    newHigh = false;
    gameOverT = 0;
    particles = [];
    sfx.start();
    startLevel(startSector - 1);
  }

  function startLevel(i) {
    level = i;
    const cfg = LEVELS[i];
    if (i + 1 > maxSector) {
      maxSector = i + 1;
      api.storage.set('maxSector', maxSector);
    }
    // Keep active power-ups from the previous sector
    const keep = ship.dead ? null : ship;
    resetWorld();
    const [sx, sy] = spawnPoint();
    ship = makeShip(sx, sy);
    if (keep) {
      ship.spread = keep.spread;
      ship.rapid = keep.rapid;
      ship.shield = keep.shield;
    }
    holes = (cfg.holes || []).map((h) => ({ x: h.x ?? W / 2, y: h.y ?? H / 2, power: h.power, orbit: h.orbit, spin: 0 }));
    updateHoles();
    for (let k = 0; k < (cfg.rocks || 0); k++) spawnFieldRock(3, rockKind(cfg.armor, cfg.homing));
    for (let k = 0; k < (cfg.mines || 0); k++) spawnMine();
    bossSpawned = !!cfg.boss;
    if (cfg.boss) boss = makeBoss(cfg.boss);
    if (cfg.belt) {
      belt = { cfg: cfg.belt, t: cfg.belt.time, spawnT: 1 };
      for (let k = 0; k < 3; k++) spawnBeltRock(rand(200, W));
    }
    droneTimer = { big: (cfg.droneEvery || 0) * 0.6, small: (cfg.shardEvery || 0) * 0.6 };
    initialMass = Math.max(1, rockMass());
    bannerT = 2.6;
    tickT = 1;
    setState('playing');
  }

  function enemiesRemain() {
    const cfg = LEVELS[level];
    if (cfg.boss) return !!boss;
    if (cfg.belt) return belt.t > 0;
    return rocks.length > 0 || mines.length > 0;
  }

  function checkLevelClear() {
    if (ship.dead && lives <= 0) return;
    const cfg = LEVELS[level];
    let done;
    if (cfg.boss) done = bossSpawned && !boss;
    else if (cfg.belt) done = belt.t <= 0 && rocks.length === 0;
    else done = rocks.length === 0 && mines.length === 0;
    if (!done) return;
    for (const s of drones) destroyDrone(s, true);
    ebullets = [];
    clearBonus = 500 + level * 250;
    addScore(clearBonus);
    if (level + 2 <= LEVELS.length && level + 2 > maxSector) {
      maxSector = level + 2;
      api.storage.set('maxSector', maxSector);
    }
    sfx.clear();
    flash(0.15, C.accent);
    setState('levelClear');
  }

  function saveHighScore() {
    if (score > hiScore) {
      hiScore = score;
      newHigh = true;
      api.storage.set('hiScore', hiScore);
    }
  }

  function endGame(won) {
    saveHighScore();
    drones = [];
    ebullets = [];
    mines = [];
    powerups = [];
    boss = null;
    holes = [];
    if (won) {
      sfx.victory();
      setState('victory');
    } else {
      sfx.gameOver();
      setState('gameOver');
    }
  }

  // Tension cue: a soft tick that rises in pitch and speeds up as the sector empties
  function tensionTick() {
    const cfg = LEVELS[level];
    let frac;
    if (cfg.boss) frac = boss ? bossHpFrac(boss) : 0;
    else if (cfg.belt) frac = belt.t / belt.cfg.time;
    else frac = rockMass() / initialMass;
    const f = clamp(frac, 0, 1);
    tickT -= DT;
    if (tickT <= 0) {
      sfx.tick(1 - f);
      tickT = 0.2 + 0.8 * f;
    }
  }

  // ---- Per-state update ----------------------------------------------------
  function updateTitle(input) {
    if (input.pressed.left && selSector > 1) { selSector--; sfx.blip(); }
    if (input.pressed.right && selSector < maxSector) { selSector++; sfx.blip(); }
    updateRocks(false);
    updateParticles();
    if (input.pressed.start || (stateT > 0.3 && input.pressed.a)) newGame(selSector);
  }

  function updatePlaying(input) {
    if (input.pressed.start) {
      setState('paused');
      sfx.blip();
      return;
    }
    bannerT = Math.max(0, bannerT - DT);
    if (belt) starScroll += belt.cfg.speed * 0.6 * DT;
    updateHoles();
    updateShip(input, true);
    updateBullets(true);
    updateRocks(true);
    updateMines();
    updateDrones(enemiesRemain());
    updateBoss();
    updateBelt();
    updatePowerups();
    collide();
    updateParticles();
    if (lives > 0) tensionTick();

    if (gameOverT > 0) {
      gameOverT -= DT;
      if (gameOverT <= 0) endGame(false);
      return;
    }
    checkLevelClear();
  }

  function updatePaused(input) {
    if (input.pressed.start) { setState('playing'); sfx.blip(); }
    else if (input.pressed.select) { saveHighScore(); enterTitle(); }
  }

  function updateLevelClear(input) {
    if (belt) starScroll += belt.cfg.speed * 0.3 * DT;
    updateShip(input, false);
    updateBullets(false);
    updateRocks(false);
    updatePowerups();
    updateParticles();
    if (stateT > 3) {
      if (level + 1 >= LEVELS.length) endGame(true);
      else startLevel(level + 1);
    }
  }

  function updateGameOver(input) {
    updateRocks(false);
    updateParticles();
    if (state === 'victory' && api.frame % 20 === 0) {
      const colors = [C.gold, C.shield, C.ebullet, C.turret, C.boss];
      burst(rand(40, W - 40), rand(40, 150), 30, colors[Math.floor(rand(0, colors.length))], 90, 1.2);
      api.sound.noise(0.25, { vol: 0.05, filter: 1500 });
    }
    if (stateT > 1.2 && (input.pressed.start || input.pressed.a)) enterTitle();
  }

  // ==========================================================================
  // 7. DRAWING
  // ==========================================================================

  // Stroke the current path twice: a wide faint pass for glow, then a crisp line.
  function glow(g, color, width = 1) {
    g.strokeStyle = color;
    g.globalAlpha = 0.22;
    g.lineWidth = width + 2.5;
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = width;
    g.stroke();
  }

  // Add a closed polygon (flat local [x,y,...] array) to the current path.
  function polyPath(g, x, y, pts, rot, scale = 1) {
    const c = Math.cos(rot) * scale;
    const s = Math.sin(rot) * scale;
    for (let i = 0; i < pts.length; i += 2) {
      const px = x + pts[i] * c - pts[i + 1] * s;
      const py = y + pts[i] * s + pts[i + 1] * c;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }

  // Call fn(x, y) for the object and for each screen-wrapped copy near an edge.
  function forWrapped(x, y, r, fn, wrapX = true) {
    fn(x, y);
    const ox = wrapX ? (x < r ? W : x > W - r ? -W : 0) : 0;
    const oy = y < r ? H : y > H - r ? -H : 0;
    if (ox) fn(x + ox, y);
    if (oy) fn(x, y + oy);
    if (ox && oy) fn(x + ox, y + oy);
  }

  function drawStars(g) {
    for (const s of stars) {
      let x = (s.x - starScroll * s.d) % W;
      if (x < 0) x += W;
      g.fillStyle = s.d > 0.75 ? C.star3 : s.d > 0.45 ? C.star2 : C.star1;
      const len = belt && state === 'playing' ? Math.max(1, Math.round(s.d * 4)) : 1;
      g.fillRect(Math.floor(x), Math.floor(s.y), len, 1);
    }
  }

  function drawHoles(g) {
    const t = api.time;
    for (const h of holes) {
      // Infalling dust spiraling toward the horizon
      g.fillStyle = C.hole;
      for (let i = 0; i < 14; i++) {
        const phase = (t * 0.45 + i / 14) % 1;
        const rad = HOLE_HORIZON + 55 * (1 - phase);
        const a = i * 2.4 + phase * 7;
        g.globalAlpha = phase;
        g.fillRect(h.x + Math.cos(a) * rad - 1, h.y + Math.sin(a) * rad - 1, 2, 2);
      }
      g.globalAlpha = 1;
      // Accretion rings
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        const start = t * (1.5 - k * 0.4) + k * 2;
        g.arc(h.x, h.y, HOLE_HORIZON + 5 + k * 8, start, start + 3.6);
        g.globalAlpha = 1 - k * 0.3;
        glow(g, C.hole);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(h.x, h.y, HOLE_HORIZON, 0, TAU);
      g.fill();
      glow(g, '#e0c8ff');
    }
  }

  function drawRocks(g) {
    for (const r of rocks) {
      const color = r.flash > 0 ? C.white : r.kind === 'armor' ? C.armor : r.kind === 'homing' ? C.homing : C.rock;
      g.beginPath();
      forWrapped(r.x, r.y, r.r + 2, (x, y) => polyPath(g, x, y, r.pts, r.rot), !r.belt);
      glow(g, color);
      if (r.kind === 'armor') {
        g.beginPath();
        forWrapped(r.x, r.y, r.r + 2, (x, y) => polyPath(g, x, y, r.pts, r.rot, 0.55), !r.belt);
        g.strokeStyle = C.armorIn;
        g.lineWidth = 1;
        g.stroke();
      } else if (r.kind === 'homing') {
        const p = 1.5 + Math.sin(api.time * 8 + r.x) * 1;
        g.fillStyle = C.homing;
        g.fillRect(r.x - p, r.y - p, p * 2, p * 2);
      }
    }
  }

  function drawMines(g) {
    for (const m of mines) {
      const armed = m.armT >= 0;
      const blink = armed && Math.floor(api.time * (14 - m.armT * 8)) % 2 === 0;
      const color = blink ? C.white : C.mine;
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = m.spin + (i / 16) * TAU;
        const rr = i % 2 === 0 ? MINE_RADIUS + 1 : MINE_RADIUS - 3;
        const x = m.x + Math.cos(a) * rr;
        const y = m.y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      glow(g, color);
      g.fillStyle = color;
      g.fillRect(m.x - 1, m.y - 1, 2, 2);
      if (armed) {
        g.beginPath();
        g.arc(m.x, m.y, MINE_BLAST * (m.armT / MINE_FUSE) + 4, 0, TAU);
        g.globalAlpha = 0.35;
        g.strokeStyle = C.mine;
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    for (const b of blasts) {
      const k = b.t / 0.45;
      g.beginPath();
      g.arc(b.x, b.y, MINE_BLAST * (0.3 + 0.7 * k), 0, TAU);
      g.globalAlpha = 1 - k;
      glow(g, C.gold, 2);
      g.globalAlpha = 1;
    }
  }

  // Ring drone: spinning ring with a hub and three spokes that poke past the rim.
  // Crystal shard: a tumbling elongated diamond with a centre facet line.
  function dronePath(g, x, y, r, small, spin) {
    if (small) {
      const pts = [r * 1.6, 0, r * 0.2, -r * 0.7, -r * 1.1, 0, r * 0.2, r * 0.7];
      polyPath(g, x, y, pts, spin);
      g.closePath();
      polyPath(g, x, y, [r * 1.6, 0, -r * 1.1, 0], spin);
      polyPath(g, x, y, [r * 0.2, -r * 0.7, r * 0.2, r * 0.7], spin);
      return;
    }
    g.moveTo(x + r * 0.8, y);
    g.arc(x, y, r * 0.8, 0, TAU);
    g.moveTo(x + r * 0.25, y);
    g.arc(x, y, r * 0.25, 0, TAU);
    for (let i = 0; i < 3; i++) {
      const a = spin + (i / 3) * TAU, c = Math.cos(a), sn = Math.sin(a);
      g.moveTo(x + c * r * 0.25, y + sn * r * 0.25);
      g.lineTo(x + c * r * 1.15, y + sn * r * 1.15);
    }
  }
  function drawDrones(g) {
    for (const s of drones) {
      g.beginPath();
      dronePath(g, s.x, s.y, s.r, s.small, api.time * (s.small ? 5 : 2.4) + s.y);
      glow(g, s.small ? C.shard : C.drone);
    }
  }

  function drawBoss(g) {
    const b = boss;
    if (!b) return;
    const hullColor = b.dying > 0 && Math.floor(api.time * 20) % 2 ? C.white : C.boss;
    // Hub + two counter-spinning spoked rings
    g.beginPath();
    g.moveTo(b.x + BOSS_HUB_R, b.y);
    g.arc(b.x, b.y, BOSS_HUB_R, 0, TAU);
    for (const [rx, ry, rr] of BOSS_RINGS) {
      g.moveTo(b.x + rx + rr, b.y + ry);
      g.arc(b.x + rx, b.y + ry, rr, 0, TAU);
    }
    glow(g, hullColor, 1.5);
    // Truss arms, ring spokes and hub inner ring
    g.beginPath();
    for (const side of [-1, 1]) {
      const x0 = b.x + side * BOSS_HUB_R, x1 = b.x + side * 26;
      g.moveTo(x0, b.y - 3); g.lineTo(x1, b.y - 3);
      g.moveTo(x0, b.y + 3); g.lineTo(x1, b.y + 3);
      for (let k = 0; k < 3; k++) {
        const xa = x0 + side * k * 4, xb = xa + side * 4;
        g.moveTo(xa, b.y + (k % 2 ? 3 : -3)); g.lineTo(xb, b.y + (k % 2 ? -3 : 3));
      }
    }
    for (const [rx, ry, rr, dir] of BOSS_RINGS) {
      for (let i = 0; i < 4; i++) {
        const a = dir * b.t * 1.6 + (i / 4) * TAU, c = Math.cos(a), sn = Math.sin(a);
        g.moveTo(b.x + rx + c * 5.5, b.y + ry + sn * 5.5);
        g.lineTo(b.x + rx + c * rr, b.y + ry + sn * rr);
      }
    }
    g.moveTo(b.x + 11, b.y);
    g.arc(b.x, b.y, 11, 0, TAU);
    g.globalAlpha = 0.7;
    g.strokeStyle = hullColor;
    g.lineWidth = 1;
    g.stroke();
    g.globalAlpha = 1;

    // Turrets with barrels tracking the ship
    const aimA = shipActive() ? angleToShip(b.x, b.y) : Math.PI / 2;
    for (const t of b.turrets) {
      const tx = b.x + t.dx;
      const ty = b.y + t.dy;
      g.beginPath();
      if (t.hp > 0) {
        g.arc(tx, ty, 4.5, 0, TAU);
        g.moveTo(tx + Math.cos(aimA) * 4.5, ty + Math.sin(aimA) * 4.5);
        g.lineTo(tx + Math.cos(aimA) * 9, ty + Math.sin(aimA) * 9);
        glow(g, t.flash > 0 ? C.white : C.turret);
      } else {
        g.moveTo(tx - 3, ty - 3); g.lineTo(tx + 3, ty + 3);
        g.moveTo(tx + 3, ty - 3); g.lineTo(tx - 3, ty + 3);
        g.strokeStyle = C.dim;
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // Core: shielded while any turret survives
    const cy = b.y + BOSS_CORE_Y;
    const exposed = !bossTurretsAlive(b);
    const pulse = 4 + Math.sin(api.time * 10) * 1.5;
    g.fillStyle = b.flash > 0 ? C.white : C.bossCore;
    g.globalAlpha = exposed ? 1 : 0.5;
    g.beginPath();
    g.arc(b.x, cy, exposed ? pulse + 1.5 : 3, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    if (!exposed) {
      g.setLineDash([3, 3]);
      g.lineDashOffset = -api.time * 20;
      g.beginPath();
      g.arc(b.x, cy, 9, 0, TAU);
      glow(g, C.turret);
      g.setLineDash([]);
    }
  }

  function drawPowerups(g) {
    for (const p of powerups) {
      if (p.t < 2.5 && Math.floor(p.t * 8) % 2 === 0) continue;
      const def = POWERUPS[p.type];
      const s = 8 + Math.sin(api.time * 6) * 1;
      g.beginPath();
      g.moveTo(p.x, p.y - s);
      g.lineTo(p.x + s, p.y);
      g.lineTo(p.x, p.y + s);
      g.lineTo(p.x - s, p.y);
      g.closePath();
      glow(g, def.color);
      api.text(def.letter, p.x + 1, p.y - 3, { color: def.color, align: 'center' });
    }
  }

  function drawBullets(g) {
    g.fillStyle = C.bullet;
    for (const b of bullets) {
      g.globalAlpha = 0.3;
      g.fillRect(b.x - 2, b.y - 2, 4, 4);
      g.globalAlpha = 1;
      g.fillRect(b.x - 1, b.y - 1, 2, 2);
    }
    for (const b of ebullets) {
      const p = Math.floor(api.time * 12) % 2;
      g.fillStyle = C.ebullet;
      g.globalAlpha = 0.35;
      g.fillRect(b.x - 3, b.y - 3, 6, 6);
      g.globalAlpha = 1;
      g.fillStyle = p ? C.white : C.ebullet;
      g.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
    }
  }

  function drawShip(g) {
    const s = ship;
    if (s.dead || s.warpT > 0) {
      // Warp destination shimmer
      if (!s.dead && s.warpT > 0) {
        const k = 1 - s.warpT / WARP_TIME;
        g.beginPath();
        g.arc(s.hx, s.hy, 14 * (1 - k) + 2, 0, TAU);
        g.globalAlpha = k;
        glow(g, C.accent);
        g.globalAlpha = 1;
      }
      return;
    }
    if (s.invuln > 0 && Math.floor(s.invuln * 10) % 2 === 0) return;
    forWrapped(s.x, s.y, 12, (x, y) => {
      g.beginPath();
      polyPath(g, x, y, SHIP_PTS, s.a);
      g.closePath();
      const wx = x + Math.cos(s.a) * SHIP_WINDOW[0], wy = y + Math.sin(s.a) * SHIP_WINDOW[0];
      g.moveTo(wx + 1.6, wy);
      g.arc(wx, wy, 1.6, 0, TAU);
      glow(g, C.ship);
      if (s.thrusting && api.frame % 3 !== 0) {
        const len = rand(5, 11);
        g.beginPath();
        polyPath(g, x, y, [-5, -2, -5 - len, 0, -5, 2], s.a);
        glow(g, chance(0.5) ? C.flame : C.flame2);
      }
      if (s.shield > 0 && (s.shield > 2 || Math.floor(s.shield * 8) % 2 === 0)) {
        g.beginPath();
        g.arc(x, y, 12 + Math.sin(api.time * 9), 0, TAU);
        g.globalAlpha = 0.8;
        glow(g, C.shield);
        g.globalAlpha = 1;
      }
    });
  }

  function drawParticles(g) {
    for (const p of particles) {
      g.globalAlpha = clamp(p.life / p.max, 0, 1);
      if (p.len > 0) {
        const c = Math.cos(p.ang) * p.len * 0.5;
        const s = Math.sin(p.ang) * p.len * 0.5;
        g.beginPath();
        g.moveTo(p.x - c, p.y - s);
        g.lineTo(p.x + c, p.y + s);
        g.strokeStyle = p.color;
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.fillStyle = p.color;
        g.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5);
      }
    }
    g.globalAlpha = 1;
    for (const p of popups) {
      g.globalAlpha = clamp(p.t * 2, 0, 1);
      api.text(p.text, p.x, p.y, { color: p.color, align: 'center' });
    }
    g.globalAlpha = 1;
  }

  function drawLifeIcon(g, x, y) {
    g.beginPath();
    polyPath(g, x, y, SHIP_PTS, -Math.PI / 2, 0.6);
    g.strokeStyle = C.ship;
    g.lineWidth = 1;
    g.stroke();
  }

  function drawHUD(g) {
    api.text(pad(score, 6), 4, 4, { color: C.white, shadow: '#1a237e' });
    api.text('HI ' + pad(Math.max(hiScore, score), 6), W / 2, 4, { color: C.dim, align: 'center' });
    for (let i = 0; i < lives; i++) drawLifeIcon(g, W - 8 - i * 9, 8);
    api.text('SECTOR ' + pad(level + 1, 2), 4, H - 11, { color: C.dim });

    // Active power-up timers
    let y = H - 11;
    for (const key of ['shield', 'rapid', 'spread']) {
      const t = ship.dead ? 0 : ship[key];
      if (t <= 0) continue;
      const def = POWERUPS[key];
      api.text(def.name + ' ' + Math.ceil(t), W - 4, y, { color: def.color, align: 'right' });
      y -= 9;
    }

    if (belt) {
      const k = 1 - belt.t / belt.cfg.time;
      const bw = 100;
      const bx = W / 2 - bw / 2;
      api.text(belt.t > 0 ? 'DISTANCE' : 'CLEAR THE STRAGGLERS', W / 2, H - 20, { color: C.dim, align: 'center' });
      g.strokeStyle = C.dim;
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, H - 10.5, bw, 5);
      g.fillStyle = C.accent;
      g.fillRect(bx + 1.5, H - 9.5, (bw - 2) * k, 3);
    }
    if (boss) {
      const bw = 120;
      const bx = W / 2 - bw / 2;
      g.strokeStyle = C.boss;
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, 15.5, bw, 5);
      g.fillStyle = C.bossCore;
      g.fillRect(bx + 1.5, 16.5, (bw - 2) * bossHpFrac(boss), 3);
    }
  }

  function drawBanner(g) {
    if (bannerT <= 0) return;
    const cfg = LEVELS[level];
    const a = clamp(bannerT / 0.5, 0, 1);
    g.globalAlpha = a;
    api.text('SECTOR ' + pad(level + 1, 2), W / 2, 50, { color: C.accent, scale: 2, align: 'center', shadow: '#1a237e' });
    api.text(cfg.name, W / 2, 70, { color: cfg.boss ? C.bossCore : C.white, align: 'center' });
    api.text(cfg.hint, W / 2, 81, { color: C.dim, align: 'center' });
    g.globalAlpha = 1;
  }

  function dim(g, alpha) {
    g.globalAlpha = alpha;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }

  function drawTitle(g) {
    const t = api.time;
    // Glowing logo
    api.text('ROCKS', W / 2 + 1, 41, { color: '#1a237e', scale: 4, align: 'center' });
    api.text('ROCKS', W / 2, 40, { color: C.accent, scale: 4, align: 'center', shadow: '#3949ab' });
    // A little demo ship orbiting under the logo
    const a = t * 1.2;
    const sx = W / 2 + Math.cos(a) * 60;
    const sy = 92 + Math.sin(a) * 10;
    g.beginPath();
    polyPath(g, sx, sy, SHIP_PTS, a + Math.PI / 2);
    glow(g, C.ship);

    api.text('20 SECTORS OF ROCKS, DRONES AND WORSE', W / 2, 114, { color: C.dim, align: 'center' });
    api.text('LEFT/RIGHT TURN   UP THRUST', W / 2, 134, { color: C.white, align: 'center' });
    api.text('J FIRE   K WARP   START PAUSE', W / 2, 144, { color: C.white, align: 'center' });

    const cfg = LEVELS[selSector - 1];
    const canL = selSector > 1;
    const canR = selSector < maxSector;
    api.text((canL ? '< ' : '  ') + 'SECTOR ' + pad(selSector, 2) + (canR ? ' >' : '  '), W / 2, 166,
      { color: C.gold, align: 'center' });
    api.text(cfg.name, W / 2, 176, { color: C.accent, align: 'center' });
    if (Math.floor(t * 2) % 2 === 0) api.text('PRESS START', W / 2, 198, { color: C.white, scale: 2, align: 'center' });
    api.text('HI ' + pad(hiScore, 6), W / 2, 226, { color: C.dim, align: 'center' });
  }

  function drawPause(g) {
    dim(g, 0.6);
    api.text('PAUSED', W / 2, 92, { color: C.white, scale: 3, align: 'center', shadow: '#3949ab' });
    api.text('SECTOR ' + pad(level + 1, 2) + '  ' + LEVELS[level].name, W / 2, 124, { color: C.accent, align: 'center' });
    api.text('START  RESUME', W / 2, 146, { color: C.white, align: 'center' });
    api.text('SELECT QUIT TO TITLE', W / 2, 158, { color: C.dim, align: 'center' });
  }

  function drawLevelClear(g) {
    const k = clamp(stateT * 3, 0, 1);
    g.globalAlpha = k;
    api.text('SECTOR ' + pad(level + 1, 2) + ' CLEAR', W / 2, 56, { color: C.gold, scale: 2, align: 'center', shadow: '#5d4300' });
    api.text('BONUS ' + clearBonus, W / 2, 78, { color: C.white, align: 'center' });
    const next = LEVELS[level + 1];
    if (next && stateT > 1) api.text('NEXT: ' + next.name, W / 2, 90, { color: C.dim, align: 'center' });
    g.globalAlpha = 1;
  }

  function drawGameOver(g) {
    const won = state === 'victory';
    dim(g, won ? 0.25 : 0.5);
    if (won) {
      api.text('VICTORY', W / 2, 56, { color: C.gold, scale: 4, align: 'center', shadow: '#5d4300' });
      api.text('THE STATION FLEET IS DUST', W / 2, 96, { color: C.accent, align: 'center' });
    } else {
      api.text('GAME OVER', W / 2, 56, { color: C.warn, scale: 4, align: 'center', shadow: '#4a0000' });
      api.text('LOST IN SECTOR ' + pad(level + 1, 2) + ' - ' + LEVELS[level].name, W / 2, 96, { color: C.accent, align: 'center' });
    }
    api.text('SCORE ' + pad(score, 6), W / 2, 120, { color: C.white, scale: 2, align: 'center' });
    if (newHigh && Math.floor(api.time * 4) % 2 === 0) api.text('NEW HIGH SCORE!', W / 2, 144, { color: C.gold, align: 'center' });
    else api.text('HI ' + pad(hiScore, 6), W / 2, 144, { color: C.dim, align: 'center' });
    if (stateT > 1.2) api.text('PRESS START', W / 2, 180, { color: C.white, align: 'center' });
  }

  // ==========================================================================
  // MAIN LOOP
  // ==========================================================================
  enterTitle();

  return {
    update(input) {
      stateT += DT;
      shake *= 0.88;
      if (shake < 0.2) shake = 0;
      flashT = Math.max(0, flashT - DT);
      if (!belt) starScroll += 3 * DT;
      if (state === 'title') updateTitle(input);
      else if (state === 'playing') updatePlaying(input);
      else if (state === 'paused') updatePaused(input);
      else if (state === 'levelClear') updateLevelClear(input);
      else updateGameOver(input);
    },

    draw(g) {
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      g.lineJoin = 'round';
      g.lineCap = 'round';

      g.save();
      if (shake > 0 && state !== 'paused') {
        g.translate(Math.round(rand(-shake, shake)), Math.round(rand(-shake, shake)));
      }
      drawStars(g);
      drawHoles(g);
      drawMines(g);
      drawRocks(g);
      drawPowerups(g);
      drawDrones(g);
      drawBoss(g);
      drawBullets(g);
      if (state === 'playing' || state === 'paused' || state === 'levelClear') drawShip(g);
      drawParticles(g);
      g.restore();

      if (flashT > 0) {
        g.globalAlpha = clamp(flashT * 1.2, 0, 0.35);
        g.fillStyle = flashColor;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }

      if (state === 'title') {
        drawTitle(g);
        return;
      }
      if (state === 'gameOver' || state === 'victory') {
        drawGameOver(g);
        return;
      }
      drawHUD(g);
      if (state === 'playing') drawBanner(g);
      if (state === 'levelClear') drawLevelClear(g);
      if (state === 'paused') drawPause(g);
    },
  };
}
