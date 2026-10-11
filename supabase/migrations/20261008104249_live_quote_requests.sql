-- RQ-01/02: additive live capture. Demo snapshots, guests and bookings stay intact.
begin;
create table public.lk_quote_requests (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'),
 reference text not null unique check(reference ~ '^RQ-[A-F0-9]{32}$'),
 owner_hash text not null check(owner_hash ~ '^[a-f0-9]{64}$'), owner_expires_at timestamptz not null,
 payload jsonb not null check(jsonb_typeof(payload)='object' and jsonb_typeof(payload->'contact')='object'),
 status text not null default 'draft' check(status in ('draft','review_requested')),
 revision integer not null check(revision>0), consent_version text not null check(consent_version='quote-storage-review-v1'),
 storage_consented_at timestamptz not null default now(), review_requested_at timestamptz,
 customer_id uuid, created_at timestamptz not null default now(), saved_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,owner_hash),
 foreign key(company_id,customer_id) references public.lk_customers(company_id,id),
 check((status='draft' and review_requested_at is null) or (status='review_requested' and review_requested_at is not null))
);
create index lk_quote_requests_company_saved on public.lk_quote_requests(company_id,saved_at desc,id);
create table public.lk_quote_request_audit (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), request_id uuid not null,
 owner_hash text not null check(owner_hash ~ '^[a-f0-9]{64}$'),
 action text not null check(action in ('save','request_review')), actor_type text not null check(actor_type='guest'),
 idempotency_key uuid not null, command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
 revision integer not null check(revision>0), result_json jsonb not null,
 created_at timestamptz not null default now(), foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id),
 unique(company_id,owner_hash,idempotency_key), unique(company_id,request_id,revision)
);
create index lk_quote_request_audit_request on public.lk_quote_request_audit(company_id,request_id,revision desc);

-- Future verified customer access is explicitly request-scoped. No email lookup
-- or guest capability grants authenticated access. No mutation path exists yet.
create table public.lk_quote_request_access (
 company_id text not null check(company_id='lk-group'), request_id uuid not null, auth_user_id uuid not null,
 verified_email text not null check(length(verified_email) between 3 and 254),
 verified_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
 primary key(company_id,request_id,auth_user_id), foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id)
);
-- Bounded foundations only: no seeded business price/terms or issuance command.
create table public.lk_terms_versions (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'),
 version integer not null check(version>0), body text not null check(length(btrim(body)) between 1 and 100000),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), approved_by uuid not null, approved_at timestamptz not null,
 unique(company_id,id), unique(company_id,version)
);
create table public.lk_quote_versions (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), request_id uuid not null,
 version integer not null check(version>0), request_revision integer not null check(request_revision>0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'), snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 currency text not null check(currency='AUD'), total_cents bigint not null check(total_cents>=0),
 issued_by uuid not null, issued_at timestamptz not null, valid_until timestamptz not null,
 unique(company_id,id), unique(company_id,request_id,id), unique(company_id,request_id,version),
 foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id), check(valid_until>issued_at)
);
create table public.lk_quote_acceptances (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), request_id uuid not null,
 quote_version_id uuid not null, terms_version_id uuid not null, auth_user_id uuid not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'), snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 signature jsonb not null check(jsonb_typeof(signature)='object'), accepted_at timestamptz not null,
 idempotency_key uuid not null, unique(company_id,idempotency_key), unique(company_id,quote_version_id,auth_user_id),
 foreign key(company_id,request_id,quote_version_id) references public.lk_quote_versions(company_id,request_id,id),
 foreign key(company_id,terms_version_id) references public.lk_terms_versions(company_id,id),
 foreign key(company_id,request_id,auth_user_id) references public.lk_quote_request_access(company_id,request_id,auth_user_id)
);
alter table public.lk_quote_requests enable row level security;
alter table public.lk_quote_request_audit enable row level security;
alter table public.lk_quote_request_access enable row level security;
alter table public.lk_terms_versions enable row level security;
alter table public.lk_quote_versions enable row level security;
alter table public.lk_quote_acceptances enable row level security;
revoke all on public.lk_quote_requests,public.lk_quote_request_audit,public.lk_quote_request_access,public.lk_terms_versions,public.lk_quote_versions,public.lk_quote_acceptances from public,anon,authenticated,service_role;
grant select,insert,update on public.lk_quote_requests to service_role;
grant select,insert on public.lk_quote_request_audit to service_role;
-- Privileged readers only until the respective reviewed features are implemented.
grant select on public.lk_quote_request_access,public.lk_terms_versions,public.lk_quote_versions,public.lk_quote_acceptances to service_role;

