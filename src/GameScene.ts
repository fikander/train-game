import Phaser from 'phaser';
import { LEVELS, type Gap, type Level } from './levels';
import { DX, DY, Trail, cellPath, opp, sides, traverse, type Dir, type Piece } from './track';
import { REF, dirAngle, drawPiece, drawSwitchMarker, drawTunnel, makeTextures } from './art';
import { lines, say, sfx, isMuted, setMuted } from './audio';

export const W = 1920, H = 1200;
const BOARD_TOP = 60, BOARD_BOTTOM = 950, TRAY_Y = 1080, TOKEN = 170;
const VIRTUAL = 3; // length of invisible track behind the start, so coupled carriages always have room
const ENG_BACK = 0.42, FIRST_GAP = 0.93, CAR_GAP = 0.87;
const SPEED = 1.7, REV_SPEED = 2.6;

type Mode = 'edit' | 'run' | 'pause' | 'reverse' | 'exiting' | 'done';

interface Token {
  type: 'straight' | 'curve';
  rot: number;
  c: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  slot: { x: number; y: number };
  cell: string | null;
  dragged: boolean;
}

interface Checkpoint { d: number; x: number; y: number; dir: Dir }

const key = (x: number, y: number) => `${x},${y}`;

export function savedLevel(): number {
  try { return Math.min(LEVELS.length - 1, Math.max(0, parseInt(localStorage.getItem('choo.level') ?? '0', 10) || 0)); } catch { return 0; }
}
function saveLevel(i: number) { try { localStorage.setItem('choo.level', String(i)); } catch { /* ignore */ } }

let firstLevelThisSession = true;

export class GameScene extends Phaser.Scene {
  private li = 0;
  private L!: Level;
  private cell = 100;
  private ox = 0;
  private oy = 0;
  private grid = new Map<string, Piece>();
  private gaps = new Map<string, Gap>();
  private pieceGfx = new Map<string, Phaser.GameObjects.Graphics>();
  private markers = new Map<string, Phaser.GameObjects.Graphics>();
  private slotGfx = new Map<string, Phaser.GameObjects.Graphics[]>();
  private waitingCars = new Map<string, Phaser.GameObjects.Image>();
  private tokens: Token[] = [];
  private engine!: Phaser.GameObjects.Image;
  private cars: Phaser.GameObjects.Image[] = [];
  private trail = new Trail();
  private headD = 0;
  private speed = 0;
  private mode: Mode = 'edit';
  private pending!: { x: number; y: number; dir: Dir };
  private checkpoints: Checkpoint[] = [];
  private revTarget: Checkpoint | null = null;
  private exitD = 0;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffTimer = 0;
  private puffCount = 0;
  private idle = 0;
  private hand!: Phaser.GameObjects.Text;
  private goBtn!: Phaser.GameObjects.Container;
  private goPulse?: Phaser.Tweens.Tween;
  private flip = new WeakMap<Phaser.GameObjects.Image, boolean>();

  constructor() { super('game'); }

  init(data: { level?: number }) {
    this.li = Math.min(LEVELS.length - 1, Math.max(0, data.level ?? savedLevel()));
    this.L = LEVELS[this.li];
    this.grid = new Map(); this.gaps = new Map(); this.pieceGfx = new Map(); this.markers = new Map(); this.slotGfx = new Map();
    this.waitingCars = new Map(); this.tokens = []; this.cars = []; this.trail = new Trail();
    this.checkpoints = []; this.revTarget = null; this.mode = 'edit'; this.speed = 0; this.idle = 0; this.goPulse = undefined;
  }

