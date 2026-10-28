import React from 'react';
import { supabase } from '../lib/supabase';
import { useRun, must } from '../lib/components';
import type { RecordItem } from '../lib/types';

export type Metric = { id: string; record_id: string; metric: string; value: number | null; value_text: string; observed_on: string | null; source: string; recorded_at: string; recorded_by: string };

/** Recorded performance numbers for a winner: only what an admin enters, with the date it was seen and where. */
export function WinnerMetrics({ record, metrics, onChange }: { record: RecordItem; metrics: Metric[]; onChange: () => void }) {
  const { busy, run, status } = useRun();
  const mine = metrics.filter((m) => m.record_id === record.id);
  return (
    <div className="brief-comments">
      <span className="brief-label">Recorded metrics</span>
      {record.fields.stats && <p className="winner-stats" style={{ margin: 0 }}>From the sheet (as written, not re-checked): {record.fields.stats}</p>}
      {mine.length === 0 ? <span className="nb-hint">No metrics recorded in the app yet.</span> : (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Metric</th><th>Value</th><th>Seen on</th><th>Source</th><th>Recorded</th></tr></thead><tbody>
          {mine.map((m) => <tr key={m.id}><td>{m.metric}</td><td>{m.value !== null ? m.value.toLocaleString() : ''} {m.value_text}</td><td>{m.observed_on ?? 'not given'}</td><td>{m.source}</td><td>{m.recorded_by}</td></tr>)}
        </tbody></table></div>
      )}
      <form className="nb-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); run(async () => {
        const v = String(fd.get('value') ?? '').trim();
        must(await supabase.from('winner_metrics').insert({
          record_id: record.id, metric: String(fd.get('metric')), value: v ? Number(v) : null, value_text: String(fd.get('value_text') ?? ''),
          observed_on: String(fd.get('observed_on') ?? '') || null, source: String(fd.get('source') ?? '').trim(),
        }).select('id').single());
        f.reset(); onChange();
      }, 'Metric saved'); }}>
        <div className="row">
          <label>Metric<select name="metric"><option>views</option><option>likes</option><option>comments</option><option>shares</option><option>saves</option><option>followers</option><option>note</option></select></label>
          <label>Number<input name="value" type="number" min={0} step="any" /></label>
          <label>Date you saw it<input name="observed_on" type="date" /></label>
        </div>
        <div className="row">
          <label>Where it came from (required)<input name="source" required placeholder="e.g. TikTok analytics, checked by Meenal" /></label>
          <label>Note<input name="value_text" placeholder="optional" /></label>
        </div>
        <div className="btn-row"><button className="chip" disabled={busy}>Add metric</button>{status}</div>
      </form>
    </div>
  );
}
