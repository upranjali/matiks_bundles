import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

/**
 * Test database harness. Needs a disposable Postgres reachable via TEST_DATABASE_URL
 * (e.g. postgres://postgres@/postgres?host=/tmp/pgtest&port=54329). Each test file gets a
 * freshly created database with the Supabase shim and every migration applied.
 */
export const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres?host=/tmp/pgtest";

export async function freshDatabase(name: string): Promise<Client> {
  const admin = new Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = BASE_URL.replace(/\/postgres(\?|$)/, `/${name}$1`);
  const db = new Client({ connectionString: url });
  await db.connect();
  const root = join(import.meta.dirname, "../supabase");
  await db.query(readFileSync(join(root, "tests/supabase_shim.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    await db.query(readFileSync(join(root, "migrations", f), "utf8"));
  }
  return db;
}

export type Who = { role: "anon" } | { role: "authenticated"; email: string } | { role: "postgres" };

/** Run SQL as a given Supabase role inside a transaction that is rolled back unless keep=true. */
export async function as<T = Record<string, unknown>>(db: Client, who: Who, sql: string, params: unknown[] = [], keep = true): Promise<T[]> {
  await db.query("begin");
  try {
    if (who.role !== "postgres") {
      const claims = who.role === "authenticated" ? { role: "authenticated", email: who.email, sub: "00000000-0000-4000-8000-" + createHash("md5").update(who.email).digest("hex").slice(0, 12) } : { role: "anon" };
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await db.query(`set local role ${who.role}`);
    }
    const r = await db.query(sql, params);
    await db.query(keep ? "commit" : "rollback");
    return r.rows as T[];
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token, "utf8").digest(), hint: token.slice(-4) };
}
