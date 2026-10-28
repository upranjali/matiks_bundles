import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Callout, Closing, FileCard, Header } from '../ui';
import matiksIcon from '../photos/matiks-icon.jpg';
import { supabase, configured } from '../lib/supabase';
import type { Feed } from '../lib/types';
import { BundleView, type CreatorActions } from './CreatorBriefs';

const POLL_MS = 60_000;

/** Token lives in the URL fragment (/c#…), so it never reaches server logs or Referer headers. */
function readToken() {
  const t = window.location.hash.replace(/^#/, '');
  return /^[A-Za-z0-9_-]{32,128}$/.test(t) ? t : null;
}

function rpcError(e: { message?: string; code?: string }) {
  if (e.code === '28000') return 'This link is no longer active. Ask the Matiks team for your current link.';
  if (e.code === '54000' || e.code === '22023') return e.message ?? 'Check what you entered.';
  if (e.code === 'P0002') return 'That brief isn’t available anymore. Refresh the page.';
  return 'Couldn’t save. Check your connection and try again.';
}

export function CreatorPage() {
  const token = useMemo(readToken, []);
  const [feed, setFeed] = useState<Feed | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [week, setWeek] = useState<number | null>(null);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fp = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!token) { setFeed(null); return; }
    const { data, error } = await supabase.rpc('creator_feed', { p_token: token });
    if (error) { setFailed(true); return; }
    setFailed(false);
    setFeed(data as Feed | null);
    fp.current = (data as Feed | null)?.fingerprint ?? null;
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Automatic updates: cheap fingerprint check every minute and when the tab comes back.
  useEffect(() => {
    if (!token) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data, error } = await supabase.rpc('creator_fingerprint', { p_token: token });
      if (error) return;
      if (data === null) { setFeed(null); return; }
      if (fp.current !== null && data !== fp.current) { setNotice('New briefs or updates were just published. They’re loaded below.'); await load(); }
    };
    const t = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, [token, load]);

  const weeks = useMemo(() => [...new Set((feed?.bundles ?? []).map((b) => b.content.week))].sort((a, b) => b - a), [feed]);
  const activeWeek = week ?? weeks[0] ?? null;
  const inWeek = (feed?.bundles ?? []).filter((b) => b.content.week === activeWeek);
  const bundle = inWeek.find((b) => b.bundle_id === bundleId) ?? inWeek[0] ?? null;

  const actions: CreatorActions | null = token ? {
    async setStatus(bundle, status) { const { error } = await supabase.rpc('creator_set_status', { p_token: token, p_bundle: bundle, p_status: status }); if (error) throw new Error(rpcError(error)); },
    async setDone(bundle, brief, done) { const { data, error } = await supabase.rpc('creator_set_done', { p_token: token, p_bundle: bundle, p_brief: brief, p_done: done }); if (error) throw new Error(rpcError(error)); return data; },
    async addComment(bundle, brief, body) { const { data, error } = await supabase.rpc('creator_add_comment', { p_token: token, p_bundle: bundle, p_brief: brief, p_body: body }); if (error) throw new Error(rpcError(error)); return data; },
    async markSeen(bundle, version) { const { error } = await supabase.rpc('creator_mark_seen', { p_token: token, p_bundle: bundle, p_version: version }); if (error) throw new Error(rpcError(error)); },
  } : null;

  return (
    <FileCard>
      <div className="brand-row">
        <img src={matiksIcon} alt="Matiks logo" className="brand-logo" />
        <span className="brand-name">Matiks Creator Hub</span>
        <span className="seros-sticker">seros was here ✦</span>
      </div>

      {!configured ? (
        <Callout title="Not set up yet" tone="note">This site isn’t connected to its database yet.</Callout>
      ) : failed ? (
        <Callout title="Couldn’t load your briefs" tone="note">Refresh the page in a minute.</Callout>
      ) : feed === undefined ? (
        <p className="loading" role="status">Loading your briefs…</p>
      ) : feed === null ? (
        <Header title="Link not active" intro="This link doesn’t work anymore, or it was copied incompletely. Ask the Matiks team for your current link." />
      ) : (
        <>
          <Header title={`Hi ${feed.creator.name}`} intro="Your published briefs from the Matiks team. This page updates by itself when something new is published." />
          {notice && <div className="notice lime" role="status"><span>{notice}</span><span className="btn-row"><button type="button" className="chip" onClick={() => setNotice(null)}>Dismiss</button></span></div>}
          {feed.bundles.length === 0 ? (
            <div className="archive-empty"><h3>Nothing here yet</h3><p>No bundle has been published for you yet. Keep this page; it fills in on its own.</p></div>
          ) : (
            <>
              {weeks.length > 1 && (
                <div className="week-picker"><label htmlFor="cw">Week</label>
                  <select id="cw" value={activeWeek ?? ''} onChange={(e) => { setWeek(Number(e.target.value)); setBundleId(null); }}>
                    {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
                  </select>
                </div>
              )}
              {inWeek.length > 1 && (
                <div className="chip-row">
                  {inWeek.map((b) => {
                    const fresh = b.last_seen_version === null || b.last_seen_version < b.version;
                    return <button key={b.bundle_id} type="button" className={`chip ${bundle?.bundle_id === b.bundle_id ? 'chip-active' : ''}`} onClick={() => setBundleId(b.bundle_id)}>{b.content.title || `Bundle ${b.content.bundle}`}{fresh ? ' •' : ''}</button>;
                  })}
                </div>
              )}
              {bundle && <BundleView key={`${bundle.bundle_id}:${bundle.version}`} b={bundle} actions={actions} />}
            </>
          )}
          <Callout title="Only your bundles" tone="note">
            This link shows only the bundles the Matiks team assigned to you. It works like a key: anyone you forward it to can open it and act as you, so keep it private.
          </Callout>
        </>
      )}
      <Closing>Matiks Creator Hub · creator briefs</Closing>
    </FileCard>
  );
}
