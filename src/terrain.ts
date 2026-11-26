import Phaser from 'phaser';

// Soft background terrain: forests, ponds, a stream and meadows.
// Flat colours close to the grass and no dark outlines, so the track, carriages and pieces stay the loudest things on screen.

export interface Cell { x: number; y: number }
type Rnd = Phaser.Math.RandomDataGenerator;

const FOREST_SHADE = 0x4f9840, FOREST = 0x62ab4c, FOREST_LIGHT = 0x76bb5c;
const SHORE = 0x9ccf8a, WATER = 0x86c3d6, WATER_LIGHT = 0xa9d7e2;

/** A clump of tree crowns covering a set of cells (centres in px, cell size s). */
export function drawForest(g: Phaser.GameObjects.Graphics, cells: Cell[], s: number, rnd: Rnd) {
  const crowns: { x: number; y: number; r: number }[] = [];
  for (const c of cells) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      crowns.push({ x: c.x + rnd.realInRange(-0.3, 0.3) * s, y: c.y + rnd.realInRange(-0.3, 0.3) * s, r: rnd.realInRange(0.22, 0.32) * s });
    }
  }
  crowns.sort((a, b) => a.y - b.y);
  for (const k of crowns) g.fillStyle(FOREST_SHADE, 0.55).fillCircle(k.x + s * 0.05, k.y + s * 0.07, k.r);
  for (const k of crowns) g.fillStyle(FOREST).fillCircle(k.x, k.y, k.r);
  for (const k of crowns) g.fillStyle(FOREST_LIGHT).fillCircle(k.x - k.r * 0.3, k.y - k.r * 0.3, k.r * 0.45);
}

/** One pond spreading over a set of neighbouring cells. */
export function drawPond(g: Phaser.GameObjects.Graphics, cells: Cell[], s: number, rnd: Rnd) {
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
  layer(SHORE, 0.06);
  layer(WATER, 0.14);
  for (const c of cells) {
    if (rnd.frac() < 0.6) g.fillStyle(WATER_LIGHT).fillEllipse(c.x - s * 0.1, c.y - s * 0.1, s * 0.3, s * 0.08);
  }
}

/** A stream along a path of points (px). */
export function drawStream(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], width: number) {
  const stroke = (color: number, w: number) => {
    g.lineStyle(w, color);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
    for (const p of pts) g.fillStyle(color).fillCircle(p.x, p.y, w / 2);
  };
  stroke(SHORE, width * 1.5);
  stroke(WATER, width);
}

/** A few small, soft flowers on one cell. */
export function drawMeadow(g: Phaser.GameObjects.Graphics, c: Cell, s: number, rnd: Rnd) {
  for (let i = 0; i < 7; i++) {
    const x = c.x + rnd.realInRange(-0.35, 0.35) * s, y = c.y + rnd.realInRange(-0.35, 0.35) * s;
    g.fillStyle(rnd.pick([0xf2e9a0, 0xf3c9d6, 0xffffff]), 0.8).fillCircle(x, y, s * 0.035);
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
