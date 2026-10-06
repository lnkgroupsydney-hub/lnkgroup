-- Password + email verification is an application-owned check, not Auth aal2.
-- Only the server can issue/consume challenges after validating the current
-- Auth user, live Auth session, membership, and verified email address.
begin;

create table public.lk_staff_email_checks (
  token_hash text primary key references public.lk_sessions(token_hash) on delete cascade,
  user_id uuid not null,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  challenge_id uuid not null,
  code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending', 'sent', 'failed', 'verified')),
  sent_at bigint not null,
  expires_at bigint not null,
  retry_at bigint not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  verified_until bigint,
  check (status not in ('pending', 'sent') or code_hash is not null),
  check ((status = 'verified') = (verified_until is not null))
);

alter table public.lk_staff_email_checks enable row level security;
revoke all on public.lk_staff_email_checks from public, anon, authenticated;
grant select, insert, update, delete on public.lk_staff_email_checks to service_role;

create function public.lk_staff_email_command(command text, args jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_expiry bigint;
  ms bigint;
  target_user uuid;
  challenge uuid;
  current_check public.lk_staff_email_checks%rowtype;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'STAFF_EMAIL_ACCESS_UNAVAILABLE';
  end if;

  if command is null or command not in ('status', 'issue', 'sent', 'failed', 'verify')
      or args is null or pg_catalog.jsonb_typeof(args) <> 'object'
      or coalesce(args->>'token_hash', '') !~ '^[0-9a-f]{64}$'
      or coalesce(args->>'email_hash', '') !~ '^[0-9a-f]{64}$'
      or coalesce(args->>'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (command <> 'status' and coalesce(args->>'challenge_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (command in ('issue', 'verify') and coalesce(args->>'code_hash', '') !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = 'P0001', message = 'STAFF_EMAIL_INVALID_REQUEST';
  end if;

  target_user := (args->>'user_id')::uuid;
  challenge := (args->>'challenge_id')::uuid;

  -- Lock the parent even before a first challenge exists. This serializes issue,
  -- delivery acknowledgement, verification and session deletion for this token.
  -- Time is read AFTER waiting for the lock so a queued request cannot use stale
  -- expiry/cooldown information from the start of its statement.
  select s.expires_at into session_expiry from public.lk_sessions s
    where s.token_hash = args->>'token_hash'
      and s.mode = 'staff' and s.account_sub = target_user::text
    for update;
  ms := (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint;
  if session_expiry is null or session_expiry <= ms then
    if command = 'issue' then
      raise exception using errcode = 'P0001', message = 'STAFF_EMAIL_ACCESS_UNAVAILABLE';
    elsif command = 'verify' then return '{"verified":false}'::jsonb;
    elsif command in ('sent', 'failed') then return '{"updated":false}'::jsonb;
    else return null;
    end if;
  end if;

  select c.* into current_check from public.lk_staff_email_checks c
    where c.token_hash = args->>'token_hash' for update;

  if command = 'issue' then
    if current_check.retry_at > ms then
      raise exception using errcode = 'P0001', message = 'STAFF_EMAIL_RATE_LIMITED';
    end if;
    insert into public.lk_staff_email_checks (
      token_hash, user_id, email_hash, challenge_id, code_hash, status,
      sent_at, expires_at, retry_at, attempts, verified_until
    ) values (
      args->>'token_hash', target_user, args->>'email_hash', challenge,
      args->>'code_hash', 'pending', ms, least(ms + 600000, session_expiry),
      ms + 60000, 0, null
    ) on conflict (token_hash) do update set
      user_id = excluded.user_id, email_hash = excluded.email_hash,
      challenge_id = excluded.challenge_id, code_hash = excluded.code_hash,
      status = excluded.status, sent_at = excluded.sent_at,
      expires_at = excluded.expires_at, retry_at = excluded.retry_at,
      attempts = excluded.attempts, verified_until = excluded.verified_until
    returning * into current_check;
  elsif current_check.token_hash is null
      or current_check.user_id <> target_user
      or current_check.email_hash <> args->>'email_hash' then
    if command = 'verify' then return '{"verified":false}'::jsonb;
    elsif command in ('sent', 'failed') then return '{"updated":false}'::jsonb;
    else return null;
    end if;
  elsif command in ('sent', 'failed') then
    -- A sent acknowledgement may commit even if its HTTP response is lost.
    -- Failure cleanup may therefore revoke pending OR sent for this exact
    -- challenge, but never a replacement or already-consumed verification.
    if current_check.challenge_id <> challenge
        or (command = 'sent' and current_check.status <> 'pending')
        or (command = 'failed' and current_check.status not in ('pending', 'sent'))
        or (command = 'sent' and current_check.expires_at <= ms) then
      return '{"updated":false}'::jsonb;
    end if;
    update public.lk_staff_email_checks set
      status = case when command = 'sent' then 'sent' else 'failed' end,
      code_hash = case when command = 'failed' then null else code_hash end,
      sent_at = case when command = 'sent' then ms else sent_at end
    where token_hash = current_check.token_hash;
    return '{"updated":true}'::jsonb;
  elsif command = 'verify' then
    if current_check.challenge_id <> challenge or current_check.status <> 'sent'
        or current_check.expires_at <= ms or current_check.attempts >= 5 then
      return '{"verified":false}'::jsonb;
    end if;
    if current_check.code_hash is distinct from args->>'code_hash' then
      update public.lk_staff_email_checks set
        attempts = attempts + 1,
        status = case when attempts >= 4 then 'failed' else status end,
        code_hash = case when attempts >= 4 then null else code_hash end
      where token_hash = current_check.token_hash;
      -- Return instead of raising: failed guesses must survive the transaction.
      return '{"verified":false}'::jsonb;
    end if;
    update public.lk_staff_email_checks set status = 'verified', code_hash = null,
      verified_until = session_expiry where token_hash = current_check.token_hash;
    return pg_catalog.jsonb_build_object('verified', true, 'verifiedUntil', session_expiry);
  end if;

  -- Safe status only; neither a code nor its hash leaves this server-only RPC.
  return pg_catalog.jsonb_build_object(
    'challengeId', current_check.challenge_id,
    'sent', current_check.status = 'sent',
    'expiresAt', current_check.expires_at,
    'retryAt', current_check.retry_at,
    'verifiedUntil', case when current_check.status = 'verified'
      and current_check.verified_until > ms
      then least(current_check.verified_until, session_expiry) else null end
  );
end;
$$;

revoke all on function public.lk_staff_email_command(text, jsonb) from public, anon, authenticated;
grant execute on function public.lk_staff_email_command(text, jsonb) to service_role;

commit;
