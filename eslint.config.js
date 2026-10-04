import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";
// @ts-expect-error -- no types for this plugin
import drizzle from "eslint-plugin-drizzle";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

export default tseslint.config(
  {
    // Generated, and not ours to fix: next-env.d.ts is rewritten by every
    // `next build`; the other two are test output.
    ignores: [".next", "next-env.d.ts", "playwright-report", "test-results"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      drizzle,
    },
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "drizzle/enforce-delete-with-where": [
        "error",
        { drizzleObjectName: ["db", "ctx.db"] },
      ],
      "drizzle/enforce-update-with-where": [
        "error",
        { drizzleObjectName: ["db", "ctx.db"] },
      ],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ["src/maze/**/*.{ts,tsx}"],
    rules: {
      // Static imports only: ESLint 9's no-restricted-imports has no
      // ImportExpression visitor, so a dynamic import() here is not caught.
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
                "next-intl",
                "next-intl/*",
                "@t3-oss/*",
                "@neondatabase/*",
                // Node builtins: any of these breaks the browser bundle and
                // the future mobile client just as surely as importing Next.
                "node:*",
                "fs",
                "fs/*",
                "path",
                "path/*",
                "crypto",
                "os",
                "stream",
                "stream/*",
                "buffer",
                "util",
                "child_process",
                "~/server/*",
                "~/app/*",
                "~/components/*",
                "~/trpc/*",
                "~/i18n/*",
                "~/env",
                "~/styles/*",
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
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/app/**/layout.tsx", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["~/server/db", "~/server/db/*"],
              message:
                "Components must not query the database directly. Go through a tRPC procedure. See AGENTS.md invariant 11.",
            },
          ],
        },
      ],
    },
  },
);
