import React, { useRef, useState } from 'react';
import { embedSrc } from './social-url';
import { errText } from './supabase';

/** Copies text with visible success/failure; if the clipboard is blocked, shows the text selected for manual copy. */
export function CopyButton({ text, label = 'Copy', className = 'chip' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'manual'>('idle');
  const ref = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setState('ok');
      setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('manual');
      requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); });
    }
  }
  return (
    <>
      <button type="button" className={className} onClick={copy} aria-live="polite">{state === 'ok' ? 'Copied ✓' : label}</button>
      {state === 'manual' && (
        <span style={{ flexBasis: '100%' }}>
          <span className="nb-hint" role="alert">Couldn’t copy automatically. It’s selected below: press Ctrl/⌘ + C.</span>
          <textarea ref={ref} readOnly className="copy-fallback" value={text} onFocus={(e) => e.currentTarget.select()} />
        </span>
      )}
    </>
  );
}

/** Supported players only (YouTube, TikTok, Instagram), built from validated ids; otherwise nothing. */
export function EmbedPlayer({ provider, id, title }: { provider: string | null; id: string | null; title: string }) {
  const [on, setOn] = useState(false);
  const src = embedSrc(provider, id);
  if (!src) return null;
  return (
    <>
      <button type="button" className="chip" aria-expanded={on} onClick={() => setOn((v) => !v)}>{on ? 'Hide player' : 'Play here'}</button>
      {on && (
        <span style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <iframe
            src={src}
            title={`Video player: ${title}`}
            className={`embed-frame ${provider === 'youtube' ? 'wide' : ''}`}
            allow="encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            loading="lazy"
          />
          <span className="nb-hint">Blank player? The post doesn’t allow embedding. Use Open original.</span>
        </span>
      )}
    </>
  );
}

/** Small helper for buttons that run an async action and report errors inline. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
    setBusy(true); setError(null); setOk(null);
    try {
      const r = await fn();
      if (okMsg) { setOk(okMsg); setTimeout(() => setOk(null), 2500); }
      return r;
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const status = (
    <>
      {ok && <span className="msg-ok" role="status">{ok}</span>}
      {error && <span className="msg-err" role="alert">{error}</span>}
    </>
  );
  return { busy, error, ok, run, status };
}

/** Two-step confirm (the page never uses window.confirm). */
export function ConfirmButton({ label, confirm, onConfirm, className = 'chip', busy }: { label: string; confirm: string; onConfirm: () => void; className?: string; busy?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={className} disabled={busy} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="btn-row">
      <strong style={{ fontSize: 13 }}>{confirm}</strong>
      <button type="button" className="chip danger" disabled={busy} onClick={() => { setAsking(false); onConfirm(); }}>Yes</button>
      <button type="button" className="chip" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

export function must<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return r.data as NonNullable<T>;
}
