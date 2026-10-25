-- EMS R2-R3b rollout bundle for the company database. One transaction:
-- lock lk_ tables against writes, snapshot every existing row, apply five
-- migrations, then require every pre-existing row to be unchanged (ignoring only
-- the columns these migrations add). Any difference raises and rolls back.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '600s';
do $lk$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'lk\_%' order by tablename loop
    execute format('lock table public.%I in share row exclusive mode', t);
  end loop;
end $lk$;
create temp table lk_rollout_pre(tbl text primary key, n bigint not null, h text not null) on commit drop;
do $lk$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'lk\_%' order by tablename loop
    execute format('insert into lk_rollout_pre select %L, count(*), coalesce(md5(string_agg(md5(to_jsonb(x)::text), '''' order by md5(to_jsonb(x)::text))), '''') from public.%I x', t, t);
  end loop;
end $lk$;
-- ===== 20261013032527_ems_customer_properties_crm.sql (sha256 230202afbb49d096b93803404fe8b22d1811fbe92e0da11844d72070b16229c9)
-- R2 additive CRM. One company-scoped lock serializes CRM identity/relation writes
-- (deliberately conservative throughput for this small private register).
alter table public.lk_customers add column status text not null default 'active' check(status in ('active','archived'));
alter table public.lk_customers add column archived_at timestamptz;
alter table public.lk_customers add constraint lk_customer_archive_state check((status='archived')=(archived_at is not null));
create table public.lk_customer_properties (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),customer_id uuid not null,
 label text not null check(length(btrim(label)) between 1 and 120),address jsonb not null check(jsonb_typeof(address)='object'),address_key text not null,
 contact_name text check(length(contact_name)<=120),notes text check(length(notes)<=2000),status text not null default 'active' check(status in ('active','archived')),
 archived_at timestamptz,revision integer not null default 1 check(revision>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(company_id,customer_id) references public.lk_customers(company_id,id),unique(company_id,customer_id,id),unique(company_id,customer_id,address_key),
 check((status='archived')=(archived_at is not null))
);
alter table public.lk_quote_requests add column property_id uuid;
alter table public.lk_quote_requests add column crm_revision integer not null default 0 check(crm_revision>=0);
alter table public.lk_quote_requests add constraint lk_quote_property_customer check(property_id is null or customer_id is not null);
alter table public.lk_quote_requests add constraint lk_quote_property_scope foreign key(company_id,customer_id,property_id) references public.lk_customer_properties(company_id,customer_id,id);
-- Immutable private original result is retained to make retries truthful after edits.
-- These server-only operational receipts are not part of the public audit projection.
create table public.lk_customer_commands (
 company_id text not null check(company_id='lk-group'),idempotency_key text not null check(length(idempotency_key) between 1 and 120),
 command_hash text not null,actor_user_id uuid not null,actor_session_id uuid not null,result_json jsonb not null,created_at timestamptz not null default now(),
 primary key(company_id,idempotency_key)
);
create table public.lk_customer_activity (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),customer_id uuid not null,
 property_id uuid,source_type text check(source_type is null or source_type='quote_request'),source_id uuid,details jsonb not null default '{}'::jsonb,action text not null,reason text not null check(length(btrim(reason)) between 1 and 500),actor_user_id uuid not null,actor_session_id uuid not null,
 revision integer not null,previous_state text,new_state text,created_at timestamptz not null default now(),
 foreign key(company_id,customer_id) references public.lk_customers(company_id,id)
);
create index lk_customer_activity_customer on public.lk_customer_activity(company_id,customer_id,created_at desc);
alter table public.lk_customer_properties enable row level security;
alter table public.lk_customer_commands enable row level security;
alter table public.lk_customer_activity enable row level security;
revoke all on public.lk_customer_properties,public.lk_customer_commands,public.lk_customer_activity from public,anon,authenticated,service_role;
grant select,insert,update on public.lk_customer_properties to service_role;
grant select,insert on public.lk_customer_commands,public.lk_customer_activity to service_role;
create or replace function public.lk_customer_json(c public.lk_customers) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'companyId',c.company_id,'name',c.name,'email',c.email,'phone',c.phone,'address',c.address,'status',c.status,'archivedAt',c.archived_at,'revision',c.revision,'createdAt',c.created_at,'updatedAt',c.updated_at);
$$;
create function public.lk_customer_property_json(p public.lk_customer_properties) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'companyId',p.company_id,'customerId',p.customer_id,'label',p.label,'address',p.address,'contactName',p.contact_name,'notes',p.notes,'status',p.status,'archivedAt',p.archived_at,'revision',p.revision,'createdAt',p.created_at,'updatedAt',p.updated_at);
$$;
create function public.lk_customer_phone(v text) returns text language plpgsql immutable security invoker set search_path='' as $$
declare n text;
begin
 if v is null then return null;end if;
 if v !~ '^[+0-9 ()-]+$' then return null;end if;
 n:=regexp_replace(v,'[ ()-]','','g');
 if n ~ '^0[23478][0-9]{8}$' then return '+61'||substring(n from 2);end if;
 if n ~ '^\+[1-9][0-9]{7,14}$' then return n;end if;
 return null;
end;$$;
create function public.lk_customer_candidates(args jsonb, exclude_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('customer',public.lk_customer_json(c),'matchedBy',to_jsonb(array_remove(array[
 case when nullif(lower(btrim(args->>'email')),'')=lower(btrim(c.email)) then 'email' end,
 case when public.lk_customer_phone(args->>'phone')=public.lk_customer_phone(c.phone) then 'phone' end,
 case when lower(btrim(args->>'name'))=lower(btrim(c.name)) then 'name' end],null))) order by c.id),'[]'::jsonb)
 from public.lk_customers c where c.company_id='lk-group' and c.id is distinct from exclude_id and (
 nullif(lower(btrim(args->>'email')),'')=lower(btrim(c.email)) or public.lk_customer_phone(args->>'phone')=public.lk_customer_phone(c.phone)
 or lower(btrim(args->>'name'))=lower(btrim(c.name)));
$$;
create function public.lk_customer_address_key(a jsonb) returns text language plpgsql immutable security invoker set search_path='' as $$
declare k text; v text;lim integer;street text;alias text;fullsuffix text;
begin
 if a is null or jsonb_typeof(a)<>'object' or coalesce(a->>'country','AU')<>'AU' then raise exception using errcode='LK400',message='Invalid property address.';end if;
 foreach k in array array['line1','unit','suburb','state','postcode'] loop
  v:=a->>k;lim:=case k when 'line1' then 300 when 'unit' then 80 when 'suburb' then 120 when 'state' then 20 else 10 end;
  if (k<>'unit' and coalesce(length(btrim(v)),0)=0) or length(v)>lim or v ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid property address.';end if;
 end loop;
 -- Only deterministic AU street suffix notation is canonicalized. The original
 -- display is retained, and unit remains an independent key (including omission).
 street:=lower(regexp_replace(btrim(a->>'line1'),'[[:space:]]+',' ','g'));
 foreach alias in array array['st','rd','ave','dr','ct','ln','pl','cres','tce','pde','hwy'] loop
  fullsuffix:=case alias when 'st' then 'street' when 'rd' then 'road' when 'ave' then 'avenue' when 'dr' then 'drive' when 'ct' then 'court' when 'ln' then 'lane' when 'pl' then 'place' when 'cres' then 'crescent' when 'tce' then 'terrace' when 'pde' then 'parade' else 'highway' end;
  street:=regexp_replace(street,'[[:space:]]+'||alias||'\.?$',' '||fullsuffix);
 end loop;
 return jsonb_build_array(street,lower(regexp_replace(btrim(coalesce(a->>'unit','')),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(a->>'suburb'),'[[:space:]]+',' ','g')),lower(btrim(a->>'state')),btrim(a->>'postcode'),'AU')::text;
