/**
 * Discards the editor fired on its way out that have not settled yet. "Draw
 * a new one" waits on these first: it may reuse an empty draft, and must not
 * be handed the very one a just-closed editor is deleting.
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
