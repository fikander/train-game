import Phaser from 'phaser';
import { LEVELS, type Gap, type Level } from './levels';
import { DX, DY, Trail, cellPath, opp, sides, traverse, type Dir, type Piece } from './track';
import { REF, VEH, dirAngle, drawPiece, drawSwitchMarker, drawTunnel, makeTextures } from './art';
import { sfx, isMuted, setMuted } from './audio';

export const W = 1920, H = 1200;
const BOARD_TOP = 60, BOARD_BOTTOM = 950, TRAY_Y = 1080, TOKEN = 170;
const BACK = 2; // invisible track behind each carriage's start
const SCALE = 0.9; // vehicle size relative to a cell
const ENG_L = VEH.engine.w / REF * SCALE + 0.02, CAR_L = VEH.car.w / REF * SCALE + 0.03;
const SPEED = 1.7, REV_SPEED = 2.6;

type Mode = 'edit' | 'run' | 'pause' | 'rewind' | 'depart' | 'done';

interface Token {
  type: 'straight' | 'curve';
  rot: number;
  c: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  slot: { x: number; y: number };
  cell: string | null;
  dragged: boolean;
}

interface Mover {
  v: Vehicle;
  num: number;
  trail: Trail;
  d: number; // distance of the carriage's FRONT along its trail
  d0: number;
  len0: number;
  start: { x: number; y: number; dir: Dir };
  pending: { x: number; y: number; dir: Dir };
  state: 'idle' | 'move' | 'stop' | 'coupled' | 'rewind';
  speed: number;
}

/** A train vehicle seen from above: shadow + base (sides) on the ground, top lifted up the screen. */
class Vehicle {
  shadow: Phaser.GameObjects.Image;
  base: Phaser.GameObjects.Image;
  top: Phaser.GameObjects.Image;
  chimney?: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  x = 0; y = 0; angle = 0;
  private lift: number;
  private k: number;
  constructor(scene: Phaser.Scene, kind: string, cell: number) {
    this.k = cell / REF * SCALE;
    const isEngine = kind === 'engine';
    this.lift = (isEngine ? VEH.engine.lift : VEH.car.lift) * cell;
    this.shadow = scene.add.image(0, 0, `${kind}-base`).setScale(this.k * 1.02).setTint(0x1d3d14).setAlpha(0.28).setDepth(16);
    this.base = scene.add.image(0, 0, `${kind}-base`).setScale(this.k).setDepth(18);
    this.top = scene.add.image(0, 0, `${kind}-top`).setScale(this.k).setDepth(19);
    if (isEngine) this.chimney = scene.add.image(0, 0, 'engine-chimney').setScale(this.k).setDepth(21);
  }
  setNumber(scene: Phaser.Scene, n: number) {
    const fs = Math.round(70 * this.k);
    this.label = scene.add.text(0, 0, String(n), {
      fontFamily: 'Arial Black, Arial Rounded MT Bold, Arial, sans-serif', fontSize: `${fs}px`, color: '#ffffff', fontStyle: 'bold',
      stroke: '#2d2a3e', strokeThickness: Math.round(fs * 0.22),
    }).setOrigin(0.5).setDepth(22);
  }
  get parts(): Phaser.GameObjects.Components.Visible[] { return [this.shadow, this.base, this.top, ...(this.chimney ? [this.chimney] : []), ...(this.label ? [this.label] : [])]; }
  setPose(x: number, y: number, angle: number, bob = 0) {
    this.x = x; this.y = y; this.angle = angle;
    this.shadow.setPosition(x + this.lift * 0.5, y + this.lift * 0.6).setRotation(angle);
    this.base.setPosition(x, y).setRotation(angle);
    this.top.setPosition(x, y - this.lift + bob).setRotation(angle);
    if (this.chimney) {
      const cx = 38 * this.k;
      this.chimney.setPosition(x + Math.cos(angle) * cx, y + Math.sin(angle) * cx - this.lift * 1.9 + bob).setRotation(angle);
    }
    this.label?.setPosition(x, y - this.lift * 1.6 + bob);
  }
  /** where smoke comes out */
  get smokePoint() { return this.chimney ? { x: this.chimney.x, y: this.chimney.y - 6 } : { x: this.x, y: this.y }; }
  setVisible(v: boolean) { this.parts.forEach(p => p.setVisible(v)); }
  get visible() { return this.base.visible; }
  squash(scene: Phaser.Scene) {
    scene.tweens.add({ targets: [this.base, this.top], scaleX: this.k * 1.08, scaleY: this.k * 0.92, duration: 90, yoyo: true });
  }
}

