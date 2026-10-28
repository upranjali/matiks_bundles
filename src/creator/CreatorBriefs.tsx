import React, { useState } from 'react';
import { Callout, Caption, Group, TextLink } from '../ui';
import { Poster } from '../lib/poster';
import { CopyButton, EmbedPlayer } from '../lib/components';
import { parseSocialUrl, embedFor } from '../lib/social-url';
import { CREATOR_STATUSES, fmtDate, fmtDateTime, type FeedBundle, type PublishedBrief } from '../lib/types';

/**
 * The creator experience from the approved design (brief cards, posting instructions, progress
 * stepper), wired to real saved data. Used by the creator link page and by the admin preview.
 * `actions` is null in admin preview: everything renders read-only.
 */
export type CreatorActions = {
  setStatus: (bundle: string, status: number) => Promise<void>;
  setDone: (bundle: string, brief: string, done: boolean) => Promise<{ done: boolean; done_version: number | null; done_brief_hash: string | null }>;
  addComment: (bundle: string, brief: string, body: string) => Promise<FeedBundle['comments'][number]>;
  markSeen: (bundle: string, version: number) => Promise<void>;
};

export function BundleView({ b, actions }: { b: FeedBundle; actions: CreatorActions | null }) {
  const c = b.content;
  const [status, setStatus] = useState<number | null>(b.status);
  const [progress, setProgress] = useState(() => new Map(b.progress.map((p) => [p.brief_key, p])));
  const [comments, setComments] = useState(b.comments);
  const [seen, setSeen] = useState(b.last_seen_version);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = seen === null;
  const isUpdated = seen !== null && seen < b.version;
  const done = c.briefs.filter((x) => progress.get(x.key)?.done).length;

  async function guard(fn: () => Promise<void>) {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Group label={`${c.week_label} · ${c.title || `Bundle ${c.bundle}`}`} heading>
      <p className="creator-version">
        Published v{b.version} · {fmtDate(b.published_at)}
        <span className="creator-version-note">{done}/{c.briefs.length} done · you'll see a note here if anything changes</span>
      </p>

      {(isNew || isUpdated) && (
        <div className="notice" role="status">
          <strong>{isNew ? 'New bundle for you' : `Updated to v${b.version}`}</strong>
          {b.change_summary && <span style={{ whiteSpace: 'pre-wrap' }}>{b.change_summary}</span>}
          {isUpdated && c.changes && (
            <span>
              {[c.changes.added.length && `${c.changes.added.length} new`, c.changes.changed.length && `${c.changes.changed.length} updated`, c.changes.removed.length && `${c.changes.removed.length} removed`].filter(Boolean).join(' · ') || 'Bundle details changed'}. Changed briefs are marked below.
            </span>
          )}
          {actions && (
            <span className="btn-row">
              <button type="button" className="chip" disabled={busy} onClick={() => guard(async () => { await actions.markSeen(b.bundle_id, b.version); setSeen(b.version); })}>Got it</button>
            </span>
          )}
        </div>
      )}

      {c.posting_instructions && (
        <Callout title="Posting instructions" tone="note">
          <span style={{ whiteSpace: 'pre-wrap' }}>{c.posting_instructions}</span>
        </Callout>
      )}

      <div className="brief-list">
        {c.briefs.map((br, i) => {
          const prev = b.seen_hashes[br.key];
          const flag = seen === null ? null : prev === undefined ? 'New' : prev !== br.hash ? 'Updated' : null;
          return (
            <BriefCard
              key={br.key}
              n={i + 1}
              brief={br}
              flag={flag}
              progress={progress.get(br.key)}
              comments={comments.filter((x) => x.brief_key === br.key)}
              actions={actions && {
                setDone: async (d) => {
                  const r = await actions.setDone(b.bundle_id, br.key, d);
                  setProgress((m) => new Map(m).set(br.key, { brief_key: br.key, ...r }));
                },
                addComment: async (body) => {
                  const cm = await actions.addComment(b.bundle_id, br.key, body);
                  setComments((xs) => [...xs, cm]);
                },
              }}
            />
          );
        })}
      </div>

      <div className="stepper-wrap">
        <p className="stepper-title">Your progress</p>
        <div className="stepper">
          {CREATOR_STATUSES.map((s, i) => {
            const cur = status ?? -1;
            const locked = !actions || i === 3;
            return (
              <button key={s} type="button" aria-pressed={i === cur}
                className={`step ${i < cur ? 'step-done' : ''} ${i === cur ? 'step-now' : ''}`}
                disabled={busy || locked}
                title={i === 3 ? 'Set by the Matiks team' : undefined}
                onClick={() => actions && guard(async () => { await actions.setStatus(b.bundle_id, i); setStatus(i); })}>
                <span className="step-dot" />{s}
              </button>
            );
          })}
        </div>
        {err && <p className="msg-err" role="alert">{err}</p>}
        <Caption>Saved online, so the Matiks team sees it. “Approved” is set by the team. Send your video the usual way; this page doesn’t take uploads.</Caption>
      </div>
    </Group>
  );
}

