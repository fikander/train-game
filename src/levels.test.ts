import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import { fitRotation, key, realSwitches, runLevel, solvedGrid } from './sim';
import { sides, traverse, type Piece } from './track';

describe.each(LEVELS.map((L, i) => [i + 1, L] as const))('level %i', (_n, L) => {
  const n = realSwitches(L).length;

  it('has one engine, numbered carriages 1..n and gaps on empty squares', () => {
    expect(L.pieces.filter(p => p.type === 'engine')).toHaveLength(1);
    const nums = L.pieces.filter(p => p.type === 'car').map(p => p.num).sort();
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    const taken = new Set(L.pieces.map(p => key(p.x, p.y)));
    for (const g of L.gaps) expect(taken.has(key(g.x, g.y)), `gap ${g.x},${g.y}`).toBe(false);
    for (const p of [...L.pieces, ...L.gaps]) expect(p.x >= 0 && p.x < L.cols && p.y >= 0 && p.y < L.rows, `${p.x},${p.y} on board`).toBe(true);
    expect(L.gaps.length + (L.spare?.length ?? 0)).toBeLessThanOrEqual(6); // fits the tray
  });

  it('every gap piece joins up with its neighbours', () => {
    const grid = solvedGrid(L);
    for (const g of L.gaps) {
      const p = grid.get(key(g.x, g.y))!;
      for (const s of sides(p)) {
        const q = grid.get(key(g.x + [0, 1, 0, -1][s], g.y + [-1, 0, 1, 0][s]));
        const back = ((s + 2) % 4) as 0;
        expect(q && (traverse(q, back) !== null || (q.type === 'engine' && back === (q.rot + 2) % 4)), `gap ${g.x},${g.y} side ${s}`).toBe(true);
      }
    }
  });

  it('can be finished', () => {
    const results = [];
    for (let c = 0; c < 1 << n; c++) results.push(runLevel(L, sw => sw.forEach((p, i) => { p.state = ((c >> i) & 1) as 0 | 1; })));
    expect(results).toContain('complete');
  });

  if (n > 0) it('does not work until a switch is flipped', () => {
    expect(runLevel(L)).not.toBe('complete');
  });

  it('does not finish with the squares left empty', () => {
    const empty = { ...L, gaps: [] };
    for (let c = 0; c < 1 << n; c++) expect(runLevel(empty, sw => sw.forEach((p, i) => { p.state = ((c >> i) & 1) as 0 | 1; }))).not.toBe('complete');
  });
});

describe('building your own way', () => {
  const car = { type: 'car' as const, x: 0, y: 0, rot: 1, num: 1, car: 'coal' as const, fixed: true };
  const engine = { type: 'engine' as const, x: 3, y: 2, rot: 1, fixed: true };
  const exit = { type: 'exit' as const, x: 4, y: 2, rot: 1, fixed: true };
  const base = { cols: 5, rows: 3, pieces: [car, engine, exit] };

  it('any track that reaches the engine works, not just the planned one', () => {
    const planned = { ...base, gaps: [{ x: 1, y: 0, type: 'straight' as const, rot: 0 }, { x: 2, y: 0, type: 'curve' as const, rot: 2 }, { x: 2, y: 1, type: 'straight' as const, rot: 1 }, { x: 2, y: 2, type: 'curve' as const, rot: 0 }] };
    const other = { ...base, gaps: [{ x: 1, y: 0, type: 'curve' as const, rot: 2 }, { x: 1, y: 1, type: 'straight' as const, rot: 1 }, { x: 1, y: 2, type: 'curve' as const, rot: 0 }, { x: 2, y: 2, type: 'straight' as const, rot: 0 }] };
    expect(runLevel(planned)).toBe('complete');
    expect(runLevel(other)).toBe('complete');
  });

  it('a dropped piece turns by itself only when just one way fits', () => {
    const grid = new Map<string, Piece>([[key(0, 0), car], [key(3, 2), engine]]);
    expect(fitRotation(grid, 1, 0, 'straight')).toBe(null); // only one end meets track: the child turns it
    grid.set(key(2, 0), { type: 'straight', x: 2, y: 0, rot: 0, fixed: false });
    expect(fitRotation(grid, 1, 0, 'straight')).toBe(0); // between the carriage and a straight: E-W
    grid.set(key(2, 1), { type: 'straight', x: 2, y: 1, rot: 1, fixed: false });
    expect(fitRotation(grid, 2, 2, 'curve')).toBe(0); // from the line above round to the engine
    expect(fitRotation(new Map(), 1, 1, 'curve')).toBe(null); // open field: tap to turn
  });
});
