-- Publishing (admins) and creator-link access (no login, token-scoped).

create function private.brief_public(b public.bundle_briefs) returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'key', b.id, 'format', b.format, 'title', b.title, 'inspo', b.inspo, 'onscreen', b.onscreen,
    'script', b.script, 'alternate_hooks', to_jsonb(b.alternate_hooks), 'note', b.note,
    'caption', b.caption, 'audio', b.audio, 'posting_notes', b.posting_notes)
$$;

create function public.publish_bundle(p_bundle uuid, p_summary text default '')
returns int language plpgsql security definer set search_path = ''
as $$
declare
  b public.bundles; w public.weeks; prev public.bundle_versions;
  briefs jsonb; content jsonb; h text; next_version int;
  prev_hashes jsonb := '{}'; added jsonb; removed jsonb; changed jsonb;
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into b from public.bundles where id = p_bundle for update;
  if not found then raise exception 'bundle not found'; end if;
  select * into w from public.weeks where number = b.week;

  select coalesce(jsonb_agg(x.j || jsonb_build_object('hash', md5(x.j::text)) order by x.pos, x.id), '[]') into briefs
  from (select private.brief_public(bb) as j, bb.position as pos, bb.id from public.bundle_briefs bb where bb.bundle_id = p_bundle and not bb.removed) x;
  if jsonb_array_length(briefs) = 0 then raise exception 'Add at least one brief before publishing'; end if;

  select * into prev from public.bundle_versions where bundle_id = p_bundle order by version desc limit 1;
  if found then
    select coalesce(jsonb_object_agg(e ->> 'key', e ->> 'hash'), '{}') into prev_hashes from jsonb_array_elements(prev.content -> 'briefs') e;
  end if;
  select coalesce(jsonb_agg(e -> 'key'), '[]') into added from jsonb_array_elements(briefs) e where prev.id is not null and not prev_hashes ? (e ->> 'key');
  select coalesce(jsonb_agg(e -> 'key'), '[]') into changed from jsonb_array_elements(briefs) e where prev_hashes ? (e ->> 'key') and prev_hashes ->> (e ->> 'key') <> e ->> 'hash';
  select coalesce(jsonb_agg(to_jsonb(k)), '[]') into removed from jsonb_object_keys(prev_hashes) k
    where not exists (select 1 from jsonb_array_elements(briefs) e where e ->> 'key' = k);

  content := jsonb_build_object('week', w.number, 'week_label', w.label, 'bundle', b.number, 'title', b.title,
                                'posting_instructions', b.posting_instructions, 'briefs', briefs);
  h := md5(content::text);
  if prev.id is not null and prev.content_hash = h then raise exception 'Nothing changed since version %', prev.version; end if;
  next_version := coalesce(prev.version, 0) + 1;
  content := content || jsonb_build_object('changes', jsonb_build_object('added', added, 'changed', changed, 'removed', removed));

  insert into public.bundle_versions (bundle_id, version, content, content_hash, change_summary, published_by)
  values (p_bundle, next_version, content, h, coalesce(btrim(p_summary), ''), private.current_email());
  update public.bundles set current_version = next_version where id = p_bundle;
  perform private.audit('publish', 'bundles', p_bundle::text, jsonb_build_object('version', next_version,
    'added', jsonb_array_length(added), 'changed', jsonb_array_length(changed), 'removed', jsonb_array_length(removed)));
  return next_version;
end $$;
revoke all on function public.publish_bundle(uuid, text) from public;
grant execute on function public.publish_bundle(uuid, text) to authenticated;

create function public.set_current_week(p_week int) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.weeks set is_current = false where is_current and number <> p_week;
  update public.weeks set is_current = true where number = p_week;
end $$;
revoke all on function public.set_current_week(int) from public;
grant execute on function public.set_current_week(int) to authenticated;

-- ─────────── creator access ───────────
create function private.creator_for_token(p_token text)
returns table (creator_id uuid, link_id uuid, display_name text) language sql stable security definer set search_path = ''
as $$
  select c.id, l.id, c.display_name
  from public.creator_links l join public.creators c on c.id = l.creator_id
  where p_token ~ '^[A-Za-z0-9_-]{32,128}$'
    and l.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and l.revoked_at is null and c.active
