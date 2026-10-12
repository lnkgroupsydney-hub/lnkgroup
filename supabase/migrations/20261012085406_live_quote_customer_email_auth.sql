-- Request-scoped verified customer access. Original owner hashes and receipts stay stable.
begin;
create table public.lk_quote_customer_sessions (
 id uuid primary key, company_id text not null check(company_id='lk-group'), auth_user_id uuid not null,
 auth_session_id uuid not null, verified_email text not null, expires_at timestamptz not null,
 revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.lk_quote_customer_handoffs (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'), company_id text not null check(company_id='lk-group'),
 request_id uuid not null references public.lk_quote_requests(id), owner_hash text not null,
 expected_revision integer not null, verified_email text not null, expires_at timestamptz not null,
 consumed_at timestamptz, created_at timestamptz not null default now()
);
create table public.lk_quote_customer_challenges (
 id uuid primary key, proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),
 company_id text not null check(company_id='lk-group'), email text not null,
 request_id uuid references public.lk_quote_requests(id), owner_hash text, expected_revision integer,
 handoff_hash text references public.lk_quote_customer_handoffs(token_hash),
 expires_at timestamptz not null, attempts integer not null default 0, consumed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.lk_quote_customer_sessions enable row level security;
alter table public.lk_quote_customer_handoffs enable row level security;
alter table public.lk_quote_customer_challenges enable row level security;
revoke all on public.lk_quote_customer_sessions, public.lk_quote_customer_handoffs, public.lk_quote_customer_challenges from public, anon, authenticated, service_role;
grant select,insert,update on public.lk_quote_customer_sessions, public.lk_quote_customer_handoffs, public.lk_quote_customer_challenges to service_role;
grant insert,update on public.lk_quote_request_access to service_role;

create function public.lk_quote_customer_auth_session_active(input_session_id uuid,input_user_id uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
 return lk_private.staff_session_active(input_session_id,input_user_id);
end;
$$;
revoke all on function public.lk_quote_customer_auth_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lk_quote_customer_auth_session_active(uuid,uuid) to service_role;

create function public.lk_quote_customer_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 company text:=args->>'companyId'; email text:=lower(btrim(args->>'email'));
 r public.lk_quote_requests; c public.lk_quote_customer_challenges; s public.lk_quote_customer_sessions;
 h public.lk_quote_customer_handoffs; rid uuid; uid uuid; sid uuid; expires timestamptz; items jsonb;
begin
 if company is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company access denied.'; end if;
 if command in ('challenge_create','handoff_create') then
  if email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(email)>254 then raise exception using errcode='LK400',message='Enter a valid email address.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('quote-customer-send:global',0));
  perform pg_advisory_xact_lock(hashtextextended('quote-customer-email:'||email,0));
  perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','quote-customer-send:global','max',100,'window',3600000));
  if command='challenge_create' then
   perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','quote-customer-send:'||encode(sha256(convert_to(email,'UTF8')),'hex'),'max',1,'window',60000));
   perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','quote-customer-hour:'||encode(sha256(convert_to(email,'UTF8')),'hex'),'max',6,'window',3600000));
  end if;
  if args->>'handoffHash' is not null then
   select * into h from public.lk_quote_customer_handoffs where token_hash=args->>'handoffHash' and company_id=company for update;
   if not found or h.expires_at<=now() or h.consumed_at is not null or h.verified_email<>email then raise exception using errcode='LK401',message='This transfer expired. Reopen the original saved request or contact the company.'; end if;
   select * into r from public.lk_quote_requests where company_id=company and id=h.request_id and owner_hash=h.owner_hash for update;
   if not found or r.revision<>h.expected_revision or lower(r.payload->'contact'->>'email')<>email then raise exception using errcode='LK409',message='Saved request details changed. Restart email verification.'; end if;
  elsif args->>'requestId' is not null then
   rid:=(args->>'requestId')::uuid;
   select * into r from public.lk_quote_requests where company_id=company and id=rid and owner_hash=args->>'ownerHash' for update;
   if not found or r.owner_expires_at<=now() then raise exception using errcode='LK401',message='Open your saved request before linking this email.'; end if;
   if r.revision<>(args->>'expectedRevision')::integer or lower(r.payload->'contact'->>'email')<>email then raise exception using errcode='LK409',message='Saved request details changed. Save the matching email before verifying.'; end if;
  end if;
  if command='handoff_create' then
   if r.id is null or args->>'tokenHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK401',message='Open your original saved request first.'; end if;
   insert into public.lk_quote_customer_handoffs(token_hash,company_id,request_id,owner_hash,expected_revision,verified_email,expires_at)
   values(args->>'tokenHash',company,r.id,r.owner_hash,r.revision,email,now()+interval '15 minutes');
   return jsonb_build_object('created',true);
  end if;
  if args->>'proofHash' is null or args->>'proofHash' !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK400',message='Invalid verification request.'; end if;
  insert into public.lk_quote_customer_challenges(id,proof_hash,company_id,email,request_id,owner_hash,expected_revision,handoff_hash,expires_at)
  values((args->>'challengeId')::uuid,args->>'proofHash',company,email,r.id,r.owner_hash,r.revision,h.token_hash,now()+interval '15 minutes');
  return jsonb_build_object('created',true);
 end if;
 if command in ('attempt','complete') then
  select * into c from public.lk_quote_customer_challenges where id=(args->>'challengeId')::uuid and company_id=company and proof_hash=args->>'proofHash' for update;
  if not found or c.consumed_at is not null or c.expires_at<=now() then raise exception using errcode='LK401',message='Your verification expired. Request a new code.'; end if;
  if command='attempt' then
   if c.attempts>=5 then raise exception using errcode='LK429',message='Too many attempts. Request a new code after the cooldown.'; end if;
   update public.lk_quote_customer_challenges set attempts=attempts+1 where id=c.id;
   return jsonb_build_object('email',c.email);
  end if;
  if email is distinct from c.email or coalesce(c.attempts,0)<1 or c.attempts>5 then raise exception using errcode='LK403',message='Email verification could not be confirmed.'; end if;
  uid:=(args->>'authUserId')::uuid; sid:=(args->>'sessionId')::uuid; expires:=(args->>'expiresAt')::timestamptz;
  if uid is null or sid is null or expires<=now() or expires>now()+interval '1 hour 1 minute' then raise exception using errcode='LK401',message='Email verification session expired.'; end if;
  if c.request_id is not null then
   if c.handoff_hash is not null then
    select * into h from public.lk_quote_customer_handoffs where token_hash=c.handoff_hash for update;
    if not found or h.expires_at<=now() or h.consumed_at is not null then raise exception using errcode='LK401',message='This transfer has already been used or expired.'; end if;
   end if;
   select * into r from public.lk_quote_requests where company_id=company and id=c.request_id and owner_hash=c.owner_hash for update;
   if not found or r.revision<>c.expected_revision or lower(r.payload->'contact'->>'email')<>email then raise exception using errcode='LK409',message='Saved request details changed. Restart email verification.'; end if;
   if c.handoff_hash is not null then
    update public.lk_quote_customer_handoffs set consumed_at=now() where token_hash=h.token_hash;
   elsif r.owner_expires_at<=now() then raise exception using errcode='LK401',message='Your saved request access expired. Contact the company for recovery.';
   end if;
   if exists(select 1 from public.lk_quote_request_access a where a.company_id=company and a.request_id=r.id and a.auth_user_id<>uid and a.revoked_at is null) then raise exception using errcode='LK403',message='This request is already linked. Contact the company for recovery.'; end if;
   if exists(select 1 from public.lk_quote_request_access a where a.company_id=company and a.request_id=r.id and a.auth_user_id=uid and a.revoked_at is not null) then raise exception using errcode='LK403',message='Request access was withdrawn. Contact the company.'; end if;
   insert into public.lk_quote_request_access(company_id,request_id,auth_user_id,verified_email,verified_at)
   values(company,r.id,uid,email,now()) on conflict(company_id,request_id,auth_user_id) do nothing;
  end if;
  insert into public.lk_quote_customer_sessions(id,company_id,auth_user_id,auth_session_id,verified_email,expires_at)
  values(sid,company,uid,(args->>'authSessionId')::uuid,email,expires);
  update public.lk_quote_customer_challenges set consumed_at=now() where id=c.id;
  return jsonb_build_object('currentRequestId',r.id);
 end if;
 if command in ('state','resolve','logout') then
  select * into s from public.lk_quote_customer_sessions where id=(args->>'sessionId')::uuid and company_id=company and auth_user_id=(args->>'authUserId')::uuid and verified_email=email for update;
  if not found or s.revoked_at is not null or s.expires_at<=now() then raise exception using errcode='LK401',message='Your customer session expired. Verify your email to reopen saved quotes.'; end if;
  if command='logout' then
   update public.lk_quote_customer_sessions set revoked_at=now() where id=s.id;
   return jsonb_build_object('signedOut',true);
  end if;
  if command='state' then
   select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'reference',q.reference,'status',q.status,'savedAt',q.saved_at,'revision',q.revision) order by q.saved_at desc),'[]'::jsonb) into items
   from public.lk_quote_requests q join public.lk_quote_request_access a on a.company_id=q.company_id and a.request_id=q.id
   where a.company_id=company and a.auth_user_id=s.auth_user_id and a.revoked_at is null and a.verified_email=email and lower(q.payload->'contact'->>'email')=email;
   return jsonb_build_object('requests',items);
  end if;
  select q.* into r from public.lk_quote_requests q join public.lk_quote_request_access a on a.company_id=q.company_id and a.request_id=q.id
  where q.company_id=company and q.id=(args->>'requestId')::uuid and a.auth_user_id=s.auth_user_id and a.revoked_at is null and a.verified_email=email and lower(q.payload->'contact'->>'email')=email for update of q,a;
  if not found then raise exception using errcode='LK404',message='This saved quote is not available to your verified email.'; end if;
  -- Extending this server-only mapping does not extend the signed guest cookie's expiry.
  update public.lk_quote_requests set owner_expires_at=greatest(owner_expires_at,s.expires_at) where id=r.id;
  return jsonb_build_object('hash',r.owner_hash,'expiresAt',greatest(r.owner_expires_at,s.expires_at));
 end if;
 raise exception using errcode='LK400',message='Invalid customer verification command.';
