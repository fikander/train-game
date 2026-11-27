import Phaser from 'phaser';
import { REF, VEH, drawPiece, makeTextures } from './art';
import { isMuted, setMuted, sfx } from './audio';
import { W, H } from './GameScene';
import { BIOMES, LEVELS, PER_BIOME, biomeOf, type Biome } from './levels';
import { hintsOn, isUnlocked, nextLevel, setHints, solvedLevels } from './progress';
import { DX, DY, Trail, cellPath, type Dir, type Piece } from './track';
import { PAL, drawForest, drawGround, drawHill, drawPond, drawStream } from './terrain';

const T = 120; // map track cell size in px
const INK = 0x2d2a3e;
const BOX_W = 300, BOX_H = 214;
const XS = [2.0, 4.9, 7.8, 10.7, 13.6]; // box centres along a row, in cells
const ROWS = [3.5, 7.5];
const GAP = (XS[1] - XS[0]) / 2; // the engine parks halfway between boxes
const PAGES = Math.ceil(LEVELS.length / PER_BIOME);

/**
 * The map: one page per biome, ten boxes joined by a railway that snakes across the page and on to the next.
 * Every box shows a little picture of its level; solved ones show the finished track and a star.
 */
export class MapScene extends Phaser.Scene {
  private trail = new Trail(); // in map-cell units
  private boxD: number[] = []; // distance along the trail of each box centre on this page
  private engine: Phaser.GameObjects.Image[] = [];
  private busy = false;
  private page = 0;
  private biome: Biome = 'meadow';
  boxPos: { x: number; y: number }[] = []; // by level index (only this page's are set)

  constructor() { super('map'); }

  private fade() { return PAL[this.biome].fade as [number, number, number]; }

  create(data: { from?: number; won?: boolean; page?: number }) {
    makeTextures(this);
    this.busy = false;
    const solved = solvedLevels();
    const target = nextLevel(solved);
    const allDone = solved.size === LEVELS.length;
    const won = !!data.won && data.from !== undefined;
    const focus = data.page !== undefined ? data.page * PER_BIOME : won ? target : data.from ?? target;
    this.page = Math.min(PAGES - 1, Math.floor(focus / PER_BIOME));
    this.biome = BIOMES[this.page];
    const first = this.page * PER_BIOME;
    const count = Math.min(PER_BIOME, LEVELS.length - first);

    this.drawGround();
    const boxes = this.layTrack(count);
    this.boxPos = [];
    const views = boxes.map((b, j) => {
      const i = first + j;
      this.boxPos[i] = { x: b.x * T, y: b.y * T };
      return this.drawBox(i, b.x * T, b.y * T, solved.has(i), isUnlocked(i, solved), i === target && !allDone);
    });

    // the little engine waits just before the next level's box, if that is on this page
    const onPage = (i: number) => i >= first && i < first + count;
    const parkD = (i: number) => this.boxD[i - first] - GAP;
    let endD: number | null = null;
    if (allDone && this.page === PAGES - 1) endD = this.boxD[count - 1] + GAP;
    else if (!allDone && onPage(target)) endD = parkD(target);
    if (endD !== null) {
      const hop = won && onPage(data.from!) && data.from !== target;
      const startD = hop ? parkD(data.from!) : endD;
      this.makeEngine();
      this.placeEngine(startD);
      // only after a first-time win: a quick hop on to the next box (taps still work meanwhile)
      if (hop) {
        const from = data.from!;
        this.time.delayedCall(150, () => { this.starPop(views[from - first].x, views[from - first].y); sfx.toot(); });
        let beat = 0;
        const to = endD;
        this.tweens.addCounter({
          from: startD, to, delay: 500, duration: Math.min(1400, Math.max(700, (to - startD) * 300)), ease: 'Sine.InOut',
          onUpdate: tw => {
            const d = tw.getValue() ?? startD;
            this.placeEngine(d);
            if (d - beat > 0.7) { beat = d; sfx.chuff(); }
          },
          onComplete: () => { if (!allDone) { sfx.pop(); this.starPop(views[target - first].x, views[target - first].y - BOX_H * 0.2); } },
        });
      }
    }
    this.drawPageArrows();
    this.drawGrownUpGear();
    this.cameras.main.fadeIn(350, ...this.fade());
    (window as any).__map = this;
  }

