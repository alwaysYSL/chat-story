/** Registry editor yang sedang terbuka, supaya simpanan tertunda bisa dipaksa sebelum AI membaca naskah. */
const flushers = new Set<() => Promise<void> | void>();

export function registerFlush(fn: () => Promise<void> | void): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

export async function flushEditors(): Promise<void> {
  for (const f of flushers) await f();
}
