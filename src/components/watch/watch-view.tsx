"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { isTypingTarget } from "~/components/keyboard";
import { POLL_MS } from "~/components/realtime/poll";
import { useChannel } from "~/components/realtime/use-channel";
import { ResultMaze } from "~/components/run/result-maze";
import { RunBoard, type Bump } from "~/components/run/run-board";
import { Link } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { EVENTS } from "~/match";
import {
  SPEEDS,
  frameAt,
  initialPlayback,
  mergeMoves,
  playable,
  playback,
  tickMs,
  type LoggedMove,
  type Speed,
} from "~/maze";
import { api, type RouterOutputs } from "~/trpc/react";

type Whose = "opponent" | "mine";
type Replay = RouterOutputs["run"]["replay"];

/** Space on a focused control already activates that control. */
function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a, [role=radio]") !== null
  );
}

export function WatchView({
  matchId,
  whose,
  matchChannel,
}: {
  matchId: string;
  whose: Whose;
  matchChannel: string;
}) {
  const t = useTranslations("watch");
  const te = useTranslations();

  // No retry, so a refusal (watchNotYet, replayNotReady, notYours) shows at
  // once. The poll covers a live replay when realtime is down or absent.
  const { data, error, refetch } = api.run.replay.useQuery(
    { matchId, whose },
    {
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => (query.state.data?.live ? POLL_MS : false),
    },
  );

  // A failed refetch keeps the last replay on screen; the next refetch or
  // poll tries again.
  if (error && !data) {
    const issue = resolveErrorKey(te, error, "errors.unknown");
    return (
      <div className="space-y-4">
        <p role="alert" data-watch-error className="text-danger">
          {te(issue.key as never, issue.params as never)}
        </p>
        <Link href={`/matches/${matchId}`} className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }
  if (!data) return null;

  return (
    <WatchPlayer
      matchId={matchId}
      whose={whose}
      matchChannel={matchChannel}
      data={data}
      refetch={refetch}
    />
  );
}

/** Mounted once the first replay arrives, so playback starts from it. */
function WatchPlayer({
  matchId,
  whose,
  matchChannel,
  data,
  refetch,
}: {
  matchId: string;
  whose: Whose;
  matchChannel: string;
  data: Replay;
  /** react-query's refetch, which keeps its identity across renders. */
  refetch: () => Promise<unknown>;
}) {
  const t = useTranslations("watch");
  const tr = useTranslations("run");

  const [moves, setMoves] = useState<LoggedMove[]>(() =>
    mergeMoves([], data.moves),
  );
  // A finished run never goes live again, so a stale refetch must not
  // revive it.
  const [live, setLive] = useState(data.live);
  useEffect(() => {
    setMoves((m) => mergeMoves(m, data.moves));
    setLive((l) => l && data.live);
  }, [data]);
  const timeline = useMemo(() => playable(moves), [moves]);

  useChannel(live ? data.channel : null, {
    onEvent: (event, payload) => {
      if (event !== EVENTS.move) return;
      const move = payload as LoggedMove;
      setMoves((m) => mergeMoves(m, [move]));
      if (move.delta.finished) setLive(false);
    },
    onCatchUp: () => void refetch(),
  });

  // A run that ends without a finishing move (a give-up, or expiry) is
  // announced only on the match channel; the refetch then reports it over.
  useChannel(live ? matchChannel : null, {
    onEvent: (event) => {
      if (event === EVENTS.changed) void refetch();
    },
    onCatchUp: () => void refetch(),
  });

  // A move published between the first fetch and the subscription is never
  // delivered, and every later move waits behind the gap. Ask the log once
  // per new move count, so a gap a refetch cannot close is not hammered.
  const gapRefetchedAt = useRef<number | null>(null);
  useEffect(() => {
    if (moves.length <= timeline.length) return;
    if (gapRefetchedAt.current === moves.length) return;
    gapRefetchedAt.current = moves.length;
    void refetch();
  }, [moves.length, timeline.length, refetch]);

  const [state, dispatch] = useReducer(playback, undefined, () =>
    initialPlayback(playable(data.moves).length, data.live),
  );

  useEffect(() => {
    dispatch({ type: "arrived", length: timeline.length, live });
  }, [timeline.length, live]);

  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(
      () => dispatch({ type: "tick" }),
      tickMs(state.speed),
    );
    return () => clearInterval(id);
  }, [state.playing, state.speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      switch (event.key) {
        case " ":
          if (isControlTarget(event.target)) return;
          event.preventDefault();
          dispatch({ type: state.playing ? "pause" : "play" });
          return;
        case "ArrowLeft":
          event.preventDefault();
          dispatch({ type: "step", by: -1 });
          return;
        case "ArrowRight":
          event.preventDefault();
          dispatch({ type: "step", by: 1 });
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.playing]);

  const frame = useMemo(
    () => frameAt(timeline, state.step),
    [timeline, state.step],
  );
  const bump: Bump | null =
    frame.last?.outcome.startsWith("blocked") && frame.last.revealedSegment
      ? { segment: frame.last.revealedSegment, id: frame.moves }
      : null;
  const start = data.maze.start;
  const path = useMemo(
    () => frame.path.map((p) => ({ x: p.x + start.x, y: p.y + start.y })),
    [frame.path, start.x, start.y],
  );

  return (
    <div
      data-watch-view
      data-live={String(state.live)}
      data-watch-step={state.step}
      data-watch-length={state.length}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">
          {whose === "opponent"
            ? t("opponentTitle", { name: data.runnerName })
            : t("mineTitle", { name: data.authorName })}
        </h1>
        {state.live && (
          <span
            data-live-badge
            className="border-danger text-danger rounded-full border px-2 py-0.5 text-xs font-medium uppercase"
          >
            {t("live")}
          </span>
        )}
        {state.live && !state.following && (
          <button
            type="button"
            data-jump-live
            onClick={() => dispatch({ type: "jumpToLive" })}
            className="border-border-strong min-h-11 rounded border px-3 py-2 text-sm"
          >
            {t("jumpToLive")}
          </button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section
          data-watch-runner-view
          aria-label={t("runnerView")}
          className="space-y-2"
        >
          <h2 className="text-sm font-medium">{t("runnerView")}</h2>
          <RunBoard
            map={frame.map}
            at={frame.at}
            heldKeys={frame.heldKeys}
            bump={bump}
            pending={false}
          />
          <div className="flex flex-wrap gap-4 text-sm">
            <p data-penalties={frame.penalties}>
              {tr("penaltiesLabel")}: {frame.penalties}
            </p>
            <p data-moves={frame.moves}>
              {tr("movesLabel")}: {frame.moves}
            </p>
          </div>
        </section>
        <section data-watch-maze-view>
          <ResultMaze
            maze={data.maze}
            path={path}
            label={t("mazeView")}
            which={whose === "opponent" ? "yours" : "theirs"}
          />
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => dispatch({ type: state.playing ? "pause" : "play" })}
          className="bg-accent text-on-accent min-h-11 min-w-20 rounded px-3 py-2 text-sm"
        >
          {state.playing ? t("pause") : t("play")}
        </button>
        <input
          type="range"
          min={0}
          max={state.length}
          value={state.step}
          aria-label={t("scrubber")}
          onChange={(e) =>
            dispatch({ type: "scrub", step: Number(e.target.value) })
          }
          className="accent-accent min-w-40 flex-1"
        />
        <p className="text-muted text-sm tabular-nums">
          {t("step", { step: state.step, length: state.length })}
        </p>
        <SpeedPicker
          speed={state.speed}
          onSpeed={(speed) => dispatch({ type: "speed", speed })}
        />
      </div>

      <Link href={`/matches/${matchId}`} className="inline-block underline">
        {t("back")}
      </Link>
    </div>
  );
}

/** The radiogroup pattern of `editor/shape-tools.tsx`. */
function SpeedPicker({
  speed,
  onSpeed,
}: {
  speed: Speed;
  onSpeed: (speed: Speed) => void;
}) {
  const t = useTranslations("watch");
  const buttonRefs = useRef(new Map<Speed, HTMLButtonElement>());

  const activeIndex = SPEEDS.indexOf(speed);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (tabStopIndex + 1) % SPEEDS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (tabStopIndex - 1 + SPEEDS.length) % SPEEDS.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = SPEEDS[nextIndex]!;
    onSpeed(next);
    buttonRefs.current.get(next)?.focus();
  }

  return (
    <div role="radiogroup" aria-label={t("speed")} className="flex gap-2">
      {SPEEDS.map((option, index) => {
        const active = speed === option;
        return (
          <button
            key={option}
            ref={(el) => {
              if (el) buttonRefs.current.set(option, el);
              else buttonRefs.current.delete(option);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onClick={() => onSpeed(option)}
            onKeyDown={handleKeyDown}
            className={
              active
                ? "bg-accent text-on-accent min-h-11 rounded px-3 py-2 text-sm"
                : "border-border-strong min-h-11 rounded border px-3 py-2 text-sm"
            }
          >
            {t("speedOption", { speed: option })}
          </button>
        );
      })}
    </div>
  );
}
