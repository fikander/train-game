// The carriages' run, without any drawing: used by the game and by the tests.
import { DX, DY, Trail, cellPath, opp, traverse, type Dir, type Piece } from './track';
import type { Level } from './levels';

export const REF = 200; // texture resolution: pixels per grid cell
// Vehicles at REF scale (px). All face +x.
export const VEH = {
  engine: { w: 200, h: 110, lift: 0.16 },
  car: { w: 172, h: 104, lift: 0.15 },
};
export const SCALE = 0.9; // vehicle size relative to a cell
export const BACK = 2; // invisible track behind each carriage's start
export const ENG_L = VEH.engine.w / REF * SCALE + 0.02, CAR_L = VEH.car.w / REF * SCALE + 0.03;
export const SPEED = 1.7;

export const key = (x: number, y: number) => `${x},${y}`;

export interface SimMover {
  num: number;
  trail: Trail;
  d: number; // distance of the carriage's FRONT along its trail
  d0: number;
  len0: number;
  start: { x: number; y: number; dir: Dir };
  pending: { x: number; y: number; dir: Dir };
  state: 'idle' | 'move' | 'stop' | 'coupled' | 'rewind';
  speed: number;
}

export type SimEvent<M> = { type: 'couple'; m: M } | { type: 'bump'; a: M; b: M | null } | { type: 'stuck' } | null;

/** A carriage waiting on its start square. */
export function makeMover(p: Piece): SimMover {
  const d = p.rot as Dir, cx = p.x + 0.5, cy = p.y + 0.5;
  const trail = new Trail();
  trail.add([{ x: cx - DX[d] * BACK, y: cy - DY[d] * BACK }, { x: cx, y: cy }, { x: cx + DX[d] * 0.5, y: cy + DY[d] * 0.5 }]);
  const start = { x: p.x + DX[d], y: p.y + DY[d], dir: d };
  return { num: p.num ?? 1, trail, d: BACK + CAR_L / 2, d0: BACK + CAR_L / 2, len0: trail.length, start, pending: { ...start }, state: 'idle', speed: 0 };
}

export class TrainSim<M extends SimMover = SimMover> {
  engine: Piece;
  constructor(public grid: Map<string, Piece>, public movers: M[], public coupled: M[]) {
    this.engine = [...grid.values()].find(p => p.type === 'engine')!;
  }

  start() { for (const m of this.movers) { m.state = 'move'; m.speed = 0; } }

  frontOf(m: M) { return m.trail.at(m.d); }
  centreOf(m: M) { return m.trail.at(m.d - CAR_L / 2); }

  /** Where the next carriage has to couple: the back of the engine, or the back of the last coupled carriage. */
  tailPoint() {
    if (!this.coupled.length) {
      const e = this.engine, a = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][e.rot];
      return { x: e.x + 0.5 - Math.cos(a) * ENG_L / 2, y: e.y + 0.5 - Math.sin(a) * ENG_L / 2 };
    }
    const last = this.coupled[this.coupled.length - 1];
    return last.trail.at(last.d - CAR_L);
  }

  /** The carriage's front reached the end of its known track: look at the next square. */
  private advance(m: M) {
    const { x, y, dir } = m.pending;
    const p = this.grid.get(key(x, y));
    const entry = opp(dir);
    const out = p ? traverse(p, entry) : null;
    if (!p || out === null) { m.state = 'stop'; m.speed = 0; return; }
    m.trail.add(cellPath(x, y, entry, out));
    m.pending = { x: x + DX[out], y: y + DY[out], dir: out };
  }

  /** Move everyone on by dt seconds and report the first thing that happened. */
  step(dt: number): SimEvent<M> {
    for (const m of this.movers) {
      if (m.state !== 'move') continue;
      m.speed = Math.min(SPEED, m.speed + 2.5 * dt);
      m.d += m.speed * dt;
      let guard = 0;
      while (m.state === 'move' && m.d >= m.trail.length && guard++ < 4) {
        const over = m.d - m.trail.length;
        m.d = m.trail.length;
        this.advance(m);
        if (m.state === 'move') m.d += over;
      }
    }
    const ev = this.contacts();
    if (ev?.type === 'bump') for (const m of this.movers) if (m.state === 'move') { m.state = 'stop'; m.speed = 0; }
    if (ev?.type === 'couple') { ev.m.state = 'coupled'; ev.m.speed = 0; this.coupled.push(ev.m); }
    if (ev) return ev;
    if (!this.movers.some(m => m.state === 'move') && this.coupled.length < this.movers.length) return { type: 'stuck' };
    return null;
  }

  private contacts(): SimEvent<M> {
    const tail = this.tailPoint();
    const next = this.coupled.length + 1;
    for (const m of this.movers) {
      if (m.state !== 'move' && m.state !== 'stop') continue;
      const f = this.frontOf(m);
      if (Math.hypot(f.x - tail.x, f.y - tail.y) < 0.14) {
        // the right number couples on; the wrong one is a soft bump, then everyone rolls back
        return m.num === next ? { type: 'couple', m } : { type: 'bump', a: m, b: null };
      }
    }
    // carriages bumping into each other
    const lim = CAR_L * 0.82;
    for (let i = 0; i < this.movers.length; i++) for (let j = i + 1; j < this.movers.length; j++) {
      const a = this.movers[i], b = this.movers[j];
      if (a.state !== 'move' && b.state !== 'move') continue;
      const pa = this.centreOf(a), pb = this.centreOf(b);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < lim) return a.state === 'move' ? { type: 'bump', a, b } : { type: 'bump', a: b, b: a };
    }
    // carriages bumping into the engine from the wrong side
    const e = { x: this.engine.x + 0.5, y: this.engine.y + 0.5 };
    for (const m of this.movers) {
      if (m.state !== 'move') continue;
      const c = this.centreOf(m);
      if (Math.hypot(c.x - e.x, c.y - e.y) < (ENG_L + CAR_L) / 2 * 0.8) return { type: 'bump', a: m, b: null };
    }
    return null;
  }
}

