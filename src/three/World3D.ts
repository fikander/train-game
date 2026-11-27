// The 3D board: a real three.js scene drawn under the (transparent) Phaser canvas.
// Phaser still runs the game, the tray, the buttons and all input; this layer only mirrors what is on the board.
//
// The camera is orthographic, tilted down and turned so the squares run diagonally (a high-angle diorama view).
// The world is laid out in the 2D game's board coordinates (design pixels); GameScene turns board points into screen
// points (and taps back into board points) through toScreen / fromScreen.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DX, DY, cellPath, opp, sides, type Dir, type Piece } from '../track';
import { PAL, TUNNEL_COLOURS } from '../terrain';
import type { Biome } from '../levels';

/**
 * Look settings, tweakable live in dev mode (?dev) and remembered on the device.
 * pitch: degrees the camera looks down from the horizontal; yaw: degrees it is turned, so the squares run diagonally;
 * pixel: render at 1/pixel resolution with chunky pixels (1 = off); ink: outline width; shadow: shadow darkness;
 * bands: toon light steps.
 */
export const DEFAULTS = { pitch: 55, yaw: -27, pixel: 1, ink: 1.5, shadow: 0.22, bands: 3 };
/** Pixel size used when the grown-ups turn the pixelated look on. */
export const PIXEL_ON = 6;
// v2: new defaults (Tomek, 2026-11-27), so older saved slider values don't hide them
const KEY = 'choo.look2';
export type Look = typeof DEFAULTS;
export const look: Look = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
})();
export function saveLook() { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* ignore */ } }

function bandData(n: number) {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.round(120 + (255 - 120) * (n === 1 ? 1 : i / (n - 1)));
  return d;
}
const INK = 0x2d2a3e;