  create() {
    makeTextures(this);
    saveLevel(this.li);
    const L = this.L;
    this.cell = Math.floor(Math.min(1800 / L.cols, (BOARD_BOTTOM - BOARD_TOP) / L.rows, 230));
    this.ox = Math.round((W - L.cols * this.cell) / 2);
    this.oy = Math.round(BOARD_TOP + (BOARD_BOTTOM - BOARD_TOP - L.rows * this.cell) / 2);

    this.drawBackground();
    for (const p of L.pieces) this.grid.set(key(p.x, p.y), { ...p });
    for (const g of L.gaps) this.gaps.set(key(g.x, g.y), g);
    this.drawGapSlots();
    this.drawScenery();
    for (const p of this.grid.values()) this.addPieceView(p);
    this.drawTray();
    this.drawGoButton();
    this.drawProgress();
    this.drawParentCorner();

    // train
    const start = [...this.grid.values()].find(p => p.type === 'start')!;
    const d = start.rot as Dir;
    const cx = start.x + 0.5, cy = start.y + 0.5;
    this.trail.add([{ x: cx - DX[d] * VIRTUAL, y: cy - DY[d] * VIRTUAL }, { x: cx, y: cy }, { x: cx + DX[d] * 0.5, y: cy + DY[d] * 0.5 }]);
    this.pending = { x: start.x + DX[d], y: start.y + DY[d], dir: d };
    this.headD = VIRTUAL + ENG_BACK;
    this.engine = this.add.image(0, 0, 'engine').setScale(this.cell / REF * 0.9).setDepth(20);

    this.smoke = this.add.particles(0, 0, 'puff', {
      lifespan: 1500,
      scale: { start: 0.35 * this.cell / REF * 1.4, end: 1.1 * this.cell / REF * 1.4 },
      alpha: { start: 0.85, end: 0 },
      speedY: { min: -70, max: -35 },
      speedX: { min: -25, max: 25 },
      emitting: false,
    }).setDepth(40);

    // exit tunnels drawn above the train
    for (const p of this.grid.values()) {
      if (p.type !== 'exit') continue;
      const g = this.add.graphics().setDepth(30);
      drawTunnel(g, this.cell);
      g.setPosition(this.px(p.x + 0.5), this.py(p.y + 0.5)).setRotation(dirAngle(p.rot));
    }

    this.hand = this.add.text(0, 0, '👆', { fontSize: '120px' }).setOrigin(0.35, 0.05).setDepth(100).setVisible(false);

    this.setupInput();
    this.placeTrain(0);

    this.cameras.main.fadeIn(400, 124, 200, 90);
    this.time.delayedCall(500, () => {
      sfx.whistle();
      this.time.delayedCall(900, () => say(firstLevelThisSession ? lines.hello() : Phaser.Utils.Array.GetRandom(['Choo choo!', lines.hello()])));
      firstLevelThisSession = false;
      for (const s of this.waitingCars.values()) {
        this.tweens.add({ targets: s, angle: { from: s.angle - 6, to: s.angle + 6 }, duration: 160, yoyo: true, repeat: 3, onComplete: () => this.snapCarAngle(s) });
      }
    });
    (window as any).__scene = this;
  }

  // ---------- coordinates ----------
  private px(u: number) { return this.ox + u * this.cell; }
  private py(v: number) { return this.oy + v * this.cell; }