$$;
revoke all on function private.creator_for_token(text) from public;

create function private.assert_assigned(p_creator uuid, p_bundle uuid) returns public.bundles
language plpgsql stable security definer set search_path = ''
as $$
declare b public.bundles;
begin
  select bu.* into b from public.bundles bu
  join public.creator_assignments a on a.bundle_id = bu.id and a.creator_id = p_creator and a.removed_at is null
  where bu.id = p_bundle and bu.current_version is not null;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return b;
end $$;
revoke all on function private.assert_assigned(uuid, uuid) from public;

-- Shared by the creator link and the admin "Creator view" preview.
create function private.feed_for(p_creator uuid, p_name text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'creator', jsonb_build_object('name', p_name),
    'fingerprint', coalesce(md5(string_agg(x.bundle_id::text || ':' || x.version::text, ',' order by x.bundle_id)), ''),
    'bundles', coalesce(jsonb_agg(x.j order by x.week desc, x.num), '[]'))
  from (
    select bu.id as bundle_id, v.version, bu.week, bu.number as num,
      jsonb_build_object(
        'bundle_id', bu.id, 'version', v.version, 'published_at', v.published_at, 'change_summary', v.change_summary,
        'content', v.content, 'last_seen_version', s.last_seen_version,
        'seen_hashes', coalesce((select jsonb_object_agg(e ->> 'key', e ->> 'hash') from public.bundle_versions pv, jsonb_array_elements(pv.content -> 'briefs') e
                                 where pv.bundle_id = bu.id and pv.version = s.last_seen_version), '{}'),
        'status', st.status,
        'progress', coalesce((select jsonb_agg(jsonb_build_object('brief_key', p.brief_key, 'done', p.done, 'done_version', p.done_version, 'done_brief_hash', p.done_brief_hash))
                              from public.brief_progress p where p.creator_id = p_creator and p.bundle_id = bu.id), '[]'),
        'comments', coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'brief_key', cm.brief_key, 'body', cm.body, 'version', cm.version, 'created_at', cm.created_at) order by cm.created_at)
                              from public.brief_comments cm where cm.creator_id = p_creator and cm.bundle_id = bu.id and not cm.hidden), '[]')
      ) as j
    from public.creator_assignments a
    join public.bundles bu on bu.id = a.bundle_id and bu.current_version is not null
    join public.bundle_versions v on v.bundle_id = bu.id and v.version = bu.current_version
    left join public.creator_bundle_seen s on s.creator_id = p_creator and s.bundle_id = bu.id
    left join public.creator_bundle_status st on st.creator_id = p_creator and st.bundle_id = bu.id
    where a.creator_id = p_creator and a.removed_at is null
  ) x
$$;
revoke all on function private.feed_for(uuid, text) from public;

