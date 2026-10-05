"use client";

import { useTranslations } from "next-intl";

import { Link } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export function MazeList() {
  const t = useTranslations("labyrinths");
  const utils = api.useUtils();
  const { data } = api.maze.list.useQuery();
  const remove = api.maze.remove.useMutation({
    onSuccess: () => utils.maze.list.invalidate(),
  });

  if (!data || data.length === 0) {
    return <p className="text-muted text-sm">{t("empty")}</p>;
  }

  return (
    <ul className="divide-border divide-y">
      {data.map((item) => (
        <li key={item.id} className="flex items-center justify-between py-3">
          <Link href={`/labyrinths/${item.id}`} className="underline">
            {item.name}
          </Link>
          <span className="text-muted text-sm">
            {t("summary", { squares: item.cellCount, gates: item.gateCount })}
          </span>
          <button
            type="button"
            aria-label={t("delete", { name: item.name })}
            onClick={() => remove.mutate({ id: item.id })}
            className="text-danger text-sm underline"
          >
            {t("deleteShort")}
          </button>
        </li>
      ))}
    </ul>
  );
}
