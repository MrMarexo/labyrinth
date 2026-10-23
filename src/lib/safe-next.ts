/**
 * A post-sign-in redirect target from the query string. Only same-origin
 * paths pass; anything that could resolve to another host is dropped.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value?.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
