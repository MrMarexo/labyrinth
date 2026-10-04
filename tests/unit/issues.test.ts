import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toTranslatableIssues } from "~/lib/issues";

describe("toTranslatableIssues", () => {
  it("turns a zod error into keyed issues, preserving the path", () => {
    const schema = z.object({
      width: z.number().int({ message: "maze.format.notAnInteger" }),
    });
    const result = schema.safeParse({ width: 1.5 });
    expect(result.success).toBe(false);

    expect(toTranslatableIssues(result.error)).toEqual([
      { key: "maze.format.notAnInteger", path: ["width"] },
    ]);
  });

  it("carries params from a custom issue", () => {
    const schema = z.number().superRefine((value, ctx) => {
      if (value < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "maze.format.tooSmall",
          params: { min: 10 },
        });
      }
    });
    const result = schema.safeParse(3);
    expect(result.success).toBe(false);

    expect(toTranslatableIssues(result.error)).toEqual([
      { key: "maze.format.tooSmall", params: { min: 10 }, path: [] },
    ]);
  });

  it("passes through all-primitive custom params unchanged", () => {
    const schema = z.number().superRefine((value, ctx) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maze.format.outOfRange",
        params: { min: 1, label: "width" },
      });
    });
    const result = schema.safeParse(0);
    expect(result.success).toBe(false);

    expect(toTranslatableIssues(result.error)).toEqual([
      {
        key: "maze.format.outOfRange",
        params: { min: 1, label: "width" },
        path: [],
      },
    ]);
  });

  it("drops a non-primitive param while keeping primitive ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const schema = z.number().superRefine((value, ctx) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maze.format.outOfRange",
        params: { min: 1, at: new Date() },
      });
    });
    const result = schema.safeParse(0);
    expect(result.success).toBe(false);

    expect(toTranslatableIssues(result.error)).toEqual([
      { key: "maze.format.outOfRange", params: { min: 1 }, path: [] },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it("replaces an English zod default with a generic key", () => {
    // No message override, so zod supplies English prose. That must never
    // reach the client — it is untranslatable and leaks implementation detail.
    const result = z.string().safeParse(42);
    expect(result.success).toBe(false);

    const issues = toTranslatableIssues(result.error);
    expect(issues).toEqual([{ key: "errors.validation.invalid", path: [] }]);
  });

  it("returns an empty list for a non-zod cause", () => {
    expect(toTranslatableIssues(new Error("boom"))).toEqual([]);
    expect(toTranslatableIssues(undefined)).toEqual([]);
  });
});
