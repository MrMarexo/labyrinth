import { useTranslations } from "next-intl";

import { NameForm, PasswordForm } from "~/components/profile/profile-forms";

export default function ProfilePage() {
  const t = useTranslations("profile");

  return (
    <main className="mx-auto max-w-xl space-y-8 p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <NameForm />
      <PasswordForm />
    </main>
  );
}
