import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { freshDatabase, as, newToken } from "./harness";

const PRANJALI = { role: "authenticated" as const, email: "pranjali@matiks.com" };
const MEENAL = { role: "authenticated" as const, email: "meenal@matiks.com" };
const STRANGER = { role: "authenticated" as const, email: "someone@gmail.com" };
const ANON = { role: "anon" as const };
const ROOT = { role: "postgres" as const };

let db: Client;
const ids: Record<string, string> = {};
const tok: Record<string, ReturnType<typeof newToken>> = {};
const feed = async (t: string) => (await as<{ f: any }>(db, ANON, `select creator_feed($1) as f`, [t]))[0].f;
const keys = async (bundle: string) => (await as<{ id: string }>(db, ROOT, `select id from bundle_briefs where bundle_id = $1 order by position`, [bundle])).map((r) => r.id);

beforeAll(async () => {
  db = await freshDatabase("mb_security_test");
  await as(db, PRANJALI, `insert into weeks (number, label) values (21, 'Week 21')`);
  await as(db, PRANJALI, `insert into records (id, week, stage, title, internal_notes) values ('r1', 19, 'Inspiration', 'secret ref', 'SECRET idea notes')`);
  for (const n of [1, 2, 3]) {
    const [b] = await as<{ id: string }>(db, PRANJALI, `insert into bundles (week, number, title, posting_instructions) values (21, $1, $2, 'Subtitles on every video.') returning id`, [n, `Bundle ${n}`]);
    ids[`b${n}`] = b.id;
    await as(db, PRANJALI, `insert into bundle_briefs (bundle_id, position, title, script, caption, internal_notes) values ($1, 1, $2, 'script', 'cap #matiks', 'SECRET admin thinking'), ($1, 2, $3, 'script 2', 'cap2', '')`, [b.id, `brief ${n}a`, `brief ${n}b`]);
  }
  for (const c of ["A", "B"]) {
    const [cr] = await as<{ id: string }>(db, PRANJALI, `insert into creators (display_name, internal_notes) values ($1, 'SECRET roster note') returning id`, [`Test creator ${c}`]);
    ids[c] = cr.id;
    tok[c] = newToken();
    await as(db, PRANJALI, `insert into creator_links (creator_id, token_hash, token_hint) values ($1, $2, $3)`, [cr.id, tok[c].hash, tok[c].hint]);
  }
  await as(db, PRANJALI, `insert into creator_assignments (creator_id, bundle_id) values ($1,$3),($1,$5),($2,$4),($2,$5)`, [ids.A, ids.B, ids.b1, ids.b2, ids.b3]);
  for (const n of [1, 2, 3]) await as(db, PRANJALI, `select publish_bundle($1, 'first version')`, [ids[`b${n}`]]);
});
afterAll(async () => { await db?.end(); });

describe("unauthorized visitors", () => {
  it("anon can't read or write any table, even with direct requests", async () => {
    const tables = (await as<{ tablename: string }>(db, ROOT, `select tablename from pg_tables where schemaname = 'public'`)).map((r) => r.tablename);
    expect(tables.length).toBeGreaterThanOrEqual(17);
    for (const t of tables) {
      await expect(as(db, ANON, `select * from public.${t} limit 1`), t).rejects.toThrow(/permission denied/);
      await expect(as(db, ANON, `delete from public.${t}`), t).rejects.toThrow(/permission denied/);
    }
  });
  it("a signed-in non-admin sees nothing and can't write", async () => {
    for (const t of ["records", "bundles", "bundle_briefs", "creators", "bundle_versions", "brief_comments", "audit_log", "admins"]) {
      expect(await as(db, STRANGER, `select * from public.${t}`), t).toHaveLength(0);
    }
    await expect(as(db, STRANGER, `insert into records (stage) values ('Inspiration')`)).rejects.toThrow(/row-level security/);
    expect((await as<{ a: boolean }>(db, STRANGER, `select am_i_admin() as a`))[0].a).toBe(false);
  });
  it("nobody can make themselves an admin", async () => {
    await expect(as(db, STRANGER, `insert into admins (email, added_by) values ('someone@gmail.com','someone@gmail.com')`)).rejects.toThrow(/row-level security/);
    await expect(as(db, ANON, `insert into admins (email, added_by) values ('x@y.z','x')`)).rejects.toThrow(/permission denied/);
  });
  it("anon and non-admins cannot publish or preview creators", async () => {
    await expect(as(db, ANON, `select publish_bundle($1)`, [ids.b1])).rejects.toThrow(/permission denied/);
    await expect(as(db, STRANGER, `select publish_bundle($1)`, [ids.b1])).rejects.toThrow(/not authorized/);
    await expect(as(db, STRANGER, `select admin_preview_feed($1)`, [ids.A])).rejects.toThrow(/not authorized/);
  });
  it("garbage tokens get nothing", async () => {
    expect(await feed("x".repeat(43))).toBeNull();
    expect(await feed("' or 1=1 --")).toBeNull();
  });
});

