/**
 * Keeps one answer in memory for `ttlMs`, and shares a load already under way so
 * that several screens opening at once cost one load. A failed load isn't kept.
 * ponytail: one copy per server process, a shared store only if it ever runs on many.
 */
export function ttlCache<T>(ttlMs: number, load: () => Promise<T>, now: () => number = Date.now) {
  let kept: { value: T; until: number } | null = null;
  let loading: Promise<T> | null = null;
  return (): Promise<T> => {
    if (kept && now() < kept.until) return Promise.resolve(kept.value);
    loading ??= load()
      .then((value) => {
        kept = { value, until: now() + ttlMs };
        return value;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
}
