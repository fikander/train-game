import type { CarKind, Dir, Piece } from './track';

export interface Gap { x: number; y: number; type: 'straight' | 'curve'; rot: number }

export interface Level {
  cols: number;
  rows: number;
  pieces: Piece[]; // fixed pieces
  gaps: Gap[]; // empty squares the child fills (the solution)
  spare?: ('straight' | 'curve')[];
  note?: string; // what the level teaches (for grown-ups reading the code)
}

export type Biome = 'meadow' | 'desert' | 'snow';
export const BIOMES: Biome[] = ['meadow', 'desert', 'snow'];
export const PER_BIOME = 10;
export const biomeOf = (i: number): Biome => BIOMES[Math.min(BIOMES.length - 1, Math.floor(i / PER_BIOME))];

const KINDS: CarKind[] = ['coal', 'passenger', 'tank'];
const S = (x: number, y: number, rot: number): Piece => ({ type: 'straight', x, y, rot, fixed: true });
const C = (x: number, y: number, rot: number): Piece => ({ type: 'curve', x, y, rot, fixed: true });
const ENGINE = (x: number, y: number, dir: Dir): Piece => ({ type: 'engine', x, y, rot: dir, fixed: true });
const EXIT = (x: number, y: number, dir: Dir): Piece => ({ type: 'exit', x, y, rot: dir, fixed: true });
const END = (x: number, y: number, open: Dir): Piece => ({ type: 'end', x, y, rot: open, fixed: true });
/** carriage number n waiting at (x,y), will drive off towards `dir` */
const CAR = (x: number, y: number, dir: Dir, n: number): Piece => ({ type: 'car', x, y, rot: dir, num: n, car: KINDS[(n - 1) % 3], fixed: true });
const SW = (x: number, y: number, inDir: Dir, out1: Dir, out2: Dir, state: 0 | 1 = 0): Piece =>
  ({ type: 'switch', x, y, rot: 0, inDir, out1, out2, state, fixed: true });
/** a tunnel mouth whose track opens towards `open`; carriages going in come out of the other mouth with the same `pair` */
const TU = (x: number, y: number, open: Dir, pair: number): Piece => ({ type: 'portal', x, y, rot: open, pair, fixed: true });
const gS = (x: number, y: number, rot: number): Gap => ({ x, y, type: 'straight', rot });
const gC = (x: number, y: number, rot: number): Gap => ({ x, y, type: 'curve', rot });

