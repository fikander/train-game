// Which levels Alek has solved, remembered on this device.
import { LEVELS } from './levels';

const KEY = 'choo.solved';

export function solvedLevels(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return new Set((JSON.parse(raw) as number[]).filter(n => n >= 0 && n < LEVELS.length));
    // older versions only remembered the level reached: everything before it was solved
    const reached = parseInt(localStorage.getItem('choo.level') ?? '0', 10) || 0;
    return new Set(Array.from({ length: Math.min(reached, LEVELS.length) }, (_, i) => i));
  } catch { return new Set(); }
}

export function markSolved(i: number) {
  const s = solvedLevels();
  s.add(i);
  try { localStorage.setItem(KEY, JSON.stringify([...s].sort((a, b) => a - b))); } catch { /* ignore */ }
}

/** A level can be played once it is solved or the one before it is. */
export function isUnlocked(i: number, solved = solvedLevels()) {
  return i === 0 || solved.has(i) || solved.has(i - 1);
}

/** The level to play next: the first one not solved yet. */
export function nextLevel(solved = solvedLevels()) {
  for (let i = 0; i < LEVELS.length; i++) if (!solved.has(i)) return i;
  return LEVELS.length - 1;
}

/** Grown-up setting: faint shadows of the right track on each square. */
export function hintsOn() { try { return localStorage.getItem('choo.hints') === '1'; } catch { return false; } }
export function setHints(on: boolean) { try { localStorage.setItem('choo.hints', on ? '1' : '0'); } catch { /* ignore */ } }
