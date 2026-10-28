"use client";

import { useTranslations } from "next-intl";

import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { MAZE_LIMIT, savedCount } from "~/maze";
import { api } from "~/trpc/react";

/**
 * Puts the concept in the author's library once it is valid and saved: a
 * new labyrinth, or the changes to the one it was opened from. Then back to
 * the library, where it now is. `UseInMatch`'s counterpart for a concept
 * not opened from a match.
 */
export function SaveConcept({
  conceptId,
  version,
  ready,
  editsSaved,
}: {
  conceptId: string;
  /** The server's version of what is on screen, read at click time. */
  version: () => number;
  ready: boolean;
  /** Writes back into a saved labyrinth, so the limit does not apply. */
  editsSaved: boolean;
}) {
  const t = useTranslations("editor");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  const { data: mazes } = api.maze.list.useQuery();
  const save = api.maze.saveConcept.useMutation({
    onSuccess: async () => {
      await utils.maze.list.invalidate();
      router.push("/labyrinths");
    },
  });
  const error = save.isError
    ? resolveErrorKey(te, save.error, "errors.unknown")
    : null;
  // Pending until the library has replaced this page.
  const pending = save.isPending || save.isSuccess;
  const kept = mazes ? savedCount(mazes) : 0;
  const atLimit = !editsSaved && kept >= MAZE_LIMIT;

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-save-concept
        disabled={!ready || pending || atLimit}
        onClick={() =>
          save.mutate({ id: conceptId, expectedVersion: version() })
        }
        className="bg-accent text-on-accent pixel px-3 py-2 text-sm disabled:opacity-50"
      >
        {pending ? t("savingLabyrinth") : t("saveLabyrinth")}
      </button>
      {atLimit && (
        <p className="text-muted text-sm">
          {t("saveAtLimit", { limit: MAZE_LIMIT })}
        </p>
      )}
      {error && (
        <p role="alert" data-save-concept-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </div>
  );
}