describe("admins", () => {
  it("owners are the two confirmed admins", async () => {
    const r = await as<{ email: string }>(db, PRANJALI, `select email from admins order by email`);
    expect(r.map((x) => x.email)).toEqual(["meenal@matiks.com", "pranjali@matiks.com"]);
    expect((await as<{ a: boolean }>(db, MEENAL, `select am_i_admin() as a`))[0].a).toBe(true);
  });
  it("token hashes are never readable, even by admins", async () => {
    await expect(as(db, PRANJALI, `select token_hash from creator_links`)).rejects.toThrow(/permission denied/);
  });
  it("edits persist for another admin's session, with who/when", async () => {
    await as(db, PRANJALI, `update records set title = 'saved by pranjali' where id = 'r1'`);
    const [r] = await as<{ title: string; updated_by: string }>(db, MEENAL, `select title, updated_by from records where id = 'r1'`);
    expect(r).toEqual({ title: "saved by pranjali", updated_by: "pranjali@matiks.com" });
    const log = await as<{ actor: string }>(db, MEENAL, `select actor from audit_log where entity = 'records' and action = 'update'`);
    expect(log.some((l) => l.actor === "pranjali@matiks.com")).toBe(true);
  });
  it("the last active admin cannot be removed", async () => {
    await as(db, PRANJALI, `update admins set active = false where email = 'meenal@matiks.com'`);
    await expect(as(db, PRANJALI, `update admins set active = false where email = 'pranjali@matiks.com'`)).rejects.toThrow(/last active admin/);
    await as(db, PRANJALI, `update admins set active = true, deactivated_at = null where email = 'meenal@matiks.com'`);
  });
  it("real creators are blocked until sharing is approved", async () => {
    await expect(as(db, PRANJALI, `insert into creators (display_name, is_test) values ('Real person', false)`)).rejects.toThrow(/switched off/);
  });
});

