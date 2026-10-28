"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { MazeFilters } from "~/components/editor/maze-filters";
import {
  DEFAULT_LIBRARY_VIEW,
  filterAndSort,
  sizeOptions,
} from "~/components/editor/maze-library";

import { MazeTile, mazeTileClass } from "~/components/maze-tile";
import { PixelIcon } from "~/components/pixel-icons";
import { iconButtonClass, Tooltip } from "~/components/tooltip";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { Link } from "~/components/link";
import { api } from "~/trpc/react";

export function MazeList() {
  const t = useTranslations("labyrinths");
  const te = useTranslations();
  const utils = api.useUtils();
  const { data, isPending } = api.maze.list.useQuery();
  const locale = useLocale();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [chosen, setChosen] = useState(DEFAULT_LIBRARY_VIEW);
  const remove = api.maze.remove.useMutation({
    onSuccess: () => {
      setConfirmingId(null);
      void utils.maze.list.invalidate();
    },
  });

  if (isPending) return null;
  if (!data || data.length === 0) {
    return <p className="text-muted text-sm">{t("empty")}</p>;
  }

  // The concept sits on top, outside the filters: it is not one of the
  // saved labyrinths they narrow down.
  const concept = data.find((m) => m.state === "concept") ?? null;
  const saved = data.filter((m) => m.state !== "concept");

  // A size filter whose last labyrinth was just deleted falls back to "any"
  // rather than leaving an empty list nobody asked for.
  const sizes = sizeOptions(saved);
  const view = {
    ...chosen,
    squares: sizes.squares.includes(chosen.squares as number)
      ? chosen.squares
      : ("any" as const),
    gates: sizes.gates.includes(chosen.gates as number)
      ? chosen.gates
      : ("any" as const),
  };
  const shown = filterAndSort(saved, view, locale);

  function tile(item: (typeof saved)[number]) {
    const pending = remove.isPending && remove.variables?.id === item.id;
    const deleteError =
      remove.isError && remove.variables?.id === item.id
        ? resolveErrorKey(te, remove.error, "errors.unknown")
        : null;
    const href = `/labyrinths/${item.id}`;

    return (
      <li key={item.id} data-maze-item={item.id} className={mazeTileClass()}>
        <MazeTile
          maze={item.preview}
          name={
            // Not prefetched: the prefetch would cache the editor page
            // with the draft as it is now, and a save still landing from
            // the editor just left would be missing when it opens.
            <Link href={href} prefetch={false} className="truncate">
              {item.name}
            </Link>
          }
          // The preview opens the labyrinth too; the name link above is
          // its accessible name, so this one is hidden from the a11y tree
          // and the tab order rather than announced twice.
          wrapPreview={(preview) => (
            <Link
              href={href}
              prefetch={false}
              tabIndex={-1}
              aria-hidden="true"
              className="block"
            >
              {preview}
            </Link>
          )}
        />
        {item.state === "concept" && (
          <span data-concept-badge>{t("conceptBadge")}</span>
        )}
        {item.state === "used" && (
          <span data-used-badge className="text-muted flex items-center gap-1">
            <PixelIcon name="lock" className="size-5" />
            {t("usedBadge")}
          </span>
        )}
        <span data-maze-summary className="text-muted flex items-center gap-3">
          <span className="sr-only">
            {t("summary", {
              squares: item.cellCount,
              gates: item.gateCount,
            })}
          </span>
          {/* A square and the gate tool's icon. */}
          <span aria-hidden="true" className="flex items-center gap-1">
            <PixelIcon name="square" className="size-5" />
            {item.cellCount}
          </span>
          <span aria-hidden="true" className="flex items-center gap-1">
            <PixelIcon name="gate" className="size-5" />
            {item.gateCount}
          </span>
        </span>

        {confirmingId === item.id && item.state === "used" && (
          <p className="text-muted">{t("deleteUsedHint")}</p>
        )}
        {confirmingId === item.id ? (
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={t("confirmDelete", { name: item.name })}
              disabled={pending}
              onClick={() => remove.mutate({ id: item.id })}
              className="text-danger underline disabled:opacity-50"
            >
              {pending ? t("deleting") : t("confirmDeleteShort")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingId(null)}
              className="underline disabled:opacity-50"
            >
              {t("deleteCancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={t("delete", { name: item.name })}
            onClick={() => setConfirmingId(item.id)}
            className={`${iconButtonClass(false)} self-start`}
          >
            <PixelIcon name="trash" className="size-5" />
            <Tooltip label={t("deleteShort")} />
          </button>
        )}

        {deleteError && (
          <p role="alert" data-delete-error className="text-danger">
            {te(deleteError.key as never, deleteError.params as never)}
          </p>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {concept && (
        <ul data-concept className="flex flex-wrap gap-4">
          {tile(concept)}
        </ul>
      )}
      {saved.length > 0 && (
        <MazeFilters view={view} sizes={sizes} onChange={setChosen} />
      )}
      {saved.length === 0 ? null : shown.length === 0 ? (
        <p className="text-muted text-sm">{t("noMatches")}</p>
      ) : (
        <ul data-library className="flex flex-wrap gap-4">
          {shown.map(tile)}
        </ul>
      )}
    </div>
  );
}