end;$$;
-- Weak address keys generate review evidence; they NEVER select/merge a property.
create function public.lk_customer_property_weak_parts(a jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare street text;u text;parts text[];inlineunit text;representation text;conflicting boolean:=false;
begin
 street:=lower(regexp_replace(btrim(a->>'line1'),'[[:space:]]+',' ','g'));u:=nullif(lower(btrim(a->>'unit')),'');representation:=case when u is null then 'none' else 'structured' end;
 parts:=regexp_match(street,'^(?:unit|apartment|apt|flat|#)[[:space:]]*([a-z0-9-]+)(?:[[:space:]]*[,/][[:space:]]*|[[:space:]]+)([0-9].*)$');
 if parts is null then parts:=regexp_match(street,'^([a-z0-9-]+)/([0-9].*)$');end if;
 if parts is not null then
  inlineunit:=parts[1];street:=parts[2];conflicting:=u is not null and u<>inlineunit;u:=coalesce(u,inlineunit);representation:='inline';
 end if;
 return jsonb_build_object('street',(public.lk_customer_address_key(a||jsonb_build_object('line1',street,'unit',null))::jsonb)->>0,'unit',u,'postcode',btrim(a->>'postcode'),'representation',representation,'conflicting',conflicting);
end;$$;
create function public.lk_customer_property_candidates(cid uuid,a jsonb,exclude_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(public.lk_customer_property_json(p) order by p.id),'[]'::jsonb)
 from public.lk_customer_properties p cross join lateral(select public.lk_customer_property_weak_parts(p.address) parts) previous cross join lateral(select public.lk_customer_property_weak_parts(a) parts) proposed
 where p.company_id='lk-group' and p.customer_id=cid and p.id is distinct from exclude_id and p.address_key<>public.lk_customer_address_key(a)
 and previous.parts->>'street'=proposed.parts->>'street' and previous.parts->>'postcode'=proposed.parts->>'postcode'
 and (previous.parts->>'unit' is null or proposed.parts->>'unit' is null or previous.parts->>'unit'=proposed.parts->>'unit' or (previous.parts->>'conflicting')::boolean or (proposed.parts->>'conflicting')::boolean);
$$;
create function public.lk_customer_property_review_valid(candidates jsonb,decision jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(decision->>'kind'='different_property' and length(btrim(decision->>'reason')) between 1 and 500 and decision->>'reason' !~ '[[:cntrl:]]'
 and (select coalesce(jsonb_agg(jsonb_build_object('id',v->>'id','revision',(v->>'revision')::int) order by v->>'id'),'[]') from jsonb_array_elements(candidates)v)
 = (select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(decision->'reviewedProperties','[]'))v),false);
$$;
create schema if not exists lk_crm_internal;
revoke all on schema lk_crm_internal from public,anon,authenticated;
grant usage on schema lk_crm_internal to service_role;
alter function public.lk_customers_command(text,jsonb) set schema lk_crm_internal;
alter function lk_crm_internal.lk_customers_command(text,jsonb) rename to lk_customers_legacy_command;
grant execute on function lk_private.company_booking_staff_allowed(uuid,uuid) to service_role;
create function public.lk_customers_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.lk_customers;p public.lk_customer_properties;r public.lk_quote_requests;receipt public.lk_customer_commands;
 actor uuid;sess uuid;company text;cid uuid;pid uuid;k text;fingerprint text;result jsonb;matches jsonb;reviewed jsonb;decision jsonb;prop jsonb;addresskey text;reason text;outcome text;propertyoutcome text;oldstate text;legacy jsonb;term text;filter text;n integer;page integer;total integer;items jsonb;relationchanged boolean:=false;
begin
 company:=args->>'companyId';
 if company is distinct from 'lk-group' or coalesce(args->>'actorUserId','') !~ '^[0-9a-fA-F-]{36}$' or coalesce(args->>'actorSessionId','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='LK403',message='Verified company staff required.';end if;
 begin actor:=(args->>'actorUserId')::uuid;sess:=(args->>'actorSessionId')::uuid;exception when invalid_text_representation then raise exception using errcode='LK403',message='Verified company staff required.';end;
 if not lk_private.company_booking_staff_allowed(actor,sess) then raise exception using errcode='LK403',message='Current company staff membership, session and email verification required.';end if;
 if command='candidates' then return jsonb_build_object('candidates',public.lk_customer_candidates(args));end if;
 if command='quote_relation' then
  select * into r from public.lk_quote_requests where company_id=company and id=(args->>'id')::uuid;
  if not found then raise exception using errcode='LK404',message='Quote request not found.';end if;
  select * into c from public.lk_customers where company_id=company and id=r.customer_id;
  select * into p from public.lk_customer_properties where company_id=company and id=r.property_id;
  return jsonb_build_object('requestId',r.id,'crmRevision',r.crm_revision,'customer',case when c.id is null then null else public.lk_customer_json(c) end,'property',case when p.id is null then null else public.lk_customer_property_json(p) end);
 end if;
 if command='list' then
  -- Legacy validates pagination and preserves source contact search.
  legacy:=lk_crm_internal.lk_customers_legacy_command(command,args);term:=lower(coalesce(args->>'q',''));filter:=coalesce(args->>'status','active');
  if filter not in ('active','archived','all') then raise exception using errcode='LK400',message='Invalid customer status.';end if;
  n:=(args->>'pageSize')::int;page:=(args->>'page')::int;
  select count(*) into total from public.lk_customers x where x.company_id=company and (filter='all' or x.status=filter) and (term='' or strpos(lower(concat_ws(' ',x.id,x.name,x.email,x.phone,x.address)),term)>0 or exists(select 1 from public.lk_customer_properties y where y.customer_id=x.id and strpos(lower(concat_ws(' ',y.label,y.address::text)),term)>0) or exists(select 1 from public.lk_customer_records() z join public.lk_customer_record_links l on l.company_id=company and l.customer_id=x.id and ((l.source_type=z.source_type and l.source_id=z.source_id) or (l.source_type='enquiry' and l.source_id=any(z.related_enquiry_ids))) where strpos(lower(concat_ws(' ',z.record->>'reference',z.record->>'name',z.record->>'email',z.record->>'phone',z.record->>'address')),term)>0) or exists(select 1 from public.lk_quote_requests q where q.customer_id=x.id and strpos(lower(concat_ws(' ',q.reference,q.payload->'contact'->>'name',q.payload->'contact'->>'email',q.payload->'contact'->>'siteAddress')),term)>0));
  select coalesce(jsonb_agg(item),'[]') into items from(select public.lk_customer_json(x) item from public.lk_customers x where x.company_id=company and (filter='all' or x.status=filter) and (term='' or strpos(lower(concat_ws(' ',x.id,x.name,x.email,x.phone,x.address)),term)>0 or exists(select 1 from public.lk_customer_properties y where y.customer_id=x.id and strpos(lower(concat_ws(' ',y.label,y.address::text)),term)>0) or exists(select 1 from public.lk_customer_records() z join public.lk_customer_record_links l on l.company_id=company and l.customer_id=x.id and ((l.source_type=z.source_type and l.source_id=z.source_id) or (l.source_type='enquiry' and l.source_id=any(z.related_enquiry_ids))) where strpos(lower(concat_ws(' ',z.record->>'reference',z.record->>'name',z.record->>'email',z.record->>'phone',z.record->>'address')),term)>0) or exists(select 1 from public.lk_quote_requests q where q.customer_id=x.id and strpos(lower(concat_ws(' ',q.reference,q.payload->'contact'->>'name',q.payload->'contact'->>'email',q.payload->'contact'->>'siteAddress')),term)>0)) order by x.created_at desc,x.id limit n offset (page-1)*n)t;
  return jsonb_build_object('customers',items,'total',total,'page',page,'pageSize',n);
 end if;
 if command='detail' then
  legacy:=lk_crm_internal.lk_customers_legacy_command(command,args);cid:=(args->>'id')::uuid;
  select coalesce(jsonb_agg(public.lk_customer_property_json(x) order by x.created_at,x.id),'[]') into items from public.lk_customer_properties x where x.company_id=company and x.customer_id=cid;
  legacy:=legacy||jsonb_build_object('properties',items);
  select coalesce(jsonb_agg(jsonb_build_object('sourceType','quote_request','sourceId',q.id,'reference',q.reference,'name',q.payload->'contact'->>'name','email',q.payload->'contact'->>'email','phone',q.payload->'contact'->>'phone','address',q.payload->'contact'->>'siteAddress','createdAt',q.created_at,'status',q.status,'relatedEnquiryIds','[]'::jsonb,'photos',coalesce((select jsonb_agg(jsonb_build_object('id',photo.id,'url','/api/admin/quote-requests/'||q.id||'/photos/'||photo.id) order by photo.created_at,photo.id) from public.lk_live_quote_photos photo where photo.company_id=company and photo.request_id=q.id and photo.state='ready'),'[]'::jsonb),'booking',(select jsonb_build_object('status',b.status,'revision',b.version,'syncStatus',case when b.status='confirmed' then 'synced' when b.status='review_required' then 'review_required' else 'pending' end,'confirmedAt',b.confirmed_at) from public.lk_live_company_bookings b where b.request_id=q.id),'links',jsonb_build_object('detail','/admin/quotes/'||q.id,'quotePdf',null,'agreementPdf',null,'photos',null)) order by q.created_at desc),'[]') into items from public.lk_quote_requests q where q.company_id=company and q.customer_id=cid;
  legacy:=jsonb_set(legacy,'{records}',(legacy->'records')||items);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'sourceType',a.source_type,'sourceId',a.source_id,'reason',a.reason,'actorUserId',a.actor_user_id,'createdAt',a.created_at,'revision',a.revision) order by a.created_at desc),'[]') into items from public.lk_customer_activity a where a.company_id=company and a.customer_id=cid;
  return jsonb_set(legacy,'{audit}',items||(legacy->'audit'));
 end if;
 if command='unlinked' then return lk_crm_internal.lk_customers_legacy_command(command,args);end if;
 if command not in ('create','resolve','update','archive','restore','property_create','property_update','property_archive','property_restore','link','unlink') then raise exception using errcode='LK400',message='Invalid customer command.';end if;
 -- All R2 writes share this lock. Legacy source/customer lock order is preserved inside.
 perform pg_advisory_xact_lock(hashtextextended(company||':crm',0));
 k:=args->>'idempotencyKey';
 if coalesce(length(btrim(k)),0) not between 1 and 120 or k ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid idempotency key.';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command,'args',args-array['actorUserId','actorSessionId','_generatedId'])::text,'UTF8')),'hex');
 -- create's generated ID is excluded; it is not a business request field.
 if command='create' then fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command,'args',args-array['actorUserId','actorSessionId','id'])::text,'UTF8')),'hex');end if;
 select * into receipt from public.lk_customer_commands where company_id=company and idempotency_key=k;
 if found then
  if receipt.command_hash<>fingerprint or receipt.actor_user_id<>actor or receipt.actor_session_id<>sess then raise exception using errcode='LK409',message='Idempotency key already used for another request.';end if;
  return receipt.result_json;
 end if;
 if exists(select 1 from public.lk_customer_audit_events a where a.company_id=company and a.idempotency_key=k) then raise exception using errcode='LK409',message='Legacy command key cannot be reused.';end if;
 reason:=coalesce(args->'decision'->>'reason',args->>'reason','Customer created by administrator.');
 if length(btrim(reason)) not between 1 and 500 or reason ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid mutation reason.';end if;
 if command in ('link','unlink') then
  select * into c from public.lk_customers where company_id=company and id=(args->>'id')::uuid;
  if c.status='archived' and command='link' then raise exception using errcode='LK409',message='Restore the client before linking new records.';end if;
  result:=lk_crm_internal.lk_customers_legacy_command(command,args);
 elsif command in ('create','resolve') then
  if coalesce(length(btrim(args->>'name')),0) not between 1 and 120 or args->>'name' ~ '[[:cntrl:]]' or length(coalesce(args->>'email',''))>254 or length(coalesce(args->>'phone',''))>80 or length(coalesce(args->>'address',''))>500 or concat_ws('',args->>'email',args->>'phone',args->>'address') ~ '[[:cntrl:]]' or (nullif(args->>'email','') is not null and args->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='LK400',message='Invalid customer details.';end if;
  decision:=coalesce(args->'decision','{"kind":"auto"}');
  if decision->>'kind' in ('existing','different_person') and (coalesce(length(btrim(decision->>'reason')),0) not between 1 and 500 or decision->>'reason' ~ '[[:cntrl:]]') then raise exception using errcode='LK400',message='Review reason required.';end if;
  if decision->>'kind' not in ('auto','existing','different_person') or decision->>'kind' is null then raise exception using errcode='LK400',message='Invalid customer decision.';end if;
  if args->'source' is not null then
   if args->'source'->>'type'<>'quote_request' then raise exception using errcode='LK400',message='Invalid source.';end if;
   select * into r from public.lk_quote_requests where company_id=company and id=(args->'source'->>'id')::uuid for update;
   if not found then raise exception using errcode='LK404',message='Quote request not found.';end if;
   if r.revision is distinct from (args->'source'->>'expectedSourceRevision')::int then raise exception using errcode='LK409',message='Quote content changed. Reload before CRM linking.';end if;
   if r.customer_id is null and not exists(select 1 from public.lk_quote_request_access a where a.company_id=company and a.request_id=r.id and a.revoked_at is null and lower(a.verified_email)=lower(r.payload->'contact'->>'email')) then raise exception using errcode='LK409',message='Customer email verification required before CRM linking.';end if;
   if decision->>'kind'='auto' and (lower(btrim(args->>'name')) is distinct from lower(btrim(r.payload->'contact'->>'name')) or lower(btrim(args->>'email')) is distinct from lower(btrim(r.payload->'contact'->>'email')) or (nullif(btrim(args->>'phone'),'') is not null and coalesce(public.lk_customer_phone(args->>'phone'),btrim(args->>'phone')) is distinct from coalesce(public.lk_customer_phone(r.payload->'contact'->>'phone'),btrim(r.payload->'contact'->>'phone')))) then raise exception using errcode='LK409',message='Quote contact changed. Reload before CRM linking.';end if;
   if r.customer_id is not null then
    if decision->>'kind'='different_person' or (decision->>'kind'='existing' and (decision->>'customerId')::uuid<>r.customer_id) then raise exception using errcode='LK409',message='Quote already belongs to another client.';end if;
    cid:=r.customer_id;
   end if;
  end if;
  matches:=public.lk_customer_candidates(args);
  if cid is null and decision->>'kind'='existing' then
   cid:=(decision->>'customerId')::uuid;
   select * into c from public.lk_customers where company_id=company and id=cid for update;
   if not found then raise exception using errcode='LK404',message='Customer not found.';end if;
   if c.revision is distinct from (decision->>'expectedRevision')::int then raise exception using errcode='LK409',message='Client changed. Reload and review.';end if;
  elsif cid is null then
   if jsonb_array_length(matches)>0 then
    if decision->>'kind'<>'different_person' then return jsonb_build_object('outcome','needs_review','candidates',matches);end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',v->'customer'->>'id','revision',(v->'customer'->>'revision')::int) order by v->'customer'->>'id'),'[]') into reviewed from jsonb_array_elements(matches)v;
    if reviewed is distinct from (select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(decision->'reviewedCandidates','[]'))v) then raise exception using errcode='LK409',message='Candidate review changed. Reload and review.';end if;
   elsif decision->>'kind'='different_person' and coalesce(decision->'reviewedCandidates','[]')<>'[]'::jsonb then raise exception using errcode='LK409',message='Candidate review changed. Reload and review.';end if;
   cid:=coalesce((args->>'id')::uuid,gen_random_uuid());
   insert into public.lk_customers(id,company_id,name,email,phone,address) values(cid,company,btrim(args->>'name'),nullif(btrim(args->>'email'),''),nullif(btrim(args->>'phone'),''),nullif(btrim(args->>'address'),'')) returning * into c;
   outcome:='client_created';
  end if;
  select * into c from public.lk_customers where company_id=company and id=cid for update;
  if c.status<>'active' then return jsonb_build_object('outcome','needs_review','candidates',jsonb_build_array(jsonb_build_object('customer',public.lk_customer_json(c),'matchedBy',jsonb_build_array('name'))));end if;
  outcome:=coalesce(outcome,'client_reused');prop:=args->'property';
  if prop is not null and args->>'propertyId' is not null then raise exception using errcode='LK400',message='Select or create one property.';end if;
  if args->>'propertyId' is not null then
   select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and id=(args->>'propertyId')::uuid for update;
   if not found then raise exception using errcode='LK404',message='Property not found for client.';end if;
   if p.status<>'active' then raise exception using errcode='LK409',message='Restore property before linking.';end if;
   propertyoutcome:='property_reused';
  elsif prop is not null then
   addresskey:=public.lk_customer_address_key(prop->'address');
   if coalesce(length(btrim(prop->>'label')),0) not between 1 and 120 or length(prop->>'contactName')>120 or length(prop->>'notes')>2000 or concat_ws('',prop->>'label',prop->>'contactName',prop->>'notes') ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid property details.';end if;
   select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and address_key=addresskey for update;
   if found then
    if p.status<>'active' then raise exception using errcode='LK409',message='Matching property is archived. Restore it first.';end if;
    propertyoutcome:='property_reused';
   else
    matches:=public.lk_customer_property_candidates(cid,prop->'address');
    if jsonb_array_length(matches)>0 and not public.lk_customer_property_review_valid(matches,args->'propertyDecision') then return jsonb_build_object('outcome','needs_property_review','properties',matches);end if;
    insert into public.lk_customer_properties(company_id,customer_id,label,address,address_key,contact_name,notes) values(company,cid,btrim(prop->>'label'),prop->'address',addresskey,prop->>'contactName',prop->>'notes') returning * into p;
    propertyoutcome:='property_created';
   end if;
  end if;
  if r.id is not null then
   if r.property_id is not null and p.id is not null and r.property_id<>p.id then raise exception using errcode='LK409',message='Quote already belongs to another property.';end if;
   if (r.customer_id is distinct from cid or (p.id is not null and r.property_id is distinct from p.id)) then
    if r.crm_revision is distinct from (args->'source'->>'expectedCrmRevision')::int then raise exception using errcode='LK409',message='Quote CRM relation changed. Reload and review.';end if;
    relationchanged:=true;
    update public.lk_quote_requests set customer_id=cid,property_id=coalesce(p.id,property_id),crm_revision=crm_revision+1 where id=r.id returning * into r;
   end if;
   if p.id is null and r.property_id is not null then select * into p from public.lk_customer_properties where id=r.property_id;propertyoutcome:='property_reused';end if;
  end if;
  -- A reused customer gets a revision for new property/relation; source-only replay is a no-op.
  if outcome='client_reused' and (propertyoutcome='property_created' or relationchanged) then update public.lk_customers set revision=revision+1,updated_at=now() where id=cid returning * into c;end if;
  result:=case when command='create' then public.lk_customer_json(c) else jsonb_build_object('outcome',outcome,'customer',public.lk_customer_json(c),'property',case when p.id is null then null else public.lk_customer_property_json(p) end,'propertyOutcome',propertyoutcome) end;
  if r.id is not null then result:=result||jsonb_build_object('crmRevision',r.crm_revision);end if;
 else
  cid:=(args->>'id')::uuid;
  select * into c from public.lk_customers where company_id=company and id=cid for update;
  if not found then raise exception using errcode='LK404',message='Customer not found.';end if;
  if command like 'property_%' and command<>'property_create' then
   select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and id=(args->>'propertyId')::uuid for update;
   if not found then raise exception using errcode='LK404',message='Property not found.';end if;
   if p.revision is distinct from (args->>'expectedRevision')::int then raise exception using errcode='LK409',message='Property changed. Reload and review.';end if;
  elsif c.revision is distinct from (args->>'expectedRevision')::int then raise exception using errcode='LK409',message='Client changed. Reload and review.';end if;
  if c.status='archived' and command<>'restore' then raise exception using errcode='LK409',message='Restore client before editing.';end if;
  oldstate:=case when command like 'property_%' then p.status else c.status end;
  if command='update' then
   if coalesce(length(btrim(args->>'name')),0) not between 1 and 120 or args->>'name' ~ '[[:cntrl:]]' or length(coalesce(args->>'email',''))>254 or length(coalesce(args->>'phone',''))>80 or length(coalesce(args->>'address',''))>500 or concat_ws('',args->>'email',args->>'phone',args->>'address') ~ '[[:cntrl:]]' or (nullif(args->>'email','') is not null and args->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='LK400',message='Invalid customer details.';end if;
   matches:=public.lk_customer_candidates(args,cid);
   if jsonb_array_length(matches)>0 then
    select coalesce(jsonb_agg(jsonb_build_object('id',v->'customer'->>'id','revision',(v->'customer'->>'revision')::int) order by v->'customer'->>'id'),'[]') into reviewed from jsonb_array_elements(matches)v;
    if args->'decision'->>'kind' is distinct from 'different_person' or reviewed is distinct from(select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(args->'decision'->'reviewedCandidates','[]'))v) then return jsonb_build_object('outcome','needs_review','candidates',matches);end if;
   end if;
   update public.lk_customers set name=btrim(args->>'name'),email=nullif(btrim(args->>'email'),''),phone=nullif(btrim(args->>'phone'),''),address=nullif(btrim(args->>'address'),''),revision=revision+1,updated_at=now() where id=cid returning * into c;
  elsif command in ('archive','restore') then
   if command='restore' then
    matches:=public.lk_customer_candidates(public.lk_customer_json(c),cid);
    if jsonb_array_length(matches)>0 then
     select coalesce(jsonb_agg(jsonb_build_object('id',v->'customer'->>'id','revision',(v->'customer'->>'revision')::int) order by v->'customer'->>'id'),'[]') into reviewed from jsonb_array_elements(matches)v;
     if args->'decision'->>'kind' is distinct from 'different_person' or reviewed is distinct from(select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(args->'decision'->'reviewedCandidates','[]'))v) then return jsonb_build_object('outcome','needs_review','candidates',matches);end if;
    end if;
   end if;
   if (command='archive' and c.status<>'active') or (command='restore' and c.status<>'archived') then raise exception using errcode='LK409',message='Client state already changed.';end if;
   update public.lk_customers set status=case when command='archive' then 'archived' else 'active' end,archived_at=case when command='archive' then now() else null end,revision=revision+1,updated_at=now() where id=cid returning * into c;
  elsif command in ('property_create','property_update') then
   prop:=args;addresskey:=public.lk_customer_address_key(prop->'address');
   if coalesce(length(btrim(prop->>'label')),0) not between 1 and 120 or length(prop->>'contactName')>120 or length(prop->>'notes')>2000 or concat_ws('',prop->>'label',prop->>'contactName',prop->>'notes') ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid property details.';end if;
   if command='property_create' then
    select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and address_key=addresskey for update;
    if found then
     if p.status='archived' then raise exception using errcode='LK409',message='Matching property is archived. Restore it first.';end if;
     propertyoutcome:='property_reused';
    else
     matches:=public.lk_customer_property_candidates(cid,prop->'address');
     if jsonb_array_length(matches)>0 and not public.lk_customer_property_review_valid(matches,args->'propertyDecision') then return jsonb_build_object('outcome','needs_property_review','properties',matches);end if;
     insert into public.lk_customer_properties(company_id,customer_id,label,address,address_key,contact_name,notes) values(company,cid,btrim(prop->>'label'),prop->'address',addresskey,prop->>'contactName',prop->>'notes') returning * into p;propertyoutcome:='property_created';end if;
   else
    if p.status<>'active' then raise exception using errcode='LK409',message='Restore property before editing.';end if;
    if exists(select 1 from public.lk_customer_properties x where x.company_id=company and x.customer_id=cid and x.address_key=addresskey and x.id<>p.id) then raise exception using errcode='LK409',message='Another property has this address.';end if;
    matches:=public.lk_customer_property_candidates(cid,prop->'address',p.id);
    if jsonb_array_length(matches)>0 and not public.lk_customer_property_review_valid(matches,args->'propertyDecision') then return jsonb_build_object('outcome','needs_property_review','properties',matches);end if;
    update public.lk_customer_properties set label=btrim(prop->>'label'),address=prop->'address',address_key=addresskey,contact_name=prop->>'contactName',notes=prop->>'notes',revision=revision+1,updated_at=now() where id=p.id returning * into p;
   end if;
  elsif command in ('property_archive','property_restore') then
   if (command='property_archive' and p.status<>'active') or (command='property_restore' and p.status<>'archived') then raise exception using errcode='LK409',message='Property state already changed.';end if;
   update public.lk_customer_properties set status=case when command='property_archive' then 'archived' else 'active' end,archived_at=case when command='property_archive' then now() else null end,revision=revision+1,updated_at=now() where id=p.id returning * into p;
  end if;
  if command like 'property_%' then
   update public.lk_customers set revision=revision+1,updated_at=now() where id=cid returning * into c;
   result:=jsonb_build_object('customer',public.lk_customer_json(c),'property',public.lk_customer_property_json(p),'propertyOutcome',propertyoutcome);
  else result:=public.lk_customer_json(c);end if;
 end if;
 if command='create' then
 insert into public.lk_customer_audit_events(company_id,customer_id,action,reason,actor_user_id,actor_session_id,idempotency_key,request_hash,result_json,revision) values(company,c.id,'create',reason,actor,sess,k,fingerprint,jsonb_build_object('id',c.id,'revision',c.revision,'updatedAt',c.updated_at),c.revision);
 elsif command not in ('link','unlink') then insert into public.lk_customer_activity(company_id,customer_id,property_id,source_type,source_id,details,action,reason,actor_user_id,actor_session_id,revision,previous_state,new_state) values(company,c.id,p.id,case when r.id is not null then 'quote_request' else null end,r.id,jsonb_build_object('crmRevision',r.crm_revision,'propertyRevision',p.revision,'decision',args->'decision'->>'kind','propertyReview',args->'propertyDecision'),command,reason,actor,sess,c.revision,oldstate,case when command like 'property_%' then p.status else c.status end);end if;
 insert into public.lk_customer_commands(company_id,idempotency_key,command_hash,actor_user_id,actor_session_id,result_json) values(company,k,fingerprint,actor,sess,result);
 return result;
end;$$;
revoke all on function public.lk_customer_property_weak_parts(jsonb),public.lk_customer_property_candidates(uuid,jsonb,uuid),public.lk_customer_property_review_valid(jsonb,jsonb),public.lk_customer_property_json(public.lk_customer_properties),public.lk_customer_phone(text),public.lk_customer_candidates(jsonb,uuid),public.lk_customer_address_key(jsonb),public.lk_customers_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_customer_property_weak_parts(jsonb),public.lk_customer_property_candidates(uuid,jsonb,uuid),public.lk_customer_property_review_valid(jsonb,jsonb),public.lk_customer_property_json(public.lk_customer_properties),public.lk_customer_phone(text),public.lk_customer_candidates(jsonb,uuid),public.lk_customer_address_key(jsonb),public.lk_customers_command(text,jsonb) to service_role;

-- ===== 20261020094056_ems_r3a_current_work_management.sql (sha256 46e5fd432c53b221c2ffc7031a863a41005e6994c9530501e4a355be19f10848)
-- Staff work copies never overwrite enquiry, quote, signature or frozen document content.
create table public.lk_enquiry_management (
 enquiry_id uuid primary key references public.lk_enquiries(id), company_id text not null default 'lk-group' check(company_id='lk-group'),
 revision integer not null check(revision>0), status text not null check(status in ('active','archived')), assignee_user_id uuid,
 archived_at timestamptz, updated_at timestamptz not null default now(), check((status='archived')=(archived_at is not null))
);
create index lk_enquiry_management_status on public.lk_enquiry_management(company_id,status,updated_at desc,enquiry_id);
create table public.lk_enquiry_notes (
 id uuid primary key default gen_random_uuid(), enquiry_id uuid not null references public.lk_enquiries(id),
 body text not null check(length(btrim(body)) between 1 and 3000 and body !~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 created_by uuid not null, updated_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index lk_enquiry_notes_parent on public.lk_enquiry_notes(enquiry_id,created_at,id);
create table public.lk_staff_quote_drafts (
 request_id uuid primary key references public.lk_quote_requests(id), company_id text not null default 'lk-group' check(company_id='lk-group'), revision integer not null check(revision>0),
 source_revision_at_creation integer not null check(source_revision_at_creation>0), payload jsonb not null check(jsonb_typeof(payload)='object'),
 created_by uuid not null, updated_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index lk_staff_quote_drafts_updated on public.lk_staff_quote_drafts(company_id,updated_at desc,request_id);
create table public.lk_live_simple_booking_drafts (
 request_id uuid primary key references public.lk_quote_requests(id), submission_id uuid not null references public.lk_live_quote_submissions(id), signed_snapshot_hash text not null check(signed_snapshot_hash~'^[a-f0-9]{64}$'),
 revision integer not null check(revision>0), payload jsonb not null check(jsonb_typeof(payload)='object'), saved_by uuid not null, saved_at timestamptz not null default now()
);
create table public.lk_current_work_receipts (
 company_id text not null check(company_id='lk-group'), entity_type text not null check(entity_type in ('enquiry','staff_quote_draft','simple_booking')), entity_id uuid not null,
 idempotency_key uuid not null, action text not null, request_hash text not null check(request_hash~'^[a-f0-9]{64}$'), actor_user_id uuid not null, actor_session_id uuid not null,
 response jsonb not null check(jsonb_typeof(response)='object'), created_at timestamptz not null default now(), primary key(company_id,entity_type,entity_id,idempotency_key)
);
create table public.lk_current_work_audit (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), entity_type text not null check(entity_type in ('enquiry','staff_quote_draft','simple_booking')), entity_id uuid not null,
 action text not null, actor_user_id uuid, actor_session_id uuid, idempotency_key uuid not null, request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 reason text not null check(length(reason) between 1 and 500), prior_revision integer not null check(prior_revision>=0), revision integer not null check(revision>=prior_revision),
 details jsonb not null check(jsonb_typeof(details)='object'), created_at timestamptz not null default now()
);
create index lk_current_work_audit_entity on public.lk_current_work_audit(company_id,entity_type,entity_id,created_at desc,id);
create table public.lk_live_company_cancellations (
 id uuid primary key default gen_random_uuid(), company_id text not null default 'lk-group' check(company_id='lk-group'), request_id uuid not null unique references public.lk_quote_requests(id),
 booking_id uuid not null unique references public.lk_live_company_bookings(id), proposal_id uuid not null references public.lk_live_company_proposals(id), proposal_hash text not null check(proposal_hash~'^[a-f0-9]{64}$'),
 submission_id uuid not null references public.lk_live_quote_submissions(id), idempotency_key uuid not null, request_hash text not null check(request_hash~'^[a-f0-9]{64}$'), actor_user_id uuid not null, actor_session_id uuid not null,
 reason text not null check(length(reason) between 1 and 500), status text not null default 'pending' check(status in ('pending','processing','retrying','review_required','cancelled')),
 manifest jsonb not null check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest)=2), evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
 error_code text, lease_token uuid, lease_expires_at timestamptz, requested_at timestamptz not null default now(), cancelled_at timestamptz, next_attempt_at timestamptz not null default now(),
 check((lease_token is null)=(lease_expires_at is null)), check((status='cancelled')=(cancelled_at is not null))
);
create index lk_live_company_cancellation_work on public.lk_live_company_cancellations(status,next_attempt_at,lease_expires_at);
alter table public.lk_live_company_bookings drop constraint lk_live_company_bookings_status_check;
alter table public.lk_live_company_bookings add constraint lk_live_company_bookings_status_check check(status in ('confirming','confirmed','review_required','cancel_pending','cancelled'));
create function lk_private.current_work_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='LK409',message='Work history cannot be deleted.';end if;
 if tg_table_name in ('lk_current_work_receipts','lk_current_work_audit') then raise exception using errcode='LK409',message='Work history is immutable.';end if;
 if tg_table_name='lk_enquiry_management' and (to_jsonb(new)->'enquiry_id' is distinct from to_jsonb(old)->'enquiry_id' or to_jsonb(new)->'company_id' is distinct from to_jsonb(old)->'company_id') or tg_table_name='lk_enquiry_notes' and (to_jsonb(new)-array['body','updated_by','updated_at']) is distinct from (to_jsonb(old)-array['body','updated_by','updated_at']) or tg_table_name='lk_staff_quote_drafts' and (to_jsonb(new)-array['payload','revision','updated_by','updated_at']) is distinct from (to_jsonb(old)-array['payload','revision','updated_by','updated_at']) or tg_table_name='lk_live_simple_booking_drafts' and (to_jsonb(new)-array['payload','revision','saved_by','saved_at']) is distinct from (to_jsonb(old)-array['payload','revision','saved_by','saved_at']) or tg_table_name='lk_live_company_cancellations' and (to_jsonb(new)-array['status','evidence','error_code','lease_token','lease_expires_at','cancelled_at','next_attempt_at']) is distinct from (to_jsonb(old)-array['status','evidence','error_code','lease_token','lease_expires_at','cancelled_at','next_attempt_at']) then raise exception using errcode='LK409',message='Work source identity is immutable.';end if;
 return new;
