import React, { useCallback, useEffect, useState } from 'react';
import { Callout, Caption, Closing, FileCard, Group, Header } from './ui';
import './style.css';
import './extra.css';
import { Archive } from './Archive';
import matiksIcon from './photos/matiks-icon.jpg';
import { supabase, errText } from './lib/supabase';
import { must, useRun } from './lib/components';
import { RECORD_COLUMNS, type Creator, type Feed, type RecordItem, type Week } from './lib/types';
import { ImportLink } from './admin/ImportLink';
import { IdeasQueue } from './admin/IdeasQueue';
import { BundlesPanel } from './admin/BundlesPanel';
import { CreatorsPanel } from './admin/CreatorsPanel';
import { AdminPanel } from './admin/AdminPanel';
import { WinnerMetrics, type Metric } from './admin/WinnerMetrics';
import { BundleView } from './creator/CreatorBriefs';

type Tab = 'inspo' | 'winners' | 'learnings' | 'bundles' | 'creators' | 'personas' | 'admin';

async function loadAllRecords(): Promise<RecordItem[]> {
  const out: RecordItem[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await supabase.from('records').select(RECORD_COLUMNS).order('id').range(from, from + 999)) as unknown as RecordItem[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export function App({ me }: { me: string }) {
  const [role, setRole] = useState<'admin' | 'creator'>('admin');
  const [tab, setTab] = useState<Tab>('inspo');
  const [inspoView, setInspoView] = useState<'library' | 'queue'>('library');
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [records, setRecords] = useState<RecordItem[] | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [allowReal, setAllowReal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const reloadWeeks = useCallback(async () => {
    const w = must(await supabase.from('weeks').select('number,label,is_current').order('number', { ascending: false })) as Week[];
    setWeeks(w);
    setWeek((cur) => cur ?? w.find((x) => x.is_current)?.number ?? w[0]?.number ?? null);
  }, []);
  const reloadCreators = useCallback(async () => setCreators(must(await supabase.from('creators').select('id,display_name,is_test,active,internal_notes').order('display_name')) as Creator[]), []);
  const reloadMetrics = useCallback(async () => setMetrics(must(await supabase.from('winner_metrics').select('*').order('recorded_at')) as Metric[]), []);
  const reloadSettings = useCallback(async () => {
    const s = must(await supabase.from('settings').select('value').eq('key', 'allow_real_creators').maybeSingle());
    setAllowReal(s?.value === true);
  }, []);

  useEffect(() => {
    Promise.all([reloadWeeks(), loadAllRecords().then(setRecords), reloadCreators(), reloadMetrics(), reloadSettings()]).catch((e) => setLoadError(errText(e)));
  }, [reloadWeeks, reloadCreators, reloadMetrics, reloadSettings]);

  const onSaved = useCallback((r: RecordItem | null, id?: string) => {
    setRecords((rs) => {
      if (!rs) return rs;
      if (!r) return rs.filter((x) => x.id !== id);
      return rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [r, ...rs];
    });
  }, []);

  const w = week ?? 0;
  const wLabel = weeks.find((x) => x.number === w)?.label ?? `Week ${w}`;
  const current = weeks.find((x) => x.is_current)?.number;

  return (
    <FileCard>
      <div className="brand-row">
        <img src={matiksIcon} alt="Matiks logo" className="brand-logo" />
        <span className="brand-name">Matiks Creator Hub</span>
        <span className="seros-sticker">seros was here ✦</span>
      </div>
      <Header
        title="One hub for inspo, bundles and creators"
        fact={`Signed in as ${me}`}
        intro="Admin runs the library and weekly bundles; creators see only what is published for them. Consolidated source snapshots for weeks 17–20 and a separate personas library."
      />
      <Callout title={allowReal ? 'Live' : 'Staging'} tone="note">
        {allowReal
          ? 'Changes save online for every admin. Creators see only bundles you publish and assign to them, through their own private link.'
          : 'Changes save online for every admin. Creator links work for test creators only until you approve sharing with real creators in the Admin tab. Nothing is sent to anyone automatically.'}
        {' '}
        <button type="button" className="chip" style={{ marginLeft: 6 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </Callout>

      <div className="role-switch" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={role === 'admin'} className={role === 'admin' ? 'role-active' : ''} onClick={() => setRole('admin')}>Admin view</button>
        <button type="button" role="tab" aria-selected={role === 'creator'} className={role === 'creator' ? 'role-active' : ''} onClick={() => setRole('creator')}>Creator view</button>
      </div>

      {loadError && <Callout title="Couldn’t load" tone="note">{loadError}</Callout>}
      {!records && !loadError && <p className="loading" role="status">Loading the library…</p>}

      {records && role === 'admin' && (
        <>
          <nav className="admin-nav" aria-label="Admin sections">
            {([['inspo', 'Weekly inspo'], ['winners', 'Winner library'], ['learnings', 'Learnings'], ['bundles', 'Bundles'], ['creators', 'Creators'], ['personas', 'Personas'], ['admin', 'Admin']] as const).map(([key, label]) => (
              <button key={key} type="button" className={tab === key ? 'nav-active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>

          {['inspo', 'winners', 'learnings', 'bundles'].includes(tab) && week !== null && (
            <div className="week-picker"><label htmlFor="week-select">Explore a week</label>
              <select id="week-select" value={w} onChange={(e) => setWeek(Number(e.target.value))}>
                {weeks.map((x) => <option key={x.number} value={x.number}>{x.label}{x.number === current ? ' · current' : ''}</option>)}
              </select>
            </div>
          )}

          {tab === 'inspo' && week !== null && (
            <Group label={`${wLabel} · Inspiration & concepts`} heading>
              <ImportLink key={w} weeks={weeks} week={w} records={records} onSaved={(r) => onSaved(r)} />
              <div className="chip-row">
                <button type="button" className={`chip ${inspoView === 'library' ? 'chip-active' : ''}`} onClick={() => setInspoView('library')}>Library</button>
                <button type="button" className={`chip ${inspoView === 'queue' ? 'chip-active' : ''}`} onClick={() => setInspoView('queue')}>Ideation queue</button>
              </div>
              {inspoView === 'library'
                ? <Archive key={`inspo${w}`} week={w} mode="inspo" records={records} onSaved={onSaved} />
                : <IdeasQueue week={w} records={records} onSaved={(r) => onSaved(r)} />}
            </Group>
          )}

          {tab === 'winners' && week !== null && (
            <Group label={`${wLabel} · Winner library`} heading>
              <Archive key={`win${w}`} week={w} mode="winners" records={records} onSaved={onSaved}
                extra={(r) => <WinnerMetrics record={r} metrics={metrics} onChange={() => { reloadMetrics().catch(() => undefined); }} />} />
              <Caption>Add a new winner with “Import link” under Weekly inspo and set its category to Winners.</Caption>
            </Group>
          )}

          {tab === 'learnings' && week !== null && (
            <Group label={`${wLabel} · Learnings`} heading>
              <AddLearning week={w} onSaved={(r) => onSaved(r)} />
              <Archive key={`learn${w}`} week={w} mode="learnings" records={records} onSaved={onSaved} />
            </Group>
          )}

          {tab === 'bundles' && week !== null && (
            <>
              <Group label={`${wLabel} · Bundles`} heading>
                <BundlesPanel key={w} week={w} weekLabel={wLabel} records={records} creators={creators} />
              </Group>
              <Group label={`${wLabel} · Bundle archive from the sheets`} heading>
                <Archive key={`bun${w}`} week={w} mode="bundles" records={records} onSaved={onSaved} />
              </Group>
            </>
          )}

          {tab === 'creators' && (
            <Group label="Creators & links" heading>
              <CreatorsPanel creators={creators} reloadCreators={reloadCreators} allowReal={allowReal} onPreview={(id) => { setPreviewId(id); setRole('creator'); }} />
            </Group>
          )}

          {tab === 'personas' && (
            <Group label="Personas · pages library" heading>
              <Archive key="personas" week={0} mode="personas" records={records} onSaved={onSaved} />
            </Group>
          )}

          {tab === 'admin' && (
            <AdminPanel me={me} weeks={weeks} reloadWeeks={reloadWeeks} allowReal={allowReal} reloadSettings={reloadSettings} records={records} onSaved={(r) => onSaved(r)} />
          )}
        </>
      )}

      {records && role === 'creator' && <CreatorPreview creators={creators} previewId={previewId} setPreviewId={setPreviewId} />}

      <Closing>
        Weeks 17–20 and personas were imported once from the Matiks sheets on 28 Oct 2026; this website is now where they’re edited. Week 20 bundles start empty. Anton is a close font match, not the confirmed Matiks font.
      </Closing>
    </FileCard>
  );
}

function AddLearning({ week, onSaved }: { week: number; onSaved: (r: RecordItem) => void }) {
  const { busy, run, status } = useRun();
  return (
    <form className="panel-card nb-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); run(async () => {
      const s = (k: string) => String(fd.get(k) ?? '').trim();
      const fields: Record<string, string> = { note: s('text') };
      if (s('where')) fields.where = s('where');
      onSaved(must(await supabase.from('records').insert({ week, stage: 'Learnings', format: s('tag') || 'Learning', title: s('title') || s('text').split('.')[0].slice(0, 120), fields }).select(RECORD_COLUMNS).single()) as unknown as RecordItem);
      f.reset();
    }, 'Learning saved'); }}>
      <h3>Add a learning</h3>
      <div className="row"><label>Short title<input name="title" maxLength={200} /></label><label>Tag<input name="tag" placeholder="e.g. Hook, Structure" maxLength={80} /></label></div>
      <label>What you learned<textarea name="text" required /></label>
      <label>Where it applies<input name="where" placeholder="e.g. talking heads, hot takes" /></label>
      <div className="btn-row"><button className="mock-button" disabled={busy}>Save learning</button>{status}</div>
    </form>
  );
}

function CreatorPreview({ creators, previewId, setPreviewId }: { creators: Creator[]; previewId: string | null; setPreviewId: (id: string) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = creators.filter((c) => c.active);
  const id = previewId ?? active[0]?.id ?? null;
  useEffect(() => {
    if (!id) return;
    setFeed(null); setErr(null); setBundleId(null);
    supabase.rpc('admin_preview_feed', { p_creator: id }).then(({ data, error }) => (error ? setErr(errText(error)) : setFeed(data as Feed)));
  }, [id]);
  const bundle = feed?.bundles.find((b) => b.bundle_id === bundleId) ?? feed?.bundles[0] ?? null;
  if (!active.length) return <div className="archive-empty"><h3>No creators yet</h3><p>Add a test creator in the Creators tab to preview what they see.</p></div>;
  return (
    <>
      <div className="chip-row">
        {active.map((c) => <button key={c.id} type="button" className={`chip ${id === c.id ? 'chip-active' : ''}`} onClick={() => setPreviewId(c.id)}>{c.display_name}</button>)}
      </div>
      {err && <Callout title="Couldn’t load preview" tone="note">{err}</Callout>}
      {feed && feed.bundles.length > 1 && (
        <div className="chip-row">{feed.bundles.map((b) => <button key={b.bundle_id} type="button" className={`chip ${bundle?.bundle_id === b.bundle_id ? 'chip-active' : ''}`} onClick={() => setBundleId(b.bundle_id)}>Week {b.content.week} · {b.content.title || `Bundle ${b.content.bundle}`}</button>)}</div>
      )}
      {feed && !bundle && <div className="archive-empty"><h3>Nothing published for {feed.creator.name}</h3><p>Their link shows an empty page until a bundle assigned to them is published.</p></div>}
      {bundle && <BundleView key={`${bundle.bundle_id}:${bundle.version}`} b={bundle} actions={null} />}
      <Callout title="Only your bundles" tone="note">
        Read-only preview of exactly what this creator’s private link shows: their assigned, published bundles and their own progress, done marks and comments. Nothing else from the library is sent to their page.
      </Callout>
    </>
  );
}
