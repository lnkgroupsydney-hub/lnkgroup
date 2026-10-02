-- Private, browser-owned drafts. Saving never creates enquiries, mail or calendar jobs.
begin;
create table public.lk_quote_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null unique check (owner_hash ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.lk_quote_drafts enable row level security;
revoke all on public.lk_quote_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.lk_quote_drafts to service_role;

create function public.lk_quote_draft(command text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.lk_quote_drafts; h text := args->>'owner_hash';
begin
  if h is null or h !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403', message='Invalid draft session'; end if;
  if command = 'read' then
    select * into d from public.lk_quote_drafts where owner_hash=h and expires_at>now();
    if not found then return 'null'; end if;
  elsif command = 'save' then
    if args->>'revision' is null or args->>'revision' !~ '^(0|[1-9][0-9]{0,9})$'
      or (args->>'revision')::numeric>2147483647 then
      raise exception using errcode='LK400',message='Invalid draft revision';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('quote-draft:'||h,0));
    select * into d from public.lk_quote_drafts where owner_hash=h for update;
    if found then
      if d.expires_at<=now() then raise exception using errcode='LK403',message='Draft session expired'; end if;
      if d.payload = args->'payload' and d.payload_hash=args->>'payload_hash' then
        return jsonb_build_object('id',d.id,'revision',d.revision,'payload',d.payload,'savedAt',d.updated_at);
      end if;
      if d.revision <> (args->>'revision')::integer then raise exception using errcode='LK409',message='Draft changed in another tab; reload before saving'; end if;
      update public.lk_quote_drafts set payload=args->'payload',payload_hash=args->>'payload_hash',revision=revision+1,updated_at=now() where id=d.id returning * into d;
    else
      if (args->>'revision')::integer is distinct from 0 then raise exception using errcode='LK409',message='Draft no longer available'; end if;
      if (args->>'expires_at')::timestamptz<=now() or (args->>'expires_at')::timestamptz>now()+interval '25 hours' then raise exception using errcode='LK403',message='Draft session expired'; end if;
      -- A signed session is inexpensive to replace. Bound new rows globally as
      -- well as the per-session HTTP save rate; retries/updates do not consume it.
      perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','quote-drafts:create:global','max',100,'window',3600000));
      insert into public.lk_quote_drafts(owner_hash,payload,payload_hash,expires_at) values(h,args->'payload',args->>'payload_hash',(args->>'expires_at')::timestamptz) returning * into d;
    end if;
  else raise exception using errcode='LK400',message='Unknown draft operation';
  end if;
  return jsonb_build_object('id',d.id,'revision',d.revision,'payload',d.payload,'savedAt',d.updated_at);
end;
$$;
revoke all on function public.lk_quote_draft(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_draft(text,jsonb) to service_role;
commit;