end;$$;
do $$declare t text;begin
 foreach t in array array['lk_enquiry_management','lk_enquiry_notes','lk_staff_quote_drafts','lk_live_simple_booking_drafts','lk_current_work_receipts','lk_current_work_audit','lk_live_company_cancellations'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated,service_role',t); execute format('grant select on public.%I to service_role',t);
 execute format('create trigger current_work_immutable before update or delete on public.%I for each row execute function lk_private.current_work_immutable()',t);
 end loop;
end;$$;
create function lk_private.current_work_error(code text,revision integer default null) returns void language plpgsql set search_path='' as $$begin raise exception using errcode='LK409',message='Current work changed.',detail=jsonb_strip_nulls(jsonb_build_object('code',code,'currentRevision',revision))::text;end;$$;
create function lk_private.current_work_audit_json(kind text,rid uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actorUserId',a.actor_user_id,'actorSessionId',a.actor_session_id,'reason',a.reason,'priorRevision',a.prior_revision,'revision',a.revision,'details',a.details,'createdAt',a.created_at) order by a.created_at desc,a.id),'[]'::jsonb) from public.lk_current_work_audit a where a.company_id='lk-group' and a.entity_type=kind and a.entity_id=rid;
$$;
create function lk_private.current_enquiry_json(e public.lk_enquiries) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('enquiry',jsonb_build_object('id',e.id,'reference',e.reference,'source',e.source,'status',e.status,'revision',e.revision,'createdAt',e.created_at,'summary',jsonb_build_object('name',coalesce(e.payload_json->>'name',e.payload_json->'contact'->>'name',''),'email',coalesce(e.payload_json->>'email',e.payload_json->'contact'->>'email',''),'phone',coalesce(e.payload_json->>'phone',e.payload_json->'contact'->>'phone',''),'siteAddress',coalesce(e.payload_json->>'siteAddress',e.payload_json->'contact'->>'siteAddress',''),'details',coalesce(e.payload_json->>'notes',e.payload_json->>'details',e.payload_json->'contact'->>'details',''))), 'management',jsonb_build_object('enquiryId',e.id,'status',coalesce(m.status,'active'),'revision',coalesce(m.revision,0),'assigneeUserId',m.assignee_user_id,'archivedAt',m.archived_at,'updatedAt',m.updated_at)) from (select 1) anchor left join public.lk_enquiry_management m on m.enquiry_id=e.id;
$$;
create function lk_private.staff_quote_draft_json(d public.lk_staff_quote_drafts) returns jsonb language sql stable set search_path='' as $$
 select case when d.request_id is null then null else jsonb_build_object('requestId',d.request_id,'revision',d.revision,'status','draft','sourceRevisionAtCreation',d.source_revision_at_creation,'payload',d.payload,'createdBy',d.created_by,'updatedBy',d.updated_by,'createdAt',d.created_at,'updatedAt',d.updated_at) end;
$$;
create function lk_private.simple_booking_draft_json(d public.lk_live_simple_booking_drafts) returns jsonb language sql stable set search_path='' as $$
 select case when d.request_id is null then null else d.payload||jsonb_build_object('requestId',d.request_id,'submissionId',d.submission_id,'signedSnapshotHash',d.signed_snapshot_hash,'revision',d.revision,'savedBy',d.saved_by,'savedAt',d.saved_at) end;
$$;
create function lk_private.company_cancellation_json(c public.lk_live_company_cancellations) returns jsonb language sql stable set search_path='' as $$
 select case when c.id is null then null else jsonb_build_object('id',c.id,'requestId',c.request_id,'bookingId',c.booking_id,'status',c.status,'requestedAt',c.requested_at,'requestedBy',c.actor_user_id,'cancelledAt',c.cancelled_at,'errorCode',c.error_code,'occupancyHeld',c.status<>'cancelled','totalEvents',jsonb_array_length(c.manifest),'verifiedDeletedEvents',(select count(*) from jsonb_each(c.evidence))) end;
$$;
create function lk_private.current_work_keys(value jsonb,keys text[]) returns boolean language sql immutable set search_path='' as $$ select case when jsonb_typeof(value)='object' then coalesce((select count(*)=cardinality(keys) and bool_and(k=any(keys)) from jsonb_object_keys(value) k),false) else false end;$$;
create function lk_private.staff_quote_payload_valid(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare c jsonb:=value->'contact';s jsonb:=value->'service';k text;v text;phone text;
begin
 if not lk_private.current_work_keys(value,array['contact','service','internalNotes']) or not lk_private.current_work_keys(c,array['name','email','phone','siteAddress','suburb','postcode','details']) or jsonb_typeof(value->'internalNotes') is distinct from 'string' or length(value->>'internalNotes')>3000 then return false;end if;
 foreach k in array array['name','email','phone','siteAddress','suburb','postcode','details'] loop
 if jsonb_typeof(c->k) is distinct from 'string' then return false;end if;
 v:=c->>k;
 if v ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' or v ~* '<(!--|/?[a-z][^>]*(>|$))' or (k<>'details' and v ~ '[\x09\x0a\x0d]') then return false;end if;
 end loop;
 if length(btrim(c->>'name')) not between 1 and 120 or length(btrim(c->>'siteAddress')) not between 1 and 240 or length(btrim(c->>'suburb')) not between 1 and 100 or c->>'postcode' !~ '^[0-9]{4}$' or length(c->>'email')>254 or c->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(c->>'phone')>40 or length(c->>'details')>3000 then return false;end if;
 phone:=regexp_replace(c->>'phone','[ ()-]','','g');
 if phone<>'' and phone !~ '^(0[23478][0-9]{8}|13[0-9]{4}|(1300|1800)[0-9]{6}|180[0-9]{4}|(\+61|0061)([23478][0-9]{8}|13[0-9]{4}|(1300|1800)[0-9]{6}|180[0-9]{4}))$' then return false;end if;
 if value->>'internalNotes' ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then return false;end if;
 if s='null'::jsonb then return true;end if;
 if not lk_private.current_work_keys(s,array['serviceId','intent','surfaces','doorCount','drawerCount','material','colourPreference']) or s->>'serviceId' is distinct from 'cabinet-painting' or coalesce(s->>'intent','') not in ('full-repainting','partial-touch-ups','colour-change','advice') or jsonb_typeof(s->'surfaces') is distinct from 'array' then return false;end if;
 if jsonb_array_length(s->'surfaces') not between 1 and 6 or exists(select 1 from jsonb_array_elements_text(s->'surfaces') x where x not in ('doors','drawers','frames','panels','repairs','unknown')) or (s->'surfaces' ? 'unknown' and jsonb_array_length(s->'surfaces')>1) then return false;end if;
 foreach k in array array['doorCount','drawerCount'] loop
 if s->k<>'null'::jsonb and (jsonb_typeof(s->k)<>'number' or s->>k !~ '^[0-9]{1,3}$' or (s->>k)::integer>500) then return false;end if;
 end loop;
 foreach k in array array['material','colourPreference'] loop
 if jsonb_typeof(s->k) is distinct from 'string' or length(s->>k)>100 or s->>k ~ '[\x00-\x1f\x7f]' or s->>k ~* '<(!--|/?[a-z][^>]*(>|$))' then return false;end if;
 end loop;
 return true;
end;$$;
create function lk_private.current_work_sydney(value text) returns timestamptz language plpgsql stable set search_path='' as $$begin return public.lk_live_booking_sydney_instant(value);exception when sqlstate 'LK400' then raise exception using errcode='LK422',message='Invalid or ambiguous Sydney local time.';end;$$;
create function public.lk_current_work_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid;sid uuid;rid uuid;kind text;rev integer;priorrev integer;key uuid;fingerprint text;receipt public.lk_current_work_receipts;result jsonb;child uuid;details jsonb:='{}';
 e public.lk_enquiries;m public.lk_enquiry_management;n public.lk_enquiry_notes;q public.lk_quote_requests;d public.lk_staff_quote_drafts;sd public.lk_live_simple_booking_drafts;
 s public.lk_live_quote_submissions;b public.lk_live_company_bookings;p public.lk_live_company_proposals;o public.lk_live_company_outbox;c public.lk_live_company_cancellations;
 page integer;size integer;term text;filter text;saved text;total bigint;items jsonb;entry jsonb;manifest jsonb;firstat timestamptz;takeend timestamptz;installstart timestamptz;installend timestamptz;nowat timestamptz:=clock_timestamp();allowed text[];idx integer;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Current company staff required.';end if;
 -- Durable cancellation workers use only their random, unexpired DB lease, never a client actor.
 if command like 'cancel_worker_%' then return lk_private.company_cancel_worker(command,args);end if;
 begin uid:=(args->>'actorUserId')::uuid;sid:=(args->>'actorSessionId')::uuid;exception when invalid_text_representation then raise exception using errcode='LK403',message='Current company staff required.';end;
 if uid is null or sid is null or not lk_private.company_booking_staff_allowed(uid,sid) then raise exception using errcode='LK403',message='Current company staff required.';end if;
 if command='enquiry_assignees' then return jsonb_build_object('assignees',(select coalesce(jsonb_agg(jsonb_build_object('userId',u.id,'label',u.email) order by u.email),'[]'::jsonb) from auth.users u where u.raw_app_meta_data->'lk_staff'->>'company_id'='lk-group' and u.raw_app_meta_data->'lk_staff'->>'status'='active' and u.raw_app_meta_data->'lk_staff'->>'role' in ('admin','owner')));end if;
 if command in ('enquiry_list','quote_list') then
  if coalesce(args->>'page','') !~ '^[0-9]{1,6}$' or coalesce(args->>'pageSize','') !~ '^[0-9]{1,2}$' then raise exception using errcode='LK422',message='Invalid search.';end if;
  page:=(args->>'page')::integer;size:=(args->>'pageSize')::integer;term:=coalesce(args->>'q','');filter:=args->>'status';saved:=coalesce(args->>'staffDraft','all');
  if page not between 1 and 100000 or size not between 1 and 50 or length(term)>120 or term ~ '[\x00-\x1f\x7f]' or filter is null then raise exception using errcode='LK422',message='Invalid search.';end if;
  if command='enquiry_list' then
   if filter not in ('all','active','archived') then raise exception using errcode='LK422',message='Invalid status.';end if;
   select count(*) into total from public.lk_enquiries x left join public.lk_enquiry_management y on y.enquiry_id=x.id where (filter='all' or coalesce(y.status,'active')=filter) and (term='' or strpos(lower(concat_ws(' ',x.reference,x.payload_json->>'name',x.payload_json->>'email',x.payload_json->'contact'->>'name',x.payload_json->'contact'->>'email')),lower(term))>0);
   select coalesce(jsonb_agg(z.value order by z.created_at desc,z.id),'[]'::jsonb) into items from (select lk_private.current_enquiry_json(x) value,x.created_at,x.id from public.lk_enquiries x left join public.lk_enquiry_management y on y.enquiry_id=x.id where (filter='all' or coalesce(y.status,'active')=filter) and (term='' or strpos(lower(concat_ws(' ',x.reference,x.payload_json->>'name',x.payload_json->>'email',x.payload_json->'contact'->>'name',x.payload_json->'contact'->>'email')),lower(term))>0) order by x.created_at desc,x.id limit size offset (page-1)*size) z;
   return jsonb_build_object('enquiries',items,'total',total,'page',page,'pageSize',size);
  end if;
  if filter not in ('all','draft','review_requested') or saved not in ('all','saved','none') then raise exception using errcode='LK422',message='Invalid status.';end if;
  select count(*) into total from public.lk_quote_requests x left join public.lk_staff_quote_drafts y on y.request_id=x.id where x.company_id='lk-group' and (filter='all' or x.status=filter) and (saved='all' or (y.request_id is not null)=(saved='saved')) and (term='' or strpos(lower(concat_ws(' ',x.reference,x.payload->'contact'->>'name',x.payload->'contact'->>'email',x.payload->'contact'->>'siteAddress')),lower(term))>0);
  select coalesce(jsonb_agg(z.value order by z.saved_at desc,z.id),'[]'::jsonb) into items from (select public.lk_quote_request_json(x)||jsonb_build_object('staffDraftRevision',y.revision) value,x.saved_at,x.id from public.lk_quote_requests x left join public.lk_staff_quote_drafts y on y.request_id=x.id where x.company_id='lk-group' and (filter='all' or x.status=filter) and (saved='all' or (y.request_id is not null)=(saved='saved')) and (term='' or strpos(lower(concat_ws(' ',x.reference,x.payload->'contact'->>'name',x.payload->'contact'->>'email',x.payload->'contact'->>'siteAddress')),lower(term))>0) order by x.saved_at desc,x.id limit size offset (page-1)*size) z;
  return jsonb_build_object('requests',items,'total',total,'page',page,'pageSize',size);
 end if;
 if coalesce(args->>'id','') !~ '^[a-fA-F0-9-]{36}$' then raise exception using errcode='LK422',message='Invalid identifier.';end if;
 rid:=(args->>'id')::uuid;kind:=case when command like 'enquiry_%' then 'enquiry' when command like 'quote_%' then 'staff_quote_draft' when command like 'booking_%' then 'simple_booking' else null end;
 if kind is null then raise exception using errcode='LK422',message='Invalid current work command.';end if;
 -- Outbox lock first matches the confirmation worker. Other aggregates use their source row as the serialization lock.
 if command='booking_cancel' then select x.* into o from public.lk_live_company_outbox x where x.request_id=rid and x.kind='confirmation' for update;end if;
 if kind='enquiry' then
  select * into e from public.lk_enquiries where id=rid for update;
  if not found then raise exception using errcode='LK404',message='Enquiry not found.';end if;
  select * into m from public.lk_enquiry_management where enquiry_id=rid;rev:=coalesce(m.revision,0);
 else
  select * into q from public.lk_quote_requests where id=rid and company_id='lk-group' for update;
  if not found then raise exception using errcode='LK404',message='Quote not found.';end if;
  if kind='staff_quote_draft' then select * into d from public.lk_staff_quote_drafts where request_id=rid;rev:=coalesce(d.revision,0);
  else
   select * into s from public.lk_live_quote_submissions where request_id=rid and company_id='lk-group';
   if not found then raise exception using errcode='LK409',message='A signed customer request is required.';end if;
   select revision into rev from public.lk_live_company_booking_requests where request_id=rid for update;rev:=coalesce(rev,0);
   select * into sd from public.lk_live_simple_booking_drafts where request_id=rid;
   select * into b from public.lk_live_company_bookings where request_id=rid for update;
   select * into c from public.lk_live_company_cancellations where request_id=rid;
  end if;
 end if;
 if command='enquiry_detail' then return lk_private.current_enquiry_json(e)||jsonb_build_object('canWrite',true,'notes',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'enquiryId',x.enquiry_id,'body',x.body,'createdBy',x.created_by,'updatedBy',x.updated_by,'createdAt',x.created_at,'updatedAt',x.updated_at) order by x.created_at,x.id),'[]'::jsonb) from public.lk_enquiry_notes x where x.enquiry_id=rid),'audit',lk_private.current_work_audit_json(kind,rid));
 elsif command='quote_detail' then return jsonb_build_object('requestId',rid,'source',public.lk_quote_request_json(q),'draft',lk_private.staff_quote_draft_json(d),'audit',lk_private.current_work_audit_json(kind,rid),'canWrite',true);
 elsif command='booking_detail' then return jsonb_build_object('state',public.lk_live_company_state(rid),'draft',lk_private.simple_booking_draft_json(sd),'cancellation',lk_private.company_cancellation_json(c),'canWrite',true);
 elsif command='booking_cancellation' then return jsonb_build_object('cancellation',lk_private.company_cancellation_json(c),'revision',rev);
 end if;
 if command in ('enquiry_receipt','quote_receipt','booking_receipt','booking_cancel_retry') then
  select * into receipt from public.lk_current_work_receipts where company_id='lk-group' and entity_type=kind and entity_id=rid and idempotency_key=(args->>'idempotencyKey')::uuid;
  if not found or receipt.actor_user_id<>uid or receipt.actor_session_id<>sid then raise exception using errcode='LK404',message='Command not found.';end if;
  if command='booking_cancel_retry' and (receipt.action<>'booking_cancel' or c.id is null or c.idempotency_key<>receipt.idempotency_key) then perform lk_private.current_work_error('state_conflict');end if;
  return receipt.response||case when command='booking_receipt' and receipt.action='booking_cancel' then jsonb_build_object('progress',lk_private.company_cancellation_json(c)) else '{}'::jsonb end;
 end if;
 if command not in ('enquiry_assign','enquiry_note_add','enquiry_note_update','enquiry_archive','enquiry_restore','quote_save','booking_save','booking_cancel') then raise exception using errcode='LK422',message='Invalid current work command.';end if;
 allowed:=array['companyId','actorUserId','actorSessionId','id','expectedRevision','idempotencyKey','reason'];
 if command='enquiry_assign' then allowed:=allowed||array['assigneeUserId'];elsif command in ('enquiry_note_add','enquiry_note_update') then allowed:=allowed||array['body'];if command='enquiry_note_update' then allowed:=allowed||array['noteId'];end if;elsif command='quote_save' then allowed:=allowed||array['payload'];elsif command='booking_save' then allowed:=allowed||array['takeOffEndLocal','installStartLocal','installEndLocal','companyNote'];end if;
 if not lk_private.current_work_keys(args,allowed) or jsonb_typeof(args->'expectedRevision') is distinct from 'number' or coalesce(args->>'expectedRevision','') !~ '^[0-9]{1,10}$' or (args->>'expectedRevision')::bigint>2147483646 or coalesce(args->>'idempotencyKey','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' or jsonb_typeof(args->'reason') is distinct from 'string' or length(btrim(args->>'reason')) not between 1 and 500 or args->>'reason' ~ '[\x00-\x1f\x7f]' then raise exception using errcode='LK422',message='Invalid revision, retry key or mutation fields.';end if;
 key:=(args->>'idempotencyKey')::uuid;fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',command,'args',args-array['companyId','actorUserId','actorSessionId']));
 select * into receipt from public.lk_current_work_receipts where company_id='lk-group' and entity_type=kind and entity_id=rid and idempotency_key=key;
 if found then
  if receipt.action<>command or receipt.request_hash<>fingerprint or receipt.actor_user_id<>uid or receipt.actor_session_id<>sid then perform lk_private.current_work_error('idempotency_conflict');end if;
  return receipt.response;
 end if;
 if (args->>'expectedRevision')::integer<>rev then perform lk_private.current_work_error('revision_conflict',rev);end if;
 priorrev:=rev;rev:=rev+1;
 if kind='enquiry' then
  if command='enquiry_restore' then if m.status is distinct from 'archived' then perform lk_private.current_work_error('state_conflict');end if;
  elsif m.status='archived' then perform lk_private.current_work_error('state_conflict');end if;
  if command='enquiry_assign' then
   if args->'assigneeUserId'<>'null'::jsonb and (jsonb_typeof(args->'assigneeUserId')<>'string' or not exists(select 1 from auth.users u where u.id=(args->>'assigneeUserId')::uuid and u.raw_app_meta_data->'lk_staff'->>'company_id'='lk-group' and u.raw_app_meta_data->'lk_staff'->>'status'='active' and u.raw_app_meta_data->'lk_staff'->>'role' in ('admin','owner'))) then raise exception using errcode='LK422',message='Assign a current company employee.';end if;
   details:=jsonb_build_object('changedFields',jsonb_build_array('assigneeUserId'),'priorAssigneeUserId',m.assignee_user_id,'assigneeUserId',args->'assigneeUserId');
  elsif command in ('enquiry_note_add','enquiry_note_update') then
   if jsonb_typeof(args->'body') is distinct from 'string' or length(btrim(args->>'body')) not between 1 and 3000 or args->>'body' ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception using errcode='LK422',message='Enter a valid internal note.';end if;
   if command='enquiry_note_update' then
    select * into n from public.lk_enquiry_notes where id=(args->>'noteId')::uuid and enquiry_id=rid;
    if not found then raise exception using errcode='LK404',message='Note not found.';end if;
    child:=n.id;update public.lk_enquiry_notes set body=btrim(args->>'body'),updated_by=uid,updated_at=nowat where id=child;
   else
    child:=gen_random_uuid();insert into public.lk_enquiry_notes(id,enquiry_id,body,created_by,updated_by) values(child,rid,btrim(args->>'body'),uid,uid);
   end if;
   details:=jsonb_build_object('changedFields',jsonb_build_array('notes'),'noteId',child,'priorBodyHash',case when n.id is null then null else public.lk_live_booking_hash(to_jsonb(n.body)) end,'bodyHash',public.lk_live_booking_hash(to_jsonb(btrim(args->>'body'))),'createdBy',coalesce(n.created_by,uid),'updatedBy',uid);
  else details:=jsonb_build_object('changedFields',jsonb_build_array('status'),'priorStatus',coalesce(m.status,'active'),'status',case command when 'enquiry_archive' then 'archived' else 'active' end);end if;
  insert into public.lk_enquiry_management(enquiry_id,revision,status,assignee_user_id,archived_at,updated_at) values(rid,rev,case command when 'enquiry_archive' then 'archived' else 'active' end,case when command='enquiry_assign' then (args->>'assigneeUserId')::uuid else m.assignee_user_id end,case when command='enquiry_archive' then nowat else null end,nowat) on conflict(enquiry_id) do update set revision=excluded.revision,status=excluded.status,assignee_user_id=excluded.assignee_user_id,archived_at=excluded.archived_at,updated_at=excluded.updated_at;
 elsif command='quote_save' then
  if not lk_private.staff_quote_payload_valid(args->'payload') then raise exception using errcode='LK422',message='Invalid staff quote work copy.';end if;
  insert into public.lk_staff_quote_drafts(request_id,revision,source_revision_at_creation,payload,created_by,updated_by) values(rid,rev,q.revision,args->'payload',uid,uid) on conflict(request_id) do update set revision=excluded.revision,payload=excluded.payload,updated_by=uid,updated_at=nowat;
  details:=jsonb_build_object('changedFields',jsonb_build_array('payload'),'sourceRevisionAtCreation',coalesce(d.source_revision_at_creation,q.revision),'payloadHash',public.lk_live_booking_hash(args->'payload'));
 elsif command='booking_save' then
  if b.id is not null then perform lk_private.current_work_error('state_conflict');end if;
  if s.snapshot->>'version' is distinct from 'live-booking-request-ack-v2' or s.snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or s.snapshot->>'preferredDate' is distinct from s.preferred_date::text or s.snapshot->>'preferredTime' is distinct from s.preferred_time or s.snapshot_hash<>public.lk_live_booking_hash(s.snapshot) or s.signed_content_hash<>public.lk_live_booking_hash(jsonb_build_object('snapshot',s.snapshot,'signature',s.signature)) or s.snapshot->'pricing'->>'status' is distinct from 'provisional_estimate' or jsonb_typeof(s.snapshot->'pricing'->'total') is distinct from 'number' or (s.snapshot->'pricing'->>'total')::numeric<=0 then perform lk_private.current_work_error('state_conflict');end if;
  if jsonb_typeof(args->'companyNote') is distinct from 'string' or length(args->>'companyNote')>3000 or args->>'companyNote' ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception using errcode='LK422',message='Invalid company note.';end if;
  firstat:=lk_private.current_work_sydney(s.preferred_date::text||'T'||s.preferred_time);
  takeend:=case when args->'takeOffEndLocal'='null'::jsonb then null else lk_private.current_work_sydney(args->>'takeOffEndLocal') end;
  installstart:=case when args->'installStartLocal'='null'::jsonb then null else lk_private.current_work_sydney(args->>'installStartLocal') end;
  installend:=case when args->'installEndLocal'='null'::jsonb then null else lk_private.current_work_sydney(args->>'installEndLocal') end;
  if takeend<=firstat or takeend-firstat>interval '90 days' or installstart<coalesce(takeend,firstat) or installend<=installstart or installend-installstart>interval '90 days' then raise exception using errcode='LK422',message='Invalid work period boundaries.';end if;
  insert into public.lk_live_company_booking_requests(request_id,revision) values(rid,rev) on conflict(request_id) do update set revision=excluded.revision,updated_at=nowat;
  insert into public.lk_live_simple_booking_drafts(request_id,submission_id,signed_snapshot_hash,revision,payload,saved_by) values(rid,s.id,s.signed_content_hash,rev,(args-array['companyId','actorUserId','actorSessionId','id','expectedRevision','idempotencyKey','reason']),uid) on conflict(request_id) do update set revision=excluded.revision,payload=excluded.payload,saved_by=uid,saved_at=nowat;
  details:=jsonb_build_object('changedFields',jsonb_build_array('draft'),'submissionId',s.id,'signedContentHash',s.signed_content_hash,'payloadHash',public.lk_live_booking_hash(args-array['companyId','actorUserId','actorSessionId','id','expectedRevision','idempotencyKey','reason']));
 elsif command='booking_cancel' then
  if b.status is distinct from 'confirmed' or b.confirmation_basis<>'signed_request' or c.id is not null then perform lk_private.current_work_error('state_conflict');end if;
  if o.id is null or not o.complete or o.email_status<>'provider_accepted' or o.lease_token is not null or o.lease_expires_at is not null then perform lk_private.current_work_error('booking_busy');end if;
  select * into p from public.lk_live_company_proposals where id=b.proposal_id;
  if p.submission_id<>s.id or b.signed_submission_id<>s.id or p.snapshot_hash<>b.proposal_hash or p.snapshot_hash<>public.lk_live_booking_hash(p.snapshot) or p.snapshot->>'originalSignedContentHash' is distinct from s.signed_content_hash or jsonb_array_length(p.snapshot->'segments')<>2 then perform lk_private.current_work_error('state_conflict');end if;
  select jsonb_agg(jsonb_build_object('segmentIndex',x.segment_index,'eventId',x.event_id,'payloadHash',x.payload_hash,'etag',x.etag,'verifiedAt',x.verified_at) order by x.segment_index) into manifest from public.lk_live_company_events x where x.booking_id=b.id and x.segment_index between 0 and 1 and x.etag is not null and x.etag<>'' and x.verified_at is not null and x.payload_hash~'^[a-f0-9]{64}$' and x.event_id='b'||encode(sha256(convert_to('lk-company-confirmed-v1:'||b.id::text||':'||b.proposal_hash||':'||x.segment_index::text,'UTF8')),'hex');
  if manifest is null or jsonb_array_length(manifest)<>2 then perform lk_private.current_work_error('state_conflict');end if;
  child:=gen_random_uuid();insert into public.lk_live_company_cancellations(id,request_id,booking_id,proposal_id,proposal_hash,submission_id,idempotency_key,request_hash,actor_user_id,actor_session_id,reason,manifest) values(child,rid,b.id,p.id,p.snapshot_hash,s.id,key,fingerprint,uid,sid,btrim(args->>'reason'),manifest);
  update public.lk_live_company_bookings set status='cancel_pending',error='Cancellation pending; work periods remain held until Google removal is verified.' where id=b.id;
  update public.lk_live_company_booking_requests set revision=rev,updated_at=nowat where request_id=rid;
  details:=jsonb_build_object('changedFields',jsonb_build_array('bookingStatus'),'bookingId',b.id,'proposalId',p.id,'proposalHash',p.snapshot_hash,'cancellationId',child,'occupancyHeld',true);
 end if;
 result:=jsonb_build_object('receipt',jsonb_strip_nulls(jsonb_build_object('idempotencyKey',key,'entityType',kind,'entityId',rid,'action',command,'revision',rev,'committedAt',nowat,'childId',child)));
 insert into public.lk_current_work_receipts(company_id,entity_type,entity_id,idempotency_key,action,request_hash,actor_user_id,actor_session_id,response) values('lk-group',kind,rid,key,command,fingerprint,uid,sid,result);
 insert into public.lk_current_work_audit(company_id,entity_type,entity_id,action,actor_user_id,actor_session_id,idempotency_key,request_hash,reason,prior_revision,revision,details) values('lk-group',kind,rid,command,uid,sid,key,fingerprint,btrim(args->>'reason'),priorrev,rev,details);
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception using errcode='LK422',message='Invalid field value.';
end;$$;
create function lk_private.company_cancel_claim_json(c public.lk_live_company_cancellations) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'requestId',c.request_id,'bookingId',c.booking_id,'proposalHash',c.proposal_hash,'leaseToken',c.lease_token,'leaseExpiresAt',c.lease_expires_at,'manifest',c.manifest,'state',public.lk_live_company_state(c.request_id),'cancellation',lk_private.company_cancellation_json(c));
$$;
create function lk_private.company_cancel_worker(command text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.lk_live_company_cancellations;b public.lk_live_company_bookings;p public.lk_live_company_proposals;rev integer;entry jsonb;proof jsonb;idx integer;nowat timestamptz:=clock_timestamp();
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Server cancellation access required.';end if;
 if command='cancel_worker_claim' then
  if coalesce(args->>'leaseToken','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK422',message='Worker token required.';end if;
  select * into c from public.lk_live_company_cancellations x where x.status in ('pending','processing','retrying') and (x.next_attempt_at<=nowat or args->>'requestId' is not null) and (x.lease_expires_at is null or x.lease_expires_at<=nowat) and (args->>'requestId' is null or x.request_id=(args->>'requestId')::uuid) order by x.next_attempt_at,x.requested_at for update skip locked limit 1;
  if not found then return null;end if;
  update public.lk_live_company_cancellations set status='processing',lease_token=(args->>'leaseToken')::uuid,lease_expires_at=nowat+interval '4 minutes',error_code=null,evidence='{}' where id=c.id returning * into c;
 else
  select * into c from public.lk_live_company_cancellations where id=(args->>'id')::uuid for update;
  if not found or c.status<>'processing' or c.lease_token is null or c.lease_token is distinct from (args->>'leaseToken')::uuid or c.lease_expires_at<=nowat or c.booking_id is distinct from (args->>'bookingId')::uuid or c.proposal_hash is distinct from args->>'proposalHash' then perform lk_private.current_work_error('state_conflict');end if;
 end if;
 perform 1 from public.lk_quote_requests where id=c.request_id for update;
 perform 1 from public.lk_live_company_booking_requests where request_id=c.request_id for update;
 select * into b from public.lk_live_company_bookings where id=c.booking_id for update;
 select * into p from public.lk_live_company_proposals where id=c.proposal_id;
 if b.status is distinct from 'cancel_pending' or b.proposal_id<>c.proposal_id or b.proposal_hash<>c.proposal_hash or p.snapshot_hash<>c.proposal_hash or b.signed_submission_id<>c.submission_id then perform lk_private.current_work_error('state_conflict');end if;
 select revision into rev from public.lk_live_company_booking_requests where request_id=c.request_id;
 -- Target drift is durable review, not an exception that rolls this decision back.
 if not exists(select 1 from public.lk_google_connection g where g.id=1 and g.account_sub=p.snapshot->'calendarTarget'->>'accountSub' and lower(g.email)=p.snapshot->'calendarTarget'->>'calendarId') then
  update public.lk_live_company_cancellations set status='review_required',error_code='calendar_target_changed',lease_token=null,lease_expires_at=null where id=c.id returning * into c;
  insert into public.lk_current_work_audit(company_id,entity_type,entity_id,action,actor_user_id,actor_session_id,idempotency_key,request_hash,reason,prior_revision,revision,details) values('lk-group','simple_booking',c.request_id,'cancel_worker_target_changed',null,null,c.idempotency_key,c.request_hash,c.reason,rev,rev,jsonb_build_object('bookingId',b.id,'proposalHash',b.proposal_hash,'cancellationId',c.id,'status',c.status,'errorCode',c.error_code,'occupancyHeld',true));
  return jsonb_build_object('reviewRequired',true,'cancellation',lk_private.company_cancellation_json(c));
 end if;
 if command='cancel_worker_assert' then return lk_private.company_cancel_claim_json(c);
 elsif command='cancel_worker_record' then
  idx:=(args->>'segmentIndex')::integer;entry:=c.manifest->idx;
  if idx not between 0 and 1 or entry->>'segmentIndex' is distinct from idx::text or entry->>'eventId' is distinct from args->>'eventId' or coalesce(args->>'resultCode','') not in ('absent_404','absent_410','cancelled_tombstone') or jsonb_typeof(args->'verifiedAt') is distinct from 'string' or (args->>'verifiedAt')::timestamptz>nowat+interval '5 seconds' or (args->>'verifiedAt')::timestamptz<nowat-interval '2 minutes' then raise exception using errcode='LK422',message='Independent event absence proof required.';end if;
  proof:=jsonb_build_object('eventId',args->>'eventId','resultCode',args->>'resultCode','verifiedAt',args->>'verifiedAt');
  update public.lk_live_company_cancellations set evidence=jsonb_set(evidence,array[idx::text],proof) where id=c.id returning * into c;
 elsif command='cancel_worker_finish' then
  if jsonb_typeof(args->'finalProof') is distinct from 'array' or jsonb_array_length(args->'finalProof')<>2 then perform lk_private.current_work_error('state_conflict');end if;
  for idx in 0..1 loop
   proof:=args->'finalProof'->idx;entry:=c.manifest->idx;
   if c.evidence->idx::text is null or proof->>'eventId' is distinct from entry->>'eventId' or proof->>'segmentIndex' is distinct from idx::text or coalesce(proof->>'resultCode','') not in ('absent_404','absent_410','cancelled_tombstone') or jsonb_typeof(proof->'verifiedAt') is distinct from 'string' or (proof->>'verifiedAt')::timestamptz<nowat-interval '2 minutes' or (proof->>'verifiedAt')::timestamptz>nowat+interval '5 seconds' then perform lk_private.current_work_error('state_conflict');end if;
  end loop;
  delete from public.lk_live_booking_confirmed_segments where booking_id=c.booking_id;
  update public.lk_live_company_bookings set status='cancelled',error='Booking cancelled. Google removal verified; work periods released.' where id=b.id;
  update public.lk_live_company_booking_requests set revision=revision+1,updated_at=nowat where request_id=c.request_id returning revision into rev;
  update public.lk_live_company_cancellations set status='cancelled',cancelled_at=nowat,lease_token=null,lease_expires_at=null,error_code=null where id=c.id returning * into c;
 elsif command='cancel_worker_error' then
  if coalesce(args->>'status','') not in ('retrying','review_required') or coalesce(args->>'errorCode','') not in ('calendar_unavailable','calendar_outcome_unknown','calendar_changed','calendar_target_changed','cancellation_storage_unknown') then raise exception using errcode='LK422',message='Safe cancellation failure required.';end if;
  update public.lk_live_company_cancellations set status=args->>'status',error_code=args->>'errorCode',lease_token=null,lease_expires_at=null,next_attempt_at=nowat+interval '1 minute' where id=c.id returning * into c;
 elsif command<>'cancel_worker_claim' then raise exception using errcode='LK422',message='Unknown worker command.';
 end if;
 insert into public.lk_current_work_audit(company_id,entity_type,entity_id,action,actor_user_id,actor_session_id,idempotency_key,request_hash,reason,prior_revision,revision,details) values('lk-group','simple_booking',c.request_id,command,null,null,c.idempotency_key,c.request_hash,c.reason,case when command='cancel_worker_finish' then rev-1 else rev end,rev,jsonb_strip_nulls(jsonb_build_object('bookingId',b.id,'proposalHash',b.proposal_hash,'cancellationId',c.id,'status',c.status,'errorCode',c.error_code,'segmentIndex',args->'segmentIndex','resultCode',args->'resultCode','verifiedAt',args->'verifiedAt','occupancyHeld',c.status<>'cancelled')));
 return lk_private.company_cancel_claim_json(c);
end;$$;
-- Preserve the original confirmation implementation; add cancellation fences only.
alter function public.lk_live_company_booking_command(text,jsonb) rename to lk_live_company_booking_command_r3a_base;
alter function public.lk_live_company_booking_command_r3a_base(text,jsonb) set schema lk_private;
create function public.lk_live_company_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.lk_live_company_bookings;o public.lk_live_company_outbox;rid uuid;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company booking access denied.';end if;
 if command='reconcile_result' then
  select * into b from public.lk_live_company_bookings where id=(args->>'bookingId')::uuid for update;
  if b.status in ('cancel_pending','cancelled') then return public.lk_live_company_state(b.request_id);end if;
 elsif command in ('freeze_mail','mail_result','email_attempt','record_event','finish_calendar','worker_error','assert_lease') then
  select * into o from public.lk_live_company_outbox where id=(args->>'id')::uuid for update;
  select * into b from public.lk_live_company_bookings where proposal_id=o.proposal_id for update;
  if b.status in ('cancel_pending','cancelled') then perform lk_private.current_work_error('cancellation_started');end if;
 elsif command in ('staff_prepare_request','staff_confirm_request','staff_confirm','staff_retry','staff_draft','staff_publish') then
  rid:=(args->>'requestId')::uuid;
  perform 1 from public.lk_quote_requests where id=rid for update;
  select * into b from public.lk_live_company_bookings where request_id=rid;
  if b.status in ('cancel_pending','cancelled') then
   if not lk_private.company_booking_staff_allowed((args->>'actorUserId')::uuid,(args->>'actorSessionId')::uuid) then raise exception using errcode='LK403',message='Current company staff required.';end if;
   perform lk_private.current_work_error('cancellation_started');
  end if;
 end if;
 return lk_private.lk_live_company_booking_command_r3a_base(command,args);
end;$$;

create or replace function public.lk_live_company_booking_json(b public.lk_live_company_bookings) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('confirmationBasis',b.confirmation_basis,'signedSubmissionId',b.signed_submission_id,'id',b.id,'proposalId',b.proposal_id,'proposalHash',b.proposal_hash,'version',b.version,'status',b.status,'occupancyHeld',b.status<>'cancelled','error',b.error,'confirmedAt',b.confirmed_at,'emailStatus',coalesce((select o.email_status from public.lk_live_company_outbox o where o.proposal_id=b.proposal_id and o.kind='confirmation'),'pending'),'receiptReady',exists(select 1 from public.lk_live_company_outbox o where o.proposal_id=b.proposal_id and o.kind='confirmation' and o.pdf_base64 is not null),'events',(select coalesce(jsonb_agg(jsonb_build_object('segmentIndex',e.segment_index,'eventId',e.event_id,'payloadHash',e.payload_hash,'etag',e.etag,'verifiedAt',e.verified_at) order by e.segment_index),'[]'::jsonb) from public.lk_live_company_events e where e.booking_id=b.id));
$$;

create or replace function public.lk_live_company_state(rid uuid,customer boolean default false) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('requestId',rid,'revision',coalesce((select q.revision from public.lk_live_company_booking_requests q where q.request_id=rid),0),'submission',(select public.lk_live_booking_submission_json(s) from public.lk_live_quote_submissions s where s.request_id=rid),
 'proposal',(select public.lk_live_company_proposal_json(p) from public.lk_live_company_proposals p where p.request_id=rid and (not customer or p.status='published') order by p.version desc limit 1),
 'proposals',(select coalesce(jsonb_agg(public.lk_live_company_proposal_json(p) order by p.version desc),'[]'::jsonb) from public.lk_live_company_proposals p where p.request_id=rid and (not customer or p.status='published')),
 'acceptance',(select public.lk_live_company_acceptance_json(a) from public.lk_live_company_acceptances a join public.lk_live_company_proposals p on p.id=a.proposal_id where p.request_id=rid order by p.version desc limit 1),'booking',(select public.lk_live_company_booking_json(b) from public.lk_live_company_bookings b where b.request_id=rid),'acknowledgment',public.lk_live_company_ack(),'simpleDraft',case when customer then null else (select lk_private.simple_booking_draft_json(d) from public.lk_live_simple_booking_drafts d where d.request_id=rid) end,'cancellation',case when customer then null else (select lk_private.company_cancellation_json(c) from public.lk_live_company_cancellations c where c.request_id=rid) end);
$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lk_private' and (p.proname like 'current_work_%' or p.proname in ('current_enquiry_json','staff_quote_payload_valid','staff_quote_draft_json','simple_booking_draft_json','company_cancellation_json','company_cancel_claim_json','company_cancel_worker','lk_live_company_booking_command_r3a_base')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end;$$;
revoke all on function public.lk_current_work_command(text,jsonb),public.lk_live_company_booking_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lk_current_work_command(text,jsonb),public.lk_live_company_booking_command(text,jsonb) to service_role;

-- ===== 20261020101429_ems_customer_resolve_revision_guard.sql (sha256 92eb3b58eec8395e4d875fcbe130f6a347b178cadeaea686a8cb43840613cf5f)
create or replace function public.lk_customers_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.lk_customers;p public.lk_customer_properties;r public.lk_quote_requests;receipt public.lk_customer_commands;
 actor uuid;sess uuid;company text;cid uuid;pid uuid;k text;fingerprint text;result jsonb;matches jsonb;reviewed jsonb;decision jsonb;prop jsonb;addresskey text;reason text;outcome text;propertyoutcome text;oldstate text;legacy jsonb;term text;filter text;n integer;page integer;total integer;items jsonb;relationchanged boolean:=false;
begin
 company:=args->>'companyId';
 if company is distinct from 'lk-group' or coalesce(args->>'actorUserId','') !~ '^[0-9a-fA-F-]{36}$' or coalesce(args->>'actorSessionId','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='LK403',message='Verified company staff required.';end if;
 begin actor:=(args->>'actorUserId')::uuid;sess:=(args->>'actorSessionId')::uuid;exception when invalid_text_representation then raise exception using errcode='LK403',message='Verified company staff required.';end;
 if not lk_private.company_booking_staff_allowed(actor,sess) then raise exception using errcode='LK403',message='Current company staff membership, session and email verification required.';end if;
 if command='candidates' then return jsonb_build_object('candidates',public.lk_customer_candidates(args));end if;
 if command='quote_relation' then
  select * into r from public.lk_quote_requests where company_id=company and id=(args->>'id')::uuid;
  if not found then raise exception using errcode='LK404',message='Quote request not found.';end if;
  select * into c from public.lk_customers where company_id=company and id=r.customer_id;
  select * into p from public.lk_customer_properties where company_id=company and id=r.property_id;
  return jsonb_build_object('requestId',r.id,'crmRevision',r.crm_revision,'customer',case when c.id is null then null else public.lk_customer_json(c) end,'property',case when p.id is null then null else public.lk_customer_property_json(p) end);
 end if;
 if command='list' then
  -- Legacy validates pagination and preserves source contact search.
  legacy:=lk_crm_internal.lk_customers_legacy_command(command,args);term:=lower(coalesce(args->>'q',''));filter:=coalesce(args->>'status','active');
  if filter not in ('active','archived','all') then raise exception using errcode='LK400',message='Invalid customer status.';end if;
  n:=(args->>'pageSize')::int;page:=(args->>'page')::int;
  select count(*) into total from public.lk_customers x where x.company_id=company and (filter='all' or x.status=filter) and (term='' or strpos(lower(concat_ws(' ',x.id,x.name,x.email,x.phone,x.address)),term)>0 or exists(select 1 from public.lk_customer_properties y where y.customer_id=x.id and strpos(lower(concat_ws(' ',y.label,y.address::text)),term)>0) or exists(select 1 from public.lk_customer_records() z join public.lk_customer_record_links l on l.company_id=company and l.customer_id=x.id and ((l.source_type=z.source_type and l.source_id=z.source_id) or (l.source_type='enquiry' and l.source_id=any(z.related_enquiry_ids))) where strpos(lower(concat_ws(' ',z.record->>'reference',z.record->>'name',z.record->>'email',z.record->>'phone',z.record->>'address')),term)>0) or exists(select 1 from public.lk_quote_requests q where q.customer_id=x.id and strpos(lower(concat_ws(' ',q.reference,q.payload->'contact'->>'name',q.payload->'contact'->>'email',q.payload->'contact'->>'siteAddress')),term)>0));
  select coalesce(jsonb_agg(item),'[]') into items from(select public.lk_customer_json(x) item from public.lk_customers x where x.company_id=company and (filter='all' or x.status=filter) and (term='' or strpos(lower(concat_ws(' ',x.id,x.name,x.email,x.phone,x.address)),term)>0 or exists(select 1 from public.lk_customer_properties y where y.customer_id=x.id and strpos(lower(concat_ws(' ',y.label,y.address::text)),term)>0) or exists(select 1 from public.lk_customer_records() z join public.lk_customer_record_links l on l.company_id=company and l.customer_id=x.id and ((l.source_type=z.source_type and l.source_id=z.source_id) or (l.source_type='enquiry' and l.source_id=any(z.related_enquiry_ids))) where strpos(lower(concat_ws(' ',z.record->>'reference',z.record->>'name',z.record->>'email',z.record->>'phone',z.record->>'address')),term)>0) or exists(select 1 from public.lk_quote_requests q where q.customer_id=x.id and strpos(lower(concat_ws(' ',q.reference,q.payload->'contact'->>'name',q.payload->'contact'->>'email',q.payload->'contact'->>'siteAddress')),term)>0)) order by x.created_at desc,x.id limit n offset (page-1)*n)t;
  return jsonb_build_object('customers',items,'total',total,'page',page,'pageSize',n);
 end if;
 if command='detail' then
  legacy:=lk_crm_internal.lk_customers_legacy_command(command,args);cid:=(args->>'id')::uuid;
  select coalesce(jsonb_agg(public.lk_customer_property_json(x) order by x.created_at,x.id),'[]') into items from public.lk_customer_properties x where x.company_id=company and x.customer_id=cid;
  legacy:=legacy||jsonb_build_object('properties',items);
  select coalesce(jsonb_agg(jsonb_build_object('sourceType','quote_request','sourceId',q.id,'reference',q.reference,'name',q.payload->'contact'->>'name','email',q.payload->'contact'->>'email','phone',q.payload->'contact'->>'phone','address',q.payload->'contact'->>'siteAddress','createdAt',q.created_at,'status',q.status,'relatedEnquiryIds','[]'::jsonb,'photos',coalesce((select jsonb_agg(jsonb_build_object('id',photo.id,'url','/api/admin/quote-requests/'||q.id||'/photos/'||photo.id) order by photo.created_at,photo.id) from public.lk_live_quote_photos photo where photo.company_id=company and photo.request_id=q.id and photo.state='ready'),'[]'::jsonb),'booking',(select jsonb_build_object('status',b.status,'revision',b.version,'syncStatus',case when b.status='confirmed' then 'synced' when b.status='review_required' then 'review_required' else 'pending' end,'confirmedAt',b.confirmed_at) from public.lk_live_company_bookings b where b.request_id=q.id),'links',jsonb_build_object('detail','/admin/quotes/'||q.id,'quotePdf',null,'agreementPdf',null,'photos',null)) order by q.created_at desc),'[]') into items from public.lk_quote_requests q where q.company_id=company and q.customer_id=cid;
  legacy:=jsonb_set(legacy,'{records}',(legacy->'records')||items);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'sourceType',a.source_type,'sourceId',a.source_id,'reason',a.reason,'actorUserId',a.actor_user_id,'createdAt',a.created_at,'revision',a.revision) order by a.created_at desc),'[]') into items from public.lk_customer_activity a where a.company_id=company and a.customer_id=cid;
  return jsonb_set(legacy,'{audit}',items||(legacy->'audit'));
 end if;
 if command='unlinked' then return lk_crm_internal.lk_customers_legacy_command(command,args);end if;
 if command not in ('create','resolve','update','archive','restore','property_create','property_update','property_archive','property_restore','link','unlink') then raise exception using errcode='LK400',message='Invalid customer command.';end if;
 -- All R2 writes share this lock. Legacy source/customer lock order is preserved inside.
 perform pg_advisory_xact_lock(hashtextextended(company||':crm',0));
 k:=args->>'idempotencyKey';
 if coalesce(length(btrim(k)),0) not between 1 and 120 or k ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid idempotency key.';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command,'args',args-array['actorUserId','actorSessionId','_generatedId'])::text,'UTF8')),'hex');
 -- create's generated ID is excluded; it is not a business request field.
 if command='create' then fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command,'args',args-array['actorUserId','actorSessionId','id'])::text,'UTF8')),'hex');end if;
 select * into receipt from public.lk_customer_commands where company_id=company and idempotency_key=k;
 if found then
  if receipt.command_hash<>fingerprint or receipt.actor_user_id<>actor or receipt.actor_session_id<>sess then raise exception using errcode='LK409',message='Idempotency key already used for another request.';end if;
  return receipt.result_json;
 end if;
 if exists(select 1 from public.lk_customer_audit_events a where a.company_id=company and a.idempotency_key=k) then raise exception using errcode='LK409',message='Legacy command key cannot be reused.';end if;
 reason:=coalesce(args->'decision'->>'reason',args->>'reason','Customer created by administrator.');
 if length(btrim(reason)) not between 1 and 500 or reason ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid mutation reason.';end if;
 if command in ('link','unlink') then
  select * into c from public.lk_customers where company_id=company and id=(args->>'id')::uuid;
  if c.status='archived' and command='link' then raise exception using errcode='LK409',message='Restore the client before linking new records.';end if;
  result:=lk_crm_internal.lk_customers_legacy_command(command,args);
 elsif command in ('create','resolve') then
  if coalesce(length(btrim(args->>'name')),0) not between 1 and 120 or args->>'name' ~ '[[:cntrl:]]' or length(coalesce(args->>'email',''))>254 or length(coalesce(args->>'phone',''))>80 or length(coalesce(args->>'address',''))>500 or concat_ws('',args->>'email',args->>'phone',args->>'address') ~ '[[:cntrl:]]' or (nullif(args->>'email','') is not null and args->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='LK400',message='Invalid customer details.';end if;
  decision:=coalesce(args->'decision','{"kind":"auto"}');
  if decision->>'kind' in ('existing','different_person') and (coalesce(length(btrim(decision->>'reason')),0) not between 1 and 500 or decision->>'reason' ~ '[[:cntrl:]]') then raise exception using errcode='LK400',message='Review reason required.';end if;
  if decision->>'kind' not in ('auto','existing','different_person') or decision->>'kind' is null then raise exception using errcode='LK400',message='Invalid customer decision.';end if;
  if args->'source' is not null then
   if args->'source'->>'type'<>'quote_request' then raise exception using errcode='LK400',message='Invalid source.';end if;
   select * into r from public.lk_quote_requests where company_id=company and id=(args->'source'->>'id')::uuid for update;
   if not found then raise exception using errcode='LK404',message='Quote request not found.';end if;
   if r.revision is distinct from (args->'source'->>'expectedSourceRevision')::int then raise exception using errcode='LK409',message='Quote content changed. Reload before CRM linking.';end if;
   if r.customer_id is null and not exists(select 1 from public.lk_quote_request_access a where a.company_id=company and a.request_id=r.id and a.revoked_at is null and lower(a.verified_email)=lower(r.payload->'contact'->>'email')) then raise exception using errcode='LK409',message='Customer email verification required before CRM linking.';end if;
   if decision->>'kind'='auto' and (lower(btrim(args->>'name')) is distinct from lower(btrim(r.payload->'contact'->>'name')) or lower(btrim(args->>'email')) is distinct from lower(btrim(r.payload->'contact'->>'email')) or (nullif(btrim(args->>'phone'),'') is not null and coalesce(public.lk_customer_phone(args->>'phone'),btrim(args->>'phone')) is distinct from coalesce(public.lk_customer_phone(r.payload->'contact'->>'phone'),btrim(r.payload->'contact'->>'phone')))) then raise exception using errcode='LK409',message='Quote contact changed. Reload before CRM linking.';end if;
   if r.customer_id is not null then
    if decision->>'kind'='different_person' or (decision->>'kind'='existing' and (decision->>'customerId')::uuid<>r.customer_id) then raise exception using errcode='LK409',message='Quote already belongs to another client.';end if;
    cid:=r.customer_id;
   end if;
  end if;
  matches:=public.lk_customer_candidates(args);
  if cid is null and decision->>'kind'='existing' then
   cid:=(decision->>'customerId')::uuid;
   select * into c from public.lk_customers where company_id=company and id=cid for update;
   if not found then raise exception using errcode='LK404',message='Customer not found.';end if;
  elsif cid is null then
   if jsonb_array_length(matches)>0 then
    if decision->>'kind'<>'different_person' then return jsonb_build_object('outcome','needs_review','candidates',matches);end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',v->'customer'->>'id','revision',(v->'customer'->>'revision')::int) order by v->'customer'->>'id'),'[]') into reviewed from jsonb_array_elements(matches)v;
    if reviewed is distinct from (select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(decision->'reviewedCandidates','[]'))v) then raise exception using errcode='LK409',message='Candidate review changed. Reload and review.';end if;
   elsif decision->>'kind'='different_person' and coalesce(decision->'reviewedCandidates','[]')<>'[]'::jsonb then raise exception using errcode='LK409',message='Candidate review changed. Reload and review.';end if;
   cid:=coalesce((args->>'id')::uuid,gen_random_uuid());
   insert into public.lk_customers(id,company_id,name,email,phone,address) values(cid,company,btrim(args->>'name'),nullif(btrim(args->>'email'),''),nullif(btrim(args->>'phone'),''),nullif(btrim(args->>'address'),'')) returning * into c;
   outcome:='client_created';
  end if;
  select * into c from public.lk_customers where company_id=company and id=cid for update;
  if decision->>'kind'='existing' and c.revision is distinct from (decision->>'expectedRevision')::bigint then raise exception using errcode='LK409',message='Client changed. Reload and review.';end if;
  if c.status<>'active' then return jsonb_build_object('outcome','needs_review','candidates',jsonb_build_array(jsonb_build_object('customer',public.lk_customer_json(c),'matchedBy',jsonb_build_array('name'))));end if;
  outcome:=coalesce(outcome,'client_reused');prop:=args->'property';
  if prop is not null and args->>'propertyId' is not null then raise exception using errcode='LK400',message='Select or create one property.';end if;
  if args->>'propertyId' is not null then
   select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and id=(args->>'propertyId')::uuid for update;
   if not found then raise exception using errcode='LK404',message='Property not found for client.';end if;
   if p.revision is distinct from (args->>'expectedPropertyRevision')::bigint then raise exception using errcode='LK409',message='Property changed. Reload and review.';end if;
   if p.status<>'active' then raise exception using errcode='LK409',message='Restore property before linking.';end if;
   propertyoutcome:='property_reused';
  elsif prop is not null then
   addresskey:=public.lk_customer_address_key(prop->'address');
   if coalesce(length(btrim(prop->>'label')),0) not between 1 and 120 or length(prop->>'contactName')>120 or length(prop->>'notes')>2000 or concat_ws('',prop->>'label',prop->>'contactName',prop->>'notes') ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid property details.';end if;
   select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and address_key=addresskey for update;
   if found then
    if p.status<>'active' then raise exception using errcode='LK409',message='Matching property is archived. Restore it first.';end if;
    propertyoutcome:='property_reused';
   else
    matches:=public.lk_customer_property_candidates(cid,prop->'address');
    if jsonb_array_length(matches)>0 and not public.lk_customer_property_review_valid(matches,args->'propertyDecision') then return jsonb_build_object('outcome','needs_property_review','properties',matches);end if;
    insert into public.lk_customer_properties(company_id,customer_id,label,address,address_key,contact_name,notes) values(company,cid,btrim(prop->>'label'),prop->'address',addresskey,prop->>'contactName',prop->>'notes') returning * into p;
    propertyoutcome:='property_created';
   end if;
  end if;
  if r.id is not null then
   if r.property_id is not null and p.id is not null and r.property_id<>p.id then raise exception using errcode='LK409',message='Quote already belongs to another property.';end if;
   if (r.customer_id is distinct from cid or (p.id is not null and r.property_id is distinct from p.id)) then
    if r.crm_revision is distinct from (args->'source'->>'expectedCrmRevision')::int then raise exception using errcode='LK409',message='Quote CRM relation changed. Reload and review.';end if;
    relationchanged:=true;
    update public.lk_quote_requests set customer_id=cid,property_id=coalesce(p.id,property_id),crm_revision=crm_revision+1 where id=r.id returning * into r;
   end if;
   if p.id is null and r.property_id is not null then select * into p from public.lk_customer_properties where id=r.property_id;propertyoutcome:='property_reused';end if;
  end if;
  -- A reused customer gets a revision for new property/relation; source-only replay is a no-op.
  if outcome='client_reused' and (propertyoutcome='property_created' or relationchanged) then update public.lk_customers set revision=revision+1,updated_at=now() where id=cid returning * into c;end if;
  result:=case when command='create' then public.lk_customer_json(c) else jsonb_build_object('outcome',outcome,'customer',public.lk_customer_json(c),'property',case when p.id is null then null else public.lk_customer_property_json(p) end,'propertyOutcome',propertyoutcome) end;
  if r.id is not null then result:=result||jsonb_build_object('crmRevision',r.crm_revision);end if;
 else
  cid:=(args->>'id')::uuid;
  select * into c from public.lk_customers where company_id=company and id=cid for update;
  if not found then raise exception using errcode='LK404',message='Customer not found.';end if;
  if command like 'property_%' and command<>'property_create' then
   select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and id=(args->>'propertyId')::uuid for update;
   if not found then raise exception using errcode='LK404',message='Property not found.';end if;
   if p.revision is distinct from (args->>'expectedRevision')::int then raise exception using errcode='LK409',message='Property changed. Reload and review.';end if;
  elsif c.revision is distinct from (args->>'expectedRevision')::int then raise exception using errcode='LK409',message='Client changed. Reload and review.';end if;
  if c.status='archived' and command<>'restore' then raise exception using errcode='LK409',message='Restore client before editing.';end if;
  oldstate:=case when command like 'property_%' then p.status else c.status end;
  if command='update' then
   if coalesce(length(btrim(args->>'name')),0) not between 1 and 120 or args->>'name' ~ '[[:cntrl:]]' or length(coalesce(args->>'email',''))>254 or length(coalesce(args->>'phone',''))>80 or length(coalesce(args->>'address',''))>500 or concat_ws('',args->>'email',args->>'phone',args->>'address') ~ '[[:cntrl:]]' or (nullif(args->>'email','') is not null and args->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='LK400',message='Invalid customer details.';end if;
   matches:=public.lk_customer_candidates(args,cid);
   if jsonb_array_length(matches)>0 then
    select coalesce(jsonb_agg(jsonb_build_object('id',v->'customer'->>'id','revision',(v->'customer'->>'revision')::int) order by v->'customer'->>'id'),'[]') into reviewed from jsonb_array_elements(matches)v;
    if args->'decision'->>'kind' is distinct from 'different_person' or reviewed is distinct from(select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(args->'decision'->'reviewedCandidates','[]'))v) then return jsonb_build_object('outcome','needs_review','candidates',matches);end if;
   end if;
   update public.lk_customers set name=btrim(args->>'name'),email=nullif(btrim(args->>'email'),''),phone=nullif(btrim(args->>'phone'),''),address=nullif(btrim(args->>'address'),''),revision=revision+1,updated_at=now() where id=cid returning * into c;
  elsif command in ('archive','restore') then
   if command='restore' then
    matches:=public.lk_customer_candidates(public.lk_customer_json(c),cid);
    if jsonb_array_length(matches)>0 then
     select coalesce(jsonb_agg(jsonb_build_object('id',v->'customer'->>'id','revision',(v->'customer'->>'revision')::int) order by v->'customer'->>'id'),'[]') into reviewed from jsonb_array_elements(matches)v;
     if args->'decision'->>'kind' is distinct from 'different_person' or reviewed is distinct from(select coalesce(jsonb_agg(v order by v->>'id'),'[]') from jsonb_array_elements(coalesce(args->'decision'->'reviewedCandidates','[]'))v) then return jsonb_build_object('outcome','needs_review','candidates',matches);end if;
    end if;
   end if;
   if (command='archive' and c.status<>'active') or (command='restore' and c.status<>'archived') then raise exception using errcode='LK409',message='Client state already changed.';end if;
   update public.lk_customers set status=case when command='archive' then 'archived' else 'active' end,archived_at=case when command='archive' then now() else null end,revision=revision+1,updated_at=now() where id=cid returning * into c;
  elsif command in ('property_create','property_update') then
   prop:=args;addresskey:=public.lk_customer_address_key(prop->'address');
   if coalesce(length(btrim(prop->>'label')),0) not between 1 and 120 or length(prop->>'contactName')>120 or length(prop->>'notes')>2000 or concat_ws('',prop->>'label',prop->>'contactName',prop->>'notes') ~ '[[:cntrl:]]' then raise exception using errcode='LK400',message='Invalid property details.';end if;
   if command='property_create' then
    select * into p from public.lk_customer_properties where company_id=company and customer_id=cid and address_key=addresskey for update;
    if found then
     if p.status='archived' then raise exception using errcode='LK409',message='Matching property is archived. Restore it first.';end if;
     propertyoutcome:='property_reused';
    else
     matches:=public.lk_customer_property_candidates(cid,prop->'address');
     if jsonb_array_length(matches)>0 and not public.lk_customer_property_review_valid(matches,args->'propertyDecision') then return jsonb_build_object('outcome','needs_property_review','properties',matches);end if;
     insert into public.lk_customer_properties(company_id,customer_id,label,address,address_key,contact_name,notes) values(company,cid,btrim(prop->>'label'),prop->'address',addresskey,prop->>'contactName',prop->>'notes') returning * into p;propertyoutcome:='property_created';end if;
   else
    if p.status<>'active' then raise exception using errcode='LK409',message='Restore property before editing.';end if;
    if exists(select 1 from public.lk_customer_properties x where x.company_id=company and x.customer_id=cid and x.address_key=addresskey and x.id<>p.id) then raise exception using errcode='LK409',message='Another property has this address.';end if;
    matches:=public.lk_customer_property_candidates(cid,prop->'address',p.id);
    if jsonb_array_length(matches)>0 and not public.lk_customer_property_review_valid(matches,args->'propertyDecision') then return jsonb_build_object('outcome','needs_property_review','properties',matches);end if;
    update public.lk_customer_properties set label=btrim(prop->>'label'),address=prop->'address',address_key=addresskey,contact_name=prop->>'contactName',notes=prop->>'notes',revision=revision+1,updated_at=now() where id=p.id returning * into p;
   end if;
  elsif command in ('property_archive','property_restore') then
   if (command='property_archive' and p.status<>'active') or (command='property_restore' and p.status<>'archived') then raise exception using errcode='LK409',message='Property state already changed.';end if;
   update public.lk_customer_properties set status=case when command='property_archive' then 'archived' else 'active' end,archived_at=case when command='property_archive' then now() else null end,revision=revision+1,updated_at=now() where id=p.id returning * into p;
  end if;
  if command like 'property_%' then
   update public.lk_customers set revision=revision+1,updated_at=now() where id=cid returning * into c;
   result:=jsonb_build_object('customer',public.lk_customer_json(c),'property',public.lk_customer_property_json(p),'propertyOutcome',propertyoutcome);
  else result:=public.lk_customer_json(c);end if;
 end if;
 if command='create' then
 insert into public.lk_customer_audit_events(company_id,customer_id,action,reason,actor_user_id,actor_session_id,idempotency_key,request_hash,result_json,revision) values(company,c.id,'create',reason,actor,sess,k,fingerprint,jsonb_build_object('id',c.id,'revision',c.revision,'updatedAt',c.updated_at),c.revision);
 elsif command not in ('link','unlink') then insert into public.lk_customer_activity(company_id,customer_id,property_id,source_type,source_id,details,action,reason,actor_user_id,actor_session_id,revision,previous_state,new_state) values(company,c.id,p.id,case when r.id is not null then 'quote_request' else null end,r.id,jsonb_build_object('crmRevision',r.crm_revision,'propertyRevision',p.revision,'decision',args->'decision'->>'kind','propertyReview',args->'propertyDecision'),command,reason,actor,sess,c.revision,oldstate,case when command like 'property_%' then p.status else c.status end);end if;
 insert into public.lk_customer_commands(company_id,idempotency_key,command_hash,actor_user_id,actor_session_id,result_json) values(company,k,fingerprint,actor,sess,result);
 return result;
