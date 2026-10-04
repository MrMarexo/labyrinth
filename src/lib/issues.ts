import { ZodError, type ZodIssue } from "zod";

/**
 * A validation failure expressed as a message key plus its interpolation
 * parameters. Never an English sentence: the client translates it, and the
 * same issue must read correctly in English and Slovak.
 */
export type TranslatableIssue = {
  key: string;
  params?: Record<string, string | number>;
  path?: (string | number)[];
};

/** A key looks like `namespace.some.key` — lowercase start, dot-separated. */
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

const FALLBACK_KEY = "errors.validation.invalid";

function issueToTranslatable(issue: ZodIssue): TranslatableIssue {
  // A schema that set no message gets zod's English default. We refuse to
  // forward it — a generic key is worse copy but it is translatable, and the
  // unit test for this behaviour is what keeps schemas honest.
  const key = KEY_SHAPE.test(issue.message) ? issue.message : FALLBACK_KEY;

  const params =
    issue.code === "custom" && issue.params
      ? (issue.params as Record<string, string | number>)
      : undefined;

  return params ? { key, params, path: issue.path } : { key, path: issue.path };
}

export function toTranslatableIssues(cause: unknown): TranslatableIssue[] {
  if (!(cause instanceof ZodError)) return [];
  return cause.issues.map(issueToTranslatable);
}
