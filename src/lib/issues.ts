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

/**
 * A key requires a lowercase first character, at least one dot, and no
 * whitespace. It does not forbid uppercase later in a segment — real keys
 * like `maze.format.coordinateOutOfRange` and `errors.notSignedIn` rely on
 * that being allowed.
 */
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

const FALLBACK_KEY = "errors.validation.invalid";

/**
 * Zod types custom-issue params as `Record<string, any>`, so a caller can put
 * anything in there. next-intl can only interpolate primitives, and a bad
 * value would otherwise surface as a broken message far from the code that
 * produced it — so it is dropped here, loudly in development.
 */
function sanitizeParams(
  raw: Record<string, unknown>,
): Record<string, string | number> | undefined {
  const clean: Record<string, string | number> = {};

  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number") {
      clean[name] = value;
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[issues] dropped non-primitive param "${name}" (${typeof value}); i18n interpolation accepts only strings and numbers`,
      );
    }
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

function issueToTranslatable(issue: ZodIssue): TranslatableIssue {
  // A schema that set no message gets zod's English default. We refuse to
  // forward it — a generic key is worse copy but it is translatable, and the
  // unit test for this behaviour is what keeps schemas honest.
  const key = KEY_SHAPE.test(issue.message) ? issue.message : FALLBACK_KEY;

  const params =
    issue.code === "custom" && issue.params
      ? sanitizeParams(issue.params)
      : undefined;

  return params ? { key, params, path: issue.path } : { key, path: issue.path };
}

export function toTranslatableIssues(cause: unknown): TranslatableIssue[] {
  if (!(cause instanceof ZodError)) return [];
  return cause.issues.map(issueToTranslatable);
}