describe("creator links", () => {
  it("each link sees only its assigned, published bundles, without admin-only data", async () => {
    const a = await feed(tok.A.token);
    const b = await feed(tok.B.token);
    expect(a.bundles.map((x: any) => x.bundle_id).sort()).toEqual([ids.b1, ids.b3].sort());
    expect(b.bundles.map((x: any) => x.bundle_id).sort()).toEqual([ids.b2, ids.b3].sort());
    const text = JSON.stringify(a) + JSON.stringify(b);
    expect(text).not.toMatch(/SECRET|secret ref/);
    expect(JSON.stringify(a)).not.toContain("Test creator B");
    expect(JSON.stringify(a)).not.toContain(ids.b2);
  });
  it("creator A cannot read or change creator B's records", async () => {
    const [k] = await keys(ids.b2);
    await expect(as(db, ANON, `select creator_set_done($1, $2, $3, true)`, [tok.A.token, ids.b2, k])).rejects.toThrow(/not found/);
    await expect(as(db, ANON, `select creator_add_comment($1, $2, $3, 'hi')`, [tok.A.token, ids.b2, k])).rejects.toThrow(/not found/);
    await expect(as(db, ANON, `select creator_set_status($1, $2, 1)`, [tok.A.token, ids.b2])).rejects.toThrow(/not found/);
  });
  it("done, comments and progress are separate for creators sharing a bundle", async () => {
    const [k1, k2] = await keys(ids.b3);
    await as(db, ANON, `select creator_set_done($1, $2, $3, true)`, [tok.A.token, ids.b3, k1]);
    await as(db, ANON, `select creator_add_comment($1, $2, $3, $4)`, [tok.A.token, ids.b3, k1, "<script>alert(1)</script> A's note"]);
    await as(db, ANON, `select creator_add_comment($1, $2, $3, 'B question')`, [tok.B.token, ids.b3, k2]);
    await as(db, ANON, `select creator_set_status($1, $2, 1)`, [tok.A.token, ids.b3]);
    const a3 = (await feed(tok.A.token)).bundles.find((x: any) => x.bundle_id === ids.b3);
    const b3 = (await feed(tok.B.token)).bundles.find((x: any) => x.bundle_id === ids.b3);
    expect(a3.progress).toEqual([expect.objectContaining({ brief_key: k1, done: true, done_version: 1 })]);
    expect(b3.progress).toEqual([]);
    expect(a3.status).toBe(1);
    expect(b3.status).toBeNull();
    expect(a3.comments.map((c: any) => c.body)).toEqual(["<script>alert(1)</script> A's note"]);
    expect(b3.comments.map((c: any) => c.body)).toEqual(["B question"]);
    expect(await as(db, MEENAL, `select body from brief_comments where bundle_id = $1`, [ids.b3])).toHaveLength(2);
  });
  it("creators can't mark themselves Approved; admins can", async () => {
    await expect(as(db, ANON, `select creator_set_status($1, $2, 3)`, [tok.A.token, ids.b1])).rejects.toThrow(/Only the Matiks team/);
    await as(db, PRANJALI, `insert into creator_bundle_status (creator_id, bundle_id, status, updated_by) values ($1, $2, 3, 'pranjali@matiks.com')`, [ids.A, ids.b1]);
    expect((await feed(tok.A.token)).bundles.find((x: any) => x.bundle_id === ids.b1).status).toBe(3);
  });
  it("comments are length-checked and rate-limited", async () => {
    const [k1] = await keys(ids.b1);
    await expect(as(db, ANON, `select creator_add_comment($1, $2, $3, '   ')`, [tok.A.token, ids.b1, k1])).rejects.toThrow(/1–2000/);
    await expect(as(db, ANON, `select creator_add_comment($1, $2, $3, $4)`, [tok.A.token, ids.b1, k1, "x".repeat(2001)])).rejects.toThrow(/1–2000/);
    for (let i = 0; i < 9; i++) await as(db, ANON, `select creator_add_comment($1, $2, $3, $4)`, [tok.A.token, ids.b1, k1, `c${i}`]);
    await expect(as(db, ANON, `select creator_add_comment($1, $2, $3, 'one too many')`, [tok.A.token, ids.b1, k1])).rejects.toThrow(/Too many comments/);
  });
  it("revoked links stop working; rotated links work; revoking can't be undone from the app", async () => {
    const old = tok.B.token;
    await as(db, PRANJALI, `update creator_links set revoked_at = now(), revoked_by = 'pranjali@matiks.com' where creator_id = $1 and revoked_at is null`, [ids.B]);
    expect(await feed(old)).toBeNull();
    const [k] = await keys(ids.b2);
    await expect(as(db, ANON, `select creator_set_done($1, $2, $3, true)`, [old, ids.b2, k])).rejects.toThrow(/invalid link/);
    tok.B2 = newToken();
    await as(db, PRANJALI, `insert into creator_links (creator_id, token_hash, token_hint) values ($1, $2, $3)`, [ids.B, tok.B2.hash, tok.B2.hint]);
    expect((await feed(tok.B2.token)).bundles).toHaveLength(2);
    expect(await feed(old)).toBeNull();
    await expect(as(db, PRANJALI, `update creator_links set revoked_at = null where creator_id = $1`, [ids.B])).rejects.toThrow(/row-level security|violates/);
  });
  it("deactivating a creator disables their link", async () => {
    await as(db, PRANJALI, `update creators set active = false where id = $1`, [ids.B]);
    expect(await feed(tok.B2.token)).toBeNull();
    await as(db, PRANJALI, `update creators set active = true where id = $1`, [ids.B]);
  });
});

