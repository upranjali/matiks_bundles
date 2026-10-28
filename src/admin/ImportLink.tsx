import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseSocialUrl, embedFor } from '../lib/social-url';
import { useRun, must } from '../lib/components';
import { PERSONAS, RECORD_COLUMNS, type RecordItem, type Week } from '../lib/types';

type Meta = { status: 'fetched' | 'partial' | 'blocked'; title?: string; author?: string; thumbnail_url?: string; error?: string };

/** Asks our server function for public oEmbed details. Any failure returns "blocked"; the entry is already saved. */
async function fetchMeta(url: string): Promise<Meta> {
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/metadata', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return { status: 'blocked', error: res.status === 404 ? 'details service not deployed' : `HTTP ${res.status}` };
    return (await res.json()) as Meta;
  } catch {
    return { status: 'blocked', error: 'couldn’t reach the details service' };
  }
}

export function ImportLink({ weeks, week, records, onSaved }: { weeks: Week[]; week: number; records: RecordItem[]; onSaved: (r: RecordItem) => void }) {
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);
  const [dupe, setDupe] = useState<RecordItem | null>(null);
  const [result, setResult] = useState<RecordItem | null>(null);
  const { busy, run, status } = useRun();
  const p = url.trim() ? parseSocialUrl(url) : null;
  const kindLabel = p ? (p.kind === 'account' ? 'account / profile' : p.kind === 'video' || p.kind === 'post' ? 'single video or post' : p.kind) : '';

  async function submit(form: HTMLFormElement) {
    setDupe(null); setResult(null);
    const raw = url.trim();
    const parsed = parseSocialUrl(raw);
    if (parsed.problems.includes('misspelled_host')) throw new Error('The address looks misspelled (e.g. “iktok.com”). Check it and paste again.');
    if (!parsed.normalized || parsed.problems.includes('not_a_url')) throw new Error('That doesn’t look like a web link. Paste the full https:// address.');
    const existing = records.find((r) => !r.archived && ((parsed.key && r.url_key === parsed.key) || r.url === raw || (r.fields.inspo ?? '').includes(raw)));
    if (existing) { setDupe(existing); return; }

    const fd = new FormData(form);
    const s = (k: string) => String(fd.get(k) ?? '').trim();
    const fields: Record<string, string> = { inspo: raw };
    for (const k of ['hook', 'adapted', 'note', 'caption', 'audio']) if (s(k)) fields[k] = s(k);
    const e = embedFor(parsed);
    const row = must(await supabase.from('records').insert({
      week: s('week') ? Number(s('week')) : null, persona: s('persona'), stage: s('stage') || 'Inspiration', workflow: s('workflow') || 'Dump',
      format: s('format') || 'Uncategorized', title: s('title') || raw, fields, internal_notes: s('internal_notes'),
      tags: s('tags').split(',').map((t) => t.trim()).filter(Boolean),
      url: raw, url_key: parsed.key, platform: parsed.platform, link_kind: parsed.kind, embed_provider: e?.provider ?? null, embed_id: e?.id ?? null,
    }).select(RECORD_COLUMNS).single()) as unknown as RecordItem;
    onSaved(row);
    setResult(row);
    setUrl('');
    form.reset();

    const meta = parsed.kind === 'video' || parsed.kind === 'post' ? await fetchMeta(raw) : { status: 'blocked' as const, error: 'accounts don’t have embeddable details' };
    const updated = must(await supabase.from('records').update({
      metadata_status: meta.status, metadata_error: meta.error ?? null,
      meta_title: meta.title ?? null, meta_author: meta.author ?? (parsed.handle ? `@${parsed.handle}` : null), thumbnail_url: meta.thumbnail_url ?? null,
      ...(meta.title && row.title === raw ? { title: meta.title } : {}),
    }).eq('id', row.id).select(RECORD_COLUMNS).single()) as unknown as RecordItem;
    onSaved(updated);
    setResult(updated);
  }

  async function attach(form: HTMLFormElement) {
    if (!dupe) return;
    const fd = new FormData(form);
    const w = Number(fd.get('week') || 0);
    const persona = String(fd.get('persona') ?? '');
    const also_weeks = w && w !== dupe.week && !dupe.also_weeks.includes(w) ? [...dupe.also_weeks, w] : dupe.also_weeks;
    const also_personas = persona && persona !== dupe.persona && !dupe.also_personas.includes(persona) ? [...dupe.also_personas, persona] : dupe.also_personas;
    const row = must(await supabase.from('records').update({ also_weeks, also_personas }).eq('id', dupe.id).select(RECORD_COLUMNS).single()) as unknown as RecordItem;
    onSaved(row);
    setDupe(null); setUrl('');
  }

  return (
    <div className="panel-card">
      <h3>Add reference · import link</h3>
      <form className="nb-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; run(() => submit(f)); }}>
        <label>Instagram, TikTok, YouTube or any link
          <input type="url" inputMode="url" required value={url} onChange={(e) => { setUrl(e.target.value); setDupe(null); }} placeholder="https://www.tiktok.com/@creator/video/…" />
        </label>
        {p && p.normalized && <span className="nb-hint">{p.platform === 'other' ? 'Other website' : p.platform} · {kindLabel}{p.handle ? ` · @${p.handle}` : ''}</span>}
        <div className="row">
          <label>Week<select name="week" defaultValue={week}><option value="">Pages library (no week)</option>{weeks.map((w) => <option key={w.number} value={w.number}>{w.label}</option>)}</select></label>
          <label>Persona<select name="persona" defaultValue=""><option value="">None</option>{PERSONAS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Format<input name="format" placeholder="e.g. Long text, Hot take" maxLength={80} /></label>
        </div>
        <div className="row">
          <label>Category<select name="stage" defaultValue="Inspiration"><option>Inspiration</option><option>Adapted concepts</option><option>Winners</option></select></label>
          <label>Ideation stage<select name="workflow" defaultValue="Dump"><option>Dump</option><option>Developing</option><option>Approved</option></select></label>
          <label>Tags<input name="tags" placeholder="comma separated" /></label>
        </div>
        <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }}>{open ? 'Hide' : 'Add'} your own hook, notes, caption…</button>
        {open && (
          <>
            <label>Title (optional; otherwise taken from the platform)<input name="title" maxLength={300} /></label>
            <label>Your hook / script<textarea name="hook" /></label>
            <label>Adapted concept<textarea name="adapted" /></label>
            <label>Execution notes<textarea name="note" /></label>
            <div className="row"><label>Caption<textarea name="caption" /></label><label>Audio<textarea name="audio" /></label></div>
            <label>Internal thinking (admins only)<textarea name="internal_notes" /></label>
          </>
        )}
        <div className="btn-row">
          <button className="mock-button" disabled={busy || !url.trim()}>{busy ? 'Saving…' : 'Add reference'}</button>
          {status}
        </div>
        {dupe && (
          <div className="notice" role="status">
            <strong>Already in the library</strong>
            <span>{dupe.meta_title || dupe.title} · {dupe.week ? `Week ${dupe.week}` : 'Pages library'}{dupe.persona ? ` · ${dupe.persona}` : ''}</span>
            <span className="btn-row">
              <button type="button" className="chip" disabled={busy} onClick={(e) => { const f = (e.currentTarget.closest('form')) as HTMLFormElement; run(() => attach(f), 'Attached'); }}>Attach it to the week/persona selected above</button>
            </span>
          </div>
        )}
        {result && (
          <div className={`notice ${result.metadata_status === 'blocked' ? 'white' : 'lime'}`} role="status">
            <strong>Saved</strong>
            <span>{!result.metadata_status ? 'Fetching title and thumbnail…' : result.metadata_status === 'blocked' ? `The platform didn’t share details (${result.metadata_error ?? 'unknown reason'}). The link is saved; add a title under Edit.` : result.metadata_status === 'fetched' ? 'Title and thumbnail fetched from the platform.' : 'Some details fetched from the platform.'}</span>
          </div>
        )}
      </form>
    </div>
  );
}
