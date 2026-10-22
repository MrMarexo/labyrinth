"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  predictMove,
  sameDelta,
  type Direction,
  type PredictableView,
  type RunnerDelta,
} from "~/maze";
import { api } from "~/trpc/react";

/**
 * One move waiting behind an unknown edge's answer. Key auto-repeat fires
 * every ~30ms, far faster than a round trip; a deeper queue would keep the
 * runner walking for a second after the key was released (spec §7.3).
 */
const MAX_WAITING = 1;

/**
 * How far known-passage moves may run ahead of the server. Each is certain,
 * but each is still a request, and a held key in a long known corridor
 * should not pile up more than a few.
 */
const MAX_AHEAD = 8;

/**
 * - `predicted`: a step through a known passage, drawn before it is sent.
 * - `answered`: the server's answer to a move the map could not predict.
 * - `confirmed`: the server agreeing with an earlier prediction. Already
 *   drawn; applying it again is a no-op unless a refetch rolled it back.
 */
export type DeltaKind = "predicted" | "answered" | "confirmed";

type Handlers = {
  onDelta: (delta: RunnerDelta, kind: DeltaKind, matchOver: boolean) => void;
  /** The match ended under us: the opponent gave up, or the deadline passed. */
  onMatchOver: (key: "errors.matchOver" | "errors.matchExpired") => void;
  /** Anything else went wrong, or a prediction was wrong. Trust the server. */
  onResync: () => void;
};

type Outgoing = { seq: number; dir: Direction; predicted: RunnerDelta | null };

/**
 * Sends moves one at a time, each with its own `seq` (spec §7.2).
 *
 * A move through a known passage is certain (`predictMove`), so it is drawn
 * at once and sent behind; the server's answer only has to agree. Any other
 * move is drawn only once the server answers (§7.3) — the runner leans
 * toward it meanwhile (`lean`), which is cosmetic — and nothing after it can
 * be predicted until then, because where the runner stands depends on it.
 *
 * Any disagreement or refusal drops everything queued, refetches `run.get`
 * and re-seeds `seq` from the server's `nextSeq`.
 */
export function useMoveQueue(
  matchId: string,
  nextSeq: number,
  view: () => (PredictableView & { finished: boolean }) | undefined,
  handlers: Handlers,
) {
  const utils = api.useUtils();
  const move = api.run.move.useMutation();
  const outbox = useRef<Outgoing[]>([]);
  const waiting = useRef<Direction[]>([]);
  // An unpredicted move is queued or in flight: nothing can be predicted
  // past it.
  const unresolved = useRef(false);
  const busy = useRef(false);
  const resyncing = useRef(false);
  const seq = useRef(nextSeq);
  const latest = useRef({ handlers, view });
  const [lean, setLean] = useState<Direction | null>(null);

  useEffect(() => {
    latest.current = { handlers, view };
  });

  // Another tab, or a refetch after the match changed, may move the server
  // ahead of this tab. Only while idle, and only forward.
  useEffect(() => {
    if (busy.current || outbox.current.length > 0 || resyncing.current) return;
    seq.current = Math.max(seq.current, nextSeq);
  }, [nextSeq]);

  const resync = useCallback(async () => {
    resyncing.current = true;
    outbox.current = [];
    waiting.current = [];
    unresolved.current = false;
    setLean(null);
    latest.current.handlers.onResync();
    try {
      await utils.run.get.invalidate({ matchId });
    } finally {
      const fresh = utils.run.get.getData({ matchId });
      if (fresh) seq.current = fresh.nextSeq;
      resyncing.current = false;
    }
  }, [matchId, utils]);

  // `commit` starts the pump and the pump commits the next waiting move, so
  // one of them reaches the other through a ref.
  const pumpRef = useRef<() => Promise<void>>(async () => undefined);

  const commit = useCallback((dir: Direction) => {
    const current = latest.current.view();
    if (!current || current.finished) return;
    const predicted = predictMove(current, dir);
    outbox.current.push({ seq: seq.current, dir, predicted });
    seq.current += 1;
    if (predicted) {
      latest.current.handlers.onDelta(predicted, "predicted", false);
    } else {
      unresolved.current = true;
      setLean(dir);
    }
    void pumpRef.current();
  }, []);

  const pump = useCallback(async () => {
    if (busy.current) return;
    const item = outbox.current[0];
    if (!item) return;

    busy.current = true;
    let failed: "resync" | "errors.matchOver" | "errors.matchExpired" | null =
      null;
    try {
      // A background refetch that began before this move would land after it
      // and roll the cache (and `nextSeq`) back to the older snapshot.
      await utils.run.get.cancel({ matchId });
      const result = await move.mutateAsync({
        matchId,
        seq: item.seq,
        dir: item.dir,
      });
      outbox.current.shift();
      const { onDelta, onMatchOver } = latest.current.handlers;

      if (item.predicted) {
        if (!sameDelta(item.predicted, result.delta)) {
          failed = "resync";
        } else {
          onDelta(result.delta, "confirmed", result.matchOver);
        }
      } else {
        unresolved.current = false;
        setLean(null);
        onDelta(result.delta, "answered", result.matchOver);
        if (result.delta.finished || result.matchOver) waiting.current = [];
        const next = waiting.current.shift();
        if (next) commit(next);
      }
      if (result.matchOver) {
        outbox.current = [];
        onMatchOver("errors.matchOver");
      }
    } catch (error) {
      const message = (error as { message?: string }).message;
      failed =
        message === "errors.matchOver" || message === "errors.matchExpired"
          ? message
          : "resync";
    } finally {
      busy.current = false;
    }

    if (failed === "resync") {
      await resync();
    } else if (failed) {
      outbox.current = [];
      waiting.current = [];
      unresolved.current = false;
      setLean(null);
      latest.current.handlers.onMatchOver(failed);
    }
    void pump();
  }, [matchId, move, utils, resync, commit]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const enqueue = useCallback(
    (dir: Direction) => {
      if (resyncing.current) return;
      if (unresolved.current) {
        if (waiting.current.length < MAX_WAITING) waiting.current.push(dir);
        return;
      }
      if (outbox.current.length >= MAX_AHEAD) return;
      commit(dir);
    },
    [commit],
  );

  return { enqueue, lean, pending: lean !== null };
}
