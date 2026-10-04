// The 3D scene: a desk with a CRT TV, a two-slot console, and a rack of cartridges.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeTextRenderer } from './runtime/core.js';

export interface CartInfo { id: string; title: string; color: string; accent: string; tagline: string }
export type PadButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';

const DESK_Y = 0.76;
/** ?lowfi: for headless/software-GL testing — 1x pixels and a large max timestep so animations complete at ~1 fps. */
const LOWFI = new URLSearchParams(location.search).has('lowfi');
const CART_W = 0.13, CART_H = 0.15, CART_D = 0.024;
const SLOT_SINK = 0.062; // how far an inserted cartridge sinks into the console

// ---------------------------------------------------------------- CRT shader
const crtVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const crtFragment = /* glsl */ `
uniform sampler2D tex;
uniform float uTime, uPower, uStatic, uFlash, uPicture;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 curve(vec2 uv, float k) { uv = uv * 2.0 - 1.0; vec2 o = abs(uv.yx) / vec2(5.5, 4.5); uv += uv * o * o * k; return uv * 0.5 + 0.5; }
void main() {
  float k = uPicture * 1.6; // PICTURE knob: 0 = clean, 0.625 = classic, 1 = heavy
  vec2 uv = curve(vUv, k);
  vec3 off = vec3(0.012, 0.014, 0.018);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // power on/off: a bright line that opens vertically
  float sx = smoothstep(0.0, 0.3, uPower);
  float sy = mix(0.006, 1.0, smoothstep(0.3, 1.0, uPower));
  vec2 c = uv - 0.5;
  if (uPower <= 0.001 || abs(c.x) > 0.5 * sx || abs(c.y) > 0.5 * sy) { gl_FragColor = vec4(off, 1.0); return; }
  vec2 suv = vec2(c.x / max(sx, 0.001), c.y / sy) + 0.5;
  // slight chromatic aberration
  float ca = 0.0012 * k;
  vec3 col;
  col.r = texture2D(tex, suv + vec2(ca, 0.0)).r;
  col.g = texture2D(tex, suv).g;
  col.b = texture2D(tex, suv - vec2(ca, 0.0)).b;
  // scanlines (240 lines) + aperture mask
  float sd = min(0.28 * k, 0.5);
  float scan = 1.0 - sd + sd * pow(sin(suv.y * 240.0 * 3.14159), 2.0);
  col *= scan;
  float m = mod(floor(vUv.x * 960.0), 3.0);
  float hi = 1.0 + 0.08 * k, lo = 1.0 - 0.06 * k;
  col *= vec3(m == 0.0 ? hi : lo, m == 1.0 ? hi : lo, m == 2.0 ? hi : lo);
  // static
  float n = hash(floor(suv * vec2(320.0, 240.0)) + fract(uTime) * 91.0);
  col = mix(col, vec3(n), uStatic);
  // rolling bright band + flicker
  col *= 1.0 + (0.04 * sin(suv.y * 6.0 - uTime * 3.0) + 0.015 * sin(uTime * 60.0)) * k;
  // vignette
  float v = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.22 * max(k, 0.35));
  col *= v;
  col += (1.0 - sy) * 1.5 + uFlash;
  col = max(col, off * 0.6);
  col += vec3(0.05) * smoothstep(0.35, 0.0, length(vUv - vec2(0.22, 0.82))); // glass glint
  // gentle boost for mid-tones, then a soft knee so whites do not blow out into the bloom pass
  col *= 1.12;
  col = col - max(col - 0.8, 0.0) * 0.65;
  gl_FragColor = vec4(min(col, vec3(0.95)), 1.0);
}`;

