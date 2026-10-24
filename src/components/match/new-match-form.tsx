"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";

import { Link } from "~/components/link";
import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { MATCH_ACCESS, type MatchAccess } from "~/match";
import { CELL_COUNT_PRESETS, MAX_GATES, type CellCount } from "~/maze";
import { api } from "~/trpc/react";

const ACCESS_COPY = {
  open: { label: "accessOpen", hint: "accessOpenHint" },
  locked: { label: "accessLocked", hint: "accessLockedHint" },
} as const satisfies Record<MatchAccess, { label: string; hint: string }>;

/**
 * The New match form, or — since a player hosts one waiting match at a time
 * — a note pointing at the one they already have.
 */
export function NewMatchForm() {
  const t = useTranslations("matches");
  const { data: mine, isPending } = api.match.list.useQuery();

  // Same test as `match.create`'s: a waiting match past its deadline no
  // longer counts, and creating closes it.
  const waiting = mine?.find(
    (m) =>
      m.status === "awaiting_opponent" && m.deadlineAt.getTime() > Date.now(),
  );

  if (isPending) return null;
  if (waiting) {
    return (
      <div
        data-already-waiting
        className="border-border-strong space-y-2 rounded border p-4"
      >
        <h2 className="text-xl font-semibold">{t("createHeading")}</h2>
        <p className="text-sm">{t("alreadyWaiting")}</p>
        <Link href={`/matches/${waiting.id}`} className="text-sm">
          {t("alreadyWaitingLink")}
        </Link>
      </div>
    );
  }
  return <CreateMatchForm />;
}

function CreateMatchForm() {
  const t = useTranslations("matches");
  const te = useTranslations();
  const router = useRouter();
  const buttonRefs = useRef(new Map<CellCount, HTMLButtonElement>());
  const [cellCount, setCellCount] = useState<CellCount>(CELL_COUNT_PRESETS[0]);
  const [access, setAccess] = useState<MatchAccess>("open");

  const utils = api.useUtils();
  const create = api.match.create.useMutation({
    onSuccess: ({ id }) => {
      void utils.match.list.invalidate();
      router.push(`/matches/${id}`);
    },
  });
  const createError = create.isError
    ? resolveErrorKey(te, create.error, "errors.unknown")
    : null;

  const activeIndex = CELL_COUNT_PRESETS.indexOf(cellCount);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  // Same roving-tabIndex radiogroup as shape-tools.tsx: one tab stop, all
  // four arrow keys cycle regardless of layout, and selecting moves both the
  // checked state and DOM focus together.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (tabStopIndex + 1) % CELL_COUNT_PRESETS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex =
          (tabStopIndex - 1 + CELL_COUNT_PRESETS.length) %
          CELL_COUNT_PRESETS.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = CELL_COUNT_PRESETS[nextIndex]!;
    setCellCount(next);
    buttonRefs.current.get(next)?.focus();
  }

  return (
    <form
      className="border-border-strong space-y-3 rounded border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        create.mutate({
          cellCount,
          gateCount: Number(data.get("gateCount")),
          access,
        });
      }}
    >
      <h2 className="text-xl font-semibold">{t("createHeading")}</h2>

      <div className="space-y-1">
        <span id="new-match-size-label" className="text-sm">
          {t("size")}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="new-match-size-label"
          className="flex flex-wrap gap-2"
        >
          {CELL_COUNT_PRESETS.map((option, index) => {
            const active = cellCount === option;
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
                onClick={() => setCellCount(option)}
                onKeyDown={handleKeyDown}
                className={radioClass(active)}
              >
                {t("sizeOption", { cells: option })}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-sm">{t("gates")}</span>
        <input
          name="gateCount"
          type="number"
          min={0}
          max={MAX_GATES}
          defaultValue={2}
          className="border-border-strong bg-bg w-full rounded border px-3 py-2"
        />
      </label>

      {/* Native radios: the browser's own arrow-key handling is enough for
          two options, each of which needs its hint read with it. */}
      <fieldset className="space-y-2">
        <legend className="text-sm">{t("access")}</legend>
        {MATCH_ACCESS.map((option) => (
          <label key={option} className="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value={option}
              checked={access === option}
              onChange={() => setAccess(option)}
              aria-describedby={`new-match-access-${option}-hint`}
              className="accent-accent mt-1"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">
                {t(ACCESS_COPY[option].label)}
              </span>
              <span
                id={`new-match-access-${option}-hint`}
                className="text-muted block text-sm"
              >
                {t(ACCESS_COPY[option].hint)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {createError && (
        <p role="alert" data-create-error className="text-danger text-sm">
          {te(createError.key as never, createError.params as never)}
        </p>
      )}

      <button
        type="submit"
        disabled={create.isPending}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {create.isPending ? t("creating") : t("create")}
      </button>
    </form>
  );
}

function radioClass(active: boolean): string {
  return active
    ? "bg-accent text-on-accent rounded px-3 py-2 text-sm"
    : "border-border-strong rounded border px-3 py-2 text-sm";
}
