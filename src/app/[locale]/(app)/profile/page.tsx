import { getLocale, getTranslations } from "next-intl/server";

import { NameForm, PasswordForm } from "~/components/profile/profile-forms";
import { redirect } from "~/i18n/navigation";
import { api } from "~/trpc/server";

export default async function ProfilePage() {
  // A guest has no profile to edit; signing up gives them one.
  const viewer = await api.viewer.get();
  if (viewer.kind === "guest") {
    redirect({ href: "/sign-up", locale: await getLocale() });
  }

  const t = await getTranslations("profile");

  return (
    <main className="mx-auto max-w-xl space-y-8 p-8">
      <h1 className="text-3xl">{t("title")}</h1>
      <NameForm />
      <PasswordForm />
    </main>
  );
}