create function public.lk_quote_request_json(r public.lk_quote_requests) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'reference',r.reference,'mode','live','companyId',r.company_id,
 'revision',r.revision,'status',r.status,'payload',r.payload,'consentVersion',r.consent_version,
 'savedAt',r.saved_at,'createdAt',r.created_at,'reviewRequestedAt',r.review_requested_at,'customerId',r.customer_id);
$$;
create function public.lk_quote_requests_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 r public.lk_quote_requests; a public.lk_quote_request_audit; result jsonb; request_hash text;
 owner text; expiry timestamptz; key uuid; expected integer; company text; rid uuid; incoming_payload jsonb;
 page integer; size integer; term text; total bigint; items jsonb; audit jsonb;
begin
 company:=args->>'companyId';
 if company is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company access denied.'; end if;
 if command in ('list','detail') then
  if coalesce(args->>'actorUserId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  or coalesce(args->>'actorSessionId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  then raise exception using errcode='LK403',message='Verified staff actor required.'; end if;
  if command='detail' then
   if coalesce(args->>'id','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid request identifier.'; end if;
   select * into r from public.lk_quote_requests where company_id=company and id=(args->>'id')::uuid;
   if not found then raise exception using errcode='LK404',message='Quote request not found.'; end if;
   select coalesce(jsonb_agg(x.item order by x.revision desc),'[]'::jsonb) into audit from (
    select jsonb_build_object('id',e.id,'action',e.action,'actorType',e.actor_type,'revision',e.revision,'createdAt',e.created_at) item,e.revision
    from public.lk_quote_request_audit e where e.company_id=company and e.request_id=r.id order by e.revision desc limit 100
   ) x;
   return jsonb_build_object('request',public.lk_quote_request_json(r),'audit',audit);
  end if;
  if coalesce(args->>'page','') !~ '^\d{1,6}$' or coalesce(args->>'pageSize','') !~ '^\d{1,2}$' then raise exception using errcode='LK400',message='Invalid request search.'; end if;
  page:=(args->>'page')::integer; size:=(args->>'pageSize')::integer; term:=coalesce(args->>'q','');
  if page not between 1 and 100000 or size not between 1 and 50 or length(term)>120 then raise exception using errcode='LK400',message='Invalid request search.'; end if;
  select count(*) into total from public.lk_quote_requests q where company_id=company and (term='' or strpos(lower(concat_ws(' ',q.reference,q.payload->'contact'->>'name',q.payload->'contact'->>'email',q.payload->'contact'->>'siteAddress')),lower(term))>0);
  select coalesce(jsonb_agg(x.item),'[]'::jsonb) into items from (
   select public.lk_quote_request_json(q) item from public.lk_quote_requests q where company_id=company and (term='' or strpos(lower(concat_ws(' ',q.reference,q.payload->'contact'->>'name',q.payload->'contact'->>'email',q.payload->'contact'->>'siteAddress')),lower(term))>0)
   order by saved_at desc,id limit size offset (page-1)*size
  ) x;
  return jsonb_build_object('requests',items,'total',total,'page',page,'pageSize',size);
 end if;
 if command not in ('read','save','request_review') then raise exception using errcode='LK400',message='Invalid quote request command.'; end if;
 owner:=args->>'ownerHash';
 if owner is null or owner !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK401',message='Private request access required.'; end if;
 -- Serializes both the initial insert and subsequent idempotency/revision checks.
 perform pg_advisory_xact_lock(hashtextextended('live-request:'||company||':'||owner,0));
 select * into r from public.lk_quote_requests where company_id=company and owner_hash=owner for update;
 if found and r.owner_expires_at<=now() then raise exception using errcode='LK401',message='Private request access expired. Saved company records are retained.'; end if;
 if command='read' then return case when r.id is null then null else public.lk_quote_request_json(r) end; end if;
 if coalesce(args->>'expectedRevision','') !~ '^\d{1,10}$' or (args->>'expectedRevision')::bigint>2147483646
 or coalesce(args->>'idempotencyKey','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'
 then raise exception using errcode='LK400',message='Invalid saved revision or retry key.'; end if;
 expected:=(args->>'expectedRevision')::integer; key:=(args->>'idempotencyKey')::uuid;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('command',command,'expectedRevision',expected,'payload',args->'payload','storageConsent',args->'storageConsent','consentVersion',args->'consentVersion')::text,'UTF8')),'hex');
 select * into a from public.lk_quote_request_audit where company_id=company and owner_hash=owner and idempotency_key=key;
 if found then
  if a.command_hash<>request_hash then raise exception using errcode='LK409',message='This retry key belongs to different saved details.'; end if;
  return a.result_json;
 end if;
 if r.id is null and (expected<>0 or command<>'save') then raise exception using errcode='LK409',message='Save contact and service details first.'; end if;
 if r.id is not null and (r.revision<>expected or r.status<>'draft') then raise exception using errcode='LK409',message='This request changed or was sent for review. Reload saved details before editing.'; end if;
 if command='save' then
  if args->'storageConsent' is distinct from 'true'::jsonb or args->>'consentVersion' is distinct from 'quote-storage-review-v1'
  then raise exception using errcode='LK400',message='Storage and company review consent required.'; end if;
  incoming_payload:=args->'payload';
  if jsonb_typeof(incoming_payload) is distinct from 'object' or jsonb_typeof(incoming_payload->'contact') is distinct from 'object'
  or jsonb_typeof(incoming_payload->'service') not in ('object','null') or not(incoming_payload ? 'service') or length(incoming_payload::text)>16000
  or incoming_payload->'contact'->'consent' is distinct from 'true'::jsonb
  or coalesce(length(btrim(incoming_payload->'contact'->>'name')),0) not between 1 and 120
  or coalesce(incoming_payload->'contact'->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or length(incoming_payload->'contact'->>'email')>254
  or coalesce(length(btrim(incoming_payload->'contact'->>'siteAddress')),0) not between 1 and 240
  or coalesce(length(btrim(incoming_payload->'contact'->>'suburb')),0) not between 1 and 100
  or coalesce(incoming_payload->'contact'->>'postcode','') !~ '^\d{4}$'
  or length(coalesce(incoming_payload->'contact'->>'phone',''))>40 or length(coalesce(incoming_payload->'contact'->>'details',''))>3000
  or (jsonb_typeof(incoming_payload->'service')='object' and incoming_payload->'service'->>'serviceId' is distinct from 'cabinet-painting')
  then raise exception using errcode='LK400',message='Invalid quote request details.'; end if;
  if r.id is null then
   begin expiry:=(args->>'expiresAt')::timestamptz; exception when others then raise exception using errcode='LK400',message='Invalid private access expiry.'; end;
   if expiry is null or expiry<=now() or expiry>now()+interval '24 hours 1 minute' then raise exception using errcode='LK401',message='Private request access expired.'; end if;
   perform pg_advisory_xact_lock(hashtextextended('live-quote-requests:create:global',0));
   perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','live-quote-requests:create:global','max',100,'window',3600000));
   rid:=gen_random_uuid();
   insert into public.lk_quote_requests(id,company_id,reference,owner_hash,owner_expires_at,payload,revision,consent_version)
   values(rid,company,'RQ-'||upper(replace(rid::text,'-','')),owner,expiry,incoming_payload,1,'quote-storage-review-v1') returning * into r;
  else
   update public.lk_quote_requests set payload=incoming_payload,revision=revision+1,saved_at=now() where id=r.id returning * into r;
  end if;
 else
  if r.payload->'service' is null or jsonb_typeof(r.payload->'service')<>'object' then raise exception using errcode='LK400',message='Save your service details before requesting review.'; end if;
  update public.lk_quote_requests set status='review_requested',review_requested_at=now(),saved_at=now(),revision=revision+1 where id=r.id returning * into r;
 end if;
 -- Bound capability rotation globally and repeated mutations per owner. Exact
 -- receipt replays return above and never consume these transactional counters.
 perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','live-quote-requests:write:'||owner,'max',60,'window',3600000));
 result:=public.lk_quote_request_json(r);
 insert into public.lk_quote_request_audit(company_id,request_id,owner_hash,action,actor_type,idempotency_key,command_hash,revision,result_json)
 values(company,r.id,owner,command,'guest',key,request_hash,r.revision,result);
 return result;
end;
$$;
revoke all on function public.lk_quote_request_json(public.lk_quote_requests),public.lk_quote_requests_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_request_json(public.lk_quote_requests),public.lk_quote_requests_command(text,jsonb) to service_role;
commit;
