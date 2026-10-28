import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRun, must, ConfirmButton } from '../lib/components';
import { Caption } from '../ui';
import { CREATOR_STATUSES, fmtDate, fmtDateTime, type Brief, type Bundle, type Creator, type RecordItem, type Version } from '../lib/types';

const BRIEF_FIELDS = ['format', 'title', 'inspo', 'onscreen', 'script', 'alternate_hooks', 'note', 'caption', 'audio', 'posting_notes'] as const;
const LABEL: Record<(typeof BRIEF_FIELDS)[number], string> = { format: 'Format', title: 'Title', inspo: 'Inspo links', onscreen: 'On-screen text', script: 'Script', alternate_hooks: 'Alternate hooks', note: 'Note', caption: 'Caption', audio: 'Audio', posting_notes: 'Posting notes' };

type Activity = {
  assignments: { creator_id: string; bundle_id: string }[];
  statuses: { creator_id: string; bundle_id: string; status: number }[];
  progress: { creator_id: string; brief_key: string; done: boolean; done_brief_hash: string | null }[];
  comments: { id: string; creator_id: string; brief_key: string; body: string; version: number; created_at: string; hidden: boolean }[];
};

const inspoText = (b: Brief) => b.inspo.map((i) => (i.label ? `${i.label} | ${i.url}` : i.url)).join('\n');
const parseInspo = (t: string) => t.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line) => {
  const m = line.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/);
  const v = m ? { label: m[1].trim(), url: m[2] } : { url: line };
  if (!/^https?:\/\/\S+$/.test(v.url)) throw new Error(`“${line.slice(0, 60)}” isn’t a full http(s) link.`);
  return v;
});

