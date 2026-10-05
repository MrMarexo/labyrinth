"use client";

import { useTranslations } from "next-intl";

import type { TranslatableIssue } from "~/lib/issues";

export type ValidationPanelProps = {
  issues: TranslatableIssue[];
  valid: boolean;
};

const FALLBACK_KEY = "errors.validation.invalid";

export function ValidationPanel({ issues, valid }: ValidationPanelProps) {
  const t = useTranslations();

  if (valid) {
    return (
      <p data-validity="valid" className="text-sm">
        {t("editor.valid")}
      </p>
    );
  }

  return (
    <div data-validity="invalid" className="space-y-2">
      <p className="text-sm font-medium">{t("editor.notYetValid")}</p>
      <ul className="text-danger space-y-1 text-sm">
        {issues.map((issue, index) => {
          // `TranslatableIssue.key` is only guaranteed key-shaped, not
          // guaranteed to be a key this catalogue actually carries — a server
          // typo would otherwise either throw or leak the bare key to the
          // player. Route anything the catalogue does not recognise through
          // the same generic, translated fallback `src/lib/issues.ts` uses,
          // rather than rendering the key or any hardcoded English text.
          const key = t.has(issue.key as never) ? issue.key : FALLBACK_KEY;
          return (
            <li key={`${issue.key}-${index}`} data-issue={issue.key}>
              {/* `key` is a runtime string looked up against `t.has`, not a
                  literal from the generated message-key union, so the typed
                  overload of `t` needs a cast here. */}
              {t(key as never, issue.params as never)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
