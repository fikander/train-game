import Phaser from 'phaser';
import { REF, VEH, drawPiece, makeTextures } from './art';
import { sfx } from './audio';
import { W, H } from './GameScene';
import { LEVELS } from './levels';
import { isUnlocked, nextLevel, solvedLevels } from './progress';
import { Trail, cellPath, type Dir, type Piece } from './track';
import { drawForest, drawPond, drawStream } from './terrain';

const T = 120; // map track cell size in px
const INK = 0x2d2a3e;
const BOX_W = 330, BOX_H = 226;

/**
 * The map: one box per level, joined by a railway that snakes across the screen.
 * Solved boxes show the finished track and a star; the next box waits for Alek; later ones are asleep.
 */
export class MapScene extends Phaser.Scene {
  private trail = new Trail(); // in map-cell units
  private boxD: number[] = []; // distance along the trail of each box centre
  private engine: Phaser.GameObjects.Image[] = [];
  private busy = false;

  constructor() { super('map'); }

  create(data: { from?: number; won?: boolean }) {
    makeTextures(this);
    this.busy = false;
    this.drawGround();
    const track = this.layTrack();
    const solved = solvedLevels();
    const target = nextLevel(solved);
    const allDone = solved.size === LEVELS.length;

    // boxes (drawn above the track, so the line runs into and out of each one)
    const boxes = track.boxes.map((b, i) => this.drawBox(i, b.x * T, b.y * T, solved.has(i), isUnlocked(i, solved), i === target && !allDone));

    // the little engine waits just before the next level's box
    const parkD = (i: number) => this.boxD[i] - 1.8;
    const endD = allDone ? this.boxD[LEVELS.length - 1] + 1.8 : parkD(target);
    const won = data.won && data.from !== undefined;
    const startD = won ? parkD(data.from!) : endD;
    this.makeEngine();
    this.placeEngine(startD);
    if (won) {
      this.busy = true;
      const from = data.from!;
      this.time.delayedCall(450, () => {
        this.starPop(boxes[from].x, boxes[from].y);
        sfx.whistle();
      });
      const dist = endD - startD;
      let beat = 0;
      this.tweens.addCounter({
        from: startD, to: endD, delay: 1100, duration: Math.max(900, dist * 520), ease: 'Sine.InOut',
        onUpdate: tw => {
          const d = tw.getValue() ?? startD;
          this.placeEngine(d);
          if (d - beat > 0.7) { beat = d; sfx.chuff(); }
        },
        onComplete: () => {
          this.busy = false;
          if (!allDone) { sfx.pop(); this.starPop(boxes[target].x, boxes[target].y - BOX_H * 0.2); }
        },
      });
    }
    this.cameras.main.fadeIn(350, 124, 200, 90);
    (window as any).__map = this;
  }

