# Labyrinth Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the application skeleton — a deployable Next.js app where a
person can register, sign in, sign out, switch between English and Slovak, and
switch between light and dark, with the database, test harness and CI pipeline
that every later phase depends on.

**Architecture:** A single Next.js App Router application scaffolded from
`create-t3-app`, talking to Neon Postgres through Drizzle over a WebSocket pool.
Authentication is Better Auth with email and password against the same database.
Routing is locale-prefixed (`/en/...`, `/sk/...`) via `next-intl` middleware.
Testing splits three ways by what each layer can actually prove: Vitest in a Node
environment for pure logic, Vitest against a real Neon branch for anything
touching the database, and Playwright for anything involving a browser. There is
deliberately no jsdom or React Testing Library — UI behaviour is proved in a real
browser or not at all.

**Tech Stack:** Node 24, pnpm 11, Next.js (App Router), TypeScript strict, tRPC,
Tailwind v4, Drizzle ORM, `@neondatabase/serverless` (WebSocket pool), Better
Auth, next-intl, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-22-labyrinth-design.md`

## Global Constraints

These apply to every task in this plan and every later phase. They are copied
from the spec; where a number appears, it is exact.

- **Node 24, pnpm 11.** The repository uses pnpm. Never run `npm install`.
- **TypeScript strict**, plus `noUncheckedIndexedAccess`. No `any`. No
  `@ts-expect-error` without a comment naming the reason.
- **`src/maze/` imports nothing** from Next, tRPC, Drizzle or React. It does not
  exist yet — Phase 1 creates it — but the ESLint rule that enforces it is added
  in Task 8 of this plan, so it is impossible to violate from the first commit.
- **Locales are `en` and `sk`.** `en` is the source and the fallback. Every
  user-visible string lives in a message catalogue; none are hardcoded in a
  component.
- **Validation failures travel as i18n message keys with parameters, never as
  English strings.** This applies to zod errors surfaced through tRPC.
- **Database access uses `drizzle-orm/neon-serverless` with `Pool`**, never
  `drizzle-orm/neon-http`. The HTTP driver cannot open an interactive
  transaction, and later phases require one. See spec §5.1.
- **Every task ends with a commit.** Conventional Commits format.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Prerequisites

Before Task 1, the developer needs a Neon account with one project created, and
its pooled connection string. Two Neon branches are used: `main` for eventual
production, and a personal development branch whose URL goes in `.env`.

---

### Task 1: Scaffold the application and the unit test harness

**Files:**

- Create: the `create-t3-app` output at the repository root
- Create: `vitest.config.ts`
- Create: `src/lib/cn.ts`
- Create: `.prettierrc`
- Test: `tests/unit/cn.test.ts`
- Modify: `.gitignore`, `package.json`, `tsconfig.json`

**Interfaces:**

- Consumes: nothing.
- Produces: `cn(...inputs: ClassValue[]): string` from `~/lib/cn`, used by every
  component in every later task. The `~/*` path alias resolving to `src/*`. The
  scripts `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`.

The repository already contains `.git`, `.gitignore` and `docs/`, so
`create-t3-app` cannot scaffold directly into it — it refuses a non-empty
directory. Scaffold into a temporary directory and copy the result across.

- [ ] **Step 1: Scaffold into a temporary directory**

```bash
SCAFFOLD_DIR="$(mktemp -d)"
cd "$SCAFFOLD_DIR"
pnpm create t3-app@latest labyrinth \
  --CI \
  --appRouter \
  --trpc \
  --tailwind \
  --drizzle \
  --dbProvider postgres \
  --eslint \
  --noGit \
  --noInstall
```

Note the absence of an auth flag. `--CI` treats every unspecified option as off,
so NextAuth is not installed. That is intended — we use Better Auth (Task 5).

- [ ] **Step 2: Copy the scaffold into the repository**

```bash
cd /Users/marexander/Coding/labyrinth
rsync -a --exclude='.git' "$SCAFFOLD_DIR/labyrinth/" ./
pnpm install
```

`rsync` overwrites `.gitignore` with the scaffold's, which is the better one — it
covers `node_modules`, `.next`, `.env` and `.vercel` already.

- [ ] **Step 3: Verify the scaffold is what we asked for**

```bash
node -e "const p=require('./package.json');const d={...p.dependencies,...p.devDependencies};const want=['@trpc/server','drizzle-orm','tailwindcss','@t3-oss/env-nextjs'];const bad=['next-auth','@auth/core','@prisma/client'];const missing=want.filter(k=>!d[k]);const present=bad.filter(k=>d[k]);if(missing.length||present.length){console.error('missing:',missing,'unwanted:',present);process.exit(1)}console.log('scaffold ok')"
```

Expected: `scaffold ok`.

If `next-auth` is present, the `--CI` flag set was not honoured by this version
of the CLI. Remove it before continuing:
`pnpm remove next-auth && rm -rf src/server/auth`.

- [ ] **Step 4: Tighten the TypeScript configuration**

In `tsconfig.json`, inside `compilerOptions`, confirm or add:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "checkJs": true
}
```

- [ ] **Step 5: Add Prettier and the project scripts**

```bash
pnpm add -D prettier prettier-plugin-tailwindcss vitest vite-tsconfig-paths
pnpm add clsx tailwind-merge
```

Create `.prettierrc`:

```json
{
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

In `package.json`, add to `scripts`:

```json
{
  "typecheck": "tsc --noEmit",
  "format": "prettier --write \"**/*.{ts,tsx,js,jsx,md,json,css}\"",
  "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,md,json,css}\"",
  "test": "vitest run --config vitest.config.ts"
}
```

- [ ] **Step 6: Configure Vitest for Node-environment unit tests**

Create `vitest.config.ts`:

```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

`tests/integration/**` is deliberately excluded — those need a database and get
their own config in Task 4.

- [ ] **Step 7: Write the failing test**

Create `tests/unit/cn.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { cn } from "~/lib/cn";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-2", "font-bold")).toBe("px-2 font-bold");
  });

  it("drops falsy values", () => {
    expect(cn("px-2", false, null, undefined, "font-bold")).toBe(
      "px-2 font-bold",
    );
  });

  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
```

