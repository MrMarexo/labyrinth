/**
 * A run time as a clock reads it. Locale-neutral on purpose: digits and
 * colons read the same in both catalogues, and `Intl.DurationFormat` is not
 * yet in every browser this app supports.
 *
 * `tenths` adds one truncated decimal of seconds, for telling apart two times
 * that a tie-break on time would otherwise show as identical.
 *
 * Runs are asynchronous and can span a day, so hours are not capped at 24.
 */
export function formatElapsed(
  ms: number,
  { tenths = false }: { tenths?: boolean } = {},
): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss =
    String(seconds).padStart(2, "0") +
    (tenths ? `.${Math.floor(ms / 100) % 10}` : "");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}