const key = (x: number, y: number) => `${x},${y}`;

export function savedLevel(): number {
  try { return Math.min(LEVELS.length - 1, Math.max(0, parseInt(localStorage.getItem('choo.level') ?? '0', 10) || 0)); } catch { return 0; }
}
function saveLevel(i: number) { try { localStorage.setItem('choo.level', String(i)); } catch { /* ignore */ } }


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
  private tokens: Token[] = [];
  private engine!: Vehicle;
  private enginePiece!: Piece;
  private movers: Mover[] = [];
  private coupled: Mover[] = []; // in order of arrival: 1, 2, 3
  private mode: Mode = 'edit';
  private depart: { trail: Trail; d: number; exitD: number; speed: number } | null = null;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffTimer = 0;
  private puffCount = 0;
  private idle = 0;
  private hand!: Phaser.GameObjects.Text;
  private goBtn!: Phaser.GameObjects.Container;
  private goPulse?: Phaser.Tweens.Tween;

  constructor() { super('game'); }

  init(data: { level?: number }) {
    this.li = Math.min(LEVELS.length - 1, Math.max(0, data.level ?? savedLevel()));
    this.L = LEVELS[this.li];
    this.grid = new Map(); this.gaps = new Map(); this.pieceGfx = new Map(); this.markers = new Map();
    this.tokens = []; this.movers = []; this.coupled = []; this.depart = null;
    this.mode = 'edit'; this.idle = 0; this.goPulse = undefined;
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
    for (const p of this.grid.values()) if (p.type === 'car') p.buffer = !this.grid.has(key(p.x - DX[p.rot], p.y - DY[p.rot]));
    for (const g of L.gaps) this.gaps.set(key(g.x, g.y), g);
    this.drawScenery();
    for (const p of this.grid.values()) this.addPieceView(p);
    this.drawTray();
    this.drawGoButton();
    this.drawProgress();
    this.drawParentCorner();

    // the engine waits at the end of the line
    this.enginePiece = [...this.grid.values()].find(p => p.type === 'engine')!;
    this.engine = new Vehicle(this, 'engine', this.cell);
    this.engine.setPose(this.px(this.enginePiece.x + 0.5), this.py(this.enginePiece.y + 0.5), dirAngle(this.enginePiece.rot));

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


    this.cameras.main.fadeIn(400, 124, 200, 90);
    this.time.delayedCall(500, () => {
      sfx.whistle();
      for (const m of this.movers) {
        const v = m.v;
        const { x, y, angle } = v;
        this.tweens.addCounter({ from: 0, to: 1, duration: 900, onUpdate: tw => v.setPose(x, y, angle + Math.sin((tw.getValue() ?? 0) * Math.PI * 6) * 0.1), onComplete: () => v.setPose(x, y, angle) });
      }
    });
    (window as any).__scene = this;
  }

  // ---------- coordinates ----------
  private px(u: number) { return this.ox + u * this.cell; }
  private py(v: number) { return this.oy + v * this.cell; }

  // ---------- drawing ----------
  private drawBackground() {
    // drawn once into a texture: thousands of shapes would be far too slow to redraw every frame
    const g = this.make.graphics({}, false);
    const { cols, rows } = this.L, s = this.cell;
    const rnd0 = new Phaser.Math.RandomDataGenerator([`ground${this.li}`]);
    // textured grass: soft mottled patches + speckles
    g.fillStyle(0x7cc85a).fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) g.fillStyle(rnd0.pick([0x86d063, 0x72bd50, 0x8ad668]), 0.75).fillCircle(rnd0.between(0, W), rnd0.between(0, H), rnd0.between(40, 120));
    for (let i = 0; i < 900; i++) g.fillStyle(rnd0.pick([0x4f8f36, 0x9ee07a]), 0.55).fillCircle(rnd0.between(0, W), rnd0.between(0, H), rnd0.between(1, 3));
    // the play area: slightly lighter, with thin hand-drawn grid lines
    g.fillStyle(0xa6dd7c, 0.45).fillRoundedRect(this.ox - 10, this.oy - 10, cols * s + 20, rows * s + 20, 24);
    g.lineStyle(3, 0x3f7a2c, 0.35);
    for (let x = 0; x <= cols; x++) g.lineBetween(this.ox + x * s + rnd0.between(-2, 2), this.oy - 16, this.ox + x * s + rnd0.between(-2, 2), this.oy + rows * s + 16);
    for (let y = 0; y <= rows; y++) g.lineBetween(this.ox - 16, this.oy + y * s + rnd0.between(-2, 2), this.ox + cols * s + 16, this.oy + y * s + rnd0.between(-2, 2));
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
      g.fillStyle(0x4f8f36).fillTriangle(x - 12, y, x - 4, y - 22, x + 2, y).fillTriangle(x - 2, y, x + 6, y - 28, x + 12, y);
    }
    const bgKey = `bg${this.li}`;
    if (this.textures.exists(bgKey)) this.textures.remove(bgKey);
    g.generateTexture(bgKey, W, H);
    g.destroy();
    this.add.image(0, 0, bgKey).setOrigin(0).setDepth(0);
    // trees around the edge of the play area
    for (let i = 0; i < 40; i++) {
      const x = rnd.between(0, W), y = rnd.between(0, 960);
      if (x > this.ox - 90 && x < this.ox + cols * s + 90 && y > this.oy - 90 && y < this.oy + rows * s + 90) continue;
      if (y < 70 && x > W / 2 - 260 && x < W / 2 + 260) continue;
      this.add.image(x, y, rnd.pick(['tree', 'pine', 'pine', 'bush', 'rock'])).setScale(rnd.realInRange(0.7, 1.05)).setDepth(4);
    }
  }

  private drawScenery() {
    const rnd = new Phaser.Math.RandomDataGenerator([`scenery${this.li}`]);
    const kinds: [string, () => void][] = [
      ['tree', sfx.tweet], ['pine', sfx.tweet], ['bush', sfx.boop], ['flowers', sfx.pop], ['pond', sfx.quack], ['cow', sfx.moo], ['rock', sfx.boop], ['flowers', sfx.pop],
    ];
    for (let y = 0; y < this.L.rows; y++) for (let x = 0; x < this.L.cols; x++) {
      const k = key(x, y);
      if (this.grid.has(k) || this.gaps.has(k)) continue;
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
      const v = new Vehicle(this, p.car, this.cell);
      v.setNumber(this, p.num ?? 1);
      const d = p.rot as Dir, cx = p.x + 0.5, cy = p.y + 0.5;
      const trail = new Trail();
      trail.add([{ x: cx - DX[d] * BACK, y: cy - DY[d] * BACK }, { x: cx, y: cy }, { x: cx + DX[d] * 0.5, y: cy + DY[d] * 0.5 }]);
      const start = { x: p.x + DX[d], y: p.y + DY[d], dir: d };
      const m: Mover = { v, num: p.num ?? 1, trail, d: BACK + CAR_L / 2, d0: BACK + CAR_L / 2, len0: trail.length, start, pending: { ...start }, state: 'idle', speed: 0 };
      this.movers.push(m);
      this.placeMover(m);
    }
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
    this.mode = 'run';
    for (const m of this.movers) { m.state = 'move'; m.speed = 0; }
  }

  /** The carriage's front reached the end of its known track: look at the next square. */
  private advance(m: Mover) {
    const { x, y, dir } = m.pending;
    const p = this.grid.get(key(x, y));
    const entry = opp(dir);
    const out = p ? traverse(p, entry) : null;
    if (!p || out === null) { m.state = 'stop'; m.speed = 0; return; }
    m.trail.add(cellPath(x, y, entry, out));
    m.pending = { x: x + DX[out], y: y + DY[out], dir: out };
  }

  private frontOf(m: Mover) { return m.trail.at(m.d); }
  private centreOf(m: Mover) { return m.trail.at(m.d - CAR_L / 2); }

  /** Where the next carriage has to couple: the back of the engine, or the back of the last coupled carriage. */
  private tailPoint() {
    if (!this.coupled.length) {
      const e = this.enginePiece, a = dirAngle(e.rot);
      return { x: e.x + 0.5 - Math.cos(a) * ENG_L / 2, y: e.y + 0.5 - Math.sin(a) * ENG_L / 2 };
    }
    const last = this.coupled[this.coupled.length - 1];
    return last.trail.at(last.d - CAR_L);
  }

  private bump(a: Mover, b: Mover | null) {
    (window as any).__bump = { a: a.num, b: b?.num ?? 'engine/order', fa: this.frontOf(a), tail: this.tailPoint(), cb: b ? this.centreOf(b) : null, ca: this.centreOf(a) };
    this.mode = 'pause';
    for (const m of this.movers) if (m.state === 'move') { m.state = 'stop'; m.speed = 0; }
    sfx.boing();
    const pa = this.frontOf(a);
    const pb = b ? this.centreOf(b) : this.tailPoint();
    const x = this.px((pa.x + pb.x) / 2), y = this.py((pa.y + pb.y) / 2);
    this.starBurst(x, y);
    this.sparkle(x, y);
    a.v.squash(this); b?.v.squash(this);
    if (!b) this.engine.squash(this);
    this.time.delayedCall(1300, () => this.startRewind());
  }

  private startRewind() {
    this.mode = 'rewind';
    sfx.oops();
    this.coupled = [];
    for (const m of this.movers) { m.state = 'rewind'; m.speed = 0; }
  }

  private finishRewind() {
    for (const m of this.movers) {
      m.d = m.d0;
      m.trail.truncate(m.len0);
      m.pending = { ...m.start };
      m.state = 'idle';
    }
    this.mode = 'edit';
    sfx.boop();
    this.checkComplete();
  }

  private coupleOn(m: Mover) {
    m.state = 'coupled';
    m.speed = 0;
    this.coupled.push(m);
    sfx.clunk();
    const t = this.frontOf(m);
    this.starBurst(this.px(t.x), this.py(t.y) - this.cell * 0.15);
    m.v.squash(this);
    if (this.coupled.length === 1) this.engine.squash(this);
    else this.coupled[this.coupled.length - 2].v.squash(this);
    if (this.coupled.length === this.movers.length) this.time.delayedCall(700, () => this.startDeparture());
  }

  private startDeparture() {
    this.mode = 'pause';
    sfx.whistle();
    for (let i = 0; i < 6; i++) this.time.delayedCall(i * 90, () => { const sp = this.engine.smokePoint; this.smoke.emitParticleAt(sp.x, sp.y, 2); });
    // the whole train leaves along the last carriage's track, through the engine square and into the tunnel
    const last = this.coupled[this.coupled.length - 1];
    const trail = new Trail();
    trail.add(last.trail.pts.slice(0, Math.max(2, last.trail.pts.length)));
    let { x, y, dir } = last.pending;
    let exitD = trail.length + 20;
    for (let guard = 0; guard < 30; guard++) {
      const p = this.grid.get(key(x, y));
      if (!p) break;
      const entry = opp(dir);
      const out = p.type === 'engine' ? (p.rot as Dir) : traverse(p, entry);
      if (out === null) break;
      if (p.type === 'exit') { exitD = trail.length + 0.5; trail.add([{ x: x + 0.5, y: y + 0.5 }, { x: x + 0.5 + DX[out] * 6, y: y + 0.5 + DY[out] * 6 }]); break; }
      trail.add(cellPath(x, y, entry, out));
      x += DX[out]; y += DY[out]; dir = out;
    }
    this.depart = { trail, d: last.d, exitD, speed: 0 };
    this.time.delayedCall(900, () => { this.mode = 'depart'; });
  }

  private celebrateOnce = false;

  private celebrate() {
    if (this.celebrateOnce) return;
    this.celebrateOnce = true;
    this.mode = 'done';
    const last = this.li === LEVELS.length - 1;
    sfx.tada();
    sfx.whistle();
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

  private placeMover(m: Mover, bob = 0) {
    const p = this.centreOf(m);
    m.v.setPose(this.px(p.x), this.py(p.y), p.angle, bob);
  }

  private placeDeparting(time: number) {
    const dp = this.depart!;
    const n = this.coupled.length;
    const bob = (i: number) => Math.sin(time / 60 + i) * 1.5;
    // carriage k (1-based) has its front at d + (n - k) * CAR_L; the engine is in front of carriage 1
    this.coupled.forEach((m, i) => {
      const cd = dp.d + (n - 1 - i) * CAR_L - CAR_L / 2;
      const p = dp.trail.at(cd);
      m.v.setPose(this.px(p.x), this.py(p.y), p.angle, bob(i));
      m.v.setVisible(cd < dp.exitD + 0.15);
    });
    const ed = dp.d + (n - 1) * CAR_L + 0.02 + ENG_L / 2;
    const e = dp.trail.at(ed);
    this.engine.setPose(this.px(e.x), this.py(e.y), e.angle, bob(9));
    this.engine.setVisible(ed < dp.exitD + 0.15);
    const lastCd = dp.d - CAR_L / 2;
    if (lastCd > dp.exitD + 0.3) this.celebrate();
  }

  private puff(dt: number) {
    if (!this.engine.visible) return;
    const moving = this.mode === 'depart';
    this.puffTimer -= dt;
    if (this.puffTimer > 0) return;
    this.puffTimer = moving ? 0.18 : 0.8;
    const sp = this.engine.smokePoint;
    this.smoke.emitParticleAt(sp.x, sp.y, 1);
    if (moving && this.puffCount++ % 2 === 0) sfx.chuff();
  }

  private checkContacts() {
    const tail = this.tailPoint();
    const next = this.coupled.length + 1;
    for (const m of this.movers) {
      if (m.state !== 'move' && m.state !== 'stop') continue;
      const f = this.frontOf(m);
      if (Math.hypot(f.x - tail.x, f.y - tail.y) < 0.14) {
        if (m.num === next) { this.coupleOn(m); return; }
        this.bump(m, null); // wrong order: a soft bump, then everyone rolls back
        return;
      }
    }
    // carriages bumping into each other
    const lim = CAR_L * 0.82;
    for (let i = 0; i < this.movers.length; i++) for (let j = i + 1; j < this.movers.length; j++) {
      const a = this.movers[i], b = this.movers[j];
      if (a.state !== 'move' && b.state !== 'move') continue;
      const pa = this.centreOf(a), pb = this.centreOf(b);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < lim) { this.bump(a.state === 'move' ? a : b, a.state === 'move' ? b : a); return; }
    }
    // carriages bumping into the engine from the wrong side
    const e = { x: this.enginePiece.x + 0.5, y: this.enginePiece.y + 0.5 };
    for (const m of this.movers) {
      if (m.state !== 'move') continue;
      const c = this.centreOf(m);
      if (Math.hypot(c.x - e.x, c.y - e.y) < (ENG_L + CAR_L) / 2 * 0.8) { this.bump(m, null); return; }
    }
  }

  update(time: number, deltaMs: number) {
    const dt = Math.min(0.05, deltaMs / 1000);
    if (this.mode === 'run') {
      for (const m of this.movers) {
        if (m.state !== 'move') continue;
        m.speed = Math.min(SPEED, m.speed + 2.5 * dt);
        m.d += m.speed * dt;
        let guard = 0;
        while (m.state === 'move' && m.d >= m.trail.length && guard++ < 4) {
          const over = m.d - m.trail.length;
          m.d = m.trail.length;
          this.advance(m);
          if (m.state === 'move') m.d += over;
        }
      }
      this.checkContacts();
      if (this.mode === 'run' && !this.movers.some(m => m.state === 'move') && this.coupled.length < this.movers.length) {
        // everyone has stopped but the train isn't complete: roll back and try again
        this.mode = 'pause';
        sfx.wobble();
        this.time.delayedCall(900, () => this.startRewind());
      }
    } else if (this.mode === 'rewind') {
      let busy = false;
      for (const m of this.movers) {
        if (m.d <= m.d0) continue;
        m.speed = Math.min(REV_SPEED, m.speed + 4 * dt);
        m.d = Math.max(m.d0, m.d - m.speed * dt);
        busy = true;
      }
      if (!busy) this.finishRewind();
    } else if (this.mode === 'depart' && this.depart) {
      this.depart.speed = Math.min(SPEED, this.depart.speed + 1.5 * dt);
      this.depart.d += this.depart.speed * dt;
    } else if (this.mode === 'edit') {
      this.idle += dt;
      if (this.idle > 10) { this.idle = 0; this.showHint(); }
    }
    if (this.depart && (this.mode === 'depart' || this.mode === 'done')) this.placeDeparting(time);
    else for (const m of this.movers) this.placeMover(m, m.state === 'move' || m.state === 'rewind' ? Math.sin(time / 60 + m.num) * 1.5 : 0);
    this.puff(dt);
  }
}

function sameSides(p: Piece, g: Gap) {
  const a = sides(p), b = sides({ type: g.type, x: 0, y: 0, rot: g.rot, fixed: false });
  return a.length === b.length && a.every(s => b.includes(s));
}
