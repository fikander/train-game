import Phaser from 'phaser';
import { makeTextures } from './art';
import { unlockAudio } from './audio';
import { W, H, savedLevel } from './GameScene';

export class StartScene extends Phaser.Scene {
  constructor() { super('start'); }

  create() {
    makeTextures(this);
    const g = this.add.graphics();
    g.fillStyle(0x7cc85a).fillRect(0, 0, W, H);
    g.fillStyle(0x9bd86f).fillEllipse(W / 2, 1150, 2400, 500);
    // a little track for the engine to sit on
    g.fillStyle(0xa8693a);
    for (let x = 200; x < W - 150; x += 60) g.fillRect(x, 560, 22, 110);
    g.fillStyle(0x5d6670).fillRect(160, 580, W - 320, 14).fillRect(160, 636, W - 320, 14);
    g.fillStyle(0xc9d1da).fillRect(160, 583, W - 320, 7).fillRect(160, 639, W - 320, 7);

    const s = 2.4;
    const cars = ['car-tank', 'car-passenger', 'car-coal'].map((k, i) => this.add.image(400 + i * 400, 540, k).setScale(s * 0.9));
    const engine = this.add.image(1640, 540, 'engine').setScale(s);
    this.tweens.add({ targets: [engine, ...cars], y: '-=10', duration: 380, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const smoke = this.add.particles(0, 0, 'puff', {
      lifespan: 2200, scale: { start: 0.8, end: 2.6 }, alpha: { start: 0.9, end: 0 },
      speedY: { min: -140, max: -80 }, speedX: { min: -60, max: -20 }, frequency: 320,
    });
    smoke.startFollow(engine, 50 * s, -73 * s);

    // big play button
    const btn = this.add.container(W / 2, 930);
    const b = this.add.graphics();
    b.fillStyle(0x000000, 0.18).fillCircle(0, 14, 150);
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
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game', { level: levelFromUrl() ?? savedLevel() }));
    };
    btn.on('pointerup', go);
    engine.setInteractive().on('pointerup', go);
  }
}

function levelFromUrl(): number | null {
  const m = /[?&]level=(\d+)/.exec(location.search);
  return m ? parseInt(m[1], 10) - 1 : null;
}
