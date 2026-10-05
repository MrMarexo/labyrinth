"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { resolveErrorKey } from "~/lib/resolve-error-key";
import { CELL_COUNT_PRESETS, MAX_GATES } from "~/maze";
import { useRouter } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export function NewMazeForm() {
  const t = useTranslations("labyrinths");
  const te = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = api.maze.createDraft.useMutation({
    onSuccess: ({ id }) => router.push(`/labyrinths/${id}`),
  });
  const createError = create.isError
    ? resolveErrorKey(te, create.error, "errors.unknown")
    : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm"
      >
        {t("new")}
      </button>
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
          cellCount: Number(data.get("cellCount")),
          gateCount: Number(data.get("gateCount")),
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

      <label className="block space-y-1">
        <span className="text-sm">{t("squares")}</span>
        <select
          name="cellCount"
          defaultValue={CELL_COUNT_PRESETS[0]}
          className="border-border-strong bg-bg w-full rounded border px-3 py-2"
        >
          {CELL_COUNT_PRESETS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

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
