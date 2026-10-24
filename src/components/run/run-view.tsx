"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { gateColour } from "~/components/editor/gate-colours";
import { isTypingTarget } from "~/components/keyboard";
import { useChannel } from "~/components/realtime/use-channel";
import { FoundToast, type Found } from "~/components/run/found-toast";
import { RunBoard, type Bump } from "~/components/run/run-board";
import { useMoveQueue, type DeltaKind } from "~/components/run/use-move-queue";
import { Link } from "~/components/link";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import {
  discovery,
  heldKeys,
  recordDelta,
  type Direction,
  type RunnerDelta,
  type RunnerOutcome,
} from "~/maze";
import { api } from "~/trpc/react";

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "N",
  w: "N",
  W: "N",
  ArrowRight: "E",
  d: "E",
  D: "E",
  ArrowDown: "S",
  s: "S",
  S: "S",
  ArrowLeft: "W",
  a: "W",
  A: "W",
};

const DPAD: { dir: Direction; label: string; area: string; arrow: string }[] = [
  { dir: "N", label: "moveN", area: "col-start-2 row-start-1", arrow: "↑" },
  { dir: "W", label: "moveW", area: "col-start-1 row-start-2", arrow: "←" },
  { dir: "E", label: "moveE", area: "col-start-3 row-start-2", arrow: "→" },
  { dir: "S", label: "moveS", area: "col-start-2 row-start-3", arrow: "↓" },
];

/** What the finish popup reports, from the move that reached the treasure. */
export type Finish = { penalties: number; moves: number; matchOver: boolean };

