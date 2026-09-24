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
    const table = `rollback_probe_${crypto.randomUUID().replace(/-/g, "")}`;

    await db.execute(sql.raw(`create table ${table} (n int)`));

    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql.raw(`insert into ${table} values (1)`));
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const after = await db.execute<{ count: number }>(
        sql.raw(`select count(*)::int as count from ${table}`),
      );
      expect(after.rows[0]?.count).toBe(0);
    } finally {
      await db.execute(sql.raw(`drop table if exists ${table}`));
    }
  });
});
