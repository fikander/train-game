import Phaser from 'phaser';
import { cellPath, opp, sides, type Dir, type Piece, type Pt } from './track';

export const REF = 200; // texture resolution: pixels per grid cell
const INK = 0x2d2a3e;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function wheel(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
  g.fillStyle(INK).fillCircle(x, y, r + 4);
  g.fillStyle(0x4a4a5a).fillCircle(x, y, r);
  g.fillStyle(0xe8483f).fillCircle(x, y, r * 0.45);
  g.fillStyle(0xffffff, 0.5).fillCircle(x - r * 0.3, y - r * 0.3, r * 0.15);
}

function outlinedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, fill: number) {
  g.fillStyle(INK).fillRoundedRect(x - 4, y - 4, w + 8, h + 8, r + 3);
  g.fillStyle(fill).fillRoundedRect(x, y, w, h, r);
}

function face(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
  g.fillStyle(INK).fillCircle(cx, cy, r + 4);
  g.fillStyle(0xf4f1ea).fillCircle(cx, cy, r);
  // eyes
  for (const ex of [-0.38, 0.32]) {
    g.fillStyle(0xffffff).fillEllipse(cx + ex * r, cy - 0.22 * r, 0.42 * r, 0.52 * r);
    g.lineStyle(3, INK).strokeEllipse(cx + ex * r, cy - 0.22 * r, 0.42 * r, 0.52 * r);
    g.fillStyle(INK).fillCircle(cx + ex * r + 0.07 * r, cy - 0.18 * r, 0.12 * r);
    g.fillStyle(0xffffff).fillCircle(cx + ex * r + 0.1 * r, cy - 0.24 * r, 0.04 * r);
  }
  // cheeks
  g.fillStyle(0xff8a9a, 0.8).fillCircle(cx - 0.62 * r, cy + 0.25 * r, 0.14 * r).fillCircle(cx + 0.6 * r, cy + 0.25 * r, 0.14 * r);
  // smile
  g.lineStyle(5, INK);
  g.beginPath();
  g.arc(cx, cy + 0.12 * r, 0.38 * r, 0.15 * Math.PI, 0.85 * Math.PI, false);
  g.strokePath();
}

