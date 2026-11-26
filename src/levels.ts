import type { CarKind, Dir, Piece } from './track';

export interface Gap { x: number; y: number; type: 'straight' | 'curve'; rot: number }

export interface Level {
  cols: number;
  rows: number;
  pieces: Piece[]; // fixed pieces
  gaps: Gap[]; // empty squares the child fills (the solution)
  spare?: ('straight' | 'curve')[];
}

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
const gS = (x: number, y: number, rot: number): Gap => ({ x, y, type: 'straight', rot });
const gC = (x: number, y: number, rot: number): Gap => ({ x, y, type: 'curve', rot });

// Directions: 0 N, 1 E, 2 S, 3 W. Curve rot r joins sides r and r+1 (0 N-E, 1 E-S, 2 S-W, 3 W-N).
// The engine waits near the end; carriages drive to it and must arrive in order 1, 2, 3.
// Behind the engine there must be enough straight track for the whole train (about 0.8 squares per carriage).
export const LEVELS: Level[] = [
  // 1. One carriage, one gap
  { cols: 5, rows: 3, pieces: [CAR(0, 1, 1, 1), S(2, 1, 0), ENGINE(3, 1, 1), EXIT(4, 1, 1)], gaps: [gS(1, 1, 0)] },
  // 2. Around the corner
  {
    cols: 5, rows: 3,
    pieces: [CAR(0, 0, 1, 1), S(2, 1, 1), ENGINE(3, 2, 1), EXIT(4, 2, 1)],
    gaps: [gS(1, 0, 0), gC(2, 0, 2), gC(2, 2, 0)],
  },
  // 3. Two in a row: 1 is in front, 2 follows
  {
    cols: 7, rows: 3,
    pieces: [CAR(0, 1, 1, 2), CAR(1, 1, 1, 1), S(4, 1, 0), ENGINE(5, 1, 1), EXIT(6, 1, 1)],
    gaps: [gS(2, 1, 0), gS(3, 1, 0)],
  },
  // 4. Flip the switch: the straight way is a dead end
  {
    cols: 7, rows: 3,
    pieces: [CAR(0, 2, 1, 1), S(1, 2, 0), SW(2, 2, 3, 1, 0), S(3, 2, 0), END(4, 2, 3),
      C(2, 1, 1), ENGINE(5, 1, 1), EXIT(6, 1, 1)],
    gaps: [gS(3, 1, 0), gS(4, 1, 0)],
  },
  // 5. Two lines join: 1 is closer, so it gets there first
  {
    cols: 8, rows: 4,
    pieces: [CAR(1, 2, 1, 1), SW(3, 2, 1, 3, 0), CAR(1, 0, 1, 2), S(3, 1, 1), S(5, 2, 0), ENGINE(6, 2, 1), EXIT(7, 2, 1)],
    gaps: [gS(2, 2, 0), gS(2, 0, 0), gC(3, 0, 2), gS(4, 2, 0)],
  },
  // 6. Three in a row
  {
    cols: 8, rows: 3,
    pieces: [CAR(0, 1, 1, 3), CAR(1, 1, 1, 2), CAR(2, 1, 1, 1), S(4, 1, 0), ENGINE(6, 1, 1), EXIT(7, 1, 1)],
    gaps: [gS(3, 1, 0), gS(5, 1, 0)],
  },
  // 7. Slow down number 2: send it round the bend with the switch so 1 arrives first
  {
    cols: 10, rows: 5,
    pieces: [CAR(0, 2, 1, 1), S(1, 2, 0), SW(5, 2, 1, 3, 2), S(6, 2, 0), S(7, 2, 0), ENGINE(8, 2, 1), EXIT(9, 2, 1),
      CAR(1, 4, 1, 2), S(2, 4, 0), SW(3, 4, 3, 1, 0), SW(4, 4, 1, 3, 0), C(5, 4, 3), S(5, 3, 1),
      C(3, 3, 1), C(4, 3, 2)],
    gaps: [gS(2, 2, 0), gS(3, 2, 0), gS(4, 2, 0)],
  },
];