The third case is the reason this utility exists rather than a plain `join`, and
it also proves `tailwind-merge` is wired up.

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm test`

Expected: FAIL — `Failed to resolve import "~/lib/cn"`.

- [ ] **Step 9: Write the minimal implementation**

Create `src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 10: Run the full verification**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm build
```

Expected: tests PASS, no type errors, no lint errors, build succeeds.

`pnpm build` needs `DATABASE_URL` set. Create `.env` from `.env.example` with
your Neon development branch URL before running it.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
chore: scaffold Next.js app with tRPC, Tailwind and Drizzle

Scaffolded from create-t3-app without an auth provider; Better Auth is
added separately. Adds Prettier, Vitest in a Node environment, and the cn
class-name helper.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Internationalisation foundation

**Files:**

- Create: `src/i18n/routing.ts`, `src/i18n/navigation.ts`, `src/i18n/request.ts`
- Create: `messages/en.json`, `messages/sk.json`
- Create: `src/middleware.ts`
- Create: `global.d.ts`
- Create: `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`
- Delete: `src/app/layout.tsx`, `src/app/page.tsx`
- Modify: `next.config.js`
- Test: `tests/unit/i18n-catalogues.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks beyond the scaffold.
- Produces: `locales` (readonly `["en", "sk"]`) and `routing` from
  `~/i18n/routing`; `Link`, `redirect`, `usePathname`, `useRouter`,
  `getPathname` from `~/i18n/navigation` — every later task uses these instead
  of the `next/link` and `next/navigation` equivalents, because they carry the
  locale prefix. Every page moves under `src/app/[locale]/`.

- [ ] **Step 1: Install next-intl**

```bash
pnpm add next-intl
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/i18n-catalogues.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import sk from "../../messages/sk.json";

type Catalogue = Record<string, unknown>;

function flatten(value: Catalogue, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? flatten(child as Catalogue, path)
      : [path];
  });
}

function valuesOf(value: Catalogue, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? valuesOf(child as Catalogue, path)
      : [[path, child] as [string, unknown]];
  });
}

describe("message catalogues", () => {
  it("sk has exactly the same keys as en", () => {
    expect(flatten(sk as Catalogue).sort()).toEqual(
      flatten(en as Catalogue).sort(),
    );
  });

  it("has no empty or whitespace-only strings", () => {
    for (const catalogue of [en, sk] as Catalogue[]) {
      for (const [path, value] of valuesOf(catalogue)) {
        expect(typeof value, `${path} must be a string`).toBe("string");
        expect(String(value).trim(), `${path} must not be empty`).not.toBe("");
      }
    }
  });
});
```

This is the test that stops the Slovak catalogue quietly rotting behind the
English one as later phases add strings.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test tests/unit/i18n-catalogues.test.ts`

Expected: FAIL — cannot resolve `../../messages/en.json`.

- [ ] **Step 4: Create the message catalogues**

Create `messages/en.json`:

```json
{
  "app": {
    "name": "Labyrinth",
    "tagline": "Draw a maze. Solve theirs. Fewest walls hit wins."
  },
  "nav": {
    "signIn": "Sign in",
    "signUp": "Sign up",
    "signOut": "Sign out"
  },
  "theme": {
    "label": "Theme",
    "system": "System",
    "light": "Light",
    "dark": "Dark"
  },
  "locale": {
    "label": "Language",
    "en": "English",
    "sk": "Slovenčina"
  }
}
```

Create `messages/sk.json`:

```json
{
  "app": {
    "name": "Labyrint",
    "tagline": "Nakresli bludisko. Vyrieš súperovo. Vyhráva najmenej nárazov."
  },
  "nav": {
    "signIn": "Prihlásiť sa",
    "signUp": "Registrovať sa",
    "signOut": "Odhlásiť sa"
  },
  "theme": {
    "label": "Vzhľad",
    "system": "Systémový",
    "light": "Svetlý",
    "dark": "Tmavý"
  },
  "locale": {
    "label": "Jazyk",
    "en": "English",
    "sk": "Slovenčina"
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/unit/i18n-catalogues.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 6: Configure routing and navigation**

Create `src/i18n/routing.ts`:

```ts
import { defineRouting } from "next-intl/routing";

export const locales = ["en", "sk"] as const;

export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
});
```

Create `src/i18n/navigation.ts`:

```ts
import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

Create `src/i18n/request.ts`:

```ts
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (
      (await import(`../../messages/${locale}.json`)) as {
        default: Record<string, unknown>;
      }
    ).default,
  };
});
```

- [ ] **Step 7: Add the middleware and the Next.js plugin**

Create `src/middleware.ts`:

```ts
import createMiddleware from "next-intl/middleware";

import { routing } from "~/i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
```

The matcher excludes `api`, which matters — the Better Auth routes added in
Task 5 must not be locale-prefixed.

In `next.config.js`, wrap the exported config:

```js
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import("next").NextConfig} */
const config = {};

export default withNextIntl(config);
```

- [ ] **Step 8: Move the app under a locale segment**

```bash
mkdir -p src/app/[locale]
git mv src/app/page.tsx "src/app/[locale]/page.tsx"
git rm src/app/layout.tsx
```

Create `src/app/[locale]/layout.tsx`:

```tsx
import "~/styles/globals.css";

import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { type ReactNode } from "react";

import { routing } from "~/i18n/routing";
import { TRPCReactProvider } from "~/trpc/react";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`TRPCReactProvider` came from the root layout that this file replaces. It must
be carried over — without it, any `api.*.useMutation()` in a client component
throws at runtime rather than at build time, and Task 7 is the first thing that
would hit it.

Replace `src/app/[locale]/page.tsx` with:

```tsx
import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("app");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">{t("name")}</h1>
      <p className="mt-2">{t("tagline")}</p>
    </main>
  );
}
```

- [ ] **Step 9: Add typed message keys**

Create `global.d.ts` at the repository root:

```ts
import type messages from "./messages/en.json";
import type { routing } from "./src/i18n/routing";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
```

This turns a mistyped key into a compile error rather than a runtime blank.

