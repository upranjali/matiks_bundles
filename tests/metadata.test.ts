import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequest } from "../functions/api/metadata";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pk" };
const call = (body: unknown, auth = "Bearer admin-token-xxxxxxxxxxxxxxxx", method = "POST") =>
  (onRequest as any)({ request: new Request("https://hub.test/api/metadata", { method, headers: { authorization: auth, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }), env });

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => { const url = String(u); calls.push(url); return handler(url, init); }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/metadata", () => {
  it("refuses non-admins without contacting any platform", async () => {
    const calls = mockFetch((u) => (u.includes("am_i_admin") ? Response.json(false) : Response.json({})));
    const r = await call({ url: "https://www.tiktok.com/@a/video/7700000000000000001" });
    expect(r.status).toBe(401);
    expect(calls.filter((c) => !c.includes("supabase.co"))).toEqual([]);
  });
  it("returns title, author and thumbnail from the official oEmbed endpoint", async () => {
    const calls = mockFetch((u) => u.includes("am_i_admin") ? Response.json(true)
      : Response.json({ title: "My video", author_unique_id: "creator", thumbnail_url: "https://p16.tiktokcdn.com/x.jpg", html: "<script>evil()</script>" }));
    const j = await (await call({ url: "https://www.tiktok.com/@creator/video/7700000000000000001?is_from_webapp=1" })).json();
    expect(j).toEqual({ status: "fetched", title: "My video", author: "creator", thumbnail_url: "https://p16.tiktokcdn.com/x.jpg" });
    expect(calls[1]).toMatch(/^https:\/\/www\.tiktok\.com\/oembed\?url=/);
    expect(JSON.stringify(j)).not.toContain("script");
  });
  it("never fetches arbitrary or internal hosts", async () => {
    const calls = mockFetch((u) => (u.includes("am_i_admin") ? Response.json(true) : Response.json({})));
    for (const url of ["http://169.254.169.254/latest/meta-data", "http://localhost:5432", "https://evil.example/x", "file:///etc/passwd"]) {
      expect((await (await call({ url })).json()).status).toBe("blocked");
    }
    expect(calls.every((c) => c.includes("am_i_admin"))).toBe(true);
  });
  it("degrades to blocked on private posts, redirects or bad responses", async () => {
    mockFetch((u) => (u.includes("am_i_admin") ? Response.json(true) : new Response("nope", { status: 404 })));
    expect((await (await call({ url: "https://www.instagram.com/p/DeuCce9Ps8n/" })).json()).status).toBe("blocked");
    mockFetch((u) => (u.includes("am_i_admin") ? Response.json(true) : new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } })));
    expect((await (await call({ url: "https://youtu.be/dQw4w9WgXcQ" })).json()).status).toBe("blocked");
  });
  it("only accepts POST", async () => {
    mockFetch(() => Response.json(true));
    expect((await call(null, undefined, "GET")).status).toBe(405);
  });
});
