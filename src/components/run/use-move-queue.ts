"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Direction, RunnerDelta } from "~/maze";
import { api } from "~/trpc/react";

/**
 * One move waiting behind the one in flight. Key auto-repeat fires every
 * ~30ms, far faster than a ~150ms round trip; a deeper queue would keep the
 * runner walking for a second after the key was released (spec §7.3).
 */
const MAX_WAITING = 1;

type Handlers = {
  onDelta: (delta: RunnerDelta) => void;
  /** The match ended under us: the opponent gave up, or the deadline passed. */
  onMatchOver: (key: "errors.matchOver" | "errors.matchExpired") => void;
  /** Anything else went wrong. Trust the server: refetch and start again. */
  onResync: () => void;
};

/**
 * Sends moves one at a time, each with the next `seq` (spec §7.2), and never
 * draws a move before the server answers (§7.3). `nextSeq` comes from
 * `run.get`, so a resync — a second tab, a dropped connection — re-seeds the
 * counter from the server rather than from whatever this tab believed.
 */
export function useMoveQueue(
  matchId: string,
  nextSeq: number,
  handlers: Handlers,
) {
  const utils = api.useUtils();
  const move = api.run.move.useMutation();
  const queue = useRef<Direction[]>([]);
  const busy = useRef(false);
  const seq = useRef(nextSeq);
  // After an error the server is the authority, so the next `nextSeq` may
  // move the counter backwards; otherwise it only ever moves forward.
  const resyncing = useRef(false);
  const latest = useRef(handlers);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (busy.current) return;
    seq.current = resyncing.current ? nextSeq : Math.max(seq.current, nextSeq);
    resyncing.current = false;
  }, [nextSeq]);

  const pump = useCallback(async () => {
    if (busy.current) return;
    const dir = queue.current.shift();
    if (!dir) return;

    busy.current = true;
    setPending(true);
    try {
      // A background refetch that began before this move would land after it
      // and roll the cache (and `nextSeq`) back to the older snapshot.
      await utils.run.get.cancel({ matchId });
      const result = await move.mutateAsync({ matchId, seq: seq.current, dir });
      seq.current += 1;
      latest.current.onDelta(result.delta);
      if (result.delta.finished || result.matchOver) queue.current = [];
      if (result.matchOver) latest.current.onMatchOver("errors.matchOver");
    } catch (error) {
      queue.current = [];
      const message = (error as { message?: string }).message;
      if (message === "errors.matchOver" || message === "errors.matchExpired") {
        latest.current.onMatchOver(message);
      } else {
        resyncing.current = true;
        latest.current.onResync();
      }
    } finally {
      busy.current = false;
      setPending(false);
      void pump();
    }
  }, [matchId, move, utils]);

  const enqueue = useCallback(
    (dir: Direction) => {
      if (queue.current.length >= MAX_WAITING) return;
      queue.current.push(dir);
      void pump();
    },
    [pump],
  );

  return { enqueue, pending };
}