- [ ] **Step 10: Verify**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

Then run `pnpm dev` and check by hand that `http://localhost:3000/` redirects to
`/en`, that `/en` shows the English tagline, and that `/sk` shows the Slovak one.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
feat: add English and Slovak locale routing

Adds next-intl with an always-on locale prefix, typed message keys, and a
test asserting the Slovak catalogue has exactly the same keys as English
so it cannot silently fall behind.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Theming, application shell, and the browser test harness

**Files:**

- Modify: `src/styles/globals.css`
- Create: `src/components/theme-script.tsx`, `src/components/theme-toggle.tsx`
- Create: `src/components/locale-switcher.tsx`
- Create: `src/components/site-header.tsx`
- Modify: `src/app/[locale]/layout.tsx`
- Create: `playwright.config.ts`
- Test: `e2e/appearance.spec.ts`

**Interfaces:**

- Consumes: `Link`, `usePathname`, `useRouter`, `locales` (Task 2). Use `cn`
  from Task 1 for any conditional class list; the components below have none.
- Produces: the colour tokens `--color-bg`, `--color-fg`, `--color-muted`,
  `--color-border`, `--color-accent` as Tailwind utilities (`bg-bg`, `text-fg`,
  `border-border`, and so on) — later phases add maze-specific tokens beside
  them. `<SiteHeader />`, rendered by every page. `pnpm e2e`.

- [ ] **Step 1: Define the colour tokens**

Replace the contents of `src/styles/globals.css`:

```css
@import "tailwindcss";

:root {
  --bg: oklch(99% 0 0);
  --fg: oklch(22% 0 0);
  --muted: oklch(55% 0 0);
  --border: oklch(90% 0 0);
  --accent: oklch(55% 0.18 260);
  --danger: oklch(55% 0.19 25);
}

:root[data-theme="dark"] {
  --bg: oklch(18% 0 0);
  --fg: oklch(95% 0 0);
  --muted: oklch(65% 0 0);
  --border: oklch(32% 0 0);
  --accent: oklch(70% 0.16 260);
  --danger: oklch(68% 0.17 25);
}

@theme inline {
  --color-bg: var(--bg);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-danger: var(--danger);
}

body {
  background-color: var(--bg);
  color: var(--fg);
}
```

Every colour in the application comes from these tokens. A raw hex value in a
component is a bug — it will not follow the theme.

- [ ] **Step 2: Write the failing browser test**

Create `e2e/appearance.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.describe("appearance", () => {
  test("applies the stored theme before the page paints", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "dark");
    });

    const themes: (string | null)[] = [];
    await page.exposeFunction("recordTheme", (value: string | null) => {
      themes.push(value);
    });
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        void (
          window as unknown as {
            recordTheme: (v: string | null) => Promise<void>;
          }
        ).recordTheme(document.documentElement.getAttribute("data-theme"));
      });
    });

    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(themes).toEqual(["dark"]);
  });

  test("theme choice survives a reload", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("switching language keeps you on the same page", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Labyrinth",
    );

    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Labyrint",
    );
  });
});
```

The first test is the one worth having: it asserts the theme attribute is
already correct at `DOMContentLoaded`, which is what "no flash of the wrong
theme" actually means. A test that only checks the attribute after load would
pass even with a visible flash.

- [ ] **Step 3: Install Playwright and configure it**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium webkit
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

Two projects from the start, because the spec commits to the app being usable on
a phone and a mobile regression found in Phase 6 is far more expensive than one
found now.

Add to `package.json` scripts:

```json
{
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui"
}
```

Append to `.gitignore`:

```
/test-results/
/playwright-report/
/blob-report/
/playwright/.cache/
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm e2e e2e/appearance.spec.ts --project=desktop`

Expected: FAIL — no `Theme` combobox on the page.

- [ ] **Step 5: Add the no-flash theme script**

Create `src/components/theme-script.tsx`:

