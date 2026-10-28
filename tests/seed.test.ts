import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { freshDatabase, as } from "./harness";
import { seed } from "../scripts/seed";

const archive = JSON.parse(readFileSync(new URL("../src/data/archive.json", import.meta.url), "utf8"));
const ADMIN = { role: "authenticated" as const, email: "pranjali@matiks.com" };
let db: Client;
beforeAll(async () => { db = await freshDatabase("mb_seed_test"); });
afterAll(async () => { await db?.end(); });

describe("one-time import", () => {
  it("imports all 705 snapshot records plus the 6 design learnings", async () => {
    expect(await seed(db, archive)).toEqual({ inserted: 711, unchanged: 0, updated: 0, conflicts: 0 });
    const counts = await as<{ week: number | null; n: string }>(db, ADMIN, `select week, count(*) n from records group by week order by week nulls first`);
    expect(Object.fromEntries(counts.map((c) => [String(c.week), Number(c.n)]))).toEqual({ null: 57, "17": 189, "18": 273, "19": 183, "20": 9 });
  });
  it("keeps Week 20's bundle empty", async () => {
    expect(await as(db, ADMIN, `select 1 from records where week = 20 and stage = 'Bundle briefs'`)).toHaveLength(0);
    expect(await as(db, ADMIN, `select 1 from bundles`)).toHaveLength(0);
  });
  it("keeps personas separate from formats and preserves provenance and review flags", async () => {
    const p = await as<{ persona: string; n: string }>(db, ADMIN, `select persona, count(*) n from records where persona <> '' group by persona order by persona`);
    expect(p.map((x) => x.persona)).toEqual(["Gameplays", "Hot girl", "Unhinged"]);
    const [r] = await as<{ sources: any[]; needs_review: boolean; extras: any[] }>(db, ADMIN, `select sources, needs_review, extras from records where id = 'b7bd34fa3182f736'`);
    expect(r.sources[0]).toMatchObject({ sheet: "week 18", tab: "final", row: 1 });
    expect(r.needs_review).toBe(true);
    expect(r.extras[0]).toEqual({ column: "B", value: "Long texts + 4 hook demo + 4 talking heads" });
    expect((await as<{ n: string }>(db, ADMIN, `select count(*) n from records where needs_review`))[0].n).toBe("175");
  });
  it("re-running is a no-op", async () => {
    expect(await seed(db, archive)).toEqual({ inserted: 0, unchanged: 711, updated: 0, conflicts: 0 });
  });
  it("never overwrites app edits; a changed sheet row becomes a conflict to review", async () => {
    await as(db, ADMIN, `update records set title = 'Edited in the app' where id = 'b7bd34fa3182f736'`);
    const changed = archive.map((r: any) => (r.id === "b7bd34fa3182f736" || r.id === archive[1].id ? { ...r, title: r.title + " (sheet changed)" } : r));
    expect(await seed(db, changed)).toEqual({ inserted: 0, unchanged: 709, updated: 1, conflicts: 1 });
    const [r] = await as<{ title: string }>(db, ADMIN, `select title from records where id = 'b7bd34fa3182f736'`);
    expect(r.title).toBe("Edited in the app");
    expect(await as(db, ADMIN, `select 1 from import_conflicts where record_id = 'b7bd34fa3182f736' and resolved_at is null`)).toHaveLength(1);
    expect(await seed(db, changed)).toMatchObject({ conflicts: 0 });
  });
});
