import Phaser from 'phaser';
import { cellPath, opp, sides, type Dir, type Piece, type Pt } from './track';

import { REF, VEH } from './sim';
export { REF, VEH };
const INK = 0x2d2a3e;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function outlinedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, fill: number, ink = 5) {
  g.fillStyle(INK).fillRoundedRect(x - ink, y - ink, w + ink * 2, h + ink * 2, r + ink * 0.6);
  g.fillStyle(fill).fillRoundedRect(x, y, w, h, r);
}
function outlinedCircle(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, ink = 5) {
  g.fillStyle(INK).fillCircle(x, y, r + ink);
  g.fillStyle(fill).fillCircle(x, y, r);
}

// Vehicles are seen from high above. Each has a "base" (chassis + sides, drawn on the ground) and a "top"
// (roof/boiler, drawn raised up the screen), which together give a chunky 3D look from any direction.
// All face +x. Engine 200 x 110 px, carriages 172 x 104 px at REF scale.

function chassis(g: Phaser.GameObjects.Graphics, w: number, h: number, side: number, sideDark: number) {
  // couplers
  g.fillStyle(INK).fillRect(0, h / 2 - 7, 14, 14).fillRect(w - 14, h / 2 - 7, 14, 14);
  // wheels peeking out
  for (const x of [w * 0.25, w * 0.75]) {
    g.fillStyle(INK).fillRoundedRect(x - 18, 4, 36, h - 8, 8);
  }
  outlinedRect(g, 12, 12, w - 24, h - 24, 12, sideDark);
  g.fillStyle(side).fillRoundedRect(18, 18, w - 36, h - 36, 8);
}

