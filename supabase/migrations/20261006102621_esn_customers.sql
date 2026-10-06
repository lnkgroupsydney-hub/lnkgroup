-- ESN-02: private customer register. No source mutation or contact-based merge.
begin;
create table public.lk_customers (
 id uuid primary key, company_id text not null default 'lk-group' check(company_id='lk-group'),
 name text not null check(length(btrim(name)) between 1 and 120),
 email text check(email is null or length(email) between 1 and 254),
 phone text check(phone is null or length(phone) between 1 and 80),
 address text check(address is null or length(address) between 1 and 500),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id)
);
create table public.lk_customer_record_links (
 company_id text not null check(company_id='lk-group'), customer_id uuid not null,
 source_type text not null check(source_type in ('enquiry','submission')), source_id uuid not null,
 enquiry_id uuid references public.lk_enquiries(id), submission_id uuid references public.lk_quote_submissions(id),
 created_at timestamptz not null default now(),
 primary key(company_id,source_type,source_id),
 foreign key(company_id,customer_id) references public.lk_customers(company_id,id),
 check((source_type='enquiry' and enquiry_id=source_id and enquiry_id is not null and submission_id is null)
   or (source_type='submission' and submission_id=source_id and submission_id is not null and enquiry_id is null))
);
create index lk_customer_links_customer on public.lk_customer_record_links(company_id,customer_id);
create table public.lk_customer_audit_events (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), customer_id uuid not null,
 action text not null check(action in ('create','link','unlink')), source_type text check(source_type in ('enquiry','submission')), source_id uuid,
 reason text not null check(length(btrim(reason)) between 1 and 500), actor_user_id uuid not null, actor_session_id uuid not null,
 idempotency_key text not null check(length(btrim(idempotency_key)) between 1 and 120), request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 result_json jsonb not null, revision integer not null check(revision>0), created_at timestamptz not null default now(),
 foreign key(company_id,customer_id) references public.lk_customers(company_id,id), unique(company_id,idempotency_key),
 check((action='create' and source_type is null and source_id is null) or (action in ('link','unlink') and source_type is not null and source_id is not null))
);
create index lk_customer_audit_customer on public.lk_customer_audit_events(company_id,customer_id,created_at desc);
alter table public.lk_customers enable row level security;
alter table public.lk_customer_record_links enable row level security;
alter table public.lk_customer_audit_events enable row level security;
revoke all on public.lk_customers,public.lk_customer_record_links,public.lk_customer_audit_events from public,anon,authenticated,service_role;
grant select,insert,update on public.lk_customers to service_role;
grant select,insert,delete on public.lk_customer_record_links to service_role;
grant select,insert on public.lk_customer_audit_events to service_role;

create function public.lk_customer_json(c public.lk_customers) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'companyId',c.company_id,'name',c.name,'email',c.email,'phone',c.phone,'address',c.address,'revision',c.revision,'createdAt',c.created_at,'updatedAt',c.updated_at);
$$;
-- Canonical grouped records: every signed submission owns its derived enquiries.
-- Only approved contact/status summaries and existing authorised resource URLs leave SQL.
create function public.lk_customer_records() returns table(source_type text, source_id uuid, related_enquiry_ids uuid[], record jsonb)
 language sql stable security invoker set search_path='' as $$
 select 'submission'::text,s.id,coalesce(rel.ids,array[]::uuid[]),jsonb_build_object(
 'sourceType','submission','sourceId',s.id,'reference',s.reference,'name',s.snapshot->'payload'->'contact'->>'name',
 'email',s.snapshot->'payload'->'contact'->>'email','phone',s.snapshot->'payload'->'contact'->>'phone',
 'address',s.snapshot->'payload'->'contact'->>'siteAddress','createdAt',s.submitted_at,'status',s.email_status,
 'relatedEnquiryIds',coalesce(to_jsonb(rel.ids),'[]'::jsonb),'booking',jsonb_build_object('status',coalesce(b.status,'requested'),'revision',coalesce(b.revision,0),'syncStatus',coalesce(b.sync_status,'pending'),'confirmedAt',b.confirmed_at),
 'links',jsonb_build_object('detail','/api/operations/bookings/'||s.id,'quotePdf','/api/operations/bookings/'||s.id||'/documents/quote','agreementPdf','/api/operations/bookings/'||s.id||'/documents/agreement','photos',null),
 'photos',coalesce((select jsonb_agg(jsonb_build_object('id',p->>'photoId','url','/api/operations/bookings/'||s.id||'/photos/'||(p->>'photoId'))) from jsonb_array_elements(case when jsonb_typeof(s.snapshot->'photos')='array' then s.snapshot->'photos' else '[]'::jsonb end) p where p->>'photoId' ~ '^[0-9a-fA-F-]{36}$'),'[]'::jsonb))
 from public.lk_quote_submissions s left join public.lk_bookings b on b.id=s.id
 left join lateral (select array_agg(e.id order by e.id) ids from public.lk_enquiries e where e.id=s.enquiry_id or e.payload_json->>'demoSubmissionId'=s.id::text) rel on true
 union all
 select 'enquiry'::text,e.id,array[]::uuid[],jsonb_build_object('sourceType','enquiry','sourceId',e.id,'reference',e.reference,
 'name',e.payload_json->>'name','email',e.payload_json->>'email','phone',e.payload_json->>'phone','address',e.payload_json->>'siteAddress',
 'createdAt',e.created_at,'status',e.status,'relatedEnquiryIds','[]'::jsonb,'booking',null,
 'links',jsonb_build_object('detail',null,'quotePdf',null,'agreementPdf',null,'photos',null),'photos','[]'::jsonb)
 from public.lk_enquiries e where not exists(select 1 from public.lk_quote_submissions s where s.enquiry_id=e.id or e.payload_json->>'demoSubmissionId'=s.id::text);
