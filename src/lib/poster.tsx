import React from 'react';

// Moved verbatim from the approved App.tsx so the creator page and admin views share it.
export const FORMAT_CLASS: Record<string, string> = {
  'Hot take': 'g-hottake',
  'Long text': 'g-longtext',
  'Talking head': 'g-talking',
  'Focus test': 'g-focus',
  'Hook + demo': 'g-hookdemo',
  'Unhinged friend': 'g-unhinged',
  'Hot girl': 'g-hotgirl',
  'Gamer guy': 'g-gamer',
};

/** Picks the poster colour for any format label, including the sheet's own spellings. */
export function formatClass(format: string): string {
  const f = format.trim().toLowerCase();
  if (FORMAT_CLASS[format]) return FORMAT_CLASS[format];
  if (f.includes('hot take')) return 'g-hottake';
  if (f.includes('talking')) return 'g-talking';
  if (f.includes('focus') || f.includes('quiz') || f.includes('brain rot')) return 'g-focus';
  if (f.includes('hook')) return 'g-hookdemo';
  if (f.includes('unhinged')) return 'g-unhinged';
  if (f.includes('hot girl')) return 'g-hotgirl';
  if (f.includes('gam')) return 'g-gamer';
  return 'g-longtext';
}

export function Poster({ v, small }: { v: { title: string; creator?: string; platform?: string; duration?: string; format?: string }; small?: boolean }) {
  const g = formatClass(v.format || '');
  return (
    <div className={`poster ${g} ${small ? 'poster-small' : ''}`}>
      {!small && v.platform && <span className="poster-platform">{v.platform}</span>}
      {!small && v.duration && <span className="poster-duration">{v.duration}</span>}
      <span className="poster-play" aria-hidden="true"><span className="poster-triangle" /></span>
      <span className="poster-caption">
        {!small && v.creator && <span className="poster-creator">{v.creator}</span>}
        <span className="poster-title">{v.title}</span>
      </span>
    </div>
  );
}
