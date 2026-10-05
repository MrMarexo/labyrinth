import { INCOMPLETE_DRAFT_KEY } from "~/maze";

/** Keys emitted outside the unions — by the router, not the domain. */
export const ROUTER_KEYS = [
  INCOMPLETE_DRAFT_KEY,
  "maze.format.cellCountNotAPreset",
] as const;
