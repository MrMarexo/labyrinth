"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link, useRouter } from "~/i18n/navigation";
import { signIn, signUp } from "~/lib/auth-client";

const MIN_PASSWORD_LENGTH = 10;

type ErrorMessageKey =
  "invalidCredentials" | "emailTaken" | "passwordTooShort" | "unknown";

// Better Auth 1.7.5's duplicate-email code is USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL,
// not the shorter USER_ALREADY_EXISTS also present in auth.$ERROR_CODES.
function messageKeyFor(code: string | undefined): ErrorMessageKey {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "invalidCredentials";
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "emailTaken";
    case "PASSWORD_TOO_SHORT":
      return "passwordTooShort";
    default:
      return "unknown";
  }
}

function textField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const tError = useTranslations("errors");
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<ErrorMessageKey | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorKey(null);

    const data = new FormData(event.currentTarget);
    const email = textField(data, "email");
    const password = textField(data, "password");

    const result =
      mode === "sign-up"
        ? await signUp.email({
            email,
            password,
            name: textField(data, "name"),
          })
        : await signIn.email({ email, password });

    setPending(false);

    if (result.error) {
      setErrorKey(messageKeyFor(result.error.code));
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="text-2xl font-bold">
        {mode === "sign-up" ? t("signUpTitle") : t("signInTitle")}
      </h1>

      {errorKey && (
        <p role="alert" className="text-danger text-sm">
          {tError(errorKey, { min: MIN_PASSWORD_LENGTH })}
        </p>
      )}

      {mode === "sign-up" && (
        <label className="block space-y-1">
          <span className="text-sm">{t("name")}</span>
          <input
            name="name"
            required
            autoComplete="name"
            className="border-border bg-bg w-full rounded border px-3 py-2"
          />
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-sm">{t("email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="border-border bg-bg w-full rounded border px-3 py-2"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm">{t("password")}</span>
        <input
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete={
            mode === "sign-up" ? "new-password" : "current-password"
          }
          className="border-border bg-bg w-full rounded border px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-on-accent w-full rounded px-3 py-2 disabled:opacity-50"
      >
        {mode === "sign-up" ? t("signUpSubmit") : t("signInSubmit")}
      </button>

      <Link
        href={mode === "sign-up" ? "/sign-in" : "/sign-up"}
        className="block text-sm underline"
      >
        {mode === "sign-up" ? t("haveAccount") : t("needAccount")}
      </Link>
    </form>
  );
}
