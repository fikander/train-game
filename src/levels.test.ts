import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import { key, realSwitches, runLevel, solvedGrid } from './sim';
import { sides, traverse } from './track';

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
