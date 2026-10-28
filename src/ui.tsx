// Standalone replacements for the small layout primitives the preview was
// composed with. Plain React + the rules in style.css under "layout shell".
// Values were measured from the approved preview so the look is preserved.
import React from 'react';

export function FileCard({ children }: { children: React.ReactNode }) {
  return <main className="file-card">{children}</main>;
}

export function Header({ title, fact, intro }: { title: string; fact?: string; intro?: string }) {
  return (
    <header className="file-header">
      <h1 className="file-title">{title}</h1>
      {fact && <p className="file-fact">{fact}</p>}
      {intro && <p className="file-intro">{intro}</p>}
    </header>
  );
}

export function Callout({ title, children }: { title: string; tone?: string; children: React.ReactNode }) {
  return (
    <aside className="file-callout file-bar">
      <span className="file-strong">{title}</span>
      <span>{children}</span>
    </aside>
  );
}

export function Group({ label, heading, children }: { label: string; heading?: boolean; children: React.ReactNode }) {
  return (
    <section className="file-group">
      {heading
        ? <h2 className="file-group-heading">{label}</h2>
        : <p className="file-group-label">{label}</p>}
      {children}
    </section>
  );
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <p className="file-caption">{children}</p>;
}

export function Closing({ children }: { children: React.ReactNode }) {
  return <footer className="file-closing">{children}</footer>;
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="file-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export function CloseButton({ onClick, label = 'Close' }: { onClick?: () => void; label?: string }) {
  return <button type="button" className="file-close" onClick={onClick} aria-label={label}>×</button>;
}
