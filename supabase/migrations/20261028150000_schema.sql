-- Matiks Creator Hub — schema
--
-- Security model
--  * Admins sign in with Supabase Auth (email magic link, sign-ups disabled). Every table has RLS
--    forced on. The only table policies are for `authenticated` users whose email is an active
--    row in `admins` (private.is_admin()). Nobody can add themselves: inserting an admin requires
--    already being one.
--  * `anon` has no table privileges. Creators never touch tables: the creator page calls a few
--    SECURITY DEFINER functions with their link token, scoped to that creator's assigned,
--    published bundle versions only.
--  * Published bundle versions are immutable and hold only creator-visible fields.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ─────────── admins & audit ───────────
create table public.admins (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  active boolean not null default true,
  added_by text not null,
  added_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create function private.current_email() returns text language sql stable
as $$ select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') $$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins a where a.active and a.email = private.current_email()) $$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated, service_role;

-- Lets the frontend ask "am I an admin?" without exposing the admin list.
create function public.am_i_admin() returns boolean language sql stable security definer set search_path = ''
as $$ select private.is_admin() $$;
revoke all on function public.am_i_admin() from public;
grant execute on function public.am_i_admin() to authenticated;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'
);
create index on public.audit_log (at desc);

create function private.audit(p_action text, p_entity text, p_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = ''
as $$ insert into public.audit_log (actor, action, entity, entity_id, details)
      values (coalesce(private.current_email(), 'system'), p_action, p_entity, p_id, coalesce(p_details, '{}')) $$;
revoke all on function private.audit(text, text, text, jsonb) from public;

create function private.audit_row() returns trigger language plpgsql security definer set search_path = ''
as $$
declare rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end; changed text[] := '{}'; k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at', 'updated_by') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then changed := changed || k; end if;
    end loop;
    if cardinality(changed) = 0 then return new; end if;
  end if;
  perform private.audit(lower(tg_op), tg_table_name, coalesce(rec ->> 'id', rec ->> 'email'),
    case when tg_op = 'UPDATE' then jsonb_build_object('fields', changed) else '{}'::jsonb end);
  return coalesce(new, old);
end $$;

create function private.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := coalesce(private.current_email(), 'system'); return new; end $$;

create function private.guard_last_admin() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.active) or (tg_op = 'UPDATE' and old.active and not new.active) then
    if (select count(*) from public.admins where active and email <> old.email) = 0 then
      raise exception 'Cannot remove the last active admin';
    end if;
  end if;
  if tg_op = 'UPDATE' and not new.active and new.deactivated_at is null then new.deactivated_at := now(); end if;
  return coalesce(new, old);
end $$;
create trigger admins_guard before update or delete on public.admins for each row execute function private.guard_last_admin();
create trigger admins_audit after insert or update or delete on public.admins for each row execute function private.audit_row();