```tsx
const script = `(function(){try{var s=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",s==="light"||s==="dark"?s:(d?"dark":"light"));}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
```

This must be inline and in `<head>`. A React effect runs after the first paint,
which is exactly the flash we are preventing. The `try`/`catch` matters: reading
`localStorage` throws in a browser with site data blocked, and without the catch
the page would render unthemed.

- [ ] **Step 6: Add the theme toggle**

Create `src/components/theme-toggle.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";

function apply(choice: Choice) {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  try {
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {
    // Site data blocked; the choice applies for this page view only.
  }
}

export function ThemeToggle() {
  const t = useTranslations("theme");
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") setChoice(stored);
    } catch {
      // Ignore; "system" is the correct fallback.
    }
  }, []);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        className="border-border bg-bg rounded border px-2 py-1"
        value={choice}
        onChange={(event) => {
          const next = event.target.value as Choice;
          setChoice(next);
          apply(next);
        }}
      >
        <option value="system">{t("system")}</option>
        <option value="light">{t("light")}</option>
        <option value="dark">{t("dark")}</option>
      </select>
    </label>
  );
}
```

- [ ] **Step 7: Add the locale switcher**

Create `src/components/locale-switcher.tsx`:

```tsx
"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "~/i18n/navigation";
import { locales, type Locale } from "~/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        className="border-border bg-bg rounded border px-2 py-1"
        disabled={pending}
        value={locale}
        onChange={(event) => {
          const next = event.target.value as Locale;
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {t(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
```

`usePathname` from `~/i18n/navigation` returns the path _without_ the locale
prefix, which is what makes "stay on the same page" work.

- [ ] **Step 8: Add the site header and mount everything**

Create `src/components/site-header.tsx`:

```tsx
import { useTranslations } from "next-intl";

import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { Link } from "~/i18n/navigation";

export function SiteHeader() {
  const t = useTranslations("app");

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        {t("name")}
      </Link>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
```

Update `src/app/[locale]/layout.tsx` — add the script to `<head>` and the header
above `{children}`:

```tsx
import "~/styles/globals.css";

import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { type ReactNode } from "react";

import { SiteHeader } from "~/components/site-header";
import { ThemeScript } from "~/components/theme-script";
import { routing } from "~/i18n/routing";
import { TRPCReactProvider } from "~/trpc/react";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-fg min-h-dvh">
        <NextIntlClientProvider>
          <TRPCReactProvider>
            <SiteHeader />
            {children}
          </TRPCReactProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm e2e e2e/appearance.spec.ts`

Expected: PASS, 6 tests (3 specs × 2 projects).

- [ ] **Step 10: Full verification**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
feat: add theming, site header and the Playwright harness

Colour tokens drive light and dark from CSS variables, applied by an inline
script before first paint. Adds desktop and mobile Playwright projects, with
a test that asserts the theme is correct at DOMContentLoaded rather than
merely after load.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Database connection and the integration test harness

**Files:**

- Modify: `src/env.js`
- Create: `src/server/db/index.ts`, `src/server/db/schema/index.ts`
- Modify: `drizzle.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `.env.example`
- Test: `tests/integration/db.test.ts`

**Interfaces:**

- Consumes: `env` from `~/env` (scaffolded in Task 1).
- Produces: `db` from `~/server/db`, the Drizzle client every later task queries
  through. `src/server/db/schema/index.ts` as the single barrel that
  `drizzle-kit` reads — every later phase adds its tables by re-exporting from
  here. The scripts `pnpm db:generate`, `pnpm db:migrate`,
  `pnpm test:integration`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/db.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";

describe("database connection", () => {
  it("answers a trivial query", async () => {
    const result = await db.execute<{ one: number }>(sql`select 1 as one`);
    expect(result.rows[0]?.one).toBe(1);
  });

  it("supports interactive transactions", async () => {
    const value = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      return "committed";
    });
    expect(value).toBe("committed");
  });

  it("rolls a failed transaction back", async () => {
    await db.execute(sql`create temporary table rollback_probe (n int)`);

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into rollback_probe values (1)`);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
  });
});
```

The second and third tests exist for one reason. `drizzle-orm/neon-http` cannot
open an interactive transaction, and the spec requires the move row and the
updated run state to commit atomically (spec §5.1, §7). If someone later
"optimises" the driver to HTTP for cold-start time, these fail immediately
instead of the bug surfacing as an occasional miscounted penalty — which is the
score.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --config vitest.integration.config.ts`

Expected: FAIL — no such config file.

- [ ] **Step 3: Add the environment variables**

In `src/env.js`, under `server`, confirm or add:

```js
DATABASE_URL: z.string().url(),
```

Create `.env.example`:

```bash
# Neon — use a personal development branch, never the main branch.
# Copy the POOLED connection string from the Neon dashboard.
DATABASE_URL="postgresql://user:password@ep-example-pooler.eu-central-1.aws.neon.tech/labyrinth?sslmode=require"
```

- [ ] **Step 4: Create the database client**

Create `src/server/db/schema/index.ts`:

```ts
// Single barrel for every table in the application. drizzle-kit reads this
// file, so a table that is not re-exported here gets no migration.
export {};
```

Create `src/server/db/index.ts`:

```ts
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { env } from "~/env";
import * as schema from "./schema";

// Node has no global WebSocket in every runtime we target; the browser and
// edge runtimes do. Only polyfill when it is missing.
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

// Reuse the pool across hot reloads in development, otherwise every save leaks
// a pool and Neon starts refusing connections.
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ?? new Pool({ connectionString: env.DATABASE_URL });

if (env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
```

```bash
pnpm add ws
pnpm add -D @types/ws
```

- [ ] **Step 5: Configure drizzle-kit**

Replace `drizzle.config.ts`:

```ts
import { type Config } from "drizzle-kit";

import { env } from "~/env";

export default {
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: env.DATABASE_URL },
} satisfies Config;
```

Add to `package.json` scripts:

```json
{
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "test:integration": "vitest run --config vitest.integration.config.ts"
}
```

- [ ] **Step 6: Configure the integration test runner**

Create `vitest.integration.config.ts`:

```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // These share one database. Running files in parallel makes failures
    // depend on interleaving, which is not a debuggable state to be in.
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: "test" },
  },
});
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm test:integration
```

Expected: PASS, 3 tests. Requires `.env` with a working `DATABASE_URL`.

- [ ] **Step 8: Full verification and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: connect to Neon through a Drizzle WebSocket pool

Uses drizzle-orm/neon-serverless rather than neon-http because later phases
need interactive transactions to commit a move and its run state atomically.
Integration tests assert transaction support directly so a regression to the
HTTP driver fails loudly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Better Auth server configuration

**Files:**

- Modify: `src/env.js`, `.env.example`
- Create: `src/server/auth/index.ts`
- Create: `src/server/db/schema/auth.ts` (generated)
- Modify: `src/server/db/schema/index.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Modify: `src/server/api/trpc.ts`
- Test: `tests/integration/auth.test.ts`

**Interfaces:**

- Consumes: `db` (Task 4).
- Produces: `auth` from `~/server/auth`, with `auth.api.getSession`,
  `auth.api.signUpEmail`, `auth.api.signInEmail`. The type `Session`.
  `protectedProcedure` in `~/server/api/trpc` — every later authenticated
  procedure builds on it, and `ctx.session.user.id` is non-null inside one. The
  `user` table gains a `locale` column used by Task 7.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { auth } from "~/server/auth";

function uniqueEmail() {
  return `test-${crypto.randomUUID()}@example.test`;
}

describe("email and password authentication", () => {
  it("registers a user and issues a session", async () => {
    const email = uniqueEmail();

    const result = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
      asResponse: true,
    });

    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("better-auth");
  });

  it("rejects a password below the minimum length", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: uniqueEmail(), password: "short", name: "Test Person" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a wrong password for an existing account", async () => {
    const email = uniqueEmail();
    await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
    });

    await expect(
      auth.api.signInEmail({
        body: { email, password: "wrong-password-here" },
      }),
    ).rejects.toThrow();
  });

  it("defaults a new user's locale to en", async () => {
    const email = uniqueEmail();
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
    });

    expect((signUp.user as { locale?: string }).locale).toBe("en");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration tests/integration/auth.test.ts`

Expected: FAIL — cannot resolve `~/server/auth`.

- [ ] **Step 3: Add the environment variables**

```bash
pnpm add better-auth
```

In `src/env.js`, under `server`:

```js
BETTER_AUTH_SECRET: z.string().min(32),
BETTER_AUTH_URL: z.string().url(),
```

Append to `.env.example`:

```bash
# Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET="replace-me-with-32-bytes-of-base64"
BETTER_AUTH_URL="http://localhost:3000"
```

- [ ] **Step 4: Write the auth configuration**

Create `src/server/auth/index.ts`:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "~/env";
import { db } from "~/server/db";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      locale: {
        type: "string",
        defaultValue: "en",
        required: false,
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
```

