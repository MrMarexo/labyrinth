"use client";

import { useTranslations } from "next-intl";

export type ConfirmUseProps = {
  name: string;
  pending: boolean;
  /** False while the choice cannot be used yet, e.g. an unsaved edit. */
  ready?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The last step before the lobby's picker puts a labyrinth into a match: it
 * says what submitting costs, since a submitted labyrinth can never be
 * edited again.
 */
export function ConfirmUse({
  name,
  pending,
  ready = true,
  onConfirm,
  onCancel,
}: ConfirmUseProps) {
  const t = useTranslations("lobby");
  return (
    <div data-confirm-use className="space-y-2">
      <p>{t("confirmSubmit", { name })}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !ready}
          onClick={onConfirm}
          className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
        >
          {pending ? t("submitting") : t("confirmYes")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
        >
          {t("confirmNo")}
        </button>
      </div>
    </div>
  );
}
