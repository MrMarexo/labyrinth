"use client";

import { useTranslations } from "next-intl";
import { useState, type ComponentProps } from "react";

import { changePassword } from "~/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "~/lib/password";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { api } from "~/trpc/react";

const INPUT_CLASS =
  "border-border-strong bg-bg w-full pixel border px-3 py-2 aria-[invalid=true]:border-danger";
const SUBMIT_CLASS =
  "bg-accent text-on-accent pixel px-3 py-2 text-sm disabled:opacity-50";

function textField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

type Status = { ok: true; text: string } | { ok: false; text: string } | null;

function StatusLine({
  status,
  ...rest
}: { status: Status } & Omit<
  ComponentProps<"p">,
  "role" | "className" | "children"
>) {
  if (!status) return null;
  return (
    <p
      {...rest}
      role={status.ok ? "status" : "alert"}
      className={status.ok ? "text-muted text-sm" : "text-danger text-sm"}
    >
      {status.text}
    </p>
  );
}

/** The player's email, which is fixed, and their name, which opponents see. */
export function NameForm() {
  const t = useTranslations("profile");
  const te = useTranslations();
  const utils = api.useUtils();
  const { data } = api.profile.get.useQuery();
  const [status, setStatus] = useState<Status>(null);
  const setName = api.profile.setName.useMutation({
    onSuccess: () => {
      setStatus({ ok: true, text: t("nameSaved") });
      void utils.profile.get.invalidate();
    },
    onError: (error) => {
      const issue = resolveErrorKey(te, error, "errors.unknown");
      setStatus({
        ok: false,
        text: te(issue.key as never, issue.params as never),
      });
    },
  });

  if (!data) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-xl">{t("accountHeading")}</h2>
      <div className="space-y-1">
        <p className="text-muted text-sm">{t("email")}</p>
        <p data-profile-email>{data.email}</p>
      </div>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const name = textField(
            new FormData(event.currentTarget),
            "name",
          ).trim();
          if (!name) {
            setStatus({ ok: false, text: te("errors.fieldRequired") });
            return;
          }
          setStatus(null);
          setName.mutate({ name });
        }}
      >
        <div className="space-y-1">
          <label htmlFor="profile-name" className="block text-sm">
            {t("name")}
          </label>
          <input
            id="profile-name"
            name="name"
            defaultValue={data.name}
            maxLength={80}
            autoComplete="name"
            aria-invalid={status && !status.ok ? true : undefined}
            className={INPUT_CLASS}
          />
          <p className="text-muted text-sm">{t("nameHint")}</p>
        </div>
        <StatusLine status={status} data-name-status="" />
        <button
          type="submit"
          disabled={setName.isPending}
          className={SUBMIT_CLASS}
        >
          {setName.isPending ? t("saving") : t("saveName")}
        </button>
      </form>
    </section>
  );
}

/**
 * Changing the password revokes every other session, so a password changed
 * because it leaked locks the other holder out — once the session cookie
 * cache (`cookieCache` in `~/server/auth`, five minutes) lapses on their
 * side, which is why the hint says "within a few minutes".
 */
export function PasswordForm() {
  const t = useTranslations("profile");
  const ta = useTranslations("auth");
  const te = useTranslations("errors");
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = textField(data, "currentPassword");
    const newPassword = textField(data, "newPassword");

    if (!currentPassword || !newPassword) {
      setStatus({ ok: false, text: te("fieldRequired") });
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        ok: false,
        text: te("passwordTooShort", { min: MIN_PASSWORD_LENGTH }),
      });
      return;
    }

    setStatus(null);
    setPending(true);
    // `null` on success; otherwise Better Auth's code, or none when the
    // request itself failed.
    let failure: string | null;
    try {
      const { error } = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      failure = error ? (error.code ?? "") : null;
    } catch {
      failure = "";
    } finally {
      setPending(false);
    }

    if (failure !== null) {
      setStatus({
        ok: false,
        text:
          failure === "INVALID_PASSWORD"
            ? te("wrongCurrentPassword")
            : failure === "PASSWORD_TOO_SHORT"
              ? te("passwordTooShort", { min: MIN_PASSWORD_LENGTH })
              : te("unknown"),
      });
      return;
    }
    form.reset();
    setStatus({ ok: true, text: t("passwordChanged") });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl">{t("passwordHeading")}</h2>
      <p className="text-muted text-sm">{t("passwordHint")}</p>
      <form noValidate onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="current-password" className="block text-sm">
            {t("currentPassword")}
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="new-password" className="block text-sm">
            {t("newPassword")}
          </label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby="new-password-hint"
            className={INPUT_CLASS}
          />
          <p id="new-password-hint" className="text-muted text-sm">
            {ta("passwordHint", { min: MIN_PASSWORD_LENGTH })}
          </p>
        </div>
        <StatusLine status={status} data-password-status="" />
        <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
          {pending ? t("changing") : t("changePassword")}
        </button>
      </form>
    </section>
  );
}
