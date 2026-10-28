import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRun, must, ConfirmButton, CopyButton } from '../lib/components';
import { Caption } from '../ui';
import { CREATOR_STATUSES, fmtDateTime, type Creator } from '../lib/types';

type Link = { id: string; creator_id: string; token_hint: string; created_at: string; revoked_at: string | null; last_used_at: string | null };
type Assign = { creator_id: string; bundle_id: string; bundles: { week: number; number: number; title: string; current_version: number | null } | null };

/** 256-bit random token; only its SHA-256 is stored, so the link can be shown exactly once. */
async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return { token, hashHex: '\\x' + Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join(''), hint: token.slice(-4) };
}

export function CreatorsPanel({ creators, reloadCreators, allowReal, onPreview }: { creators: Creator[]; reloadCreators: () => Promise<void>; allowReal: boolean; onPreview: (id: string) => void }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [assigns, setAssigns] = useState<Assign[]>([]);
  const [statuses, setStatuses] = useState<{ creator_id: string; bundle_id: string; status: number }[]>([]);
  const [shown, setShown] = useState<{ creator: string; url: string } | null>(null);
  const { busy, run, status } = useRun();

  const load = useCallback(async () => {
    const [l, a, s] = await Promise.all([
      supabase.from('creator_links').select('id,creator_id,token_hint,created_at,revoked_at,last_used_at').order('created_at', { ascending: false }),
      supabase.from('creator_assignments').select('creator_id,bundle_id,bundles(week,number,title,current_version)').is('removed_at', null),
      supabase.from('creator_bundle_status').select('creator_id,bundle_id,status'),
    ]);
    setLinks(must(l) as Link[]);
    setAssigns(must(a) as unknown as Assign[]);
    setStatuses(must(s));
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function issue(c: Creator) {
    const t = await newToken();
    must(await supabase.from('creator_links').update({ revoked_at: new Date().toISOString(), revoked_by: (await supabase.auth.getUser()).data.user?.email ?? 'admin' }).eq('creator_id', c.id).is('revoked_at', null).select('id'));
    must(await supabase.from('creator_links').insert({ creator_id: c.id, token_hash: t.hashHex, token_hint: t.hint }).select('id').single());
    setShown({ creator: c.id, url: `${window.location.origin}/c#${t.token}` });
    await load();
  }
  async function revoke(c: Creator) {
    must(await supabase.from('creator_links').update({ revoked_at: new Date().toISOString(), revoked_by: (await supabase.auth.getUser()).data.user?.email ?? 'admin' }).eq('creator_id', c.id).is('revoked_at', null).select('id'));
    if (shown?.creator === c.id) setShown(null);
    await load();
  }

  return (
    <div className="file-group">
      {!allowReal && <div className="notice lime"><strong>Staging: test creators only</strong><span>Real creator links stay switched off until you approve sharing (Admin tab). Nothing is sent to anyone automatically: you copy each link and send it yourself.</span></div>}
      <form className="panel-card nb-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); run(async () => {
        must(await supabase.from('creators').insert({ display_name: String(fd.get('name') ?? '').trim(), is_test: allowReal ? fd.get('is_test') === 'on' : true, internal_notes: String(fd.get('notes') ?? '') }).select('id').single());
        f.reset(); await reloadCreators();
      }, 'Creator added'); }}>
        <h3>Add a {allowReal ? '' : 'test '}creator</h3>
        <div className="row">
          <label>Name shown on their page<input name="name" required maxLength={80} placeholder={allowReal ? '' : 'e.g. Test creator A'} /></label>
          <label>Internal note (admins only)<input name="notes" maxLength={2000} /></label>
        </div>
        {allowReal && <label className="check"><input type="checkbox" name="is_test" defaultChecked /> Test creator</label>}
        <div className="btn-row"><button className="mock-button" disabled={busy}>Add creator</button>{status}</div>
      </form>

      <div className="legend">{CREATOR_STATUSES.map((s, i) => <span key={s} className="legend-item"><span className={`dot dot-${i}`} />{s}</span>)}</div>

      {creators.length === 0 ? <div className="archive-empty"><h3>No creators yet</h3><p>Add a test creator, assign them to a published bundle, then open their link in a private window to see exactly what they see.</p></div> : creators.map((c) => {
        const link = links.find((l) => l.creator_id === c.id && !l.revoked_at);
        const used = links.filter((l) => l.creator_id === c.id).map((l) => l.last_used_at).filter(Boolean).sort().at(-1);
        const mine = assigns.filter((a) => a.creator_id === c.id && a.bundles);
        return (
          <div key={c.id} className="assign-group panel-card">
            <p className="assign-head"><strong>{c.display_name}</strong> · {c.is_test ? 'test creator' : 'real creator'}{!c.active ? ' · inactive' : ''}</p>
            {c.internal_notes && <span className="nb-hint">{c.internal_notes}</span>}
            <div className="assign-chips">
              {mine.length === 0 ? <span className="nb-hint">No bundles assigned. Assign from a bundle under Bundles.</span> : mine.map((a) => {
                const st = statuses.find((s) => s.creator_id === c.id && s.bundle_id === a.bundle_id)?.status;
                return <span key={a.bundle_id} className="creator-pill"><span className={`dot dot-${st ?? 0}`} />Week {a.bundles!.week} · {a.bundles!.title || `Bundle ${a.bundles!.number}`} · {a.bundles!.current_version ? `v${a.bundles!.current_version}` : 'not published'}{st !== undefined ? ` · ${CREATOR_STATUSES[st]}` : ''}</span>;
              })}
            </div>
            <div className="btn-row">
              {link ? <span className="status status-approved">Link active · …{link.token_hint}</span> : <span className="status status-dump">No active link</span>}
              <span className="nb-hint">{used ? `Last opened ${fmtDateTime(used)}` : 'Never opened'}</span>
            </div>
            <div className="btn-row">
              {link ? <ConfirmButton className="chip" busy={busy || !c.active} label="Rotate link" confirm="New link? The current one stops working now." onConfirm={() => run(() => issue(c))} />
                : <button type="button" className="chip" disabled={busy || !c.active} onClick={() => run(() => issue(c))}>Create link</button>}
              {link && <ConfirmButton className="chip danger" busy={busy} label="Revoke" confirm="Revoke? The link stops working now." onConfirm={() => run(() => revoke(c), 'Revoked')} />}
              <button type="button" className="chip" onClick={() => onPreview(c.id)}>Preview their view</button>
              <ConfirmButton className="chip" busy={busy} label={c.active ? 'Deactivate' : 'Reactivate'} confirm={c.active ? 'Deactivate? Their link stops working until reactivated.' : 'Reactivate?'}
                onConfirm={() => run(async () => { must(await supabase.from('creators').update({ active: !c.active }).eq('id', c.id).select('id').single()); await reloadCreators(); })} />
            </div>
            {shown?.creator === c.id && (
              <div className="notice white" role="status">
                <strong>New link (shown once; copy it now)</strong>
                <span className="link-box">{shown.url}</span>
                <span className="btn-row"><CopyButton text={shown.url} label="Copy link" /></span>
                <span className="nb-hint">Anyone with this link can see {c.display_name}’s published briefs and act as them (comments, done, progress). Send it privately. If it gets forwarded, rotate it.</span>
              </div>
            )}
          </div>
        );
      })}
      <Caption>Links are stored only as a fingerprint (hash), so a lost link can’t be recovered, only replaced. Progress shown here is what creators saved themselves; “Approved” is set by an admin on the bundle.</Caption>
    </div>
  );
}
