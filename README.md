# Choo-Choo Builder

A track-building train puzzle for a 3-year-old, made for an Android tablet (landscape).
Drag track pieces into the empty squares, flip switches by tapping them, then press the big green Go button.
The white steam engine waits at the end of the line. The numbered carriages (coal truck, passenger coach, tank wagon) all set off together and must reach the engine in order 1, 2, 3. When the train is complete it puffs off the edge of the screen and a little engine on the level map chugs on to the next box. Solved levels stay unlocked on the map. Everything is seen from above.

- No reading and no real fail states: if carriages bump into each other, arrive in the wrong order or get stuck, there's a soft bump and they all roll back to try again.
- 15 levels (`src/levels.ts`), from one straight piece up to three lines, dead ends and a detour, a pointing hand hint after 10 seconds of no progress.
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

## Sounds

All sounds are synthesised in code (`src/audio.ts`) with the Web Audio API, so there are no third-party audio files and nothing to credit. Each sound has a few variants and small random changes, so it doesn't repeat exactly: four steam whistles, two Go toots, a station bell, chuffs that alternate strong and soft and speed up, wheel clicks at rail joints, and four win tunes. If recorded CC0 sounds are added later, list each file with its source and licence here.

## Tests

`npm test` runs the level checks (`src/levels.test.ts`) against the same carriage logic the game uses (`src/sim.ts`), with no browser. For every level it checks that the level can be finished with the right pieces, that it can't be finished with the squares left empty, and that every real switch starts the wrong way so it has to be flipped. Switches where two lines only join are drawn as plain junctions with nothing to tap.

Pieces can be dropped on any open grass square, not only the planned ones, so children can try their own way; only forests and water send a piece back to the tray. A dropped piece turns itself only when exactly one way round joins up with the track next to it; otherwise the child taps it to turn it 90 degrees. Placed pieces can be dragged again to move them or back to the tray.