end;
$$;
revoke all on function public.lk_quote_customer_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_customer_command(text,jsonb) to service_role;
-- A linked request's verified contact email cannot be reassigned by a residual guest capability.
alter function public.lk_quote_requests_command(text,jsonb) rename to lk_quote_requests_guest_command;
revoke all on function public.lk_quote_requests_guest_command(text,jsonb) from public,anon,authenticated;
create function public.lk_quote_requests_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare resolved jsonb;
begin
 if args->>'ownerHash' ~ '^[a-f0-9]{64}$' then
  perform pg_advisory_xact_lock(hashtextextended('live-request:'||(args->>'companyId')||':'||(args->>'ownerHash'),0));
 end if;
 if args ? 'customerAccess' then
  resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
  if resolved->>'hash' is distinct from args->>'ownerHash' then raise exception using errcode='LK403',message='Saved quote access changed.'; end if;
 end if;
 if args ? 'expectedRequestId' then
  perform 1 from public.lk_quote_requests q where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash' and q.id=(args->>'expectedRequestId')::uuid for update;
  if not found then raise exception using errcode='LK409',message='The selected quote changed. Reload before saving.'; end if;
 end if;
 if args->>'ownerHash' ~ '^[a-f0-9]{64}$' then
  perform pg_advisory_xact_lock(hashtextextended('live-request:'||(args->>'companyId')||':'||(args->>'ownerHash'),0));
  perform 1 from public.lk_quote_requests q where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash' for update;
 end if;
 if command='save' and exists(select 1 from public.lk_quote_requests q join public.lk_quote_request_access a on a.company_id=q.company_id and a.request_id=q.id
 where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash' and a.revoked_at is null
 and lower(args->'payload'->'contact'->>'email') is distinct from a.verified_email) then
  raise exception using errcode='LK409',message='This quote is linked to a verified email. Start a new request to use another email.';
 end if;
 return public.lk_quote_requests_guest_command(command,args-'customerAccess'-'expectedRequestId');
