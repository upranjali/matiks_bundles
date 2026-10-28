import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRun, must, ConfirmButton } from '../lib/components';
import { PERSONAS, RECORD_COLUMNS, STAGES, type RecordItem } from '../lib/types';

export const FIELD_KEYS: [string, string][] = [
  ['inspo', 'Inspo / reference links'],
  ['summary', 'Reference summary (what it is)'],
  ['hook', 'Hook / script'],
  ['adapted', 'Adapted concept'],
  ['onscreen', 'On-screen text'],
  ['note', 'Notes / execution'],
  ['caption', 'Caption'],
  ['audio', 'Audio'],
  ['analysis', 'Analysis'],
  ['stats', 'Source stats (as written)'],
  ['product', 'Product'],
  ['account', 'Account context'],
];

export function RecordEditor({ record: r, onSaved }: { record: RecordItem; onSaved: (r: RecordItem | null, id?: string) => void }) {
  const [fields, setFields] = useState<Record<string, string>>({ ...r.fields });
  const [extras, setExtras] = useState(r.extras ?? []);
  const { busy, run, status } = useRun();

  async function save(form: HTMLFormElement) {
    const fd = new FormData(form);
    const s = (k: string) => String(fd.get(k) ?? '');
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ''));
    const week = s('week') === '' ? null : Number(s('week'));
    const patch = {
      title: s('title').slice(0, 300), stage: s('stage'), workflow: s('workflow') || null, persona: s('persona'),
      format: s('format').trim() || 'Uncategorized', week, fields: clean, extras, needs_review: fd.get('needs_review') === 'on',
      internal_notes: s('internal_notes'), tags: s('tags').split(',').map((t) => t.trim()).filter(Boolean),
      meta_title: s('meta_title').trim() || null, meta_author: s('meta_author').trim() || null,
      thumbnail_url: s('thumbnail_url').trim() || null,
      ...(r.metadata_status === 'blocked' && (s('meta_title').trim() || s('thumbnail_url').trim()) ? { metadata_status: 'manual' } : {}),
    };
    if (patch.thumbnail_url && !/^https:\/\//.test(patch.thumbnail_url)) throw new Error('Thumbnail must be an https:// image link.');
    const row = must(await supabase.from('records').update(patch).eq('id', r.id).select(RECORD_COLUMNS).single());
    onSaved(row as unknown as RecordItem);
  }

  return (
    <form className="nb-form" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; run(() => save(f), 'Saved'); }}>
      <label>Title<input name="title" defaultValue={r.title} maxLength={300} /></label>
      <div className="row">
        <label>Category<select name="stage" defaultValue={r.stage}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Ideation stage<select name="workflow" defaultValue={r.workflow ?? ''}><option value="">Not in the queue</option><option>Dump</option><option>Developing</option><option>Approved</option></select></label>
      </div>
      <div className="row">
        <label>Persona<select name="persona" defaultValue={r.persona}><option value="">None</option>{PERSONAS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Format<input name="format" defaultValue={r.format} maxLength={80} /></label>
        <label>Week<input name="week" type="number" min={1} defaultValue={r.week ?? ''} placeholder="blank = pages library" /></label>
      </div>
      {FIELD_KEYS.map(([k, label]) => (
        (k in fields || ['hook', 'note', 'caption', 'audio', 'inspo'].includes(k) || (k === 'stats' && r.stage === 'Winners') || (k === 'analysis' && r.stage === 'Winners') || (k === 'adapted' && r.stage !== 'Winners')) && (
          <label key={k}>{label}<textarea value={fields[k] ?? ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} className={k === 'hook' ? 'tall' : ''} /></label>
        )
      ))}
      {extras.length > 0 && (
        <div className="panel-card">
          <span className="brief-label">Unmapped source cells</span>
          {extras.map((x, i) => (
            <div key={i} className="nb-form" style={{ gap: 6 }}>
              <span className="brief-line"><span className="brief-label">Column {x.column}</span>{x.value}</span>
              <div className="btn-row">
                <select className="nb-input" style={{ width: 'auto' }} defaultValue="" aria-label={`Move column ${x.column} into a field`} onChange={(e) => {
                  const k = e.target.value; if (!k) return;
                  setFields({ ...fields, [k]: fields[k] ? `${fields[k]}\n\n${x.value}` : x.value });
                  setExtras(extras.filter((_, j) => j !== i));
                }}>
                  <option value="">Move into field…</option>{FIELD_KEYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
          ))}
          <span className="nb-hint">Moving a cell only changes this record after you save.</span>
        </div>
      )}
      {(r.url || r.metadata_status) && (
        <div className="row">
          <label>Title from platform / your own<input name="meta_title" defaultValue={r.meta_title ?? ''} /></label>
          <label>Creator / account<input name="meta_author" defaultValue={r.meta_author ?? ''} /></label>
          <label>Thumbnail image (https)<input name="thumbnail_url" type="url" defaultValue={r.thumbnail_url ?? ''} /></label>
        </div>
      )}
      <label>Internal thinking (admins only, never shown to creators)<textarea name="internal_notes" defaultValue={r.internal_notes} /></label>
      <label>Tags (comma separated)<input name="tags" defaultValue={r.tags.join(', ')} /></label>
      <label className="check"><input type="checkbox" name="needs_review" defaultChecked={r.needs_review} /> Column mapping still needs checking</label>
      <div className="btn-row">
        <button className="mock-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <ConfirmButton label="Archive" confirm="Hide this record from the library?" busy={busy} onConfirm={() => run(async () => {
          must(await supabase.from('records').update({ archived: true }).eq('id', r.id).select('id').single());
          onSaved(null, r.id);
        })} />
        {status}
      </div>
    </form>
  );
}
