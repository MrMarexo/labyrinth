"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { gateColour } from "~/components/editor/gate-colours";
import { useChannel } from "~/components/realtime/use-channel";
import { RunBoard, type Bump } from "~/components/run/run-board";
import { useMoveQueue } from "~/components/run/use-move-queue";
import { Link } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import {
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function RunView({
  matchId,
  opponentName,
  deadlineAt,
  runChannel,
}: {
  matchId: string;
  opponentName: string;
  deadlineAt: Date;
  runChannel: string;
}) {
  const t = useTranslations("run");
  const te = useTranslations();
  const format = useFormatter();
  const utils = api.useUtils();

  const { data } = api.run.get.useQuery({ matchId });
  const [members, setMembers] = useState(0);
  useChannel(runChannel, { onMembers: setMembers });
  const watchers = Math.max(0, members - 1);
  const [bump, setBump] = useState<Bump | null>(null);
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

  const onDelta = (delta: RunnerDelta) => {
    utils.run.get.setData({ matchId }, (old) => {
      if (!old) return old;
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
    setAnnouncement(announce(delta));
    if (delta.outcome.startsWith("blocked") && delta.revealedSegment) {
      setBump({ segment: delta.revealedSegment, id: delta.moves });
    }
  };

  const { enqueue, pending } = useMoveQueue(matchId, data?.nextSeq ?? 1, {
    onDelta,
    onMatchOver: (key) => {
      void utils.match.get.invalidate({ id: matchId });
      if (key === "errors.matchExpired") {
        setExpired(true);
        setAnnouncement(te("errors.matchExpired"));
      }
    },
    onResync: () => {
      void utils.run.get.invalidate({ matchId });
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
  });

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

  return (
    <div data-run-view className="space-y-4">
      <div className="space-y-2">
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
        {watchers >= 1 && (
          <span data-watchers={watchers} className="text-muted text-sm">
            {t("watching", { count: watchers })}
          </span>
        )}
        {pending && <span data-run-pending hidden />}
      </div>

      <p aria-live="polite" data-run-announcement className="sr-only">
        {announcement}
      </p>

      <RunBoard
        map={data.map}
        at={data.at}
        heldKeys={data.heldKeys}
        bump={bump}
        pending={pending}
      />
      <p className="text-muted text-sm">{t("hint")}</p>
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
            className="text-accent inline-block text-sm underline"
          >
            {t("watchLive")}
          </Link>
        </div>
      ) : expired ? null : (
        <>
          <div
            role="group"
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
  );
}
