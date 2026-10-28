/**
 * Social URL parsing shared by the sheet importer and the in-app "Import link" flow.
 * Pure functions only: no network access here.
 */

export type Platform = "instagram" | "tiktok" | "youtube" | "pinterest" | "google_drive" | "other";
export type RefKind = "video" | "post" | "account" | "board" | "file" | "folder" | "page";

export interface ParsedSocialUrl {
  /** The URL exactly as given (trimmed of surrounding whitespace only). */
  original: string;
  /** Normalised https URL without tracking params, or null if not a valid http(s) URL. */
  normalized: string | null;
  platform: Platform;
  kind: RefKind;
  /** Stable identity used for duplicate detection, e.g. "instagram:media:DdpBs_xSuDg". */
  key: string | null;
  handle?: string;
  mediaId?: string;
  problems: string[];
}

const TRACKING_PARAMS = /^(utm_|igsh|igshid|stkn|srtk|mdxt|rpxt|obrf|exln|vrfl|psln|xtok|cplk|dlrf|is_from_webapp|sender_device|q|t|lang|hl|_r|_t|si|feature|img_index)$/i;

export function parseSocialUrl(input: string): ParsedSocialUrl {
  const original = input.trim();
  const problems: string[] = [];
  let url: URL | null = null;
  try {
    url = new URL(original);
  } catch {
    // Common sheet damage: a scheme-less or truncated host such as "iktok.com/@x/video/1".
    try {
      url = new URL("https://" + original);
      problems.push("missing_scheme");
    } catch {
      return { original, normalized: null, platform: "other", kind: "page", key: null, problems: ["not_a_url"] };
    }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { original, normalized: null, platform: "other", kind: "page", key: null, problems: ["unsupported_scheme"] };
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|vm\.|in\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const keep = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (!TRACKING_PARAMS.test(k)) keep.set(k, v);
  });

  const base = (p: Platform, kind: RefKind, key: string | null, extra: Partial<ParsedSocialUrl> = {}): ParsedSocialUrl => ({
    original,
    normalized: `https://${url!.hostname.toLowerCase()}${url!.pathname}${keep.toString() ? "?" + keep.toString() : ""}`,
    platform: p,
    kind,
    key,
    problems,
    ...extra,
  });

  if (host === "instagram.com") {
    const [a, b, c] = parts;
    if ((a === "reel" || a === "reels" || a === "p" || a === "tv") && b) {
      return base("instagram", a === "p" ? "post" : "video", `instagram:media:${b}`, { mediaId: b });
    }
    // /{handle}/reel/{id}/ form
    if (a && (b === "reel" || b === "p") && c) {
      return base("instagram", b === "p" ? "post" : "video", `instagram:media:${c}`, { mediaId: c, handle: a.toLowerCase() });
    }
    if (a && !["explore", "stories", "accounts", "direct"].includes(a)) {
      return base("instagram", "account", `instagram:account:${a.toLowerCase()}`, { handle: a.toLowerCase() });
    }
    return base("instagram", "page", null);
  }
  if (host.endsWith("tiktok.com")) {
    if (!/(^|\.)tiktok\.com$/.test(host)) problems.push("suspicious_host");
    const [a, b, c] = parts;
    if (a?.startsWith("@") && b === "video" && c && /^\d{15,25}$/.test(c)) {
      return base("tiktok", "video", `tiktok:video:${c}`, { mediaId: c, handle: a.slice(1).toLowerCase() });
    }
    if (a?.startsWith("@") && b === "video" && c) {
      problems.push("malformed_video_id");
      return base("tiktok", "video", null, { handle: a.slice(1).toLowerCase() });
    }
    if (a?.startsWith("@")) {
      const handle = a.slice(1).toLowerCase();
      return base("tiktok", "account", `tiktok:account:${handle}`, { handle });
    }
    return base("tiktok", "page", null);
  }
  if (host === "iktok.com" || host === "tiktok.co" || host === "tikok.com") {
    problems.push("misspelled_host");
    return { original, normalized: null, platform: "tiktok", kind: "page", key: null, problems };
  }
  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") id = parts[1] ?? null;
    else id = url.searchParams.get("v");
    if (id && /^[\w-]{6,}$/.test(id)) return base("youtube", "video", `youtube:video:${id}`, { mediaId: id });
    if (parts[0]?.startsWith("@")) {
      const handle = parts[0].slice(1).toLowerCase();
      return base("youtube", "account", `youtube:account:${handle}`, { handle });
    }
    return base("youtube", "page", null);
  }
  if (host.endsWith("pinterest.com") || host === "pin.it" || host === "i.pinimg.com") {
    if (parts[0] === "pin" && parts[1]) return base("pinterest", "post", `pinterest:pin:${parts[1]}`);
    if (host === "i.pinimg.com") return base("pinterest", "file", null);
    return base("pinterest", parts.length >= 2 ? "board" : "account", null);
  }
  if (host === "drive.google.com" || host === "docs.google.com") {
    const fileIdx = parts.indexOf("d");
    if (parts[0] === "drive" && parts[1] === "folders" && parts[2]) return base("google_drive", "folder", `gdrive:${parts[2]}`);
    if (fileIdx >= 0 && parts[fileIdx + 1]) return base("google_drive", "file", `gdrive:${parts[fileIdx + 1]}`);
    return base("google_drive", "file", null);
  }
  return base("other", "page", null);
}

/** Find bare http(s) URLs written as plain text inside a longer string. */
export function findUrlsInText(text: string): { url: string; start: number; end: number }[] {
  const out: { url: string; start: number; end: number }[] = [];
  const re = /https?:\/\/[^\s<>"'()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let url = m[0];
    while (/[.,;:!?)\]]$/.test(url)) url = url.slice(0, -1);
    out.push({ url, start: m.index, end: m.index + url.length });
  }
  return out;
}

export function isSocialVideoUrl(p: ParsedSocialUrl): boolean {
  return (p.platform === "instagram" || p.platform === "tiktok" || p.platform === "youtube") && (p.kind === "video" || p.kind === "post");
}

export function embedFor(p: ParsedSocialUrl): { provider: string; id: string } | null {
  if (!p.mediaId || !/^[A-Za-z0-9_-]{4,64}$/.test(p.mediaId)) return null;
  if (p.platform === "youtube" && p.kind === "video") return { provider: "youtube", id: p.mediaId };
  if (p.platform === "tiktok" && p.kind === "video" && /^\d{15,25}$/.test(p.mediaId)) return { provider: "tiktok", id: p.mediaId };
  if (p.platform === "instagram" && (p.kind === "video" || p.kind === "post")) return { provider: "instagram", id: p.mediaId };
  return null;
}

/** Iframe URL for a stored embed. Built from validated ids only, never from provider HTML. */
export function embedSrc(provider: string | null, id: string | null): string | null {
  if (!provider || !id || !/^[\w-]{4,64}$/.test(id)) return null;
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === "tiktok") return `https://www.tiktok.com/player/v1/${id}?description=1&music_info=1`;
  if (provider === "instagram") return `https://www.instagram.com/p/${id}/embed/`;
  return null;
}

