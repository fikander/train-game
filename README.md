# Choo-Choo Builder

A track-building train puzzle for a 3-year-old, made for an Android tablet (landscape).
Drag track pieces into the dashed squares, flip switches by tapping them, then press the big green Go button.
The white steam engine collects the coal truck, passenger coach and tank wagon and drives into the tunnel.

- No reading, no fail states: wrong pieces wobble back, dead ends make the train back up to the last switch.
- 10 levels (`src/levels.ts`), hints after 10 seconds of no progress.
- Grown-ups: hold the little gear in the top-right corner for 1.5 s for level select and sound on/off.
- Installable as a full-screen app (PWA): open in Chrome on the tablet, then "Add to Home screen".
- Testing shortcut: `?level=5` opens level 5.

## Develop

```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

Built with Phaser 3, TypeScript and Vite. All art and sounds are generated in code; the engine speaks using the browser's speech synthesis.
