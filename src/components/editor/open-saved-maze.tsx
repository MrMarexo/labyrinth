"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { useReplaceConcept } from "~/components/editor/replace-concept";
import { useRouter } from "~/i18n/navigation";
import { api } from "~/trpc/react";

/**
 * Opens a saved labyrinth as the author's concept when that would delete a
 * different one: the page found it would, so this asks first. Agreeing
 * opens the editor; keeping the concept goes back to the list, since the
 * saved labyrinth is never shown outside the editor.
 */
export function OpenSavedMaze({ id }: { id: string }) {
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  const edit = api.maze.editAsConcept.useMutation({
    onSuccess: ({ id: conceptId }) => {
      void utils.maze.list.invalidate();
      router.replace(`/labyrinths/${conceptId}`);
    },
  });
  const { error, dialog } = useReplaceConcept({
    ...edit,
    reset: () => router.replace("/labyrinths"),
  });

  const { mutate } = edit;
  useEffect(() => mutate({ id }), [id, mutate]);

  return (
    <>
      {error && (
        <p role="alert" data-edit-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
      {dialog}
    </>
  );
}
