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
