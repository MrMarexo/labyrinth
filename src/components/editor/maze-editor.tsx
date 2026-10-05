"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { TranslatableIssue } from "~/lib/issues";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import {
  INCOMPLETE_DRAFT_KEY,
  cellsUsed,
  draftToMaze,
  editorReducer,
  gatesPlaced,
  initialEditorState,
  keysPlaced,
  validateMaze,
  type DraftMaze,
  type Edge,
  type Point,
  type Tool,
} from "~/maze";
import { api } from "~/trpc/react";
import { Board } from "./board";
import { DetailTools } from "./detail-tools";
import { ShapeTools } from "./shape-tools";
import { ValidationPanel } from "./validation-panel";

const AUTOSAVE_MS = 800;

export type MazeEditorProps = {
  id: string;
  initial: DraftMaze;
  cellCount: number;
  gateCount: number;
};

export function MazeEditor({
  id,
  initial,
  cellCount,
  gateCount,
}: MazeEditorProps) {
  const t = useTranslations();
  // Invariant the first-render guard below depends on: `lastSentRef` and the
  // reducer's initial draft must be seeded from this exact same `initial`
  // object, never a copy of it — the guard is a reference-equality check,
  // and a copy here would make it fire on the very first render.
  const [state, dispatch] = useReducer(
    editorReducer,
    initial,
    initialEditorState,
  );
  const [tool, setTool] = useState<Tool>("paint");
  const saveDraft = api.maze.saveDraft.useMutation();

  // `locked` and `saveError` are read from render; everything else here is
  // bookkeeping for the autosave pipeline below and lives in refs so that
  // updating it never itself triggers a render.
  const [locked, setLocked] = useState(false);
  const [saveError, setSaveError] = useState<TranslatableIssue | null>(null);

  // The draft last known to match what the server has. Updated only on a
  // *successful* save (never optimistically before the response), so a
  // failed save leaves it pointing at the old value — which is what lets the
  // very next edit's autosave resend the lost work instead of the gap going
  // unnoticed forever.
  const lastSentRef = useRef<DraftMaze>(initial);
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
  // Mirrors `state.draft` so the pipeline below always reads the live draft
  // rather than a value some earlier closure captured.
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  function send(draft: DraftMaze) {
    savingRef.current = true;
    saveDraft.mutate(
      { id, data: draft },
      {
        onSuccess: () => {
          lastSentRef.current = draft;
          if (mountedRef.current) setSaveError(null);
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
        },
        onError: (error) => {
          if (!mountedRef.current) return;
          const resolved = resolveErrorKey(t, error, "editor.saveFailed");
          // A maze can only reach this state once Phase 3 adds submission —
          // nothing in this phase ever sets a maze's status to "submitted" —
          // but the rule ("mazes are never edited once finished") has to
          // hold the day that becomes reachable, not the day someone
          // remembers to add a check for it.
          if (resolved.key === "errors.mazeIsSubmitted") setLocked(true);
          setSaveError(resolved);
          // Deliberately no corrective send here: `lastSentRef` stays at its
          // old value on a failure, so a blind recheck would find the live
          // draft still "different" forever and retry the same rejected
          // content in a tight loop. `pendingRef` below still only reflects
          // a genuinely new edit queued elsewhere while this attempt was in
          // flight — never the content that just failed.
        },
        onSettled: () => {
          savingRef.current = false;
          // Deliberately unguarded by `mountedRef`: a queued send must still
          // reach the server after the author has navigated away, or it is
          // simply lost. Only the UI feedback above is skipped post-unmount.
          if (pendingRef.current) {
            pendingRef.current = false;
            maybeSend();
          }
        },
      },
    );
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

  // Autosave. Debounced at AUTOSAVE_MS: every edit resets the timer, so a
  // burst of clicks produces one request after the author pauses, not one
  // per click.
  useEffect(() => {
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
  }, [state.draft]);

  // Unmount only (empty deps): flush whatever the debounce above hasn't sent
  // yet, rather than losing up to AUTOSAVE_MS of drawing to a navigation.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      maybeSendRef.current();
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
    : [{ key: INCOMPLETE_DRAFT_KEY }];

  function onCell(at: Point) {
    if (locked) return;
    switch (tool) {
      case "paint":
        return dispatch({ type: "paintCell", at });
      case "erase-cell":
        return dispatch({ type: "eraseCell", at });
      case "start":
        return dispatch({ type: "placeStart", at });
      case "treasure":
        return dispatch({ type: "placeTreasure", at });
      case "key": {
        const gate = nextKeylessGate(state.draft);
        return gate === null
          ? undefined
          : dispatch({ type: "placeKey", at, gate });
      }
      case "erase":
        return dispatch({ type: "removeKey", at });
      default:
        return undefined;
    }
  }

  function onEdge(edge: Edge) {
    if (locked) return;
    if (tool === "wall")
      return dispatch({ type: "placeSegment", edge, kind: "wall" });
    if (tool === "gate")
      return dispatch({ type: "placeSegment", edge, kind: "gate" });
    if (tool === "erase") return dispatch({ type: "removeSegment", edge });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Board
        draft={state.draft}
        onCell={onCell}
        onEdge={onEdge}
        edgesActive={tool === "wall" || tool === "gate" || tool === "erase"}
      />

      <aside className="space-y-6">
        <ShapeTools
          tool={tool}
          onTool={setTool}
          used={cellsUsed(state.draft)}
          budget={cellCount}
        />
        <DetailTools
          tool={tool}
          onTool={setTool}
          gates={gatesPlaced(state.draft)}
          gateBudget={gateCount}
          keys={keysPlaced(state.draft)}
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
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: "undo" })}
            disabled={state.past.length === 0 || locked}
            className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("editor.undo")}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "redo" })}
            disabled={state.future.length === 0 || locked}
            className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("editor.redo")}
          </button>
        </div>

        <ValidationPanel issues={issues} valid={validation?.ok === true} />
      </aside>
    </div>
  );
}

/** The lowest gate id that has no key yet, so the key tool knows what to place. */
function nextKeylessGate(draft: DraftMaze): number | null {
  const withKeys = new Set(draft.keys.map((k) => k.gate));
  const gates = draft.segments
    .filter((s) => s.kind === "gate")
    .map((s) => s.gate)
    .sort((a, b) => a - b);
  return gates.find((g) => !withKeys.has(g)) ?? null;
}