  private goPage(p: number) {
    if (p < 0 || p >= PAGES || this.busy) return;
    this.busy = true;
    sfx.boop();
    this.cameras.main.fadeOut(250, ...this.fade());
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ page: p }));
  }

  /** Big arrows to the previous and next biome; a swipe works too. */
  private drawPageArrows() {
    const arrow = (x: number, dir: -1 | 1) => {
      const c = this.add.container(x, 660).setDepth(40);
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.16).fillCircle(0, 8, 58);
      g.fillStyle(INK).fillCircle(0, 0, 58);
      g.fillStyle(0xffffff).fillCircle(0, 0, 50);
      g.fillStyle(INK).fillTriangle(dir * 26, 0, -dir * 16, -26, -dir * 16, 26);
      c.add(g);
      c.setSize(130, 130).setInteractive();
      c.on('pointerup', () => this.goPage(this.page + dir));
    };
    if (this.page > 0) arrow(90, -1);
    if (this.page < PAGES - 1) arrow(1700, 1);
    let x0 = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { x0 = p.x; });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (Math.abs(p.x - x0) > 260) this.goPage(this.page + (p.x < x0 ? 1 : -1));
    });
  }

  private drawGround() {
    const key = `mapbg-${this.biome}`;
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({}, false);
      const rnd = new Phaser.Math.RandomDataGenerator([key]);
      drawGround(g, this.biome, rnd, W, H);
      // a stream (or a frozen one) wanders between the rows; ponds and clumps around the edges
      const pts: { x: number; y: number }[] = [];
      for (let x = -40; x <= 1800; x += 60) pts.push({ x, y: 660 + Math.sin(x / 230) * 30 });
      if (this.biome !== 'desert') drawStream(g, pts, 40, this.biome);
      else drawPond(g, [{ x: 960, y: 660 }, { x: 1080, y: 660 }], 120, rnd, 'desert');
      const clumps: [number, number, number][] = [[160, 110, 4], [700, 70, 3], [1200, 100, 5], [1580, 80, 3],
        [300, 1120, 4], [800, 1140, 3], [1250, 1110, 5], [1700, 1130, 4]];
      for (const [x, y, n] of clumps) {
        const cells = [{ x, y }];
        for (let i = 1; i < n; i++) cells.push({ x: x + rnd.between(-110, 110), y: y + rnd.between(-30, 30) });
        drawForest(g, cells, 110, rnd, this.biome);
      }
      g.generateTexture(key, W, H);
      g.destroy();
    }
    this.add.image(0, 0, key).setOrigin(0).setDepth(0);
  }

  /** Row 3 left to right, down the right side, row 7 right to left and on to the next page. Returns box centres in cells. */
  private layTrack(count: number) {
    const pieces: Piece[] = [];
    const S = (x: number, y: number, rot: number) => pieces.push({ type: 'straight', x, y, rot, fixed: true });
    const C = (x: number, y: number, rot: number) => pieces.push({ type: 'curve', x, y, rot, fixed: true });
    const add = (x: number, y: number, a: Dir, b: Dir) => this.trail.add(cellPath(x, y, a, b));
    this.trail = new Trail();
    const last = this.page === PAGES - 1;
    for (let x = 0; x <= 14; x++) { S(x, 3, 0); add(x, 3, 3, 1); }
    C(15, 3, 2); add(15, 3, 3, 2);
    for (let y = 4; y <= 6; y++) { S(15, y, 1); add(15, y, 0, 2); }
    C(15, 7, 3); add(15, 7, 0, 3);
    for (let x = 14; x >= (last ? 1 : 0); x--) { S(x, 7, 0); add(x, 7, 1, 3); }
    for (const p of pieces) {
      const g = this.add.graphics().setDepth(2).setPosition((p.x + 0.5) * T, (p.y + 0.5) * T);
      drawPiece(g, p, T);
    }
    if (last) {
      const b = this.add.graphics().setDepth(3).setPosition(1 * T + 14, 7.5 * T);
      b.fillStyle(INK).fillRoundedRect(-14, -46, 28, 92, 8).fillStyle(0xe8483f).fillRoundedRect(-9, -41, 18, 82, 6);
    }
    const boxes = Array.from({ length: count }, (_, j) => {
      const r = Math.floor(j / XS.length), k = j % XS.length;
      return { x: r % 2 === 0 ? XS[k] : XS[XS.length - 1 - k], y: ROWS[r] };
    });
    this.boxD = boxes.map(b => {
      let best = 0, bestErr = Infinity;
      for (let d = 0; d <= this.trail.length; d += 0.05) {
        const p = this.trail.at(d);
        const e = Math.hypot(p.x - b.x, p.y - b.y);
        if (e < bestErr) { bestErr = e; best = d; }
      }
      return best;
    });
    return boxes;
  }

  /** Grown-ups: hold the little gear for 1.5 s for sound, track shadows and any level. */
  private drawGrownUpGear() {
    const c = this.add.container(1860, 64).setDepth(200).setAlpha(0.5);
    const g = this.add.graphics();
    g.fillStyle(INK).fillCircle(0, 0, 26);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.fillCircle(Math.cos(a) * 26, Math.sin(a) * 26, 8); }
    g.fillStyle(0xffffff).fillCircle(0, 0, 11);
    const ring = this.add.graphics();
    c.add([g, ring]);
    c.setSize(90, 90).setInteractive();
    let timer: Phaser.Time.TimerEvent | null = null;
    let t0 = 0;
    const cancel = () => { timer?.remove(); timer = null; ring.clear(); };
    c.on('pointerdown', () => {
      t0 = this.time.now;
      timer = this.time.addEvent({
        delay: 30, loop: true, callback: () => {
          const f = (this.time.now - t0) / 1500;
          ring.clear().lineStyle(8, 0xffffff).beginPath().arc(0, 0, 40, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).strokePath();
          if (f >= 1) { cancel(); this.openGrownUpPanel(); }
        },
      });
    });
    c.on('pointerup', cancel);
    c.on('pointerout', cancel);
  }

  private openGrownUpPanel() {
    this.busy = true;
    const layer = this.add.container(0, 0).setDepth(500);
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x1c2b1a, 0.88).setInteractive();
    layer.add(bg);
    const font = 'Arial Rounded MT Bold, Arial, sans-serif';
    // toggles
    const toggle = (x: number, label: string, get: () => boolean, set: (v: boolean) => void) => {
      const c = this.add.container(x, 170);
      const g = this.add.graphics();
      const t = this.add.text(0, 0, '', { fontFamily: font, fontSize: '40px', color: '#2d2a3e', fontStyle: 'bold' }).setOrigin(0.5);
      const draw = () => {
        const on = get();
        g.clear().fillStyle(on ? 0x8ee06a : 0xcfd6cc).fillRoundedRect(-230, -60, 460, 120, 30);
        t.setText(`${label}: ${on ? 'on' : 'off'}`);
      };
      draw();
      c.add([g, t]);
      c.setSize(460, 120).setInteractive();
      c.on('pointerup', () => { set(!get()); sfx.boop(); draw(); });
      layer.add(c);
    };
    toggle(W / 2 - 500, 'Sound', () => !isMuted(), v => setMuted(!v));
    toggle(W / 2, 'Track shadows', hintsOn, setHints);
    const close = this.add.text(W / 2 + 500, 170, '✕', { fontFamily: font, fontSize: '96px', color: '#ffffff' }).setOrigin(0.5).setInteractive();
    close.on('pointerup', () => { layer.destroy(); this.busy = false; });
    layer.add(close);
    // every level, ten to a row (one row per biome)
    const solved = solvedLevels();
    LEVELS.forEach((_, i) => {
      const b = biomeOf(i);
      const x = W / 2 + ((i % PER_BIOME) - 4.5) * 150, y = 400 + Math.floor(i / PER_BIOME) * 170;
      const c = this.add.container(x, y);
      const g = this.add.graphics();
      g.fillStyle(PAL[b].board).fillRoundedRect(-62, -62, 124, 124, 24);
      g.lineStyle(6, PAL[b].lines).strokeRoundedRect(-62, -62, 124, 124, 24);
      const t = this.add.text(0, 0, String(i + 1), { fontFamily: font, fontSize: '54px', color: '#2d2a3e', fontStyle: 'bold' }).setOrigin(0.5);
      c.add([g, t]);
      if (solved.has(i)) c.add(this.add.image(44, -44, 'star').setScale(0.26));
      c.setSize(124, 124).setInteractive();
      c.on('pointerup', () => {
        this.cameras.main.fadeOut(300, ...this.fade());
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game', { level: i }));
      });
      layer.add(c);
    });
  }

  private drawBox(i: number, x: number, y: number, solved: boolean, open: boolean, isNext: boolean) {
    const c = this.add.container(x, y).setDepth(10);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillRoundedRect(-BOX_W / 2 + 6, -BOX_H / 2 + 12, BOX_W, BOX_H, 34);
    g.fillStyle(INK).fillRoundedRect(-BOX_W / 2 - 6, -BOX_H / 2 - 6, BOX_W + 12, BOX_H + 12, 38);
    g.fillStyle(solved ? 0xfff1b8 : open ? 0xffffff : 0xc9d1c4).fillRoundedRect(-BOX_W / 2, -BOX_H / 2, BOX_W, BOX_H, 32);
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
      this.cameras.main.fadeOut(300, ...this.fade());
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game', { level: i }));
    });
    return c;
  }

  /** A tiny picture of the level, with its engine and carriages. Solved levels show the track Alek built. */
  private thumbnail(i: number, solved: boolean, open: boolean) {
    const L = LEVELS[i];
    const c = this.add.container(0, 12);
    const s = Math.min((BOX_W - 50) / L.cols, (BOX_H - 64) / L.rows);
    const ox = -L.cols * s / 2, oy = -L.rows * s / 2;
    const pieces: Piece[] = [...L.pieces];
    if (solved) for (const gp of L.gaps) pieces.push({ type: gp.type, x: gp.x, y: gp.y, rot: gp.rot, fixed: true });
    for (const p of pieces) {
      const g = this.add.graphics().setPosition(ox + (p.x + 0.5) * s, oy + (p.y + 0.5) * s);
      drawPiece(g, p, s);
      c.add(g);
    }
    for (const p of L.pieces) {
      if (p.type !== 'car' && p.type !== 'engine') continue;
      const kind = p.type === 'engine' ? 'engine' : p.car!;
      const k = s / REF * 0.9;
      for (const part of ['base', 'top']) {
        c.add(this.add.image(ox + (p.x + 0.5) * s, oy + (p.y + 0.5) * s - (part === 'top' ? s * 0.12 : 0), `${kind}-${part}`)
          .setScale(k).setRotation([-Math.PI / 2, 0, Math.PI / 2, Math.PI][p.rot]));
      }
    }
    // tunnel hills, one per mouth, coloured by pair
    for (const p of L.pieces) {
      if (p.type !== 'portal') continue;
      const g = this.add.graphics();
      const end = { x: ox + (p.x + 0.5 + DX[p.rot] * 0.5) * s, y: oy + (p.y + 0.5 + DY[p.rot] * 0.5) * s, a: [-Math.PI / 2, 0, Math.PI / 2, Math.PI][p.rot] };
      drawHill(g, [{ x: ox + (p.x + 0.5) * s, y: oy + (p.y + 0.5) * s }], s, biomeOf(i), [end], p.pair ?? 0);
      c.add(g);
    }
    if (!open) c.setAlpha(0.55);
    return c;
  }

  private makeEngine() {
    const k = T / REF * 0.6;
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