end;
$$;
revoke all on function public.lk_quote_requests_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_requests_command(text,jsonb) to service_role;
alter function public.lk_quote_media_command(text,jsonb) rename to lk_quote_media_guest_command;
revoke all on function public.lk_quote_media_guest_command(text,jsonb) from public,anon,authenticated;
create function public.lk_quote_media_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare resolved jsonb;
begin
 if args->>'ownerHash' ~ '^[a-f0-9]{64}$' then
  perform pg_advisory_xact_lock(hashtextextended('live-request:'||(args->>'companyId')||':'||(args->>'ownerHash'),0));
 end if;
 if args ? 'customerAccess' then
  resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
  if resolved->>'hash' is distinct from args->>'ownerHash' then raise exception using errcode='LK403',message='Saved quote access changed.'; end if;
 end if;
 if args ? 'expectedRequestId' then
  perform 1 from public.lk_quote_requests q where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash' and q.id=(args->>'expectedRequestId')::uuid for update;
  if not found then raise exception using errcode='LK409',message='The selected quote changed. Reload before saving.'; end if;
 end if;
 return public.lk_quote_media_guest_command(command,args-'customerAccess'-'expectedRequestId');
end;
$$;
revoke all on function public.lk_quote_media_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_media_command(text,jsonb) to service_role;
commit;
