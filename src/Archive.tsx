import React, {useState} from 'react';
import {Caption, TextLink} from './ui';
import type {RecordItem} from './lib/types';
import {RecordEditor} from './admin/RecordEditor';
import {EmbedPlayer} from './lib/components';
// Approved archive view, now reading the imported records from the database instead of the
// bundled JSON snapshot. Markup and classes are unchanged; editing lives in RecordEditor.
export function Archive({week,mode,records,onSaved,extra}:{week:number;mode:'inspo'|'bundles'|'winners'|'learnings'|'personas';records:RecordItem[];onSaved:(r:RecordItem|null,id?:string)=>void;extra?:(r:RecordItem)=>React.ReactNode}){
 const [bundle,setBundle]=useState('All'); const [persona,setPersona]=useState('All'); const [format,setFormat]=useState('All'); const [query,setQuery]=useState(''); const [stage,setStage]=useState('All');const [limit,setLimit]=useState(18);const [review,setReview]=useState(false);
 const base=records.filter(r=>!r.archived).filter(r=>mode==='personas'?(r.week===null||r.also_personas.length>0):(r.week===week||r.also_weeks.includes(week))).filter(r=>mode==='inspo'?['Inspiration','Adapted concepts','Planning notes'].includes(r.stage):mode==='bundles'?['Bundle briefs','Posting instructions'].includes(r.stage):mode==='winners'?r.stage==='Winners':mode==='learnings'?r.stage==='Learnings':true);
 const formats=Array.from(new Set(base.map(r=>r.format))).sort();const stages=Array.from(new Set(base.map(r=>r.stage)));
 const bundleOf=(r:RecordItem)=>{const s=r.sources[0]; if(!s) return 'Unassigned'; const m=(s.tab+' '+s.sheet).match(/bundle[ -]*(\d)|\((i{1,3})\)/i); return m?'Bundle '+(m[1]||({i:1,ii:2,iii:3} as Record<string,number>)[m[2]]):'Unassigned';};
 const reviewCount=base.filter(r=>r.needs_review).length;
 const filtered=base.filter(r=>(bundle==='All'||bundleOf(r)===bundle)&&(persona==='All'||r.persona===persona||r.also_personas.includes(persona))&&(format==='All'||r.format===format)&&(stage==='All'||r.stage===stage)&&(!review||r.needs_review)&&(!query||JSON.stringify([r.title,r.fields,r.extras,r.internal_notes,r.meta_title,r.meta_author,r.url]).toLowerCase().includes(query.toLowerCase())));
 const reset=()=>setLimit(18);
 return <div className="archive">
  {mode==='personas'&&<p>Personas are separate from formats. Gameplays uses the source tab named "gamer guy". All items below come from pages library, not inferred creator assignments.</p>}
  {mode==='bundles'&&<p>Historical sheet snapshots, not app-published versions. Master and creator-facing copies remain separate when their text differs. No publishing dates or approvals have been invented.</p>}
  <div className="archive-controls">
   <label>Search<input type="search" value={query} onChange={e=>{setQuery(e.target.value);reset();}} placeholder="Hook, reference or note" /></label>
   {mode==='bundles'&&<label>Bundle<select value={bundle} onChange={e=>{setBundle(e.target.value);reset();}}><option>All</option>{Array.from(new Set(base.map(bundleOf))).sort().map(x=><option key={x}>{x}</option>)}</select></label>}
   <label>Format<select value={format} onChange={e=>{setFormat(e.target.value);reset();}}><option>All</option>{formats.map(x=><option key={x}>{x}</option>)}</select></label>
   {stages.length>1&&<label>Category<select value={stage} onChange={e=>{setStage(e.target.value);reset();}}><option>All</option>{stages.map(x=><option key={x}>{x}</option>)}</select></label>}
  </div>
  {(mode==='personas'||base.some(r=>r.persona||r.also_personas.length))&&<div className="chip-row">{['All','Unhinged','Hot girl','Gameplays'].map(p=><button className={`chip ${persona===p?'chip-active':''}`} key={p} onClick={()=>{setPersona(p);reset();}}>{p}</button>)}</div>}
  {reviewCount>0&&<div className="chip-row"><button className={`chip ${review?'chip-active':''}`} aria-pressed={review} onClick={()=>{setReview(!review);reset();}}>Needs mapping review ({reviewCount})</button></div>}
  <p className="archive-count" role="status">{filtered.length} records {mode==='personas'?'in pages library':`in week ${week}`} · exact duplicates combined, source variants retained</p>
  {!filtered.length&&<div className="archive-empty"><h3>{mode==='bundles'&&week===20?'Week 20 is a blank canvas':'Nothing in this view yet'}</h3><p>{mode==='bundles'&&week===20?'Your current bundle is intentionally empty. Early source material has not been added here.':'Try clearing the filters. If this week has no source records in this category, nothing has been invented.'}</p></div>}
  <div className="archive-grid">{filtered.slice(0,limit).map(r=><RecordCard key={r.id} item={r} onSaved={onSaved} extra={extra}/>)}</div>
  {filtered.length>limit&&<button className="mock-button" onClick={()=>setLimit(limit+18)}>Show 18 more ({filtered.length-limit} remaining)</button>}
  <Caption>Imported from the connected Matiks sheets on 28 Oct 2026, then edited here. The website is now the editing home; the sheets are not synced. Source metrics and claims are sheet notes, not independently rechecked facts. Unstructured rows retain their original cell labels.</Caption>
 </div>
}
function RecordCard({item:r,onSaved,extra}:{item:RecordItem;onSaved:(r:RecordItem|null,id?:string)=>void;extra?:(r:RecordItem)=>React.ReactNode}){
 const [editing,setEditing]=useState(false);
 const f=r.fields;const urls=Array.from(new Set([...(r.url?[r.url]:[]),...((f.inspo||'').match(/https?:\/\/[^\s]+/g)||[])]));
 const display=r.meta_title||(r.title.startsWith('http')||(!f.hook&&!f.note&&!f.onscreen)?'Reference · '+(r.persona||r.format)+(r.sources[0]?' · row '+r.sources[0].row:''):r.title);
 return <article className="archive-card">
  <div className="chip-row"><span className="video-format">{r.stage}</span>{r.persona&&<span className="video-format">{r.persona}</span>}{r.also_personas.map(p=><span key={p} className="video-format">{p}</span>)}{r.also_weeks.length>0&&<span className="video-format">also week {r.also_weeks.join(', ')}</span>}<span className="video-format">{r.format}</span>{r.stage==='Bundle briefs'&&r.sources[0]&&<span className="video-format">{r.sources[0].tab}</span>}{r.workflow&&<span className={`status status-${r.workflow.toLowerCase()}`}>{r.workflow}</span>}{r.needs_review&&<span className="status status-developing">Check mapping</span>}</div>
  {urls.length>0&&r.stage!=='Winners'&&(r.thumbnail_url
    ?<a href={urls[0]} target="_blank" rel="noopener noreferrer" style={{display:'block',margin:'14px 0',maxWidth:240}}><img className="thumb" src={r.thumbnail_url} alt={display} referrerPolicy="no-referrer" loading="lazy"/></a>
    :<a className={`archive-poster ${r.persona==='Unhinged'?'poster-lime':r.persona==='Hot girl'?'poster-mauve':r.persona==='Gameplays'?'poster-blue':''}`} href={urls[0]} target="_blank" rel="noopener noreferrer"><span>REFERENCE ↗</span><strong>{display.slice(0,75)}</strong><span>Placeholder poster · open original</span></a>)}
  <h3>{display}</h3>
  {!!f.account&&<p className="archive-muted">Account context: {f.account}</p>}
  {r.meta_author&&<p className="archive-muted">By {r.meta_author}</p>}
  <div className="archive-links">{urls.slice(0,3).map((u,i)=><TextLink key={u} href={u}>Open original {urls.length>1?i+1:''} ↗</TextLink>)}<EmbedPlayer provider={r.embed_provider} id={r.embed_id} title={display}/></div>
  {r.metadata_status==='blocked'&&<p className="archive-muted">The platform didn’t share this link’s details{r.metadata_error?` (${r.metadata_error})`:''}. Add a title by hand under Edit.</p>}
  <details><summary>Read source details</summary>
   {Object.entries(f).filter(([k])=>!['inspo','format','account'].includes(k)).map(([k,v])=><p key={k} className="brief-line"><span className="brief-label">{({hook:'Hook / concept',onscreen:'On screen',note:'Notes',caption:'Caption',audio:'Audio',analysis:'Analysis',stats:'Source stats',product:'Product',adapted:'Adapted concept',summary:'Reference summary'} as Record<string,string>)[k]||k}</span>{v}</p>)}
   {r.internal_notes&&<p className="brief-line"><span className="brief-label">Internal thinking (admins only)</span>{r.internal_notes}</p>}
   {urls.slice(3).map((u,i)=><p key={u}><TextLink href={u}>Original {i+4} ↗</TextLink></p>)}
   {!!r.extras?.length&&<div><p className="archive-muted">Unmapped source cells, preserved without relabeling</p>{r.extras.map((e,i)=><p key={i} className="brief-line"><span className="brief-label">Column {e.column}</span>{e.value}</p>)}</div>}
   {r.sources.length>0&&<p className="archive-muted">Blank fields are left blank. Source wording has not been silently corrected. Check source column alignment before publishing a creator brief.</p>}
   {r.sources.map((s,i)=><p key={i} className="archive-source"><TextLink href={s.url}>{s.sheet} / {s.tab} / row {s.row}</TextLink></p>)}
   {r.sources.length===0&&<p className="archive-source">Added in the app by {r.created_by}</p>}
   <p className="archive-muted">Last edited {new Date(r.updated_at).toLocaleString()}{r.updated_by?` by ${r.updated_by}`:''}</p>
  </details>
  {extra?.(r)}
  <div className="btn-row" style={{marginTop:10}}><button type="button" className="chip" aria-expanded={editing} onClick={()=>setEditing(!editing)}>{editing?'Close editor':'Edit'}</button></div>
  {editing&&<RecordEditor record={r} onSaved={(n,id)=>{onSaved(n,id);if(!n)setEditing(false);}}/>}
 </article>
}
