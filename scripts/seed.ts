/**
 * One-time import of the approved archive snapshot (src/data/archive.json: 705 records from 13
 * spreadsheets / 56 tabs, read 28 Oct 2026) into the database.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/seed.ts [--dry-run]
 *
 * Safe to run again:
 *  - new record            -> inserted, with the imported content kept in `seed`
 *  - unchanged record      -> skipped
 *  - sheet copy changed, app copy untouched -> updated
 *  - sheet copy changed AND edited in the app -> NOT overwritten; an import_conflicts row is
 *    created for an admin to resolve in the app (once per distinct sheet version).
 * Week 20 gets no bundle briefs: the snapshot has none, and this script never creates bundles.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { parseSocialUrl, embedFor } from "../src/lib/social-url";

type Src = { sheet: string; tab: string; row: number; url: string; gid?: number };
type Rec = {
  id: string; week: number | null; persona: string; stage: string; format: string; title: string;
  fields: Record<string, string>; extras?: { column: string; value: string }[]; sourceCells?: unknown; needsReview?: boolean; sources: Src[];
};

const WEEK19_SHEET = "https://docs.google.com/spreadsheets/d/16cjn3YRbRHNe6WFUHbnNz-eGu8xXh3KwRe9EoCXaLhg/edit";
// The six learning summaries shown under Week 19 › Learnings in the approved design.
const DESIGN_LEARNINGS: [string, string][] = [
  ["Structure", "The ending earns the mention. Long text lives or dies on the last line; if the Matiks mention doesn’t resolve the story, viewers call it forgettable."],
  ["Hook", "Eavesdrop stories pull reads. Controversial relationship situations overheard in public keep people reading to the end."],
  ["Integration", "Tie the app to the smart character. Matiks should belong to the crush-material character, not the narrator’s problem."],
  ["Angle", "Got-in-trouble angles travel. The gen-z coworker called out by her boss works across class, bus, library, office and family functions."],
  ["Engagement", "Rage bait buys comments. Hot takes on mental math and illiteracy pull comment engagement; use sparingly."],
  ["Diagnosis", "Comments diagnose recall. “what is matiks?” under a video means the integration didn’t stick; fix the ending, not the hook."],
];

export function toRows(archive: Rec[]) {
  const rows = archive.map((r) => ({
    id: r.id, week: r.week, persona: r.persona ?? "", stage: r.stage, format: r.format || "Uncategorized", title: r.title ?? "",
    fields: r.fields ?? {}, extras: r.extras ?? [], source_cells: r.sourceCells ?? null, needs_review: !!r.needsReview, sources: r.sources ?? [],
  }));
  for (const [tag, text] of DESIGN_LEARNINGS) {
    rows.push({
      id: `design-learning-${tag.toLowerCase()}`, week: 19, persona: "", stage: "Learnings", format: tag, title: text.split(".")[0],
      fields: { note: text }, extras: [], source_cells: null, needs_review: false,
      sources: [{ sheet: "week 19", tab: "winners recent (summary from the approved design)", row: 0, url: WEEK19_SHEET }],
    });
  }
  return rows;
}
type Row = ReturnType<typeof toRows>[number];
const CONTENT_KEYS = ["week", "persona", "stage", "format", "title", "fields", "extras", "source_cells", "needs_review", "sources"] as const;

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export const content = (r: Record<string, unknown>) => Object.fromEntries(CONTENT_KEYS.map((k) => [k, r[k] ?? null]));
export const hash = (r: Record<string, unknown>) => createHash("sha256").update(stable(content(r))).digest("hex");

function linkColumns(r: Row) {
  const url = (r.fields.inspo || r.fields.account || "").match(/https?:\/\/[^\s]+/)?.[0];
  if (!url) return {};
  const p = parseSocialUrl(url);
  const e = embedFor(p);
  return { url, url_key: p.key, platform: p.platform, link_kind: p.kind, embed_provider: e?.provider ?? null, embed_id: e?.id ?? null };
}

export async function seed(db: Client, archive: Rec[], dryRun = false) {
  const stats = { inserted: 0, unchanged: 0, updated: 0, conflicts: 0 };
  await db.query("begin");
  try {
    for (const r of toRows(archive)) {
      const h = hash(r);
      const { rows } = await db.query("select * from public.records where id = $1 for update", [r.id]);
      const cur = rows[0];
      if (!cur) {
        const l = linkColumns(r);
        await db.query(
          `insert into public.records (id, week, persona, stage, format, title, fields, extras, source_cells, needs_review, sources, seed, seed_hash,
             url, url_key, platform, link_kind, embed_provider, embed_id, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'import:2026-10-28')`,
          [r.id, r.week, r.persona, r.stage, r.format, r.title, r.fields, JSON.stringify(r.extras), r.source_cells === null ? null : JSON.stringify(r.source_cells),
           r.needs_review, JSON.stringify(r.sources), content(r), h, l.url ?? null, l.url_key ?? null, l.platform ?? null, l.link_kind ?? null, l.embed_provider ?? null, l.embed_id ?? null],
        );
        stats.inserted++;
      } else if (cur.seed_hash === h) {
        stats.unchanged++;
      } else if (cur.seed && hash(cur) === hash(cur.seed)) {
        await db.query(
          `update public.records set week=$2, persona=$3, stage=$4, format=$5, title=$6, fields=$7, extras=$8, source_cells=$9, needs_review=$10, sources=$11, seed=$12, seed_hash=$13 where id=$1`,
          [r.id, r.week, r.persona, r.stage, r.format, r.title, r.fields, JSON.stringify(r.extras), r.source_cells === null ? null : JSON.stringify(r.source_cells), r.needs_review, JSON.stringify(r.sources), content(r), h],
        );
        stats.updated++;
      } else {
        const exists = await db.query("select 1 from public.import_conflicts where record_id = $1 and incoming = $2", [r.id, content(r)]);
        if (!exists.rowCount) {
          await db.query("insert into public.import_conflicts (record_id, incoming) values ($1, $2)", [r.id, content(r)]);
          stats.conflicts++;
        }
      }
    }
    await db.query(dryRun ? "rollback" : "commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  return stats;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the Supabase database connection string (Project settings → Database).");
  const archive: Rec[] = JSON.parse(readFileSync(new URL("../src/data/archive.json", import.meta.url), "utf8"));
  const db = new Client({ connectionString: url });
  await db.connect();
  const s = await seed(db, archive, process.argv.includes("--dry-run"));
  console.log(process.argv.includes("--dry-run") ? "DRY RUN (nothing saved):" : "Imported:", s);
  await db.end();
}