export function makeTextures(scene: Phaser.Scene) {
  const E = VEH.engine, C = VEH.car;
  // --- white steam engine ---
  make(scene, 'engine-base', E.w, E.h, g => {
    g.fillStyle(INK).fillRect(0, E.h / 2 - 7, 14, 14);
    for (const x of [40, 95, 140]) g.fillStyle(INK).fillRoundedRect(x - 16, 4, 32, E.h - 8, 8);
    g.fillStyle(0xe8483f).fillRoundedRect(28, 8, 124, 8, 3).fillRoundedRect(28, E.h - 16, 124, 8, 3);
    outlinedRect(g, 12, 16, 168, E.h - 32, 12, 0xaeb4bd);
    // red cowcatcher at the front
    g.fillStyle(INK).fillTriangle(172, 10, 200, E.h / 2, 172, E.h - 10);
    g.fillStyle(0xe8483f).fillTriangle(176, 20, 192, E.h / 2, 176, E.h - 20);
  });
  make(scene, 'engine-top', E.w, E.h, g => {
    // boiler (a white cylinder seen from above)
    outlinedRect(g, 64, 26, 110, 58, 26, 0xffffff);
    g.fillStyle(0xffffff, 1).fillRoundedRect(76, 34, 90, 10, 5);
    g.fillStyle(0x2f6fd1).fillRect(96, 26, 8, 58).fillRect(132, 26, 8, 58);
    // dome
    outlinedCircle(g, 116, 55, 11, 0xffc93c, 4);
    // cab with blue roof
    outlinedRect(g, 10, 12, 62, E.h - 24, 10, 0x2f6fd1);
    g.fillStyle(0x6fa3f0).fillRoundedRect(18, 20, 46, 10, 5);
    g.lineStyle(3, 0x1d4a8f).lineBetween(41, 16, 41, E.h - 16);
  });
  make(scene, 'engine-chimney', 44, 44, g => {
    outlinedCircle(g, 22, 22, 15, 0x4a4a5a, 5);
    g.fillStyle(0x1b1a24).fillCircle(22, 22, 9);
  });

  // --- carriages ---
  make(scene, 'coal-base', C.w, C.h, g => chassis(g, C.w, C.h, 0xc8343b, 0x9e2730));
  make(scene, 'coal-top', C.w, C.h, g => {
    outlinedRect(g, 16, 14, C.w - 32, C.h - 28, 10, 0xe8483f);
    g.fillStyle(0x2b2a33).fillRoundedRect(26, 24, C.w - 52, C.h - 48, 6);
    const lumps = [[40, 34], [62, 40], [86, 33], [110, 41], [132, 35], [48, 58], [74, 62], [98, 56], [122, 62], [140, 55], [60, 76], [92, 74], [118, 78]];
    for (const [x, y] of lumps) { g.fillStyle(0x15141b).fillCircle(x, y, 12); g.fillStyle(0x4a4955).fillCircle(x, y, 9); g.fillStyle(0x7b7a88).fillCircle(x - 3, y - 3, 3); }
    g.fillStyle(0xff7a7f).fillRoundedRect(24, 17, C.w - 48, 4, 2);
  });
  make(scene, 'passenger-base', C.w, C.h, g => {
    chassis(g, C.w, C.h, 0x3fbf6f, 0x2a9a55);
    // windows along the sides
    for (let x = 30; x < C.w - 40; x += 30) {
      g.fillStyle(INK).fillRoundedRect(x - 2, C.h - 28, 22, 12, 3);
      g.fillStyle(0xcdeeff).fillRoundedRect(x, C.h - 26, 18, 8, 2);
    }
  });
  make(scene, 'passenger-top', C.w, C.h, g => {
    outlinedRect(g, 10, 12, C.w - 20, C.h - 24, 14, 0xfff3d6);
    g.fillStyle(0x1f8a4c).fillRoundedRect(10, C.h / 2 - 5, C.w - 20, 10, 2);
    for (const x of [48, 86, 124]) outlinedRect(g, x - 10, 26, 20, 14, 4, 0xd9c79a, 3);
  });
  make(scene, 'tank-base', C.w, C.h, g => chassis(g, C.w, C.h, 0x6b6f7a, 0x4a4e58));
  make(scene, 'tank-top', C.w, C.h, g => {
    outlinedRect(g, 14, 20, C.w - 28, C.h - 40, (C.h - 40) / 2, 0xffc93c);
    g.fillStyle(0xfff1b8).fillRoundedRect(34, 28, C.w - 68, 8, 4);
    g.fillStyle(0xd9930f).fillRect(56, 20, 6, C.h - 40).fillRect(110, 20, 6, C.h - 40);
    outlinedCircle(g, C.w / 2, C.h / 2 - 4, 13, 0xffd966, 4);
    g.fillStyle(INK).fillCircle(C.w / 2, C.h / 2 - 4, 4);
  });

  make(scene, 'puff', 80, 80, g => {
    g.fillStyle(0xb9c2cc).fillCircle(42, 44, 34);
    g.fillStyle(0xffffff).fillCircle(38, 38, 32);
    g.fillStyle(0xffffff, 1).fillCircle(30, 30, 12);
  });
  make(scene, 'confetti', 16, 26, g => { g.fillStyle(0xffffff).fillRect(0, 0, 16, 26); });
  make(scene, 'star', 80, 80, g => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 16 : 38, a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push(new Phaser.Math.Vector2(40 + Math.cos(a) * r, 40 + Math.sin(a) * r));
    }
    g.fillStyle(0xffd23f).fillPoints(pts, true);
    g.lineStyle(4, 0xf59e0b).strokePoints(pts, true);
  });

  // --- scenery, seen from above, with shadows falling down-right ---
  const SH = 0x2f5e24;
  make(scene, 'tree', REF, REF, g => {
    g.fillStyle(SH, 0.35).fillCircle(118, 122, 62);
    g.fillStyle(0x6b4423).fillRoundedRect(92, 120, 18, 40, 6);
    outlinedCircle(g, 100, 92, 60, 0x2f8f3a, 6);
    g.fillStyle(0x3fa64a).fillCircle(90, 82, 44);
    g.fillStyle(0x5cc062).fillCircle(78, 70, 22);
    g.fillStyle(0xe8483f).fillCircle(64, 104, 7).fillCircle(122, 64, 7).fillCircle(132, 110, 7);
  });
  make(scene, 'pine', REF, REF, g => {
    g.fillStyle(SH, 0.35).fillEllipse(124, 128, 120, 90);
    for (const [r, c] of [[62, 0x1f6b3a], [46, 0x2a8a4a], [30, 0x3aa65c], [14, 0x57c178]] as const) {
      const pts = [] as Phaser.Math.Vector2[];
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * 0.78 : r; pts.push(new Phaser.Math.Vector2(100 + Math.cos(a) * rr, 96 + Math.sin(a) * rr - (62 - r) * 0.4)); }
      g.fillStyle(INK).fillPoints(pts.map(p => new Phaser.Math.Vector2(100 + (p.x - 100) * 1.08, 96 + (p.y - 96) * 1.08)), true);
      g.fillStyle(c).fillPoints(pts, true);
    }
  });
  make(scene, 'bush', REF, REF, g => {
    g.fillStyle(SH, 0.35).fillEllipse(116, 124, 130, 70);
    for (const [x, y, r] of [[72, 104, 32], [128, 104, 32], [100, 84, 38]] as const) outlinedCircle(g, x, y, r, 0x3a9e45, 5);
    g.fillStyle(0x3a9e45).fillCircle(72, 104, 32).fillCircle(128, 104, 32).fillCircle(100, 84, 38);
    g.fillStyle(0x5cc062).fillCircle(88, 76, 16).fillCircle(124, 96, 12);
    g.fillStyle(0xff8fb1).fillCircle(70, 96, 6).fillCircle(112, 70, 6).fillCircle(136, 110, 6);
  });
  make(scene, 'rock', REF, REF, g => {
    g.fillStyle(SH, 0.35).fillEllipse(112, 118, 120, 70);
    outlinedRect(g, 52, 64, 96, 66, 26, 0x9a948c, 6);
    g.fillStyle(0xbdb7ae).fillRoundedRect(60, 68, 70, 30, 14);
    outlinedCircle(g, 140, 128, 16, 0x9a948c, 5);
  });
  make(scene, 'flowers', REF, REF, g => {
    const fl = [[55, 70, 0xff6fa5], [120, 55, 0xffd23f], [150, 120, 0xffffff], [80, 135, 0xa78bfa], [110, 100, 0xff8a3d]] as const;
    for (const [x, y, c] of fl) {
      g.fillStyle(0x2f8f3a).fillCircle(x + 6, y + 8, 14);
      g.fillStyle(INK);
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; g.fillCircle(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 11); }
      g.fillStyle(c);
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; g.fillCircle(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 8); }
      g.fillStyle(0xffb020).fillCircle(x, y, 6);
    }
  });
  make(scene, 'pond', REF, REF, g => {
    g.fillStyle(INK).fillEllipse(100, 102, 184, 134);
    g.fillStyle(0x3f97d6).fillEllipse(100, 102, 172, 122);
    g.fillStyle(0x6fc0f0).fillEllipse(86, 90, 110, 56);
    g.lineStyle(4, 0xffffff, 0.8).beginPath().arc(70, 84, 26, Math.PI * 1.1, Math.PI * 1.5).strokePath();
    // duck from above
    outlinedCircle(g, 126, 112, 16, 0xffd23f, 4);
    outlinedCircle(g, 138, 100, 9, 0xffd23f, 4);
    g.fillStyle(0xff8a3d).fillTriangle(144, 94, 154, 92, 146, 102);
  });
  make(scene, 'cow', REF, REF, g => {
    g.fillStyle(SH, 0.35).fillEllipse(110, 112, 150, 80);
    outlinedRect(g, 40, 70, 104, 60, 28, 0xffffff, 6);
    g.fillStyle(INK).fillCircle(70, 86, 12).fillCircle(112, 112, 10).fillCircle(124, 80, 7);
    outlinedCircle(g, 156, 100, 24, 0xffffff, 6);
    g.fillStyle(0xffb3c1).fillEllipse(170, 100, 18, 26);
    g.fillStyle(INK).fillCircle(156, 90, 3.5).fillCircle(156, 110, 3.5);
    g.fillStyle(0xd9a514).fillCircle(146, 78, 6).fillCircle(146, 122, 6);
    g.lineStyle(6, INK).lineBetween(40, 100, 26, 108);
  });
}

