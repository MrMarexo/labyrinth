/**
 * Editors still leaving: each closed editor registers one promise at unmount
 * that settles once its flush and any discard are done. "Draw a new one"
 * waits on these first: it may reuse an empty concept, and must not be
 * handed the very one a just-closed editor is about to delete.
 */
const pending = new Set<Promise<unknown>>();

export function trackDiscard(discard: Promise<unknown>): void {
  pending.add(discard);
  const forget = () => pending.delete(discard);
  discard.then(forget, forget);
}

/**
 * How long to wait for leaves before going ahead anyway. A leave includes
 * the editor's flush, and a hung save must not stall the caller forever.
 * Going ahead early is safe for "Draw a new one": `conceptForMatch` reuses
 * or silently replaces the concept only while it is empty on the server, so
 * at worst it hands back one that is then discarded, and a concept with
 * squares is only ever replaced after the player agrees.
 */
export const DISCARD_WAIT_CAP_MS = 4000;

/**
 * Resolves once every tracked leave has settled, whichever way, or after
 * `DISCARD_WAIT_CAP_MS`, whichever comes first.
 */
export async function discardsSettled(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, DISCARD_WAIT_CAP_MS);
  });
  try {
    await Promise.race([Promise.allSettled([...pending]), cap]);
  } finally {
    clearTimeout(timer);
  }
}
