-- Staff work copies never overwrite enquiry, quote, signature or frozen document content.
begin;
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
commit;
