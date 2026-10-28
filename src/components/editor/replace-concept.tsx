"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";

import { resolveErrorKey, type ResolvableError } from "~/lib/resolve-error-key";

/**
 * For a mutation that replaces the author's concept: when it is refused
 * because they already have one, asks in a popup and repeats it with
 * `replace: true` once they agree. Returns the popup to render and any
 * other error, resolved to a key.
 */
export function useReplaceConcept<V extends { replace?: boolean }>(mutation: {
  error: ResolvableError | null;
  variables: V | undefined;
  mutate: (variables: V) => void;
  reset: () => void;
}) {
  const te = useTranslations();
  const { error, variables } = mutation;
  const asking = error?.message === "errors.conceptExists";
  const name = error?.data?.issues?.[0]?.params?.name;

  return {
    error:
      error && !asking ? resolveErrorKey(te, error, "errors.unknown") : null,
    dialog:
      asking && variables ? (
        <ReplaceConcept
          name={typeof name === "string" ? name : undefined}
          onConfirm={() => mutation.mutate({ ...variables, replace: true })}
          onKeep={mutation.reset}
        />
      ) : null,
  };
}

/**
 * Asks before the author's concept is deleted to make way for a new one. A
 * native modal `<dialog>`, like the run's finish popup: it takes focus and
 * closes on Escape, which counts as keeping the concept. Confirming clears
 * the refusal, which unmounts it: the caller's button shows the progress.
 */
function ReplaceConcept({
  name,
  onConfirm,
  onKeep,
}: {
  name: string | undefined;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("concept");
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      data-replace-concept
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onKeep}
      className="bg-bg text-fg border-border-strong backdrop:bg-fg/40 pixel m-auto w-[min(24rem,calc(100vw-2rem))] space-y-4 border p-6"
    >
      <h2 id={titleId} className="text-xl">
        {t("replaceTitle")}
      </h2>
      <p>{name ? t("replaceBody", { name }) : t("replaceBodyUnnamed")}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="border-danger text-danger pixel border px-3 py-2 text-sm"
        >
          {t("replaceConfirm")}
        </button>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="border-border-strong pixel border px-3 py-2 text-sm"
        >
          {t("replaceCancel")}
        </button>
      </div>
    </dialog>
  );
}