// ---------- Track drawing (into a Graphics centred on a cell) ----------

function toLocal(pts: Pt[], s: number): Pt[] {
  return pts.map(p => ({ x: (p.x - 0.5) * s, y: (p.y - 0.5) * s }));
}

function offsetLine(pts: Pt[], off: number): Phaser.Math.Vector2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return new Phaser.Math.Vector2(p.x - dy / l * off, p.y + dx / l * off);
  });
}

export function drawRails(g: Phaser.GameObjects.Graphics, a: Dir, b: Dir, s: number, fixed: boolean, alpha = 1, railColor = 0xf4f4ef) {
  const pts = toLocal(cellPath(0, 0, a, b, 16), s);
  const sleeperColor = fixed ? 0x9b6a3e : 0xc98a4b;
  const sleeperDark = INK;
  // sleepers
  const n = a === opp(b) ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const idx = Math.round(((i + 0.5) / n) * (pts.length - 1));
    const p = pts[idx], q = pts[Math.min(idx + 1, pts.length - 1)], r = pts[Math.max(idx - 1, 0)];
    const dx = q.x - r.x, dy = q.y - r.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, half = s * 0.31;
    g.lineStyle(s * 0.14, sleeperDark, alpha).lineBetween(p.x - nx * half, p.y - ny * half, p.x + nx * half, p.y + ny * half);
    g.lineStyle(s * 0.09, sleeperColor, alpha).lineBetween(p.x - nx * half, p.y - ny * half, p.x + nx * half, p.y + ny * half);
  }
  for (const off of [-0.16, 0.16]) {
    const line = offsetLine(pts, off * s);
    g.lineStyle(s * 0.085, INK, alpha).strokePoints(line, false);
    g.lineStyle(s * 0.05, railColor, alpha).strokePoints(line, false);
  }
}