// ---------- materials ----------
let gradTex: THREE.DataTexture | null = null;
function gradient() {
  if (!gradTex) {
    // three bands of light: shade, middle, lit
    gradTex = new THREE.DataTexture(bandData(look.bands), look.bands, 1, THREE.RedFormat);
    gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter;
    gradTex.generateMipmaps = false;
    gradTex.needsUpdate = true;
  }
  return gradTex;
}
const toonCache = new Map<number, THREE.MeshToonMaterial>();
function toon(color: number) {
  let m = toonCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: gradient() }); toonCache.set(color, m); }
  return m;
}
const basicCache = new Map<number, THREE.MeshBasicMaterial>();
function basic(color: number) {
  let m = basicCache.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); basicCache.set(color, m); }
  return m;
}
interface PartOpts { line?: number | false; inkColor?: number; cast?: boolean; flat?: boolean }
/** One cartoon part: a toon-shaded mesh. */
function part(geo: THREE.BufferGeometry, color: number, o: PartOpts = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, o.flat ? basic(color) : toon(color));
  m.castShadow = o.cast ?? true;
  m.receiveShadow = !o.flat;
  // outlines are drawn afterwards on screen from depth and normals (see Outline); small bits can opt out
  if (o.line === false) m.userData.noInk = true;
  g.add(m);
  return g;
}
function put<T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ---------- geometry (cached; vehicles and track are built in cell units) ----------
const geoCache = new Map<string, THREE.BufferGeometry>();
function memo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const rbox = (w: number, h: number, d: number, r: number) => memo(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));
const box = (w: number, h: number, d: number) => memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
/** a cylinder lying across the track (axis z): wheels */
const wheelGeo = (r: number, w: number) => memo(`w${r},${w}`, () => new THREE.CylinderGeometry(r, r, w, 18).rotateX(Math.PI / 2));
/** a cylinder lying along the track (axis x): boilers, bands */
const cylX = (r: number, l: number) => memo(`cx${r},${l}`, () => new THREE.CylinderGeometry(r, r, l, 22).rotateZ(Math.PI / 2));
const cylY = (r0: number, r1: number, h: number, n = 16) => memo(`cy${r0},${r1},${h},${n}`, () => new THREE.CylinderGeometry(r0, r1, h, n));
const sphere = (r: number) => memo(`s${r}`, () => new THREE.SphereGeometry(r, 18, 12));
const capsuleX = (r: number, l: number) => memo(`cap${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 18).rotateZ(Math.PI / 2));

/** A strip with a rectangular section swept along points on the ground (x, z), from height y0 to y1. */
function sweep(pts: { x: number; z: number }[], w: number, y0: number, y1: number) {
  const pos: number[] = [];
  const ring = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * w / 2, nz = dx / l * w / 2;
    return { lx: p.x - nx, lz: p.z - nz, rx: p.x + nx, rz: p.z + nz };
  });
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i], q = ring[i + 1];
    quad([p.lx, y1, p.lz], [p.rx, y1, p.rz], [q.rx, y1, q.rz], [q.lx, y1, q.lz]); // top
    quad([p.rx, y0, p.rz], [q.rx, y0, q.rz], [q.rx, y1, q.rz], [p.rx, y1, p.rz]); // right side
    quad([q.lx, y0, q.lz], [p.lx, y0, p.lz], [p.lx, y1, p.lz], [q.lx, y1, q.lz]); // left side
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function localPath(a: Dir, b: Dir, n = 16) {
  return cellPath(0, 0, a, b, n).map(p => ({ x: p.x - 0.5, z: p.y - 0.5 }));
}
function offsetPath(pts: { x: number; z: number }[], off: number) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    return { x: p.x - dz / l * off, z: p.z + dx / l * off };
  });
}
const railGeo = (a: Dir, b: Dir, off: number, y0: number) => memo(`rail${a}${b}${off}${y0}`, () => sweep(offsetPath(localPath(a, b), off), 0.075, y0, y0 + 0.055));
const sleeperGeo = (a: Dir, b: Dir) => memo(`sl${a}${b}`, () => {
  const pts = localPath(a, b);
  const n = a === opp(b) ? 4 : 3;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round(((i + 0.5) / n) * (pts.length - 1));
    const p = pts[idx], q = pts[Math.min(idx + 1, pts.length - 1)], r = pts[Math.max(idx - 1, 0)];
    const ang = Math.atan2(q.z - r.z, q.x - r.x);
    parts.push(new THREE.BoxGeometry(0.11, 0.04, 0.64).rotateY(-ang).translate(p.x, 0.02, p.z));
  }
  return mergeGeometries(parts)!;
});

const dirAngle = (d: number) => [-Math.PI / 2, 0, Math.PI / 2, Math.PI][d];
const yawOf = (screenAngle: number) => -screenAngle;

// ---------- track pieces ----------
function rails(g: THREE.Group, a: Dir, b: Dir, fixed: boolean, color = 0xf4f4ef, y0 = 0.035, withSleepers = true) {
  if (withSleepers) g.add(part(sleeperGeo(a, b), fixed ? 0x9b6a3e : 0xc98a4b, { line: 3.5 }));
  for (const off of [-0.16, 0.16]) g.add(part(railGeo(a, b, off, y0), color, { line: 3.5 }));
}

/** a red-and-white buffer stop across the track, `at` along the direction d from the centre */
function bufferStop(g: THREE.Group, d: Dir, at: number) {
  const b = new THREE.Group();
  put(b, part(rbox(0.13, 0.16, 0.58, 0.03), 0xe8483f), 0, 0.11, 0);
  put(b, part(box(0.135, 0.05, 0.3), 0xffffff, { line: false }), 0, 0.12, 0);
  for (const z of [-0.2, 0.2]) put(b, part(box(0.08, 0.1, 0.08), 0x4a4a5a), -0.05, 0.05, z);
  b.position.set(Math.cos(dirAngle(d)) * at, 0, Math.sin(dirAngle(d)) * at);
  b.rotation.y = yawOf(dirAngle(d));
  g.add(b);
}

/** the yellow disc with an arrow showing where a switch sends carriages, plus a little lever by the track */
function switchMarker(p: Piece) {
  const g = new THREE.Group();
  const active = (p.state ? p.out2 : p.out1)!;
  const pts = localPath(p.inDir!, active);
  const i = Math.round(pts.length * 0.72);
  const m = pts[i], n = pts[Math.min(pts.length - 1, i + 2)];
  const ang = Math.atan2(n.z - m.z, n.x - m.x);
  const disc = new THREE.Group();
  put(disc, part(cylY(0.17, 0.17, 0.05, 24), 0xffd23f), 0, 0, 0);
  const arrow = memo('arrow', () => {
    const s = new THREE.Shape();
    s.moveTo(0.14, 0); s.lineTo(-0.09, -0.11); s.lineTo(-0.09, 0.11); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.055, 0);
  });
  put(disc, part(arrow, INK, { line: false }), 0, 0, 0);
  disc.position.set(m.x, 0.16, m.z);
  disc.rotation.y = yawOf(ang);
  g.add(disc);
  return { g, disc };
}

function buildPiece(p: Piece) {
  const g = new THREE.Group();
  switch (p.type) {
    case 'straight':
    case 'curve': {
      const [a, b] = sides(p);
      rails(g, a, b, p.fixed);
      break;
    }
    case 'engine':
    case 'exit':
    case 'portal':
      rails(g, opp(p.rot), p.rot as Dir, true);
      break;
    case 'car':
    case 'start':
      rails(g, opp(p.rot), p.rot as Dir, true);
      if (p.type === 'start' || p.buffer) bufferStop(g, opp(p.rot), 0.4);
      break;
    case 'end':
      rails(g, p.rot as Dir, opp(p.rot), true);
      bufferStop(g, p.rot as Dir, 0.04);
      break;
    case 'switch': {
      if (p.junction) { rails(g, p.inDir!, p.out1!, true); rails(g, p.inDir!, p.out2!, true, undefined, 0.034); break; }
      // both branches lie flat; the way the carriages will go has yellow rails
      const active = p.state ? p.out2! : p.out1!;
      const inactive = p.state ? p.out1! : p.out2!;
      rails(g, p.inDir!, inactive, true, 0xf4f4ef, 0.035);
      rails(g, p.inDir!, active, true, 0xffd23f, 0.037);
      break;
    }
  }
  return g;
}

// ---------- vehicles (cell units, facing +x, wheels standing on the rail tops) ----------
/** top of the rails (see rails(): y0 0.035 + rail height 0.055) */
const RAIL_TOP = 0.09;
/** Models are drawn with the wheels touching y = wheelBottom; lift them so the wheels rest on the rails. */
function onRails(g: THREE.Group, wheelBottom: number) {
  for (const c of g.children) c.position.y += RAIL_TOP - wheelBottom;
  return g;
}
function chassis(g: THREE.Group, body: number) {
  put(g, part(rbox(0.72, 0.06, 0.34, 0.02), 0x3a3646), 0, 0.13, 0);
  for (const x of [-0.22, 0.22]) for (const z of [-0.16, 0.16]) {
    put(g, part(wheelGeo(0.075, 0.05), 0x3a3646), x, 0.08, z);
    put(g, part(wheelGeo(0.03, 0.055), 0xb9c2cc, { line: false }), x, 0.08, z);
  }
  for (const x of [-0.38, 0.38]) put(g, part(box(0.06, 0.05, 0.08), 0x3a3646), x, 0.13, 0);
  return body;
}

function buildCar(kind: string) {
  const g = new THREE.Group();
  if (kind === 'coal') {
    chassis(g, 0);
    put(g, part(rbox(0.7, 0.32, 0.42, 0.04), 0xe8483f), 0, 0.32, 0);
    put(g, part(rbox(0.72, 0.03, 0.44, 0.012), 0xff7a7f, { line: 2 }), 0, 0.48, 0);
    const lump = memo('coal', () => new THREE.DodecahedronGeometry(0.075).scale(1, 0.7, 1));
    let i = 0;
    for (const x of [-0.24, -0.12, 0, 0.12, 0.24]) for (const z of [-0.1, 0.06]) {
      put(g, part(lump, 0x3a3946, { line: 2 }), x + (i % 2) * 0.03, 0.5 + (i * 7 % 3) * 0.012, z + ((i * 5) % 3) * 0.02);
      i++;
    }
  } else if (kind === 'passenger') {
    chassis(g, 0);
    put(g, part(rbox(0.72, 0.32, 0.42, 0.05), 0x3fbf6f), 0, 0.32, 0);
    for (const z of [-0.211, 0.211]) for (const x of [-0.24, -0.08, 0.08, 0.24]) put(g, part(box(0.1, 0.11, 0.012), 0xcdeeff, { line: 2 }), x, 0.37, z);
    put(g, part(rbox(0.8, 0.06, 0.5, 0.025), 0xfff3d6), 0, 0.51, 0);
    for (const x of [-0.2, 0, 0.2]) put(g, part(rbox(0.09, 0.04, 0.12, 0.015), 0xd9c79a, { line: 2 }), x, 0.55, 0);
  } else {
    // tank wagon
    chassis(g, 0);
    put(g, part(rbox(0.72, 0.04, 0.38, 0.015), 0x6b6f7a), 0, 0.17, 0);
    for (const x of [-0.2, 0.2]) put(g, part(rbox(0.06, 0.1, 0.3, 0.015), 0x6b6f7a), x, 0.22, 0);
    put(g, part(capsuleX(0.18, 0.34), 0xffc93c), 0, 0.37, 0);
    for (const x of [-0.13, 0.13]) put(g, part(cylX(0.185, 0.03), 0xd9930f, { line: 2 }), x, 0.37, 0);
    put(g, part(cylY(0.06, 0.07, 0.07), 0xffd966), 0, 0.57, 0);
  }
  return onRails(g, 0.08 - 0.075);
}

function buildEngine() {
  const g = new THREE.Group();
  put(g, part(rbox(0.86, 0.07, 0.34, 0.02), 0x4a4a5a), 0, 0.14, 0);
  for (const x of [-0.27, -0.03, 0.21]) for (const z of [-0.16, 0.16]) {
    put(g, part(wheelGeo(0.1, 0.055), 0xe8483f), x, 0.1, z);
    put(g, part(wheelGeo(0.035, 0.06), 0xffffff, { line: false }), x, 0.1, z);
  }
  // white boiler with blue bands, dark smokebox at the front
  put(g, part(cylX(0.15, 0.48), 0xffffff), 0.1, 0.3, 0);
  for (const x of [-0.02, 0.18]) put(g, part(cylX(0.165, 0.035), 0x2f6fd1, { line: 2 }), x, 0.3, 0);
  put(g, part(cylX(0.153, 0.09), 0x4a4a5a), 0.37, 0.3, 0);
  // chimney + dome
  put(g, part(cylY(0.065, 0.045, 0.17), 0x6b6f7a), 0.3, 0.5, 0);
  put(g, part(cylY(0.075, 0.075, 0.035), 0x4a4a5a, { line: 3 }), 0.3, 0.6, 0);
  put(g, part(sphere(0.07), 0xffc93c), 0.1, 0.44, 0);
  // blue cab at the back
  put(g, part(rbox(0.26, 0.3, 0.42, 0.04), 0x2f6fd1), -0.28, 0.33, 0);
  for (const z of [-0.211, 0.211]) put(g, part(box(0.12, 0.1, 0.012), 0xcdeeff, { line: 2 }), -0.26, 0.39, z);
  put(g, part(rbox(0.32, 0.05, 0.48, 0.02), 0x1d4a8f), -0.28, 0.5, 0);
  // red cowcatcher
  const cow = memo('cow', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0.12, 0); s.lineTo(0, 0.16); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: false }).translate(0, 0, -0.16);
  });
  put(g, part(cow, 0xe8483f), 0.41, 0.03, 0);
  return onRails(g, 0.1 - 0.1);
}

const numberTex = new Map<number, THREE.Texture>();
function numberSprite(n: number) {
  let t = numberTex.get(n);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.font = '900 96px Arial Black, Arial Rounded MT Bold, Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 18; x.strokeStyle = '#2d2a3e';
    x.strokeText(String(n), 64, 70);
    x.fillStyle = '#ffffff'; x.fillText(String(n), 64, 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    numberTex.set(n, t);
  }
  // always drawn on top, so coal lumps or a roof never cut into the number
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.renderOrder = 10;
  s.layers.set(OVERLAY);
  return s;
}

// ---------- scenery (design pixels) ----------
function mulberry(seed: string) {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return t / 4294967296;
  };
}

export type TerrainItem =
  | { kind: 'forest'; pts: { x: number; y: number }[]; s: number }
  | { kind: 'pond'; pts: { x: number; y: number }[]; s: number }
  | { kind: 'meadow'; pt: { x: number; y: number }; s: number };

function buildForest(root: THREE.Group, item: { pts: { x: number; y: number }[]; s: number }, b: Biome, rnd: () => number) {
  const P = PAL[b], s = item.s;
  const r = (a: number, c: number) => a + (c - a) * rnd();
  const soft = { line: 3, inkColor: P.shade };
  item.pts.forEach((c, ci) => {
    for (let i = 0; i < 3; i++) {
      const x = c.x + r(-0.3, 0.3) * s, z = c.y + r(-0.3, 0.3) * s, k = r(0.22, 0.32) * s;
      const t = new THREE.Group();
      if (b === 'snow') {
        put(t, part(cylY(k * 0.12, k * 0.14, k * 0.4, 8), 0x8a6a48, soft), 0, k * 0.2, 0);
        put(t, part(cylY(0, k, k * 1.3, 9), P.crown, soft), 0, k * 0.95, 0);
        put(t, part(cylY(0, k * 0.72, k * 1.0, 9), P.crown, soft), 0, k * 1.55, 0);
        put(t, part(cylY(0, k * 0.4, k * 0.5, 9), P.light, soft), 0, k * 1.95, 0);
      } else if (b === 'desert') {
        if ((ci * 3 + i) % 3 === 2) {
          const cg = 0x8fae6a, w = k * 0.22;
          put(t, part(memo(`cac${w}`, () => new THREE.CapsuleGeometry(w, k * 1.1, 4, 10)), cg, soft), 0, k * 0.8, 0);
          const arm = put(t, part(memo(`cac${w * 0.7}`, () => new THREE.CapsuleGeometry(w * 0.7, k * 0.5, 4, 10)), cg, soft), -k * 0.32, k * 0.9, 0);
          arm.rotation.z = 0.5;
        } else {
          const rock = put(t, part(memo(`rock${Math.round(k)}`, () => new THREE.DodecahedronGeometry(k * 0.8, 0)), P.crown, soft), 0, k * 0.3, 0);
          rock.scale.set(1, 0.6, 0.85);
          rock.rotation.y = rnd() * 3;
        }
      } else {
        put(t, part(cylY(k * 0.14, k * 0.18, k * 0.5, 8), 0x8a6a48, soft), 0, k * 0.25, 0);
        const crown = put(t, part(memo(`crown${Math.round(k)}`, () => new THREE.SphereGeometry(k, 14, 10)), P.crown, soft), 0, k * 1.05, 0);
        crown.scale.y = 0.85;
      }
      t.position.set(x, 0, z);
      root.add(t);
    }
  });
}

function buildPond(root: THREE.Group, item: { pts: { x: number; y: number }[]; s: number }, b: Biome, rnd: () => number) {
  const P = PAL[b], s = item.s;
  const has = (x: number, y: number) => item.pts.some(c => Math.abs(c.x - x) < 1 && Math.abs(c.y - y) < 1);
  const layer = (color: number, inset: number, y: number) => {
    const shapes: THREE.BufferGeometry[] = [];
    for (const c of item.pts) {
      const h = s / 2 - inset * s, rr = h * 0.9;
      const sh = new THREE.Shape();
      sh.moveTo(-h + rr, -h); sh.lineTo(h - rr, -h); sh.quadraticCurveTo(h, -h, h, -h + rr); sh.lineTo(h, h - rr);
      sh.quadraticCurveTo(h, h, h - rr, h); sh.lineTo(-h + rr, h); sh.quadraticCurveTo(-h, h, -h, h - rr); sh.lineTo(-h, -h + rr);
      sh.quadraticCurveTo(-h, -h, -h + rr, -h);
      shapes.push(new THREE.ShapeGeometry(sh, 8).rotateX(-Math.PI / 2).translate(c.x, y, c.y));
      if (has(c.x + s, c.y)) shapes.push(new THREE.PlaneGeometry(s, h * 2).rotateX(-Math.PI / 2).translate(c.x + s / 2, y, c.y));
      if (has(c.x, c.y + s)) shapes.push(new THREE.PlaneGeometry(h * 2, s).rotateX(-Math.PI / 2).translate(c.x, y, c.y + s / 2));
    }
    const m = new THREE.Mesh(mergeGeometries(shapes.map(g => g.index ? g.toNonIndexed() : g))!, basic(color));
    root.add(m);
  };
  layer(P.shore, 0.06, 0.6);
  layer(P.water, 0.14, 1.2);
  for (const c of item.pts) if (b !== 'snow' && rnd() < 0.6) {
    const e = new THREE.Mesh(memo('ripple', () => new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2)), basic(P.waterLight));
    e.scale.set(s * 0.15, 1, s * 0.04);
    e.position.set(c.x - s * 0.1, 1.5, c.y - s * 0.1);
    root.add(e);
  }
  if (b === 'desert') {
    const c = item.pts[0];
    for (const [dx, dy] of [[-0.42, -0.38], [0.4, 0.36]]) {
      const t = new THREE.Group();
      const soft = { line: 3, inkColor: P.shade };
      put(t, part(cylY(s * 0.025, s * 0.035, s * 0.4, 8), 0x9a7a4e, soft), 0, s * 0.2, 0);
      for (let i = 0; i < 5; i++) {
        const leaf = put(t, part(memo('leaf', () => new THREE.SphereGeometry(1, 10, 6)), 0x7fa35a, soft), 0, s * 0.4, 0);
        const a = i * Math.PI * 2 / 5;
        leaf.scale.set(s * 0.13, s * 0.025, s * 0.05);
        leaf.position.set(Math.cos(a) * s * 0.1, s * 0.39, Math.sin(a) * s * 0.1);
        leaf.rotation.y = -a;
        leaf.rotation.z = 0;
      }
      t.position.set(c.x + dx * s, 0, c.y + dy * s);
      root.add(t);
    }
  }
}

function buildMeadow(root: THREE.Group, item: { pt: { x: number; y: number }; s: number }, b: Biome, rnd: () => number) {
  const s = item.s;
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(sphere(1), toon(PAL[b].flowers[Math.floor(rnd() * PAL[b].flowers.length)]));
    f.scale.setScalar(s * 0.03);
    f.userData.noInk = true;
    f.position.set(item.pt.x + (rnd() * 0.7 - 0.35) * s, s * 0.02, item.pt.y + (rnd() * 0.7 - 0.35) * s);
    root.add(f);
  }
}

/** A grassy hill over a tunnel mouth: an arch in the pair's colour facing out along the track, and a flag on top. */
function buildPortal(p: Piece, b: Biome) {
  const P = PAL[b];
  const g = new THREE.Group();
  const dome = memo('dome', () => new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2));
  const hill = put(g, part(dome, P.hill, { line: 4, inkColor: P.shade }), -0.04, 0, 0);
  hill.scale.set(0.5, 0.38, 0.52);
  if (b === 'snow') {
    const cap = put(g, part(dome, 0xffffff, { line: false }), -0.08, 0.23, 0);
    cap.scale.set(0.34, 0.18, 0.36);
  }
  const col = TUNNEL_COLOURS[(p.pair ?? 0) % TUNNEL_COLOURS.length];
  const arch = memo('arch', () => new THREE.TorusGeometry(0.27, 0.075, 10, 24, Math.PI).rotateY(Math.PI / 2));
  put(g, part(arch, col), 0.47, 0, 0);
  const hole = memo('hole', () => new THREE.CircleGeometry(0.235, 24, 0, Math.PI).rotateY(Math.PI / 2));
  put(g, new THREE.Mesh(hole, basic(0x2b2433)), 0.49, 0, 0);
  // flag
  put(g, part(cylY(0.02, 0.02, 0.4, 6), 0x5a4a3a, { line: 3 }), -0.06, 0.6, 0.04);
  const flag = memo('flag', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0, -0.18); s.lineTo(0.28, -0.09); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
  });
  put(g, part(flag, col, { line: 3 }), -0.06, 0.8, 0.035);
  g.rotation.y = yawOf(dirAngle(p.rot));
  return g;
}

/**
 * Merge every mesh in a group into one mesh per material, so the whole still board costs a handful of draw calls
 * instead of hundreds (matters on tablets).
 */
function bake(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; noInk: boolean; geos: THREE.BufferGeometry[] }>();
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    const noInk = !!m.userData.noInk;
    const k = `${mat.uuid}:${m.castShadow}:${m.receiveShadow}:${noInk}`;
    let b = buckets.get(k);
    if (!b) { b = { mat, cast: m.castShadow, recv: m.receiveShadow, noInk, geos: [] }; buckets.set(k, b); }
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const clean = new THREE.BufferGeometry();
    clean.setAttribute('position', g.getAttribute('position'));
    clean.setAttribute('normal', g.getAttribute('normal'));
    if (!g.getAttribute('normal')) clean.computeVertexNormals();
    g = clean.applyMatrix4(m.matrixWorld);
    b.geos.push(g);
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(b.geos)!, b.mat);
    mesh.geometry.userData.own = true;
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
    if (b.noInk) mesh.userData.noInk = true;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  return out;
}

// ---------- outlines ----------
/** Layer for numbers and stars: drawn after the outlines, so no ink line ever crosses them. */
const OVERLAY = 1;
/**
 * Bold cartoon outlines drawn on screen, after the scene. A second pass draws only the surfaces' directions (normals)
 * and depth; wherever depth jumps (a silhouette) or the surface turns sharply (a crease), the ink colour goes on top
 * of the shaded picture. Unlike outline shells around each part, this can't leave broken bits of black where parts
 * touch or overlap: the line is always where the picture itself has an edge.
 */
class Outline {
  private color: THREE.WebGLRenderTarget;
  private normals: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private hidden: THREE.Object3D[] = [];

  constructor() {
    this.color = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    this.normals = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.normals.depthTexture!.type = THREE.UnsignedIntType;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.color.texture }, tNormal: { value: this.normals.texture }, tDepth: { value: this.normals.depthTexture },
        texel: { value: new THREE.Vector2(1, 1) }, r: { value: 2 }, range: { value: 1 }, thr: { value: 4 },
        ink: { value: new THREE.Color(INK) },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 texel; uniform float r; uniform float range; uniform float thr; uniform vec3 ink;
        varying vec2 vUv;
        float D(vec2 o) { return texture2D(tDepth, vUv + o * texel).x * range; }
        vec3 N(vec2 o) { return texture2D(tNormal, vUv + o * texel).xyz * 2.0 - 1.0; }
        float edgeAt(vec2 o, float dc) {
          // depth: how far the middle is off the straight line between the two sides (flat or sloping ground: 0)
          float dd = abs(D(o) + D(-o) - 2.0 * dc);
          // crease: the two sides face different ways
          float dn = 1.0 - dot(N(o), N(-o));
          return max(smoothstep(thr * 0.6, thr, dd), smoothstep(0.5, 0.8, dn));
        }
        void main() {
          float dc = D(vec2(0.0));
          float e = 0.0;
          for (int i = 0; i < 2; i++) {
            float s = i == 0 ? r : max(1.0, r * 0.5);
            e = max(e, edgeAt(vec2(s, 0.0), dc));
            e = max(e, edgeAt(vec2(0.0, s), dc));
            e = max(e, edgeAt(vec2(s, s) * 0.7071, dc));
            e = max(e, edgeAt(vec2(s, -s) * 0.7071, dc));
          }
          vec4 c = texture2D(tColor, vUv);
          gl_FragColor = vec4(mix(c.rgb, ink, e), 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera, k: number) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    if (this.color.width !== w || this.color.height !== h) { this.color.setSize(w, h); this.normals.setSize(w, h); }
    const u = this.mat.uniforms;
    u.texel.value.set(1 / w, 1 / h);
    // line half-width in drawn pixels: the outline setting, in screen pixels, at this resolution
    u.r.value = Math.max(1, look.ink * 0.9 * renderer.getPixelRatio());
    u.range.value = camera.far - camera.near;
    // a jump in depth counts as an edge from about 6 screen pixels' worth of height
    u.thr.value = 6 / Math.max(0.05, k);

    // shadows are worked out once per frame, for the colour pass only
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    camera.layers.set(0);
    renderer.setRenderTarget(this.color);
    renderer.render(scene, camera);

    // the normals pass leaves out what shouldn't be outlined: numbers, smoke, the shadow layer, tiny bits
    this.hidden.length = 0;
    scene.traverseVisible(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Sprite).isSprite || o.userData.noInk || (m && (m.transparent || (m as THREE.ShadowMaterial).isShadowMaterial))) this.hidden.push(o);
    });
    for (const o of this.hidden) o.visible = false;
    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.normalMat;
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x8080ff, 1);
    renderer.setRenderTarget(this.normals);
    renderer.render(scene, camera);
    renderer.setClearColor(cc, ca);
    scene.overrideMaterial = null;
    scene.background = bg;
    for (const o of this.hidden) o.visible = true;

    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);

    // numbers and stars last, on top of everything (they don't test depth)
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    camera.layers.set(OVERLAY);
    scene.background = null;
    renderer.render(scene, camera);
    scene.background = bg;
    camera.layers.set(0);
    renderer.autoClear = ac;
  }
}

/** see-through dark track for the track shadows (left out of the outlines, as it is transparent) */
const ghostMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.2, depthWrite: false });

// ---------- the world ----------
interface VehView { src: any; g: THREE.Group; kind: string }
interface TokenView { g: THREE.Group; cell: string; rot: number; yaw: number; target: number; pop: number }
interface SwitchView { p: Piece; state: number; g: THREE.Group; disc: THREE.Group; marker: THREE.Group; k: string }
interface Puff { m: THREE.Mesh; t: number; vx: number; vz: number }

export interface BoardScene {
  cell: number; ox: number; oy: number; biome: Biome;
  grid: Map<string, Piece>;
  tokens: { type: 'straight' | 'curve'; rot: number; c: any; g: any; cell: string | null; dragged: boolean }[];
  engine: any; movers: { v: any }[];
  markers: Map<string, any>;
  terrain3d: TerrainItem[];
  groundKey: string;
  textures: any;
  extraTrack: Piece[];
  /** grown-ups' "track shadows": faint track that fits each empty square */
  ghosts?: { type: 'straight' | 'curve'; x: number; y: number; rot: number }[];
  /** level map only: the level stops along the line */
  stations?: Station[];
}

/** A level on the map: a raised pad by the line with its number; x, y = centre in design px, s = map square size. */
export interface Station { x: number; y: number; s: number; num: number; state: 'solved' | 'open' | 'locked'; next: boolean }

let starTex: THREE.Texture | null = null;
function starSprite() {
  if (!starTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 24 : 58, a = -Math.PI / 2 + i * Math.PI / 5;
      x.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r);
    }
    x.closePath();
    x.lineJoin = 'round'; x.lineWidth = 12; x.strokeStyle = '#2d2a3e'; x.stroke();
    x.fillStyle = '#ffd23f'; x.fill();
    starTex = new THREE.CanvasTexture(c);
    starTex.colorSpace = THREE.SRGBColorSpace;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true }));
  sp.layers.set(OVERLAY);
  return sp;
}

function buildStation(st: Station) {
  const g = new THREE.Group();
  const col = st.state === 'locked' ? 0xc9d1c4 : st.next ? 0xffd23f : st.state === 'solved' ? 0xfff1b8 : 0xffffff;
  // the pad, a little signpost and the number floating over it
  put(g, part(rbox(1.5, 0.16, 1.0, 0.08), col), 0, 0.08, 0);
  put(g, part(rbox(1.62, 0.06, 1.12, 0.03), 0x9b6a3e), 0, 0.03, 0);
  const n = numberSprite(st.num);
  n.scale.set(0.95, 0.95, 1);
  n.position.set(0, 0.75, 0);
  if (st.state === 'locked') n.material.opacity = 0.55;
  g.add(n);
  if (st.state === 'solved') {
    const star = starSprite();
    star.scale.set(0.6, 0.6, 1);
    star.position.set(0.55, 1.0, 0);
    g.add(star);
  }
  g.position.set(st.x, 0, st.y);
  g.scale.setScalar(st.s);
  return g;
}

class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  root = new THREE.Group();
  board = new THREE.Group();
  active = false;
  private S!: BoardScene;
  private vehicles: VehView[] = [];
  private tokens = new Map<any, TokenView>();
  private switches: SwitchView[] = [];
  private portals: { x: number; y: number }[] = [];
  private puffs: Puff[] = [];
  private groundTex: THREE.CanvasTexture | null = null;
  private sun: THREE.DirectionalLight;
  private stations: { g: THREE.Group; st: Station }[] = [];
  private outline = new Outline();

  constructor(public W: number, public H: number) {
    // kept after drawing, so the pixelated display can copy it (see display.ts)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.zIndex = '0';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    // inside the game's own box, so it comes along into fullscreen (Phaser makes #game the fullscreen element)
    (document.getElementById('game') ?? document.body).prepend(el);

    this.camera = new THREE.OrthographicCamera(0, W, 0, -H, 1, 30000);
    this.scene.add(this.root);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c8a0, 1.9));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const cx = W / 2, cz = H / 2;
    this.sun.position.set(cx - 900, 1600, cz - 500);
    this.sun.target.position.set(cx, 0, cz);
    this.scene.add(this.sun, this.sun.target);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -1700; sc.right = 1700; sc.top = 1700; sc.bottom = -1700; sc.near = 10; sc.far = 6000;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 1.5;
  }

  /** Keep our canvas exactly under Phaser's, at the screen's real resolution. */
  fit(canvas: HTMLCanvasElement) {
    const el = this.renderer.domElement;
    const r = canvas.getBoundingClientRect(), pr0 = (el.parentElement ?? document.body).getBoundingClientRect();
    // always full resolution: the pixel look shrinks the finished picture (outlines included) in display.ts, so
    // lines stay as thin and clean as without it
    const pr = Math.min(2, window.devicePixelRatio || 1);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    const sz = this.renderer.getSize(new THREE.Vector2());
    if (Math.round(sz.x) !== Math.round(r.width) || Math.round(sz.y) !== Math.round(r.height)) this.renderer.setSize(r.width, r.height, false);
    el.style.left = `${r.left - pr0.left}px`; el.style.top = `${r.top - pr0.top}px`;
    el.style.width = `${r.width}px`; el.style.height = `${r.height}px`;
  }

  /** design px on screen per world unit */
  k = 1;
  private last: [number, number, number, number] = [0, 0, 1, 1];
  private catcher: THREE.Mesh | null = null;

  /** Apply changed look settings (dev mode). Taps only line up with a moved camera after the level restarts. */
  applyLook() {
    saveLook();
    const g = gradient();
    g.image = { data: bandData(look.bands), width: look.bands, height: 1 };
    g.needsUpdate = true;
    if (this.catcher) (this.catcher.material as THREE.ShadowMaterial).opacity = look.shadow;
    this.frame(...this.last);
  }

  /**
   * Aim the camera at a board (rectangle on the ground, design px) and zoom so it fills the space above the tray.
   * Must run before anything asks where a board point shows on screen.
   */
  frame(ox: number, oy: number, w: number, h: number) {
    const cam = this.camera, D = 8000;
    const tx = ox + w / 2, tz = oy + h / 2;
    this.last = [ox, oy, w, h];
    const P = look.pitch * Math.PI / 180, Y = look.yaw * Math.PI / 180;
    cam.position.set(tx + D * Math.sin(Y) * Math.cos(P), D * Math.sin(P), tz + D * Math.cos(Y) * Math.cos(P));
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, 0, tz);
    cam.updateMatrixWorld(true);
    // the board's corners (a little margin, and some height for trains and hills) in camera space
    const m = 20, inv = cam.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, z] of [[ox - m, oy - m], [ox + w + m, oy - m], [ox - m, oy + h + m], [ox + w + m, oy + h + m]]) for (const y of [0, 40]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    // screen space for the board: below the home button, above the tray
    const SX0 = 30, SX1 = this.W - 30, SY0 = 30, SY1 = 960;
    this.k = Math.min((SX1 - SX0) / (x1 - x0), (SY1 - SY0) / (y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sx = (SX0 + SX1) / 2, sy = (SY0 + SY1) / 2;
    cam.left = cx - sx / this.k; cam.right = cam.left + this.W / this.k;
    cam.top = cy + sy / this.k; cam.bottom = cam.top - this.H / this.k;
    cam.updateProjectionMatrix();
  }

  /** Where a ground point (design px) at height h shows on screen. */
  toScreen(x: number, y: number, h = 0) {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H };
  }

  /** The ground point under a screen point. */
  fromScreen(sx: number, sy: number) {
    const o = new THREE.Vector3(sx / this.W * 2 - 1, 1 - sy / this.H * 2, -1).unproject(this.camera);
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  private px(u: number) { return this.S.ox + u * this.S.cell; }
  private py(v: number) { return this.S.oy + v * this.S.cell; }

  /** Build the board for a level. */
  build(S: BoardScene) {
    this.clear();
    this.S = S;
    this.active = true;
    this.renderer.domElement.style.display = 'block';
    this.root.add(this.board);
    const cell = S.cell;
    // the ground: the same painted texture the 2D game uses, plus a layer that only shows shadows
    const src = S.textures.get(S.groundKey).getSourceImage() as HTMLCanvasElement;
    this.groundTex = new THREE.CanvasTexture(src);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 4;
    // the painted ground reaches half a screen past each edge (see GameScene.drawBackground)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(this.W * 2, this.H * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.groundTex }));
    ground.position.set(this.W / 2, 0, this.H / 2);
    ground.geometry.userData.own = true;
    // plain ground colour reaching far past the painted part, for whatever a turned camera sees
    const base = new THREE.Mesh(memo('baseplane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), basic(PAL[S.biome].ground));
    base.scale.set(this.W * 12, 1, this.H * 12);
    base.position.set(this.W / 2, -1, this.H / 2);
    this.board.add(base);
    this.renderer.setClearColor(PAL[S.biome].ground);
    this.board.add(ground);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(this.W * 2, this.H * 2).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: 0x1d3d14, opacity: look.shadow }));
    this.catcher = catcher;
    catcher.position.set(this.W / 2, 2, this.H / 2);
    catcher.geometry.userData.own = true;
    catcher.receiveShadow = true;
    this.board.add(catcher);

    // everything that never moves goes into one group, merged into a few big meshes at the end
    const statics = new THREE.Group();
    const rnd = mulberry(`${S.groundKey}3d`);
    for (const t of S.terrain3d) {
      if (t.kind === 'forest') buildForest(statics, t, S.biome, rnd);
      else if (t.kind === 'pond') buildPond(statics, t, S.biome, rnd);
      else buildMeadow(statics, t, S.biome, rnd);
    }

    const place = (g: THREE.Object3D, x: number, y: number, parent: THREE.Object3D = this.board) => {
      g.position.set(this.px(x + 0.5), 0, this.py(y + 0.5));
      g.scale.setScalar(cell);
      parent.add(g);
    };
    for (const p of [...S.grid.values(), ...S.extraTrack]) {
      if (!p.fixed) continue;
      if (p.type === 'switch' && !p.junction) {
        const sv: SwitchView = { p, state: -1, g: new THREE.Group(), disc: new THREE.Group(), marker: new THREE.Group(), k: `${p.x},${p.y}` };
        place(sv.g, p.x, p.y);
        this.switches.push(sv);
        continue;
      }
      place(buildPiece(p), p.x, p.y, statics);
      if (p.type === 'portal') {
        place(buildPortal(p, S.biome), p.x, p.y, statics);
        this.portals.push({ x: this.px(p.x + 0.5), y: this.py(p.y + 0.5) });
      }
    }

    this.board.add(bake(statics));
    if (S.ghosts?.length) {
      const ghosts = new THREE.Group();
      for (const gp of S.ghosts) place(buildPiece({ ...gp, fixed: true } as Piece), gp.x, gp.y, ghosts);
      ghosts.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = ghostMat; m.castShadow = false; m.receiveShadow = false; } });
      this.board.add(bake(ghosts));
    }
    this.stations = [];
    for (const st of S.stations ?? []) {
      const g = buildStation(st);
      this.board.add(g);
      this.stations.push({ g, st });
    }

    // vehicles
    const add = (src: any, kind: string) => {
      const g = kind === 'engine' ? buildEngine() : buildCar(kind);
      if (src.num) {
        const sp = numberSprite(src.num);
        // big, so it still reads with chunky pixels
        sp.scale.set(0.52, 0.52, 1);
        sp.position.set(0, 1.08, 0);
        g.add(sp);
      }
      this.board.add(g);
      this.vehicles.push({ src, g, kind });
    };
    add(S.engine, 'engine');
    for (const m of S.movers) add(m.v, m.v.kind);
    this.syncVehicles(0); // so smoke never starts from the corner before the first frame
    this.syncSwitches();
  }

  clear() {
    // free what this level made for itself (shared, cached shapes stay)
    this.board.traverse(o => { const g = (o as THREE.Mesh).geometry; if (g?.userData.own) g.dispose(); });
    this.root.remove(this.board);
    this.board = new THREE.Group();
    this.vehicles = []; this.tokens.clear(); this.switches = []; this.portals = []; this.puffs = []; this.stations = [];
    this.groundTex?.dispose(); this.groundTex = null;
  }

  hide() {
    this.active = false;
    this.clear();
    this.renderer.domElement.style.display = 'none';
  }

  /** Smoke from the engine's chimney. */
  puff(n = 1) {
    const e = this.vehicles[0];
    if (!e || !e.g.visible) return;
    const cell = this.S.cell, a = -e.g.rotation.y;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient(), transparent: true, opacity: 0.95, depthWrite: false });
      const m = new THREE.Mesh(memo('puff', () => new THREE.IcosahedronGeometry(1, 2)), mat);
      m.position.set(e.g.position.x + Math.cos(a) * 0.3 * cell, 0.66 * cell, e.g.position.z + Math.sin(a) * 0.3 * cell);
      m.scale.setScalar(cell * 0.08);
      this.board.add(m);
      this.puffs.push({ m, t: 0, vx: (Math.random() - 0.5) * 30, vz: (Math.random() - 0.5) * 30 - 20 });
    }
  }

  private syncSwitches() {
    for (const sv of this.switches) {
      const state = sv.p.state ?? 0;
      if (sv.state !== state) {
        sv.state = state;
        sv.g.clear();
        sv.g.add(buildPiece(sv.p));
        const mk = switchMarker(sv.p);
        sv.g.add(mk.g);
        sv.disc = mk.disc; sv.marker = mk.g;
      }
      const m = this.S.markers.get(sv.k);
      if (m) sv.disc.scale.setScalar(m.scaleX ?? 1);
    }
  }

  private syncTokens() {
    const S = this.S, seen = new Set<any>();
    for (const t of S.tokens) {
      seen.add(t);
      let landed = false;
      if (t.cell && !t.dragged) {
        const [x, y] = t.cell.split(',').map(Number);
        const at = this.toScreen(this.px(x + 0.5), this.py(y + 0.5));
        landed = Math.hypot(t.c.x - at.x, t.c.y - at.y) < 2;
      }
      let v = this.tokens.get(t);
      if (v && (!landed || v.cell !== t.cell)) { this.board.remove(v.g); this.tokens.delete(t); v = undefined; }
      t.g.setAlpha(landed ? 0 : 1);
      if (!landed) continue;
      if (!v) {
        const [x, y] = t.cell!.split(',').map(Number);
        const g = buildPiece({ type: t.type, x: 0, y: 0, rot: 0, fixed: false });
        g.position.set(this.px(x + 0.5), 0, this.py(y + 0.5));
        g.scale.setScalar(S.cell);
        const yaw = -t.rot * Math.PI / 2;
        g.rotation.y = yaw;
        this.board.add(g);
        v = { g, cell: t.cell!, rot: t.rot, yaw, target: yaw, pop: 0 };
        this.tokens.set(t, v);
      }
      if (v.rot !== t.rot) {
        const n = t.type === 'straight' ? 2 : 4;
        const steps = ((t.rot - v.rot) % n + n) % n;
        v.target -= steps * Math.PI / 2;
        v.rot = t.rot;
      }
    }
    for (const [t, v] of this.tokens) if (!seen.has(t)) { this.board.remove(v.g); this.tokens.delete(t); }
  }

  private syncVehicles(time: number) {
    const cell = this.S.cell;
    for (const v of this.vehicles) {
      const s = v.src;
      v.g.position.set(s.x, s.bob ?? 0, s.y);
      v.g.rotation.y = yawOf(s.angle);
      const inHill = this.portals.some(p => Math.hypot(p.x - s.x, p.y - s.y) < cell * 0.34);
      v.g.visible = s.visible && !inHill;
      const k = s.k ?? 1;
      const sx = (s.base?.scaleX ?? k) / k, sy = (s.base?.scaleY ?? k) / k;
      // when the 2D parts fade (quick reset after a crash), the 3D one shrinks away and pops back instead
      const f = Math.max(0.001, s.base?.alpha ?? 1);
      v.g.scale.set(cell * sx * f, cell * (2 - sx) * f, cell * sy * f);
    }
    void time;
  }

  private stepPuffs(dt: number) {
    const cell = this.S.cell;
    this.puffs = this.puffs.filter(p => {
      p.t += dt;
      const life = 1.5, f = p.t / life;
      if (f >= 1) { this.board.remove(p.m); (p.m.material as THREE.Material).dispose(); return false; }
      p.m.position.x += p.vx * dt;
      p.m.position.z += p.vz * dt;
      p.m.position.y += cell * 0.5 * dt;
      p.m.scale.setScalar(cell * (0.08 + 0.17 * f));
      (p.m.material as THREE.MeshToonMaterial).opacity = 0.95 * (1 - f * f);
      return true;
    });
  }

  /** Called every frame by the game scene. */
  sync(canvas: HTMLCanvasElement, time: number, dt: number) {
    if (!this.active) return;
    this.fit(canvas);
    this.syncSwitches();
    this.syncTokens();
    for (const v of this.tokens.values()) {
      v.yaw += (v.target - v.yaw) * Math.min(1, dt * 16);
      v.g.rotation.y = v.yaw;
      v.pop = Math.min(1, v.pop + dt * 5);
      const sc = 1 + Math.sin(v.pop * Math.PI) * 0.12;
      v.g.scale.set(this.S.cell * sc, this.S.cell * sc, this.S.cell * sc);
    }
    this.syncVehicles(time);
    // the next level's pad gently breathes
    for (const { g, st } of this.stations) if (st.next) g.scale.setScalar(st.s * (1 + Math.sin(time / 330) * 0.05));
    this.stepPuffs(dt);
    this.outline.render(this.renderer, this.scene, this.camera, this.k);
  }
}

let world: World | null = null;
/** the 3D layer if it was ever made (without making it) */
export const peekWorld = () => world;
export function getWorld(W: number, H: number) {
  if (!world) {
    world = new World(W, H);
    (window as any).__world = world;
    if (/[?&]dev\b/.test(location.search)) {
      const w = world;
      import('./devPanel').then(m => m.devPanel(() => w.applyLook(), () => {
        const game = (window as any).__phaserGame;
        const sc = game?.scene.getScene('game');
        if (sc?.scene.isActive()) sc.scene.restart({ level: sc.li });
        const map = game?.scene.getScene('map');
        if (map?.scene.isActive()) map.scene.restart({ page: map.page });
      }));
    }
  }
  return world;
}

/** 3D is on unless the address has ?2d in it (to compare with the flat version). */
export const USE_3D = typeof location !== 'undefined' && !/[?&]2d\b/.test(location.search);
export { DX, DY };