`input: false` on `locale` means a client cannot set it during sign-up. Task 7
updates it through a dedicated procedure instead.

- [ ] **Step 5: Generate and apply the schema**

```bash
pnpm dlx @better-auth/cli@latest generate --output src/server/db/schema/auth.ts --y
```

Re-export it so `drizzle-kit` sees the tables — replace
`src/server/db/schema/index.ts`:

```ts
// Single barrel for every table in the application. drizzle-kit reads this
// file, so a table that is not re-exported here gets no migration.
export * from "./auth";
```

Then generate and apply the migration:

```bash
pnpm db:generate
pnpm db:migrate
```

Read the generated SQL in `drizzle/` before applying it. Confirm it creates
`user`, `session`, `account` and `verification`, and that `user` has a `locale`
column defaulting to `'en'`.

- [ ] **Step 6: Mount the auth route handler**

Create `src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "~/server/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

This sits outside `src/app/[locale]/` on purpose — authentication endpoints are
not locale-prefixed, which is why the Task 2 middleware matcher excludes `api`.

- [ ] **Step 7: Put the session in the tRPC context**

In `src/server/api/trpc.ts`, replace the context creator and add a protected
procedure:

```ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({ headers: opts.headers });
  return { db, session, headers: opts.headers };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "errors.notSignedIn",
    });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
```

The message is `errors.notSignedIn`, a message key, not a sentence. That is the
global constraint about i18n keys, applied from the first error the app can
throw. Task 6 adds the matching catalogue entries.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test:integration tests/integration/auth.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 9: Full verification and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add Better Auth with email and password

Database-backed sessions through the Drizzle adapter, a 10-character minimum
password, and a locale column on the user that clients cannot set directly.
Adds protectedProcedure, whose unauthorised error carries a message key rather
than English text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Registration, sign-in and sign-out

**Files:**

- Create: `src/lib/auth-client.ts`
- Create: `src/app/[locale]/(auth)/sign-up/page.tsx`
- Create: `src/app/[locale]/(auth)/sign-in/page.tsx`
- Create: `src/components/auth-form.tsx`
- Create: `src/components/sign-out-button.tsx`
- Modify: `src/components/site-header.tsx`
- Modify: `messages/en.json`, `messages/sk.json`
- Test: `e2e/auth.spec.ts`

**Interfaces:**

- Consumes: `auth` (Task 5); `Link`, `useRouter`, `locales` (Task 2).
- Produces: `authClient` from `~/lib/auth-client` with `signIn.email`,
  `signUp.email`, `signOut`, `useSession`. The routes `/[locale]/sign-in` and
  `/[locale]/sign-up`.

- [ ] **Step 1: Write the failing test**

Create `e2e/auth.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const PASSWORD = "correct-horse-battery";

test.describe("authentication", () => {
  test("a person can register, sign out, and sign back in", async ({
    page,
  }) => {
    const email = uniqueEmail();

    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a wrong password shows a translated error", async ({ page }) => {
    const email = uniqueEmail();

    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.goto("/sk/sign-in");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo").fill("definitely-not-it");
    await page.getByRole("button", { name: "Prihlásiť sa" }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "Nesprávny e-mail alebo heslo.",
    );
  });
});
```

The second test is the one that earns its place: it proves the error path is
translated, which is the requirement that quietly fails in most applications.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm e2e e2e/auth.spec.ts --project=desktop`

Expected: FAIL — `/en/sign-up` returns 404.

- [ ] **Step 3: Add the message catalogue entries**

Add to `messages/en.json`:

```json
{
  "auth": {
    "name": "Name",
    "email": "Email",
    "password": "Password",
    "signUpTitle": "Create an account",
    "signInTitle": "Sign in",
    "signUpSubmit": "Sign up",
    "signInSubmit": "Sign in",
    "haveAccount": "Already have an account?",
    "needAccount": "Need an account?"
  },
  "errors": {
    "notSignedIn": "You need to sign in to do that.",
    "invalidCredentials": "Wrong email or password.",
    "emailTaken": "That email is already registered.",
    "passwordTooShort": "Password must be at least {min} characters.",
    "unknown": "Something went wrong. Please try again."
  }
}
```

Add to `messages/sk.json`:

```json
{
  "auth": {
    "name": "Meno",
    "email": "E-mail",
    "password": "Heslo",
    "signUpTitle": "Vytvoriť účet",
    "signInTitle": "Prihlásenie",
    "signUpSubmit": "Registrovať sa",
    "signInSubmit": "Prihlásiť sa",
    "haveAccount": "Už máte účet?",
    "needAccount": "Nemáte účet?"
  },
  "errors": {
    "notSignedIn": "Na túto akciu sa musíte prihlásiť.",
    "invalidCredentials": "Nesprávny e-mail alebo heslo.",
    "emailTaken": "Tento e-mail je už zaregistrovaný.",
    "passwordTooShort": "Heslo musí mať aspoň {min} znakov.",
    "unknown": "Niečo sa pokazilo. Skúste to znova."
  }
}
```

Run `pnpm test` — the catalogue parity test from Task 2 must still pass.

- [ ] **Step 4: Create the auth client**

Create `src/lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 5: Build the shared auth form**

Create `src/components/auth-form.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "~/i18n/navigation";
import { signIn, signUp } from "~/lib/auth-client";

const MIN_PASSWORD_LENGTH = 10;

