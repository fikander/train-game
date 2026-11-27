import Phaser from 'phaser';
import { LEVELS, biomeOf, type Biome, type Gap, type Level } from './levels';
import { DX, DY, Trail, cellPath, opp, sides, traverse, type Dir, type Piece } from './track';
import { REF, VEH, dirAngle, drawPiece, drawSwitchMarker, makeTextures } from './art';
import { sfx } from './audio';
import { markSolved, nextLevel } from './progress';
import { PAL, drawForest, drawGround, drawHill, drawMeadow, drawPond, regions, type Cell } from './terrain';
import { hintsOn } from './progress';
import { CAR_L, ENG_L, SCALE, SPEED, TrainSim, fitRotation, junctionKeys, key, makeMover, type SimMover } from './sim';
import { solvedLevels } from './progress';
import { drawGear } from './grownups';
import { USE_3D, getWorld, type TerrainItem } from './three/World3D';

export const W = 1920, H = 1200;
const BOARD_TOP = 60, BOARD_BOTTOM = 950, TRAY_Y = 1080, TOKEN = 170;

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

interface Mover extends SimMover {
  v: Vehicle;
}

/** A train vehicle seen from above: shadow + base (sides) on the ground, top lifted up the screen. */
class Vehicle {
  shadow: Phaser.GameObjects.Image;
  base: Phaser.GameObjects.Image;
  top: Phaser.GameObjects.Image;
  chimney?: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  x = 0; y = 0; angle = 0; bob = 0; num = 0;
  private lift: number;
  k: number;
  constructor(scene: Phaser.Scene, public kind: string, cell: number) {
    this.k = cell / REF * SCALE;
    const isEngine = kind === 'engine';
    this.lift = (isEngine ? VEH.engine.lift : VEH.car.lift) * cell;
    this.shadow = scene.add.image(0, 0, `${kind}-base`).setScale(this.k * 1.02).setTint(0x1d3d14).setAlpha(0.28).setDepth(16);
    this.base = scene.add.image(0, 0, `${kind}-base`).setScale(this.k).setDepth(18);
    this.top = scene.add.image(0, 0, `${kind}-top`).setScale(this.k).setDepth(19);
    if (isEngine) this.chimney = scene.add.image(0, 0, 'engine-chimney').setScale(this.k).setDepth(21);
  }
  setNumber(scene: Phaser.Scene, n: number) {
    this.num = n;
    const fs = Math.round(70 * this.k);
    this.label = scene.add.text(0, 0, String(n), {
      fontFamily: 'Arial Black, Arial Rounded MT Bold, Arial, sans-serif', fontSize: `${fs}px`, color: '#ffffff', fontStyle: 'bold',
      stroke: '#2d2a3e', strokeThickness: Math.round(fs * 0.22),
    }).setOrigin(0.5).setDepth(22);
  }
  get parts(): Phaser.GameObjects.Components.Visible[] { return [this.shadow, this.base, this.top, ...(this.chimney ? [this.chimney] : []), ...(this.label ? [this.label] : [])]; }
  setPose(x: number, y: number, angle: number, bob = 0) {
    this.x = x; this.y = y; this.angle = angle; this.bob = bob;
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
  private biome: Biome = 'meadow';
  private blocked = new Set<string>(); // board squares with forest or water: pieces can't go there
  private sim!: TrainSim<Mover>;
  private coupled: Mover[] = []; // in order of arrival: 1, 2, 3
  private mode: Mode = 'edit';
  private depart: { trail: Trail; d: number; exitD: number; speed: number } | null = null;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffTimer = 0;
  private idle = 0;
  private hand!: Phaser.GameObjects.Text;
  private goBtn!: Phaser.GameObjects.Container;
  private goPulse?: Phaser.Tweens.Tween;
  // 3D board (see three/World3D.ts): what the terrain looks like and the track running off the board
  terrain3d: TerrainItem[] = [];
  extraTrack: Piece[] = [];
  groundKey = '';

  constructor() { super('game'); }

  init(data: { level?: number }) {
    this.li = Math.min(LEVELS.length - 1, Math.max(0, data.level ?? nextLevel()));
    this.L = LEVELS[this.li];
    this.biome = biomeOf(this.li);
    this.grid = new Map(); this.gaps = new Map(); this.pieceGfx = new Map(); this.markers = new Map();
    this.tokens = []; this.movers = []; this.blocked = new Set(); this.coupled = []; this.depart = null;
    this.mode = 'edit'; this.idle = 0; this.goPulse = undefined; this.leaving = false; this.celebrateOnce = false;
    this.terrain3d = []; this.extraTrack = [];
  }

  create() {
    makeTextures(this);
    saveLevel(this.li);
    const L = this.L;
    this.cell = Math.floor(Math.min(1580 / L.cols, (BOARD_BOTTOM - BOARD_TOP) / L.rows, 230));
    this.ox = Math.round((W - L.cols * this.cell) / 2);
    this.oy = Math.round(BOARD_TOP + (BOARD_BOTTOM - BOARD_TOP - L.rows * this.cell) / 2);
    // in 3D the camera is aimed first: everything on screen over the board goes through it
    this.view?.frame(this.ox, this.oy, L.cols * this.cell, L.rows * this.cell);

    for (const p of L.pieces) this.grid.set(key(p.x, p.y), { ...p });
    for (const p of this.grid.values()) if (p.type === 'car') p.buffer = !this.grid.has(key(p.x - DX[p.rot], p.y - DY[p.rot]));
    for (const g of L.gaps) this.gaps.set(key(g.x, g.y), g);
    // switches where lines only join have nothing to set: they are drawn as plain junctions
    for (const k of junctionKeys(L)) this.grid.get(k)!.junction = true;
    this.sim = new TrainSim(this.grid, this.movers, this.coupled);
    this.drawBackground();
    for (const p of this.grid.values()) this.addPieceView(p);
    this.drawTray();
    this.drawGoButton();
    this.drawHomeButton();

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

    // the line carries on past the board and off the edge of the screen
    for (const p of this.grid.values()) {
      if (p.type !== 'exit') continue;
      for (let i = 1; i < 30; i++) {
        const cx = p.x + DX[p.rot] * i, cy = p.y + DY[p.rot] * i;
        const sx = this.px(cx + 0.5), sy = this.py(cy + 0.5);
        const on = this.scr(sx, sy);
        if (on.x < -this.cell || on.x > W + this.cell || on.y < -this.cell || on.y > H + this.cell) break;
        const g = this.add.graphics().setDepth(2).setPosition(sx, sy);
        const piece: Piece = { type: 'straight', x: cx, y: cy, rot: p.rot % 2 === 1 ? 0 : 1, fixed: true };
        drawPiece(g, piece, this.cell);
        this.extraTrack.push(piece);
      }
    }
    this.drawTunnels();
    // grown-ups can turn on faint shadows of the track that fits each square
    if (hintsOn()) for (const gp of L.gaps) {
      const g = this.add.graphics().setDepth(1).setAlpha(0.16).setPosition(this.px(gp.x + 0.5), this.py(gp.y + 0.5));
      drawPiece(g, { type: gp.type, x: 0, y: 0, rot: gp.rot, fixed: true }, this.cell);
    }

    this.hand = this.add.text(0, 0, '👆', { fontSize: '120px', padding: { top: 40, bottom: 10, left: 10, right: 10 } }).setOrigin(0.36, 0.2).setDepth(100).setVisible(false);

    this.setupInput();
    if (USE_3D) this.start3D();

    this.cameras.main.fadeIn(400, ...PAL[this.biome].fade as [number, number, number]);
    this.time.delayedCall(500, () => {
      sfx.bell();
      for (const m of this.movers) {
        const v = m.v;
        const { x, y, angle } = v;
        this.tweens.addCounter({ from: 0, to: 1, duration: 900, onUpdate: tw => v.setPose(x, y, angle + Math.sin((tw.getValue() ?? 0) * Math.PI * 6) * 0.1), onComplete: () => v.setPose(x, y, angle) });
      }
    });
    (window as any).__scene = this;
  }

  /** Hand the board over to the 3D layer: Phaser keeps only the tray, buttons and effects on top. */
  private start3D() {
    const world = getWorld(W, H);
    world.build(this as any);
    for (const o of this.children.list as any[]) {
      if (o.getData?.('token')) continue;
      // not drawn by Phaser's camera any more, but still there (the 3D layer reads their poses, scale and alpha)
      if (o.depth >= 1 && o.depth < 50) o.cameraFilter = this.cameras.main.id;
    }
    // smoke comes out of the 3D chimney instead
    (this.smoke as any).emitParticleAt = (_x: number, _y: number, n = 1) => { world.puff(n); return undefined; };
    this.events.once('shutdown', () => world.hide());
  }

  /** A hill over each tunnel mouth, drawn above the carriages so they disappear inside; each pair has its own colour. */
  private drawTunnels() {
    for (const p of this.grid.values()) {
      if (p.type !== 'portal') continue;
      const end = { x: this.px(p.x + 0.5 + DX[p.rot] * 0.5), y: this.py(p.y + 0.5 + DY[p.rot] * 0.5), a: dirAngle(p.rot) };
      const g = this.add.graphics().setDepth(30);
      drawHill(g, [{ x: this.px(p.x + 0.5), y: this.py(p.y + 0.5) }], this.cell, this.biome, [end], p.pair ?? 0);
    }
  }

  // ---------- coordinates ----------
  /** The 3D layer, when it is on. Game logic stays in flat board coordinates (design px); the camera turns them. */
  private get view() { return USE_3D ? getWorld(W, H) : null; }
  /** Where a board point (design px) shows on screen; h = height above the ground, in squares. */
  private scr(x: number, y: number, h = 0) { const w = this.view; return w ? w.toScreen(x, y, h * this.cell) : { x, y: y - h * this.cell }; }
  /** How big a square looks on screen. */
  private get scell() { const w = this.view; return w ? this.cell * w.k : this.cell; }

  private px(u: number) { return this.ox + u * this.cell; }
  private py(v: number) { return this.oy + v * this.cell; }

  // ---------- drawing ----------
  private drawBackground() {
    // drawn once into a texture: thousands of shapes would be far too slow to redraw every frame
    const g = this.make.graphics({}, false);
    const { cols, rows } = this.L, s = this.cell;
    const rnd0 = new Phaser.Math.RandomDataGenerator([`ground${this.li}`]);
    // textured grass: soft mottled patches + speckles
    const P = PAL[this.biome];
    // the turned 3D camera sees past the screen's edges, so its ground reaches half a screen further each way
    const GX = USE_3D ? W / 2 : 0, GY = USE_3D ? H / 2 : 0, ox = this.ox + GX, oy = this.oy + GY;
    drawGround(g, this.biome, rnd0, W + GX * 2, H + GY * 2);
    // the play area: slightly lighter, with thin hand-drawn grid lines
    g.fillStyle(P.board, 0.45).fillRoundedRect(ox - 10, oy - 10, cols * s + 20, rows * s + 20, 24);
    g.lineStyle(3, P.lines, 0.35);
    for (let x = 0; x <= cols; x++) g.lineBetween(ox + x * s + rnd0.between(-2, 2), oy - 16, ox + x * s + rnd0.between(-2, 2), oy + rows * s + 16);
    for (let y = 0; y <= rows; y++) g.lineBetween(ox - 16, oy + y * s + rnd0.between(-2, 2), ox + cols * s + 16, oy + y * s + rnd0.between(-2, 2));
    // in 3D the ground is painted on its own; the shelf and scenery are drawn separately
    const shelf = USE_3D ? this.add.graphics().setDepth(0) : g;
    // tray shelf (only when there are pieces to place)
    if (this.L.gaps.length + (this.L.spare?.length ?? 0) > 0) shelf.fillStyle(0x000000, 0.12)
      .fillRoundedRect(40, 972, 1560, 216, 36)
      .fillStyle(0xd9a066).fillRoundedRect(40, 964, 1560, 216, 36)
      .fillStyle(0xe8b77f).fillRoundedRect(56, 978, 1528, 188, 28);
    const bgKey = `bg${this.li}`;
    if (USE_3D) {
      // the scenery is still worked out here (it decides which squares are blocked), but drawn in 3D
      const scratch = this.make.graphics({}, false);
      this.drawTerrain(scratch);
      scratch.destroy();
    } else this.drawTerrain(g);
    if (this.textures.exists(bgKey)) this.textures.remove(bgKey);
    g.generateTexture(bgKey, W + GX * 2, H + GY * 2);
    g.destroy();
    this.groundKey = bgKey;
    if (!USE_3D) this.add.image(0, 0, bgKey).setOrigin(0).setDepth(0);
  }

  /**
   * Background terrain, baked into the ground texture: forests and ponds in bigger clumps, quiet colours, no animals.
   * Some empty squares stay plain grass, so the squares to fill don't stand out.
   */
  private drawTerrain(g: Phaser.GameObjects.Graphics) {
    const { cols, rows } = this.L, s = this.cell;
    const rnd = new Phaser.Math.RandomDataGenerator([`terrain${this.li}`]);
    const centre = (c: Cell): Cell => ({ x: this.px(c.x + 0.5), y: this.py(c.y + 0.5) });
    // inside the board: groups of empty squares
    const empty: Cell[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!this.grid.has(key(x, y)) && !this.gaps.has(key(x, y))) empty.push({ x, y });
    // big open areas get a mix: one pond, some plain grass, and forest in the rest
    for (const r of regions(empty)) {
      if (r.length === 1) {
        if (rnd.frac() < 0.6) { drawMeadow(g, centre(r[0]), s, rnd, this.biome); this.terrain3d.push({ kind: 'meadow', pt: centre(r[0]), s }); } else { drawForest(g, [centre(r[0])], s * 0.75, rnd, this.biome); this.terrain3d.push({ kind: 'forest', pts: [centre(r[0])], s: s * 0.75 }); this.blocked.add(key(r[0].x, r[0].y)); }
        continue;
      }
      let rest = r;
      if (r.length >= 3 && rnd.frac() < 0.8) {
        const want = Math.min(4, Math.max(2, Math.floor(r.length / 4)));
        const pond = [rnd.pick(r)];
        while (pond.length < want) {
          const next = r.find(c => !pond.includes(c) && pond.some(q => Math.abs(q.x - c.x) + Math.abs(q.y - c.y) === 1));
          if (!next) break;
          pond.push(next);
        }
        drawPond(g, pond.map(centre), s, rnd, this.biome);
        this.terrain3d.push({ kind: 'pond', pts: pond.map(centre), s });
        for (const c of pond) this.blocked.add(key(c.x, c.y));
        rest = r.filter(c => !pond.includes(c));
      }
      // plenty of open grass, so there is room to try other ways
      const grass = rest.filter(() => rnd.frac() < 0.45);
      for (const c of grass) { drawMeadow(g, centre(c), s, rnd, this.biome); this.terrain3d.push({ kind: 'meadow', pt: centre(c), s }); }
      const trees = rest.filter(c => !grass.includes(c));
      for (const c of trees) this.blocked.add(key(c.x, c.y));
      for (const f of regions(trees)) { drawForest(g, f.map(centre), s * 0.9, rnd, this.biome); this.terrain3d.push({ kind: 'forest', pts: f.map(centre), s: s * 0.9 }); }
    }
    // around the board: a few forests in the margins, kept clear of buttons, tray and the line out
    const exitRows = this.L.pieces.filter(p => p.type === 'exit').map(p => this.py(p.y + 0.5));
    const free = (x: number, y: number) => {
      if (x > this.ox - s * 0.6 && x < this.ox + cols * s + s * 0.6 && y > this.oy - s * 0.6 && y < this.oy + rows * s + s * 0.6) return false;
      if (exitRows.some(ey => Math.abs(y - ey) < s * 0.8 && x > this.ox + cols * s - s)) return false;
      const q = this.scr(x, y); // buttons and tray are on the screen, wherever the camera points
      return !(q.y > 930) && !(q.x < 220 && q.y < 200) && !(q.x > 1780 && q.y < 120) && !(q.y < 70 && Math.abs(q.x - W / 2) < 260) &&
        (!USE_3D || (q.x > -150 && q.x < W + 150 && q.y > -150));
    };
    const ms = Math.min(s, 150);
    for (let i = 0; i < (USE_3D ? 30 : 9); i++) {
      let x = USE_3D ? rnd.between(-W / 2, W * 1.5) : rnd.between(0, W), y = USE_3D ? rnd.between(-H / 2, H * 1.5) : rnd.between(0, 930);
      if (!free(x, y)) continue;
      const clump: Cell[] = [{ x, y }];
      for (let j = 0; j < rnd.between(2, 5); j++) {
        x += rnd.pick([-1, 1, 0]) * ms * 0.7; y += rnd.pick([-1, 1, 0]) * ms * 0.6;
        if (free(x, y)) clump.push({ x, y });
      }
      drawForest(g, clump, ms, rnd, this.biome);
      this.terrain3d.push({ kind: 'forest', pts: clump, s: ms });
    }
  }

  private addPieceView(p: Piece) {
    const k = key(p.x, p.y);
    const g = this.add.graphics().setDepth(2).setPosition(this.px(p.x + 0.5), this.py(p.y + 0.5));
    drawPiece(g, p, this.cell);
    this.pieceGfx.set(k, g);
    if (p.type === 'switch' && !p.junction) {
      const m = this.add.graphics().setDepth(3).setPosition(g.x, g.y);
      drawSwitchMarker(m, p, this.cell);
      this.markers.set(k, m);
      const zp = this.scr(g.x, g.y);
      const zone = this.add.zone(zp.x, zp.y, this.scell, this.scell).setInteractive();
      zone.on('pointerdown', () => this.flipSwitch(p));
    }
    if (p.type === 'car' && p.car) {
      const v = new Vehicle(this, p.car, this.cell);
      v.setNumber(this, p.num ?? 1);
      const m: Mover = { ...makeMover(p), v };
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

  /** House in the top-left corner: back to the map of all levels. */
  private drawHomeButton() {
    drawGear(this, { fade: PAL[this.biome].fade as [number, number, number] });
    const c = this.add.container(86, 84).setDepth(200);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillCircle(0, 8, 62);
    g.fillStyle(0xffffff).fillCircle(0, 0, 62);
    g.fillStyle(0xffd23f).fillCircle(0, 0, 54);
    // little house
    g.fillStyle(0x2d2a3e).fillTriangle(-40, -2, 0, -38, 40, -2);
    g.fillStyle(0xe8483f).fillTriangle(-32, -6, 0, -31, 32, -6);
    g.fillStyle(0x2d2a3e).fillRoundedRect(-27, -8, 54, 42, 6);
    g.fillStyle(0xffffff).fillRoundedRect(-22, -4, 44, 33, 4);
    g.fillStyle(0x2f6fd1).fillRoundedRect(-8, 6, 16, 23, 3);
    c.add(g);
    c.setSize(140, 140).setInteractive();
    c.on('pointerdown', () => { this.tweens.add({ targets: c, scale: 0.88, duration: 80, yoyo: true }); sfx.boop(); });
    c.on('pointerup', () => this.goToMap(false));
  }

  private leaving = false;
  private goToMap(won: boolean) {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(300, ...PAL[this.biome].fade as [number, number, number]);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('map', { from: this.li, won }));
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
      this.tweens.add({ targets: obj, scale: this.scell / TOKEN * 1.08, duration: 120 });
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

  /** The board square under the pointer, if a piece may go there (open grass or a gap, not already taken). */
  private dropSquare(px: number, py: number, t: Token): { x: number; y: number; ok: boolean } | null {
    if (this.view) ({ x: px, y: py } = this.view.fromScreen(px, py));
    const x = Math.floor((px - this.ox) / this.cell), y = Math.floor((py - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.L.cols || y >= this.L.rows) return null;
    const k = key(x, y);
    const ok = !this.blocked.has(k) && (!this.grid.has(k) || t.cell === k);
    return { x, y, ok };
  }

  private dropToken(t: Token, px: number, py: number) {
    const c = t.c;
    const sq = this.dropSquare(px, py, t);
    if (t.cell) { this.grid.delete(t.cell); t.cell = null; }
    if (sq?.ok) {
      const k = key(sq.x, sq.y);
      t.cell = k;
      // if only one way round joins up with the track next to it, it lands that way; otherwise the child taps to turn it
      t.rot = fitRotation(this.grid, sq.x, sq.y, t.type) ?? t.rot;
      this.grid.set(k, { type: t.type, x: sq.x, y: sq.y, rot: t.rot, fixed: false });
      drawPiece(t.g, { type: t.type, x: 0, y: 0, rot: t.rot, fixed: false }, TOKEN);
      c.setDepth(10);
      const { x: tx, y: ty } = this.scr(this.px(sq.x + 0.5), this.py(sq.y + 0.5));
      this.tweens.add({
        targets: c, x: tx, y: ty, scale: this.scell / TOKEN, duration: 140, ease: 'Back.Out',
        onComplete: () => {
          sfx.clack();
          this.tweens.add({ targets: c, scale: this.scell / TOKEN * 1.08, duration: 90, yoyo: true });
          this.sparkle(tx, ty);
          this.checkComplete();
        },
      });
      return;
    }
    if (sq && this.blocked.has(key(sq.x, sq.y))) {
      // trees or water: wobble over the square, then slide home
      sfx.wobble();
      const { x: tx, y: ty } = this.scr(this.px(sq.x + 0.5), this.py(sq.y + 0.5));
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

  private checkComplete() {
    const ok = this.tokens.every(t => t.cell) && this.mode === 'edit';
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
      const { x: cx, y: cy } = this.scr(this.px(g.x + 0.5), this.py(g.y + 0.5));
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
    sfx.toot();
    if (this.mode !== 'edit') return;
    if (this.goPulse) { this.goPulse.stop(); this.goPulse = undefined; this.goBtn.setScale(1); }
    this.mode = 'run';
    this.sim.start();
  }

  private frontOf(m: Mover) { return this.sim.frontOf(m); }
  private centreOf(m: Mover) { return this.sim.centreOf(m); }
  private tailPoint() { return this.sim.tailPoint(); }

  private bump(a: Mover, b: Mover | null) {
    (window as any).__bump = { a: a.num, b: b?.num ?? 'engine/order', fa: this.frontOf(a), tail: this.tailPoint(), cb: b ? this.centreOf(b) : null, ca: this.centreOf(a) };
    this.mode = 'pause';
    for (const m of this.movers) if (m.state === 'move') { m.state = 'stop'; m.speed = 0; }
    sfx.boing();
    const pa = this.frontOf(a);
    const pb = b ? this.centreOf(b) : this.tailPoint();
    const at = this.scr(this.px((pa.x + pb.x) / 2), this.py((pa.y + pb.y) / 2), 0.2);
    this.starBurst(at.x, at.y);
    a.v.squash(this); b?.v.squash(this);
    if (!b) this.engine.squash(this);
    // everyone stays where they crashed, looking upset, then pops back to the start
    this.distress(a.v);
    if (b) this.distress(b.v);
    this.time.delayedCall(1500, () => this.quickReset());
  }

  private distressMarks: Phaser.GameObjects.Graphics[] = [];

  /** Cartoon upset squiggles over a vehicle. */
  private distress(v: Vehicle) {
    const s = this.scell;
    const at = this.scr(v.x, v.y, 0.4);
    const g = this.add.graphics().setDepth(40).setPosition(at.x, at.y);
    for (const ang of [-0.55, 0, 0.55]) {
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14, r = s * (0.12 + t * 0.36), wig = Math.sin(t * Math.PI * 4) * s * 0.05;
        const a = -Math.PI / 2 + ang;
        pts.push(new Phaser.Math.Vector2(Math.cos(a) * r - Math.sin(a) * wig, Math.sin(a) * r + Math.cos(a) * wig));
      }
      g.lineStyle(s * 0.06, 0x2d2a3e).strokePoints(pts, false);
    }
    g.setScale(0.2);
    this.tweens.add({ targets: g, scale: 1, duration: 160, ease: 'Back.Out' });
    this.tweens.add({ targets: g, angle: { from: -8, to: 8 }, duration: 110, yoyo: true, repeat: -1 });
    this.distressMarks.push(g);
  }

  /** Quick reset after a crash or getting stuck: fade out where they stand, reappear at the start. */
  private quickReset() {
    this.mode = 'rewind';
    sfx.oops();
    const parts = this.movers.flatMap(m => m.v.parts) as unknown as Phaser.GameObjects.Image[];
    const base = parts.map(p => p.alpha);
    const marks = this.distressMarks.splice(0);
    const fade = (to: number, duration: number, done: () => void) => this.tweens.addCounter({
      from: to ? 0 : 1, to, duration,
      onUpdate: tw => { const k = tw.getValue() ?? 0; parts.forEach((p, i) => p.setAlpha(base[i] * k)); marks.forEach(g => g.setAlpha(k)); },
      onComplete: done,
    });
    fade(0, 220, () => {
      marks.forEach(g => g.destroy());
      this.coupled.length = 0;
      this.finishRewind();
      this.mode = 'rewind';
      fade(1, 260, () => { parts.forEach((p, i) => p.setAlpha(base[i])); this.mode = 'edit'; this.checkComplete(); });
    });
  }

  private finishRewind() {
    for (const m of this.movers) {
      m.d = m.d0;
      m.trail.truncate(m.len0);
      m.pending = { ...m.start };
      m.state = 'idle';
      m.speed = 0;
    }
    this.mode = 'edit';
    sfx.boop();
  }

  private coupleOn(m: Mover) {
    sfx.clunk();
    const t = this.frontOf(m);
    const at = this.scr(this.px(t.x), this.py(t.y), 0.15);
    this.starBurst(at.x, at.y);
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
    const trail = last.trail.copy(); // keeps the jumps through tunnels
    let { x, y, dir } = last.pending;
    let exitD = trail.length + 20;
    for (let guard = 0; guard < 30; guard++) {
      const p = this.grid.get(key(x, y));
      if (!p) break;
      const entry = opp(dir);
      const out = p.type === 'engine' ? (p.rot as Dir) : traverse(p, entry);
      if (out === null) break;
      if (p.type === 'exit') {
        // drive straight on until the whole train is off the screen
        // straight on until it is off the screen
        let toEdge = 0;
        for (; toEdge < 40; toEdge++) {
          const q = this.scr(this.px(x + 0.5 + DX[out] * toEdge), this.py(y + 0.5 + DY[out] * toEdge));
          if (q.x < -this.scell || q.x > W + this.scell || q.y < -this.scell || q.y > H + this.scell) break;
        }
        trail.add([{ x: x + 0.5, y: y + 0.5 }, { x: x + 0.5 + DX[out] * (toEdge + 8), y: y + 0.5 + DY[out] * (toEdge + 8) }]);
        exitD = trail.length - 8 + 0.6;
        break;
      }
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
    // the happy whistle as the train left is the celebration; straight back to the map
    const firstWin = !solvedLevels().has(this.li);
    markSolved(this.li);
    this.time.delayedCall(400, () => this.goToMap(firstWin));
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
    // chuffs start slow and speed up as the train gets going
    this.puffTimer = moving ? Math.max(0.16, 0.5 - (this.depart?.speed ?? 0) * 0.2) : 0.8;
    const sp = this.engine.smokePoint;
    this.smoke.emitParticleAt(sp.x, sp.y, 1);
    if (moving) sfx.chuff();
  }

  update(time: number, deltaMs: number) {
    const dt = Math.min(0.05, deltaMs / 1000);
    if (this.mode === 'run') {
      const ev = this.sim.step(dt);
      if (ev?.type === 'couple') this.coupleOn(ev.m);
      else if (ev?.type === 'bump') this.bump(ev.a, ev.b);
      else if (ev?.type === 'stuck') {
        // everyone has stopped but the train isn't complete: roll back and try again
        this.mode = 'pause';
        sfx.wobble();
        for (const m of this.movers) if (m.state !== 'coupled') this.distress(m.v);
        this.time.delayedCall(1300, () => this.quickReset());
      }
    } else if (this.mode === 'depart' && this.depart) {
      this.depart.speed = Math.min(SPEED, this.depart.speed + 1.5 * dt);
      this.depart.d += this.depart.speed * dt;
    } else if (this.mode === 'edit') {
      this.idle += dt;
      if (this.idle > 10) { this.idle = 0; this.showHint(); }
    }
    if (this.depart && (this.mode === 'depart' || this.mode === 'done')) this.placeDeparting(time);
    else for (const m of this.movers) this.placeMover(m, m.state === 'move' ? Math.sin(time / 60 + m.num) * 1.5 : 0);
    this.puff(dt);
    if (USE_3D) getWorld(W, H).sync(this.game.canvas, time, dt);
  }
}

function sameSides(p: Piece, g: Gap) {
  const a = sides(p), b = sides({ type: g.type, x: 0, y: 0, rot: g.rot, fixed: false });
  return a.length === b.length && a.every(s => b.includes(s));
}