$$;

create function public.lk_customers_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c public.lk_customers; a public.lk_customer_audit_events;
 cid uuid; sid uuid; related uuid[]; req jsonb; request_hash text; result jsonb; records jsonb; audit jsonb;
 actor uuid; sess uuid; company text; k text; kind text; reason text; n integer; p integer; term text; total bigint;
begin
 company:=args->>'companyId';
 if company is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company access denied.'; end if;
 if coalesce(args->>'actorUserId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 or coalesce(args->>'actorSessionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception using errcode='LK403',message='Verified staff actor required.'; end if;
 actor:=(args->>'actorUserId')::uuid; sess:=(args->>'actorSessionId')::uuid;
 if command in ('list','unlinked') then
  if coalesce(args->>'page','') !~ '^\d{1,6}$' or coalesce(args->>'pageSize','') !~ '^\d{1,2}$' then raise exception using errcode='LK400',message='Invalid pagination.'; end if;
  p:=(args->>'page')::integer; n:=(args->>'pageSize')::integer; term:=coalesce(args->>'q','');
  if p not between 1 and 100000 or n not between 1 and 50 or length(term)>120 then raise exception using errcode='LK400',message='Invalid search.'; end if;
  if command='list' then
   select count(*) into total from public.lk_customers x where company_id=company and (term='' or strpos(lower(concat_ws(' ',x.id::text,x.name,x.email,x.phone,x.address)),lower(term))>0 or exists(
    select 1 from public.lk_customer_records() r where exists(select 1 from public.lk_customer_record_links l where l.company_id=company and l.customer_id=x.id and ((l.source_type=r.source_type and l.source_id=r.source_id) or (l.source_type='enquiry' and l.source_id=any(r.related_enquiry_ids))))
    and strpos(lower(concat_ws(' ',r.record->>'reference',r.record->>'name',r.record->>'email',r.record->>'phone',r.record->>'address')),lower(term))>0));
   select coalesce(jsonb_agg(q.item),'[]'::jsonb) into records from (select public.lk_customer_json(x) item from public.lk_customers x where company_id=company and (term='' or strpos(lower(concat_ws(' ',x.id::text,x.name,x.email,x.phone,x.address)),lower(term))>0 or exists(
    select 1 from public.lk_customer_records() r where exists(select 1 from public.lk_customer_record_links l where l.company_id=company and l.customer_id=x.id and ((l.source_type=r.source_type and l.source_id=r.source_id) or (l.source_type='enquiry' and l.source_id=any(r.related_enquiry_ids))))
    and strpos(lower(concat_ws(' ',r.record->>'reference',r.record->>'name',r.record->>'email',r.record->>'phone',r.record->>'address')),lower(term))>0)) order by x.created_at desc,x.id limit n offset (p-1)*n) q;
   return jsonb_build_object('customers',records,'total',total,'page',p,'pageSize',n);
  end if;
  select count(*) into total from public.lk_customer_records() r where not exists(select 1 from public.lk_customer_record_links l where l.company_id=company and ((l.source_type=r.source_type and l.source_id=r.source_id) or (l.source_type='enquiry' and l.source_id=any(r.related_enquiry_ids)))) and (term='' or strpos(lower(concat_ws(' ',r.record->>'reference',r.record->>'name',r.record->>'email',r.record->>'phone',r.record->>'address')),lower(term))>0);
  select coalesce(jsonb_agg(q.record),'[]'::jsonb) into records from (select r.record from public.lk_customer_records() r where not exists(select 1 from public.lk_customer_record_links l where l.company_id=company and ((l.source_type=r.source_type and l.source_id=r.source_id) or (l.source_type='enquiry' and l.source_id=any(r.related_enquiry_ids)))) and (term='' or strpos(lower(concat_ws(' ',r.record->>'reference',r.record->>'name',r.record->>'email',r.record->>'phone',r.record->>'address')),lower(term))>0) order by r.record->>'createdAt' desc,r.source_id limit n offset (p-1)*n) q;
  return jsonb_build_object('records',records,'total',total,'page',p,'pageSize',n);
 end if;
 if coalesce(args->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception using errcode='LK400',message='Invalid customer ID.'; end if;
 cid:=(args->>'id')::uuid;
 if command='detail' then
  select * into c from public.lk_customers where company_id=company and id=cid;
  if not found then raise exception using errcode='LK404',message='Customer not found.'; end if;
  if exists(select 1 from public.lk_customer_records() r where r.source_type='submission' and exists(select 1 from public.lk_customer_record_links l where l.company_id=company and l.customer_id=cid and ((l.source_type=r.source_type and l.source_id=r.source_id) or (l.source_type='enquiry' and l.source_id=any(r.related_enquiry_ids)))) and exists(select 1 from public.lk_customer_records() other where other.source_type='submission' and other.source_id<>r.source_id and other.related_enquiry_ids && r.related_enquiry_ids)) then raise exception using errcode='LK409',message='Source group is ambiguous and needs review.'; end if;
  select coalesce(jsonb_agg(r.record order by r.record->>'createdAt' desc,r.source_id),'[]'::jsonb) into records from public.lk_customer_records() r where exists(select 1 from public.lk_customer_record_links l where l.company_id=company and l.customer_id=cid and ((l.source_type=r.source_type and l.source_id=r.source_id) or (l.source_type='enquiry' and l.source_id=any(r.related_enquiry_ids))));
  select coalesce(jsonb_agg(q.item),'[]'::jsonb) into audit from (select jsonb_build_object('id',x.id,'action',x.action,'sourceType',x.source_type,'sourceId',x.source_id,'reason',x.reason,'actorUserId',x.actor_user_id,'createdAt',x.created_at,'revision',x.revision) item from public.lk_customer_audit_events x where x.company_id=company and x.customer_id=cid order by x.revision desc limit 100) q;
  return jsonb_build_object('customer',public.lk_customer_json(c),'records',records,'audit',audit,'purchases',jsonb_build_object('status','unavailable'),'billing',jsonb_build_object('status','unavailable'));
 end if;
 if command not in ('create','link','unlink') then raise exception using errcode='LK400',message='Invalid customer command.'; end if;
 k:=args->>'idempotencyKey';
 if k is null or length(btrim(k)) not between 1 and 120 or k ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid idempotency key.'; end if;
 -- Serialise every key, including creation before a customer exists. Distinct keys
 -- then serialize source and customer rows; unique constraints remain authoritative.
 perform pg_advisory_xact_lock(hashtextextended(company||':'||k,0));
 req:=jsonb_build_object('command',command,'args',args-'actorUserId'-'actorSessionId'-case when command='create' then 'id' else '_unused' end);
 request_hash:=encode(sha256(convert_to(req::text,'UTF8')),'hex');
 select * into a from public.lk_customer_audit_events where company_id=company and idempotency_key=k;
 if found then
  if a.request_hash is distinct from request_hash or a.actor_user_id<>actor or a.actor_session_id<>sess then raise exception using errcode='LK409',message='Idempotency key already used for another request.'; end if;
  select * into c from public.lk_customers where company_id=company and id=a.customer_id;
  if not found then raise exception using errcode='LK404',message='Customer not found.'; end if;
  -- Contact editing is outside this version. Preserve the original mutation receipt
  -- revision/time without copying customer contact data into the audit trail.
  return public.lk_customer_json(c)||a.result_json;
 end if;
 if command='create' then
  if coalesce(length(btrim(args->>'name')),0) not between 1 and 120 or args->>'name' ~ '[[:cntrl:]]'
  or length(coalesce(args->>'email',''))>254 or length(coalesce(args->>'phone',''))>80 or length(coalesce(args->>'address',''))>500
  or concat_ws('',args->>'email',args->>'phone',args->>'address') ~ '[[:cntrl:]]'
  or (nullif(args->>'email','') is not null and args->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='LK400',message='Invalid customer details.'; end if;
  insert into public.lk_customers(id,company_id,name,email,phone,address) values(cid,company,btrim(args->>'name'),nullif(btrim(args->>'email'),''),nullif(btrim(args->>'phone'),''),nullif(btrim(args->>'address'),'')) returning * into c;
  reason:='Customer created by administrator.';
 else
  kind:=args->>'sourceType'; reason:=args->>'reason';
  if kind is null or kind not in ('enquiry','submission') or coalesce(args->>'sourceId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(args->>'expectedRevision','') !~ '^\d{1,9}$' or coalesce(length(btrim(reason)),0) not between 1 and 500 or reason ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid record link.'; end if;
  sid:=(args->>'sourceId')::uuid;
  if kind='enquiry' then
   perform 1 from public.lk_enquiries e where e.id=sid for update;
   if not found then raise exception using errcode='LK404',message='Source record not found.'; end if;
   if exists(select 1 from public.lk_quote_submissions s join public.lk_enquiries e on e.id=sid where s.enquiry_id=sid or e.payload_json->>'demoSubmissionId'=s.id::text) then raise exception using errcode='LK409',message='Link the signed submission and its related enquiry together.'; end if;
   related:=array[]::uuid[];
  else
   perform 1 from public.lk_quote_submissions s where s.id=sid for update;
   if not found then raise exception using errcode='LK404',message='Source record not found.'; end if;
   select r.related_enquiry_ids into related from public.lk_customer_records() r where r.source_type=kind and r.source_id=sid;
   perform 1 from public.lk_enquiries e where e.id=any(related) order by e.id for update;
   if exists(select 1 from public.lk_customer_records() r where r.source_type='submission' and r.source_id<>sid and r.related_enquiry_ids && related) then raise exception using errcode='LK409',message='Source group is ambiguous and needs review.'; end if;
  end if;
  select * into c from public.lk_customers where company_id=company and id=cid for update;
  if not found then raise exception using errcode='LK404',message='Customer not found.'; end if;
  if c.revision<>(args->>'expectedRevision')::integer then raise exception using errcode='LK409',message='Customer changed. Reload before changing links.'; end if;
  if exists(select 1 from public.lk_customer_record_links l where l.company_id=company and ((l.source_type=kind and l.source_id=sid) or (l.source_type='enquiry' and l.source_id=any(related))) and l.customer_id<>cid) then raise exception using errcode='LK409',message='Record already linked to another customer.'; end if;
  if command='link' then
   if exists(select 1 from public.lk_customer_record_links l where l.company_id=company and ((l.source_type=kind and l.source_id=sid) or (l.source_type='enquiry' and l.source_id=any(related)))) then raise exception using errcode='LK409',message='Record already linked. Reload the customer.'; end if;
   insert into public.lk_customer_record_links(company_id,customer_id,source_type,source_id,enquiry_id,submission_id) values(company,cid,kind,sid,case when kind='enquiry' then sid end,case when kind='submission' then sid end);
  else
   delete from public.lk_customer_record_links l where l.company_id=company and l.customer_id=cid and ((l.source_type=kind and l.source_id=sid) or (l.source_type='enquiry' and l.source_id=any(related)));
   if not found then raise exception using errcode='LK409',message='Record is not linked to this customer.'; end if;
  end if;
  update public.lk_customers set revision=revision+1,updated_at=now() where company_id=company and id=cid returning * into c;
 end if;
 result:=public.lk_customer_json(c);
 insert into public.lk_customer_audit_events(company_id,customer_id,action,source_type,source_id,reason,actor_user_id,actor_session_id,idempotency_key,request_hash,result_json,revision) values(company,cid,command,kind,sid,reason,actor,sess,k,request_hash,jsonb_build_object('id',c.id,'revision',c.revision,'updatedAt',c.updated_at),c.revision);
 return result;
end;
$$;
revoke all on function public.lk_customer_json(public.lk_customers),public.lk_customer_records(),public.lk_customers_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_customer_json(public.lk_customers),public.lk_customer_records(),public.lk_customers_command(text,jsonb) to service_role;
commit;
