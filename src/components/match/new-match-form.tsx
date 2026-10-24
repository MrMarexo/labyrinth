"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link } from "~/components/link";
import { useActiveMatch } from "~/components/match/match-list";
import { OptionPicker } from "~/components/option-picker";
import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { MATCH_ACCESS, type MatchAccess } from "~/match";
import {
  CELL_COUNT_PRESETS,
  GATE_COUNT_OPTIONS,
  type CellCount,
  type GateCount,
} from "~/maze";
import { api } from "~/trpc/react";

const ACCESS_COPY = {
  open: { label: "accessOpen", hint: "accessOpenHint" },
  locked: { label: "accessLocked", hint: "accessLockedHint" },
} as const satisfies Record<MatchAccess, { label: string; hint: string }>;

/**
 * The New match form, or — since a player is in one match at a time — a
 * note saying why not. Their own waiting match gets a link; any other is
 * already linked from `CurrentMatch` at the top of the page.
 */
export function NewMatchForm() {
  const t = useTranslations("matches");
  const { active, isPending } = useActiveMatch();

  if (isPending) return null;
  if (active?.status === "awaiting_opponent") {
    return (
      <div
        data-already-waiting
        className="border-border-strong space-y-2 rounded border p-4"
      >
        <h2 className="text-xl font-semibold">{t("createHeading")}</h2>
        <p className="text-sm">{t("alreadyWaiting")}</p>
        <Link href={`/matches/${active.id}`} className="text-sm">
          {t("alreadyWaitingLink")}
        </Link>
      </div>
    );
  }
  if (active) {
    return (
      <div
        data-already-active
        className="border-border-strong space-y-2 rounded border p-4"
      >
        <h2 className="text-xl font-semibold">{t("createHeading")}</h2>
        <p className="text-sm">{t("alreadyActive")}</p>
      </div>
    );
  }
  return <CreateMatchForm />;
}

function CreateMatchForm() {
  const t = useTranslations("matches");
  const te = useTranslations();
  const router = useRouter();
  const [cellCount, setCellCount] = useState<CellCount>(CELL_COUNT_PRESETS[0]);
  const [gateCount, setGateCount] = useState<GateCount>(2);
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

  return (
    <form
      className="border-border-strong space-y-3 rounded border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ cellCount, gateCount, access });
      }}
    >
      <h2 className="text-xl font-semibold">{t("createHeading")}</h2>

      <OptionPicker
        label={t("size")}
        options={CELL_COUNT_PRESETS}
        value={cellCount}
        onChange={setCellCount}
        renderOption={(cells) => t("sizeOption", { cells })}
      />

      <OptionPicker
        label={t("gates")}
        options={GATE_COUNT_OPTIONS}
        value={gateCount}
        onChange={setGateCount}
      />

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
