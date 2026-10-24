"use client";

import { useQueryClient } from "@tanstack/react-query";
import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Link } from "~/components/link";
import { useRouter } from "~/i18n/navigation";
import { locales } from "~/i18n/routing";
import { signIn, signUp } from "~/lib/auth-client";
import { api } from "~/trpc/react";

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

type Field = "name" | "email" | "password";
type FieldErrorKey = "fieldRequired" | "emailInvalid" | "passwordTooShort";
type FieldErrors = Partial<Record<Field, FieldErrorKey>>;

/**
 * The form's own checks, run before anything is sent. The browser's built-in
 * validation is off (`noValidate`): its bubble is in the browser's language,
 * not the app's, and it skips `minLength` on values a password manager fills
 * in, so a short saved password went straight through. The server enforces
 * the same length (`minPasswordLength` in `~/server/auth`) as the backstop.
 *
 * Sign-in checks the length too: no account's password is shorter, so a short
 * one cannot be right and there is no point sending it.
 */
function validate(
  mode: "sign-in" | "sign-up",
  values: Record<Field, string>,
): FieldErrors {
  const errors: FieldErrors = {};
  if (mode === "sign-up" && !values.name.trim()) errors.name = "fieldRequired";
  if (!values.email.trim()) errors.email = "fieldRequired";
  else if (!/^\S+@\S+\.\S+$/.test(values.email)) errors.email = "emailInvalid";
  if (!values.password) errors.password = "fieldRequired";
  else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = "passwordTooShort";
  }
  return errors;
}

const INPUT_CLASS =
  "border-border-strong bg-bg w-full rounded border px-3 py-2 aria-[invalid=true]:border-danger";

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const tError = useTranslations("errors");
  const router = useRouter();
  const locale = useLocale();
  const setLocale = api.profile.setLocale.useMutation();
  const queryClient = useQueryClient();

  const [errorKey, setErrorKey] = useState<ErrorMessageKey | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    const data = new FormData(event.currentTarget);
    const email = textField(data, "email");
    const password = textField(data, "password");

    const errors = validate(mode, {
      name: textField(data, "name"),
      email,
      password,
    });
    setFieldErrors(errors);
    const firstInvalid = (["name", "email", "password"] as const).find(
      (field) => errors[field],
    );
    if (firstInvalid) {
      event.currentTarget
        .querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)
        ?.focus();
      return;
    }

    setPending(true);

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

    // This form is also reachable while a different account's data is still
    // sitting in the browser's QueryClient singleton (`~/trpc/react`) — the
    // (auth) layout only blocks it for whoever is *currently* signed in, not
    // for whoever a stale session cookie expired out from under. Clearing
    // here closes the same hole as `sign-out-button.tsx`'s, for the entry
    // this form provides to it: signing in as a second account without ever
    // going through sign-out.
    queryClient.clear();

    if (mode === "sign-up") {
      // Signing up in a given locale is a real preference: record it. A
      // failed save must never block registration, so this is
      // fire-and-forget, same as the language switcher.
      void setLocale.mutateAsync({ locale }).catch(() => {
        // A failed preference save must not block registration.
      });
      router.replace("/");
      router.refresh();
      return;
    }

    const stored = result.data?.user.locale;

    if (stored && stored !== locale && hasLocale(locales, stored)) {
      // Signing in on a new browser: adopt the language saved on the
      // account. router.replace also writes the NEXT_LOCALE cookie, so it
      // sticks.
      router.replace("/", { locale: stored });
    } else {
      router.replace("/");
    }

    router.refresh();
  }

  function fieldError(field: Field) {
    const key = fieldErrors[field];
    if (!key) return null;
    return (
      <p
        id={`${field}-error`}
        data-password-error={field === "password" ? "" : undefined}
        className="text-danger text-sm"
      >
        {tError(key, { min: MIN_PASSWORD_LENGTH })}
      </p>
    );
  }

  function describedBy(field: Field, hint?: string) {
    const ids = [hint, fieldErrors[field] ? `${field}-error` : undefined];
    return ids.filter(Boolean).join(" ") || undefined;
  }

  const passwordHint = mode === "sign-up" ? "password-hint" : undefined;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mx-auto max-w-sm space-y-4 p-8"
    >
      <h1 className="text-2xl font-bold">
        {mode === "sign-up" ? t("signUpTitle") : t("signInTitle")}
      </h1>

      {errorKey && (
        <p role="alert" className="text-danger text-sm">
          {tError(errorKey, { min: MIN_PASSWORD_LENGTH })}
        </p>
      )}

      {mode === "sign-up" && (
        <div className="space-y-1">
          <label htmlFor="name" className="block text-sm">
            {t("name")}
          </label>
          <input
            id="name"
            name="name"
            required
            autoComplete="name"
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            className={INPUT_CLASS}
          />
          {fieldError("name")}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm">
          {t("email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy("email")}
          className={INPUT_CLASS}
        />
        {fieldError("email")}
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm">
          {t("password")}
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete={
              mode === "sign-up" ? "new-password" : "current-password"
            }
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={describedBy("password", passwordHint)}
            className={`${INPUT_CLASS} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            aria-controls="password"
            className="text-muted hover:text-fg absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r"
          >
            <EyeIcon crossed={showPassword} />
          </button>
        </div>
        {passwordHint && (
          <p id={passwordHint} className="text-muted text-sm">
            {t("passwordHint", { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
        {fieldError("password")}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-on-accent w-full rounded px-3 py-2 disabled:opacity-50"
      >
        {mode === "sign-up" ? t("signUpSubmit") : t("signInSubmit")}
      </button>

      <Link
        href={mode === "sign-up" ? "/sign-in" : "/sign-up"}
        className="block text-sm"
      >
        {mode === "sign-up" ? t("haveAccount") : t("needAccount")}
      </Link>
    </form>
  );
}
