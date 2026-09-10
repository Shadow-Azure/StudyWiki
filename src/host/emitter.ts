/** Payload map constraint for {@link createEmitter}. */
export type PayloadMap = Record<string, unknown>;

/** Minimal typed emitter: on returns an unsubscriber. */
export interface Emitter<M extends PayloadMap> {
  on<K extends keyof M & string>(key: K, fn: (payload: M[K]) => void): () => void;
  emit<K extends keyof M & string>(key: K, payload: M[K]): void;
}

/** Framework-free emitter used by host services to expose change streams.
 * @returns An emitter with `on`/`emit`; `on` returns an unsubscriber. */
export function createEmitter<M extends PayloadMap>(): Emitter<M> {
  const map = new Map<string, Set<(p: unknown) => void>>();
  return {
    on(key, fn) {
      const set = map.get(key) ?? new Set();
      set.add(fn as (p: unknown) => void);
      map.set(key, set);
      return () => set.delete(fn as (p: unknown) => void);
    },
    emit(key, payload) {
      for (const fn of map.get(key) ?? []) fn(payload);
    },
  };
}
