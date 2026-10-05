import type { useTranslations } from "next-intl";

import type { TranslatableIssue } from "~/lib/issues";

type Translator = ReturnType<typeof useTranslations>;

type ResolvableError = {
  message: string;
  data?: { issues?: TranslatableIssue[] } | null;
};

/**
 * Resolves a tRPC error to a translatable key. `error.data.issues` —
 * `src/server/api/trpc.ts`'s errorFormatter, built for exactly this — is
 * always a real key when present; `error.message` is a last resort, since
 * for most rejections (any zod input failure) it is a stringified ZodError,
 * not a key at all. `fallback` covers whichever of those two resolves to
 * nothing the catalogue recognises.
 */
export function resolveErrorKey(
  t: Translator,
  error: ResolvableError,
  fallback: string,
): TranslatableIssue {
  const issue = error.data?.issues?.[0];
  const key = issue?.key ?? error.message;
  if (!t.has(key as never)) return { key: fallback };
  return issue ?? { key };
}