export function BundlesPanel({ week, weekLabel, records, creators }: { week: number; weekLabel: string; records: RecordItem[]; creators: Creator[] }) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [act, setAct] = useState<Activity>({ assignments: [], statuses: [], progress: [], comments: [] });
  const [sel, setSel] = useState<string | null>(null);
  const { busy, run, status } = useRun();

  const load = useCallback(async () => {
    const bs = must(await supabase.from('bundles').select('*').eq('week', week).order('number')) as Bundle[];
    const ids = bs.map((b) => b.id);
    const none = ['00000000-0000-0000-0000-000000000000'];
    const [br, vs, as, st, pr, cm] = await Promise.all([
      supabase.from('bundle_briefs').select('*').in('bundle_id', ids.length ? ids : none).order('position'),
      supabase.from('bundle_versions').select('bundle_id,version,content,change_summary,published_at,published_by').in('bundle_id', ids.length ? ids : none).order('version', { ascending: false }),
      supabase.from('creator_assignments').select('creator_id,bundle_id').in('bundle_id', ids.length ? ids : none).is('removed_at', null),
      supabase.from('creator_bundle_status').select('creator_id,bundle_id,status').in('bundle_id', ids.length ? ids : none),
      supabase.from('brief_progress').select('creator_id,brief_key,done,done_brief_hash').in('bundle_id', ids.length ? ids : none),
      supabase.from('brief_comments').select('id,creator_id,brief_key,body,version,created_at,hidden').in('bundle_id', ids.length ? ids : none).order('created_at'),
    ]);
    setBundles(bs);
    setBriefs(must(br) as Brief[]);
    setVersions(must(vs) as Version[]);
    setAct({ assignments: must(as), statuses: must(st), progress: must(pr), comments: must(cm) } as Activity);
    setSel((s) => (s && bs.some((b) => b.id === s) ? s : bs[0]?.id ?? null));
  }, [week]);
  useEffect(() => { setBundles(null); load().catch(() => setBundles([])); }, [load]);

  const bundle = bundles?.find((b) => b.id === sel) ?? null;
  const next = Math.max(0, ...(bundles ?? []).map((b) => b.number)) + 1;

  if (bundles === null) return <p className="loading" role="status">Loading bundles…</p>;
  return (
    <div className="file-group">
      <div className="btn-row">
        <button type="button" className="mock-button" disabled={busy} onClick={() => run(async () => {
          const b = must(await supabase.from('bundles').insert({ week, number: next, title: `Bundle ${next}` }).select('*').single()) as Bundle;
          await load(); setSel(b.id);
        }, `Bundle ${next} created`)}>+ Bundle {next}</button>
        {status}
      </div>
      {bundles.length === 0 ? (
        <div className="archive-empty"><h3>{week === 20 ? 'Week 20 is a blank canvas' : `No bundles in ${weekLabel} yet`}</h3><p>Create Bundle 1, then add briefs from approved ideas or write them here. Nothing is filled in from older weeks.</p></div>
      ) : (
        <div className="bundle-grid">
          {bundles.map((b) => {
            const bb = briefs.filter((x) => x.bundle_id === b.id && !x.removed);
            const n = act.assignments.filter((a) => a.bundle_id === b.id).length;
            const v = versions.find((x) => x.bundle_id === b.id);
            return (
              <button key={b.id} type="button" className={`bundle-card ${sel === b.id ? 'is-selected' : ''}`} onClick={() => setSel(b.id)} aria-pressed={sel === b.id}>
                <div className="bundle-head"><strong>{b.title || `Bundle ${b.number}`}</strong><span className={`bundle-version ${v ? 'bundle-frozen' : 'bundle-draft'}`}>{v ? `Published v${v.version} · ${fmtDate(v.published_at)}` : 'Draft · not published'}</span></div>
                <p className="bundle-state">{bb.length} brief{bb.length === 1 ? '' : 's'} · {n} creator{n === 1 ? '' : 's'}</p>
                <ol className="bundle-list">{bb.slice(0, 8).map((x) => <li key={x.id}>{x.format && <span className="video-format">{x.format} </span>}{x.title || x.script.slice(0, 50) || 'Untitled brief'}</li>)}</ol>
              </button>
            );
          })}
        </div>
      )}
      {bundle && (
        <BundleEditor key={bundle.id} bundle={bundle} briefs={briefs.filter((b) => b.bundle_id === bundle.id)} versions={versions.filter((v) => v.bundle_id === bundle.id)}
          records={records.filter((r) => !r.archived && (r.week === week || r.also_weeks.includes(week)) && r.workflow === 'Approved')}
          creators={creators} act={act} reload={load} />
      )}
    </div>
  );
}

