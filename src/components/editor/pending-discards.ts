/**
 * Editors still leaving: each closed editor registers one promise at unmount
 * that settles once its flush and any discard are done. "Draw a new one"
 * waits on these first: it may reuse an empty draft, and must not be handed
 * the very one a just-closed editor is about to delete.
 */
const pending = new Set<Promise<unknown>>();

export function trackDiscard(discard: Promise<unknown>): void {
  pending.add(discard);
  const forget = () => pending.delete(discard);
  discard.then(forget, forget);
}

/** Resolves once every tracked discard has settled, whichever way. */
export async function discardsSettled(): Promise<void> {
  await Promise.allSettled([...pending]);
}
