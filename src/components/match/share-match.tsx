"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const SHOWN_MS = 4000;

/**
 * Shares the join link for a locked match: the native share sheet where
 * there is one (phones), the clipboard otherwise. Dismissing the share sheet
 * is not a failure and says nothing.
 */
export function ShareMatch({ matchId }: { matchId: string }) {
  const t = useTranslations("lobby");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  // Shown until the next attempt: it is the only way left to get the link.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    const url = `${location.origin}/${locale}/matches/${matchId}/join`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: t("shareTitle"),
          text: t("shareText"),
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Refused for some other reason (no user gesture, a blocked
        // permission): the clipboard still works.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setFailedUrl(null);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailedUrl(url);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-share-match
        onClick={() => void share()}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm"
      >
        {t("share")}
      </button>
      <p role="status" className="text-muted text-sm">
        {copied
          ? t("linkCopied")
          : failedUrl && t("copyFailed", { url: failedUrl })}
      </p>
    </div>
  );
}
