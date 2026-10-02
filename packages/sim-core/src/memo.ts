/**
 * A short-lived cache for read-only work.
 *
 * Some answers depend only on the league as it stands (how every team ranks as
 * a contender, where each team's pick is likely to land) but are asked for
 * hundreds of times while building one page or weighing one trade. Inside
 * `withMemo`, those are worked out once. Outside it, nothing is cached, so the
 * simulation (which changes the league as it goes) is never handed a stale
 * answer.
 *
 * The work inside `withMemo` must not change the league, and must be
 * synchronous.
 */
let scope: Map<string, unknown> | null = null;

export function withMemo<T>(fn: () => T): T {
  if (scope) return fn();
  scope = new Map();
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error('withMemo is for synchronous work');
    return out;
  } finally {
    scope = null;
  }
}

export function memo<T>(key: string, compute: () => T): T {
  if (!scope) return compute();
  if (scope.has(key)) return scope.get(key) as T;
  const v = compute();
  scope.set(key, v);
  return v;
}
