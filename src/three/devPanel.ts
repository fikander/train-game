// Grown-up tinkering panel for the 3D look: open the game with ?dev in the address.
// Sliders change the camera and effects live; the values are remembered on this device (Reset puts them back).
import { DEFAULTS, look, type Look } from './World3D';

interface Slider { key: keyof Look; label: string; min: number; max: number; step: number }
const SLIDERS: Slider[] = [
  { key: 'pitch', label: 'Look down (°)', min: 25, max: 90, step: 1 },
  { key: 'yaw', label: 'Turn (°)', min: -60, max: 60, step: 1 },
  { key: 'pixel', label: 'Pixel size', min: 1, max: 8, step: 1 },
  { key: 'ink', label: 'Outline width', min: 0, max: 3, step: 0.1 },
  { key: 'shadow', label: 'Shadow', min: 0, max: 0.6, step: 0.02 },
  { key: 'bands', label: 'Light steps', min: 1, max: 6, step: 1 },
];

export function devPanel(apply: () => void, restart: () => void) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:8px;right:8px;z-index:30;background:rgba(255,255,255,.92);border-radius:10px;padding:10px 12px;' +
    'font:13px system-ui,sans-serif;color:#2d2a3e;box-shadow:0 2px 10px rgba(0,0,0,.25);width:230px;touch-action:auto;user-select:none';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:6px';
  head.textContent = '3D look';
  const fold = document.createElement('button');
  fold.textContent = '–';
  fold.style.cssText = 'border:0;background:#eee;border-radius:6px;width:26px;height:22px';
  head.appendChild(fold);
  box.appendChild(head);
  const body = document.createElement('div');
  box.appendChild(body);
  fold.onclick = () => { const open = body.style.display !== 'none'; body.style.display = open ? 'none' : ''; fold.textContent = open ? '+' : '–'; };
  const inputs: { s: Slider; i: HTMLInputElement; v: HTMLSpanElement }[] = [];
  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin:6px 0';
    const v = document.createElement('span');
    v.style.cssText = 'float:right;font-variant-numeric:tabular-nums';
    row.append(s.label, v);
    const i = document.createElement('input');
    i.type = 'range'; i.min = String(s.min); i.max = String(s.max); i.step = String(s.step); i.value = String(look[s.key]);
    i.style.cssText = 'width:100%';
    i.oninput = () => { (look as any)[s.key] = Number(i.value); v.textContent = i.value; apply(); };
    v.textContent = i.value;
    row.appendChild(i);
    body.appendChild(row);
    inputs.push({ s, i, v });
  }
  const note = document.createElement('div');
  note.style.cssText = 'font-size:11px;color:#666;margin:4px 0 8px';
  note.textContent = 'After turning the camera, press Restart so taps line up again.';
  body.appendChild(note);
  const btn = (text: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = text; b.onclick = fn;
    b.style.cssText = 'margin-right:6px;padding:4px 10px;border:0;border-radius:6px;background:#3fbf6f;color:#fff;font-weight:700';
    body.appendChild(b);
  };
  btn('Restart level', restart);
  btn('Reset', () => {
    Object.assign(look, DEFAULTS);
    for (const { s, i, v } of inputs) { i.value = String(look[s.key]); v.textContent = i.value; }
    apply();
    restart();
  });
  // keep the game from seeing touches on the panel
  for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup']) box.addEventListener(ev, e => e.stopPropagation());
  document.body.appendChild(box);
}