create function public.creator_feed(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me record;
begin
  select * into me from private.creator_for_token(p_token);
  if not found then return null; end if;
  update public.creator_links set last_used_at = now() where id = me.link_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return private.feed_for(me.creator_id, me.display_name);
end $$;

create function public.admin_preview_feed(p_creator uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare n text;
begin
  if not private.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select display_name into n from public.creators where id = p_creator;
  if n is null then return null; end if;
  return private.feed_for(p_creator, n);
end $$;
revoke all on function public.admin_preview_feed(uuid) from public;
grant execute on function public.admin_preview_feed(uuid) to authenticated;

create function public.creator_fingerprint(p_token text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare me record; fp text;
begin
  select * into me from private.creator_for_token(p_token);
  if not found then return null; end if;
  select coalesce(md5(string_agg(bu.id::text || ':' || bu.current_version::text, ',' order by bu.id)), '') into fp
  from public.creator_assignments a join public.bundles bu on bu.id = a.bundle_id and bu.current_version is not null
  where a.creator_id = me.creator_id and a.removed_at is null;
  return fp;
end $$;

create function public.creator_mark_seen(p_token text, p_bundle uuid, p_version int) returns void
language plpgsql security definer set search_path = ''
as $$
declare me record; b public.bundles;
begin
  select * into me from private.creator_for_token(p_token);
  if not found then raise exception 'invalid link' using errcode = '28000'; end if;
  b := private.assert_assigned(me.creator_id, p_bundle);
  if p_version is null or p_version < 1 or p_version > b.current_version then raise exception 'bad version' using errcode = '22023'; end if;
  insert into public.creator_bundle_seen (creator_id, bundle_id, last_seen_version) values (me.creator_id, p_bundle, p_version)
  on conflict (creator_id, bundle_id) do update set last_seen_version = greatest(public.creator_bundle_seen.last_seen_version, excluded.last_seen_version), last_seen_at = now();
end $$;

create function public.creator_set_status(p_token text, p_bundle uuid, p_status int) returns int
language plpgsql security definer set search_path = ''
as $$
declare me record; b public.bundles;
begin
  select * into me from private.creator_for_token(p_token);
  if not found then raise exception 'invalid link' using errcode = '28000'; end if;
  b := private.assert_assigned(me.creator_id, p_bundle);
  if p_status is null or p_status not in (0, 1, 2, 4) then raise exception 'Only the Matiks team can mark a bundle Approved.' using errcode = '22023'; end if;
  insert into public.creator_bundle_status (creator_id, bundle_id, status, updated_by) values (me.creator_id, p_bundle, p_status, 'creator')
  on conflict (creator_id, bundle_id) do update set status = excluded.status, updated_at = now(), updated_by = 'creator';
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values ('creator:' || me.creator_id, 'set_status', 'bundles', p_bundle::text, jsonb_build_object('status', p_status));
  return p_status;
end $$;

create function public.creator_set_done(p_token text, p_bundle uuid, p_brief uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me record; b public.bundles; brief jsonb;
begin
  select * into me from private.creator_for_token(p_token);
  if not found then raise exception 'invalid link' using errcode = '28000'; end if;
  b := private.assert_assigned(me.creator_id, p_bundle);
  select e into brief from public.bundle_versions v, jsonb_array_elements(v.content -> 'briefs') e
   where v.bundle_id = p_bundle and v.version = b.current_version and e ->> 'key' = p_brief::text;
  if brief is null then raise exception 'not found' using errcode = 'P0002'; end if;
  insert into public.brief_progress (creator_id, bundle_id, brief_key, done, done_version, done_brief_hash, updated_at)
  values (me.creator_id, p_bundle, p_brief, coalesce(p_done, false), case when p_done then b.current_version end, case when p_done then brief ->> 'hash' end, now())
  on conflict (creator_id, brief_key) do update set done = excluded.done, done_version = excluded.done_version, done_brief_hash = excluded.done_brief_hash, updated_at = now();
  return jsonb_build_object('brief_key', p_brief, 'done', coalesce(p_done, false), 'done_version', case when p_done then b.current_version end, 'done_brief_hash', case when p_done then brief ->> 'hash' end);
end $$;

create function public.creator_add_comment(p_token text, p_bundle uuid, p_brief uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me record; b public.bundles; body text := btrim(coalesce(p_body, '')); c public.brief_comments;
begin
  select * into me from private.creator_for_token(p_token);
  if not found then raise exception 'invalid link' using errcode = '28000'; end if;
  b := private.assert_assigned(me.creator_id, p_bundle);
  if not exists (select 1 from public.bundle_versions v, jsonb_array_elements(v.content -> 'briefs') e
                 where v.bundle_id = p_bundle and v.version = b.current_version and e ->> 'key' = p_brief::text) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if length(body) < 1 or length(body) > 2000 then raise exception 'Comments must be 1–2000 characters.' using errcode = '22023'; end if;
  if (select count(*) from public.brief_comments where creator_id = me.creator_id and created_at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.brief_comments where creator_id = me.creator_id and created_at > now() - interval '1 day') >= 60 then
    raise exception 'Too many comments. Try again in a few minutes.' using errcode = '54000';
  end if;
  insert into public.brief_comments (creator_id, bundle_id, brief_key, version, body) values (me.creator_id, p_bundle, p_brief, b.current_version, body) returning * into c;
  return jsonb_build_object('id', c.id, 'brief_key', c.brief_key, 'body', c.body, 'version', c.version, 'created_at', c.created_at);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.creator_feed(text)', 'public.creator_fingerprint(text)', 'public.creator_mark_seen(text, uuid, int)',
                           'public.creator_set_status(text, uuid, int)', 'public.creator_set_done(text, uuid, uuid, boolean)', 'public.creator_add_comment(text, uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