/** Draw any piece's track into `g` (centred at 0,0, s = cell size in px). */
export function drawPiece(g: Phaser.GameObjects.Graphics, p: Piece, s: number) {
  g.clear();
  const fixed = p.fixed;
  switch (p.type) {
    case 'straight':
    case 'curve': {
      const [a, b] = sides(p);
      drawRails(g, a, b, s, fixed);
      break;
    }
    case 'engine': {
      drawRails(g, opp(p.rot), p.rot as Dir, s, true);
      break;
    }
    case 'car':
    case 'start': {
      const d = p.rot as Dir;
      drawRails(g, opp(d), d, s, true);
      if (p.type === 'car' && !p.buffer) break;
      // buffer stop at the back
      const bx = -Math.cos(dirAngle(d)) * s * 0.42, by = -Math.sin(dirAngle(d)) * s * 0.42;
      const horiz = d % 2 === 1;
      g.fillStyle(INK).fillRoundedRect(bx - (horiz ? s * 0.07 : s * 0.3), by - (horiz ? s * 0.3 : s * 0.07), horiz ? s * 0.14 : s * 0.6, horiz ? s * 0.6 : s * 0.14, 6);
      g.fillStyle(0xe8483f).fillRoundedRect(bx - (horiz ? s * 0.05 : s * 0.28), by - (horiz ? s * 0.28 : s * 0.05), horiz ? s * 0.1 : s * 0.56, horiz ? s * 0.56 : s * 0.1, 4);
      break;
    }
    case 'end': {
      const d = p.rot as Dir; // open side
      drawRails(g, d, opp(d), s, true);
      const bx = Math.cos(dirAngle(d)) * s * 0.05, by = Math.sin(dirAngle(d)) * s * 0.05;
      const horiz = d % 2 === 1;
      const w = horiz ? s * 0.16 : s * 0.7, h = horiz ? s * 0.7 : s * 0.16;
      g.fillStyle(INK).fillRoundedRect(bx - w / 2 - 4, by - h / 2 - 4, w + 8, h + 8, 8);
      g.fillStyle(0xe8483f).fillRoundedRect(bx - w / 2, by - h / 2, w, h, 6);
      g.fillStyle(0xffffff).fillRoundedRect(bx - w / 2 + (horiz ? w * 0.25 : w * 0.1), by - h / 2 + (horiz ? h * 0.1 : h * 0.25), horiz ? w * 0.5 : w * 0.8, horiz ? h * 0.8 : h * 0.5, 3);
      break;
    }
    case 'exit': {
      const d = p.rot as Dir;
      drawRails(g, opp(d), d, s, true);
      break;
    }
    case 'switch': {
      if (p.junction) { drawRails(g, p.inDir!, p.out1!, s, true); drawRails(g, p.inDir!, p.out2!, s, true); break; }
      const active = p.state ? p.out2! : p.out1!;
      const inactive = p.state ? p.out1! : p.out2!;
      drawRails(g, p.inDir!, inactive, s, true, 0.45, 0x8e969e);
      drawRails(g, p.inDir!, active, s, true, 1, 0xffe066);
      break;
    }
  }
}

