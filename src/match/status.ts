/** Spec §9. */
export const MATCH_STATUSES = [
  "awaiting_opponent",
  "drawing",
  "running",
  "complete",
  "abandoned",
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * Spec §6. `winnerId` is null for everything except `finished` and `forfeit`,
 * which is how "you cannot win without finding the treasure" is enforced at
 * the schema level rather than by convention.
 */
export const END_REASONS = ["finished", "forfeit", "abandoned"] as const;

export type EndReason = (typeof END_REASONS)[number];

const LEGAL: Record<MatchStatus, readonly MatchStatus[]> = {
  awaiting_opponent: ["drawing", "abandoned"],
  drawing: ["running", "abandoned"],
  running: ["complete", "abandoned"],
  complete: [],
  abandoned: [],
};

/** Spec §9's diagram, as a function. Terminal states go nowhere. */
export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return LEGAL[from].includes(to);
}

export function isTerminal(status: MatchStatus): boolean {
  return LEGAL[status].length === 0;
}

/** The non-terminal statuses, derived rather than hardcoded a second time. */
export const OPEN_STATUSES = MATCH_STATUSES.filter(
  (status) => !isTerminal(status),
);