function BundleEditor({ bundle, briefs, versions, records, creators, act, reload }: { bundle: Bundle; briefs: Brief[]; versions: Version[]; records: RecordItem[]; creators: Creator[]; act: Activity; reload: () => Promise<void> }) {
  const live = briefs.filter((b) => !b.removed).sort((a, b) => a.position - b.position);
  const removed = briefs.filter((b) => b.removed);
  const last = versions[0] ?? null;
  const { busy, run, status } = useRun();
  const [summary, setSummary] = useState('');

  const diff = useMemo(() => {
    if (!last) return null;
    const prev = new Map(last.content.briefs.map((b) => [b.key, b]));
    const added = live.filter((b) => !prev.has(b.id));
    const changed = live.filter((b) => prev.has(b.id)).map((b) => ({ b, fields: BRIEF_FIELDS.filter((f) => JSON.stringify(b[f]) !== JSON.stringify((prev.get(b.id) as Record<string, unknown>)[f])) })).filter((x) => x.fields.length);
    const liveIds = new Set(live.map((b) => b.id));
    const gone = last.content.briefs.filter((b) => !liveIds.has(b.key));
    const order = last.content.briefs.map((b) => b.key).filter((k) => liveIds.has(k)).join() !== live.map((b) => b.id).filter((k) => prev.has(k)).join();
    const meta = [bundle.title !== last.content.title && 'Bundle title', bundle.posting_instructions !== last.content.posting_instructions && 'Posting instructions'].filter(Boolean) as string[];
    return { added, changed, gone, order, meta, none: !added.length && !changed.length && !gone.length && !order && !meta.length };
  }, [live, last, bundle]);

  async function addBrief(rec?: RecordItem) {
    const position = (live.at(-1)?.position ?? 0) + 1;
    const f = rec?.fields ?? {};
    const urls = Array.from(new Set([...(rec?.url ? [rec.url] : []), ...((f.inspo || '').match(/https?:\/\/[^\s]+/g) || [])]));
    must(await supabase.from('bundle_briefs').insert({
      bundle_id: bundle.id, position, source_record_id: rec?.id ?? null, format: rec?.format && rec.format !== 'Uncategorized' ? rec.format : '',
      title: rec ? (rec.meta_title || rec.title).slice(0, 120) : '', inspo: urls.map((url) => ({ url })), onscreen: f.onscreen ?? '',
      script: f.hook ?? f.adapted ?? '', note: f.note ?? '', caption: f.caption ?? '', audio: f.audio ?? '',
    }).select('id').single());
    await reload();
  }

  async function move(b: Brief, dir: -1 | 1) {
    const arr = [...live];
    const i = arr.findIndex((x) => x.id === b.id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    for (let k = 0; k < arr.length; k++) if (arr[k].position !== k + 1) must(await supabase.from('bundle_briefs').update({ position: k + 1 }).eq('id', arr[k].id).select('id').single());
    await reload();
  }

  const assigned = new Set(act.assignments.filter((a) => a.bundle_id === bundle.id).map((a) => a.creator_id));
  const lastHash = new Map((last?.content.briefs ?? []).map((b) => [b.key, b.hash]));

  return (
    <div className="bundle-editor">
      <div className="file-group" style={{ gap: 16 }}>
        <form className="panel-card nb-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => {
          must(await supabase.from('bundles').update({ title: String(fd.get('title') ?? '').slice(0, 120), posting_instructions: String(fd.get('pi') ?? '').slice(0, 5000) }).eq('id', bundle.id).select('id').single());
          await reload();
        }, 'Saved'); }}>
          <h3>{bundle.title || `Bundle ${bundle.number}`} · draft</h3>
          <label>Title shown to creators<input name="title" defaultValue={bundle.title} maxLength={120} /></label>
          <label>Posting instructions<textarea name="pi" defaultValue={bundle.posting_instructions} placeholder="e.g. Subtitles on every video. Use Pinterest images for b-roll. Put this link in your bio: Brain Rot Meter." /></label>
          <div className="btn-row"><button className="mock-button white" disabled={busy}>Save details</button>{status}</div>
        </form>

        <p className="file-group-label">Briefs ({live.length}). Edits stay in this draft until you publish.</p>
        {live.length === 0 && <div className="archive-empty"><h3>No briefs yet</h3><p>Add a blank brief, or pull one from an approved idea on the right.</p></div>}
        {live.map((b, i) => (
          <BriefEditor key={b.id} b={b} n={i + 1} count={live.length}
            state={!last ? 'Not published yet' : !lastHash.has(b.id) ? 'New since last publish' : diff?.changed.some((c) => c.b.id === b.id) ? 'Edited since last publish' : 'Same as published'}
            activity={creators.filter((c) => assigned.has(c.id)).map((c) => {
              const p = act.progress.find((x) => x.creator_id === c.id && x.brief_key === b.id);
              return { name: c.display_name, done: !!p?.done, stale: !!p?.done && p.done_brief_hash !== lastHash.get(b.id) };
            })}
            comments={act.comments.filter((c) => c.brief_key === b.id).map((c) => ({ ...c, name: creators.find((x) => x.id === c.creator_id)?.display_name ?? 'Creator' }))}
            onMove={(d) => run(() => move(b, d))} reload={reload} />
        ))}
        <div className="btn-row"><button type="button" className="mock-button lime" disabled={busy} onClick={() => run(() => addBrief())}>+ Blank brief</button></div>
        {removed.length > 0 && (
          <details className="panel-card"><summary className="file-strong">Removed briefs ({removed.length})</summary>
            {removed.map((b) => <div key={b.id} className="btn-row"><span>{b.title || b.script.slice(0, 60) || 'Untitled'}</span><button type="button" className="chip" onClick={() => run(async () => { must(await supabase.from('bundle_briefs').update({ removed: false }).eq('id', b.id).select('id').single()); await reload(); })}>Restore</button></div>)}
          </details>
        )}
      </div>

      <div className="file-group" style={{ gap: 16 }}>
        <div className="panel-card">
          <h3>{last ? `Publish v${last.version + 1}` : 'Publish v1'}</h3>
          {!last ? <p className="brief-line">Publishing freezes this draft as v1 and shows it to the assigned creators.</p>
            : diff?.none ? <p className="brief-line">The draft matches v{last.version}. Nothing to publish.</p>
            : <ul className="diff-list">
                {diff?.added.map((b) => <li key={b.id}><strong>New:</strong> {b.title || b.script.slice(0, 50) || 'Untitled'}</li>)}
                {diff?.changed.map(({ b, fields }) => <li key={b.id}><strong>Updated:</strong> {b.title || b.script.slice(0, 50)} ({fields.map((f) => LABEL[f]).join(', ')})</li>)}
                {diff?.gone.map((b) => <li key={b.key}><strong>Removed:</strong> {b.title || b.script.slice(0, 50)}</li>)}
                {diff?.order && <li><strong>Order changed</strong></li>}
                {diff?.meta.map((m) => <li key={m}><strong>Updated:</strong> {m}</li>)}
              </ul>}
          {last && !diff?.none && <span className="nb-hint">Creators see an “Updated” notice on these. Anything already marked done stays done, flagged as changed since.</span>}
          <div className="nb-form"><label>Note to creators (optional)<textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} style={{ minHeight: 70 }} /></label></div>
          <div className="btn-row">
            <ConfirmButton className="mock-button" busy={busy || live.length === 0 || !!diff?.none} label={last ? 'Publish update' : 'Publish'} confirm={`Publish v${(last?.version ?? 0) + 1} to ${assigned.size} creator${assigned.size === 1 ? '' : 's'}?`}
              onConfirm={() => run(async () => { must(await supabase.rpc('publish_bundle', { p_bundle: bundle.id, p_summary: summary })); setSummary(''); await reload(); }, 'Published')} />
          </div>
          {status}
        </div>

        <AssignBox bundle={bundle} creators={creators} assigned={assigned} statuses={act.statuses.filter((s) => s.bundle_id === bundle.id)} reload={reload} published={!!last} />

        {records.length > 0 && (
          <div className="panel-card">
            <h3>Approved ideas</h3>
            <div className="queue-col" style={{ boxShadow: 'none' }}>
              {records.slice(0, 40).map((r) => (
                <div key={r.id} className="queue-card">
                  <span className="video-format">{r.format}{r.persona ? ` · ${r.persona}` : ''}</span>
                  <span className="queue-title">{(r.meta_title || r.title).slice(0, 90)}</span>
                  <button type="button" className="chip" disabled={busy} onClick={() => run(() => addBrief(r), 'Added as a brief')}>Add as brief</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="panel-card">
          <h3>Versions</h3>
          {versions.length === 0 ? <span className="nb-hint">Nothing published yet.</span> : versions.map((v) => (
            <div key={v.version} className="brief-line">
              <span className="brief-label">v{v.version} · {fmtDateTime(v.published_at)}</span>
              by {v.published_by}{v.change_summary ? ` · ${v.change_summary}` : ''}
              {v.content.changes && <span className="nb-hint"><br />{v.content.changes.added.length} added · {v.content.changes.changed.length} changed · {v.content.changes.removed.length} removed</span>}
            </div>
          ))}
          <Caption>Published versions can’t be edited or deleted, so you can always see exactly what creators were sent.</Caption>
        </div>
      </div>
    </div>
  );
}

function BriefEditor({ b, n, count, state, activity, comments, onMove, reload }: {
  b: Brief; n: number; count: number; state: string;
  activity: { name: string; done: boolean; stale: boolean }[];
  comments: { id: string; name: string; body: string; version: number; created_at: string; hidden: boolean }[];
  onMove: (d: -1 | 1) => void; reload: () => Promise<void>;
}) {
  const { busy, run, status } = useRun();
  const [open, setOpen] = useState(!b.script && !b.title);
  return (
    <details className="brief-edit" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><span className="brief-num">{n}</span>{b.format && <span className="video-format">{b.format}</span>}<span>{b.title || b.script.split('\n')[0].slice(0, 80) || 'Untitled brief'}</span><span className={`status ${state.startsWith('Same') ? 'status-approved' : state.startsWith('Not') ? 'status-dump' : 'status-developing'}`}>{state}</span></summary>
      <form className="nb-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => {
        const s = (k: string) => String(fd.get(k) ?? '');
        must(await supabase.from('bundle_briefs').update({
          format: s('format').trim().slice(0, 80), title: s('title').trim().slice(0, 200), inspo: parseInspo(s('inspo')), onscreen: s('onscreen'), script: s('script'),
          alternate_hooks: s('alt').split(/\n\s*---\s*\n/).map((x) => x.trim()).filter(Boolean), note: s('note'), caption: s('caption'), audio: s('audio'),
          posting_notes: s('posting_notes'), internal_notes: s('internal_notes'),
        }).eq('id', b.id).select('id').single());
        await reload();
      }, 'Saved'); }}>
        <div className="row"><label>Format<input name="format" defaultValue={b.format} maxLength={80} /></label><label>Title<input name="title" defaultValue={b.title} maxLength={200} /></label></div>
        <label>Inspo / reference links (one per line, or “label | link”)<textarea name="inspo" defaultValue={inspoText(b)} style={{ minHeight: 60 }} /></label>
        <label>On-screen text<textarea name="onscreen" defaultValue={b.onscreen} style={{ minHeight: 60 }} /></label>
        <label>Script / hook<textarea name="script" defaultValue={b.script} className="tall" /></label>
        <label>Alternate hooks (separate with a line containing ---)<textarea name="alt" defaultValue={b.alternate_hooks.join('\n---\n')} style={{ minHeight: 60 }} /></label>
        <label>Note / execution<textarea name="note" defaultValue={b.note} /></label>
        <div className="row"><label>Caption<textarea name="caption" defaultValue={b.caption} /></label><label>Audio to use<textarea name="audio" defaultValue={b.audio} /></label></div>
        <label>Posting notes for this brief<textarea name="posting_notes" defaultValue={b.posting_notes} style={{ minHeight: 60 }} /></label>
        <label>Internal notes (admins only, never published)<textarea name="internal_notes" defaultValue={b.internal_notes} style={{ minHeight: 60 }} /></label>
        <div className="btn-row">
          <button className="mock-button" disabled={busy}>{busy ? 'Saving…' : 'Save brief'}</button>
          <button type="button" className="chip" disabled={busy || n === 1} onClick={() => onMove(-1)}>↑ Up</button>
          <button type="button" className="chip" disabled={busy || n === count} onClick={() => onMove(1)}>↓ Down</button>
          <ConfirmButton className="chip danger" label="Remove" confirm="Remove from the draft?" busy={busy} onConfirm={() => run(async () => { must(await supabase.from('bundle_briefs').update({ removed: true }).eq('id', b.id).select('id').single()); await reload(); })} />
          {status}
        </div>
      </form>
      {(activity.length > 0 || comments.length > 0) && (
        <div className="brief-comments">
          <span className="brief-label">Creator activity</span>
          <div className="assign-chips">{activity.map((a) => <span key={a.name} className="creator-pill"><span className={`dot ${a.done ? (a.stale ? 'dot-1' : 'dot-3') : 'dot-0'}`} />{a.name}: {a.done ? (a.stale ? 'done before update' : 'done') : 'not done'}</span>)}</div>
          {comments.map((c) => (
            <div key={c.id} className="comment">
              <span className="nb-hint">{c.name} · v{c.version} · {fmtDateTime(c.created_at)}{c.hidden ? ' · hidden' : ''}</span><br />{c.body}
              <span className="btn-row"><button type="button" className="chip" onClick={() => run(async () => { must(await supabase.from('brief_comments').update({ hidden: !c.hidden }).eq('id', c.id).select('id').single()); await reload(); })}>{c.hidden ? 'Unhide' : 'Hide from creator'}</button></span>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function AssignBox({ bundle, creators, assigned, statuses, reload, published }: { bundle: Bundle; creators: Creator[]; assigned: Set<string>; statuses: { creator_id: string; status: number }[]; reload: () => Promise<void>; published: boolean }) {
  const [sel, setSel] = useState(new Set(assigned));
  const { busy, run, status } = useRun();
  const active = creators.filter((c) => c.active);
  return (
    <div className="panel-card">
      <h3>Creators</h3>
      <span className="nb-hint">Several creators can share this bundle; each keeps their own progress, done marks and comments.{published ? '' : ' They’ll see it once it’s published.'}</span>
      {active.length === 0 ? <span className="nb-hint">No creators yet. Add a test creator under Creators.</span> : (
        <div className="assign-chips">
          {active.map((c) => {
            const st = statuses.find((s) => s.creator_id === c.id)?.status;
            return (
              <button key={c.id} type="button" className={`creator-pill ${sel.has(c.id) ? 'chip-active' : ''}`} aria-pressed={sel.has(c.id)} onClick={() => { const n = new Set(sel); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); setSel(n); }}>
                <span className={`dot dot-${st ?? 0}`} />{c.display_name}{c.is_test ? ' (test)' : ''}{assigned.has(c.id) && st !== undefined ? ` · ${CREATOR_STATUSES[st]}` : ''}
              </button>
            );
          })}
        </div>
      )}
      {active.length > 0 && (
        <div className="btn-row">
          <button type="button" className="mock-button white" disabled={busy} onClick={() => run(async () => {
            for (const id of assigned) if (!sel.has(id)) must(await supabase.from('creator_assignments').update({ removed_at: new Date().toISOString() }).eq('bundle_id', bundle.id).eq('creator_id', id).is('removed_at', null).select('id'));
            const add = [...sel].filter((id) => !assigned.has(id)).map((creator_id) => ({ creator_id, bundle_id: bundle.id }));
            if (add.length) must(await supabase.from('creator_assignments').insert(add).select('id'));
            await reload();
          }, 'Assignments saved')}>Save assignments</button>
          {status}
        </div>
      )}
      {[...assigned].length > 0 && published && (
        <div className="nb-form">
          <span className="brief-label">Mark a creator’s bundle Approved</span>
          <div className="assign-chips">
            {creators.filter((c) => assigned.has(c.id)).map((c) => {
              const st = statuses.find((s) => s.creator_id === c.id)?.status;
              return <button key={c.id} type="button" className="chip" disabled={busy || st === 3} onClick={() => run(async () => {
                must(await supabase.from('creator_bundle_status').upsert({ creator_id: c.id, bundle_id: bundle.id, status: 3, updated_by: 'admin', updated_at: new Date().toISOString() }).select('creator_id'));
                await reload();
              }, 'Marked approved')}>{st === 3 ? `${c.display_name} ✓ approved` : `Approve ${c.display_name}`}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