function BriefCard({ n, brief: b, flag, progress, comments, actions }: {
  n: number; brief: PublishedBrief; flag: string | null;
  progress?: { done: boolean; done_version: number | null; done_brief_hash: string | null };
  comments: FeedBundle['comments'];
  actions: { setDone: (d: boolean) => Promise<void>; addComment: (body: string) => Promise<void> } | null;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = !!progress?.done;
  const stale = done && progress?.done_brief_hash !== b.hash;
  const title = b.title || (b.script.split('\n').find((l) => l.trim()) ?? 'Brief').slice(0, 80);
  async function guard(fn: () => Promise<void>) {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <div className="brief-card">
      <Poster v={{ title, format: b.format }} small />
      <div className="brief-body">
        <p className="brief-head">
          <span className="brief-num">{n}</span><span className="video-format">{b.format}</span> <strong>{title}</strong>
          {flag && <span className={`brief-flag ${flag === 'Updated' ? 'updated' : ''}`}>{flag}</span>}
          {done && <span className={`brief-flag ${stale ? 'stale' : 'done'}`}>{stale ? 'Done · changed since' : 'Done ✓'}</span>}
        </p>
        {b.onscreen && <Line label="On screen" text={b.onscreen} copy />}
        {b.script && <Line label="Script" text={b.script} copy />}
        {b.alternate_hooks.map((h, i) => <Line key={i} label={`Other hook ${i + 1}`} text={h} copy />)}
        {b.note && <Line label="Note" text={b.note} />}
        {b.caption && <Line label="Caption" text={b.caption} copy copyLabel="Copy caption" />}
        {b.audio && <Line label="Audio" text={b.audio} copy />}
        {b.posting_notes && <Line label="Posting notes" text={b.posting_notes} />}
        {b.inspo.map((l, i) => {
          const p = parseSocialUrl(l.url);
          const e = embedFor(p);
          const safe = /^https?:\/\//i.test(l.url);
          return (
            <div key={i} className="brief-tools">
              {safe && <TextLink href={l.url}>{l.label || (b.inspo.length > 1 ? `Open reference video ${i + 1}` : 'Open the reference video')}</TextLink>}
              <CopyButton text={l.url} label="Copy link" />
              <EmbedPlayer provider={e?.provider ?? null} id={e?.id ?? null} title={title} />
            </div>
          );
        })}

        <div className="brief-comments">
          {stale && <p className="brief-line">You marked this done before it was updated. Check the changes, then mark it done again.</p>}
          {actions && (
            <div className="btn-row">
              <button type="button" className={done && !stale ? 'chip chip-active' : 'chip'} aria-pressed={done && !stale} disabled={busy}
                onClick={() => guard(() => actions.setDone(stale ? true : !done))}>
                {busy ? 'Saving…' : stale ? 'Mark done again' : done ? 'Done ✓ (undo)' : 'Mark done'}
              </button>
            </div>
          )}
          {comments.map((c) => (
            <div key={c.id} className="comment"><span className="nb-hint">You · {fmtDateTime(c.created_at)} · v{c.version}</span><br />{c.body}</div>
          ))}
          {actions && (
            <form className="nb-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) guard(async () => { await actions.addComment(text); setText(''); }); }}>
              <label htmlFor={`c-${b.key}`}>Question or note for the Matiks team
                <textarea id={`c-${b.key}`} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} style={{ minHeight: 70 }} />
              </label>
              <div className="btn-row">
                <button className="chip" disabled={busy || !text.trim()}>Send comment</button>
                <span className="nb-hint">{text.length}/2000</span>
              </div>
            </form>
          )}
          {err && <p className="msg-err" role="alert">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function Line({ label, text, copy, copyLabel }: { label: string; text: string; copy?: boolean; copyLabel?: string }) {
  return (
    <div className="brief-line">
      <span className="brief-label">{label}</span>
      <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</span>
      {copy && <span className="brief-tools"><CopyButton text={text} label={copyLabel ?? 'Copy'} /></span>}
    </div>
  );
}
