import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Callout, Closing, FileCard, Header } from './ui';
import './style.css';
import './extra.css';
import matiksIcon from './photos/matiks-icon.jpg';
import { supabase, configured } from './lib/supabase';
import { useRun } from './lib/components';
import { App } from './App';

/** Admin sign-in gate. The real check is in the database (row-level security on every table); this only decides what to show. */
export function AdminRoot() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    setIsAdmin(null);
    if (!session) return;
    supabase.rpc('am_i_admin').then(({ data, error }) => setIsAdmin(!error && data === true));
  }, [session?.user.id]);

  if (!configured) return <Shell><Callout title="Not set up yet" tone="note">Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see README → Deploy).</Callout></Shell>;
  if (session === undefined || (session && isAdmin === null)) return <Shell><p className="loading" role="status">Loading…</p></Shell>;
  if (!session) return <Shell><SignIn /></Shell>;
  if (!isAdmin) {
    return (
      <Shell>
        <Header title="No admin access" intro={`${session.user.email} isn’t a Creator Hub admin. Ask Pranjali or Meenal to add you.`} />
        <div className="btn-row"><button type="button" className="mock-button white" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </Shell>
    );
  }
  return <App me={session.user.email ?? ''} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <FileCard>
      <div className="brand-row">
        <img src={matiksIcon} alt="Matiks logo" className="brand-logo" />
        <span className="brand-name">Matiks Creator Hub</span>
        <span className="seros-sticker">seros was here ✦</span>
      </div>
      {children}
      <Closing>Only admins sign in. Creators open the private link the Matiks team sends them; they don’t need an account.</Closing>
    </FileCard>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, run, status } = useRun();
  const linkError = new URLSearchParams(window.location.hash.slice(1)).get('error_description') ?? new URLSearchParams(window.location.search).get('error_description');
  return (
    <div className="sign-in file-group">
      <Header title="Admin sign-in" intro="We’ll email you a one-time sign-in link. Only Creator Hub admins can sign in." />
      {linkError && <Callout title="That link didn’t work" tone="note">It may have expired or already been used. Request a new one.</Callout>}
      {sent ? (
        <div className="notice lime" role="status"><strong>Check your email</strong><span>If {email} is a Creator Hub admin, a sign-in link is on its way. Open it in this browser.</span></div>
      ) : (
        <form className="nb-form panel-card" onSubmit={(e) => { e.preventDefault(); run(async () => {
          const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + '/' } });
          // Same answer whether or not the address has an account, so the form can't be used to list admins.
          if (error && /rate|too many/i.test(error.message)) throw new Error('Too many sign-in emails. Wait a few minutes and try again.');
          setSent(true);
        }); }}>
          <label>Work email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@matiks.com" /></label>
          <div className="btn-row"><button className="mock-button" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>{status}</div>
        </form>
      )}
    </div>
  );
}
