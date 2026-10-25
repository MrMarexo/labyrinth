"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { OptionPicker } from "~/components/option-picker";
import { useReplaceConcept } from "~/components/editor/replace-concept";
import {
  CELL_COUNT_PRESETS,
  GATE_COUNT_OPTIONS,
  MAZE_LIMIT,
  savedCount,
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
  const create = api.maze.createConcept.useMutation({
    onSuccess: ({ id }) => {
      void utils.maze.list.invalidate();
      router.push(`/labyrinths/${id}`);
    },
  });
  // Same query as the list below, so this costs no extra request.
  const { data: mazes } = api.maze.list.useQuery();
  const { error: createError, dialog } = useReplaceConcept(create);
  const kept = mazes ? savedCount(mazes) : 0;
  const atLimit = kept >= MAZE_LIMIT;

  const counts = mazes && (
    <span data-maze-count className="text-muted text-sm">
      {t("count", { count: kept, limit: MAZE_LIMIT })}
    </span>
  );
  const limitNote = atLimit && (
    <p className="text-muted text-sm">{t("atLimit", { limit: MAZE_LIMIT })}</p>
  );

  if (!open) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("new")}
          </button>
          {counts}
        </div>
        {limitNote}
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

      {limitNote}

      {createError && (
        <p role="alert" data-create-error className="text-danger text-sm">
          {te(createError.key as never, createError.params as never)}
        </p>
      )}

      <button
        type="submit"
        disabled={create.isPending || create.isSuccess}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {t("create")}
      </button>

      {dialog}
    </form>
  );
}