end;$$;
revoke all on function public.lk_customers_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_customers_command(text,jsonb) to service_role;

-- ===== 20261021090000_ems_r3b_staff_draft_validation.sql (sha256 0306f22d35823d95ca06af9dce219f57649d8a986814f4b90ca1b0cd2efa5378)
-- D1 retains only unchanged legacy fields; DB source is authoritative.
-- ECMAScript String.trim whitespace, independent of the database locale and ASCII-only btrim.
create function lk_private.staff_quote_trim(value text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(value,U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$','','g');
$$;
create function lk_private.staff_quote_field_same(value jsonb, source jsonb, key text) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(value->key)='string' and jsonb_typeof(source->key)='string' then
 case when key='email' then lower(lk_private.staff_quote_trim(value->>key))=lower(lk_private.staff_quote_trim(source->>key)) else lk_private.staff_quote_trim(value->>key)=lk_private.staff_quote_trim(source->>key) end
 else value->key is not distinct from source->key end;
$$;
create function lk_private.staff_quote_payload_against_source_valid(value jsonb, source jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare c jsonb:=value->'contact';s jsonb:=value->'service';k text;v text;phone text;email text;localpart text;domainpart text;legacy boolean;lim integer;
begin
 if not lk_private.current_work_keys(value,array['contact','service','internalNotes']) or not lk_private.current_work_keys(c,array['name','email','phone','siteAddress','suburb','postcode','details']) or jsonb_typeof(value->'internalNotes') is distinct from 'string' or length(value->>'internalNotes')>3000 or value->>'internalNotes' ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then return false;end if;
 foreach k in array array['name','email','phone','siteAddress','suburb','postcode','details'] loop
 if jsonb_typeof(c->k) is distinct from 'string' then return false;end if;
 v:=c->>k;legacy:=coalesce(lk_private.staff_quote_field_same(c,source->'contact',k),false);
 lim:=case k when 'name' then 120 when 'email' then 254 when 'phone' then 40 when 'siteAddress' then 240 when 'suburb' then 100 when 'postcode' then 4 else 3000 end;
 if length(v)>lim or v ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]' or (k not in ('phone','details') and lk_private.staff_quote_trim(v)='') then return false;end if;
 if not legacy and (v ~ '[\x7f]' or v ~* '<(!--|/?[a-z][^>]*(>|$))' or (k<>'details' and v ~ '[\x09\x0a\x0d]') or (k in ('name','siteAddress','suburb') and (v !~ '[[:alpha:]]' or v ~* '(https?://|www\.)'))) then return false;end if;
 end loop;
 if lk_private.staff_quote_trim(c->>'postcode') !~ '^[0-9]{4}$' then return false;end if;
 email:=lower(lk_private.staff_quote_trim(c->>'email'));
 if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return false;end if;
 if not coalesce(lk_private.staff_quote_field_same(c,source->'contact','email'),false) then
 localpart:=split_part(email,'@',1);domainpart:=split_part(email,'@',2);
 if length(localpart)>64 or localpart ~ '^\.|\.$|\.\.' or localpart !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+$' or length(domainpart)>253 or exists(select 1 from unnest(string_to_array(domainpart,'.')) label where label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') then return false;end if;
 end if;
 if not coalesce(lk_private.staff_quote_field_same(c,source->'contact','phone'),false) then
 if c->>'phone' !~ '^[0-9 +()\- ]*$' then return false;end if;
 phone:=regexp_replace(c->>'phone','[ () -]','','g');
 if phone<>'' and phone !~ '^(0[23478][0-9]{8}|13[0-9]{4}|(1300|1800)[0-9]{6}|180[0-9]{4}|(\+61|0061)([23478][0-9]{8}|13[0-9]{4}|(1300|1800)[0-9]{6}|180[0-9]{4}))$' then return false;end if;
 end if;
 if s='null'::jsonb then return true;end if;
 if not lk_private.current_work_keys(s,array['serviceId','intent','surfaces','doorCount','drawerCount','material','colourPreference']) or s->>'serviceId' is distinct from 'cabinet-painting' or coalesce(s->>'intent','') not in ('full-repainting','partial-touch-ups','colour-change','advice') or jsonb_typeof(s->'surfaces') is distinct from 'array' then return false;end if;
 if jsonb_array_length(s->'surfaces') not between 1 and 6 or exists(select 1 from jsonb_array_elements(s->'surfaces') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('doors','drawers','frames','panels','repairs','unknown')) or (s->'surfaces' ? 'unknown' and jsonb_array_length(s->'surfaces')>1) then return false;end if;
 foreach k in array array['doorCount','drawerCount'] loop
 if s->k<>'null'::jsonb and (jsonb_typeof(s->k)<>'number' or s->>k !~ '^[0-9]{1,3}$' or (s->>k)::integer>500) then return false;end if;
 end loop;
 foreach k in array array['material','colourPreference'] loop
 if jsonb_typeof(s->k) is distinct from 'string' or length(s->>k)>100 or s->>k ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]' then return false;end if;
 if not coalesce(lk_private.staff_quote_field_same(s,source->'service',k),false) and (s->>k ~ '[\x09\x0a\x0d\x7f]' or s->>k ~* '<(!--|/?[a-z][^>]*(>|$))') then return false;end if;
 end loop;
 return true;
