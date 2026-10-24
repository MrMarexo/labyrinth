"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { OptionPicker } from "~/components/option-picker";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import {
  CELL_COUNT_PRESETS,
  GATE_COUNT_OPTIONS,
  MAZE_LIMIT,
  type CellCount,
  type GateCount,
} from "~/maze";
import { useRouter } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export function NewMazeForm() {
  const t = useTranslations("labyrinths");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [cellCount, setCellCount] = useState<CellCount>(CELL_COUNT_PRESETS[0]);
  const [gateCount, setGateCount] = useState<GateCount>(2);
  const create = api.maze.createDraft.useMutation({
    onSuccess: ({ id }) => {
      void utils.maze.list.invalidate();
      router.push(`/labyrinths/${id}`);
    },
  });
  // Same query as the list below, so this costs no extra request.
  const { data: mazes } = api.maze.list.useQuery();
  const createError = create.isError
    ? resolveErrorKey(te, create.error, "errors.unknown")
    : null;
  const kept = mazes?.length ?? 0;
  const atLimit = kept >= MAZE_LIMIT;

  if (!open || atLimit) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={atLimit}
            onClick={() => setOpen(true)}
            className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("new")}
          </button>
          {mazes && (
            <span data-maze-count className="text-muted text-sm">
              {t("count", { count: kept, limit: MAZE_LIMIT })}
            </span>
          )}
        </div>
        {atLimit && (
          <p className="text-muted text-sm">
            {t("atLimit", { limit: MAZE_LIMIT })}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="border-border-strong space-y-3 rounded border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const name = data.get("name");
        create.mutate({
          name: typeof name === "string" ? name : "",
          cellCount,
          gateCount,
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm">{t("name")}</span>
        <input
          name="name"
          required
          maxLength={80}
          className="border-border-strong bg-bg w-full rounded border px-3 py-2"
        />
      </label>

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
        {t("create")}
      </button>
    </form>
  );
}
