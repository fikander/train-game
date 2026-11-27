// Pixelated look for the whole screen. When the pixel size is above 1, the 3D board and Phaser's canvas (tray,
// buttons, map, start screen) are copied every frame into one small canvas, which is shown blown up with hard pixel
// edges. Phaser's own canvas stays on top, invisible, so it still gets every tap.
import type Phaser from 'phaser';
import { look, peekWorld } from './World3D';

export function setupDisplay(game: Phaser.Game) {
  const parent = document.getElementById('game')!;
  const out = document.createElement('canvas');
  out.style.cssText = 'position:absolute;z-index:0;pointer-events:none;image-rendering:pixelated;display:none';
  parent.prepend(out);
  const ctx = out.getContext('2d')!;
  game.events.on('postrender', () => {
    const src = game.canvas;
    const w3 = peekWorld();
    const el3 = w3?.renderer.domElement;
    if (look.pixel <= 1) {
      out.style.display = 'none';
      src.style.opacity = '';
      if (el3) el3.style.visibility = '';
      return;
    }
    const r = src.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    const k = Math.min(2, window.devicePixelRatio || 1) / look.pixel;
    const w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k));
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    out.style.left = `${r.left - pr.left}px`; out.style.top = `${r.top - pr.top}px`;
    out.style.width = `${r.width}px`; out.style.height = `${r.height}px`;
    out.style.display = 'block';
    src.style.opacity = '0';
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (w3?.active && el3) {
      el3.style.visibility = 'hidden';
      ctx.drawImage(el3, 0, 0, w, h);
    }
    ctx.drawImage(src, 0, 0, w, h);
  });
}
