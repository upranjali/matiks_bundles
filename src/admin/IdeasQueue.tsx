import React from 'react';
import { supabase } from '../lib/supabase';
import { useRun, must } from '../lib/components';
import { Caption } from '../ui';
import { PERSONAS, RECORD_COLUMNS, type RecordItem, type Workflow } from '../lib/types';

const COLS: { id: Workflow; label: string }[] = [
  { id: 'Dump', label: 'Research dump' },
  { id: 'Developing', label: 'Developing / adapted' },
  { id: 'Approved', label: 'Approved for bundling' },
];

export function IdeasQueue({ week, records, onSaved }: { week: number; records: RecordItem[]; onSaved: (r: RecordItem) => void }) {
  const { busy, run, status } = useRun();
  const items = records.filter((r) => !r.archived && r.workflow && (r.week === week || r.also_weeks.includes(week)));
  async function move(r: RecordItem, to: Workflow) {
    onSaved(must(await supabase.from('records').update({ workflow: to }).eq('id', r.id).select(RECORD_COLUMNS).single()) as unknown as RecordItem);
  }
  return (
    <div className="file-group" style={{ gap: 16 }}>
      <form className="panel-card nb-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); run(async () => {
        const s = (k: string) => String(fd.get(k) ?? '').trim();
        const fields: Record<string, string> = {};
        if (s('hook')) fields.hook = s('hook');
        if (s('inspo')) fields.inspo = s('inspo');
        onSaved(must(await supabase.from('records').insert({ week, stage: 'Adapted concepts', workflow: 'Dump', title: s('title') || s('hook').slice(0, 80), format: s('format') || 'Uncategorized', persona: s('persona'), fields }).select(RECORD_COLUMNS).single()) as unknown as RecordItem);
        f.reset();
      }, 'Idea added'); }}>
        <h3>New idea</h3>
        <div className="row">
          <label>Working title<input name="title" maxLength={300} /></label>
          <label>Format<input name="format" maxLength={80} placeholder="e.g. Hot take" /></label>
          <label>Persona<select name="persona" defaultValue=""><option value="">None</option>{PERSONAS.map((p) => <option key={p}>{p}</option>)}</select></label>
        </div>
        <label>Hook or concept<textarea name="hook" required /></label>
        <label>Reference link(s)<input name="inspo" placeholder="optional; one or more links" /></label>
        <div className="btn-row"><button className="mock-button" disabled={busy}>Add to research dump</button>{status}</div>
      </form>
      <div className="queue">
        {COLS.map((col, ci) => {
          const list = items.filter((r) => r.workflow === col.id);
          return (
            <div key={col.id} className="queue-col">
              <span className={`status status-${col.id.toLowerCase()}`}>{col.label} · {list.length}</span>
              {list.length === 0 && <span className="nb-hint">Nothing here.</span>}
              {list.map((r) => (
                <div key={r.id} className="queue-card">
                  <span className="video-format">{r.format}{r.persona ? ` · ${r.persona}` : ''}</span>
                  <span className="queue-title">{(r.meta_title || r.title || r.fields.hook || 'Untitled').slice(0, 110)}</span>
                  <span className="btn-row">
                    {ci > 0 && <button type="button" className="chip" disabled={busy} onClick={() => run(() => move(r, COLS[ci - 1].id))}>← {COLS[ci - 1].id}</button>}
                    {ci < 2 && <button type="button" className="chip" disabled={busy} onClick={() => run(() => move(r, COLS[ci + 1].id))}>{COLS[ci + 1].id} →</button>}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Caption>Approved ideas show up in the Bundles tab, ready to add as briefs. To put an imported record into the queue, open it in the library, choose Edit and set its ideation stage.</Caption>
    </div>
  );
}
