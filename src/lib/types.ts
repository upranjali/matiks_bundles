export type Stage = 'Inspiration' | 'Adapted concepts' | 'Planning notes' | 'Bundle briefs' | 'Posting instructions' | 'Winners' | 'Learnings';
export type Workflow = 'Dump' | 'Developing' | 'Approved';
export type Persona = '' | 'Unhinged' | 'Hot girl' | 'Gameplays';
export const PERSONAS: Exclude<Persona, ''>[] = ['Unhinged', 'Hot girl', 'Gameplays'];
export const STAGES: Stage[] = ['Inspiration', 'Adapted concepts', 'Planning notes', 'Bundle briefs', 'Posting instructions', 'Winners', 'Learnings'];

export type Source = { sheet: string; tab: string; row: number; url: string; gid?: number };
export type RecordItem = {
  id: string; week: number | null; persona: Persona; stage: Stage; workflow: Workflow | null; format: string; title: string;
  fields: Record<string, string>; extras: { column: string; value: string }[]; source_cells: unknown; needs_review: boolean; sources: Source[];
  internal_notes: string; tags: string[]; also_weeks: number[]; also_personas: string[]; url: string | null; url_key: string | null; platform: string | null; link_kind: string | null;
  meta_title: string | null; meta_author: string | null; thumbnail_url: string | null; embed_provider: string | null; embed_id: string | null;
  metadata_status: string | null; metadata_error: string | null; archived: boolean; created_by: string; updated_at: string; updated_by: string | null;
};
export const RECORD_COLUMNS = 'id,week,persona,stage,workflow,format,title,fields,extras,source_cells,needs_review,sources,internal_notes,tags,also_weeks,also_personas,url,url_key,platform,link_kind,meta_title,meta_author,thumbnail_url,embed_provider,embed_id,metadata_status,metadata_error,archived,created_by,updated_at,updated_by';

export type Week = { number: number; label: string; is_current: boolean };
export type InspoLink = { url: string; label?: string };
export type Brief = {
  id: string; bundle_id: string; position: number; source_record_id: string | null; format: string; title: string; inspo: InspoLink[];
  onscreen: string; script: string; alternate_hooks: string[]; note: string; caption: string; audio: string; posting_notes: string;
  internal_notes: string; removed: boolean; updated_at: string;
};
export type Bundle = { id: string; week: number; number: number; title: string; posting_instructions: string; current_version: number | null; updated_at: string };
export type PublishedBrief = Omit<Brief, 'id' | 'bundle_id' | 'position' | 'source_record_id' | 'internal_notes' | 'removed' | 'updated_at'> & { key: string; hash: string };
export type VersionContent = { week: number; week_label: string; bundle: number; title: string; posting_instructions: string; briefs: PublishedBrief[]; changes?: { added: string[]; changed: string[]; removed: string[] } };
export type Version = { bundle_id: string; version: number; content: VersionContent; change_summary: string; published_at: string; published_by: string };
export type Creator = { id: string; display_name: string; is_test: boolean; active: boolean; internal_notes: string };

export type FeedBundle = {
  bundle_id: string; version: number; published_at: string; change_summary: string; content: VersionContent;
  last_seen_version: number | null; seen_hashes: Record<string, string>; status: number | null;
  progress: { brief_key: string; done: boolean; done_version: number | null; done_brief_hash: string | null }[];
  comments: { id: string; brief_key: string; body: string; version: number; created_at: string }[];
};
export type Feed = { creator: { name: string }; fingerprint: string; bundles: FeedBundle[] };

export const CREATOR_STATUSES = ['Received', 'Filming', 'Submitted', 'Approved', 'Posted'] as const;

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(iso)) : '';
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';
