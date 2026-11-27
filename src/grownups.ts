// The grown-ups' settings: a small cog in the top right corner of every screen. Hold it for 1.5 s to open the panel
// (sound, track shadows, pixelated look, jump to any level), so a child's quick taps never open it.
import Phaser from 'phaser';
import { isMuted, setMuted, sfx } from './audio';
import { W, H } from './GameScene';
import { BIOMES, LEVELS, PER_BIOME, biomeOf } from './levels';
import { hintsOn, setHints, solvedLevels } from './progress';
import { PAL } from './terrain';
import { PIXEL_ON, USE_3D, look, saveLook } from './three/World3D';

const INK = 0x2d2a3e;
const FONT = 'Arial Rounded MT Bold, Arial, sans-serif';

/** A cog outline: `n` square teeth around a ring. */
function cogPoints(n: number, rIn: number, rOut: number) {
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    // tooth top a bit narrower than its base, so it reads as a cog and not a star
    const base = step * 0.27, top = step * 0.2;
    pts.push(
      { x: Math.cos(a - base) * rIn, y: Math.sin(a - base) * rIn },
      { x: Math.cos(a - top) * rOut, y: Math.sin(a - top) * rOut },
      { x: Math.cos(a + top) * rOut, y: Math.sin(a + top) * rOut },
      { x: Math.cos(a + base) * rIn, y: Math.sin(a + base) * rIn },
    );
  }
  return pts;
}

export interface GearHooks {
  /** called when the panel opens or closes, so the scene can ignore its own taps meanwhile */
  busy?: (b: boolean) => void;
  /** screen fade colour when jumping to a level */
  fade?: [number, number, number];
}

export function drawGear(scene: Phaser.Scene, hooks: GearHooks = {}, x = 1856, y = 66) {
  const c = scene.add.container(x, y).setDepth(400).setAlpha(0.6);
  const g = scene.add.graphics();
  g.fillStyle(INK).fillPoints(cogPoints(8, 24, 36), true);
  g.fillStyle(INK).fillCircle(0, 0, 25);
  g.fillStyle(0xd9dde0).fillPoints(cogPoints(8, 19, 30), true);
  g.fillStyle(0xd9dde0).fillCircle(0, 0, 20);
  g.fillStyle(INK).fillCircle(0, 0, 10);
  const ring = scene.add.graphics();
  c.add([g, ring]);
  c.setSize(96, 96).setInteractive();
  let timer: Phaser.Time.TimerEvent | null = null;
  let t0 = 0;
  const cancel = () => { timer?.remove(); timer = null; ring.clear(); };
  c.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
    ev?.stopPropagation?.();
    t0 = scene.time.now;
    timer = scene.time.addEvent({
      delay: 30, loop: true, callback: () => {
        const f = (scene.time.now - t0) / 1500;
        ring.clear().lineStyle(8, 0xffffff).beginPath().arc(0, 0, 46, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).strokePath();
        if (f >= 1) { cancel(); openPanel(scene, hooks); }
      },
    });
  });
  c.on('pointerup', cancel);
  c.on('pointerout', cancel);
  return c;
}

function openPanel(scene: Phaser.Scene, hooks: GearHooks) {
  hooks.busy?.(true);
  const layer = scene.add.container(0, 0).setDepth(500);
  const bg = scene.add.rectangle(W / 2, H / 2, W, H, 0x1c2b1a, 0.88).setInteractive();
  layer.add(bg);
  const toggle = (x: number, label: string, get: () => boolean, set: (v: boolean) => void) => {
    const c = scene.add.container(x, 170);
    const g = scene.add.graphics();
    const t = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '40px', color: '#2d2a3e', fontStyle: 'bold' }).setOrigin(0.5);
    const draw = () => {
      const on = get();
      g.clear().fillStyle(on ? 0x8ee06a : 0xcfd6cc).fillRoundedRect(-200, -60, 400, 120, 30);
      t.setText(`${label}: ${on ? 'on' : 'off'}`);
    };
    draw();
    c.add([g, t]);
    c.setSize(400, 120).setInteractive();
    c.on('pointerup', () => { set(!get()); sfx.boop(); draw(); });
    layer.add(c);
  };
  const xs = USE_3D ? [-660, -220, 220] : [-500, 0];
  toggle(W / 2 + xs[0], 'Sound', () => !isMuted(), v => setMuted(!v));
  toggle(W / 2 + xs[1], 'Track shadows', hintsOn, setHints);
  if (USE_3D) toggle(W / 2 + xs[2], 'Pixel look', () => look.pixel > 1, v => { look.pixel = v ? PIXEL_ON : 1; saveLook(); });
  const close = scene.add.text(W / 2 + (USE_3D ? 640 : 500), 170, '✕', { fontFamily: FONT, fontSize: '96px', color: '#ffffff' }).setOrigin(0.5).setInteractive();
  close.on('pointerup', () => { layer.destroy(); hooks.busy?.(false); });
  layer.add(close);
  // every level, ten to a row (one row per biome)
  const solved = solvedLevels();
  const fade = hooks.fade ?? (PAL[BIOMES[0]].fade as [number, number, number]);
  LEVELS.forEach((_, i) => {
    const b = biomeOf(i);
    const x = W / 2 + ((i % PER_BIOME) - 4.5) * 150, y = 400 + Math.floor(i / PER_BIOME) * 170;
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    g.fillStyle(PAL[b].board).fillRoundedRect(-62, -62, 124, 124, 24);
    g.lineStyle(6, PAL[b].lines).strokeRoundedRect(-62, -62, 124, 124, 24);
    const t = scene.add.text(0, 0, String(i + 1), { fontFamily: FONT, fontSize: '54px', color: '#2d2a3e', fontStyle: 'bold' }).setOrigin(0.5);
    c.add([g, t]);
    if (solved.has(i) && scene.textures.exists('star')) c.add(scene.add.image(44, -44, 'star').setScale(0.26));
    c.setSize(124, 124).setInteractive();
    c.on('pointerup', () => {
      scene.cameras.main.fadeOut(300, ...fade);
      scene.cameras.main.once('camerafadeoutcomplete', () => scene.scene.start('game', { level: i }));
    });
    layer.add(c);
  });
}
