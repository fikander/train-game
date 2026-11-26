import type { CarKind, Dir, Piece } from './track';

export interface Gap { x: number; y: number; type: 'straight' | 'curve'; rot: number }

export interface Level {
  cols: number;
  rows: number;
  pieces: Piece[]; // fixed pieces
  gaps: Gap[]; // empty squares the child fills (the solution)
  spare?: ('straight' | 'curve')[];
}

const S = (x: number, y: number, rot: number): Piece => ({ type: 'straight', x, y, rot, fixed: true });
const C = (x: number, y: number, rot: number): Piece => ({ type: 'curve', x, y, rot, fixed: true });
const START = (x: number, y: number, dir: Dir): Piece => ({ type: 'start', x, y, rot: dir, fixed: true });
const EXIT = (x: number, y: number, dir: Dir): Piece => ({ type: 'exit', x, y, rot: dir, fixed: true });
const END = (x: number, y: number, open: Dir): Piece => ({ type: 'end', x, y, rot: open, fixed: true });
const CAR = (x: number, y: number, rot: number, car: CarKind): Piece => ({ type: 'car', x, y, rot, car, fixed: true });
const SW = (x: number, y: number, inDir: Dir, out1: Dir, out2: Dir, state: 0 | 1 = 0): Piece =>
  ({ type: 'switch', x, y, rot: 0, inDir, out1, out2, state, fixed: true });
const gS = (x: number, y: number, rot: number): Gap => ({ x, y, type: 'straight', rot });
const gC = (x: number, y: number, rot: number): Gap => ({ x, y, type: 'curve', rot });

// Directions: 0 N, 1 E, 2 S, 3 W. Curve rot r joins sides r and r+1 (0 N-E, 1 E-S, 2 S-W, 3 W-N).
export const LEVELS: Level[] = [
  // 1. Hello Train
  { cols: 4, rows: 3, pieces: [START(0, 1, 1), CAR(2, 1, 0, 'coal'), EXIT(3, 1, 1)], gaps: [gS(1, 1, 0)] },
  // 2. Longer Line
  { cols: 6, rows: 3, pieces: [START(0, 1, 1), CAR(4, 1, 0, 'passenger'), EXIT(5, 1, 1)], gaps: [gS(1, 1, 0), gS(2, 1, 0), gS(3, 1, 0)] },
  // 3. Around the Corner
  { cols: 4, rows: 3, pieces: [START(0, 2, 1), CAR(2, 1, 1, 'tank'), EXIT(2, 0, 0)], gaps: [gS(1, 2, 0), gC(2, 2, 3)] },
  // 4. Two Carriages
  {
    cols: 6, rows: 4,
    pieces: [START(0, 3, 1), CAR(2, 3, 0, 'coal'), CAR(4, 1, 0, 'passenger'), EXIT(5, 1, 1)],
    gaps: [gS(1, 3, 0), gC(3, 3, 3), gS(3, 2, 1), gC(3, 1, 1)],
  },
  // 5. Meet the Switch (no track to place – just flip the switch)
  {
    cols: 6, rows: 3,
    pieces: [START(0, 2, 1), S(1, 2, 0), SW(2, 2, 3, 1, 0), S(3, 2, 0), END(4, 2, 3),
      CAR(2, 1, 1, 'tank'), C(2, 0, 1), S(3, 0, 0), S(4, 0, 0), EXIT(5, 0, 1)],
    gaps: [],
  },
  // 6. Switch and Back
  {
    cols: 6, rows: 3,
    pieces: [START(0, 1, 1), S(1, 1, 0), SW(2, 1, 3, 1, 0), CAR(3, 1, 0, 'coal'), S(4, 1, 0), END(5, 1, 3),
      C(2, 0, 1), CAR(3, 0, 0, 'passenger'), S(4, 0, 0), EXIT(5, 0, 1)],
    gaps: [],
  },
  // 7. Build a Branch
  {
    cols: 6, rows: 4,
    pieces: [START(0, 1, 1), S(1, 1, 0), SW(2, 1, 3, 1, 2), S(3, 1, 0), S(4, 1, 0), END(5, 1, 3),
      CAR(3, 3, 0, 'tank'), EXIT(5, 3, 1)],
    gaps: [gS(2, 2, 1), gC(2, 3, 0), gS(4, 3, 0)],
  },
  // 8. Merging Lines
  {
    cols: 6, rows: 4,
    pieces: [START(0, 0, 1), CAR(2, 0, 0, 'coal'), SW(3, 1, 2, 0, 3), END(0, 1, 1), S(1, 1, 0), S(2, 1, 0),
      CAR(3, 2, 1, 'passenger'), EXIT(5, 3, 1)],
    gaps: [gS(1, 0, 0), gC(3, 0, 2), gC(3, 3, 0), gS(4, 3, 0)],
  },
  // 9. Little Loop
  {
    cols: 7, rows: 4,
    pieces: [START(0, 2, 1), CAR(1, 2, 0, 'coal'), SW(2, 2, 3, 1, 0), S(3, 2, 0), SW(4, 2, 1, 3, 0),
      CAR(3, 1, 0, 'passenger'), EXIT(6, 2, 1)],
    gaps: [gC(2, 1, 1), gC(4, 1, 2), gS(5, 2, 0)],
  },
  // 10. Big Train Day
  {
    cols: 7, rows: 5,
    pieces: [START(0, 0, 1), CAR(1, 0, 0, 'coal'), SW(3, 2, 0, 2, 1), CAR(3, 3, 1, 'tank'), END(3, 4, 0),
      CAR(4, 2, 0, 'passenger'), EXIT(6, 2, 1)],
    gaps: [gS(2, 0, 0), gC(3, 0, 2), gS(3, 1, 1), gS(5, 2, 0)],
    spare: ['curve'],
  },
];
