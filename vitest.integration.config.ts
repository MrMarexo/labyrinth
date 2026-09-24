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
    setupFiles: ["dotenv/config"],
  },
});
