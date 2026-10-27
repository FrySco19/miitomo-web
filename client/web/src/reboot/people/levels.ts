/**
 * REBOOT R6 — relationship levels shown to the user (Friends, My page). Read from the R5 Relations value (0..1) that
 * real things move: chats, visits, matches, comments, reactions (see miinstagram/relations.ts). Nothing else feeds it.
 *
 *   level 0 Friend        from 0.35 (every local friend starts here)
 *   level 1 Good friend   from 0.50
 *   level 2 Close friend  from 0.70
 *   level 3 Best friend   from 0.90
 */
export const LEVEL_FROM = [0.35, 0.5, 0.7, 0.9] as const;

export interface Level { level: 0 | 1 | 2 | 3; /** 0..1 of the way to the next level (1 at the top level). */ progress: number; next: 1 | 2 | 3 | null; }

export function relationLevel(v: number): Level {
  const x = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : LEVEL_FROM[0];
  let level = 0 as Level['level'];
  for (let i = LEVEL_FROM.length - 1; i > 0; i--) if (x >= LEVEL_FROM[i] - 1e-9) { level = i as Level['level']; break; }
  if (level === 3) return { level, progress: 1, next: null };
  const lo = LEVEL_FROM[level], hi = LEVEL_FROM[level + 1];
  return { level, progress: Math.max(0, Math.min(1, (x - lo) / (hi - lo))), next: (level + 1) as 1 | 2 | 3 };
}