-- ─────────── weeks ───────────
create table public.weeks (
  number int primary key check (number > 0),
  label text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index weeks_one_current on public.weeks (is_current) where is_current;

-- ─────────── library records ───────────
-- One row per library item, in the same shape as the approved frontend's archive records:
-- inspiration, adapted concepts, planning notes, historical bundle briefs, posting instructions,
-- winners and learnings. Personas (Unhinged / Hot girl / Gameplays) are a separate field from
-- format. week null = pages library.
create table public.records (
  id text primary key default encode(extensions.gen_random_bytes(8), 'hex'),
  week int references public.weeks on update cascade on delete restrict,
  persona text not null default '' check (persona in ('', 'Unhinged', 'Hot girl', 'Gameplays')),
  stage text not null check (stage in ('Inspiration', 'Adapted concepts', 'Planning notes', 'Bundle briefs', 'Posting instructions', 'Winners', 'Learnings')),
  workflow text check (workflow in ('Dump', 'Developing', 'Approved')),  -- ideation queue
  format text not null default 'Uncategorized',
  title text not null default '',
  fields jsonb not null default '{}',     -- inspo, hook, onscreen, note, caption, audio, analysis, stats, product, account, …
  extras jsonb not null default '[]',     -- unmapped source cells, preserved with their column
  source_cells jsonb,
  needs_review boolean not null default false,
  sources jsonb not null default '[]',    -- sheet / tab / row / url provenance
  internal_notes text not null default '',
  tags text[] not null default '{}',
  -- the same reference attached to more weeks / personas (instead of a duplicate row)
  also_weeks int[] not null default '{}',
  also_personas text[] not null default '{}' check (also_personas <@ array['Unhinged', 'Hot girl', 'Gameplays']),
  -- reference link (set by "Import link"; also filled for imported rows with one link)
  url text,
  url_key text,
  platform text,
  link_kind text,
  meta_title text,
  meta_author text,
  thumbnail_url text check (thumbnail_url is null or thumbnail_url like 'https://%'),
  embed_provider text check (embed_provider in ('youtube', 'tiktok', 'instagram')),
  embed_id text check (embed_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  metadata_status text check (metadata_status in ('fetched', 'partial', 'blocked', 'manual')),
  metadata_error text,
  -- one-time import bookkeeping (see scripts/seed.ts)
  seed jsonb,                 -- content as imported; lets a re-import tell sheet changes from app edits
  seed_hash text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null default coalesce(private.current_email(), 'system'),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index on public.records (week, stage);
create index on public.records (url_key);
create index on public.records (persona) where persona <> '';

-- Recorded performance numbers: only what someone wrote down, with where and when.
create table public.winner_metrics (
  id uuid primary key default gen_random_uuid(),
  record_id text not null references public.records on delete cascade,
  metric text not null check (metric in ('views', 'likes', 'comments', 'shares', 'saves', 'followers', 'note')),
  value numeric,
  value_text text not null default '',
  observed_on date,
  source text not null check (length(btrim(source)) > 0),
  recorded_at timestamptz not null default now(),
  recorded_by text not null default coalesce(private.current_email(), 'system')
);

-- Re-import found a sheet change on a record that was also edited in the app: never overwrite,
-- hold it here until an admin chooses.
create table public.import_conflicts (
  id uuid primary key default gen_random_uuid(),
  record_id text not null references public.records on delete cascade,
  incoming jsonb not null,
  found_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('took_sheet', 'kept_app'))
);

-- ─────────── bundles & publishing ───────────
create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  week int not null references public.weeks on update cascade on delete restrict,
  number int not null check (number between 1 and 20),
  title text not null default '',
  posting_instructions text not null default '',
  current_version int,
  created_at timestamptz not null default now(),
  created_by text not null default coalesce(private.current_email(), 'system'),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (week, number)
);

create table public.bundle_briefs (
  id uuid primary key default gen_random_uuid(),     -- stable brief key across versions
  bundle_id uuid not null references public.bundles on delete cascade,
  position int not null default 0,
  source_record_id text references public.records on delete set null,
  format text not null default '',
  title text not null default '',
  inspo jsonb not null default '[]' check (jsonb_typeof(inspo) = 'array'),  -- [{url, label?}]
  onscreen text not null default '',
  script text not null default '',
  alternate_hooks text[] not null default '{}',
  note text not null default '',
  caption text not null default '',
  audio text not null default '',
  posting_notes text not null default '',
  internal_notes text not null default '',            -- admins only; never published
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index on public.bundle_briefs (bundle_id, position);

create table public.bundle_versions (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles on delete restrict,
  version int not null,
  content jsonb not null,             -- creator-visible snapshot only
  content_hash text not null,
  change_summary text not null default '',
  published_at timestamptz not null default now(),
  published_by text not null,
  unique (bundle_id, version)
);
create function private.forbid_change() returns trigger language plpgsql as $$
begin raise exception '% rows are immutable', tg_table_name; end $$;
create trigger bundle_versions_immutable before update or delete on public.bundle_versions for each row execute function private.forbid_change();

-- ─────────── creators ───────────
create table public.creators (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  is_test boolean not null default true,
  active boolean not null default true,
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default coalesce(private.current_email(), 'system'),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Staging safety: real (non-test) creators can't exist until an admin flips this setting.
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.settings (key, value) values ('allow_real_creators', 'false');

create function private.guard_real_creator() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not new.is_test and coalesce((select value from public.settings where key = 'allow_real_creators'), 'false') <> 'true'::jsonb then
    raise exception 'Real creator links are switched off until sharing is approved. Add this as a test creator.';
  end if;
  return new;
end $$;
create trigger creators_guard_real before insert or update of is_test on public.creators for each row execute function private.guard_real_creator();

create table public.creator_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators on delete cascade,
  token_hash bytea not null unique,     -- sha256 of the token; the token itself is never stored
  token_hint text not null,
  created_at timestamptz not null default now(),
  created_by text not null default coalesce(private.current_email(), 'system'),
  revoked_at timestamptz,
  revoked_by text,
  last_used_at timestamptz
);
create unique index creator_links_one_active on public.creator_links (creator_id) where revoked_at is null;

create table public.creator_assignments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators on delete cascade,
  bundle_id uuid not null references public.bundles on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text not null default coalesce(private.current_email(), 'system'),
  removed_at timestamptz
);
create unique index creator_assignments_active on public.creator_assignments (creator_id, bundle_id) where removed_at is null;

create table public.creator_bundle_seen (
  creator_id uuid references public.creators on delete cascade,
  bundle_id uuid references public.bundles on delete cascade,
  last_seen_version int not null,
  last_seen_at timestamptz not null default now(),
  primary key (creator_id, bundle_id)
);

-- "Your progress" stepper: 0 Received, 1 Filming, 2 Submitted, 3 Approved (admin only), 4 Posted.
create table public.creator_bundle_status (
  creator_id uuid references public.creators on delete cascade,
  bundle_id uuid references public.bundles on delete cascade,
  status int not null check (status between 0 and 4),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (creator_id, bundle_id)
);

create table public.brief_progress (
  creator_id uuid references public.creators on delete cascade,
  bundle_id uuid references public.bundles on delete cascade,
  brief_key uuid not null,
  done boolean not null default false,
  done_version int,
  done_brief_hash text,
  updated_at timestamptz not null default now(),
  primary key (creator_id, brief_key)
);

create table public.brief_comments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators on delete cascade,
  bundle_id uuid not null references public.bundles on delete cascade,
  brief_key uuid not null,
  version int not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  hidden boolean not null default false
);
create index on public.brief_comments (creator_id, created_at desc);

