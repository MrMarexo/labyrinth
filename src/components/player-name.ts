import { useTranslations } from "next-intl";

/** Another player's name as shown: guests are stored as a bare number. */
export function usePlayerName() {
  const t = useTranslations("players");
  return (p: { name: string; guest: boolean }) =>
    p.guest ? t("guestName", { number: p.name }) : p.name;
}