// Directions: 0 N, 1 E, 2 S, 3 W. Curve rot r joins sides r and r+1 (0 N-E, 1 E-S, 2 S-W, 3 W-N).
// The engine waits near the end; carriages drive to it and must arrive in order 1, 2, 3.
// Behind the engine there must be enough straight track for the whole train (about 0.8 squares per carriage).
// Directions: 0 N, 1 E, 2 S, 3 W. Curve rot r joins sides r and r+1 (0 N-E, 1 E-S, 2 S-W, 3 W-N).
// The engine waits near the end; carriages drive to it and must arrive in order 1, 2, 3.
// Behind the engine there must be enough straight track for the whole train (about 0.8 squares per carriage).
// Ten levels per biome. Meadow: straights, bends, more carriages, lines joining. Desert: switches. Snow: tunnels (in one mouth, out of its partner elsewhere; each pair has its own colour) and everything together.
export const LEVELS: Level[] = [
  // ---------- meadow ----------
  { note: 'one straight', cols: 5, rows: 3, pieces: [CAR(0, 1, 1, 1), S(2, 1, 0), ENGINE(3, 1, 1), EXIT(4, 1, 1)], gaps: [gS(1, 1, 0)] },
  { note: 'two straights', cols: 6, rows: 3, pieces: [CAR(0, 1, 1, 1), S(3, 1, 0), ENGINE(4, 1, 1), EXIT(5, 1, 1)], gaps: [gS(1, 1, 0), gS(2, 1, 0)] },
  {
    note: 'first bends', cols: 5, rows: 3,
    pieces: [CAR(0, 0, 1, 1), S(2, 1, 1), ENGINE(3, 2, 1), EXIT(4, 2, 1)],
    gaps: [gS(1, 0, 0), gC(2, 0, 2), gC(2, 2, 0)],
  },
  {
    note: 'bends the other way', cols: 5, rows: 3,
    pieces: [CAR(0, 2, 1, 1), S(1, 2, 0), S(2, 1, 1), ENGINE(3, 0, 1), EXIT(4, 0, 1)],
    gaps: [gC(2, 2, 3), gC(2, 0, 1)],
  },
  {
    note: 'a wiggly line', cols: 8, rows: 4,
    pieces: [CAR(0, 0, 1, 1), S(1, 0, 0), S(3, 2, 0), C(4, 3, 0), S(5, 3, 0), ENGINE(6, 3, 1), EXIT(7, 3, 1)],
    gaps: [gC(2, 0, 2), gS(2, 1, 1), gC(2, 2, 0), gC(4, 2, 2)],
  },
  {
    note: 'two carriages: 1 in front', cols: 7, rows: 3,
    pieces: [CAR(0, 1, 1, 2), CAR(1, 1, 1, 1), S(4, 1, 0), ENGINE(5, 1, 1), EXIT(6, 1, 1)],
    gaps: [gS(2, 1, 0), gS(3, 1, 0)],
  },
  {
    note: 'two carriages round a corner', cols: 8, rows: 3,
    pieces: [CAR(0, 0, 1, 2), CAR(1, 0, 1, 1), S(3, 1, 1), S(4, 2, 0), S(5, 2, 0), ENGINE(6, 2, 1), EXIT(7, 2, 1)],
    gaps: [gS(2, 0, 0), gC(3, 0, 2), gC(3, 2, 0)],
  },
  {
    note: 'three carriages', cols: 8, rows: 3,
    pieces: [CAR(0, 1, 1, 3), CAR(1, 1, 1, 2), CAR(2, 1, 1, 1), S(4, 1, 0), ENGINE(6, 1, 1), EXIT(7, 1, 1)],
    gaps: [gS(3, 1, 0), gS(5, 1, 0)],
  },
  {
    note: 'two lines join: the nearer one is 1', cols: 8, rows: 4,
    pieces: [CAR(1, 2, 1, 1), SW(3, 2, 1, 3, 0), CAR(1, 0, 1, 2), S(3, 1, 1), S(5, 2, 0), ENGINE(6, 2, 1), EXIT(7, 2, 1)],
    gaps: [gS(2, 2, 0), gS(2, 0, 0), gC(3, 0, 2), gS(4, 2, 0)],
  },
  {
    note: 'three carriages, two lines', cols: 9, rows: 3,
    pieces: [CAR(1, 2, 1, 2), CAR(2, 2, 1, 1), SW(3, 2, 1, 3, 0), S(6, 2, 0), ENGINE(7, 2, 1), EXIT(8, 2, 1),
      CAR(0, 0, 1, 3), S(1, 0, 0), S(3, 1, 1)],
    gaps: [gS(4, 2, 0), gS(5, 2, 0), gS(2, 0, 0), gC(3, 0, 2)],
  },
  // ---------- desert ----------
  {
    note: 'first switch: straight on is a dead end', cols: 7, rows: 3,
    pieces: [CAR(0, 2, 1, 1), S(1, 2, 0), SW(2, 2, 3, 1, 0), S(3, 2, 0), END(4, 2, 3), C(2, 1, 1), ENGINE(5, 1, 1), EXIT(6, 1, 1)],
    gaps: [gS(3, 1, 0), gS(4, 1, 0)],
  },
  {
    note: 'switch the other way: down and round', cols: 7, rows: 3,
    pieces: [CAR(0, 0, 1, 1), S(1, 0, 0), SW(2, 0, 3, 1, 2), S(3, 0, 0), END(4, 0, 3), ENGINE(5, 1, 1), EXIT(6, 1, 1)],
    gaps: [gC(2, 1, 0), gS(3, 1, 0), gS(4, 1, 0)],
  },
  {
    note: 'two switches, two dead ends', cols: 8, rows: 4,
    pieces: [CAR(0, 1, 1, 1), S(1, 1, 0), SW(2, 1, 3, 1, 2), END(3, 1, 3),
      C(2, 3, 0), S(3, 3, 0), SW(4, 3, 3, 1, 0), S(5, 3, 0), END(6, 3, 3),
      S(4, 2, 1), C(4, 1, 1), ENGINE(6, 1, 1), EXIT(7, 1, 1)],
    gaps: [gS(2, 2, 1), gS(5, 1, 0)],
  },
  {
    note: 'two carriages and a switch', cols: 9, rows: 4,
    pieces: [CAR(0, 3, 1, 2), CAR(1, 3, 1, 1), S(2, 3, 0), SW(3, 3, 3, 1, 0), S(4, 3, 0), END(5, 3, 3),
      C(3, 1, 1), S(5, 1, 0), ENGINE(7, 1, 1), EXIT(8, 1, 1)],
    gaps: [gS(3, 2, 1), gS(4, 1, 0), gS(6, 1, 0)],
  },
  {
    note: 'number 1 waits on the side line', cols: 10, rows: 3,
    pieces: [CAR(0, 2, 1, 3), CAR(1, 2, 1, 2), S(2, 2, 0), SW(4, 2, 1, 3, 0), S(5, 2, 0), S(7, 2, 0), ENGINE(8, 2, 1), EXIT(9, 2, 1),
      CAR(4, 0, 2, 1)],
    gaps: [gS(3, 2, 0), gS(4, 1, 1), gS(6, 2, 0)],
  },
  {
    note: 'a switch, then the lines join', cols: 10, rows: 4,
    pieces: [CAR(0, 1, 1, 1), S(1, 1, 0), SW(2, 1, 3, 0, 1), END(2, 0, 2), S(3, 1, 0), SW(5, 1, 1, 3, 2), S(7, 1, 0), ENGINE(8, 1, 1), EXIT(9, 1, 1),
      CAR(0, 3, 1, 2), S(1, 3, 0), S(2, 3, 0), S(3, 3, 0), C(5, 3, 3), S(5, 2, 1)],
    gaps: [gS(4, 1, 0), gS(6, 1, 0), gS(4, 3, 0)],
  },
  {
    note: 'three lines join', cols: 12, rows: 5,
    pieces: [CAR(2, 2, 1, 1), S(3, 2, 0), SW(4, 2, 1, 3, 0), SW(6, 2, 1, 3, 2), S(7, 2, 0), S(9, 2, 0), ENGINE(10, 2, 1), EXIT(11, 2, 1),
      CAR(2, 0, 1, 2), S(3, 0, 0), S(4, 1, 1),
      CAR(0, 4, 1, 3), S(1, 4, 0), S(2, 4, 0), S(4, 4, 0), S(5, 4, 0), S(6, 3, 1)],
    gaps: [gS(5, 2, 0), gS(8, 2, 0), gC(4, 0, 2), gS(3, 4, 0), gC(6, 4, 3)],
  },
  {
    note: 'slow number 2 down: send it round the hump', cols: 10, rows: 5,
    pieces: [CAR(0, 2, 1, 1), S(1, 2, 0), SW(5, 2, 1, 3, 2), S(6, 2, 0), S(7, 2, 0), ENGINE(8, 2, 1), EXIT(9, 2, 1),
      CAR(1, 4, 1, 2), S(2, 4, 0), SW(3, 4, 3, 1, 0), SW(4, 4, 1, 3, 0), C(5, 4, 3), S(5, 3, 1),
      C(3, 3, 1), C(4, 3, 2)],
    gaps: [gS(2, 2, 0), gS(3, 2, 0), gS(4, 2, 0)],
  },
  {
    note: 'build the hump yourself', cols: 10, rows: 5,
    pieces: [CAR(0, 2, 1, 1), S(1, 2, 0), S(2, 2, 0), S(3, 2, 0), SW(5, 2, 1, 3, 0), S(6, 2, 0), S(7, 2, 0), ENGINE(8, 2, 1), EXIT(9, 2, 1),
      CAR(1, 0, 1, 2), SW(3, 0, 3, 1, 2), SW(4, 0, 1, 3, 2), C(5, 0, 2), S(5, 1, 1)],
    gaps: [gS(4, 2, 0), gS(2, 0, 0), gC(3, 1, 0), gC(4, 1, 3)],
  },
  {
    note: 'desert finale: three lines and a dead end', cols: 12, rows: 5,
    pieces: [CAR(2, 2, 1, 1), S(3, 2, 0), SW(4, 2, 1, 3, 0), S(5, 2, 0), SW(6, 2, 1, 3, 2), S(8, 2, 0), S(9, 2, 0), ENGINE(10, 2, 1), EXIT(11, 2, 1),
      CAR(2, 0, 1, 2), S(4, 1, 1),
      CAR(0, 4, 1, 3), SW(1, 4, 3, 0, 1), END(1, 3, 2), S(2, 4, 0), S(3, 4, 0), S(5, 4, 0), C(6, 4, 3)],
    gaps: [gS(3, 0, 0), gC(4, 0, 2), gS(7, 2, 0), gS(4, 4, 0), gS(6, 3, 1)],
  },
  // ---------- snow ----------
  {
    note: 'first tunnel: in at the top, out at the bottom', cols: 5, rows: 3,
    pieces: [CAR(0, 0, 1, 1), TU(2, 0, 3, 0), TU(0, 2, 1, 0), S(2, 2, 0), ENGINE(3, 2, 1), EXIT(4, 2, 1)],
    gaps: [gS(1, 0, 0), gS(1, 2, 0)],
  },
  {
    note: 'out of the tunnel and round a bend', cols: 7, rows: 4,
    pieces: [CAR(0, 1, 1, 1), TU(2, 1, 3, 0), TU(3, 0, 2, 0), S(4, 2, 0), ENGINE(5, 2, 1), EXIT(6, 2, 1)],
    gaps: [gS(1, 1, 0), gS(3, 1, 1), gC(3, 2, 0)],
  },
  {
    note: 'two carriages through the tunnel', cols: 6, rows: 3,
    pieces: [CAR(0, 0, 1, 2), CAR(1, 0, 1, 1), TU(3, 0, 3, 0), TU(0, 2, 1, 0), S(3, 2, 0), ENGINE(4, 2, 1), EXIT(5, 2, 1)],
    gaps: [gS(2, 0, 0), gS(1, 2, 0), gS(2, 2, 0)],
  },
  {
    note: 'two different tunnels, one after the other', cols: 7, rows: 4,
    pieces: [CAR(0, 0, 1, 1), TU(2, 0, 3, 0), TU(0, 2, 1, 0), TU(2, 2, 3, 1), TU(3, 3, 1, 1), ENGINE(5, 3, 1), EXIT(6, 3, 1)],
    gaps: [gS(1, 0, 0), gS(1, 2, 0), gS(4, 3, 0)],
  },
  {
    note: 'a switch sends the carriage into the tunnel', cols: 5, rows: 4,
    pieces: [CAR(0, 0, 1, 1), S(1, 0, 0), SW(2, 0, 3, 1, 2), S(3, 0, 0), END(4, 0, 3), TU(2, 2, 0, 0), TU(0, 3, 1, 0), S(2, 3, 0), ENGINE(3, 3, 1), EXIT(4, 3, 1)],
    gaps: [gS(2, 1, 1), gS(1, 3, 0)],
  },
  {
    note: 'out of the tunnel to join the line', cols: 7, rows: 4,
    pieces: [CAR(1, 3, 1, 1), SW(3, 3, 1, 3, 0), S(4, 3, 0), ENGINE(5, 3, 1), EXIT(6, 3, 1),
      CAR(0, 0, 1, 2), TU(2, 0, 3, 0), TU(3, 1, 2, 0)],
    gaps: [gS(2, 3, 0), gS(1, 0, 0), gS(3, 2, 1)],
  },
  {
    note: 'pick the right tunnel', cols: 8, rows: 4,
    pieces: [CAR(0, 1, 1, 1), SW(2, 1, 3, 0, 2), TU(2, 0, 2, 0), TU(4, 0, 1, 0), S(5, 0, 0), END(6, 0, 3),
      TU(2, 2, 0, 1), TU(3, 3, 1, 1), S(5, 3, 0), ENGINE(6, 3, 1), EXIT(7, 3, 1)],
    gaps: [gS(1, 1, 0), gS(4, 3, 0)],
  },
  {
    note: 'number 3 goes the long way under the hill', cols: 10, rows: 5,
    pieces: [CAR(1, 2, 1, 2), CAR(2, 2, 1, 1), SW(4, 2, 1, 3, 0), S(5, 2, 0), S(7, 2, 0), ENGINE(8, 2, 1), EXIT(9, 2, 1),
      CAR(0, 4, 1, 3), SW(1, 4, 3, 0, 1), END(1, 3, 2), TU(3, 4, 3, 0), TU(4, 0, 2, 0)],
    gaps: [gS(3, 2, 0), gS(6, 2, 0), gS(2, 4, 0), gS(4, 1, 1)],
  },
  {
    note: 'two tunnels, two carriages, one line', cols: 9, rows: 4,
    pieces: [CAR(0, 0, 1, 1), TU(2, 0, 3, 0), CAR(0, 3, 1, 2), TU(3, 3, 3, 1),
      TU(3, 1, 1, 0), SW(5, 1, 1, 3, 2), S(6, 1, 0), ENGINE(7, 1, 1), EXIT(8, 1, 1), TU(5, 3, 0, 1)],
    gaps: [gS(1, 0, 0), gS(4, 1, 0), gS(1, 3, 0), gS(2, 3, 0), gS(5, 2, 1)],
  },
  {
    note: 'the grand finale: a switch and two tunnels for number 3', cols: 11, rows: 5,
    pieces: [CAR(2, 2, 1, 2), CAR(3, 2, 1, 1), SW(5, 2, 1, 3, 0), S(6, 2, 0), S(8, 2, 0), ENGINE(9, 2, 1), EXIT(10, 2, 1),
      CAR(0, 4, 1, 3), SW(1, 4, 3, 0, 1), END(1, 3, 2), TU(3, 4, 3, 0), TU(0, 0, 1, 0), TU(2, 0, 3, 1), TU(4, 0, 1, 1), S(5, 1, 1)],
    gaps: [gS(4, 2, 0), gS(7, 2, 0), gS(2, 4, 0), gS(1, 0, 0), gC(5, 0, 2)],
  },
];
