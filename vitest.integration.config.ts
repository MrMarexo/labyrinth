import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Vitest never sets the `react-server` condition, so `server-only`
    // resolves to its throwing build; alias to its no-op one by file path,
    // since its `exports` map has no subpath for it to resolve as a specifier.
    alias: {
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // These share one database. Running files in parallel makes failures
    // depend on interleaving, which is not a debuggable state to be in.
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: "test" },
    setupFiles: ["dotenv/config"],
  },
});