end;$$;
-- This helper is structural/stored-only. Publication must use the strict helper below.
create or replace function lk_private.staff_quote_payload_valid(value jsonb) returns boolean language sql immutable set search_path='' as $$select lk_private.staff_quote_payload_against_source_valid(value,value);$$;
create function lk_private.staff_quote_payload_strict_valid(value jsonb) returns boolean language sql immutable set search_path='' as $$select lk_private.staff_quote_payload_against_source_valid(value,null);$$;
create function lk_private.staff_quote_source_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
 select q.payload into source from public.lk_quote_requests q where q.id=new.request_id and q.company_id='lk-group' for update;
 if source is null or not lk_private.staff_quote_payload_against_source_valid(new.payload,source) then raise exception using errcode='LK422',message='Invalid staff quote work copy.';end if;
 return new;
end;$$;
create trigger lk_staff_quote_source_guard before insert or update on public.lk_staff_quote_drafts for each row execute function lk_private.staff_quote_source_guard();
revoke all on function lk_private.staff_quote_trim(text),lk_private.staff_quote_field_same(jsonb,jsonb,text),lk_private.staff_quote_payload_against_source_valid(jsonb,jsonb),lk_private.staff_quote_payload_valid(jsonb),lk_private.staff_quote_payload_strict_valid(jsonb),lk_private.staff_quote_source_guard() from public,anon,authenticated,service_role;