describe("publishing", () => {
  it("draft edits don't reach creators until published", async () => {
    const [k1] = await keys(ids.b1);
    await as(db, PRANJALI, `update bundle_briefs set script = 'EDITED script' where id = $1`, [k1]);
    const b1 = (await feed(tok.A.token)).bundles.find((x: any) => x.bundle_id === ids.b1);
    expect(b1.version).toBe(1);
    expect(b1.content.briefs[0].script).toBe("script");
  });
  it("publishing a revision makes v2, keeps v1 intact and flags the changed brief", async () => {
    await as(db, ANON, `select creator_mark_seen($1, $2, 1)`, [tok.A.token, ids.b1]);
    const [k1] = await keys(ids.b1);
    await as(db, ANON, `select creator_set_done($1, $2, $3, true)`, [tok.A.token, ids.b1, k1]);
    const fp1 = (await as<{ f: string }>(db, ANON, `select creator_fingerprint($1) as f`, [tok.A.token]))[0].f;
    const [{ v }] = await as<{ v: number }>(db, PRANJALI, `select publish_bundle($1, 'Fixed brief 1') as v`, [ids.b1]);
    expect(v).toBe(2);
    expect((await as<{ f: string }>(db, ANON, `select creator_fingerprint($1) as f`, [tok.A.token]))[0].f).not.toBe(fp1);
    const versions = await as<{ content: any; published_by: string; change_summary: string }>(db, PRANJALI, `select content, published_by, change_summary from bundle_versions where bundle_id = $1 order by version`, [ids.b1]);
    expect(versions.map((x) => x.content.briefs[0].script)).toEqual(["script", "EDITED script"]);
    expect(versions[1]).toMatchObject({ published_by: "pranjali@matiks.com", change_summary: "Fixed brief 1" });
    expect(versions[1].content.changes.changed).toEqual([k1]);
    expect(JSON.stringify(versions)).not.toContain("SECRET");
    const b1 = (await feed(tok.A.token)).bundles.find((x: any) => x.bundle_id === ids.b1);
    const brief = b1.content.briefs.find((x: any) => x.key === k1);
    expect(b1.version).toBe(2);
    expect(b1.last_seen_version).toBe(1);
    expect(b1.seen_hashes[k1]).not.toBe(brief.hash);
    const prog = b1.progress.find((p: any) => p.brief_key === k1);
    expect(prog).toMatchObject({ done: true, done_version: 1 });
    expect(prog.done_brief_hash).not.toBe(brief.hash);
  });
  it("published versions are immutable, even for the database owner", async () => {
    await expect(as(db, ROOT, `update bundle_versions set change_summary = 'x'`)).rejects.toThrow(/immutable/);
    await expect(as(db, ROOT, `delete from bundle_versions`)).rejects.toThrow(/immutable/);
    await expect(as(db, PRANJALI, `update bundle_versions set change_summary = 'x'`)).rejects.toThrow(/permission denied/);
  });
  it("refuses to publish an unchanged bundle", async () => {
    await expect(as(db, PRANJALI, `select publish_bundle($1)`, [ids.b1])).rejects.toThrow(/Nothing changed since version 2/);
  });
  it("admin preview shows exactly the creator's feed", async () => {
    const [{ f }] = await as<{ f: any }>(db, PRANJALI, `select admin_preview_feed($1) as f`, [ids.A]);
    expect(f.bundles.map((x: any) => x.bundle_id).sort()).toEqual((await feed(tok.A.token)).bundles.map((x: any) => x.bundle_id).sort());
  });
  it("unassigning removes the bundle from the creator's link", async () => {
    await as(db, PRANJALI, `update creator_assignments set removed_at = now() where creator_id = $1 and bundle_id = $2`, [ids.A, ids.b3]);
    expect((await feed(tok.A.token)).bundles.map((x: any) => x.bundle_id)).toEqual([ids.b1]);
  });
});
