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
  // URL parsers strip tab, CR and LF, so "/\t/evil" would become "//evil".
  if (/[\u0000-\u001f]/.test(value) || /[\u0000-\u001f]/.test(decoded)) {
    return null;
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return null;
  return value;
}