export function makeTextures(scene: Phaser.Scene) {
  // White steam engine, facing right. 200 x 170, rails at y ~ 135
  make(scene, 'engine', 210, 170, g => {
    g.fillStyle(0x000000, 0.15).fillEllipse(105, 150, 190, 22);
    outlinedRect(g, 10, 104, 185, 18, 6, 0xc8343b); // chassis
    // cab
    outlinedRect(g, 6, 18, 80, 16, 8, 0x2f6fd1); // roof
    outlinedRect(g, 14, 32, 64, 76, 6, 0xffffff);
    g.fillStyle(INK).fillRoundedRect(26, 44, 40, 30, 8);
    g.fillStyle(0xbfe6ff).fillRoundedRect(30, 48, 32, 22, 6);
    // boiler
    outlinedRect(g, 74, 56, 100, 52, 22, 0xffffff);
    g.fillStyle(0x2f6fd1).fillRect(100, 56, 9, 52).fillRect(138, 56, 9, 52);
    // dome
    g.fillStyle(INK).fillCircle(118, 56, 16);
    g.fillStyle(0xffc93c).fillCircle(118, 56, 12);
    g.fillStyle(0xffffff).fillRect(100, 57, 40, 4);
    // chimney
    outlinedRect(g, 146, 20, 18, 38, 3, 0x3b3b4a);
    outlinedRect(g, 140, 12, 30, 12, 5, 0x3b3b4a);
    // face on the smokebox front
    face(g, 172, 82, 28);
    // cowcatcher
    g.fillStyle(INK).fillTriangle(178, 104, 208, 136, 178, 136);
    g.fillStyle(0xe8483f).fillTriangle(182, 110, 200, 132, 182, 132);
    wheel(g, 50, 128, 22);
    wheel(g, 104, 128, 22);
    wheel(g, 160, 134, 14);
    // connecting rod
    g.fillStyle(0x9aa3ad).fillRoundedRect(46, 124, 64, 8, 4);
  });

  const carBase = (g: Phaser.GameObjects.Graphics) => {
    g.fillStyle(0x000000, 0.15).fillEllipse(90, 150, 170, 20);
    g.fillStyle(INK).fillRect(0, 112, 12, 8).fillRect(168, 112, 12, 8); // couplers
    outlinedRect(g, 12, 106, 156, 14, 5, 0x4a4a5a);
    wheel(g, 48, 130, 18);
    wheel(g, 132, 130, 18);
  };

  make(scene, 'car-coal', 180, 170, g => {
    carBase(g);
    // coal lumps
    const lumps = [[30, 52], [50, 44], [72, 50], [92, 42], [112, 50], [134, 44], [152, 52], [62, 58], [102, 58], [142, 60]];
    for (const [x, y] of lumps) { g.fillStyle(INK).fillCircle(x, y, 17); g.fillStyle(0x3a3a44).fillCircle(x, y, 13); g.fillStyle(0x6a6a78).fillCircle(x - 4, y - 4, 4); }
    outlinedRect(g, 16, 58, 148, 50, 8, 0xe8483f);
    g.fillStyle(0xb8323a).fillRect(16, 92, 148, 16);
    g.fillStyle(0xffffff, 0.35).fillRoundedRect(24, 64, 132, 8, 4);
    for (const x of [56, 90, 124]) g.fillStyle(0xb8323a).fillRect(x, 58, 6, 50);
  });

  make(scene, 'car-passenger', 180, 170, g => {
    carBase(g);
    outlinedRect(g, 8, 24, 164, 16, 8, 0x1f8a4c); // roof
    outlinedRect(g, 14, 38, 152, 70, 8, 0x3fbf6f);
    g.fillStyle(0xfff3b0).fillRect(14, 92, 152, 6);
    const skins = [0xffd2a6, 0xc68a5b, 0xffe0c2];
    const hair = [0x6b3e1f, 0x222222, 0xf2c14e];
    [26, 72, 118].forEach((x, i) => {
      g.fillStyle(INK).fillRoundedRect(x - 3, 47, 42, 38, 8);
      g.fillStyle(0xcdeeff).fillRoundedRect(x, 50, 36, 32, 6);
      // a little passenger
      g.fillStyle(hair[i]).fillCircle(x + 18, 64, 12);
      g.fillStyle(skins[i]).fillCircle(x + 18, 68, 10);
      g.fillStyle(INK).fillCircle(x + 14, 67, 2).fillCircle(x + 22, 67, 2);
      g.lineStyle(2, INK).beginPath().arc(x + 18, 70, 4, 0.1 * Math.PI, 0.9 * Math.PI, false).strokePath();
    });
  });

  make(scene, 'car-tank', 180, 170, g => {
    carBase(g);
    g.fillStyle(INK).fillRoundedRect(84, 22, 20, 22, 4);
    g.fillStyle(0xd9a514).fillRoundedRect(88, 26, 12, 18, 3);
    outlinedRect(g, 14, 40, 152, 66, 33, 0xffc93c);
    g.fillStyle(0xd9a514).fillRect(52, 40, 8, 66).fillRect(120, 40, 8, 66);
    g.fillStyle(0xffffff, 0.45).fillRoundedRect(30, 50, 120, 10, 5);
  });

  make(scene, 'puff', 80, 80, g => {
    g.fillStyle(0xffffff, 0.35).fillCircle(40, 40, 38);
    g.fillStyle(0xffffff, 0.9).fillCircle(40, 40, 30);
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

  // Scenery
  make(scene, 'tree', REF, REF, g => {
    g.fillStyle(0x000000, 0.15).fillEllipse(100, 165, 120, 30);
    g.fillStyle(0x8b5a2b).fillRoundedRect(88, 110, 24, 55, 6);
    g.fillStyle(0x2f8f3a).fillCircle(100, 85, 58);
    g.fillStyle(0x47b04f).fillCircle(85, 72, 40).fillCircle(120, 90, 36);
    g.fillStyle(0xe8483f).fillCircle(70, 95, 8).fillCircle(118, 62, 8).fillCircle(130, 105, 8);
  });
  make(scene, 'bush', REF, REF, g => {
    g.fillStyle(0x000000, 0.12).fillEllipse(100, 140, 140, 26);
    g.fillStyle(0x3a9e45).fillCircle(70, 110, 36).fillCircle(130, 110, 36).fillCircle(100, 92, 42);
    g.fillStyle(0x5cc062).fillCircle(90, 85, 18).fillCircle(125, 98, 14);
  });
  make(scene, 'flowers', REF, REF, g => {
    const fl = [[55, 70, 0xff6fa5], [120, 55, 0xffd23f], [150, 120, 0xffffff], [80, 135, 0xa78bfa], [110, 100, 0xff8a3d]];
    for (const [x, y, c] of fl) {
      g.lineStyle(5, 0x2f8f3a).lineBetween(x, y, x, y + 30);
      g.fillStyle(c);
      for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; g.fillCircle(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 9); }
      g.fillStyle(0xffb020).fillCircle(x, y, 7);
    }
  });
  make(scene, 'pond', REF, REF, g => {
    g.fillStyle(0x4aa3df).fillEllipse(100, 105, 170, 120);
    g.fillStyle(0x7cc6f2).fillEllipse(85, 95, 110, 60);
    // duck
    g.fillStyle(0xffd23f).fillEllipse(115, 110, 46, 30).fillCircle(132, 92, 14);
    g.fillStyle(0xff8a3d).fillTriangle(142, 90, 156, 95, 142, 98);
    g.fillStyle(INK).fillCircle(135, 89, 3);
  });
  make(scene, 'cow', REF, REF, g => {
    g.fillStyle(0x000000, 0.12).fillEllipse(100, 160, 140, 24);
    g.fillStyle(INK).fillRect(55, 120, 12, 38).fillRect(125, 120, 12, 38);
    g.fillStyle(INK).fillRoundedRect(36, 66, 118, 66, 30);
    g.fillStyle(0xffffff).fillRoundedRect(40, 70, 110, 58, 26);
    g.fillStyle(INK).fillCircle(70, 90, 14).fillCircle(115, 108, 12);
    g.fillStyle(INK).fillCircle(150, 78, 30);
    g.fillStyle(0xffffff).fillCircle(150, 78, 26);
    g.fillStyle(0xffb3c1).fillEllipse(160, 92, 30, 18);
    g.fillStyle(INK).fillCircle(146, 70, 4).fillCircle(162, 70, 4);
    g.fillStyle(0xd9a514).fillTriangle(132, 52, 138, 38, 144, 54).fillTriangle(158, 54, 164, 38, 170, 52);
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

export function drawRails(g: Phaser.GameObjects.Graphics, a: Dir, b: Dir, s: number, fixed: boolean, alpha = 1, railColor = 0xc9d1da) {
  const pts = toLocal(cellPath(0, 0, a, b, 16), s);
  const sleeperColor = fixed ? 0x9a948c : 0xa8693a;
  const sleeperDark = fixed ? 0x6e6a64 : 0x7a4a26;
  // sleepers
  const n = a === opp(b) ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const idx = Math.round(((i + 0.5) / n) * (pts.length - 1));
    const p = pts[idx], q = pts[Math.min(idx + 1, pts.length - 1)], r = pts[Math.max(idx - 1, 0)];
    const dx = q.x - r.x, dy = q.y - r.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, half = s * 0.27;
    g.lineStyle(s * 0.13, sleeperDark, alpha).lineBetween(p.x - nx * half, p.y - ny * half, p.x + nx * half, p.y + ny * half);
    g.lineStyle(s * 0.09, sleeperColor, alpha).lineBetween(p.x - nx * half, p.y - ny * half, p.x + nx * half, p.y + ny * half);
  }
  for (const off of [-0.16, 0.16]) {
    const line = offsetLine(pts, off * s);
    g.lineStyle(s * 0.075, 0x5d6670, alpha).strokePoints(line, false);
    g.lineStyle(s * 0.04, railColor, alpha).strokePoints(line, false);
  }
}

/** Draw any piece's track into `g` (centred at 0,0, s = cell size in px). */
export function drawPiece(g: Phaser.GameObjects.Graphics, p: Piece, s: number) {
  g.clear();
  const fixed = p.fixed;
  switch (p.type) {
    case 'straight':
    case 'curve':
    case 'car': {
      const [a, b] = sides(p);
      drawRails(g, a, b, s, fixed);
      break;
    }
    case 'start': {
      const d = p.rot as Dir;
      drawRails(g, opp(d), d, s, true);
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
