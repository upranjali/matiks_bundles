import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRun, must, ConfirmButton } from '../lib/components';
import { Caption, Group } from '../ui';
import { RECORD_COLUMNS, fmtDateTime, type RecordItem, type Week } from '../lib/types';

type Admin = { email: string; active: boolean; added_by: string; added_at: string };
type Conflict = { id: string; record_id: string; incoming: Record<string, unknown>; found_at: string };
type Log = { id: number; at: string; actor: string; action: string; entity: string; entity_id: string | null; details: Record<string, unknown> };

export function AdminPanel({ me, weeks, reloadWeeks, allowReal, reloadSettings, records, onSaved }: {
  me: string; weeks: Week[]; reloadWeeks: () => Promise<void>; allowReal: boolean; reloadSettings: () => Promise<void>; records: RecordItem[]; onSaved: (r: RecordItem) => void;
}) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const { busy, run, status } = useRun();

  const load = useCallback(async () => {
    const [a, c, l] = await Promise.all([
      supabase.from('admins').select('email,active,added_by,added_at').order('email'),
      supabase.from('import_conflicts').select('id,record_id,incoming,found_at').is('resolved_at', null),
      supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(80),
    ]);
    setAdmins(must(a)); setConflicts(must(c) as Conflict[]); setLog(must(l) as Log[]);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const nextWeek = Math.max(0, ...weeks.map((w) => w.number)) + 1;
  const review = records.filter((r) => r.needs_review && !r.archived).length;

  return (
    <>
      <Group label="Admins" heading>
        <div className="panel-card">
          {admins.map((a) => (
            <div key={a.email} className="btn-row">
              <span className={`status ${a.active ? 'status-approved' : 'status-dump'}`}>{a.active ? 'Active' : 'Removed'}</span>
              <strong>{a.email}</strong><span className="nb-hint">added by {a.added_by}</span>
              {a.email !== me && <ConfirmButton className="chip" busy={busy} label={a.active ? 'Remove' : 'Restore'} confirm={a.active ? `Remove ${a.email}?` : `Restore ${a.email}?`}
                onConfirm={() => run(async () => { must(await supabase.from('admins').update({ active: !a.active, deactivated_at: a.active ? new Date().toISOString() : null }).eq('email', a.email).select('email').single()); await load(); })} />}
            </div>
          ))}
          <form className="nb-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const email = String(new FormData(f).get('email') ?? '').trim().toLowerCase(); run(async () => {
            must(await supabase.from('admins').insert({ email, added_by: me }).select('email').single());
            f.reset(); await load();
          }, 'Admin added'); }}>
            <div className="row"><label>Add an admin (work email)<input name="email" type="email" required /></label></div>
            <span className="nb-hint">They also need a sign-in account: in Supabase → Authentication → Users → “Invite user” with the same email (sign-ups are switched off, so nobody else can create one).</span>
            <div className="btn-row"><button className="mock-button white" disabled={busy}>Add admin</button>{status}</div>
          </form>
        </div>
      </Group>

      <Group label="Weeks" heading>
        <div className="panel-card">
          <div className="chip-row">{weeks.map((w) => (
            <button key={w.number} type="button" className={`chip ${w.is_current ? 'chip-active' : ''}`} disabled={busy || w.is_current}
              onClick={() => run(async () => { must(await supabase.rpc('set_current_week', { p_week: w.number })); await reloadWeeks(); }, `${w.label} is now current`)}>
              {w.label}{w.is_current ? ' · current' : ' · make current'}
            </button>
          ))}</div>
          <div className="btn-row">
            <button type="button" className="mock-button" disabled={busy} onClick={() => run(async () => { must(await supabase.from('weeks').insert({ number: nextWeek, label: `Week ${nextWeek}` }).select('number').single()); await reloadWeeks(); }, `Week ${nextWeek} added`)}>+ Add Week {nextWeek}</button>
            {status}
          </div>
          <Caption>New weeks start empty. Nothing is copied from earlier weeks unless you duplicate it yourself.</Caption>
        </div>
      </Group>

      <Group label="Import review" heading>
        <div className="panel-card">
          <p className="brief-line">{review} imported record{review === 1 ? '' : 's'} still flagged for a column-mapping check. Use “Needs mapping review” in any library view to work through them.</p>
          {conflicts.length === 0 ? <span className="nb-hint">No re-import conflicts. App edits are never overwritten by a re-import.</span> : conflicts.map((c) => {
            const r = records.find((x) => x.id === c.record_id);
            return (
              <div key={c.id} className="notice white">
                <strong>Sheet changed a record you edited</strong>
                <span>{r?.title ?? c.record_id} · found {fmtDateTime(c.found_at)}</span>
                <details><summary className="file-strong">Compare</summary>
                  <p className="brief-line"><span className="brief-label">In the app now</span>{JSON.stringify({ title: r?.title, fields: r?.fields })}</p>
                  <p className="brief-line"><span className="brief-label">From the sheet</span>{JSON.stringify({ title: c.incoming.title, fields: c.incoming.fields })}</p>
                </details>
                <span className="btn-row">
                  <button type="button" className="chip" disabled={busy} onClick={() => run(async () => {
                    const inc = c.incoming as Record<string, unknown>;
                    const row = must(await supabase.from('records').update({ week: inc.week, persona: inc.persona, stage: inc.stage, format: inc.format, title: inc.title, fields: inc.fields, extras: inc.extras, needs_review: inc.needs_review, sources: inc.sources, seed: inc }).eq('id', c.record_id).select(RECORD_COLUMNS).single());
                    onSaved(row as unknown as RecordItem);
                    must(await supabase.from('import_conflicts').update({ resolved_at: new Date().toISOString(), resolved_by: me, resolution: 'took_sheet' }).eq('id', c.id).select('id').single());
                    await load();
                  })}>Use the sheet version</button>
                  <button type="button" className="chip" disabled={busy} onClick={() => run(async () => {
                    must(await supabase.from('import_conflicts').update({ resolved_at: new Date().toISOString(), resolved_by: me, resolution: 'kept_app' }).eq('id', c.id).select('id').single());
                    await load();
                  })}>Keep the app version</button>
                </span>
              </div>
            );
          })}
        </div>
      </Group>

      <Group label="Creator sharing" heading>
        <div className="panel-card">
          <p className="brief-line">{allowReal ? 'Real creators can be added and given links.' : 'Staging mode: only test creators can be added and given links.'}</p>
          <ConfirmButton className={allowReal ? 'chip' : 'mock-button'} busy={busy} label={allowReal ? 'Switch back to test creators only' : 'Approve sharing with real creators'}
            confirm={allowReal ? 'Block new real creators again?' : 'Allow real creators? Links you send will show them their published briefs.'}
            onConfirm={() => run(async () => { must(await supabase.from('settings').update({ value: !allowReal, updated_by: me, updated_at: new Date().toISOString() }).eq('key', 'allow_real_creators').select('key').single()); await reloadSettings(); })} />
          <Caption>This only controls whether non-test creators can be created. Links are never sent automatically; you copy and send each one.</Caption>
        </div>
      </Group>

      <Group label="Activity log" heading>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th></tr></thead><tbody>
          {log.map((l) => <tr key={l.id}><td>{fmtDateTime(l.at)}</td><td>{l.actor.startsWith('creator:') ? 'creator link' : l.actor}</td><td>{l.action}{Array.isArray(l.details?.fields) ? ` (${(l.details.fields as string[]).join(', ')})` : l.details?.version ? ` v${String(l.details.version)}` : ''}</td><td>{l.entity}</td></tr>)}
        </tbody></table></div>
      </Group>
    </>
  );
}