export function RunView({
  matchId,
  opponentName,
  deadlineAt,
  runChannel,
  onFinish,
}: {
  matchId: string;
  opponentName: string;
  deadlineAt: Date;
  runChannel: string;
  /** Called once, on the finishing move — never on a reload. */
  onFinish: (finish: Finish) => void;
}) {
  const t = useTranslations("run");
  const te = useTranslations();
  const format = useFormatter();
  const utils = api.useUtils();

  const { data: fetched } = api.run.get.useQuery({ matchId });
  const [members, setMembers] = useState(0);
  useChannel(runChannel, { onMembers: setMembers });
  const watchers = Math.max(0, members - 1);
  const [bump, setBump] = useState<Bump | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirming, setConfirming] = useState(false);
  // The match is `running` until the sweep closes it, so a refused move past
  // the deadline needs showing here rather than waiting for a status change.
  const [expired, setExpired] = useState(false);

  const giveUp = api.run.giveUp.useMutation({
    onError: (error) => {
      const { key } = resolveErrorKey(te, error, "errors.unknown");
      if (key === "errors.matchOver" || key === "errors.matchExpired") {
        void utils.match.get.invalidate({ id: matchId });
      }
    },
    onSuccess: () => {
      void utils.match.get.invalidate({ id: matchId });
    },
  });
  const giveUpError = giveUp.isError
    ? resolveErrorKey(te, giveUp.error, "errors.unknown")
    : null;

  function announce(delta: RunnerDelta): string {
    const { penalties } = delta;
    const gate =
      delta.revealedSegment?.kind === "gate" ? delta.revealedSegment.gate : 0;
    const copy = {
      moved: () => t("announceMoved"),
      blocked_wall: () => t("announceWall", { penalties }),
      blocked_gate: () => t("announceGate", { gate, penalties }),
      moved_found_key: () =>
        t("announceKey", { gate: delta.revealedCell?.key ?? 0 }),
      moved_through_gate: () => t("announceThroughGate", { gate }),
      moved_found_treasure: () => t("announceTreasure"),
    } satisfies Record<RunnerOutcome, () => string>;
    return copy[delta.outcome]();
  }

  const onDelta = (delta: RunnerDelta, kind: DeltaKind, matchOver: boolean) => {
    const before = utils.run.get.getData({ matchId });
    const newlyFound =
      // The finishing move opens the finish popup instead.
      kind !== "confirmed" &&
      !delta.finished &&
      before &&
      before.moves < delta.moves
        ? discovery(before.map, delta)
        : null;
    utils.run.get.setData({ matchId }, (old) => {
      // Already drawn: a confirmed prediction, or an answer a refetch beat.
      if (!old || old.moves >= delta.moves) return old;
      const map = recordDelta(old.map, delta);
      return {
        ...old,
        at: delta.at,
        map,
        heldKeys: heldKeys(map),
        penalties: delta.penalties,
        moves: delta.moves,
        nextSeq: delta.moves + 1,
        finished: delta.finished,
      };
    });
    if (kind === "confirmed") return;
    setAnnouncement(announce(delta));
    if (newlyFound) setFound({ ...newlyFound, id: delta.moves });
    if (delta.outcome.startsWith("blocked") && delta.revealedSegment) {
      setBump({ segment: delta.revealedSegment, id: delta.moves });
    }
    if (delta.finished) {
      // The popup's time needs `run.get`'s elapsedMs, which only the server
      // knows.
      void utils.run.get.invalidate({ matchId });
      onFinish({ penalties: delta.penalties, moves: delta.moves, matchOver });
    }
  };

  const { enqueue, lean, pending, rebase } = useMoveQueue(
    matchId,
    fetched?.nextSeq ?? 1,
    () => utils.run.get.getData({ matchId }),
    {
      onDelta,
      onMatchOver: (key) => {
        void utils.match.get.invalidate({ id: matchId });
        if (key === "errors.matchExpired") {
          setExpired(true);
          setAnnouncement(te("errors.matchExpired"));
        }
      },
      onResync: () => {
        setAnnouncement(
          te(
            resolveErrorKey(
              te,
              { message: "errors.moveOutOfOrder" },
              "errors.unknown",
            ).key as never,
          ),
        );
      },
    },
  );

  // A refetch that began before moves this tab already drew would step the
  // runner back; bring it forward instead (predictions are certain), and
  // write the result back so the queue predicts from it too.
  const forward = (d: NonNullable<typeof fetched>) => {
    const r = rebase(d);
    return r === d
      ? d
      : { ...r, heldKeys: heldKeys(r.map), nextSeq: r.moves + 1 };
  };
  const data = fetched ? forward(fetched) : fetched;
  useEffect(() => {
    if (data && data !== fetched) utils.run.get.setData({ matchId }, data);
  }, [data, fetched, matchId, utils]);

  const finished = (data?.finished ?? true) || expired;
  useEffect(() => {
    if (finished || confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const dir = KEY_TO_DIRECTION[event.key];
      if (!dir) return;
      event.preventDefault();
      enqueue(dir);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finished, confirming, enqueue]);

  if (!data) return null;

  const counters = (
    <div className="space-y-2">
      <p data-run-rule className="text-sm">
        {t.rich("rule", { b: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <p className="text-muted text-sm">{t("penaltiesLabel")}</p>
      <p data-penalties={data.penalties} className="text-4xl font-bold">
        {data.penalties}
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <p data-moves={data.moves}>
          {t("movesLabel")}: {data.moves}
        </p>
        <div className="flex items-center gap-2">
          <span>{t("keysLabel")}:</span>
          {data.heldKeys.length === 0 ? (
            <span className="text-muted">{t("noKeys")}</span>
          ) : (
            data.heldKeys.map((gate) => (
              <span
                key={gate}
                data-held-key={gate}
                role="img"
                aria-label={t("keyName", { gate })}
                title={t("keyName", { gate })}
                className="border-border-strong inline-block size-4 rounded-full border"
                style={{ backgroundColor: gateColour(gate) }}
              />
            ))
          )}
        </div>
      </div>
      <span aria-live="polite">
        {watchers >= 1 && (
          <span data-watchers={watchers} className="text-muted text-sm">
            {t("watching", { count: watchers })}
          </span>
        )}
      </span>
      {pending && <span data-run-pending hidden />}
    </div>
  );

  return (
    // Below lg the three parts stack in DOM order; from lg the board takes
    // the left column and the other two share a 20rem column on the right.
    <div
      data-run-view
      className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:items-start lg:space-y-0 lg:gap-x-8 lg:gap-y-4"
    >
      <div className="lg:col-start-2 lg:row-start-1">{counters}</div>

      <div
        data-run-board-column
        className="space-y-2 lg:col-start-1 lg:row-span-2 lg:row-start-1"
      >
        <p aria-live="polite" data-run-announcement className="sr-only">
          {announcement}
        </p>
        <div className="relative">
          <RunBoard
            map={data.map}
            at={data.at}
            heldKeys={data.heldKeys}
            bump={bump}
            lean={lean}
          />
          <FoundToast found={found} />
        </div>
        <p className="text-muted text-sm">{t("hint")}</p>
      </div>

      <div className="space-y-4 lg:col-start-2 lg:row-start-2">
        <p data-run-deadline className="text-muted text-sm">
          {t("deadline", {
            when: format.dateTime(deadlineAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>

        {expired && (
          <p role="alert" data-run-expired className="text-danger text-sm">
            {te("errors.matchExpired")}
          </p>
        )}

        {data.finished ? (
          <div data-run-finished className="space-y-2">
            <p>
              {t("finishedWaiting", {
                penalties: data.penalties,
                moves: data.moves,
              })}
            </p>
            <Link
              href={`/matches/${matchId}/watch?run=opponent`}
              data-watch-live
              className="inline-block text-sm"
            >
              {t("watchLive")}
            </Link>
          </div>
        ) : expired ? null : (
          <>
            <div
              role="group"
              data-dpad
              aria-label={t("dpadLabel")}
              className="grid w-fit grid-cols-3 grid-rows-3 gap-1"
            >
              {DPAD.map(({ dir, label, area, arrow }) => (
                <button
                  key={dir}
                  type="button"
                  aria-label={t(label as "moveN")}
                  onClick={() => enqueue(dir)}
                  className={`${area} border-border-strong min-h-11 min-w-11 rounded border text-lg`}
                >
                  <span aria-hidden="true">{arrow}</span>
                </button>
              ))}
            </div>

            {confirming ? (
              <div className="space-y-2">
                <p>{t("confirmGiveUp", { name: opponentName })}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={giveUp.isPending}
                    onClick={() => giveUp.mutate({ matchId })}
                    className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {giveUp.isPending ? t("givingUp") : t("giveUpYes")}
                  </button>
                  <button
                    type="button"
                    disabled={giveUp.isPending}
                    onClick={() => setConfirming(false)}
                    className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {t("giveUpNo")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="border-border-strong rounded border px-3 py-2 text-sm"
              >
                {t("giveUp")}
              </button>
            )}

            {giveUpError && (
              <p role="alert" className="text-danger text-sm">
                {te(giveUpError.key as never, giveUpError.params as never)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
