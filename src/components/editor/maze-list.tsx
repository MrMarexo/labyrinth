"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { MazeTile, mazeTileClass } from "~/components/maze-tile";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { Link } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export function MazeList() {
  const t = useTranslations("labyrinths");
  const te = useTranslations();
  const utils = api.useUtils();
  const { data, isPending } = api.maze.list.useQuery();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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

  return (
    <ul className="flex flex-wrap gap-4">
      {data.map((item) => {
        const pending = remove.isPending && remove.variables?.id === item.id;
        const deleteError =
          remove.isError && remove.variables?.id === item.id
            ? resolveErrorKey(te, remove.error, "errors.unknown")
            : null;
        const href = `/labyrinths/${item.id}`;

        return (
          <li
            key={item.id}
            data-maze-item={item.id}
            className={mazeTileClass()}
          >
            <MazeTile
              maze={item.preview}
              name={
                // Not prefetched: the prefetch would cache the editor page
                // with the draft as it is now, and a save still landing from
                // the editor just left would be missing when it opens.
                <Link
                  href={href}
                  prefetch={false}
                  className="truncate font-medium underline"
                >
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
            <span className="text-muted">
              {t("summary", {
                squares: item.cellCount,
                gates: item.gateCount,
              })}
            </span>

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
                className="text-danger self-start underline"
              >
                {t("deleteShort")}
              </button>
            )}

            {deleteError && (
              <p role="alert" data-delete-error className="text-danger">
                {te(deleteError.key as never, deleteError.params as never)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
