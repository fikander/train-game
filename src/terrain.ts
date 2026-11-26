import Phaser from 'phaser';
import type { Biome } from './levels';

// Soft background terrain: forests, ponds, a stream and meadows.
// Flat colours close to the grass and no dark outlines, so the track, carriages and pieces stay the loudest things on screen.

export interface Cell { x: number; y: number }
type Rnd = Phaser.Math.RandomDataGenerator;

/** Colours for each biome. Everything stays close to the ground colour so gameplay pieces stand out. */
export const PAL = {
  meadow: {
    ground: 0x7cc85a, patches: [0x86d063, 0x72bd50, 0x8ad668], specks: [0x4f8f36, 0x9ee07a], board: 0xa6dd7c, lines: 0x3f7a2c,
    shade: 0x4f9840, crown: 0x62ab4c, light: 0x76bb5c, shore: 0x9ccf8a, water: 0x86c3d6, waterLight: 0xa9d7e2,
    flowers: [0xf2e9a0, 0xf3c9d6, 0xffffff], hill: 0x6fb553, hillLight: 0x84c766, fade: [124, 200, 90],
  },
  desert: {
    ground: 0xe9c98a, patches: [0xefd39a, 0xe2bf7c, 0xf2d9a6], specks: [0xc79a5a, 0xfbe7bf], board: 0xf6deaa, lines: 0xa87a3e,
    shade: 0xc39a62, crown: 0xd8b07a, light: 0xe6c393, shore: 0xd9c690, water: 0x7fc2c9, waterLight: 0xa8dbe0,
    flowers: [0xc79a5a, 0xb88a4e, 0xf7e3bb], hill: 0xdcb47a, hillLight: 0xe8c690, fade: [233, 201, 138],
  },
  snow: {
    ground: 0xe8f0f6, patches: [0xf3f7fb, 0xdde8f1, 0xf8fbfd], specks: [0xc5d6e4, 0xffffff], board: 0xf8fbfd, lines: 0x8ea8bf,
    shade: 0x9fb4c4, crown: 0x5f8f7a, light: 0xf5f9fc, shore: 0xd2e2ee, water: 0xbcd9ec, waterLight: 0xf0f7fc,
    flowers: [0xffffff, 0xd6e4ef, 0xc5d6e4], hill: 0xdbe6ee, hillLight: 0xf7fafc, fade: [214, 228, 238],
  },
};

/** Textured ground for a whole screen. */
export function drawGround(g: Phaser.GameObjects.Graphics, b: Biome, rnd: Rnd, w: number, h: number) {
  const P = PAL[b];
  g.fillStyle(P.ground).fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) g.fillStyle(rnd.pick(P.patches), 0.75).fillCircle(rnd.between(0, w), rnd.between(0, h), rnd.between(40, 120));
  for (let i = 0; i < 900; i++) g.fillStyle(rnd.pick(P.specks), 0.55).fillCircle(rnd.between(0, w), rnd.between(0, h), rnd.between(1, 3));
}

/** A clump of trees (meadow), snowy pines (snow) or rocks and cacti (desert) covering a set of cells. */
export function drawForest(g: Phaser.GameObjects.Graphics, cells: Cell[], s: number, rnd: Rnd, b: Biome = 'meadow') {
  const P = PAL[b];
  const crowns: { x: number; y: number; r: number }[] = [];
  for (const c of cells) {
    for (let i = 0; i < 3; i++) {
      crowns.push({ x: c.x + rnd.realInRange(-0.3, 0.3) * s, y: c.y + rnd.realInRange(-0.3, 0.3) * s, r: rnd.realInRange(0.22, 0.32) * s });
    }
  }
  crowns.sort((a, b) => a.y - b.y);
  for (const k of crowns) g.fillStyle(P.shade, 0.55).fillCircle(k.x + s * 0.05, k.y + s * 0.07, k.r);
  if (b === 'snow') {
    // pines from above: dark green crowns with a snowy top
    for (const k of crowns) g.fillStyle(P.crown).fillCircle(k.x, k.y, k.r);
    for (const k of crowns) g.fillStyle(P.light).fillCircle(k.x - k.r * 0.15, k.y - k.r * 0.2, k.r * 0.62);
    for (const k of crowns) g.fillStyle(P.crown, 0.5).fillCircle(k.x, k.y, k.r * 0.16);
  } else if (b === 'desert') {
    // sandstone boulders, with the odd cactus
    crowns.forEach((k, i) => {
      if (i % 3 === 2) {
        const w = k.r * 0.42;
        g.fillStyle(0x8fae6a).fillRoundedRect(k.x - w / 2, k.y - k.r, w, k.r * 2, w / 2);
        g.fillRoundedRect(k.x - k.r * 0.75, k.y - k.r * 0.35, k.r * 0.75, w * 0.8, w * 0.4);
        g.fillStyle(0xa4c07f).fillRoundedRect(k.x - w * 0.2, k.y - k.r * 0.85, w * 0.35, k.r * 1.6, w * 0.2);
      } else {
        g.fillStyle(P.crown).fillEllipse(k.x, k.y, k.r * 2, k.r * 1.6);
        g.fillStyle(P.light).fillEllipse(k.x - k.r * 0.25, k.y - k.r * 0.25, k.r * 0.9, k.r * 0.6);
      }
    });
  } else {
    for (const k of crowns) g.fillStyle(P.crown).fillCircle(k.x, k.y, k.r);
    for (const k of crowns) g.fillStyle(P.light).fillCircle(k.x - k.r * 0.3, k.y - k.r * 0.3, k.r * 0.45);
  }
}