export function dirAngle(d: number) { return [-Math.PI / 2, 0, Math.PI / 2, Math.PI][d]; }

/** Tunnel mouth drawn over the far half of an exit cell; drawn facing +x then rotated by the caller. */
export function drawTunnel(g: Phaser.GameObjects.Graphics, s: number) {
  g.clear();
  g.fillStyle(0x000000, 0.15).fillEllipse(s * 0.32, s * 0.04, s * 0.78, s * 1.12);
  g.fillStyle(0x6b8f3a).fillEllipse(s * 0.3, 0, s * 0.72, s * 1.05);
  g.fillStyle(0x86b04a).fillEllipse(s * 0.34, -s * 0.06, s * 0.5, s * 0.8);
  // stone arch + dark hole facing -x
  g.fillStyle(0x9a948c).fillEllipse(s * 0.02, 0, s * 0.28, s * 0.66);
  g.fillStyle(0x2b2433).fillEllipse(s * 0.0, 0, s * 0.18, s * 0.5);
  g.fillStyle(0xffffff, 0.6).fillCircle(s * 0.4, -s * 0.25, s * 0.05).fillCircle(s * 0.5, s * 0.2, s * 0.04);
}

/** Flag-like arrow drawn on a switch to show where it points. */
export function drawSwitchMarker(g: Phaser.GameObjects.Graphics, p: Piece, s: number) {
  g.clear();
  const active = (p.state ? p.out2 : p.out1)!;
  const pts = cellPath(0, 0, p.inDir!, active, 16);
  const m = pts[Math.round(pts.length * 0.72)];
  const n = pts[Math.min(pts.length - 1, Math.round(pts.length * 0.72) + 2)];
  const x = (m.x - 0.5) * s, y = (m.y - 0.5) * s;
  const ang = Math.atan2(n.y - m.y, n.x - m.x);
  const tri = [
    [s * 0.16, 0], [-s * 0.1, -s * 0.13], [-s * 0.1, s * 0.13],
  ].map(([px, py]) => new Phaser.Math.Vector2(x + px * Math.cos(ang) - py * Math.sin(ang), y + px * Math.sin(ang) + py * Math.cos(ang)));
  g.fillStyle(INK).fillCircle(x, y, s * 0.2);
  g.fillStyle(0xffd23f).fillCircle(x, y, s * 0.17);
  g.fillStyle(INK).fillPoints(tri, true);
  // lever by the in-side
  const ia = dirAngle(p.inDir!);
  const lx = Math.cos(ia) * s * 0.3 + Math.cos(ia + Math.PI / 2) * s * 0.32;
  const ly = Math.sin(ia) * s * 0.3 + Math.sin(ia + Math.PI / 2) * s * 0.32;
  g.fillStyle(INK).fillCircle(lx, ly, s * 0.09);
  g.fillStyle(p.state ? 0x3fbf6f : 0xe8483f).fillCircle(lx, ly, s * 0.065);
}
