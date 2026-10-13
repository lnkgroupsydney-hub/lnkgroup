-- R2 additive CRM. One company-scoped lock serializes CRM identity/relation writes
-- (deliberately conservative throughput for this small private register).
begin;
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
commit;
