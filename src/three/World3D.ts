// The 3D board: a real three.js scene drawn under the (transparent) Phaser canvas.
// Phaser still runs the game, the tray, the buttons and all input; this layer only mirrors what is on the board.
//
// The camera is orthographic and looks down at THETA from the horizontal. The world is laid out in design pixels
// (1920 x 1200), with the ground squeezed so that a point on the ground lands on exactly the same screen pixel as in
// the 2D game. That keeps every tap, drag and drop square where Phaser expects it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DX, DY, cellPath, opp, sides, type Dir, type Piece } from '../track';
import { PAL, TUNNEL_COLOURS } from '../terrain';
import type { Biome } from '../levels';

export const THETA = 56 * Math.PI / 180;
const SIN = Math.sin(THETA);
const INK = 0x2d2a3e;

// ---------- materials ----------
let gradTex: THREE.DataTexture | null = null;
function gradient() {
  if (!gradTex) {
    // three bands of light: shade, middle, lit
    gradTex = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
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
const inkCache = new Map<string, THREE.ShaderMaterial>();
/** Bold cartoon outline: the back faces, pushed out by `px` design pixels on screen. */
function ink(color = INK, px = 5) {
  const k = `${color}:${px}`;
  let m = inkCache.get(k);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, px: { value: px } },
      vertexShader: `
        uniform float px;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          mv.xyz += n * px;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
    });
    inkCache.set(k, m);
  }
  return m;
}
const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** The same shape with smooth normals, so the outline stays closed around sharp corners. */
function hull(geo: THREE.BufferGeometry) {
  let h = hullCache.get(geo);
  if (!h) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position').clone());
    if (geo.index) g.setIndex(geo.index.clone());
    h = mergeVertices(g, 1e-3);
    h.computeVertexNormals();
    hullCache.set(geo, h);
  }
  return h;
}

interface PartOpts { line?: number | false; inkColor?: number; cast?: boolean; flat?: boolean }
/** One cartoon part: a toon-shaded mesh plus its outline. */
function part(geo: THREE.BufferGeometry, color: number, o: PartOpts = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, o.flat ? basic(color) : toon(color));
  m.castShadow = o.cast ?? true;
  m.receiveShadow = !o.flat;
  g.add(m);
  if (o.line !== false) {
    const h = new THREE.Mesh(hull(geo), ink(o.inkColor ?? INK, o.line ?? 5));
    g.add(h);
  }
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
const railGeo = (a: Dir, b: Dir, off: number, y0: number) => memo(`rail${a}${b}${off}${y0}`, () => sweep(offsetPath(localPath(a, b), off), 0.055, y0, y0 + 0.05));
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
  // lever on the in-side
  const ia = dirAngle(p.inDir!);
  const lx = Math.cos(ia) * 0.3 + Math.cos(ia + Math.PI / 2) * 0.33;
  const lz = Math.sin(ia) * 0.3 + Math.sin(ia + Math.PI / 2) * 0.33;
  put(g, part(cylY(0.025, 0.025, 0.2, 10), 0x6b6f7a), lx, 0.1, lz);
  put(g, part(sphere(0.07), p.state ? 0x3fbf6f : 0xe8483f), lx, 0.22, lz);
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
      const active = p.state ? p.out2! : p.out1!;
      const inactive = p.state ? p.out1! : p.out2!;
      rails(g, p.inDir!, inactive, true, 0x9aa1a8, 0.022);
      rails(g, p.inDir!, active, true, 0xffe066, 0.04, false);
      break;
    }
  }
  return g;
}

// ---------- vehicles (cell units, facing +x, wheels on the ground) ----------
function chassis(g: THREE.Group, body: number) {
  put(g, part(rbox(0.72, 0.06, 0.34, 0.02), 0x3a3646), 0, 0.13, 0);
  for (const x of [-0.22, 0.22]) for (const z of [-0.17, 0.17]) {
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
    put(g, part(rbox(0.7, 0.2, 0.42, 0.04), 0xe8483f), 0, 0.26, 0);
    put(g, part(rbox(0.72, 0.03, 0.44, 0.012), 0xff7a7f, { line: 2 }), 0, 0.36, 0);
    const lump = memo('coal', () => new THREE.DodecahedronGeometry(0.075).scale(1, 0.7, 1));
    let i = 0;
    for (const x of [-0.24, -0.12, 0, 0.12, 0.24]) for (const z of [-0.1, 0.06]) {
      put(g, part(lump, 0x3a3946, { line: 2 }), x + (i % 2) * 0.03, 0.37 + (i * 7 % 3) * 0.012, z + ((i * 5) % 3) * 0.02);
      i++;
    }
  } else if (kind === 'passenger') {
    chassis(g, 0);
    put(g, part(rbox(0.72, 0.22, 0.42, 0.05), 0x3fbf6f), 0, 0.27, 0);
    for (const z of [-0.211, 0.211]) for (const x of [-0.24, -0.08, 0.08, 0.24]) put(g, part(box(0.1, 0.08, 0.012), 0xcdeeff, { line: 2 }), x, 0.3, z);
    put(g, part(rbox(0.77, 0.06, 0.47, 0.025), 0xfff3d6), 0, 0.41, 0);
    for (const x of [-0.2, 0, 0.2]) put(g, part(rbox(0.09, 0.04, 0.12, 0.015), 0xd9c79a, { line: 2 }), x, 0.45, 0);
  } else {
    // tank wagon
    chassis(g, 0);
    put(g, part(rbox(0.72, 0.04, 0.38, 0.015), 0x6b6f7a), 0, 0.17, 0);
    put(g, part(capsuleX(0.15, 0.36), 0xffc93c), 0, 0.33, 0);
    for (const x of [-0.13, 0.13]) put(g, part(cylX(0.155, 0.03), 0xd9930f, { line: 2 }), x, 0.33, 0);
    put(g, part(cylY(0.06, 0.07, 0.07), 0xffd966), 0, 0.5, 0);
  }
  return g;
}

function buildEngine() {
  const g = new THREE.Group();
  put(g, part(rbox(0.86, 0.07, 0.34, 0.02), 0x4a4a5a), 0, 0.14, 0);
  for (const x of [-0.27, -0.03, 0.21]) for (const z of [-0.17, 0.17]) {
    put(g, part(wheelGeo(0.1, 0.055), 0xe8483f), x, 0.1, z);
    put(g, part(wheelGeo(0.035, 0.06), 0xffffff, { line: false }), x, 0.1, z);
  }
  // white boiler with blue bands, dark smokebox at the front
  put(g, part(cylX(0.15, 0.48), 0xffffff), 0.1, 0.3, 0);
  for (const x of [-0.02, 0.18]) put(g, part(cylX(0.155, 0.035), 0x2f6fd1, { line: 2 }), x, 0.3, 0);
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
  return g;
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
    x.lineJoin = 'round'; x.lineWidth = 22; x.strokeStyle = '#2d2a3e';
    x.strokeText(String(n), 64, 70);
    x.fillStyle = '#ffffff'; x.fillText(String(n), 64, 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    numberTex.set(n, t);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
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
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    const k = `${mat.uuid}:${m.castShadow}:${m.receiveShadow}`;
    let b = buckets.get(k);
    if (!b) { b = { mat, cast: m.castShadow, recv: m.receiveShadow, geos: [] }; buckets.set(k, b); }
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
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
    // outlines are drawn after the ink colour has been pushed out along the (now baked) normals
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  return out;
}

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

  constructor(public W: number, public H: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const el = this.renderer.domElement;
    el.style.position = 'fixed';
    el.style.zIndex = '0';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    document.body.prepend(el);

    this.camera = new THREE.OrthographicCamera(0, W, 0, -H, 1, 30000);
    const D = 8000;
    this.camera.position.set(0, D * Math.sin(THETA), D * Math.cos(THETA));
    this.camera.lookAt(0, 0, 0);
    this.root.scale.z = 1 / SIN;
    this.scene.add(this.root);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c8a0, 1.9));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const cx = W / 2, cz = H / 2 / SIN;
    this.sun.position.set(cx - 900, 1600, cz - 300);
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
    const r = canvas.getBoundingClientRect();
    const el = this.renderer.domElement;
    const pr = Math.min(2, window.devicePixelRatio || 1);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    const sz = this.renderer.getSize(new THREE.Vector2());
    if (Math.round(sz.x) !== Math.round(r.width) || Math.round(sz.y) !== Math.round(r.height)) this.renderer.setSize(r.width, r.height, false);
    el.style.left = `${r.left}px`; el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`; el.style.height = `${r.height}px`;
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
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.H).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.groundTex }));
    ground.position.set(this.W / 2, 0, this.H / 2);
    this.board.add(ground);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(this.W * 1.2, this.H * 1.2).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: 0x1d3d14, opacity: 0.22 }));
    catcher.position.set(this.W / 2, 2, this.H / 2);
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

    // vehicles
    const add = (src: any, kind: string) => {
      const g = kind === 'engine' ? buildEngine() : buildCar(kind);
      if (src.num) {
        const sp = numberSprite(src.num);
        sp.scale.set(0.36, 0.36, 1);
        sp.position.set(0, 0.72, 0);
        g.add(sp);
      }
      this.board.add(g);
      this.vehicles.push({ src, g, kind });
    };
    add(S.engine, 'engine');
    for (const m of S.movers) add(m.v, m.v.kind);
    this.syncSwitches();
  }

  clear() {
    this.root.remove(this.board);
    this.board = new THREE.Group();
    this.vehicles = []; this.tokens.clear(); this.switches = []; this.portals = []; this.puffs = [];
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
        landed = Math.hypot(t.c.x - this.px(x + 0.5), t.c.y - this.py(y + 0.5)) < 2;
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
      v.g.scale.set(cell * sx, cell * (2 - sx), cell * sy);
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
    this.stepPuffs(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

let world: World | null = null;
export function getWorld(W: number, H: number) {
  if (!world) { world = new World(W, H); (window as any).__world = world; }
  return world;
}

/** 3D is on unless the address has ?2d in it (to compare with the flat version). */
export const USE_3D = typeof location !== 'undefined' && !/[?&]2d\b/.test(location.search);
export { DX, DY };