-- ===== 20261021091000_ems_r3b_company_revisions.sql (sha256 546f8b2cccf33c475d21ab18b69b156c40ce42a3ef782eef84f4e7632184d89d)
-- R3b company revisions are new evidence; original requests/submissions and their mail never change.
create table public.lk_quote_company_revisions (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),request_id uuid not null references public.lk_quote_requests(id),
 version_no integer not null check(version_no>0),revision integer not null check(revision>0),base_submission_id uuid not null references public.lk_live_quote_submissions(id),
 base_snapshot_hash text not null,base_signed_content_hash text not null,based_on_revision_id uuid references public.lk_quote_company_revisions(id),
 status text not null check(status in ('draft','published','accepted','superseded','withdrawn')),payload jsonb not null,pricing jsonb not null,total_cents bigint not null check(total_cents>0),comparison jsonb not null,
 snapshot jsonb,snapshot_hash text,acknowledgment jsonb not null,terms_version text,
 created_by uuid not null,updated_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz,published_by uuid,accepted_at timestamptz,withdrawn_at timestamptz,withdrawn_by uuid,
 unique(request_id,version_no),check((snapshot is null and snapshot_hash is null and status='draft') or (snapshot is not null and snapshot_hash~'^[a-f0-9]{64}$' and status<>'draft'))
);
create unique index lk_quote_company_revision_active on public.lk_quote_company_revisions(request_id) where status in ('draft','published');
create table public.lk_quote_company_revision_acceptances (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),request_id uuid not null references public.lk_quote_requests(id),revision_id uuid not null unique references public.lk_quote_company_revisions(id),
 auth_user_id uuid not null,verified_email text not null,snapshot_hash text not null,signature jsonb not null,acknowledgment jsonb not null,signed_content_hash text not null check(signed_content_hash~'^[a-f0-9]{64}$'),accepted_at timestamptz not null default now()
);
create table public.lk_quote_company_revision_outbox (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),revision_id uuid not null references public.lk_quote_company_revisions(id),kind text not null check(kind in ('revision_notice','revision_acceptance_receipt')),
 email_status text not null default 'pending' check(email_status in ('pending','sending','provider_accepted','retrying','failed','manual_review','cancelled')),provider_message_id text,email_idempotency_key text not null unique,email_first_attempt_at timestamptz,
 pdf_base64 text not null,pdf_hash text not null check(pdf_hash~'^[a-f0-9]{64}$'),payload jsonb not null,lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default now(),error_code text,created_at timestamptz not null default now(),unique(revision_id,kind),check(email_status<>'provider_accepted' or provider_message_id is not null)
);
create table public.lk_quote_company_revision_receipts (
 request_id uuid not null references public.lk_quote_requests(id),idempotency_key uuid not null,command text not null,command_hash text not null,actor_id uuid not null,actor_session_id uuid not null,response jsonb not null,created_at timestamptz not null default now(),primary key(request_id,idempotency_key)
);
create table public.lk_quote_company_revision_audit (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),revision_id uuid not null references public.lk_quote_company_revisions(id),action text not null,actor_id uuid not null,actor_session_id uuid not null,reason text not null,prior_revision integer not null,new_revision integer not null,details jsonb not null,created_at timestamptz not null default now()
);
create function lk_private.company_revision_ack() returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('version','company-quote-revision-ack-v1','text','I accept this revised quote for my booking request and confirm the changes shown here. This is not a contract, work authorisation or payment obligation. Final contractual terms require separate acceptance.');$$;
create function lk_private.company_revision_error(code text,rev integer default null) returns void language plpgsql set search_path='' as $$begin raise exception using errcode='LK409',message='The company revision cannot be changed.',detail=jsonb_strip_nulls(jsonb_build_object('code',code,'currentRevision',rev))::text;end;$$;
create function lk_private.company_revision_pricing(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare q jsonb:=value->'quantities';extra jsonb;k text;doors integer;drawers integer;painting bigint;amount bigint;items jsonb:='[]';
 -- Technical typo guard only; this is not a business price or an approved extra-item rate.
 MAX_EXTRA_ITEM_CENTS_TECHNICAL constant bigint:=10000000;
begin
 if not lk_private.current_work_keys(value,array['contact','quantities','extraItems','customerNote']) or not lk_private.current_work_keys(q,array['doorCount','drawerCount','moderateRepair']) then raise exception using errcode='LK422',message='Invalid company revision fields.';end if;
 foreach k in array array['doorCount','drawerCount'] loop if jsonb_typeof(q->k) is distinct from 'number' or coalesce(q->>k,'')!~'^[0-9]{1,3}$' or (q->>k)::integer>500 then raise exception using errcode='LK422',message='Invalid quantities.';end if;end loop;
 doors:=(q->>'doorCount')::integer;drawers:=(q->>'drawerCount')::integer;
 if doors+drawers=0 or jsonb_typeof(q->'moderateRepair') is distinct from 'boolean' or jsonb_typeof(value->'extraItems') is distinct from 'array' or jsonb_array_length(value->'extraItems')>30 or jsonb_typeof(value->'customerNote') is distinct from 'string' or length(value->>'customerNote')>3000 or value->>'customerNote'~'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' or value->>'customerNote'~*'<(!--|/?[a-z][^>]*(>|$))' then raise exception using errcode='LK422',message='Invalid company revision fields.';end if;
 if doors>0 then items:=items||jsonb_build_array(jsonb_build_object('code','doors','label','Cabinet door preparation and painting','quantity',doors,'unitAmount',15000,'amount',doors*15000));end if;
 if drawers>0 then items:=items||jsonb_build_array(jsonb_build_object('code','drawers','label','Drawer front preparation and painting','quantity',drawers,'unitAmount',10000,'amount',drawers*10000));end if;
 painting:=doors*15000+drawers*10000;
 if painting<145000 then items:=items||jsonb_build_array(jsonb_build_object('code','minimum_adjustment','label','Minimum painting charge adjustment','quantity',1,'unitAmount',145000-painting,'amount',145000-painting));end if;
 amount:=greatest(painting,145000);
 if (q->>'moderateRepair')::boolean then items:=items||jsonb_build_array(jsonb_build_object('code','moderate_repairs','label','Moderate coating repairs (once per project)','quantity',1,'unitAmount',25000,'amount',25000));amount:=amount+25000;end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(value->'extraItems') x)<>jsonb_array_length(value->'extraItems') then raise exception using errcode='LK422',message='Duplicate extra item.';end if;
 for extra in select x from jsonb_array_elements(value->'extraItems') x loop
  if not lk_private.current_work_keys(extra,array['id','description','amountCents','reason']) or coalesce(extra->>'id','')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' or jsonb_typeof(extra->'amountCents') is distinct from 'number' or coalesce(extra->>'amountCents','')!~'^[0-9]{1,8}$' or (extra->>'amountCents')::bigint not between 1 and MAX_EXTRA_ITEM_CENTS_TECHNICAL then raise exception using errcode='LK422',message='Invalid extra item amount.';end if;
  foreach k in array array['description','reason'] loop if jsonb_typeof(extra->k) is distinct from 'string' or length(btrim(extra->>k)) not between 1 and 500 or extra->>k~'[\x00-\x1f\x7f]' or extra->>k~*'<(!--|/?[a-z][^>]*(>|$))' then raise exception using errcode='LK422',message='An extra item description and reason are required.';end if;end loop;
  amount:=amount+(extra->>'amountCents')::bigint;items:=items||jsonb_build_array(jsonb_build_object('code','extra:'||(extra->>'id'),'label',extra->>'description','quantity',1,'unitAmount',(extra->>'amountCents')::bigint,'amount',(extra->>'amountCents')::bigint));
 end loop;
 return jsonb_build_object('pricingVersion','lk-sydney-cabinet-v3-20261014','currency','AUD','amountUnit','cents','minimumSubtotal',145000,'gstRateBps',0,'lineItems',items,'subtotal',amount,'tax',0,'total',amount);
