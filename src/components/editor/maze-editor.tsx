"use client";

import { Redo2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { iconButtonClass, Tooltip } from "~/components/tooltip";
import type { TranslatableIssue } from "~/lib/issues";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import {
  brushCells,
  cellsUsed,
  draftToMaze,
  edgeKey,
  editorReducer,
  gatesPlaced,
  incompleteDraftIssues,
  initialEditorState,
  keysPlaced,
  lowestUnplaced,
  placedNumbers,
  validateMaze,
  type BrushSize,
  type EditorAction,
  type DraftMaze,
  type Edge,
  type Point,
  type Tool,
} from "~/maze";
import { api } from "~/trpc/react";
import { Board } from "./board";
import { DetailTools } from "./detail-tools";
import { discardsSettled, trackDiscard } from "./pending-discards";
import { ShapeTools } from "./shape-tools";
import { UseInMatch } from "./use-in-match";
import { ValidationPanel, type SaveState } from "./validation-panel";

const AUTOSAVE_MS = 800;

export type MazeEditorProps = {
  id: string;
  initial: DraftMaze;
  /** The server's version of `initial`, which the first save must match. */
  version: number;
  cellCount: number;
  gateCount: number;
  /** The match this editor was opened from, checked by the page. */
  forMatch: { id: string; code: string } | null;
};

export function MazeEditor({
  id,
  initial,
  version,
  cellCount,
  gateCount,
  forMatch,
}: MazeEditorProps) {
  const t = useTranslations();
  // Invariant the first-render guard below depends on: `lastSentRef` and the
  // reducer's initial draft must be seeded from this exact same `initial`
  // object, never a copy of it — the guard is a reference-equality check,
  // and a copy here would make it fire on the very first render.
  // `initialEditorState` keeps that promise for a clean draft. For a legacy
  // draft with segments outside the shape it returns a cleaned copy, and
  // the guard then fires once on purpose: one autosave persists the cleanup.
  const [state, dispatch] = useReducer(
    editorReducer,
    initial,
    initialEditorState,
  );
  const [tool, setTool] = useState<Tool>("paint");
  // Squares per side for paint and erase-square; other tools ignore it.
  const [brush, setBrush] = useState<BrushSize>(1);
  // The gate or key number the gate and key tools place. Set to the default
  // each time one of those tools is activated, then only by the author.
  const [chosen, setChosen] = useState<number | null>(null);
  const utils = api.useUtils();
  const saveDraft = api.maze.saveDraft.useMutation();
  const discardIfEmpty = api.maze.discardIfEmpty.useMutation();

  // `locked` and `saveError` are read from render; everything else here is
  // bookkeeping for the autosave pipeline below and lives in refs so that
  // updating it never itself triggers a render.
  const [locked, setLocked] = useState(false);
  const [saveError, setSaveError] = useState<TranslatableIssue | null>(null);
  // Render-side mirrors of the pipeline's bookkeeping, for the save status:
  // `lastSentRef` and `savingRef` below stay the source of truth for what
  // gets sent, but a ref changing never re-renders.
  const [savedDraft, setSavedDraft] = useState<DraftMaze>(initial);
  const [inFlight, setInFlight] = useState(false);

  // The draft last known to match what the server has. Updated only on a
  // *successful* save (never optimistically before the response), so a
  // failed save leaves it pointing at the old value — which is what lets the
  // very next edit's autosave resend the lost work instead of the gap going
  // unnoticed forever.
  const lastSentRef = useRef<DraftMaze>(initial);
  // The server's version of `lastSentRef`'s draft, sent with every save as
  // its precondition. Moves only with `lastSentRef`, on a successful save.
  const versionRef = useRef(version);
  // Whether a saveDraft call is currently in flight.
  const savingRef = useRef(false);
  // Set when something wants to send while a call is already in flight —
  // a debounce tick, the post-success recheck, a manual retry, or the
  // unmount flush. Deliberately *not* a stored draft: `onSettled` below
  // always re-reads the live draft through `draftRef` instead of whatever
  // value was true at queue time, because a value frozen at queue time can
  // go stale before it is actually sent (see the fix report's second trace —
  // an undo arriving after something was queued, but before the in-flight
  // call settles, must not resurrect the content it undid).
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  // Set once the way-out discard has been fired, so it fires at most once.
  const discardedRef = useRef(false);
  // Resolves the promise registered at unmount, which covers the flush and
  // the discard together; null when no leave is under way.
  const leftRef = useRef<(() => void) | null>(null);
  // Mirrors `state.draft` so the pipeline below always reads the live draft
  // rather than a value some earlier closure captured.
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;
  const stateRef = useRef(state);
  stateRef.current = state;

  // `initial` can be stale: Next's router cache replays the page as first
  // rendered on Back and Forward, and a prefetch can cache it mid-save. So
  // the editor asks the server again on open. A newer version replaces the
  // draft only while the author has not touched it; once they have, their
  // edits stay, and the save's version check turns the clash into a
  // `draftChangedElsewhere` conflict instead of a silent overwrite.
  //
  // Not until this tab's earlier editors have finished leaving (capped, see
  // `discardsSettled`): after a quick leave-then-Back, the old editor's
  // flush may still be in flight, and a read before it lands would adopt
  // the pre-flush version and make the next save a false conflict.
  const [othersLeft, setOthersLeft] = useState(false);
  // Counts drafts loaded from the server, so the board frames each afresh.
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let live = true;
    void discardsSettled().then(() => {
      if (live) setOthersLeft(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const fresh = api.maze.get.useQuery(
    { id },
    {
      enabled: othersLeft,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    },
  );
  useEffect(() => {
    const latest = fresh.data;
    if (!latest) return;
    if (latest.status === "submitted") {
      setLocked(true);
      setSaveError({ key: "errors.mazeIsSubmitted" });
      return;
    }
    if (latest.version <= versionRef.current || savingRef.current) return;
    const { past, future, strokeBase } = stateRef.current;
    if (past.length > 0 || future.length > 0 || strokeBase !== null) return;
    // The same object the reducer loads, so the autosave's first-render
    // guard holds again and the fresh draft is not written straight back.
    lastSentRef.current = latest.data;
    versionRef.current = latest.version;
    setSavedDraft(latest.data);
    dispatch({ type: "load", draft: latest.data });
    setLoads((n) => n + 1);
  }, [fresh.data]);

  function send(draft: DraftMaze) {
    savingRef.current = true;
    if (mountedRef.current) setInFlight(true);
    // `mutateAsync`, not `mutate` with callbacks: TanStack Query drops a
    // `mutate` call's callbacks once the component has unmounted, and this
    // pipeline has to keep going after the author navigates away.
    const onSuccess = (result: { version: number }) => {
      lastSentRef.current = draft;
      versionRef.current = result.version;
      if (mountedRef.current) {
        setSaveError(null);
        setSavedDraft(draft);
      }
      // The live draft can have moved on while this request was in
      // flight — most sharply when undo pops the history stack back
      // onto the very object `lastSentRef` already pointed at, which
      // makes `state.draft === lastSentRef.current` true again and
      // defeats the debounce effect's change detection below (it never
      // sees a "change" to react to, so it never schedules anything).
      // `maybeSend` re-reads `draftRef` fresh, so this is a correct
      // recheck rather than a repeat of whatever was queued earlier;
      // `savingRef` is still true here (this call's own `onSettled`
      // hasn't run yet), so this only ever sets `pendingRef` — the
      // actual send happens from `onSettled` below once this call's
      // bookkeeping is done. Covers redo identically, since it restores
      // a draft by reference the same way undo does, and converges
      // through a run of several undo/redo dispatches during one
      // in-flight save, because each corrective round-trip rechecks the
      // live draft again on its own settle.
      maybeSend();
    };
    const onError = (error: Parameters<typeof resolveErrorKey>[1]) => {
      if (!mountedRef.current) return;
      const resolved = resolveErrorKey(t, error, "editor.saveFailed");
      // A maze can only reach this state once Phase 3 adds submission —
      // nothing in this phase ever sets a maze's status to "submitted" —
      // but the rule ("mazes are never edited once finished") has to
      // hold the day that becomes reachable, not the day someone
      // remembers to add a check for it.
      // Neither is fixed by sending again: a used maze is final, and a
      // stale copy would overwrite whatever the other copy saved.
      if (
        resolved.key === "errors.mazeIsSubmitted" ||
        resolved.key === "errors.draftChangedElsewhere"
      ) {
        setLocked(true);
      }
      setSaveError(resolved);
      // Deliberately no corrective send here: `lastSentRef` stays at its
      // old value on a failure, so a blind recheck would find the live
      // draft still "different" forever and retry the same rejected
      // content in a tight loop. `pendingRef` below still only reflects
      // a genuinely new edit queued elsewhere while this attempt was in
      // flight — never the content that just failed.
    };
    const onSettled = () => {
      savingRef.current = false;
      if (mountedRef.current) setInFlight(false);
      // Deliberately unguarded by `mountedRef`: a queued send must still
      // reach the server after the author has navigated away, or it is
      // simply lost. Only the UI feedback above is skipped post-unmount.
      if (pendingRef.current) {
        pendingRef.current = false;
        maybeSend();
      }
      afterLeaving();
    };
    saveDraft
      .mutateAsync({ id, data: draft, expectedVersion: versionRef.current })
      .then(onSuccess, onError)
      .finally(onSettled);
  }

  /**
   * Once the editor has gone and nothing is left to save: a draft the server
   * holds as empty is deleted, so blank labyrinths do not pile up; anything
   * else just refreshes what the author goes back to. Runs only when the
   * server is known to hold exactly the live draft — never while a save is
   * in flight or failed — so it can never race a save of squares.
   */
  function afterLeaving() {
    if (mountedRef.current || savingRef.current) return;
    const synced = draftRef.current === lastSentRef.current;
    if (!synced || draftRef.current.cells.length > 0) {
      finishLeaving();
      return;
    }
    if (discardedRef.current) return;
    discardedRef.current = true;
    // A tick later, and only if still unmounted: StrictMode's development
    // remount runs this cleanup on a live editor and then mounts it again.
    void Promise.resolve().then(async () => {
      if (mountedRef.current) {
        discardedRef.current = false;
        finishLeaving();
        return;
      }
      try {
        await discardIfEmpty.mutateAsync({ id });
      } catch {
        // Left in place; draftForMatch may hand it out again, harmlessly.
      } finally {
        finishLeaving();
      }
    });
  }

  /**
   * Called once at unmount, before the flush: "Draw a new one" waits on
   * this, so it can never be handed the draft this leave is about to
   * discard, even while the flush is still in flight.
   */
  function beginLeaving() {
    trackDiscard(
      new Promise<void>((resolve) => {
        leftRef.current = resolve;
      }),
    );
  }

  /** Ends the leave: settles its promise and refreshes the list. */
  function finishLeaving() {
    void utils.maze.list.invalidate();
    leftRef.current?.();
    leftRef.current = null;
  }

  // The single entry point for "there might be something to save". Sends
  // immediately if nothing is in flight and the live draft actually differs
  // from what the server is believed to hold; otherwise marks `pendingRef`
  // so `onSettled` above re-evaluates (via this same function, so it is
  // always the live draft that goes out, never a stale snapshot) once the
  // in-flight call is done.
  function maybeSend() {
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    if (draftRef.current === lastSentRef.current) return;
    send(draftRef.current);
  }

  // Kept current every render so the unmount effect below — which must use
  // an empty dependency array to fire its cleanup on unmount alone, not on
  // every edit — always calls the version closed over the latest id/state.
  const maybeSendRef = useRef(maybeSend);
  maybeSendRef.current = maybeSend;
  const afterLeavingRef = useRef(afterLeaving);
  afterLeavingRef.current = afterLeaving;
  const beginLeavingRef = useRef(beginLeaving);
  beginLeavingRef.current = beginLeaving;

  // Autosave. Debounced at AUTOSAVE_MS: every edit resets the timer, so a
  // burst of clicks produces one request after the author pauses, not one
  // per click. Held for the whole of a stroke, so a drag that pauses
  // mid-row still saves once, after the release.
  const inStroke = state.strokeBase !== null;
  useEffect(() => {
    if (inStroke) return;
    // Covers the first render: `state.draft` is the same reference as
    // `lastSentRef.current` (both set from `initial`) until a real edit
    // replaces it, so a freshly loaded draft is never written straight back.
    // (`maybeSend` would reach the same conclusion on its own when the timer
    // fires; this is the cheap early exit that avoids scheduling a timer
    // that would do nothing.)
    if (state.draft === lastSentRef.current) return;
    const timer = setTimeout(() => maybeSend(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.draft, inStroke]);

  // Unmount only (empty deps): flush whatever the debounce above hasn't sent
  // yet, rather than losing up to AUTOSAVE_MS of drawing to a navigation.
  // Re-arms `mountedRef` on setup: StrictMode double-invokes this effect in
  // development (setup -> cleanup -> setup), and without this the cleanup's
  // `false` would never be undone, permanently disabling the error banner.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      beginLeavingRef.current();
      maybeSendRef.current();
      afterLeavingRef.current();
    };
  }, []);

  // A parse, eleven structural rules, a BFS over cells x 2^8, a normalize
  // and a content hash — too much to redo on every render, not just on a
  // change to the draft or the settings it's validated against.
  const validation = useMemo(() => {
    const complete = draftToMaze(state.draft);
    return complete ? validateMaze(complete, { cellCount, gateCount }) : null;
  }, [state.draft, cellCount, gateCount]);
  const issues: TranslatableIssue[] = validation
    ? validation.ok
      ? []
      : validation.issues
    : incompleteDraftIssues(state.draft, { cellCount, gateCount });

  // "saved" only once the server holds exactly the live draft: not while the
  // debounce is pending, and not while any request is still in flight, since
  // even a draft equal to the saved one (an undo back onto it) is about to be
  // overwritten by that request and then corrected by the recheck.
  const saveState: SaveState = saveError
    ? "error"
    : state.draft !== savedDraft || inFlight
      ? "saving"
      : "saved";

  function selectTool(next: Tool) {
    setTool(next);
    if (next === "gate" || next === "key") {
      setChosen(defaultNumber(next, state.draft, gateCount));
    }
  }

  function onCell(at: Point) {
    if (locked) return;
    switch (tool) {
      case "paint":
      case "erase-cell":
        return stamp(at);
      case "start":
        return dispatch({ type: "placeStart", at });
      case "treasure":
        return dispatch({ type: "placeTreasure", at });
      case "key":
        return chosen === null
          ? undefined
          : placeNumbered("key", {
              type: "placeKey",
              at,
              gate: chosen,
              gateCount,
            });
      case "erase":
        return dispatch({ type: "clearCell", at });
      default:
        return undefined;
    }
  }

  /** Paints or erases every square the brush covers at `at`. */
  function stamp(at: Point) {
    const cells = brushCells(at, brush);
    return dispatch(
      tool === "paint"
        ? { type: "paintCells", cells, limit: cellCount }
        : { type: "eraseCells", cells },
    );
  }

  /**
   * Places a numbered gate or key, then moves the choice on to the lowest
   * number still unplaced, so consecutive clicks place 1, 2, 3… Done here,
   * on the placement itself, and not in an effect on the draft: undo and
   * redo must not move the choice. A refusal or a toggle-off leaves it
   * alone, and so does a draft with every number placed.
   */
  function placeNumbered(kind: "gate" | "key", action: EditorAction) {
    const after = editorReducer(state, action).draft;
    dispatch(action);
    if (after === state.draft || chosen === null) return;
    if (!placedNumbers(kind, after).has(chosen)) return;
    const next = lowestUnplaced(kind, after, gateCount);
    if (next !== null) setChosen(next);
  }

  function onEdge(edge: Edge) {
    if (locked) return;
    if (tool === "wall")
      return dispatch({ type: "placeSegment", edge, kind: "wall" });
    if (tool === "gate" && chosen !== null) {
      return placeNumbered("gate", {
        type: "placeSegment",
        edge,
        kind: "gate",
        gate: chosen,
        gateCount,
      });
    }
    if (tool === "erase") return dispatch({ type: "removeSegment", edge });
  }

  // Whether the current wall stroke adds or removes, decided by the first
  // edge it reaches: a stroke that starts on a wall removes walls.
  const wallModeRef = useRef<"add" | "remove" | null>(null);

  function onStrokeBegin() {
    if (locked) return;
    wallModeRef.current = null;
    dispatch({ type: "beginStroke" });
  }

  function onStrokeCell(at: Point) {
    if (locked) return;
    if (tool === "paint" || tool === "erase-cell") return stamp(at);
    // A drag takes only what sits on the squares it crosses; their walls
    // go only where the drag runs along them, as edges. A tap clears the
    // whole square (`onStrokeTap`).
    if (tool === "erase") return dispatch({ type: "clearItems", at });
  }

  function onStrokeTap(at: Point) {
    if (locked) return;
    if (tool === "erase") dispatch({ type: "clearCell", at });
  }

  function onStrokeEdge(edge: Edge) {
    if (locked) return;
    if (tool === "erase") return dispatch({ type: "removeSegment", edge });
    if (tool !== "wall") return;

    const id = edgeKey(edge);
    const isWall = state.draft.segments.some(
      (s) => s.kind === "wall" && edgeKey(s) === id,
    );
    wallModeRef.current ??= isWall ? "remove" : "add";
    if (wallModeRef.current === "add") {
      return dispatch({ type: "setWall", edge });
    }
    // A removing stroke takes walls only; a gate it passes over stays.
    if (isWall) return dispatch({ type: "removeSegment", edge });
  }

  function onStrokeEnd() {
    dispatch({ type: "endStroke" });
  }

  function onStrokeCancel() {
    dispatch({ type: "cancelStroke" });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-center lg:gap-8">
      <Board
        draft={state.draft}
        frame={loads}
        tool={tool}
        paintsLeft={Math.max(0, cellCount - cellsUsed(state.draft))}
        brush={brush}
        gate={chosen}
        locked={locked}
        onCell={onCell}
        onEdge={onEdge}
        onStrokeBegin={onStrokeBegin}
        onStrokeCancel={onStrokeCancel}
        onStrokeCell={onStrokeCell}
        onStrokeEdge={onStrokeEdge}
        onStrokeTap={onStrokeTap}
        onStrokeEnd={onStrokeEnd}
      />

      <aside className="space-y-4 lg:w-80 lg:shrink-0 lg:space-y-6">
        <ShapeTools
          tool={tool}
          onTool={selectTool}
          used={cellsUsed(state.draft)}
          budget={cellCount}
          brush={brush}
          onBrush={setBrush}
        />
        <DetailTools
          tool={tool}
          onTool={selectTool}
          gates={gatesPlaced(state.draft)}
          gateBudget={gateCount}
          keys={keysPlaced(state.draft)}
          chosen={chosen}
          onChoose={setChosen}
          placed={placedNumbers(tool === "key" ? "key" : "gate", state.draft)}
        />

        {saveError && (
          <div
            role="alert"
            data-save-error
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <p className="text-danger">
              {t(saveError.key as never, saveError.params as never)}
            </p>
            {!locked && (
              <button
                type="button"
                onClick={() => maybeSend()}
                className="border-border-strong rounded border px-2 py-1 text-xs"
              >
                {t("editor.retry")}
              </button>
            )}
            {saveError.key === "errors.draftChangedElsewhere" && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border-border-strong rounded border px-2 py-1 text-xs"
              >
                {t("editor.reload")}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: "undo" })}
            disabled={state.past.length === 0 || locked}
            aria-label={t("editor.undo")}
            className={`${iconButtonClass(false)} disabled:opacity-50`}
          >
            <Undo2 aria-hidden="true" className="size-5" />
            <Tooltip label={t("editor.undo")} />
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "redo" })}
            disabled={state.future.length === 0 || locked}
            aria-label={t("editor.redo")}
            className={`${iconButtonClass(false)} disabled:opacity-50`}
          >
            <Redo2 aria-hidden="true" className="size-5" />
            <Tooltip label={t("editor.redo")} />
          </button>
        </div>

        <ValidationPanel
          issues={issues}
          valid={validation?.ok === true}
          saveState={saveState}
        />

        {forMatch && (
          <UseInMatch
            mazeId={id}
            match={forMatch}
            // The server must hold exactly what is on screen before it is
            // submitted, so a pending autosave keeps this disabled.
            ready={validation?.ok === true && saveState === "saved"}
          />
        )}
      </aside>
    </div>
  );
}

/**
 * The number the gate or key tool starts on: the lowest one not yet placed
 * for that tool, or 1 when every one is. Null when the maze has no gates.
 */
function defaultNumber(
  tool: "gate" | "key",
  draft: DraftMaze,
  gateCount: number,
): number | null {
  if (gateCount < 1) return null;
  return lowestUnplaced(tool, draft, gateCount) ?? 1;
}