/** Maps Better Auth error codes onto message keys. Never surface the raw code. */
function messageKeyFor(code: string | undefined): string {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "invalidCredentials";
    case "USER_ALREADY_EXISTS":
      return "emailTaken";
    case "PASSWORD_TOO_SHORT":
      return "passwordTooShort";
    default:
      return "unknown";
  }
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const tError = useTranslations("errors");
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorKey(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    const result =
      mode === "sign-up"
        ? await signUp.email({
            email,
            password,
            name: String(data.get("name")),
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
        className="bg-accent w-full rounded px-3 py-2 text-white disabled:opacity-50"
      >
        {mode === "sign-up" ? t("signUpSubmit") : t("signInSubmit")}
      </button>
    </form>
  );
}
```

`messageKeyFor` is the boundary that keeps English out of the UI: the server's
error code goes in, a message key comes out, and the component translates it.

- [ ] **Step 6: Add the pages and the sign-out button**

Create `src/app/[locale]/(auth)/sign-up/page.tsx`:

```tsx
import { AuthForm } from "~/components/auth-form";

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
```

Create `src/app/[locale]/(auth)/sign-in/page.tsx`:

```tsx
import { AuthForm } from "~/components/auth-form";

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
```

Create `src/components/sign-out-button.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";

import { useRouter } from "~/i18n/navigation";
import { signOut } from "~/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("nav");
  const router = useRouter();

  return (
    <button
      type="button"
      className="text-sm underline"
      onClick={async () => {
        await signOut();
        router.replace("/");
        router.refresh();
      }}
    >
      {t("signOut")}
    </button>
  );
}
```

- [ ] **Step 7: Show the right controls in the header**

Replace `src/components/site-header.tsx`:

```tsx
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "~/components/locale-switcher";
import { SignOutButton } from "~/components/sign-out-button";
import { ThemeToggle } from "~/components/theme-toggle";
import { Link } from "~/i18n/navigation";
import { auth } from "~/server/auth";

