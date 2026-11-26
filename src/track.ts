// Grid + track geometry. Directions: 0 = N, 1 = E, 2 = S, 3 = W.
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const opp = (d: number): Dir => ((d + 2) % 4) as Dir;

export type CarKind = 'coal' | 'passenger' | 'tank';

export type PieceType = 'straight' | 'curve' | 'switch' | 'start' | 'car' | 'engine' | 'exit' | 'end';

export interface Piece {
  type: PieceType;
  x: number;
  y: number;
  /** straight: 0 = E-W, 1 = N-S. curve: connects rot and rot+1. start/exit: travel direction. end: open side. car: 0 E-W / 1 N-S */
  rot: number;
  fixed: boolean;
  // switch only
  inDir?: Dir;
  out1?: Dir;
  out2?: Dir;
  state?: 0 | 1;
  // car only: which carriage waits here (rot = the way it drives off)
  car?: CarKind;
  num?: number;
  buffer?: boolean; // draw a buffer stop behind it
  junction?: boolean; // switch where lines only join: nothing to set
}

/** Sides of a piece that connect to neighbours (used for auto-rotate and drawing). */
export function sides(p: Piece): Dir[] {
  switch (p.type) {
    case 'straight':
      return p.rot % 2 === 0 ? [1, 3] : [0, 2];
    case 'engine':
    case 'car':
      return [p.rot as Dir, opp(p.rot)];
    case 'curve':
      return [p.rot % 4, (p.rot + 1) % 4] as Dir[];
    case 'switch':
      return [p.inDir!, p.out1!, p.out2!];
    case 'start':
      return [p.rot as Dir];
    case 'exit':
      return [opp(p.rot)];
    case 'end':
      return [p.rot as Dir];
  }
}

/** Given a piece entered from side `entry`, which side does the train leave by? null = can't enter. */
export function traverse(p: Piece, entry: Dir): Dir | null {
  switch (p.type) {
    case 'car': // a carriage's starting square: plain straight track
      return entry === p.rot ? opp(p.rot) : entry === opp(p.rot) ? (p.rot as Dir) : null;
    case 'engine':
      return null;
    case 'straight':
    case 'curve': {
      const s = sides(p);
      if (s[0] === entry) return s[1];
      if (s[1] === entry) return s[0];
      return null;
    }
    case 'switch':
      if (entry === p.inDir) return p.state ? p.out2! : p.out1!;
      if (entry === p.out1 || entry === p.out2) return p.inDir!;
      return null;
    case 'exit':
      return entry === opp(p.rot) ? (p.rot as Dir) : null;
    case 'start':
      return entry === p.rot ? opp(p.rot) : null;
    case 'end':
      return null;
  }
}

export interface Pt { x: number; y: number }

/** Sample a path across one cell (cell units, cell centre at cx+0.5, cy+0.5) from side a to side b. */
export function cellPath(cx: number, cy: number, a: Dir, b: Dir, n = 12): Pt[] {
  const mx = cx + 0.5, my = cy + 0.5;
  const ax = mx + DX[a] * 0.5, ay = my + DY[a] * 0.5;
  const bx = mx + DX[b] * 0.5, by = my + DY[b] * 0.5;
  const pts: Pt[] = [];
  if (a === opp(b)) {
    for (let i = 0; i <= n; i++) pts.push({ x: ax + (bx - ax) * (i / n), y: ay + (by - ay) * (i / n) });
    return pts;
  }
  // quarter circle around corner shared by sides a and b
  const ox = mx + (DX[a] + DX[b]) * 0.5, oy = my + (DY[a] + DY[b]) * 0.5;
  const a0 = Math.atan2(ay - oy, ax - ox);
  let a1 = Math.atan2(by - oy, bx - ox);
  let diff = a1 - a0;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  a1 = a0 + diff;
  for (let i = 0; i <= n; i++) {
    const t = a0 + (a1 - a0) * (i / n);
    pts.push({ x: ox + Math.cos(t) * 0.5, y: oy + Math.sin(t) * 0.5 });
  }
  return pts;
}

/** A polyline with cumulative distances – the path the train has driven. */
export class Trail {
  pts: Pt[] = [];
  cum: number[] = [];

  get length() { return this.cum.length ? this.cum[this.cum.length - 1] : 0; }

  add(points: Pt[]) {
    for (const p of points) {
      if (!this.pts.length) { this.pts.push(p); this.cum.push(0); continue; }
      const last = this.pts[this.pts.length - 1];
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < 1e-6) continue;
      this.pts.push(p);
      this.cum.push(this.cum[this.cum.length - 1] + d);
    }
  }

  private seg(d: number): number {
    // index i such that cum[i] <= d <= cum[i+1]
    let lo = 0, hi = this.cum.length - 2;
    if (hi < 0) return 0;
    if (d <= 0) return 0;
    if (d >= this.length) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  at(d: number): { x: number; y: number; angle: number } {
    if (this.pts.length < 2) return { x: this.pts[0]?.x ?? 0, y: this.pts[0]?.y ?? 0, angle: 0 };
    const i = this.seg(d);
    const p0 = this.pts[i], p1 = this.pts[i + 1];
    const segLen = this.cum[i + 1] - this.cum[i];
    let t = (d - this.cum[i]) / segLen;
    t = Math.max(0, Math.min(1, t));
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
  }

  truncate(d: number) {
    if (d >= this.length) return;
    const p = this.at(d);
    const i = this.seg(d);
    this.pts.length = i + 1;
    this.cum.length = i + 1;
    this.add([{ x: p.x, y: p.y }]);
  }
}
