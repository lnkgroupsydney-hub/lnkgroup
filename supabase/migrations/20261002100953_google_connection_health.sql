-- Bounded health codes only: no provider response bodies or tokens are copied here.
alter table public.lk_google_connection
  add column auth_health_code text not null default 'unverified',
  add column auth_health_checked_at bigint,
  add column gmail_health_code text not null default 'unverified',
  add column gmail_health_checked_at bigint,
  add column calendar_health_code text not null default 'unverified',
  add column calendar_health_checked_at bigint;

create function public.lk_google_health(action text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare conn public.lk_google_connection; ms bigint; observed bigint; kind text; code text;
begin
  -- Share the existing operations transaction lock and credential/lease fences.
  perform pg_advisory_xact_lock(76001001);
  ms := floor(extract(epoch from clock_timestamp())*1000);
  if action='reconnect' then
    select * into conn from public.lk_google_connection where id=1;
    if found and conn.account_sub is distinct from args->>'account_sub' then
      raise exception using errcode='LK409',message='Company Google account changed; review the connection';
    end if;
    perform public.lk_operations_command('connection_save',args);
    update public.lk_google_connection set auth_health_code='ready',auth_health_checked_at=ms,
      gmail_health_code='unverified',gmail_health_checked_at=null,gmail_error=null,
      calendar_health_code='unverified',calendar_health_checked_at=null,calendar_error=null where id=1;
    return 'true';
  end if;
  if action='select' then
    perform public.lk_operations_command('connection_select',args);
    if args->>'kind'='gmail' then
      update public.lk_google_connection set gmail_health_code='unverified',gmail_health_checked_at=null where id=1;
    else
      update public.lk_google_connection set calendar_health_code='unverified',calendar_health_checked_at=null where id=1;
    end if;
    return 'true';
  end if;
  if action='reset_gmail_cursor' then
    if not exists(select 1 from public.lk_sync_lease where holder=args->>'holder' and expires_at>ms) then
      raise exception using errcode='LK409',message='Sync lease expired';
    end if;
    update public.lk_google_connection set gmail_page_token=null where id=1
      and account_sub=args->>'account' and selected_gmail_label_id=args->>'label'
      and gmail_page_token=args->>'expected_token';
    if not found then raise exception using errcode='LK409',message='Gmail cursor changed; retry sync'; end if;
    return 'true';
  end if;
  if action<>'record' then raise exception using errcode='LK400',message='Invalid Google health operation'; end if;
  kind:=args->>'kind'; code:=args->>'code'; observed:=(args->>'observed_at')::bigint;
  if kind is null or kind not in ('auth','gmail','calendar') or code is null or code not in
    ('unverified','ready','partial','google_reconnect_required','google_temporary','google_configuration',
     'google_permission_denied','google_invalid_response','google_not_connected','google_connection_changed')
    or observed is null or observed<0 or observed>ms+60000 then
    raise exception using errcode='LK400',message='Invalid Google health state';
  end if;
  if args->>'holder' is not null then
    if not exists(select 1 from public.lk_sync_lease where holder=args->>'holder' and expires_at>ms) then
      raise exception using errcode='LK409',message='Sync lease expired';
    end if;
  elsif exists(select 1 from public.lk_sync_lease where expires_at>ms) then return 'false'; end if;
  select * into conn from public.lk_google_connection where id=1;
  if not found or conn.account_sub is distinct from args->>'account_sub'
    or conn.access_cipher is distinct from args->>'expected_access_cipher'
    or conn.refresh_cipher is distinct from args->>'expected_refresh_cipher' then return 'false'; end if;
  if kind='auth' and coalesce(conn.auth_health_checked_at,0)<=observed then
    update public.lk_google_connection set auth_health_code=code,auth_health_checked_at=observed where id=1;
  elsif kind='gmail' and conn.selected_gmail_label_id is not distinct from args->>'expected_target'
    and coalesce(conn.gmail_health_checked_at,0)<=observed then
    update public.lk_google_connection set gmail_health_code=code,gmail_health_checked_at=observed where id=1;
  elsif kind='calendar' and conn.selected_calendar_id is not distinct from args->>'expected_target'
    and coalesce(conn.calendar_health_checked_at,0)<=observed then
    update public.lk_google_connection set calendar_health_code=code,calendar_health_checked_at=observed where id=1;
  else return 'false'; end if;
  return 'true';
end $$;
revoke all on function public.lk_google_health(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_google_health(text,jsonb) to service_role;