// ---------------------------------------------------------------- helpers
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function woodTexture() {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = '#6b4226';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 180; i++) {
      const y = Math.random() * 512;
      g.strokeStyle = `rgba(${40 + Math.random() * 30},${20 + Math.random() * 15},10,${0.15 + Math.random() * 0.25})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 70 + i) * 4);
      g.stroke();
    }
  });
}

function wallTexture() {
  const t = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#1f2b2e';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 12, 256);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 3);
  return t;
}

/** Procedural icon per cartridge, drawn in 16x12 "pixels" on the label. */
function drawIcon(g: CanvasRenderingContext2D, id: string, x: number, y: number, px: number, fg: string) {
  const P = (cx: number, cy: number, w = 1, h = 1) => g.fillRect(x + cx * px, y + cy * px, w * px, h * px);
  g.fillStyle = fg;
  switch (id) {
    case 'snake': P(1, 8, 9); P(9, 3, 1, 6); P(9, 3, 5); P(13, 3, 1, 3); g.fillStyle = '#e53935'; P(4, 3, 2, 2); break;
    case 'pong': P(1, 2, 1, 5); P(14, 5, 1, 5); P(7, 6, 2, 2); for (let i = 0; i < 12; i += 2) P(7.5, i, 1, 1); break;
    case 'chess': P(5, 10, 6); P(6, 9, 4); P(6, 4, 4, 5); P(5, 2, 4, 2); P(8, 1, 2, 2); P(4, 3, 2, 2); break;
    case 'breakout': for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) P(c * 3 + 0.5, r * 1.5, 2.5, 1); P(6, 10, 4, 1); P(9, 6, 1, 1); break;
    case 'asteroids': P(3, 2, 3, 3); P(11, 7, 4, 3); P(6, 8, 2, 2); P(9, 3, 1, 1); P(10, 2, 1, 3); P(11, 3, 1, 1); break;
    case 'blocks': P(0, 10, 16, 2); P(7, 4, 1, 6); P(4, 3, 3, 2); P(8, 2, 3, 2); g.fillStyle = '#ffd34d'; P(11, 6, 2, 2); P(3, 7, 2, 2); break;
    case 'flappy': P(3, 5, 6, 2); P(9, 4, 2, 2); P(0, 4, 3, 1); P(0, 7, 3, 1); P(5, 3, 2, 2); g.fillStyle = '#e8643c'; P(11, 5, 1, 1); g.fillStyle = '#8a7f9e'; P(13, 0, 2, 3); P(14, 3, 1, 1); P(13, 9, 2, 3); P(14, 8, 1, 1); break;
    case 'jumper': P(0, 11, 16); P(3, 2, 2, 1); P(3, 3, 3, 3); P(2, 6, 1, 2); P(5, 6, 1, 2); P(12, 4, 3, 7); g.fillStyle = '#000'; P(13, 6, 1, 4); break;
    default: P(4, 3, 8, 6);
  }
}

function labelTexture(c: CartInfo) {
  return canvasTexture(256, 296, (g) => {
    const t = makeTextRenderer(() => g);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1b1b1f';
    g.fillRect(0, 0, 256, 296);
    g.fillStyle = c.color;
    g.fillRect(10, 10, 236, 276);
    // diagonal stripes
    g.save();
    g.beginPath(); g.rect(10, 10, 236, 276); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = -300; i < 300; i += 28) { g.beginPath(); g.moveTo(i, 296); g.lineTo(i + 14, 296); g.lineTo(i + 310, 0); g.lineTo(i + 296, 0); g.fill(); }
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(24, 40, 208, 156);
    drawIcon(g, c.id, 40, 54, 11, c.accent);
    const words = c.title.split(' ');
    const scale = c.title.length > 9 ? 3 : 4;
    words.forEach((w, i) => t.text(w, 128, 208 + i * (scale * 8 + 2) - (words.length - 1) * 8, { scale, align: 'center', color: '#fff', shadow: '#000' }));
    t.text('DIGI-FUZE', 128, 20, { scale: 2, align: 'center', color: '#fff', shadow: '#000' });
  });
}

// ---------------------------------------------------------------- world
export interface Slot { index: number; pos: THREE.Vector3; cart: Cartridge | null; glow: THREE.Mesh }

export interface Cartridge {
  info: CartInfo;
  group: THREE.Group;
  home: THREE.Vector3;
  slot: Slot | null;
  anim: { from: THREE.Vector3; to: THREE.Vector3; via?: THREE.Vector3; t: number; dur: number; done?: () => void } | null;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  readonly screenTex: THREE.CanvasTexture;
  readonly crt: THREE.ShaderMaterial;
  readonly slots: Slot[] = [];
  readonly carts: Cartridge[] = [];
  private powerLed!: THREE.MeshStandardMaterial;
  private remixLed!: THREE.MeshStandardMaterial;
  private screenMesh!: THREE.Mesh;
  power = 0;           // animated 0..1
  powerTarget = 0;
  remixing = false;
  focus = 0;           // 0 = desk view, 1 = TV close-up (animated)
  focusTarget = 0;
  private timer = new THREE.Timer();

  // drag state
  private raycaster = new THREE.Raycaster();
  private dragging: Cartridge | null = null;
  private dragStart = new THREE.Vector2();
  private dragMoved = false;
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(DESK_Y + 0.2));
  private hoverSlot: Slot | null = null;
  // TV knobs: 0 = VOLUME, 1 = PICTURE. Values are 0..1; the pivots rotate toward them each frame.
  readonly knobValues = [0.6, 0.625];
  private knobPivots: THREE.Group[] = [];
  private knobDrag: { i: number; x: number; y: number; v: number; moved: boolean } | null = null;
  onKnob: (i: number, value: number) => void = () => {};
  // Gamepad on the desk: mirrors the keyboard and can be clicked.
  private padParts = new Map<PadButton, { mesh: THREE.Object3D; mat: THREE.MeshStandardMaterial; rest: number; amount: number }>();
  private dpad!: THREE.Group;
  private padHeld: Partial<Record<PadButton, boolean>> = {};
  private padPointer: PadButton | null = null;
  onPadButton: (b: PadButton, down: boolean) => void = () => {};
  onInsert: (slot: number, cart: CartInfo) => void = () => {};
  onEject: (slot: number, cart: CartInfo) => void = () => {};
  onScreenClick: () => void = () => {};

  constructor(private container: HTMLElement, screenCanvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(LOWFI ? 1 : Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.scene.background = new THREE.Color('#0f1517');
    this.scene.fog = new THREE.Fog('#0f1517', 6, 14);

    this.screenTex = new THREE.CanvasTexture(screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.magFilter = THREE.NearestFilter;
    this.screenTex.minFilter = THREE.LinearFilter;
    this.screenTex.generateMipmaps = false;
    this.crt = new THREE.ShaderMaterial({
      uniforms: { tex: { value: this.screenTex }, uTime: { value: 0 }, uPower: { value: 0 }, uStatic: { value: 0 }, uFlash: { value: 0 }, uPicture: { value: 0.625 } },
      vertexShader: crtVertex,
      fragmentShader: crtFragment,
      toneMapped: false,
    });

    this.buildRoom();
    this.buildTv();
    this.buildConsole();
    this.buildGamepad();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    this.resize();
    this.bindPointer();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ building
  private buildRoom() {
    const s = this.scene;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#2a1f1c', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 }));
    wall.position.set(0, 3, -1.2);
    wall.receiveShadow = true;
    s.add(wall);

    // desk
    const wood = woodTexture();
    const deskMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.0 });
    const top = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.06, 1.5, 3, 0.012), deskMat);
    top.position.set(0, DESK_Y - 0.03, -0.25);
    top.receiveShadow = true;
    top.castShadow = true;
    s.add(top);
    const legMat = new THREE.MeshStandardMaterial({ color: '#3b2416', roughness: 0.7 });
    for (const [x, z] of [[-1.6, 0.4], [1.6, 0.4], [-1.6, -0.9], [1.6, -0.9]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, DESK_Y - 0.06, 0.07), legMat);
      leg.position.set(x, (DESK_Y - 0.06) / 2, z);
      leg.castShadow = true;
      s.add(leg);
    }

    // cartridge rack (left side of desk)
    const rack = new THREE.Mesh(new RoundedBoxGeometry(1.24, 0.03, 0.12, 2, 0.008), new THREE.MeshStandardMaterial({ color: '#222228', roughness: 0.6 }));
    rack.position.set(-0.98, DESK_Y + 0.015, 0.22);
    rack.castShadow = rack.receiveShadow = true;
    s.add(rack);

    // lights
    s.add(new THREE.HemisphereLight('#8fc6cf', '#2a1a12', 0.35));
    const lamp = new THREE.SpotLight('#ffd9a8', 18, 8, 0.8, 0.6, 1.6);
    lamp.position.set(-1.6, 2.9, 1.4);
    lamp.target.position.set(-0.2, DESK_Y, -0.1);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    s.add(lamp, lamp.target);
    const rim = new THREE.PointLight('#3fb0bd', 6, 5, 1.8);
    rim.position.set(1.8, 1.8, -0.8);
    s.add(rim);
    // screen glow onto the desk
    const glow = new THREE.PointLight('#9fc4ff', 0, 0.9, 2);
    glow.position.set(-0.02, DESK_Y + 0.32, 0.3);
    glow.name = 'screenGlow';
    s.add(glow);

    // wall poster
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.85), new THREE.MeshStandardMaterial({
      roughness: 0.8,
      map: canvasTexture(240, 340, (g) => {
        const t = makeTextRenderer(() => g);
        const grd = g.createLinearGradient(0, 0, 0, 340);
        grd.addColorStop(0, '#ffb347'); grd.addColorStop(0.6, '#e8553d'); grd.addColorStop(1, '#2a1410');
        g.fillStyle = grd; g.fillRect(0, 0, 240, 340);
        g.fillStyle = '#ffe066'; g.beginPath(); g.arc(120, 150, 60, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#2a1410'; for (let i = 0; i < 6; i++) g.fillRect(50, 140 + i * 12, 140, 3 + i);
        t.text('DIGI-FUZE', 120, 30, { scale: 4, align: 'center', color: '#fff', shadow: '#000' });
        t.text('ANY TWO GAMES', 120, 250, { scale: 2, align: 'center', color: '#fff' });
        t.text('ONE NEW GAME', 120, 272, { scale: 2, align: 'center', color: '#ffe066' });
      }),
    }));
    poster.position.set(-1.25, 1.75, -1.19);
    s.add(poster);
  }

  private buildTv() {
    const tv = new THREE.Group();
    tv.position.set(0.05, DESK_Y, -0.38);
    this.scene.add(tv);
    const W = 0.86, H = 0.66, D = 0.62;
    const shell = new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#b98a5e', roughness: 0.5, metalness: 0.0 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1c1b1f', roughness: 0.5 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.05), shell);
    body.position.set(0, H / 2 + 0.03, 0);
    body.castShadow = body.receiveShadow = true;
    tv.add(body);
    // back hump
    const hump = new THREE.Mesh(new RoundedBoxGeometry(W * 0.7, H * 0.75, 0.3, 3, 0.05), shell);
    hump.position.set(0, H * 0.45, -D / 2 - 0.1);
    hump.castShadow = true;
    tv.add(hump);
    // feet
    for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.4), dark);
      f.position.set(x, 0.015, 0);
      tv.add(f);
    }
    // bezel
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.53, 0.04, 4, 0.03), dark);
    bezel.position.set(-0.07, H / 2 + 0.05, D / 2 - 0.005);
    tv.add(bezel);
    // curved screen
    const sw = 0.6, sh = 0.45;
    const geo = new THREE.PlaneGeometry(sw, sh, 40, 30);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / (sw / 2), y = p.getY(i) / (sh / 2);
      p.setZ(i, 0.03 * (1 - 0.5 * (x * x + y * y)));
    }
    geo.computeVertexNormals();
    this.screenMesh = new THREE.Mesh(geo, this.crt);
    this.screenMesh.position.set(-0.07, H / 2 + 0.05, D / 2 + 0.012);
    tv.add(this.screenMesh);
    // side panel: knobs + speaker grille
    const panelX = W / 2 - 0.09;
    for (const [i, y] of [[0, 0.5], [1, 0.38]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(panelX, y, D / 2 + 0.012);
      pivot.userData.knob = i;
      tv.add(pivot);
      this.knobPivots.push(pivot);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.03, 24), dark);
      knob.rotation.x = Math.PI / 2;
      knob.name = `knob${i}`;
      pivot.add(knob);
      // ridges around the rim make the knob read as grippable and show it turning
      for (let r = 0; r < 12; r++) {
        const a = (r / 12) * Math.PI * 2;
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.026, 0.004), dark);
        ridge.position.set(Math.cos(a) * 0.034, 0, Math.sin(a) * 0.034);
        ridge.rotation.y = -a;
        knob.add(ridge);
      }
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.02), new THREE.MeshStandardMaterial({
        transparent: true,
        map: canvasTexture(180, 40, (g) => { makeTextRenderer(() => g).text(i ? 'PICTURE' : 'VOLUME', 90, 12, { scale: 3, align: 'center', color: '#e8dcc4' }); }),
      }));
      label.position.set(panelX, y - 0.052, D / 2 + 0.002);
      tv.add(label);
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.006), new THREE.MeshStandardMaterial({ color: '#ddd' }));
      tick.position.set(0, 0.016, 0.0);
      tick.rotation.x = -Math.PI / 2;
      knob.add(tick);
    }
    for (let i = 0; i < 7; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.006), dark);
      slat.position.set(panelX, 0.13 + i * 0.022, D / 2 + 0.003);
      tv.add(slat);
    }
    // antenna
    const metal = new THREE.MeshStandardMaterial({ color: '#77777f', metalness: 0.8, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
    base.position.set(0, H + 0.03, -0.05);
    tv.add(base);
    for (const a of [-0.5, 0.42]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.55, 8), metal);
      rod.position.set(Math.sin(a) * 0.27, H + 0.03 + Math.cos(a) * 0.27, -0.05);
      rod.rotation.z = -a;
      tv.add(rod);
    }
  }

  private buildConsole() {
    const con = new THREE.Group();
    con.position.set(0.72, DESK_Y, 0.2);
    con.rotation.y = -0.18;
    this.scene.add(con);
    const W = 0.46, H = 0.085, D = 0.32;
    // same family as the gamepad: warm beige body, orange stripe, teal accents
    const shell = new THREE.MeshStandardMaterial({ color: '#bfa776', roughness: 0.85 });
    const top = new THREE.MeshStandardMaterial({ color: '#a89064', roughness: 0.85 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.02), shell);
    body.position.y = H / 2;
    body.castShadow = body.receiveShadow = true;
    con.add(body);
    const ridge = new THREE.Mesh(new RoundedBoxGeometry(W - 0.04, 0.03, D - 0.08, 3, 0.01), top);
    ridge.position.set(0, H + 0.01, -0.01);
    ridge.castShadow = true;
    con.add(ridge);
    // orange stripe (matches the gamepad trim)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, 0.012, D + 0.002), new THREE.MeshStandardMaterial({ color: '#e8553d', roughness: 0.4 }));
    stripe.position.y = H * 0.45;
    con.add(stripe);

    // two slots
    const slotMat = new THREE.MeshStandardMaterial({ color: '#241c12', roughness: 0.9 });
    [-0.105, 0.105].forEach((x, i) => {
      const hole = new THREE.Mesh(new THREE.BoxGeometry(CART_W + 0.016, 0.004, CART_D + 0.014), slotMat);
      hole.position.set(x, H + 0.026, -0.02);
      con.add(hole);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(CART_W + 0.03, 0.002, CART_D + 0.03), new THREE.MeshBasicMaterial({ color: '#7dff9b', transparent: true, opacity: 0 }));
      glow.position.set(x, H + 0.027, -0.02);
      con.add(glow);
      // slot number (1/2, so slots never get confused with the A/B buttons)
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshStandardMaterial({
        transparent: true, roughness: 0.8,
        map: canvasTexture(32, 32, (g) => { makeTextRenderer(() => g).text(i ? '2' : '1', 16, 6, { scale: 3, align: 'center', color: '#1f7f73' }); }),
      }));
      lbl.rotation.x = -Math.PI / 2;
      lbl.position.set(x, H + 0.026, 0.06);
      con.add(lbl);
      const world = new THREE.Vector3(x, H + 0.026, -0.02);
      con.updateMatrixWorld(true);
      con.localToWorld(world);
      this.slots.push({ index: i, pos: world, cart: null, glow });
    });
    // LEDs + label on the front
    this.powerLed = new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff2020', emissiveIntensity: 0 });
    this.remixLed = new THREE.MeshStandardMaterial({ color: '#320', emissive: '#ff9a30', emissiveIntensity: 0 });
    [[this.powerLed, -0.16], [this.remixLed, -0.12]].forEach(([m, x]) => {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), m as THREE.Material);
      led.position.set(x as number, H * 0.7, D / 2 + 0.001);
      con.add(led);
    });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.03), new THREE.MeshStandardMaterial({
      transparent: true, roughness: 0.8,
      map: canvasTexture(256, 36, (g) => { makeTextRenderer(() => g).text('DIGI-FUZE', 128, 6, { scale: 3, align: 'center', color: '#231c13' }); }),
    }));
    front.position.set(0.08, H * 0.7, D / 2 + 0.002);
    con.add(front);

    // cable from console to TV
    const pts = [
      new THREE.Vector3(0.62, DESK_Y + 0.03, 0.03), new THREE.Vector3(0.52, DESK_Y + 0.005, -0.1),
      new THREE.Vector3(0.45, DESK_Y + 0.005, -0.5), new THREE.Vector3(0.25, DESK_Y + 0.15, -0.8),
    ];
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.006, 8), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }));
    cable.castShadow = true;
    this.scene.add(cable);
  }

  /** A chunky, original-looking gamepad with every input labeled with its button name and keyboard keys. */
  private buildGamepad() {
    const PW = 0.25, PD = 0.11, PH = 0.024;
    // The holder pivots on the pad's front edge, which rests on the desk; a little stand props the back up
    // so the pad tilts toward the viewer and its labels are readable.
    const TILT = 0.32, SCALE = 1.7;
    const holder = new THREE.Group();
    holder.position.set(0.12, DESK_Y, 0.44);
    holder.rotation.y = -0.06;
    this.scene.add(holder);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(PW * 0.5 * SCALE, PD * SCALE * Math.sin(TILT), 0.02), new THREE.MeshStandardMaterial({ color: '#1a1a1f', roughness: 0.7 }));
    stand.position.set(0, (PD / 2) * SCALE * Math.sin(TILT), -PD * SCALE * Math.cos(TILT) + 0.018);
    stand.castShadow = stand.receiveShadow = true;
    holder.add(stand);
    const tilted = new THREE.Group();
    tilted.rotation.x = TILT;
    tilted.scale.setScalar(SCALE);
    holder.add(tilted);
    const pad = new THREE.Group();
    pad.position.z = -PD / 2;
    tilted.add(pad);
    // simple rounded slab in warm cream with the console's orange stripe
    const shell = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PD, 4, 0.018), new THREE.MeshStandardMaterial({ color: '#bfa776', roughness: 0.9 }));
    shell.position.y = PH / 2;
    shell.castShadow = shell.receiveShadow = true;
    pad.add(shell);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.03, 0.006, 0.004), new THREE.MeshStandardMaterial({ color: '#e8553d', roughness: 0.4 }));
    trim.position.set(0, PH * 0.5, PD / 2 + 0.0005);
    pad.add(trim);
    const top = PH + 0.0005;

    // Printed faceplate: button names + keyboard hints. Layout is in pad-local meters (x right, z toward the player).
    const DP = { x: -0.075, z: 0.0 }, A = { x: 0.088, z: -0.006 }, B = { x: 0.056, z: 0.014 };
    const SEL = { x: -0.016, z: 0.012 }, STA = { x: 0.016, z: 0.012 };
    const FW = PW - 0.02, FD = PD - 0.02, PX = 4000; // faceplate size and texture pixels per meter
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({
      transparent: true, roughness: 0.6,
      map: canvasTexture(FW * PX, FD * PX, (g) => {
        const t = makeTextRenderer(() => g);
        const at = (x: number, z: number) => [(x + FW / 2) * PX, (z + FD / 2) * PX];
        const label = (s: string, x: number, z: number, color: string, scale: number) => {
          const [cx, cy] = at(x, z);
          t.text(s, cx, cy - (7 * scale) / 2, { scale, align: 'center', color });
        };
        g.fillStyle = '#b89e68';
        const [dx, dy] = at(DP.x, DP.z);
        g.beginPath(); g.arc(dx, dy, 0.03 * PX, 0, Math.PI * 2); g.fill();
        const [ax, ay] = at((A.x + B.x) / 2, (A.z + B.z) / 2);
        g.beginPath(); g.ellipse(ax, ay, 0.034 * PX, 0.022 * PX, -0.55, 0, Math.PI * 2); g.fill();
        label('ARROWS / WASD', DP.x, DP.z + 0.037, '#231c13', 3);
        label('J', A.x + 0.019, A.z, '#c2452a', 5);
        label('K', B.x - 0.02, B.z - 0.004, '#1f7f73', 5);
        label('SELECT', SEL.x, SEL.z + 0.011, '#231c13', 2);
        label('SHIFT', SEL.x, SEL.z + 0.019, '#5a4a33', 2);
        label('START', STA.x, STA.z + 0.011, '#231c13', 2);
        label('ENTER', STA.x, STA.z + 0.019, '#5a4a33', 2);
        label('DIGI-FUZE', 0, -0.03, '#e8553d', 4);
      }),
    }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = top;
    pad.add(plate);

    const part = (b: PadButton, mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial, parent: THREE.Object3D) => {
      mesh.userData.padButton = b;
      mesh.castShadow = true;
      parent.add(mesh);
      this.padParts.set(b, { mesh, mat, rest: mesh.position.y, amount: 0 });
    };
    // D-pad: one rocking cross; each arm is its own pick target
    this.dpad = new THREE.Group();
    this.dpad.position.set(DP.x, top, DP.z);
    pad.add(this.dpad);
    const dmat = new THREE.MeshStandardMaterial({ color: '#1f1f24', roughness: 0.5, emissive: '#7dff9b', emissiveIntensity: 0 });
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.016), dmat);
    center.position.y = 0.004;
    this.dpad.add(center);
    const arms: [PadButton, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
    for (const [b, sx, sz] of arms) {
      const m = dmat.clone();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.016), m);
      arm.position.set(sx * 0.016, 0.004, sz * 0.016);
      part(b, arm, m, this.dpad);
    }
    // round A/B buttons
    for (const [b, p, color, glow] of [['a', A, '#e8553d', '#ffb347'], ['b', B, '#2a9d8f', '#7dffe8']] as [PadButton, { x: number; z: number }, string, string][]) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, emissive: glow, emissiveIntensity: 0 });
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0125, 0.01, 24), m);
      btn.position.set(p.x, top + 0.004, p.z);
      part(b, btn, m, pad);
    }
    // pill-shaped SELECT / START
    for (const [b, p] of [['select', SEL], ['start', STA]] as [PadButton, { x: number; z: number }][]) {
      const m = new THREE.MeshStandardMaterial({ color: '#3e3529', roughness: 0.5, emissive: '#7dff9b', emissiveIntensity: 0 });
      const btn = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.006, 0.008, 2, 0.003), m);
      btn.position.set(p.x, top + 0.002, p.z);
      btn.rotation.y = 0.5;
      part(b, btn, m, pad);
    }

    // cable from the back of the pad, wandering across the desk to the console
    holder.updateMatrixWorld(true);
    const start = pad.localToWorld(new THREE.Vector3(0, PH / 2, -PD / 2));
    const pts = [start, new THREE.Vector3(start.x + 0.05, DESK_Y + 0.006, start.z - 0.08)];
    for (let i = 0; i < 5; i++) pts.push(new THREE.Vector3(start.x + 0.12 + i * 0.045 + Math.sin(i * 2.1) * 0.02, DESK_Y + 0.006, start.z - 0.12 + Math.cos(i * 1.7) * 0.03));
    pts.push(new THREE.Vector3(0.52, DESK_Y + 0.03, 0.31));
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.004, 6), new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.6 }));
    cable.castShadow = true;
    this.scene.add(cable);
  }

  /** Which gamepad input is under the pointer (desk view only). */
  private pickPad(ev: PointerEvent): PadButton | null {
    if (this.focus > 0.5) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = this.raycaster.intersectObjects([...this.padParts.values()].map((p) => p.mesh), false)[0];
    return (hit?.object.userData.padButton as PadButton) ?? null;
  }

  /** Called every frame with the buttons currently held (keyboard + clicks), so the pad mirrors them. */
  setPadState(held: Partial<Record<PadButton, boolean>>) { this.padHeld = held; }

  addCartridges(list: CartInfo[]) {
    const shell = new THREE.MeshStandardMaterial({ color: '#4a4a52', roughness: 0.55, metalness: 0.05 });
    list.forEach((info, i) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(CART_W, CART_H, CART_D, 3, 0.006), shell);
      body.castShadow = true;
      g.add(body);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(CART_W * 0.86, CART_H * 0.82), new THREE.MeshStandardMaterial({ map: labelTexture(info), roughness: 0.6 }));
      label.position.set(0, 0.004, CART_D / 2 + 0.0008);
      g.add(label);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(CART_W * 0.7, CART_H * 0.5), new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.6 }));
      back.position.set(0, 0.02, -CART_D / 2 - 0.0008);
      back.rotation.y = Math.PI;
      g.add(back);
      // grip ridges
      for (let k = 0; k < 4; k++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(CART_W * 0.7, 0.003, CART_D + 0.002), shell);
        r.position.set(0, CART_H / 2 - 0.012 - k * 0.006, 0);
        g.add(r);
      }
      const home = new THREE.Vector3(-1.53 + i * 0.155, DESK_Y + 0.03 + CART_H / 2, 0.22);
      g.position.copy(home);
      g.rotation.x = -0.12;
      g.traverse((o) => (o.userData.cartIndex = i));
      this.scene.add(g);
      this.carts.push({ info, group: g, home, slot: null, anim: null });
    });
  }

  // ------------------------------------------------------------ cartridge movement
  private slotTarget(s: Slot) { return s.pos.clone().add(new THREE.Vector3(0, CART_H / 2 - SLOT_SINK, 0)); }

  insert(c: Cartridge, s: Slot) {
    if (s.cart && s.cart !== c) this.eject(s.cart);
    if (c.slot && c.slot !== s) { c.slot.cart = null; }
    c.slot = s;
    s.cart = c;
    const to = this.slotTarget(s);
    const via = to.clone().add(new THREE.Vector3(0, 0.12, 0));
    this.animate(c, to, via, 0.45, () => this.onInsert(s.index, c.info));
  }

  eject(c: Cartridge) {
    const s = c.slot;
    if (!s) return;
    s.cart = null;
    c.slot = null;
    const via = c.group.position.clone().add(new THREE.Vector3(0, 0.15, 0));
    this.animate(c, c.home.clone(), via, 0.5);
    this.onEject(s.index, c.info);
  }

  ejectAll() { for (const s of this.slots) if (s.cart) this.eject(s.cart); }

  private animate(c: Cartridge, to: THREE.Vector3, via: THREE.Vector3 | undefined, dur: number, done?: () => void) {
    c.anim = { from: c.group.position.clone(), to, via, t: 0, dur, done };
  }

  // ------------------------------------------------------------ pointer / drag & drop
  private pick(ev: PointerEvent): Cartridge | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.carts.map((c) => c.group), true);
    const idx = hits[0]?.object.userData.cartIndex;
    return idx == null ? null : this.carts[idx];
  }

  /** Which TV knob (if any) is under the pointer. Works in both the desk view and the TV close-up. */
  private pickKnob(ev: PointerEvent | WheelEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = this.raycaster.intersectObjects(this.knobPivots, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && o.userData.knob == null) o = o.parent;
    return o ? (o.userData.knob as number) : null;
  }

  setKnob(i: number, value: number, notify = true) {
    const v = Math.min(1, Math.max(0, value));
    if (v === this.knobValues[i]) return;
    this.knobValues[i] = v;
    if (i === 1) this.crt.uniforms.uPicture.value = v;
    if (notify) this.onKnob(i, v);
  }

  private planePoint(ev: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.dragPlane, p) ? p : null;
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (ev) => {
      const rect = el.getBoundingClientRect();
      if (this.knobDrag) {
        const k = this.knobDrag;
        const dx = ev.clientX - k.x, dy = ev.clientY - k.y;
        if (Math.hypot(dx, dy) > 4) k.moved = true;
        // drag right or up to turn the knob clockwise (louder / stronger)
        if (k.moved) this.setKnob(k.i, k.v + (dx - dy) / 220);
        return;
      }
      if (!this.dragging) {
        el.style.cursor = this.pickKnob(ev) != null ? 'grab' : this.pickPad(ev) ? 'pointer' : this.focus < 0.5 && this.pick(ev) ? 'grab' : 'default';
        return;
      }
      if (Math.hypot(ev.clientX - this.dragStart.x, ev.clientY - this.dragStart.y) > 6) this.dragMoved = true;
      if (!this.dragMoved) return;
      const p = this.planePoint(ev);
      if (!p) return;
      const c = this.dragging;
      c.group.position.lerp(p, 0.6);
      // nearest slot highlight, measured in screen space so it matches what the user sees
      let best: Slot | null = null, bd = Math.max(60, rect.width * 0.06);
      for (const s of this.slots) {
        const v = s.pos.clone().project(this.camera);
        const sx = rect.left + ((v.x + 1) / 2) * rect.width, sy = rect.top + ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (d < bd) { bd = d; best = s; }
      }
      this.hoverSlot = best;
    });
    el.addEventListener('pointerdown', (ev) => {
      const knob = this.pickKnob(ev);
      if (knob != null) {
        this.knobDrag = { i: knob, x: ev.clientX, y: ev.clientY, v: this.knobValues[knob], moved: false };
        el.setPointerCapture(ev.pointerId);
        el.style.cursor = 'grabbing';
        return;
      }
      const padBtn = this.pickPad(ev);
      if (padBtn) {
        this.padPointer = padBtn;
        this.onPadButton(padBtn, true);
        el.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.focus > 0.5) return;
      const c = this.pick(ev);
      if (!c) {
        if (this.raycaster.intersectObject(this.screenMesh).length) this.onScreenClick();
        return;
      }
      if (c.anim) return;
      this.dragging = c;
      this.dragStart.set(ev.clientX, ev.clientY);
      this.dragMoved = false;
      el.setPointerCapture(ev.pointerId);
      el.style.cursor = 'grabbing';
    });
    const end = () => {
      if (this.padPointer) { this.onPadButton(this.padPointer, false); this.padPointer = null; return; }
      if (this.knobDrag) {
        const k = this.knobDrag;
        this.knobDrag = null;
        el.style.cursor = 'grab';
        // a plain click steps the knob up by one notch, wrapping back to zero after the top
        if (!k.moved) this.setKnob(k.i, k.v >= 0.999 ? 0 : Math.min(1, Math.round(k.v * 8 + 1) / 8));
        return;
      }
      const c = this.dragging;
      if (!c) return;
      this.dragging = null;
      const target = this.hoverSlot;
      this.hoverSlot = null;
      el.style.cursor = 'default';
      if (!this.dragMoved) {
        // click: toggle in/out
        if (c.slot) this.eject(c);
        else {
          const free = this.slots.find((s) => !s.cart);
          if (free) this.insert(c, free);
          else this.flashSlots();
        }
        return;
      }
      if (target) {
        if (c.slot === target) { this.animate(c, this.slotTarget(target), undefined, 0.25); return; }
        if (c.slot) { const s = c.slot; s.cart = null; c.slot = null; this.onEject(s.index, c.info); }
        this.insert(c, target);
      } else if (c.slot) {
        this.eject(c);
      } else {
        this.animate(c, c.home.clone(), undefined, 0.35);
      }
    };
    el.addEventListener('wheel', (ev) => {
      const knob = this.pickKnob(ev);
      if (knob == null) return;
      ev.preventDefault();
      this.setKnob(knob, this.knobValues[knob] - Math.sign(ev.deltaY) * 0.05);
    }, { passive: false });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private slotFlash = 0;
  flashSlots() { this.slotFlash = 1; }

  // ------------------------------------------------------------ per-frame
  update() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), LOWFI ? 1 : 0.05);
    const t = this.timer.getElapsed();
    // power animation
    const speed = this.powerTarget > this.power ? 2.2 : 3.5;
    this.power += Math.sign(this.powerTarget - this.power) * Math.min(Math.abs(this.powerTarget - this.power), dt * speed);
    this.crt.uniforms.uPower.value = this.power;
    this.crt.uniforms.uTime.value = t;
    this.crt.uniforms.uStatic.value = Math.max(0, this.crt.uniforms.uStatic.value - dt * 1.5);
    this.screenTex.needsUpdate = true;
    this.powerLed.emissiveIntensity = this.powerTarget > 0 ? 3 : 0;
    this.remixLed.emissiveIntensity = this.remixing ? 2 + 2 * Math.sin(t * 8) : 0;
    const glow = this.scene.getObjectByName('screenGlow') as THREE.PointLight;
    glow.intensity = this.power * 0.18; // subtle: the gamepad sits right in front of the screen

    for (let i = 0; i < this.knobPivots.length; i++) {
      const p = this.knobPivots[i];
      const target = (0.5 - this.knobValues[i]) * Math.PI * 1.5;
      p.rotation.z += (target - p.rotation.z) * Math.min(1, dt * 18);
    }

    // gamepad: pressed buttons sink and light up; the d-pad rocks toward the pressed direction
    for (const [b, p] of this.padParts) {
      const target = this.padHeld[b] ? 1 : 0;
      p.amount += (target - p.amount) * Math.min(1, dt * 30);
      p.mat.emissiveIntensity = p.amount * 1.6;
      if (b === 'a' || b === 'b' || b === 'start' || b === 'select') p.mesh.position.y = p.rest - p.amount * 0.004;
    }
    const tilt = (k: PadButton) => this.padParts.get(k)!.amount;
    this.dpad.rotation.x = (tilt('down') - tilt('up')) * 0.18;
    this.dpad.rotation.z = (tilt('left') - tilt('right')) * 0.18;

    // slot highlights
    this.slotFlash = Math.max(0, this.slotFlash - dt * 2);
    for (const s of this.slots) {
      const m = s.glow.material as THREE.MeshBasicMaterial;
      const on = this.hoverSlot === s ? 0.9 : 0;
      const idle = this.dragging && !s.cart ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
      m.opacity = Math.max(on, idle, this.slotFlash * (s.cart ? 0 : 1));
      m.color.set(this.slotFlash > 0 ? '#ff6b6b' : '#7dff9b');
    }

    // cartridge animations
    for (const c of this.carts) {
      if (c.anim) {
        const a = c.anim;
        a.t = Math.min(1, a.t + dt / a.dur);
        const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
        if (a.via) {
          // quadratic bezier through `via`
          const p0 = a.from, p1 = a.via, p2 = a.to;
          const u = 1 - e;
          c.group.position.set(
            u * u * p0.x + 2 * u * e * p1.x + e * e * p2.x,
            u * u * p0.y + 2 * u * e * p1.y + e * e * p2.y,
            u * u * p0.z + 2 * u * e * p1.z + e * e * p2.z,
          );
        } else c.group.position.lerpVectors(a.from, a.to, e);
        if (a.t >= 1) { c.anim = null; a.done?.(); }
      }
      const targetRotX = c === this.dragging ? 0.25 : c.slot ? 0 : -0.12;
      const targetRotY = c.slot ? -0.18 : 0;
      c.group.rotation.x += (targetRotX - c.group.rotation.x) * Math.min(1, dt * 12);
      c.group.rotation.y += (targetRotY - c.group.rotation.y) * Math.min(1, dt * 12);
    }

    // camera: desk overview <-> TV close-up (no mouse-driven sway: it was disorienting)
    this.focus += (this.focusTarget - this.focus) * Math.min(1, dt * 3.5);
    if (LOWFI) this.focus = this.focusTarget;
    const f = this.focus * this.focus * (3 - 2 * this.focus);
    const deskPos = new THREE.Vector3(-0.15, 1.75, 2.85);
    const deskLook = new THREE.Vector3(-0.2, 0.93, -0.15);
    const screenWorld = new THREE.Vector3();
    this.screenMesh.getWorldPosition(screenWorld);
    const tvPos = screenWorld.clone().add(new THREE.Vector3(0, 0.0, 1.0));
    this.camera.position.lerpVectors(deskPos, tvPos, f);
    this.camera.lookAt(deskLook.lerp(screenWorld, f));

    this.composer.render();
  }

  staticBurst(v = 0.8) { this.crt.uniforms.uStatic.value = v; }
}
