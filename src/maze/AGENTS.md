# src/maze — the pure domain

This directory imports nothing from Next, React, tRPC, Drizzle, Better Auth,
next-intl or Node builtins (`node:*`, `fs`, `path`, `crypto`). It is pure
functions over plain data, shared by the server, the live spectator view, the
replay view and eventually a mobile client.

ESLint enforces this for static imports only — `no-restricted-imports` cannot
see a dynamic `import()`, so do not add one.

Root `AGENTS.md`, invariant 2.