-- ─────────── triggers ───────────
do $$ declare t text; begin
  foreach t in array array['records','bundles','bundle_briefs','creators'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function private.touch()', t, t);
  end loop;
  foreach t in array array['records','winner_metrics','bundles','bundle_briefs','creators','creator_links','creator_assignments','weeks','settings','import_conflicts'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.audit_row()', t, t);
  end loop;
end $$;

-- ─────────── privileges & RLS ───────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
grant usage on schema public to anon, authenticated;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['weeks','records','winner_metrics','import_conflicts','bundles','bundle_briefs','creators','creator_assignments','creator_bundle_status','settings'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (private.is_admin()) with check (private.is_admin())', t);
  end loop;
end $$;

grant select, insert, update on public.admins to authenticated;
create policy admins_read on public.admins for select to authenticated using (private.is_admin());
create policy admins_add on public.admins for insert to authenticated with check (private.is_admin() and added_by = private.current_email());
create policy admins_update on public.admins for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant select on public.audit_log, public.bundle_versions, public.creator_bundle_seen, public.brief_progress to authenticated;
create policy admin_read on public.audit_log for select to authenticated using (private.is_admin());
create policy admin_read on public.bundle_versions for select to authenticated using (private.is_admin());
create policy admin_read on public.creator_bundle_seen for select to authenticated using (private.is_admin());
create policy admin_read on public.brief_progress for select to authenticated using (private.is_admin());

grant select (id, creator_id, token_hint, created_at, created_by, revoked_at, revoked_by, last_used_at) on public.creator_links to authenticated;
grant insert (creator_id, token_hash, token_hint) on public.creator_links to authenticated;
grant update (revoked_at, revoked_by) on public.creator_links to authenticated;
create policy admin_read on public.creator_links for select to authenticated using (private.is_admin());
create policy admin_insert on public.creator_links for insert to authenticated with check (private.is_admin());
create policy admin_revoke on public.creator_links for update to authenticated using (private.is_admin() and revoked_at is null) with check (private.is_admin() and revoked_at is not null);

grant select, update (hidden) on public.brief_comments to authenticated;
create policy admin_read on public.brief_comments for select to authenticated using (private.is_admin());
create policy admin_hide on public.brief_comments for update to authenticated using (private.is_admin()) with check (private.is_admin());