export async function SiteHeader() {
  const t = await getTranslations();
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
        <ThemeToggle />
        {session ? (
          <SignOutButton />
        ) : (
          <>
            <Link href="/sign-in" className="text-sm underline">
              {t("nav.signIn")}
            </Link>
            <Link href="/sign-up" className="text-sm underline">
              {t("nav.signUp")}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
```

Reading the session here makes the header dynamic. That is intended — it is the
one component on every page that must reflect who is signed in.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm e2e e2e/auth.spec.ts`

Expected: PASS, 4 tests (2 specs × 2 projects).

- [ ] **Step 9: Full verification and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add registration, sign-in and sign-out

Auth error codes are mapped to message keys at the client boundary so no
English text reaches the UI; an end-to-end test asserts the Slovak wrong-password
message to keep that honest.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Protected area and remembered language

**Files:**

- Create: `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/play/page.tsx`
- Create: `src/server/api/routers/profile.ts`
- Modify: `src/server/api/root.ts`
- Modify: `src/components/locale-switcher.tsx`
- Modify: `messages/en.json`, `messages/sk.json`
- Test: `tests/integration/profile.test.ts`, `e2e/protected.spec.ts`

**Interfaces:**

- Consumes: `protectedProcedure`, `auth` (Task 5); `authClient` (Task 6);
  `locales` (Task 2).
- Produces: the route group `(app)`, which every signed-in page in later phases
  lives inside — its layout is the single place the sign-in redirect is
  enforced. `profileRouter.setLocale({ locale })`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/profile.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import { user } from "~/server/db/schema";
import { auth } from "~/server/auth";

async function signedInContext() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

describe("profile.setLocale", () => {
  it("stores a supported locale on the user", async () => {
    const ctx = await signedInContext();
    const caller = createCaller(ctx);

    await caller.profile.setLocale({ locale: "sk" });

    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, ctx.session!.user.id));

    expect(row?.locale).toBe("sk");
  });

  it("rejects an unsupported locale", async () => {
    const ctx = await signedInContext();
    const caller = createCaller(ctx);

    await expect(
      caller.profile.setLocale({ locale: "de" as "en" }),
    ).rejects.toThrow();
  });

  it("refuses an anonymous caller with a message key", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });
    const caller = createCaller(ctx);

    await expect(caller.profile.setLocale({ locale: "sk" })).rejects.toThrow(
      "errors.notSignedIn",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration tests/integration/profile.test.ts`

Expected: FAIL — `profile` does not exist on the router.

- [ ] **Step 3: Write the profile router**

Create `src/server/api/routers/profile.ts`:

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";

import { locales } from "~/i18n/routing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/schema";

export const profileRouter = createTRPCRouter({
  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(locales) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ locale: input.locale })
        .where(eq(user.id, ctx.session.user.id));

      return { locale: input.locale };
    }),
});
```

`z.enum(locales)` reuses the single source of truth from Task 2 — adding a third
language later cannot leave this validator behind.

Register it in `src/server/api/root.ts`:

```ts
import { profileRouter } from "~/server/api/routers/profile";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  profile: profileRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:integration tests/integration/profile.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing browser test**

Create `e2e/protected.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

test.describe("protected area", () => {
  test("redirects an anonymous visitor to sign in", async ({ page }) => {
    await page.goto("/en/play");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("lets a signed-in person in, and remembers their language", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();

    await page.goto("/en/play");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk\/play$/);

    // A fresh visit to the unprefixed root should land on the stored locale.
    await page.goto("/");
    await expect(page).toHaveURL(/\/sk$/);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm e2e e2e/protected.spec.ts --project=desktop`

Expected: FAIL — `/en/play` returns 404.

- [ ] **Step 7: Add the protected route group**

Create `src/app/[locale]/(app)/layout.tsx`:

```tsx
import { headers } from "next/headers";
import { type ReactNode } from "react";

import { redirect } from "~/i18n/navigation";
import { auth } from "~/server/auth";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect({ href: "/sign-in", locale });

  return <>{children}</>;
}
```

This layout is the only place the redirect lives. Every signed-in page in later
phases goes inside `(app)/`, so none of them repeats the check — and none of
them can forget it.

Create `src/app/[locale]/(app)/play/page.tsx`:

```tsx
import { useTranslations } from "next-intl";

export default function PlayPage() {
  const t = useTranslations("play");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <p className="text-muted mt-2">{t("empty")}</p>
    </main>
  );
}
```

Add to `messages/en.json`:

```json
{
  "play": {
    "title": "Your games",
    "empty": "No games yet."
  }
}
```

Add to `messages/sk.json`:

```json
{
  "play": {
    "title": "Vaše hry",
    "empty": "Zatiaľ žiadne hry."
  }
}
```

- [ ] **Step 8: Persist the locale when a signed-in person switches**

In `src/components/locale-switcher.tsx`, add the mutation to the `onChange`
handler. Replace the component body's handler with:

```tsx
        onChange={(event) => {
          const next = event.target.value as Locale;
          if (session.data) {
            void setLocale.mutateAsync({ locale: next }).catch(() => {
              // A failed preference save must not block the language change.
            });
          }
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
```

and add these above the `return`:

```tsx
const session = useSession();
const setLocale = api.profile.setLocale.useMutation();
```

with the imports:

```tsx
import { useSession } from "~/lib/auth-client";
import { api } from "~/trpc/react";
```

The `catch` is deliberate. Remembering the language is a convenience; failing to
save it must never stop the person changing language.

- [ ] **Step 9: Apply the stored locale when signing in on a new device**

The `/` redirect already works without any extra code: next-intl's middleware
writes a `NEXT_LOCALE` cookie whenever `router.replace(pathname, { locale })`
runs, and reads it on the next unprefixed visit. Do **not** try to solve this in
`src/i18n/request.ts` — the middleware decides the redirect target before
`request.ts` is ever consulted, so a check there has no effect on it.

What the cookie cannot do is follow someone to a different browser. That is what
the stored column is for, so apply it at sign-in. In
`src/components/auth-form.tsx`, replace the success branch of `onSubmit`:

```tsx
if (result.error) {
  setErrorKey(messageKeyFor(result.error.code));
  return;
}

const stored = (result.data?.user as { locale?: string } | undefined)?.locale;

if (stored && stored !== locale && hasLocale(locales, stored)) {
  // Signing in on a new browser: adopt the language saved on the account.
  // router.replace also writes the NEXT_LOCALE cookie, so it sticks.
  router.replace("/", { locale: stored });
} else {
  router.replace("/");
}

router.refresh();
```

and add to the imports and the component body:

```tsx
import { hasLocale, useLocale, useTranslations } from "next-intl";

import { locales } from "~/i18n/routing";
```

```tsx
const locale = useLocale();
```

Remove the now-duplicated `useTranslations` import line if your editor did not
merge it.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm e2e e2e/protected.spec.ts`

Expected: PASS, 4 tests.

- [ ] **Step 11: Full verification and commit**

```bash
pnpm test && pnpm test:integration && pnpm e2e && pnpm typecheck && pnpm lint && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add the protected app area and remembered language

The (app) route group carries the only sign-in redirect, so later pages cannot
forget it. A signed-in person's language choice is stored on their user row and
honoured on their next unprefixed visit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Agent instructions and the module boundary rule

**Files:**

- Create: `AGENTS.md`, `CLAUDE.md`
- Modify: `eslint.config.js`

**Interfaces:**

- Consumes: nothing.
- Produces: the ESLint boundary that Phase 1 depends on — `src/maze/**` cannot
  import Next, React, tRPC or Drizzle, and nothing outside `src/server/**` can
  import the database client.

- [ ] **Step 1: Write AGENTS.md**

Create `AGENTS.md`:

````markdown
# Labyrinth — instructions for agents

Two players each draw a secret maze, then race through the other's. See
`docs/superpowers/specs/2026-09-22-labyrinth-design.md` for the full design;
plans live in `docs/superpowers/plans/`.

## Commands

| Command                 | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `pnpm dev`              | Development server                                       |
| `pnpm typecheck`        | `tsc --noEmit`                                           |
| `pnpm lint`             | ESLint                                                   |
| `pnpm format`           | Prettier, writing in place                               |
| `pnpm test`             | Vitest unit tests (Node environment, no database)        |
| `pnpm test:integration` | Vitest against a real Neon branch — needs `DATABASE_URL` |
| `pnpm e2e`              | Playwright, desktop and mobile projects                  |
| `pnpm db:generate`      | Generate a migration from the schema                     |
| `pnpm db:migrate`       | Apply migrations                                         |

Use pnpm. Never `npm install`.

## Layout

```
src/maze/          Pure domain: format, validator, solver, move reducer
src/server/db/     Drizzle client and schema
src/server/auth/   Better Auth configuration
src/server/api/    tRPC routers
src/app/[locale]/  Pages, locale-prefixed
  (auth)/          Sign in and sign up
  (app)/           Everything requiring a session
src/components/    Shared components
messages/          en.json, sk.json
e2e/               Playwright
tests/unit/        Vitest, no database
tests/integration/ Vitest, real database
```

## Invariants

These are not style preferences. Breaking one is a bug, and most of them fail
quietly rather than loudly.

1. **No procedure reachable by a runner may select `maze.data`.** The maze is
   secret; a runner learning it ends the game. Author-facing and runner-facing
   reads are separate procedures with separate return types.
2. **`src/maze/` imports nothing** from Next, React, tRPC or Drizzle. It is
   pure functions over plain data, shared by the server, the live spectator
   view, the replay view and eventually a mobile client. ESLint enforces this.
3. **Validation failures travel as i18n message keys with parameters, never as
   English strings.** Applies to tRPC errors and to anything rendered.
4. **The move log is the source of truth.** `match_player.runState` is a
   denormalised cache. Never fix a discrepancy by editing the cache.
5. **Both players in a match share `cellCount` and `gateCount`.** Always.
6. **A void-blocked move must be indistinguishable from a wall-blocked move**
   in everything the runner receives and everything the client renders. This is
   the difference between a hidden maze and a guessable one.
7. **You cannot win without finding the treasure.** A forfeit never produces a
   winner who did not reach it. `winnerId` is null for every `abandoned` match.
8. **Database access uses `drizzle-orm/neon-serverless` with `Pool`**, never
   `neon-http`. The HTTP driver cannot open an interactive transaction, and
   moves must commit atomically with their run state.
9. **Every user-visible string lives in `messages/`.** Both catalogues, always
   — a unit test fails the build if `sk` drifts from `en`.
10. **Colours come from the tokens in `src/styles/globals.css`.** A raw hex
    value in a component will not follow the theme.

## Testing

Three layers, chosen by what each can actually prove:

- **`tests/unit/`** — pure logic, Node environment. The domain layer lives here
  and is tested with property-based tests as well as examples.
- **`tests/integration/`** — real Postgres on a Neon branch. Routers, auth,
  deadlines.
- **`e2e/`** — real browser, desktop and mobile. All UI behaviour.

There is deliberately no jsdom and no React Testing Library. UI behaviour is
proved in a real browser or not at all.

Write the failing test first. Run it and watch it fail before implementing.
````

- [ ] **Step 2: Write CLAUDE.md as a pointer**

Create `CLAUDE.md`:

```markdown
See [AGENTS.md](./AGENTS.md).

That file is canonical. Do not duplicate its content here — two copies of the
same instructions diverge within a month.
```

- [ ] **Step 3: Add the boundary rules to ESLint**

In `eslint.config.js`, append these config objects to the exported array:

```js
  {
    files: ["src/maze/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "next",
                "next/*",
                "react",
                "react/*",
                "react-dom",
                "@trpc/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "better-auth",
                "better-auth/*",
                "~/server/*",
                "~/app/*",
                "~/components/*",
              ],
              message:
                "src/maze must stay pure — it is shared with the client and a future mobile app. See AGENTS.md invariant 2.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    ignores: ["src/app/**/layout.tsx", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["~/server/db", "~/server/db/*"],
              message:
                "Components must not query the database directly. Go through a tRPC procedure.",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 4: Verify the rule actually fires**

A lint rule nobody has seen fail is a lint rule that might not work.

```bash
mkdir -p src/maze
cat > src/maze/boundary-probe.ts <<'PROBE'
import { db } from "~/server/db";
export const probe = db;
PROBE
pnpm lint 2>&1 | grep -q "src/maze must stay pure" && echo "RULE FIRES" || echo "RULE DID NOT FIRE"
rm src/maze/boundary-probe.ts
rmdir src/maze
```

Expected: `RULE FIRES`. If it prints `RULE DID NOT FIRE`, the config object was
appended in the wrong place — it must come after the base TypeScript config so
it overrides rather than gets overridden.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "$(cat <<'MSG'
docs: add AGENTS.md and enforce the module boundaries

Records the invariants that fail quietly rather than loudly, and backs the
src/maze purity rule with ESLint so Phase 1 cannot violate it from the first
commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Continuous integration

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: every script defined in Tasks 1, 3, 4 and 6.
- Produces: a CI pipeline that every later phase's tests run inside unchanged.

This task needs three GitHub repository secrets before it can pass:
`NEON_API_KEY`, `NEON_PROJECT_ID` and `BETTER_AUTH_SECRET`. Add them under
Settings → Secrets and variables → Actions. Generate the last one with
`openssl rand -base64 32` — it is a distinct value from any other secret, not a
reused one.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:
    name: Types, lint and unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test

  database:
    name: Integration and end-to-end
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - name: Create an isolated Neon branch
        id: neon
        uses: neondatabase/create-branch-action@v5
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          branch_name: ci-${{ github.run_id }}
          api_key: ${{ secrets.NEON_API_KEY }}

      - name: Apply migrations
        run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ steps.neon.outputs.db_url_pooled }}

      - run: pnpm test:integration
        env:
          DATABASE_URL: ${{ steps.neon.outputs.db_url_pooled }}
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
          BETTER_AUTH_URL: http://127.0.0.1:3000

      - name: Install browsers
        run: pnpm exec playwright install --with-deps chromium webkit

      - run: pnpm e2e
        env:
          DATABASE_URL: ${{ steps.neon.outputs.db_url_pooled }}
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
          BETTER_AUTH_URL: http://127.0.0.1:3000

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      - name: Delete the branch
        if: always()
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          branch: ci-${{ github.run_id }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

Applying migrations in CI means a broken migration fails the pull request rather
than the deploy. `if: always()` on the delete step matters — without it, a failed
run leaks a Neon branch every time.

- [ ] **Step 2: Note the CI requirements in AGENTS.md**

Append to `AGENTS.md`:

```markdown
## CI

Every pull request runs types, lint, formatting and unit tests, then
integration and end-to-end tests against a Neon branch created for that run and
deleted afterwards. Migrations are applied to the branch first, so a broken
migration fails the pull request.

Requires the repository secrets `NEON_API_KEY`, `NEON_PROJECT_ID` and
`BETTER_AUTH_SECRET`.
```

- [ ] **Step 3: Verify locally before pushing**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm test:integration && pnpm e2e
```

Expected: everything passes. Anything failing here fails in CI too.

- [ ] **Step 4: Commit and confirm the pipeline is green**

```bash
git add -A
git commit -m "$(cat <<'MSG'
ci: run types, lint, unit, integration and e2e on every pull request

Integration and browser tests run against a Neon branch created per run and
deleted afterwards, with migrations applied first so a broken migration fails
the pull request rather than the deploy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
git push -u origin HEAD
gh run watch
```

Expected: both jobs green.

---

## Phase 0 exit criteria

Phase 1 should not start until all of these hold:

- [ ] A person can register, sign out and sign back in, in a real browser.
- [ ] `/en` and `/sk` both render, the switcher preserves the current page, and
      a signed-in person's choice survives a fresh visit to `/`.
- [ ] Light and dark both work, and the stored theme is correct at
      `DOMContentLoaded` — no flash.
- [ ] `pnpm test`, `pnpm test:integration`, `pnpm e2e`, `pnpm typecheck`,
      `pnpm lint`, `pnpm build` all pass locally.
- [ ] CI is green on a pull request, including migrations against a fresh Neon
      branch.
- [ ] `AGENTS.md` exists and the `src/maze/` ESLint boundary has been seen to
      fire.