/** One pond (an oasis in the desert, a frozen lake in the snow) spreading over a set of neighbouring cells. */
export function drawPond(g: Phaser.GameObjects.Graphics, cells: Cell[], s: number, rnd: Rnd, b: Biome = 'meadow') {
  const P = PAL[b];
  const has = (x: number, y: number) => cells.some(c => Math.abs(c.x - x) < 1 && Math.abs(c.y - y) < 1);
  const layer = (color: number, inset: number) => {
    g.fillStyle(color);
    for (const c of cells) {
      const h = s / 2 - inset * s;
      g.fillRoundedRect(c.x - h, c.y - h, h * 2, h * 2, h * 0.9);
      // bridge to neighbours so the pond is one shape
      if (has(c.x + s, c.y)) g.fillRect(c.x, c.y - h, s, h * 2);
      if (has(c.x, c.y + s)) g.fillRect(c.x - h, c.y, h * 2, s);
    }
  };
  layer(P.shore, 0.06);
  layer(P.water, 0.14);
  for (const c of cells) {
    if (b === 'snow') {
      // cracks in the ice
      g.lineStyle(s * 0.02, P.waterLight).lineBetween(c.x - s * 0.2, c.y - s * 0.1, c.x + s * 0.05, c.y + s * 0.05).lineBetween(c.x + s * 0.05, c.y + s * 0.05, c.x + s * 0.2, c.y - s * 0.05);
    } else if (rnd.frac() < 0.6) g.fillStyle(P.waterLight).fillEllipse(c.x - s * 0.1, c.y - s * 0.1, s * 0.3, s * 0.08);
  }
  if (b === 'desert') {
    // a palm or two on the shore of the oasis
    const c = cells[0];
    for (const [dx, dy] of [[-0.42, -0.38], [0.4, 0.36]]) {
      const x = c.x + dx * s, y = c.y + dy * s;
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5;
        g.fillStyle(0x7fa35a).fillEllipse(x + Math.cos(a) * s * 0.09, y + Math.sin(a) * s * 0.09, s * 0.2, s * 0.08);
      }
      g.fillStyle(0x9a7a4e).fillCircle(x, y, s * 0.04);
    }
  }
}

/** A stream along a path of points (px). */
export function drawStream(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], width: number, b: Biome = 'meadow') {
  const P = PAL[b];
  const stroke = (color: number, w: number) => {
    g.lineStyle(w, color);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
    for (const p of pts) g.fillStyle(color).fillCircle(p.x, p.y, w / 2);
  };
  stroke(P.shore, width * 1.5);
  stroke(P.water, width);
}

/** A few small, soft flowers on one cell. */
export function drawMeadow(g: Phaser.GameObjects.Graphics, c: Cell, s: number, rnd: Rnd, b: Biome = 'meadow') {
  for (let i = 0; i < 7; i++) {
    const x = c.x + rnd.realInRange(-0.35, 0.35) * s, y = c.y + rnd.realInRange(-0.35, 0.35) * s;
    g.fillStyle(rnd.pick(PAL[b].flowers), 0.8).fillCircle(x, y, s * 0.035);
  }
}

/**
 * A hill over a run of tunnel squares (centres in px), with a dark portal at each open end.
 * `ends` are the points (px) where the track goes in and out, with the direction it faces outwards.
 */
export function drawHill(g: Phaser.GameObjects.Graphics, cells: Cell[], s: number, b: Biome, ends: { x: number; y: number; a: number }[]) {
  const P = PAL[b];
  for (const c of cells) g.fillStyle(0x000000, 0.12).fillCircle(c.x + s * 0.06, c.y + s * 0.08, s * 0.56);
  for (const c of cells) g.fillStyle(P.hill).fillCircle(c.x, c.y, s * 0.56);
  for (const c of cells) g.fillStyle(P.hillLight).fillCircle(c.x - s * 0.12, c.y - s * 0.14, s * 0.3);
  if (b === 'snow') for (const c of cells) g.fillStyle(0xffffff).fillCircle(c.x - s * 0.06, c.y - s * 0.1, s * 0.18);
  for (const e of ends) {
    // stone arch and a dark hole, facing out along the track
    const nx = Math.cos(e.a), ny = Math.sin(e.a);
    const px = -ny, py = nx;
    const pts = (r: number, depth: number) => {
      const out: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = -Math.PI / 2 + Math.PI * i / 12;
        out.push(new Phaser.Math.Vector2(e.x + px * Math.sin(t) * r - nx * Math.cos(t) * depth, e.y + py * Math.sin(t) * r - ny * Math.cos(t) * depth));
      }
      return out;
    };
    g.fillStyle(0x8c8a86).fillPoints(pts(s * 0.42, s * 0.2), true);
    g.fillStyle(0x2b2433).fillPoints(pts(s * 0.32, s * 0.14), true);
  }
}

/** Split cells into 4-connected groups. */
export function regions(cells: Cell[]): Cell[][] {
  const left = new Set(cells.map(c => `${c.x},${c.y}`));
  const out: Cell[][] = [];
  for (const c of cells) {
    const k0 = `${c.x},${c.y}`;
    if (!left.has(k0)) continue;
    left.delete(k0);
    const group: Cell[] = [], todo = [c];
    while (todo.length) {
      const q = todo.pop()!;
      group.push(q);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${q.x + dx},${q.y + dy}`;
        if (left.has(k)) { left.delete(k); todo.push({ x: q.x + dx, y: q.y + dy }); }
      }
    }
    out.push(group);
  }
  return out;
}