  private drawGround() {
    if (this.textures.exists('mapbg')) this.textures.remove('mapbg');
    const g = this.make.graphics({}, false);
    const rnd = new Phaser.Math.RandomDataGenerator(['map']);
    g.fillStyle(0x7cc85a).fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) g.fillStyle(rnd.pick([0x86d063, 0x72bd50, 0x8ad668]), 0.75).fillCircle(rnd.between(0, W), rnd.between(0, H), rnd.between(40, 120));
    for (let i = 0; i < 900; i++) g.fillStyle(rnd.pick([0x4f8f36, 0x9ee07a]), 0.55).fillCircle(rnd.between(0, W), rnd.between(0, H), rnd.between(1, 3));
    // a stream wanders between the two rows into a pond
    const pts: { x: number; y: number }[] = [];
    for (let x = -40; x <= 1500; x += 60) pts.push({ x, y: 660 + Math.sin(x / 210) * 34 });
    drawStream(g, pts, 46);
    drawPond(g, [{ x: 1550, y: 650 }, { x: 1680, y: 650 }], 130, rnd);
    // forests along the top and bottom edges and in the corners
    const clumps: [number, number, number][] = [[80, 120, 4], [560, 70, 3], [1080, 90, 5], [1480, 70, 3], [1860, 100, 3], [70, 1130, 4], [560, 1150, 3], [1020, 1140, 5], [1460, 1150, 4], [1860, 1120, 3]];
    for (const [x, y, n] of clumps) {
      const cells = [{ x, y }];
      for (let i = 1; i < n; i++) cells.push({ x: x + rnd.between(-110, 110), y: y + rnd.between(-40, 40) });
      drawForest(g, cells, 120, rnd);
    }
    g.generateTexture('mapbg', W, H);
    g.destroy();
    this.add.image(0, 0, 'mapbg').setOrigin(0).setDepth(0);
  }

  /** Snake: row 3 left to right, down the right side, row 7 right to left. Returns box positions in cell units. */
  private layTrack() {
    const pieces: Piece[] = [];
    const S = (x: number, y: number, rot: number) => pieces.push({ type: 'straight', x, y, rot, fixed: true });
    const C = (x: number, y: number, rot: number) => pieces.push({ type: 'curve', x, y, rot, fixed: true });
    const add = (x: number, y: number, a: Dir, b: Dir) => this.trail.add(cellPath(x, y, a, b));
    this.trail = new Trail();
    for (let x = 0; x <= 14; x++) { S(x, 3, 0); add(x, 3, 3, 1); }
    C(15, 3, 2); add(15, 3, 3, 2);
    for (let y = 4; y <= 6; y++) { S(15, y, 1); add(15, y, 0, 2); }
    C(15, 7, 3); add(15, 7, 0, 3);
    for (let x = 14; x >= 1; x--) { S(x, 7, 0); add(x, 7, 1, 3); }
    for (const p of pieces) {
      const g = this.add.graphics().setDepth(2).setPosition((p.x + 0.5) * T, (p.y + 0.5) * T);
      drawPiece(g, p, T);
    }
    // buffer stop at the far end of the line
    const b = this.add.graphics().setDepth(3).setPosition(1 * T + 14, 7.5 * T);
    b.fillStyle(INK).fillRoundedRect(-14, -46, 28, 92, 8).fillStyle(0xe8483f).fillRoundedRect(-9, -41, 18, 82, 6);

    const boxes = [2.2, 5.8, 9.4, 13].map(x => ({ x, y: 3.5 })).concat([13, 9.4, 5.8].map(x => ({ x, y: 7.5 })));
    // distance along the trail of each box centre
    this.boxD = boxes.map(b => {
      let best = 0, bestErr = Infinity;
      for (let d = 0; d <= this.trail.length; d += 0.05) {
        const p = this.trail.at(d);
        const e = Math.hypot(p.x - b.x, p.y - b.y);
        if (e < bestErr) { bestErr = e; best = d; }
      }
      return best;
    });
    return { boxes };
  }

  private drawBox(i: number, x: number, y: number, solved: boolean, open: boolean, isNext: boolean) {
    const c = this.add.container(x, y).setDepth(10);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillRoundedRect(-BOX_W / 2 + 6, -BOX_H / 2 + 12, BOX_W, BOX_H, 34);
    g.fillStyle(INK).fillRoundedRect(-BOX_W / 2 - 6, -BOX_H / 2 - 6, BOX_W + 12, BOX_H + 12, 38);
    g.fillStyle(solved ? 0xfff1b8 : open ? 0xffffff : 0xb7cfa6).fillRoundedRect(-BOX_W / 2, -BOX_H / 2, BOX_W, BOX_H, 32);
    c.add(g);
    c.add(this.thumbnail(i, solved, open));
    // level number badge
    const nb = this.add.graphics();
    nb.fillStyle(INK).fillCircle(-BOX_W / 2 + 18, -BOX_H / 2 + 18, 40);
    nb.fillStyle(solved ? 0xffb020 : open ? 0x3fcf6f : 0x8aa37a).fillCircle(-BOX_W / 2 + 18, -BOX_H / 2 + 18, 33);
    const nt = this.add.text(-BOX_W / 2 + 18, -BOX_H / 2 + 16, String(i + 1), {
      fontFamily: 'Arial Black, Arial Rounded MT Bold, Arial, sans-serif', fontSize: '44px', color: '#ffffff', fontStyle: 'bold',
      stroke: '#2d2a3e', strokeThickness: 8,
    }).setOrigin(0.5);
    c.add([nb, nt]);
    if (solved) c.add(this.add.image(BOX_W / 2 - 22, -BOX_H / 2 + 18, 'star').setScale(0.42));
    if (!open) c.setAlpha(0.75);
    if (isNext) this.tweens.add({ targets: c, scale: 1.05, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    c.setSize(BOX_W, BOX_H).setInteractive();
    c.on('pointerup', () => {
      if (this.busy) return;
      if (!open) {
        sfx.wobble();
        this.tweens.add({ targets: c, angle: { from: -4, to: 4 }, duration: 70, yoyo: true, repeat: 2, onComplete: () => c.setAngle(0) });
        return;
      }
      this.busy = true;
      sfx.boop();
      this.tweens.killTweensOf(c);
      this.tweens.add({ targets: c, scale: 1.12, duration: 140, yoyo: true });
      this.cameras.main.fadeOut(300, 124, 200, 90);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game', { level: i }));
    });
    return c;
  }

  /** A tiny picture of the level. Solved levels show the track Alek built. */
  private thumbnail(i: number, solved: boolean, open: boolean) {
    const L = LEVELS[i];
    const c = this.add.container(0, 10);
    const s = Math.min((BOX_W - 50) / L.cols, (BOX_H - 60) / L.rows);
    const ox = -L.cols * s / 2, oy = -L.rows * s / 2;
    const pieces: Piece[] = [...L.pieces];
    if (solved) for (const gp of L.gaps) pieces.push({ type: gp.type, x: gp.x, y: gp.y, rot: gp.rot, fixed: true });
    for (const p of pieces) {
      const g = this.add.graphics().setPosition(ox + (p.x + 0.5) * s, oy + (p.y + 0.5) * s);
      drawPiece(g, p, s);
      if (!open) g.setAlpha(0.6);
      c.add(g);
    }
    if (!open) return c;
    for (const p of L.pieces) {
      if (p.type !== 'car' && p.type !== 'engine') continue;
      const kind = p.type === 'engine' ? 'engine' : p.car!;
      const k = s / REF * 0.9;
      for (const part of ['base', 'top']) {
        c.add(this.add.image(ox + (p.x + 0.5) * s, oy + (p.y + 0.5) * s - (part === 'top' ? s * 0.12 : 0), `${kind}-${part}`)
          .setScale(k).setRotation([-Math.PI / 2, 0, Math.PI / 2, Math.PI][p.rot]));
      }
    }
    return c;
  }

  private makeEngine() {
    const k = T / REF * 0.7;
    const lift = VEH.engine.lift * T;
    this.engine = [
      this.add.image(0, 0, 'engine-base').setScale(k * 1.02).setTint(0x1d3d14).setAlpha(0.28).setDepth(16),
      this.add.image(0, 0, 'engine-base').setScale(k).setDepth(18),
      this.add.image(0, 0, 'engine-top').setScale(k).setDepth(19),
      this.add.image(0, 0, 'engine-chimney').setScale(k).setDepth(21),
    ];
    this.engine[0].setData('off', { x: lift * 0.5, y: lift * 0.6, f: 0 });
    this.engine[1].setData('off', { x: 0, y: 0, f: 0 });
    this.engine[2].setData('off', { x: 0, y: -lift, f: 0 });
    this.engine[3].setData('off', { x: 0, y: -lift * 1.9, f: 38 * k });
  }

  private placeEngine(d: number) {
    // the trail is driven front first, so the engine faces the way it goes
    const p = this.trail.at(Math.max(0, Math.min(this.trail.length, d)));
    for (const img of this.engine) {
      const o = img.getData('off') as { x: number; y: number; f: number };
      img.setPosition(p.x * T + o.x + Math.cos(p.angle) * o.f, p.y * T + o.y + Math.sin(p.angle) * o.f).setRotation(p.angle);
    }
  }

  private starPop(x: number, y: number) {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const s = this.add.image(x, y, 'star').setScale(0.3).setDepth(80);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * 170, y: y + Math.sin(a) * 130, alpha: 0, scale: 0.12, duration: 700, ease: 'Cubic.Out', onComplete: () => s.destroy() });
    }
  }
}
