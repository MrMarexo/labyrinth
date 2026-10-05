"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

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
    <ul className="divide-border divide-y">
      {data.map((item) => {
        const pending = remove.isPending && remove.variables?.id === item.id;
        const deleteError =
          remove.isError && remove.variables?.id === item.id
            ? resolveErrorKey(te, remove.error, "errors.unknown")
            : null;

        return (
          <li key={item.id} className="flex flex-col gap-1 py-3">
            <div className="flex items-center justify-between gap-3">
              <Link href={`/labyrinths/${item.id}`} className="underline">
                {item.name}
              </Link>
              <span className="text-muted text-sm">
                {t("summary", {
                  squares: item.cellCount,
                  gates: item.gateCount,
                })}
              </span>

              {confirmingId === item.id ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={t("confirmDelete", { name: item.name })}
                    disabled={pending}
                    onClick={() => remove.mutate({ id: item.id })}
                    className="text-danger text-sm underline disabled:opacity-50"
                  >
                    {pending ? t("deleting") : t("confirmDeleteShort")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmingId(null)}
                    className="text-sm underline disabled:opacity-50"
                  >
                    {t("deleteCancel")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={t("delete", { name: item.name })}
                  onClick={() => setConfirmingId(item.id)}
                  className="text-danger text-sm underline"
                >
                  {t("deleteShort")}
                </button>
              )}
            </div>

            {deleteError && (
              <p role="alert" data-delete-error className="text-danger text-sm">
                {te(deleteError.key as never, deleteError.params as never)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
