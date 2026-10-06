-- Server-only ESN session registry control. The Auth provider cleanup follows
-- this committed removal; provider failure must never restore ESN access.
begin;

create function public.lk_staff_sessions_command(command text, input_token_hash text, input_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer;
  ms bigint;
  current_expiry bigint;
  other_count bigint;
  other_sessions jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'STAFF_SESSION_ACCESS_DENIED' using errcode = '42501';
  end if;
  if input_token_hash is null or input_user_id is null then
    raise exception 'STAFF_SESSION_REQUIRED' using errcode = 'P0001';
  end if;
  -- Serialize same-account commands. A second session that passed the HTTP
  -- guard before this transaction must recheck its surviving registry entry.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lk-staff-sessions:' || input_user_id::text, 0));
  ms := (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint;
  select s.expires_at into current_expiry from public.lk_sessions s
    where s.token_hash = input_token_hash and s.mode = 'staff'
      and s.account_sub = input_user_id::text and s.expires_at > ms
    for update;
  if not found then
    raise exception 'STAFF_SESSION_REQUIRED' using errcode = 'P0001';
  end if;
  if command = 'list' then
    -- Count and capped rows use the same statement snapshot even if a new
    -- sign-in registers a session concurrently with this read.
    select count(*), coalesce(
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('expiresAt', s.expires_at) order by s.expires_at)
        filter (where s.ordinal <= 50), '[]'::jsonb)
      into other_count, other_sessions from (
        select expires_at, row_number() over (order by expires_at, token_hash) ordinal
        from public.lk_sessions
        where mode = 'staff' and account_sub = input_user_id::text
          and token_hash <> input_token_hash and expires_at > ms
      ) s;
    return pg_catalog.jsonb_build_object('current', pg_catalog.jsonb_build_object('expiresAt', current_expiry),
      'otherSessionCount', other_count, 'otherSessions', other_sessions, 'truncated', other_count > 50);
  elsif command is distinct from 'revoke_others' then
    raise exception 'STAFF_SESSION_COMMAND_INVALID' using errcode = '22023';
  end if;
  delete from public.lk_sessions s
    where s.mode = 'staff' and s.account_sub = input_user_id::text
      and s.token_hash <> input_token_hash;
  get diagnostics removed = row_count;
  -- lk_staff_email_checks uses ON DELETE CASCADE. Current proof is preserved.
  return pg_catalog.jsonb_build_object('removedSessionCount', removed);
end;
$$;

revoke all on function public.lk_staff_sessions_command(text, text, uuid) from public, anon, authenticated;
grant execute on function public.lk_staff_sessions_command(text, text, uuid) to service_role;
commit;
