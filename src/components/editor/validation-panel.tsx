"use client";

import { useTranslations } from "next-intl";

import type { TranslatableIssue } from "~/lib/issues";

/**
 * "saving" while the live draft is not yet what the server holds, "saved"
 * once it is, "error" while the last save failed (its banner says why).
 */
export type SaveState = "saving" | "saved" | "error";

export type ValidationPanelProps = {
  issues: TranslatableIssue[];
  valid: boolean;
  saveState: SaveState;
};

const FALLBACK_KEY = "errors.validation.invalid";

export function ValidationPanel({
  issues,
  valid,
  saveState,
}: ValidationPanelProps) {
  const t = useTranslations();

  return (
    <div data-validity={valid ? "valid" : "invalid"} className="space-y-2">
      {!valid && (
        <>
          <p className="text-sm font-medium">{t("editor.notYetValid")}</p>
          <ul className="text-danger space-y-1 text-sm">
            {issues.map((issue, index) => {
              // `TranslatableIssue.key` is only guaranteed key-shaped, not
              // guaranteed to be a key this catalogue actually carries — a
              // server typo would otherwise either throw or leak the bare key
              // to the player. Route anything the catalogue does not
              // recognise through the same generic, translated fallback
              // `src/lib/issues.ts` uses, rather than rendering the key or
              // any hardcoded English text.
              const key = t.has(issue.key as never) ? issue.key : FALLBACK_KEY;
              return (
                <li key={`${issue.key}-${index}`} data-issue={issue.key}>
                  {/* `key` is a runtime string looked up against `t.has`,
                      not a literal from the generated message-key union, so
                      the typed overload of `t` needs a cast here. */}
                  {t(key as never, issue.params as never)}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Always mounted, so a screen reader hears each change to it. On an
          error it is empty: the alert banner above already says so. */}
      <p
        role="status"
        aria-live="polite"
        data-save-state={saveState}
        className={
          saveState === "saved" && !valid
            ? "text-muted flex items-center gap-2 text-xs"
            : "flex items-center gap-2 text-sm"
        }
      >
        {saveState === "saving" && (
          <>
            <Spinner />
            {t("editor.saving")}
          </>
        )}
        {saveState === "saved" &&
          (valid ? t("editor.savedAndReady") : t("editor.saved"))}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 motion-safe:animate-spin"
      fill="none"
    >
      <circle
        cx={8}
        cy={8}
        r={6}
        strokeWidth={2}
        className="stroke-border-strong"
      />
      <path
        d="M 8 2 A 6 6 0 0 1 14 8"
        strokeWidth={2}
        strokeLinecap="round"
        className="stroke-accent"
      />
    </svg>
  );
}