end;$$;
-- Preserve the signed monetary evidence; never infer a historical tax rate or line-item subtotal.
create function lk_private.company_revision_original_pricing(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;n numeric;subtotal numeric;tax numeric;gst numeric;total numeric;items jsonb:=coalesce(nullif(value->'lineItems','null'::jsonb),'[]'::jsonb);version jsonb:=coalesce(value->'pricingVersion','null'::jsonb);
begin
 if jsonb_typeof(value) is distinct from 'object' or jsonb_typeof(items)<>'array' or jsonb_typeof(version) not in ('string','null') then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
 foreach k in array array['subtotal','tax','gst','total'] loop
  if value->k is not null and value->k<>'null'::jsonb then
   if jsonb_typeof(value->k)<>'number' then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
   n:=(value->>k)::numeric;
   if n<0 or n>9007199254740991 or trunc(n)<>n then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
   case k when 'subtotal' then subtotal:=n;when 'tax' then tax:=n;when 'gst' then gst:=n;when 'total' then total:=n;end case;
  end if;
 end loop;
 if total is null or (tax is not null and gst is not null and tax<>gst) then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
 tax:=coalesce(tax,gst);
 if subtotal is null and tax is null then raise exception using errcode='LK422',message='Missing original signed subtotal or tax.';end if;
 subtotal:=coalesce(subtotal,total-tax);tax:=coalesce(tax,total-subtotal);
 if subtotal<0 or tax<0 or subtotal+tax<>total then raise exception using errcode='LK422',message='Original signed pricing does not balance.';end if;
 return jsonb_build_object('lineItems',items,'subtotalCents',subtotal,'taxCents',tax,'totalCents',total,'pricingVersion',version);
end;$$;
create function lk_private.company_revision_original_quantities(snapshot jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('doorCount',coalesce((select (x->>'quantity')::integer from jsonb_array_elements(coalesce(nullif(snapshot->'pricing'->'lineItems','null'::jsonb),'[]'::jsonb)) x where x->>'code'='doors'),(snapshot->'payload'->'service'->>'doorCount')::integer,0),'drawerCount',coalesce((select (x->>'quantity')::integer from jsonb_array_elements(coalesce(nullif(snapshot->'pricing'->'lineItems','null'::jsonb),'[]'::jsonb)) x where x->>'code'='drawers'),(snapshot->'payload'->'service'->>'drawerCount')::integer,0),'moderateRepair',exists(select 1 from jsonb_array_elements(coalesce(nullif(snapshot->'pricing'->'lineItems','null'::jsonb),'[]'::jsonb)) x where x->>'code'='moderate_repairs'));
$$;
create function lk_private.company_revision_comparison(s public.lk_live_quote_submissions,value jsonb,pricing jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare original jsonb;company jsonb;quantities jsonb;changes jsonb:='[]';k text;
begin
 quantities:=lk_private.company_revision_original_quantities(s.snapshot);
 original:=lk_private.company_revision_original_pricing(s.snapshot->'pricing')||jsonb_build_object('quantities',quantities);company:=jsonb_build_object('quantities',value->'quantities','lineItems',pricing->'lineItems','totalCents',pricing->'total');
 foreach k in array array['doorCount','drawerCount','moderateRepair'] loop if quantities->k is distinct from value->'quantities'->k then changes:=changes||jsonb_build_array(jsonb_build_object('field','quantities.'||k,'before',quantities->k,'after',value->'quantities'->k));end if;end loop;
 foreach k in array array['name','email','phone','siteAddress','suburb','postcode','details'] loop if s.snapshot->'payload'->'contact'->k is distinct from value->'contact'->k then changes:=changes||jsonb_build_array(jsonb_build_object('field','contact.'||k,'before',s.snapshot->'payload'->'contact'->k,'after',value->'contact'->k));end if;end loop;
 if value->'extraItems'<>'[]'::jsonb then changes:=changes||jsonb_build_array(jsonb_build_object('field','extraItems','before','[]'::jsonb,'after',value->'extraItems'));end if;
 if value->>'customerNote'<>'' then changes:=changes||jsonb_build_array(jsonb_build_object('field','customerNote','before','','after',value->>'customerNote'));end if;
 return jsonb_build_object('original',original,'company',company,'deltaCents',(pricing->>'total')::bigint-(s.snapshot->'pricing'->>'total')::bigint,'changes',changes);
end;$$;
create function lk_private.company_revision_snapshot(r public.lk_quote_company_revisions) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('schemaVersion','company-quote-revision-v1','companyId',r.company_id,'requestId',r.request_id,'revisionId',r.id,'versionNo',r.version_no,'baseSubmissionId',r.base_submission_id,'baseSnapshotHash',r.base_snapshot_hash,'baseSignedContentHash',r.base_signed_content_hash,'basedOnRevisionId',r.based_on_revision_id,'contact',r.payload->'contact','quantities',r.payload->'quantities','extraItems',r.payload->'extraItems','customerNote',r.payload->'customerNote','pricing',r.pricing,'comparison',r.comparison,'acknowledgment',r.acknowledgment,'termsVersion',r.terms_version);$$;
create function lk_private.company_revision_eligibility(rid uuid) returns text language plpgsql stable set search_path='' as $$
declare s public.lk_live_quote_submissions;
begin
 if exists(select 1 from public.lk_live_company_cancellations where request_id=rid) then return 'cancellation_started';end if;
 if exists(select 1 from public.lk_live_company_bookings where request_id=rid) then return 'booking_confirmed';end if;
 select * into s from public.lk_live_quote_submissions where request_id=rid and company_id='lk-group';
 if s.id is null or s.snapshot->>'mode' is distinct from 'live' or s.snapshot->>'version' is distinct from 'live-booking-request-ack-v2' or s.snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or s.snapshot_hash is distinct from public.lk_live_booking_hash(s.snapshot) or s.signed_content_hash is distinct from public.lk_live_booking_hash(jsonb_build_object('snapshot',s.snapshot,'signature',s.signature)) or not public.lk_live_booking_signature_valid(s.signature) then return 'revision_not_eligible';end if;
 return null;
end;$$;
create function lk_private.company_revision_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='LK409',message='Company revision evidence cannot be deleted.';end if;
 if tg_table_name='lk_quote_company_revisions' then
  if tg_op='UPDATE' and old.status<>'draft' and (new.payload,new.pricing,new.total_cents,new.comparison,new.snapshot,new.snapshot_hash,new.acknowledgment,new.terms_version,new.base_submission_id,new.base_snapshot_hash,new.base_signed_content_hash,new.based_on_revision_id,new.request_id,new.company_id,new.version_no,new.published_at,new.published_by) is distinct from (old.payload,old.pricing,old.total_cents,old.comparison,old.snapshot,old.snapshot_hash,old.acknowledgment,old.terms_version,old.base_submission_id,old.base_snapshot_hash,old.base_signed_content_hash,old.based_on_revision_id,old.request_id,old.company_id,old.version_no,old.published_at,old.published_by) then raise exception using errcode='LK409',message='Published company revision evidence is immutable.';end if;
  if new.pricing is distinct from lk_private.company_revision_pricing(new.payload) or new.total_cents is distinct from (new.pricing->>'total')::bigint then raise exception using errcode='LK422',message='Company revision arithmetic changed.';end if;
  if new.snapshot is not null and (new.snapshot is distinct from lk_private.company_revision_snapshot(new) or new.snapshot_hash is distinct from public.lk_live_booking_hash(new.snapshot)) then raise exception using errcode='LK422',message='Company revision snapshot changed.';end if;
 elsif tg_table_name='lk_quote_company_revision_acceptances' and tg_op='INSERT' then
  if not public.lk_live_booking_signature_valid(new.signature) or new.acknowledgment is distinct from lk_private.company_revision_ack() or not exists(select 1 from public.lk_quote_company_revisions r where r.id=new.revision_id and r.request_id=new.request_id and r.company_id=new.company_id and r.status='published' and r.snapshot_hash=new.snapshot_hash and new.signed_content_hash=public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',new.signature,'ack',new.acknowledgment))) then raise exception using errcode='LK422',message='Revision acceptance evidence changed.';end if;
 elsif tg_table_name='lk_quote_company_revision_outbox' then
  if tg_op='UPDATE' and (new.request_id,new.revision_id,new.kind,new.email_idempotency_key,new.pdf_base64,new.pdf_hash,new.payload) is distinct from (old.request_id,old.revision_id,old.kind,old.email_idempotency_key,old.pdf_base64,old.pdf_hash,old.payload) then raise exception using errcode='LK409',message='Frozen revision mail is immutable.';end if;
  if tg_op='UPDATE' and old.email_status='provider_accepted' and new is distinct from old then raise exception using errcode='LK409',message='Provider acceptance is immutable.';end if;
 elsif tg_op='UPDATE' then raise exception using errcode='LK409',message='Company revision evidence is immutable.';
 end if;return new;
end;$$;
do $$declare t text;begin foreach t in array array['lk_quote_company_revisions','lk_quote_company_revision_acceptances','lk_quote_company_revision_outbox','lk_quote_company_revision_receipts','lk_quote_company_revision_audit'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to service_role',t);
 execute format('create trigger company_revision_immutable before %s on public.%I for each row execute function lk_private.company_revision_guard()',case when t in ('lk_quote_company_revisions','lk_quote_company_revision_acceptances') then 'insert or update or delete' else 'update or delete' end,t);end loop;end;$$;
create function lk_private.company_revision_json(r public.lk_quote_company_revisions) returns jsonb language sql stable set search_path='' as $$
 select case when r.id is null then null else jsonb_build_object('id',r.id,'requestId',r.request_id,'versionNo',r.version_no,'revision',r.revision,'status',r.status,'baseSubmissionId',r.base_submission_id,'baseSnapshotHash',r.base_snapshot_hash,'baseSignedContentHash',r.base_signed_content_hash,'basedOnRevisionId',r.based_on_revision_id,'payload',r.payload,'pricing',r.pricing,'totalCents',r.total_cents,'comparison',r.comparison,'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash,'publishedAt',r.published_at,'acceptedAt',r.accepted_at,'withdrawnAt',r.withdrawn_at,'acceptance',(select jsonb_build_object('id',a.id,'revisionId',a.revision_id,'snapshotHash',a.snapshot_hash,'signature',a.signature,'acknowledgment',a.acknowledgment,'signedContentHash',a.signed_content_hash,'acceptedAt',a.accepted_at) from public.lk_quote_company_revision_acceptances a where a.revision_id=r.id),'emailStatus',(select o.email_status from public.lk_quote_company_revision_outbox o where o.revision_id=r.id order by o.created_at desc limit 1),'receiptReady',exists(select 1 from public.lk_quote_company_revision_outbox o where o.revision_id=r.id)) end;
$$;
-- Audit links immutable evidence by identity/hash without duplicating contact data, free text or signatures.
create function lk_private.company_revision_audit_summary(r public.lk_quote_company_revisions) returns jsonb language sql stable set search_path='' as $$
 select case when r.id is null then null else jsonb_build_object('revisionId',r.id,'versionNo',r.version_no,'revision',r.revision,'status',r.status,'quantities',r.payload->'quantities','totalCents',r.total_cents,'pricingVersion',r.pricing->>'pricingVersion','baseSubmissionId',r.base_submission_id,'baseSnapshotHash',r.base_snapshot_hash,'baseSignedContentHash',r.base_signed_content_hash,'basedOnRevisionId',r.based_on_revision_id,'snapshotHash',r.snapshot_hash,'payloadHash',public.lk_live_booking_hash(r.payload),'acceptanceId',(select a.id from public.lk_quote_company_revision_acceptances a where a.revision_id=r.id),'signedContentHash',(select a.signed_content_hash from public.lk_quote_company_revision_acceptances a where a.revision_id=r.id)) end;
$$;
create function lk_private.company_revision_state(rid uuid,customer boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare s public.lk_live_quote_submissions;q public.lk_quote_requests;effective public.lk_quote_company_revisions;initial jsonb;result jsonb;eligibility text:=lk_private.company_revision_eligibility(rid);
begin
 select * into s from public.lk_live_quote_submissions where request_id=rid;select * into q from public.lk_quote_requests where id=rid;
 select * into effective from public.lk_quote_company_revisions where request_id=rid and status='accepted' order by version_no desc limit 1;
 result:=jsonb_build_object('requestId',rid,'revision',coalesce((select max(revision) from public.lk_quote_company_revisions where request_id=rid),0),'current',(select lk_private.company_revision_json(r) from public.lk_quote_company_revisions r where r.request_id=rid and (not customer or r.status<>'draft') order by r.version_no desc limit 1),'effectiveAccepted',lk_private.company_revision_json(effective),'acknowledgment',lk_private.company_revision_ack());
 if customer then return result;end if;
 initial:=coalesce(effective.payload,jsonb_build_object('contact',coalesce((select d.payload->'contact' from public.lk_staff_quote_drafts d where d.request_id=rid),q.payload->'contact')- 'consent','quantities',lk_private.company_revision_original_quantities(coalesce(s.snapshot,jsonb_build_object('payload',q.payload))),'extraItems','[]'::jsonb,'customerNote',''));
 return result||jsonb_build_object('eligible',eligibility is null,'eligibilityCode',eligibility,'sourceIssues','[]'::jsonb,'initialPayload',initial,'revisions',(select coalesce(jsonb_agg(lk_private.company_revision_json(r) order by r.version_no desc),'[]'::jsonb) from public.lk_quote_company_revisions r where r.request_id=rid),'audit',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actorUserId',a.actor_id,'actorSessionId',a.actor_session_id,'reason',a.reason,'priorRevision',a.prior_revision,'newRevision',a.new_revision,'details',a.details,'createdAt',a.created_at) order by a.created_at,a.id),'[]'::jsonb) from public.lk_quote_company_revision_audit a where a.request_id=rid),'canWrite',eligibility is null);
end;$$;
create function lk_private.company_revision_mail_valid(mail jsonb,email text) returns boolean language plpgsql immutable set search_path='' as $$
begin
 return coalesce(jsonb_typeof(mail)='object' and length(mail->>'pdfBase64') between 8 and 14000000 and mail->>'pdfHash'=encode(sha256(decode(mail->>'pdfBase64','base64')),'hex') and mail->'payload'->'to'=jsonb_build_array(email) and jsonb_typeof(mail->'payload'->'subject')='string' and length(mail->'payload'->>'subject')>0 and jsonb_typeof(mail->'payload'->'attachments')='array' and jsonb_array_length(mail->'payload'->'attachments')=1 and mail->'payload'->'attachments'->0->>'content'=mail->>'pdfBase64',false);
exception when others then return false;end;$$;
create function lk_private.company_revision_claim_json(o public.lk_quote_company_revision_outbox) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('id',o.id,'requestId',o.request_id,'revisionId',o.revision_id,'kind',o.kind,'leaseToken',o.lease_token,'leaseExpiresAt',o.lease_expires_at,'emailFirstAttemptAt',o.email_first_attempt_at,'emailIdempotencyKey',o.email_idempotency_key,'emailStatus',o.email_status,'frozenMail',jsonb_build_object('pdfBase64',o.pdf_base64,'pdfHash',o.pdf_hash,'payload',o.payload),'revisionSnapshotHash',(select snapshot_hash from public.lk_quote_company_revisions where id=o.revision_id),'acceptanceSignedContentHash',case when o.kind='revision_acceptance_receipt' then (select signed_content_hash from public.lk_quote_company_revision_acceptances where revision_id=o.revision_id) else null end);$$;
create function lk_private.company_revision_worker(command text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.lk_quote_company_revision_outbox;token uuid;rid uuid;nowat timestamptz:=clock_timestamp();
begin
 if command='worker_claim' then
  token:=(args->>'leaseToken')::uuid;if token is null then raise exception using errcode='LK422',message='Worker lease required.';end if;
  select * into o from public.lk_quote_company_revision_outbox x where (args->>'requestId' is null or x.request_id=(args->>'requestId')::uuid) and (x.kind<>'revision_notice' or exists(select 1 from public.lk_quote_company_revisions r where r.id=x.revision_id and r.status='published')) and x.email_status in ('pending','sending','retrying') and x.next_attempt_at<=nowat and (x.lease_expires_at is null or x.lease_expires_at<=nowat) order by x.created_at,x.id for update skip locked limit 1;
  if o.id is null then return null;end if;
  if o.email_first_attempt_at is not null and o.email_first_attempt_at<=nowat-interval '23 hours' then update public.lk_quote_company_revision_outbox set email_status='manual_review',error_code='email_retry_window_expired',lease_token=null,lease_expires_at=null where id=o.id;return null;end if;
  update public.lk_quote_company_revision_outbox set lease_token=token,lease_expires_at=nowat+interval '2 minutes' where id=o.id returning * into o;
  return lk_private.company_revision_claim_json(o);
 end if;
 -- Match staff mutation lock order: request before outbox. This serializes withdrawal with send authorization.
 if command='worker_email_attempt' then
  select request_id into rid from public.lk_quote_company_revision_outbox where id=(args->>'id')::uuid;
  perform 1 from public.lk_quote_requests where id=rid for update;
 end if;
 select * into o from public.lk_quote_company_revision_outbox where id=(args->>'id')::uuid for update;
 if o.id is null or o.lease_token is null or o.lease_expires_at is null or o.lease_token is distinct from (args->>'leaseToken')::uuid or o.lease_expires_at<=nowat or o.email_status in ('provider_accepted','cancelled') then perform lk_private.company_revision_error('worker_lease_changed');end if;
 if command='worker_email_attempt' then
  if o.kind='revision_notice' and not exists(select 1 from public.lk_quote_company_revisions r where r.id=o.revision_id and r.status='published') then perform lk_private.company_revision_error('revision_not_published');end if;
  if o.email_first_attempt_at is not null and o.email_first_attempt_at<=nowat-interval '23 hours' then update public.lk_quote_company_revision_outbox set email_status='manual_review',error_code='email_retry_window_expired',lease_token=null,lease_expires_at=null where id=o.id;return null;end if;
  update public.lk_quote_company_revision_outbox set email_status='sending',email_first_attempt_at=coalesce(email_first_attempt_at,nowat) where id=o.id returning * into o;return lk_private.company_revision_claim_json(o);
 elsif command='worker_email_accepted' then
  if o.email_first_attempt_at is null or length(coalesce(args->>'providerMessageId','')) not between 1 and 500 then raise exception using errcode='LK422',message='Provider acceptance evidence required.';end if;
  update public.lk_quote_company_revision_outbox set email_status='provider_accepted',provider_message_id=args->>'providerMessageId',lease_token=null,lease_expires_at=null,error_code=null where id=o.id;
 elsif command='worker_error' then
  if coalesce(args->>'outcome','') not in ('retrying','manual_review','failed') or length(coalesce(args->>'errorCode','')) not between 1 and 120 then raise exception using errcode='LK422',message='Invalid worker result.';end if;
  update public.lk_quote_company_revision_outbox set email_status=args->>'outcome',error_code=args->>'errorCode',next_attempt_at=nowat+interval '1 minute',lease_token=null,lease_expires_at=null where id=o.id;
 else raise exception using errcode='LK422',message='Unknown revision worker command.';end if;
 select * into o from public.lk_quote_company_revision_outbox where id=o.id;return lk_private.company_revision_claim_json(o);
end;$$;
create function public.lk_quote_company_revision_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;uid uuid;sid uuid;customer boolean:=false;resolved jsonb;q public.lk_quote_requests;s public.lk_live_quote_submissions;r public.lk_quote_company_revisions;effective public.lk_quote_company_revisions;prior public.lk_quote_company_revision_receipts;a public.lk_quote_company_revision_acceptances;
 rev integer;versionno integer;key uuid;fingerprint text;eligibility text;payload jsonb;pricing jsonb;snapshot jsonb;result jsonb;receipt jsonb;oldstate jsonb;mail jsonb;ack jsonb:=lk_private.company_revision_ack();kind text;reason text;allowed text[];
begin
 if command='revision_prepare_publish' then command:='revision_publish';elsif command='customer_prepare_accept' then command:='customer_accept';end if;
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company revision access denied.';end if;
 if command like 'worker_%' then return lk_private.company_revision_worker(command,args);end if;
 if command like 'customer_%' then
  customer:=true;resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
  if resolved->>'hash' is distinct from args->>'ownerHash' or args->'customerAccess'->>'companyId' is distinct from 'lk-group' or args->'customerAccess'->>'requestId' is distinct from args->>'expectedRequestId' then raise exception using errcode='LK403',message='Saved quote access changed.';end if;
  rid:=(args->>'expectedRequestId')::uuid;uid:=(args->'customerAccess'->>'authUserId')::uuid;sid:=(args->'customerAccess'->>'sessionId')::uuid;
  if not exists(select 1 from public.lk_quote_customer_sessions c where c.id=sid and public.lk_quote_customer_auth_session_active(c.auth_session_id,uid)) then raise exception using errcode='LK401',message='Verify your customer email again.';end if;
 else
  uid:=(args->>'actorUserId')::uuid;sid:=(args->>'actorSessionId')::uuid;rid:=(args->>'requestId')::uuid;
  if uid is null or sid is null or not lk_private.company_booking_staff_allowed(uid,sid) then raise exception using errcode='LK403',message='Current company staff required.';end if;
 end if;
 select * into q from public.lk_quote_requests where id=rid and company_id='lk-group' for update;
 if not found then raise exception using errcode='LK404',message='Saved quote not found.';end if;
 select * into s from public.lk_live_quote_submissions where request_id=rid and company_id='lk-group';
 select coalesce(max(revision),0) into rev from public.lk_quote_company_revisions where request_id=rid;
 if command in ('revision_detail','revision_history') then return lk_private.company_revision_state(rid);end if;
 if command='customer_state' then return lk_private.company_revision_state(rid,true);end if;
 if command='revision_source' and not customer then return q.payload;end if;
 if command in ('revision_receipt','customer_receipt') then
  select * into prior from public.lk_quote_company_revision_receipts where request_id=rid and idempotency_key=(args->>'idempotencyKey')::uuid;
  if prior.request_id is null or prior.actor_id<>uid or prior.actor_session_id<>sid then raise exception using errcode='LK404',message='Command not found.';end if;return prior.response;
 end if;
 if command in ('customer_document','revision_document') then
  return (select jsonb_build_object('pdfBase64',o.pdf_base64,'pdfHash',o.pdf_hash) from public.lk_quote_company_revision_outbox o where o.revision_id=(args->>'revisionId')::uuid and o.request_id=rid and o.kind=case args->>'kind' when 'acceptance' then 'revision_acceptance_receipt' else 'revision_notice' end);
 end if;
 if command='customer_review' then
  select * into r from public.lk_quote_company_revisions where request_id=rid and id=(args->>'revisionId')::uuid;
  if r.id is null or r.status<>'published' then perform lk_private.company_revision_error('revision_not_published',rev);end if;
  if r.snapshot_hash is distinct from args->>'snapshotHash' then perform lk_private.company_revision_error('revision_snapshot_changed',rev);end if;
  return jsonb_build_object('state',lk_private.company_revision_state(rid,true),'revision',lk_private.company_revision_json(r),'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash);
 end if;
 if command not in ('revision_save','revision_publish','revision_withdraw','customer_accept') then raise exception using errcode='LK422',message='Unknown company revision command.';end if;
 allowed:=case when customer then array['companyId','ownerHash','expectedRequestId','customerAccess','revisionId','expectedRevision','idempotencyKey','acknowledgmentVersion','acknowledged','signature','snapshotHash','proofExpiresAt','frozenMail'] else array['companyId','actorUserId','actorSessionId','requestId','revisionId','expectedRevision','idempotencyKey','reason','payload','snapshotHash','frozenMail'] end;
 if exists(select 1 from jsonb_object_keys(args) k where k<>all(allowed)) then raise exception using errcode='LK422',message='Unexpected company revision fields.';end if;
 if jsonb_typeof(args->'expectedRevision') is distinct from 'number' or coalesce(args->>'expectedRevision','')!~'^[0-9]{1,9}$' or coalesce(args->>'idempotencyKey','')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK422',message='A current revision and retry key are required.';end if;
 key:=(args->>'idempotencyKey')::uuid;
 fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',command,'args',args-array['companyId','actorUserId','actorSessionId','ownerHash','customerAccess','frozenMail','proofExpiresAt']-case when customer then array[]::text[] else array['snapshotHash'] end));
 select * into prior from public.lk_quote_company_revision_receipts where request_id=rid and idempotency_key=key;
 if prior.request_id is not null then
  if prior.command<>command or prior.command_hash<>fingerprint or prior.actor_id<>uid or prior.actor_session_id<>sid then perform lk_private.company_revision_error('idempotency_conflict',rev);end if;return prior.response;
 end if;
 eligibility:=lk_private.company_revision_eligibility(rid);if eligibility is not null then perform lk_private.company_revision_error(eligibility,rev);end if;
 if (args->>'expectedRevision')::integer<>rev then perform lk_private.company_revision_error('revision_conflict',rev);end if;
 reason:=case when customer then 'Customer explicitly accepted revised booking-request quote.' else btrim(args->>'reason') end;
 if reason is null or length(reason) not between 1 and 1000 or reason~'[\x00-\x1f\x7f]' then raise exception using errcode='LK422',message='A command reason is required.';end if;
 select * into effective from public.lk_quote_company_revisions where request_id=rid and status='accepted' order by version_no desc limit 1;
 if command='revision_save' then
  select * into r from public.lk_quote_company_revisions where request_id=rid and status in ('draft','published') for update;
  if r.status='published' then perform lk_private.company_revision_error('revision_published',rev);end if;
  payload:=args->'payload';pricing:=lk_private.company_revision_pricing(payload);
  if not lk_private.staff_quote_payload_against_source_valid(jsonb_build_object('contact',payload->'contact','service',null,'internalNotes',''),q.payload) then raise exception using errcode='LK422',message='Correct changed contact fields.';end if;
  oldstate:=lk_private.company_revision_audit_summary(r);
  if r.id is null then
   select coalesce(max(version_no),0)+1 into versionno from public.lk_quote_company_revisions where request_id=rid;
   insert into public.lk_quote_company_revisions(company_id,request_id,version_no,revision,base_submission_id,base_snapshot_hash,base_signed_content_hash,based_on_revision_id,status,payload,pricing,total_cents,comparison,acknowledgment,created_by,updated_by) values('lk-group',rid,versionno,rev+1,s.id,s.snapshot_hash,s.signed_content_hash,effective.id,'draft',payload,pricing,(pricing->>'total')::bigint,lk_private.company_revision_comparison(s,payload,pricing),ack,uid,uid) returning * into r;
  else
   update public.lk_quote_company_revisions x set payload=args->'payload',pricing=lk_private.company_revision_pricing(args->'payload'),total_cents=(lk_private.company_revision_pricing(args->'payload')->>'total')::bigint,comparison=lk_private.company_revision_comparison(s,args->'payload',lk_private.company_revision_pricing(args->'payload')),revision=rev+1,updated_by=uid,updated_at=clock_timestamp() where x.id=r.id returning * into r;
  end if;
 else
  select * into r from public.lk_quote_company_revisions where request_id=rid and id=(args->>'revisionId')::uuid for update;
  if r.id is null then raise exception using errcode='LK404',message='Company revision not found.';end if;
  oldstate:=lk_private.company_revision_audit_summary(r);
  if command='revision_publish' then
   if r.status<>'draft' then perform lk_private.company_revision_error('revision_published',rev);end if;
   if not lk_private.staff_quote_payload_strict_valid(jsonb_build_object('contact',r.payload->'contact','service',null,'internalNotes','')) then raise exception using errcode='LK422',message='Correct all contact fields before publication.';end if;
   snapshot:=lk_private.company_revision_snapshot(r);
   if args->'frozenMail' is not null and args->>'snapshotHash' is distinct from public.lk_live_booking_hash(snapshot) then perform lk_private.company_revision_error('revision_snapshot_changed',rev);end if;
   if args->'frozenMail' is null then return jsonb_build_object('prepared',true,'revision',lk_private.company_revision_json(r),'snapshot',snapshot,'snapshotHash',public.lk_live_booking_hash(snapshot),'recipientEmail',s.verified_email,'reference',s.reference);end if;
   mail:=args->'frozenMail';kind:='revision_notice';
   if not lk_private.company_revision_mail_valid(mail,s.verified_email) then raise exception using errcode='LK422',message='Frozen revision notice is invalid.';end if;
   update public.lk_quote_company_revisions set status='published',snapshot=lk_private.company_revision_snapshot(r),snapshot_hash=public.lk_live_booking_hash(lk_private.company_revision_snapshot(r)),revision=rev+1,published_at=clock_timestamp(),published_by=uid,updated_at=clock_timestamp(),updated_by=uid where id=r.id returning * into r;
  elsif command='revision_withdraw' then
   if r.status<>'published' then perform lk_private.company_revision_error('revision_not_published',rev);end if;
   update public.lk_quote_company_revisions set status='withdrawn',revision=rev+1,withdrawn_at=clock_timestamp(),withdrawn_by=uid,updated_at=clock_timestamp(),updated_by=uid where id=r.id returning * into r;
   update public.lk_quote_company_revision_outbox set email_status='cancelled',error_code='revision_withdrawn',lease_token=null,lease_expires_at=null where lk_quote_company_revision_outbox.revision_id=r.id and lk_quote_company_revision_outbox.kind='revision_notice' and email_first_attempt_at is null and email_status<>'provider_accepted';
  else
   if r.status<>'published' then perform lk_private.company_revision_error('revision_not_published',rev);end if;
   if args->>'snapshotHash' is distinct from r.snapshot_hash then perform lk_private.company_revision_error('revision_snapshot_changed',rev);end if;
   if args->>'proofExpiresAt' is null or (args->>'proofExpiresAt')::timestamptz<=clock_timestamp() or (args->>'proofExpiresAt')::timestamptz>clock_timestamp()+interval '15 minutes 5 seconds' then perform lk_private.company_revision_error('review_proof_expired',rev);end if;
   if args->>'acknowledgmentVersion' is distinct from ack->>'version' or args->'acknowledged' is distinct from 'true'::jsonb or not public.lk_live_booking_signature_valid(args->'signature') then raise exception using errcode='LK422',message='A new signature and explicit revision acknowledgment are required.';end if;
   if args->'frozenMail' is null then return jsonb_build_object('prepared',true,'revision',lk_private.company_revision_json(r),'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash,'recipientEmail',s.verified_email,'reference',s.reference,'signedContentHash',public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',args->'signature','ack',ack)));end if;
   mail:=args->'frozenMail';kind:='revision_acceptance_receipt';
   if not lk_private.company_revision_mail_valid(mail,s.verified_email) then raise exception using errcode='LK422',message='Frozen revision acceptance receipt is invalid.';end if;
   insert into public.lk_quote_company_revision_acceptances(company_id,request_id,revision_id,auth_user_id,verified_email,snapshot_hash,signature,acknowledgment,signed_content_hash) values('lk-group',rid,r.id,uid,args->'customerAccess'->>'email',r.snapshot_hash,args->'signature',ack,public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',args->'signature','ack',ack))) returning * into a;
   update public.lk_quote_company_revisions set status='superseded' where request_id=rid and status='accepted';
   update public.lk_quote_company_revisions set status='accepted',revision=rev+1,accepted_at=a.accepted_at,updated_at=clock_timestamp(),updated_by=uid where id=r.id returning * into r;
  end if;
 end if;
 if kind is not null then insert into public.lk_quote_company_revision_outbox(request_id,revision_id,kind,email_idempotency_key,pdf_base64,pdf_hash,payload) values(rid,r.id,kind,'company-revision:'||r.id::text||':'||kind||':v1',mail->>'pdfBase64',mail->>'pdfHash',mail->'payload');end if;
 receipt:=jsonb_build_object('idempotencyKey',key,'entityType','company_revision','entityId',rid,'childId',r.id,'action',command,'revision',rev+1,'committedAt',clock_timestamp());
 insert into public.lk_quote_company_revision_audit(request_id,revision_id,action,actor_id,actor_session_id,reason,prior_revision,new_revision,details) values(rid,r.id,command,uid,sid,reason,rev,rev+1,jsonb_build_object('prior',oldstate,'new',lk_private.company_revision_audit_summary(r)));
 result:=jsonb_build_object(case when customer then 'state' else 'detail' end,lk_private.company_revision_state(rid,customer),'receipt',receipt);
 insert into public.lk_quote_company_revision_receipts(request_id,idempotency_key,command,command_hash,actor_id,actor_session_id,response) values(rid,key,command,fingerprint,uid,sid,result);return result;
end;$$;
-- Keep the established calendar/occupancy transaction; replace only its immutable price evidence.
alter function public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb) rename to company_revision_original_simple_snapshot;
alter function public.company_revision_original_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb) set schema lk_private;
create function public.lk_live_company_simple_snapshot(s public.lk_live_quote_submissions,args jsonb,target jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;r public.lk_quote_company_revisions;a public.lk_quote_company_revision_acceptances;
begin
 result:=lk_private.company_revision_original_simple_snapshot(s,args,target);
 select * into r from public.lk_quote_company_revisions where request_id=s.request_id and status='accepted' order by version_no desc limit 1;
 if r.id is null then return result;end if;
 select * into a from public.lk_quote_company_revision_acceptances where revision_id=r.id;
 if a.id is null or a.snapshot_hash<>r.snapshot_hash or a.signed_content_hash<>public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',a.signature,'ack',a.acknowledgment)) then perform lk_private.company_revision_error('revision_acceptance_invalid');end if;
 return result||jsonb_build_object('confirmationBasis','accepted_revision','companyRevisionId',r.id,'companyRevisionSnapshotHash',r.snapshot_hash,'companyRevisionAcceptanceId',a.id,'companyRevisionSignedContentHash',a.signed_content_hash,'companyRevisionSignature',a.signature,'companyRevisionAcknowledgment',a.acknowledgment,'contact',r.payload->'contact','quantities',r.payload->'quantities','extraItems',r.payload->'extraItems','customerNote',r.payload->'customerNote','pricing',r.pricing,'amountExGst',r.total_cents,'gst',0,'total',r.total_cents,'priceKind','accepted_company_revision','scope',(r.payload->'quantities'->>'doorCount')||' cabinet doors, '||(r.payload->'quantities'->>'drawerCount')||' drawer fronts'||case when lk_private.staff_quote_trim(coalesce(r.payload->>'customerNote',''))<>'' then E'\n'||lk_private.staff_quote_trim(r.payload->>'customerNote') else '' end,'adjustmentReason','Explicitly accepted company revision; original signed booking request retained.');
end;$$;
alter table public.lk_live_company_bookings drop constraint lk_live_company_bookings_confirmation_basis_check,drop constraint lk_live_company_confirmation_evidence;
alter table public.lk_live_company_bookings add column company_revision_id uuid references public.lk_quote_company_revisions(id),add column company_revision_acceptance_id uuid references public.lk_quote_company_revision_acceptances(id),add column company_revision_snapshot_hash text,add column company_revision_signed_content_hash text;
alter table public.lk_live_company_bookings add constraint lk_live_company_bookings_confirmation_basis_check check(confirmation_basis in ('customer_proposal','signed_request','accepted_revision')),
 add constraint lk_live_company_confirmation_evidence check((confirmation_basis='customer_proposal' and acceptance_id is not null and signed_submission_id is null and company_revision_id is null and company_revision_acceptance_id is null and company_revision_snapshot_hash is null and company_revision_signed_content_hash is null) or (confirmation_basis='signed_request' and acceptance_id is null and signed_submission_id is not null and company_revision_id is null and company_revision_acceptance_id is null and company_revision_snapshot_hash is null and company_revision_signed_content_hash is null) or (confirmation_basis='accepted_revision' and acceptance_id is null and signed_submission_id is not null and company_revision_id is not null and company_revision_acceptance_id is not null and company_revision_snapshot_hash~'^[a-f0-9]{64}$' and company_revision_signed_content_hash~'^[a-f0-9]{64}$'));
create function lk_private.company_revision_booking_evidence() returns trigger language plpgsql set search_path='' as $$
declare p public.lk_live_company_proposals;r public.lk_quote_company_revisions;a public.lk_quote_company_revision_acceptances;
begin
 if tg_op='UPDATE' then
  if (new.company_revision_id,new.company_revision_acceptance_id,new.company_revision_snapshot_hash,new.company_revision_signed_content_hash,new.confirmation_basis,new.signed_submission_id) is distinct from (old.company_revision_id,old.company_revision_acceptance_id,old.company_revision_snapshot_hash,old.company_revision_signed_content_hash,old.confirmation_basis,old.signed_submission_id) then raise exception using errcode='LK409',message='Booking confirmation evidence is immutable.';end if;return new;
 end if;
 select * into p from public.lk_live_company_proposals where id=new.proposal_id;
 if p.snapshot->>'confirmationBasis'='accepted_revision' then
  select * into r from public.lk_quote_company_revisions where id=(p.snapshot->>'companyRevisionId')::uuid and request_id=new.request_id and status='accepted';
  select * into a from public.lk_quote_company_revision_acceptances where revision_id=r.id;
  if r.id is null or a.id is null or p.snapshot->>'companyRevisionAcceptanceId' is distinct from a.id::text or p.snapshot->>'companyRevisionSnapshotHash' is distinct from r.snapshot_hash or p.snapshot->>'companyRevisionSignedContentHash' is distinct from a.signed_content_hash or (p.snapshot->>'total')::bigint<>r.total_cents or p.snapshot->'pricing' is distinct from r.pricing then perform lk_private.company_revision_error('revision_acceptance_invalid');end if;
  new.confirmation_basis:='accepted_revision';new.company_revision_id:=r.id;new.company_revision_acceptance_id:=a.id;new.company_revision_snapshot_hash:=r.snapshot_hash;new.company_revision_signed_content_hash:=a.signed_content_hash;
 elsif new.confirmation_basis='accepted_revision' then perform lk_private.company_revision_error('revision_acceptance_invalid');
 end if;return new;
end;$$;
create trigger company_revision_booking_evidence before insert or update on public.lk_live_company_bookings for each row execute function lk_private.company_revision_booking_evidence();
alter function public.lk_live_company_booking_json(public.lk_live_company_bookings) rename to company_revision_original_booking_json;
alter function public.company_revision_original_booking_json(public.lk_live_company_bookings) set schema lk_private;
create function public.lk_live_company_booking_json(b public.lk_live_company_bookings) returns jsonb language sql stable set search_path='' as $$select lk_private.company_revision_original_booking_json(b)||jsonb_build_object('companyRevisionId',b.company_revision_id,'companyRevisionAcceptanceId',b.company_revision_acceptance_id,'companyRevisionSnapshotHash',b.company_revision_snapshot_hash,'companyRevisionSignedContentHash',b.company_revision_signed_content_hash);$$;
alter function public.lk_live_company_booking_command(text,jsonb) rename to company_revision_original_booking_command;
alter function public.company_revision_original_booking_command(text,jsonb) set schema lk_private;
create function public.lk_live_company_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company booking access denied.';end if;
 if command in ('staff_prepare_request','staff_confirm_request') then
  if not lk_private.company_booking_staff_allowed((args->>'actorUserId')::uuid,(args->>'actorSessionId')::uuid) then raise exception using errcode='LK403',message='Current company staff required.';end if;
  rid:=(args->>'requestId')::uuid;perform 1 from public.lk_quote_requests where id=rid and company_id='lk-group' for update;
  -- A committed confirmation replay is already fixed and may bypass only this new-publication gate.
  if not exists(select 1 from public.lk_live_company_command_receipts where request_id=rid and idempotency_key=(args->>'idempotencyKey')::uuid) and exists(select 1 from public.lk_quote_company_revisions where request_id=rid and status='published') then perform lk_private.company_revision_error('revision_awaiting_customer');end if;
 end if;
 return lk_private.company_revision_original_booking_command(command,args);
end;$$;
-- Capture the actual INSERT RETURNING booking evidence; immutable audit rows are never repaired later.
do $$declare definition text;needle text:='jsonb_build_object(''proposalId'',p.id,''proposalHash'',p.snapshot_hash,''signedSubmissionId'',s.id,''signedContentHash'',s.signed_content_hash,''confirmationBasis'',''signed_request'')';replacement text:='jsonb_build_object(''proposalId'',p.id,''proposalHash'',p.snapshot_hash,''signedSubmissionId'',s.id,''signedContentHash'',coalesce(b.company_revision_signed_content_hash,s.signed_content_hash),''originalSignedContentHash'',s.signed_content_hash,''originalSnapshotHash'',s.snapshot_hash,''confirmationBasis'',b.confirmation_basis,''companyRevisionId'',b.company_revision_id,''companyRevisionSnapshotHash'',b.company_revision_snapshot_hash,''companyRevisionAcceptanceId'',b.company_revision_acceptance_id,''companyRevisionSignedContentHash'',b.company_revision_signed_content_hash)';begin
 select pg_get_functiondef('lk_private.lk_live_company_booking_command_r3a_base(text,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'R3b expected exactly one signed-request confirmation audit insertion';end if;
 execute replace(definition,needle,replacement);
end;$$;
-- R3a cancellation keeps its complete target/manifest/lease predicates. Only the new evidence basis joins the same allowed workflow.
do $$declare definition text;needle text:='b.confirmation_basis<>''signed_request''';begin
 select pg_get_functiondef('public.lk_current_work_command(text,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'R3b expected exactly one cancellation basis predicate';end if;
 execute replace(definition,needle,'b.confirmation_basis not in (''signed_request'',''accepted_revision'')');
end;$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lk_private' and (p.proname like 'company_revision_%') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end;$$;
revoke all on function public.lk_quote_company_revision_command(text,jsonb),public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb),public.lk_live_company_booking_json(public.lk_live_company_bookings),public.lk_live_company_booking_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lk_quote_company_revision_command(text,jsonb),public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb),public.lk_live_company_booking_json(public.lk_live_company_bookings),public.lk_live_company_booking_command(text,jsonb) to service_role;

-- ===== verification
do $lk$ declare t record; n bigint; h text; ex text[]; checked int := 0; begin
  for t in select * from lk_rollout_pre order by tbl loop
    ex := case t.tbl
      when 'lk_customers' then array['status','archived_at']
      when 'lk_quote_requests' then array['property_id','crm_revision']
      when 'lk_live_company_bookings' then array['company_revision_id','company_revision_acceptance_id','company_revision_signed_content_hash','company_revision_snapshot_hash']
      else array[]::text[] end;
    execute format('select count(*), coalesce(md5(string_agg(md5((to_jsonb(x) - %L::text[])::text), '''' order by md5((to_jsonb(x) - %L::text[])::text))), '''') from public.%I x', ex, ex, t.tbl) into n, h;
    if n <> t.n or h <> t.h then raise exception 'Rollout aborted: existing rows changed in % (% -> % rows)', t.tbl, t.n, n; end if;
    checked := checked + 1;
  end loop;
  if checked < 51 then raise exception 'Rollout aborted: only % existing tables were checked', checked; end if;
  if exists (select 1 from pg_tables where schemaname='public' and tablename like 'lk\_%' and not rowsecurity) then raise exception 'Rollout aborted: a public lk_ table has RLS disabled'; end if;
end $lk$;
commit;