  // ---------- drawing ----------
  private drawBackground() {
    const g = this.add.graphics();
    g.fillStyle(0x7cc85a).fillRect(0, 0, W, H);
    // board
    const { cols, rows } = this.L, s = this.cell;
    g.fillStyle(0x000000, 0.12).fillRoundedRect(this.ox - 14, this.oy - 6, cols * s + 28, rows * s + 28, 28);
    g.fillStyle(0x9bd86f).fillRoundedRect(this.ox - 14, this.oy - 14, cols * s + 28, rows * s + 28, 28);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      g.fillStyle((x + y) % 2 ? 0x8fd064 : 0x98d66c).fillRoundedRect(this.ox + x * s + 3, this.oy + y * s + 3, s - 6, s - 6, 14);
    }
    // tray shelf (only when there are pieces to place)
    if (this.L.gaps.length + (this.L.spare?.length ?? 0) > 0) g.fillStyle(0x000000, 0.12)
      .fillRoundedRect(40, 972, 1560, 216, 36)
      .fillStyle(0xd9a066).fillRoundedRect(40, 964, 1560, 216, 36)
      .fillStyle(0xe8b77f).fillRoundedRect(56, 978, 1528, 188, 28);
    // a few clouds of grass tufts around the edges
    const rnd = new Phaser.Math.RandomDataGenerator([String(this.li)]);
    for (let i = 0; i < 26; i++) {
      const x = rnd.between(10, W - 10), y = rnd.between(10, 950);
      if (x > this.ox - 30 && x < this.ox + cols * s + 30 && y > this.oy - 30 && y < this.oy + rows * s + 30) continue;
      g.fillStyle(0x5fae45).fillTriangle(x - 12, y, x - 4, y - 22, x + 2, y).fillTriangle(x - 2, y, x + 6, y - 28, x + 12, y);
    }
  }

  private drawGapSlots() {
    const s = this.cell;
    for (const gp of this.gaps.values()) {
      const g = this.add.graphics().setDepth(1);
      const x = this.px(gp.x), y = this.py(gp.y);
      g.lineStyle(6, 0xffffff, 0.85);
      const inset = 14, len = 22;
      // dashed rounded outline
      const x0 = x + inset, y0 = y + inset, x1 = x + s - inset, y1 = y + s - inset;
      for (let t = x0 + 10; t < x1 - 10; t += len * 1.8) { g.lineBetween(t, y0, Math.min(t + len, x1 - 10), y0); g.lineBetween(t, y1, Math.min(t + len, x1 - 10), y1); }
      for (let t = y0 + 10; t < y1 - 10; t += len * 1.8) { g.lineBetween(x0, t, x0, Math.min(t + len, y1 - 10)); g.lineBetween(x1, t, x1, Math.min(t + len, y1 - 10)); }
      // faint picture of the needed piece so it's guessable without reading
      const hint = this.add.graphics().setDepth(1).setPosition(x + s / 2, y + s / 2).setAlpha(0.18);
      drawPiece(hint, { type: gp.type, x: 0, y: 0, rot: gp.rot, fixed: false }, s);
      this.tweens.add({ targets: g, alpha: { from: 1, to: 0.45 }, duration: 900, yoyo: true, repeat: -1 });
      this.slotGfx.set(key(gp.x, gp.y), [g, hint]);
    }
  }

  private drawScenery() {
    const rnd = new Phaser.Math.RandomDataGenerator([`scenery${this.li}`]);
    const kinds: [string, () => void][] = [
      ['tree', sfx.tweet], ['bush', sfx.boop], ['flowers', sfx.pop], ['pond', sfx.quack], ['cow', sfx.moo], ['tree', sfx.tweet], ['flowers', sfx.pop],
    ];
    for (let y = 0; y < this.L.rows; y++) for (let x = 0; x < this.L.cols; x++) {
      const k = key(x, y);
      if (this.grid.has(k) || this.gaps.has(k)) continue;
      if (rnd.frac() < 0.25) continue;
      const [tex, snd] = rnd.pick(kinds);
      const img = this.add.image(this.px(x + 0.5), this.py(y + 0.5), tex).setScale(this.cell / REF * 0.85).setDepth(5);
      img.setInteractive();
      img.on('pointerdown', () => {
        snd();
        this.tweens.add({ targets: img, scaleX: img.scaleX * 1.15, scaleY: img.scaleY * 0.88, duration: 110, yoyo: true, repeat: 1 });
      });
    }
  }

  private addPieceView(p: Piece) {
    const k = key(p.x, p.y);
    const g = this.add.graphics().setDepth(2).setPosition(this.px(p.x + 0.5), this.py(p.y + 0.5));
    drawPiece(g, p, this.cell);
    this.pieceGfx.set(k, g);
    if (p.type === 'switch') {
      const m = this.add.graphics().setDepth(3).setPosition(g.x, g.y);
      drawSwitchMarker(m, p, this.cell);
      this.markers.set(k, m);
      const zone = this.add.zone(g.x, g.y, this.cell, this.cell).setInteractive();
      zone.on('pointerdown', () => this.flipSwitch(p));
    }
    if (p.type === 'car' && p.car) {
      const img = this.add.image(g.x, g.y, `car-${p.car}`).setScale(this.cell / REF * 0.9).setDepth(15);
      img.setRotation(p.rot % 2 ? Math.PI / 2 : 0);
      this.waitingCars.set(k, img);
    }
  }

  private snapCarAngle(s: Phaser.GameObjects.Image) {
    for (const [k, img] of this.waitingCars) if (img === s) { const p = this.grid.get(k)!; s.setRotation(p.rot % 2 ? Math.PI / 2 : 0); }
  }

  private drawTray() {
    const types: ('straight' | 'curve')[] = [...this.L.gaps.map(g => g.type), ...(this.L.spare ?? [])];
    // shuffle a little so order isn't the answer, but stable per level
    const rnd = new Phaser.Math.RandomDataGenerator([`tray${this.li}`]);
    const order = rnd.shuffle([...types]);
    order.forEach((type, i) => {
      const slot = { x: 160 + i * 230, y: TRAY_Y };
      const c = this.add.container(slot.x, slot.y).setDepth(50);
      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.12).fillRoundedRect(-TOKEN / 2 + 4, -TOKEN / 2 + 8, TOKEN, TOKEN, 26);
      bg.fillStyle(0x9bd86f).fillRoundedRect(-TOKEN / 2, -TOKEN / 2, TOKEN, TOKEN, 26);
      const g = this.add.graphics();
      const t: Token = { type, rot: type === 'straight' ? 0 : 2, c, g, slot, cell: null, dragged: false };
      drawPiece(g, { type, x: 0, y: 0, rot: t.rot, fixed: false }, TOKEN);
      c.add([bg, g]);
      c.setData('bg', bg);
      c.setSize(TOKEN, TOKEN).setInteractive({ draggable: true });
      c.setData('token', t);
      this.tokens.push(t);
    });
  }

  private drawGoButton() {
    const c = this.add.container(1760, TRAY_Y).setDepth(60);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillCircle(0, 10, 108);
    g.fillStyle(0x1f8a4c).fillCircle(0, 0, 108);
    g.fillStyle(0x3fcf6f).fillCircle(0, -4, 98);
    g.fillStyle(0xffffff, 0.25).fillEllipse(-30, -50, 90, 40);
    g.fillStyle(0xffffff).fillTriangle(-30, -48, -30, 44, 50, -2);
    c.add(g);
    c.setSize(220, 220).setInteractive();
    c.on('pointerdown', () => {
      this.tweens.add({ targets: c, scale: 0.9, duration: 80, yoyo: true });
      this.pressGo();
    });
    this.goBtn = c;
  }

  private drawProgress() {
    const n = LEVELS.length, gap = 40, x0 = W / 2 - ((n - 1) * gap) / 2;
    const g = this.add.graphics().setDepth(5);
    for (let i = 0; i < n; i++) {
      const r = i === this.li ? 13 : 9;
      g.fillStyle(0x2d6b2a, 0.35).fillCircle(x0 + i * gap, 30, r + 3);
      g.fillStyle(i < this.li ? 0xffd23f : i === this.li ? 0xffffff : 0xb9e39b).fillCircle(x0 + i * gap, 30, r);
    }
  }

  /** Grown-ups: hold the little gear for 1.5 s to open level select / sound. */
  private drawParentCorner() {
    const c = this.add.container(1872, 44).setDepth(200).setAlpha(0.45);
    const g = this.add.graphics();
    g.fillStyle(0x2d6b2a).fillCircle(0, 0, 26);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.fillCircle(Math.cos(a) * 26, Math.sin(a) * 26, 8); }
    g.fillStyle(0x7cc85a).fillCircle(0, 0, 11);
    const ring = this.add.graphics();
    c.add([g, ring]);
    c.setSize(80, 80).setInteractive();
    let timer: Phaser.Time.TimerEvent | null = null;
    let t0 = 0;
    const cancel = () => { timer?.remove(); timer = null; ring.clear(); };
    c.on('pointerdown', () => {
      t0 = this.time.now;
      timer = this.time.addEvent({
        delay: 30, loop: true, callback: () => {
          const f = (this.time.now - t0) / 1500;
          ring.clear().lineStyle(8, 0xffffff).beginPath().arc(0, 0, 40, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).strokePath();
          if (f >= 1) { cancel(); this.openParentMenu(); }
        },
      });
    });
    c.on('pointerup', cancel);
    c.on('pointerout', cancel);
  }

  private openParentMenu() {
    const layer = this.add.container(0, 0).setDepth(500);
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x1c2b1a, 0.82).setInteractive();
    layer.add(bg);
    LEVELS.forEach((_, i) => {
      const x = W / 2 + ((i % 5) - 2) * 220, y = 420 + Math.floor(i / 5) * 230;
      const b = this.add.container(x, y);
      const g = this.add.graphics();
      g.fillStyle(i === this.li ? 0xffd23f : 0xffffff).fillRoundedRect(-90, -90, 180, 180, 30);
      const t = this.add.text(0, 0, String(i + 1), { fontFamily: 'Arial Rounded MT Bold, Arial, sans-serif', fontSize: '84px', color: '#2d6b2a', fontStyle: 'bold' }).setOrigin(0.5);
      b.add([g, t]);
      b.setSize(180, 180).setInteractive();
      b.on('pointerup', () => this.gotoLevel(i));
      layer.add(b);
    });
    const snd = this.add.text(W / 2 - 220, 940, isMuted() ? '🔇' : '🔊', { fontSize: '110px' }).setOrigin(0.5).setInteractive();
    snd.on('pointerup', () => { setMuted(!isMuted()); snd.setText(isMuted() ? '🔇' : '🔊'); });
    const close = this.add.text(W / 2 + 220, 940, '✖️', { fontSize: '110px' }).setOrigin(0.5).setInteractive();
    close.on('pointerup', () => layer.destroy());
    layer.add([snd, close]);
  }

  private gotoLevel(i: number) {
    this.cameras.main.fadeOut(300, 124, 200, 90);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ level: i }));
  }

  // ---------- input ----------
  private setupInput() {
    this.input.dragDistanceThreshold = 14;
    this.input.on('pointerdown', () => { this.idle = 0; this.hideHand(); });

    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container) => {
      const t = obj.getData('token') as Token | undefined;
      if (!t || !this.canEdit()) return;
      t.dragged = true;
      obj.setDepth(90);
      const bg = obj.getData('bg') as Phaser.GameObjects.Graphics;
      bg.setVisible(false);
      this.tweens.add({ targets: obj, scale: this.cell / TOKEN * 1.08, duration: 120 });
      sfx.boop();
    });
    this.input.on('drag', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container, x: number, y: number) => {
      const t = obj.getData('token') as Token | undefined;
      if (!t || !t.dragged) return;
      obj.setPosition(x, y - 20);
    });
    this.input.on('dragend', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container) => {
      const t = obj.getData('token') as Token | undefined;
      if (!t || !t.dragged) return;
      this.dropToken(t, p.worldX, p.worldY);
    });
    this.input.on('gameobjectup', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const t = obj.getData?.('token') as Token | undefined;
      if (!t) return;
      if (t.dragged) { t.dragged = false; return; }
      if (t.cell && this.canEdit()) this.rotateToken(t);
    });
  }

  private canEdit() { return this.mode === 'edit'; }

  private nearestGap(x: number, y: number, t: Token): Gap | null {
    let best: Gap | null = null, bestD = this.cell * 0.85;
    for (const g of this.gaps.values()) {
      const k = key(g.x, g.y);
      if (this.grid.has(k) && t.cell !== k) continue;
      const d = Math.hypot(this.px(g.x + 0.5) - x, this.py(g.y + 0.5) - y);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  private dropToken(t: Token, px: number, py: number) {
    const c = t.c;
    const gap = this.nearestGap(px, py, t);
    if (t.cell) { this.grid.delete(t.cell); t.cell = null; }
    if (gap && gap.type === t.type) {
      const k = key(gap.x, gap.y);
      t.cell = k;
      t.rot = gap.rot; // forgiving: it always lands the right way round
      this.grid.set(k, { type: t.type, x: gap.x, y: gap.y, rot: t.rot, fixed: false });
      drawPiece(t.g, { type: t.type, x: 0, y: 0, rot: t.rot, fixed: false }, TOKEN);
      c.setDepth(10);
      const tx = this.px(gap.x + 0.5), ty = this.py(gap.y + 0.5);
      this.tweens.add({
        targets: c, x: tx, y: ty, scale: this.cell / TOKEN, duration: 140, ease: 'Back.Out',
        onComplete: () => {
          sfx.clack();
          this.tweens.add({ targets: c, scale: this.cell / TOKEN * 1.08, duration: 90, yoyo: true });
          this.sparkle(tx, ty);
          this.checkComplete();
        },
      });
      return;
    }
    if (gap && gap.type !== t.type) {
      // wrong shape: wobble over the square, then slide home
      sfx.wobble();
      const tx = this.px(gap.x + 0.5), ty = this.py(gap.y + 0.5);
      this.tweens.chain({
        targets: c, tweens: [
          { x: tx, y: ty, duration: 120 },
          { angle: 12, duration: 70, yoyo: true, repeat: 2 },
          { angle: 0, duration: 10 },
        ], onComplete: () => this.returnToTray(t),
      });
      return;
    }
    this.returnToTray(t);
  }

  private returnToTray(t: Token) {
    const bg = t.c.getData('bg') as Phaser.GameObjects.Graphics;
    t.rot = t.type === 'straight' ? 0 : 2;
    drawPiece(t.g, { type: t.type, x: 0, y: 0, rot: t.rot, fixed: false }, TOKEN);
    this.tweens.add({
      targets: t.c, x: t.slot.x, y: t.slot.y, scale: 1, angle: 0, duration: 260, ease: 'Cubic.Out',
      onComplete: () => { bg.setVisible(true); t.c.setDepth(50); },
    });
    this.checkComplete();
  }

  private rotateToken(t: Token) {
    t.rot = (t.rot + 1) % (t.type === 'straight' ? 2 : 4);
    const p = this.grid.get(t.cell!)!;
    p.rot = t.rot;
    sfx.clack();
    this.tweens.add({
      targets: t.c, angle: 90, duration: 120, onComplete: () => {
        t.c.setAngle(0);
        drawPiece(t.g, { type: t.type, x: 0, y: 0, rot: t.rot, fixed: false }, TOKEN);
      },
    });
    this.checkComplete();
  }

  private flipSwitch(p: Piece) {
    this.idle = 0;
    p.state = p.state ? 0 : 1;
    const k = key(p.x, p.y);
    drawPiece(this.pieceGfx.get(k)!, p, this.cell);
    const m = this.markers.get(k)!;
    drawSwitchMarker(m, p, this.cell);
    sfx.kachunk();
    this.tweens.add({ targets: m, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.Out' });
  }

  private allCorrect() {
    for (const g of this.gaps.values()) {
      const p = this.grid.get(key(g.x, g.y));
      if (!p || p.type !== g.type || !sameSides(p, g)) return false;
    }
    return true;
  }

  private checkComplete() {
    for (const [k, gs] of this.slotGfx) gs.forEach(g => g.setVisible(!this.grid.has(k)));
    const ok = this.allCorrect() && this.mode === 'edit';
    if (ok && !this.goPulse) {
      this.goPulse = this.tweens.add({ targets: this.goBtn, scale: 1.12, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    } else if (!ok && this.goPulse) {
      this.goPulse.stop(); this.goPulse = undefined; this.goBtn.setScale(1);
    }
  }

  // ---------- hints ----------
  private hideHand() { this.tweens.killTweensOf(this.hand); this.hand.setVisible(false); }

  private showHint() {
    this.hideHand();
    for (const g of this.gaps.values()) {
      const k = key(g.x, g.y);
      const p = this.grid.get(k);
      const cx = this.px(g.x + 0.5), cy = this.py(g.y + 0.5);
      if (p && p.type === g.type && sameSides(p, g)) continue;
      if (p) { // placed but turned the wrong way: tap it
        this.hand.setPosition(cx, cy).setVisible(true).setAlpha(1);
        this.tweens.add({ targets: this.hand, y: cy + 30, duration: 300, yoyo: true, repeat: 3, onComplete: () => this.hand.setVisible(false) });
        return;
      }
      const t = this.tokens.find(t => !t.cell && t.type === g.type);
      if (!t) continue;
      this.hand.setPosition(t.slot.x, t.slot.y).setVisible(true).setAlpha(1);
      this.tweens.chain({
        targets: this.hand, tweens: [
          { x: cx, y: cy, duration: 1100, ease: 'Sine.InOut', delay: 200 },
          { alpha: 0, duration: 300, delay: 300 },
          { x: t.slot.x, y: t.slot.y, alpha: 1, duration: 10 },
          { x: cx, y: cy, duration: 1100, ease: 'Sine.InOut', delay: 200 },
          { alpha: 0, duration: 300, delay: 300 },
        ], onComplete: () => this.hand.setVisible(false),
      });
      return;
    }
    // everything placed: point at the Go button
    this.hand.setPosition(this.goBtn.x, this.goBtn.y + 10).setVisible(true).setAlpha(1);
    this.tweens.add({ targets: this.hand, y: this.goBtn.y + 40, duration: 300, yoyo: true, repeat: 3, onComplete: () => this.hand.setVisible(false) });
  }

  // ---------- train ----------
  private pressGo() {
    this.idle = 0;
    this.hideHand();
    sfx.whistle();
    if (this.mode !== 'edit') return;
    if (this.goPulse) { this.goPulse.stop(); this.goPulse = undefined; this.goBtn.setScale(1); }
    say(lines.go());
    this.mode = 'run';
    this.speed = 0;
  }

  private decide() {
    const { x, y, dir } = this.pending;
    this.checkpoints.push({ d: this.trail.length, x, y, dir });
    const p = this.grid.get(key(x, y));
    const entry = opp(dir);
    const out = p ? traverse(p, entry) : null;
    if (!p || out === null) { this.deadEnd(false); return; }
    if (p.type === 'exit') {
      if (this.waitingCars.size > 0) { this.deadEnd(true); return; }
      const cx = x + 0.5, cy = y + 0.5;
      this.trail.add([{ x: cx, y: cy }, { x: cx + DX[out] * 6, y: cy + DY[out] * 6 }]);
      this.exitD = this.checkpoints[this.checkpoints.length - 1].d + 0.5;
      this.mode = 'exiting';
      return;
    }
    this.trail.add(cellPath(x, y, entry, out));
    this.pending = { x: x + DX[out], y: y + DY[out], dir: out };
    if (p.type === 'car' && this.waitingCars.has(key(x, y))) this.pickup(key(x, y));
  }

  private pickup(k: string) {
    this.mode = 'pause';
    const img = this.waitingCars.get(k)!;
    this.waitingCars.delete(k);
    const n = this.cars.length;
    const td = Math.max(0, this.headD - ENG_BACK - FIRST_GAP - n * CAR_GAP);
    const to = this.trail.at(td);
    const fx = img.x, fy = img.y, tx = this.px(to.x), ty = this.py(to.y);
    const r0 = img.rotation;
    let r1 = to.angle;
    const flipped = Math.cos(r1) < -0.2;
    while (r1 - r0 > Math.PI) r1 -= Math.PI * 2;
    while (r1 - r0 < -Math.PI) r1 += Math.PI * 2;
    const base = img.scale;
    img.setDepth(25);
    this.tweens.addCounter({
      from: 0, to: 1, duration: 650, ease: 'Sine.InOut',
      onUpdate: tw => {
        const f = tw.getValue() ?? 0;
        img.setPosition(fx + (tx - fx) * f, fy + (ty - fy) * f - Math.sin(Math.PI * f) * this.cell * 0.7);
        img.setRotation(r0 + (r1 - r0) * f);
        img.setScale(base * (1 + Math.sin(Math.PI * f) * 0.25));
      },
      onComplete: () => {
        img.setScale(base).setDepth(19 - n);
        img.setFlipY(flipped);
        this.flip.set(img, flipped);
        this.cars.push(img);
        sfx.clunk();
        this.starBurst((tx + this.engine.x) / 2, (ty + this.engine.y) / 2);
        say(lines.pickup());
        const es = this.engine.scaleX;
        this.tweens.add({ targets: this.engine, scaleX: es * 1.1, scaleY: es * 0.9, duration: 90, yoyo: true });
        this.time.delayedCall(450, () => { if (this.mode === 'pause') { this.mode = 'run'; this.speed = 0.4; } });
      },
    });
  }

  private deadEnd(missing: boolean) {
    this.mode = 'pause';
    this.speed = 0;
    this.checkpoints.pop();
    sfx.oops();
    say(missing ? lines.missing() : lines.deadEnd());
    const ex = this.engine.x;
    this.tweens.add({ targets: this.engine, x: ex + 6, duration: 50, yoyo: true, repeat: 5, onComplete: () => this.engine.setX(ex) });
    this.time.delayedCall(1400, () => {
      // reverse to the last switch we went through (so the child can flip it), or home
      let target: Checkpoint | null = null;
      for (let i = this.checkpoints.length - 1; i >= 0; i--) {
        const cp = this.checkpoints[i];
        const sp = this.grid.get(key(cp.x, cp.y));
        if (sp?.type === 'switch' && opp(cp.dir) === sp.inDir && cp.d < this.headD - 0.01) { target = cp; break; }
      }
      if (!target) target = this.checkpoints[0] ?? null;
      if (!target) { this.mode = 'edit'; this.checkComplete(); return; }
      this.revTarget = target;
      this.mode = 'reverse';
      this.speed = 0;
    });
  }

  private finishReverse() {
    const cp = this.revTarget!;
    this.headD = cp.d;
    this.trail.truncate(cp.d);
    this.checkpoints = this.checkpoints.filter(c => c.d < cp.d - 1e-6);
    this.pending = { x: cp.x, y: cp.y, dir: cp.dir };
    this.revTarget = null;
    this.mode = 'edit';
    sfx.boop();
    this.checkComplete();
    // nudge: if we stopped at a switch, wiggle it
    const sp = this.grid.get(key(cp.x, cp.y));
    if (sp?.type === 'switch') {
      const m = this.markers.get(key(cp.x, cp.y))!;
      this.tweens.add({ targets: m, scale: 1.25, duration: 250, yoyo: true, repeat: 2 });
    }
  }

  private celebrate() {
    this.mode = 'done';
    const last = this.li === LEVELS.length - 1;
    sfx.tada();
    sfx.whistle();
    say(last ? lines.bigWin() : lines.win());
    const colors = [0xff6fa5, 0xffd23f, 0x4aa3df, 0x3fcf6f, 0xff8a3d, 0xa78bfa];
    const conf = this.add.particles(0, 0, 'confetti', {
      x: { min: 0, max: W }, y: -30, lifespan: 4000, speedY: { min: 250, max: 600 }, speedX: { min: -120, max: 120 },
      rotate: { min: 0, max: 360 }, scale: { min: 0.8, max: 1.6 }, tint: colors, gravityY: 120, emitting: false,
    }).setDepth(300);
    conf.explode(last ? 400 : 180);
    if (last) this.time.delayedCall(900, () => conf.explode(300));
    for (let i = 0; i < (last ? 12 : 5); i++) this.time.delayedCall(i * 220, () => this.starBurst(Phaser.Math.Between(300, W - 300), Phaser.Math.Between(200, 800)));
    this.time.delayedCall(last ? 6000 : 3800, () => this.gotoLevel(last ? 0 : this.li + 1));
    if (!last) saveLevel(this.li + 1); else saveLevel(0);
  }

  private sparkle(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const s = this.add.image(x, y, 'star').setScale(0.25).setDepth(80);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * this.cell * 0.6, y: y + Math.sin(a) * this.cell * 0.6, alpha: 0, scale: 0.1, duration: 450, onComplete: () => s.destroy() });
    }
  }

  private starBurst(x: number, y: number) {
    const s = this.add.image(x, y, 'star').setScale(0.2).setDepth(80);
    sfx.pop();
    this.tweens.add({ targets: s, scale: 1.1, alpha: 0, angle: 90, duration: 600, ease: 'Cubic.Out', onComplete: () => s.destroy() });
  }

  private placeAt(img: Phaser.GameObjects.Image, d: number, bob: number) {
    const p = this.trail.at(Math.max(0, d));
    img.setPosition(this.px(p.x), this.py(p.y) + bob);
    img.setRotation(p.angle);
    const c = Math.cos(p.angle);
    let f = this.flip.get(img) ?? false;
    if (c < -0.2) f = true; else if (c > 0.2) f = false;
    this.flip.set(img, f);
    img.setFlipY(f);
  }

  private placeTrain(time: number) {
    const moving = this.mode === 'run' || this.mode === 'reverse' || this.mode === 'exiting';
    const bob = moving ? Math.sin(time / 70) * 2 : 0;
    const ed = this.headD - ENG_BACK;
    this.placeAt(this.engine, ed, bob);
    this.cars.forEach((c, i) => this.placeAt(c, ed - FIRST_GAP - i * CAR_GAP, moving ? Math.sin(time / 70 + i + 1) * 2 : 0));
    if (this.mode === 'exiting') {
      this.engine.setVisible(ed < this.exitD + 0.15);
      this.cars.forEach((c, i) => c.setVisible(ed - FIRST_GAP - i * CAR_GAP < this.exitD + 0.15));
    }
  }

  private puff(dt: number) {
    if (!this.engine.visible) return;
    const moving = this.mode === 'run' || this.mode === 'reverse' || this.mode === 'exiting';
    this.puffTimer -= dt;
    if (this.puffTimer > 0) return;
    this.puffTimer = moving ? 0.2 : 0.9;
    const k = this.engine.scaleX;
    const lx = 50 * k, ly = (this.engine.flipY ? 73 : -73) * k;
    const r = this.engine.rotation;
    this.smoke.emitParticleAt(this.engine.x + lx * Math.cos(r) - ly * Math.sin(r), this.engine.y + lx * Math.sin(r) + ly * Math.cos(r), 1);
    if (moving && this.puffCount++ % 2 === 0) sfx.chuff();
  }

  update(time: number, deltaMs: number) {
    const dt = Math.min(0.05, deltaMs / 1000);
    if (this.mode === 'run' || this.mode === 'exiting') {
      this.speed = Math.min(SPEED, this.speed + 2.5 * dt);
      this.headD += this.speed * dt;
      let guard = 0;
      while (this.mode === 'run' && this.headD >= this.trail.length && guard++ < 4) {
        const over = this.headD - this.trail.length;
        this.headD = this.trail.length;
        this.decide();
        if (this.mode === 'run') this.headD += over;
      }
      if (this.mode === 'exiting') {
        const lastD = this.headD - ENG_BACK - FIRST_GAP - Math.max(0, this.cars.length - 1) * CAR_GAP - (this.cars.length ? 0 : -FIRST_GAP);
        if (lastD > this.exitD + 0.6) this.celebrate();
      }
    } else if (this.mode === 'reverse' && this.revTarget) {
      this.speed = Math.min(REV_SPEED, this.speed + 3 * dt);
      this.headD -= this.speed * dt;
      if (this.headD <= this.revTarget.d) this.finishReverse();
    } else if (this.mode === 'edit') {
      this.idle += dt;
      if (this.idle > 10) { this.idle = 0; this.showHint(); }
    }
    this.placeTrain(time);
    this.puff(dt);
  }
}

function sameSides(p: Piece, g: Gap) {
  const a = sides(p), b = sides({ type: g.type, x: 0, y: 0, rot: g.rot, fixed: false });
  return a.length === b.length && a.every(s => b.includes(s));
}
