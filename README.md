# Choo-Choo Builder

A track-building train puzzle for a 3-year-old, made for an Android tablet (landscape).
Drag track pieces into the empty squares, flip switches by tapping them, then press the big green Go button.
The white steam engine waits at the end of the line. The numbered carriages (coal truck, passenger coach, tank wagon) all set off together and must reach the engine in order 1, 2, 3. When the train is complete it puffs off the edge of the screen and a little engine on the level map chugs on to the next box. Solved levels stay unlocked on the map. Everything is seen from above.

- No reading and no real fail states: if carriages bump into each other, arrive in the wrong order or get stuck, there's a soft bump and they all roll back to try again.
- 7 levels (`src/levels.ts`), a pointing hand hint after 10 seconds of no progress.
- Grown-ups: hold the little gear in the top-right corner for 1.5 s for level select and sound on/off.
- Installable as a full-screen app (PWA): open in Chrome on the tablet, then "Add to Home screen".
- Testing shortcut: `?level=5` opens level 5.

## Develop

```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

Built with Phaser 3, TypeScript and Vite. All art and sounds are generated in code (no voice).
