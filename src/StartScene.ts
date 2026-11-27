import Phaser from 'phaser';
import { REF, VEH, drawRails, makeTextures } from './art';
import { unlockAudio } from './audio';
import { W, H } from './GameScene';
import { drawGear } from './grownups';

export class StartScene extends Phaser.Scene {
  constructor() { super('start'); }

  create() {
    makeTextures(this);
    const g = this.make.graphics({}, false);
    g.fillStyle(0x7cc85a).fillRect(0, 0, W, H);
    const rnd = new Phaser.Math.RandomDataGenerator(['start']);
    for (let i = 0; i < 60; i++) g.fillStyle(rnd.pick([0x86d063, 0x72bd50]), 0.7).fillCircle(rnd.between(0, W), rnd.between(0, H), rnd.between(30, 110));
    for (let i = 0; i < 500; i++) g.fillStyle(0x4f8f36, 0.5).fillCircle(rnd.between(0, W), rnd.between(0, H), rnd.between(1, 3));
    if (!this.textures.exists('startbg')) g.generateTexture('startbg', W, H);
    g.destroy();
    this.add.image(0, 0, 'startbg').setOrigin(0);

    // a straight track across the screen
    const cell = 240;
    for (let x = -cell / 2; x < W + cell; x += cell) {
      const t = this.add.graphics().setPosition(x, 520);
      drawRails(t, 3, 1, cell, false);
    }
    const k = cell / REF * 0.9;
    const parts: Phaser.GameObjects.Image[] = [];
    const vehicle = (kind: string, x: number) => {
      const lift = (kind === 'engine' ? VEH.engine.lift : VEH.car.lift) * cell;
      parts.push(this.add.image(x + lift * 0.5, 520 + lift * 0.6, `${kind}-base`).setScale(k).setTint(0x1d3d14).setAlpha(0.28));
      parts.push(this.add.image(x, 520, `${kind}-base`).setScale(k));
      const top = this.add.image(x, 520 - lift, `${kind}-top`).setScale(k);
      parts.push(top);
      return top;
    };
    ['tank', 'passenger', 'coal'].forEach((kind, i) => vehicle(kind, 520 + i * 200));
    const eng = vehicle('engine', 1130);
    const chim = this.add.image(1130 + 38 * k, 520 - VEH.engine.lift * cell * 1.9, 'engine-chimney').setScale(k);
    const tops = [...parts, chim];
    this.tweens.add({ targets: tops, y: '-=4', duration: 300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    void eng;
    const smoke = this.add.particles(0, 0, 'puff', {
      lifespan: 2200, scale: { start: 0.6, end: 1.8 }, alpha: { start: 0.95, end: 0 },
      speedY: { min: -120, max: -70 }, speedX: { min: -70, max: -30 }, frequency: 300,
    });
    smoke.startFollow(chim, 0, -6);

    // big play button
    const btn = this.add.container(W / 2, 900);
    const b = this.add.graphics();
    b.fillStyle(0x000000, 0.18).fillCircle(0, 14, 150);
    b.fillStyle(0x2d2a3e).fillCircle(0, 0, 156);
    b.fillStyle(0x1f8a4c).fillCircle(0, 0, 150);
    b.fillStyle(0x3fcf6f).fillCircle(0, -6, 136);
    b.fillStyle(0xffffff, 0.25).fillEllipse(-40, -70, 130, 56);
    b.fillStyle(0xffffff).fillTriangle(-42, -70, -42, 64, 72, -3);
    btn.add(b);
    btn.setSize(320, 320).setInteractive();
    this.tweens.add({ targets: btn, scale: 1.08, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      unlockAudio();
      try { if (!this.scale.isFullscreen && !import.meta.env.DEV) this.scale.startFullscreen(); } catch { /* ignore */ }
      try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}); } catch { /* ignore */ }
      this.cameras.main.fadeOut(350, 124, 200, 90);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        const lv = levelFromUrl();
        if (lv !== null) this.scene.start('game', { level: lv }); else this.scene.start('map', {});
      });
    };
    btn.on('pointerup', go);
    drawGear(this, { busy: b => { started = b; } });
  }
}

function levelFromUrl(): number | null {
  const m = /[?&]level=(\d+)/.exec(location.search);
  return m ? parseInt(m[1], 10) - 1 : null;
}