/** The level's grid with the child's squares filled in correctly. */
export function solvedGrid(L: Level) {
  const grid = new Map<string, Piece>();
  for (const p of L.pieces) grid.set(key(p.x, p.y), { ...p });
  for (const g of L.gaps) grid.set(key(g.x, g.y), { type: g.type, x: g.x, y: g.y, rot: g.rot, fixed: false });
  return grid;
}

/**
 * Switches where two lines only join (carriages leave by the switch's single side) are plain junctions:
 * nothing to set, so they get no arrow and can't be tapped. Found by walking back from the engine over the solved track.
 */
export function junctionKeys(L: Level): Set<string> {
  const grid = solvedGrid(L);
  const eng = L.pieces.find(p => p.type === 'engine')!;
  const out = new Set<string>();
  const seen = new Set<string>();
  // `side` is the side of the square that faces the engine (the way carriages leave it)
  const todo: { x: number; y: number; side: Dir }[] = [{ x: eng.x - DX[eng.rot], y: eng.y - DY[eng.rot], side: eng.rot as Dir }];
  while (todo.length) {
    const { x, y, side } = todo.pop()!;
    const k = `${key(x, y)}:${side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const p = grid.get(key(x, y));
    if (!p) continue;
    let backs: Dir[];
    if (p.type === 'switch') {
      if (side === p.inDir) { out.add(key(x, y)); backs = [p.out1!, p.out2!]; } else backs = [p.inDir!];
    } else {
      const b = traverse(p, side);
      backs = b === null ? [] : [b];
    }
    for (const b of backs) todo.push({ x: x + DX[b], y: y + DY[b], side: opp(b) });
  }
  return out;
}

/** The real switches (not junctions) in a level, in a fixed order. */
export function realSwitches(L: Level) {
  const j = junctionKeys(L);
  return L.pieces.filter(p => p.type === 'switch' && !j.has(key(p.x, p.y)));
}

/** Play a level with the track built and the real switches set; returns how the run ended. */
export function runLevel(L: Level, setSwitches: (sw: Piece[]) => void = () => {}): 'complete' | 'bump' | 'stuck' | 'timeout' {
  const grid = solvedGrid(L);
  const j = junctionKeys(L);
  setSwitches([...grid.values()].filter(p => p.type === 'switch' && !j.has(key(p.x, p.y))));
  const movers = [...grid.values()].filter(p => p.type === 'car').map(makeMover);
  const sim = new TrainSim(grid, movers, []);
  sim.start();
  for (let t = 0; t < 60; t += 1 / 60) {
    const ev = sim.step(1 / 60);
    if (ev?.type === 'bump' || ev?.type === 'stuck') return ev.type;
    if (sim.coupled.length === movers.length) return 'complete';
  }
  return 'timeout';
}
