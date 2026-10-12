-- Verified live provisional estimate approval and nonbinding request submissions.
-- Pending requests never reserve dates. Existing demo/issued quote records stay unchanged.
begin;
create table public.lk_live_quote_approvals (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),request_id uuid not null,
 auth_user_id uuid not null,verified_email text not null,version integer not null check(version>0),analysis_id uuid not null,
 input_revision integer not null,source_snapshot jsonb not null,snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),approved_at timestamptz not null default now(),
 preferred_date date,selection_revision integer not null default 0 check(selection_revision>=0),availability_revision text,availability_checked_at timestamptz,
 unique(company_id,request_id,version),foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id),
 foreign key(analysis_id) references public.lk_quote_analysis_jobs(id)
);
create table public.lk_live_quote_submissions (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),request_id uuid not null,
 approval_id uuid not null unique references public.lk_live_quote_approvals(id),reference text not null unique,
 auth_user_id uuid not null,verified_email text not null,preferred_date date not null,selection_revision integer not null,
 snapshot jsonb not null,snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),signature jsonb not null,
 signed_content_hash text not null check(signed_content_hash ~ '^[a-f0-9]{64}$'),submitted_at timestamptz not null default now(),
 email_status text not null default 'pending' check(email_status in ('pending','sending','provider_accepted','retrying','failed','outcome_unknown','manual_review')),
 calendar_status text not null default 'blocked' check(calendar_status in ('blocked','pending','syncing','synced','retrying','conflict','manual_review')),
 error text,provider_message_id text,calendar_event_id text,calendar_event_etag text,
 lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default now(),attempts integer not null default 0,
 email_first_attempt_at timestamptz,email_idempotency_key text not null unique,
 pdf_base64 text,pdf_hash text,send_payload jsonb,receipt_frozen_at timestamptz,
 foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id),unique(company_id,request_id),
 check(calendar_status='blocked' or email_status='provider_accepted'),
 check(email_status<>'provider_accepted' or provider_message_id is not null),
 check(calendar_status<>'synced' or (calendar_event_id is not null and calendar_event_etag is not null)),
 check((pdf_base64 is null and pdf_hash is null and send_payload is null and receipt_frozen_at is null) or
       (pdf_base64 is not null and pdf_hash ~ '^[a-f0-9]{64}$' and jsonb_typeof(send_payload)='object' and receipt_frozen_at is not null))
);
create index lk_live_quote_submissions_outbox on public.lk_live_quote_submissions(next_attempt_at,submitted_at) where email_status in ('pending','sending','retrying','outcome_unknown') or (email_status='provider_accepted' and calendar_status in ('pending','syncing','retrying'));
create table public.lk_live_quote_booking_receipts (
 company_id text not null check(company_id='lk-group'),request_id uuid not null,auth_user_id uuid not null,idempotency_key uuid not null,
 command_hash text not null,result_json jsonb not null,created_at timestamptz not null default now(),
 primary key(company_id,request_id,auth_user_id,idempotency_key),foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id)
);
-- Reserved for a separately authorised final-confirmation implementation. No command in this migration creates a segment.
create table public.lk_live_booking_confirmed_segments (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),submission_id uuid not null references public.lk_live_quote_submissions(id),
 account_sub text not null,calendar_id text not null,start_date date not null,end_date date not null check(end_date>start_date),
 confirmation_version integer not null check(confirmation_version>0),created_at timestamptz not null default now()
);
alter table public.lk_live_quote_approvals enable row level security;
alter table public.lk_live_quote_submissions enable row level security;
alter table public.lk_live_quote_booking_receipts enable row level security;
alter table public.lk_live_booking_confirmed_segments enable row level security;
revoke all on public.lk_live_quote_approvals,public.lk_live_quote_submissions,public.lk_live_quote_booking_receipts,public.lk_live_booking_confirmed_segments from public,anon,authenticated,service_role;
grant select,insert,update on public.lk_live_quote_approvals,public.lk_live_quote_submissions to service_role;
grant select,insert on public.lk_live_quote_booking_receipts to service_role;
grant select on public.lk_live_booking_confirmed_segments to service_role;

create function public.lk_live_booking_ack() returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('version','live-booking-request-ack-v1','text','I acknowledge the provisional photo-based painting estimate and request the preferred start date shown here. Exact quantities, materials, repairs, scope, final price and work duration require company review and site confirmation. This request does not reserve a date, confirm a booking, authorise work, create a contract or require payment. Final terms and any confirmed booking require a separate company proposal and my acceptance.');
$$;
create function public.lk_live_booking_hash(value jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(value::text,'UTF8')),'hex');
$$;
create function public.lk_live_booking_manifest(r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'role',p.role,'contentHash',p.content_hash,'objectPath',p.object_path,'width',p.width,'height',p.height,'storedBytes',p.stored_bytes) order by p.id),'[]'::jsonb) from public.lk_live_quote_photos p where p.company_id=r.company_id and p.request_id=r.id and p.state='ready';
$$;
create function public.lk_live_booking_source_current(r public.lk_quote_requests,a public.lk_live_quote_approvals) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.lk_quote_analysis_jobs j where j.company_id=r.company_id and j.request_id=r.id and j.id=a.analysis_id
 and j.id=(select latest.id from public.lk_quote_analysis_jobs latest where latest.company_id=r.company_id and latest.request_id=r.id order by latest.created_at desc,latest.id desc limit 1)
 and j.status='succeeded' and j.input_revision=r.revision and a.input_revision=r.revision
 and a.source_snapshot->'payload'=r.payload and j.input_snapshot->'service'=r.payload->'service'
 and j.input_snapshot->'photos'=public.lk_live_booking_manifest(r)
 and a.source_snapshot->'inputSnapshot'=j.input_snapshot and a.source_snapshot->'analysis'=j.analysis and a.source_snapshot->'pricing'=j.pricing
 and not exists(select 1 from public.lk_live_quote_photos p where p.company_id=r.company_id and p.request_id=r.id and p.state='uploading'));
$$;
create function public.lk_live_booking_approval_json(a public.lk_live_quote_approvals,r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',a.id,'version',a.version,'analysisId',a.analysis_id,'inputRevision',a.input_revision,'approvedAt',a.approved_at,'snapshot',a.source_snapshot,'snapshotHash',a.snapshot_hash,'stale',not public.lk_live_booking_source_current(r,a),'preferredDate',a.preferred_date,'selectionRevision',a.selection_revision,'availabilityRevision',a.availability_revision);
$$;
create function public.lk_live_booking_submission_json(s public.lk_live_quote_submissions) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',s.id,'reference',s.reference,'requestId',s.request_id,'approvalId',s.approval_id,'submittedAt',s.submitted_at,'preferredDate',s.preferred_date,'snapshot',s.snapshot,'snapshotHash',s.snapshot_hash,'signedContentHash',s.signed_content_hash,'signature',s.signature,'emailStatus',s.email_status,'calendarStatus',s.calendar_status,'error',s.error,'receiptReady',s.pdf_base64 is not null,'providerMessageId',s.provider_message_id,'calendarEventId',s.calendar_event_id);
$$;
create function public.lk_live_booking_state(r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'verified',exists(select 1 from public.lk_quote_request_access x where x.company_id=r.company_id and x.request_id=r.id and x.revoked_at is null),
 'canEdit',not exists(select 1 from public.lk_live_quote_submissions s where s.company_id=r.company_id and s.request_id=r.id),
 'approval',(select public.lk_live_booking_approval_json(a,r) from public.lk_live_quote_approvals a where a.company_id=r.company_id and a.request_id=r.id order by a.version desc limit 1),
 'submission',(select public.lk_live_booking_submission_json(s) from public.lk_live_quote_submissions s where s.company_id=r.company_id and s.request_id=r.id),'acknowledgment',public.lk_live_booking_ack());
$$;
create function public.lk_live_booking_claim_json(s public.lk_live_quote_submissions) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('submission',public.lk_live_booking_submission_json(s),'leaseToken',s.lease_token,'leaseExpiresAt',s.lease_expires_at,'emailIdempotencyKey',s.email_idempotency_key,'emailFirstAttemptAt',s.email_first_attempt_at,
 'frozenReceipt',case when s.pdf_base64 is null then null else jsonb_build_object('pdfBase64',s.pdf_base64,'pdfHash',s.pdf_hash,'payload',s.send_payload) end);
$$;
create function public.lk_live_booking_signature_valid(value jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare stroke jsonb;point jsonb;countpoints integer:=0;visible boolean:=false;minx numeric:=1;maxx numeric:=0;miny numeric:=1;maxy numeric:=0;method text:=value->>'method';
begin
 if jsonb_typeof(value) is distinct from 'object' or (select count(*) from jsonb_object_keys(value))<>4 or not value ?& array['name','method','strokes','acknowledged'] or jsonb_typeof(value->'name') is distinct from 'string' or length(btrim(value->>'name')) not between 1 and 120 or value->>'name' ~ '[[:cntrl:]]' or value->'acknowledged' is distinct from 'true'::jsonb or coalesce(method,'') not in ('typed','drawn') or jsonb_typeof(value->'strokes') is distinct from 'array' or jsonb_array_length(value->'strokes')>100 then return false; end if;
 for stroke in select * from jsonb_array_elements(value->'strokes') loop
  if jsonb_typeof(stroke) is distinct from 'array' or jsonb_array_length(stroke)<2 then return false; end if;
  countpoints:=countpoints+jsonb_array_length(stroke);if countpoints>2000 then return false;end if;
  for point in select * from jsonb_array_elements(stroke) loop
   if jsonb_typeof(point) is distinct from 'object' or (select count(*) from jsonb_object_keys(point))<>2 or not point ?& array['x','y'] or jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number' or (point->>'x')::numeric not between 0 and 1 or (point->>'y')::numeric not between 0 and 1 then return false;end if;
   minx:=least(minx,(point->>'x')::numeric);maxx:=greatest(maxx,(point->>'x')::numeric);miny:=least(miny,(point->>'y')::numeric);maxy:=greatest(maxy,(point->>'y')::numeric);
   if point is distinct from stroke->0 then visible:=true;end if;
  end loop;
 end loop;
 return (method='typed' and countpoints=0) or (method='drawn' and countpoints>=4 and visible and greatest(maxx-minx,maxy-miny)>=0.02);
exception when others then return false;
end;
$$;
-- Snapshot/acknowledgment/signature and first frozen outgoing bytes cannot be rewritten by a delivery update.
create function public.lk_live_booking_immutable_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='lk_live_quote_approvals' then
  if (to_jsonb(new)-'preferred_date'-'selection_revision'-'availability_revision'-'availability_checked_at') is distinct from (to_jsonb(old)-'preferred_date'-'selection_revision'-'availability_revision'-'availability_checked_at') then raise exception using errcode='LK409',message='An approved source snapshot is immutable.';end if;
 else
  if (to_jsonb(new)-array['email_status','calendar_status','error','provider_message_id','calendar_event_id','calendar_event_etag','lease_token','lease_expires_at','next_attempt_at','attempts','email_first_attempt_at','pdf_base64','pdf_hash','send_payload','receipt_frozen_at']) is distinct from (to_jsonb(old)-array['email_status','calendar_status','error','provider_message_id','calendar_event_id','calendar_event_etag','lease_token','lease_expires_at','next_attempt_at','attempts','email_first_attempt_at','pdf_base64','pdf_hash','send_payload','receipt_frozen_at']) then raise exception using errcode='LK409',message='A signed booking request is immutable.';end if;
  if old.pdf_base64 is not null and (new.pdf_base64 is distinct from old.pdf_base64 or new.pdf_hash is distinct from old.pdf_hash or new.send_payload is distinct from old.send_payload or new.receipt_frozen_at is distinct from old.receipt_frozen_at) then raise exception using errcode='LK409',message='The receipt and outgoing email are already frozen.';end if;
  if old.email_first_attempt_at is not null and new.email_first_attempt_at is distinct from old.email_first_attempt_at then raise exception using errcode='LK409',message='The first email attempt is immutable.';end if;
  if old.email_status='provider_accepted' and (new.email_status<>'provider_accepted' or new.provider_message_id is distinct from old.provider_message_id) then raise exception using errcode='LK409',message='Provider acceptance is immutable.';end if;
 end if;
 return new;
end;
$$;
create trigger lk_live_quote_approval_immutable before update on public.lk_live_quote_approvals for each row execute function public.lk_live_booking_immutable_guard();
create trigger lk_live_quote_submission_immutable before update on public.lk_live_quote_submissions for each row execute function public.lk_live_booking_immutable_guard();

create function public.lk_live_quote_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare company text:=args->>'companyId';owner text:=args->>'ownerHash';resolved jsonb;r public.lk_quote_requests;a public.lk_live_quote_approvals;s public.lk_live_quote_submissions;j public.lk_quote_analysis_jobs;
 receipt public.lk_live_quote_booking_receipts;target jsonb;manifest jsonb;snapshot jsonb;result jsonb;fingerprint text;key uuid;uid uuid;sid uuid;datevalue date;signature jsonb;versionvalue integer;pdf bytea;claimskipped integer:=0;
begin
 if company is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company access denied.';end if;
 if command='occupancy' then
  if coalesce(args->>'accountSub','')='' or coalesce(args->>'calendarId','')='' then raise exception using errcode='LK400',message='Calendar target required.';end if;
  return jsonb_build_object('segments',(select coalesce(jsonb_agg(jsonb_build_object('startDate',x.start_date,'endDate',x.end_date) order by x.start_date),'[]'::jsonb) from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=args->>'accountSub' and x.calendar_id=args->>'calendarId'));
 end if;
 if command like 'delivery_%' then
  if command='delivery_claim' then
   if coalesce(args->>'leaseToken','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Delivery lease required.';end if;
   loop
   select * into s from public.lk_live_quote_submissions x where x.company_id=company and (args->>'id' is null or x.id=(args->>'id')::uuid)
   and x.next_attempt_at<=now() and (x.lease_expires_at is null or x.lease_expires_at<=now()) and
   (x.email_status in ('pending','sending','retrying','outcome_unknown') or x.email_status='provider_accepted' and x.calendar_status in ('pending','syncing','retrying')) order by x.next_attempt_at,x.submitted_at for update skip locked limit 1;
   if not found then return 'null'::jsonb;end if;
   if s.email_status<>'provider_accepted' and s.email_first_attempt_at<=now()-interval '24 hours' then
    update public.lk_live_quote_submissions set email_status='manual_review',error='The original email attempt requires provider review before another send.',lease_token=null,lease_expires_at=null where id=s.id;
    claimskipped:=claimskipped+1;
    if claimskipped>=10 then return 'null'::jsonb;end if;
    continue;
   end if;
   exit;
   end loop;
   update public.lk_live_quote_submissions set lease_token=(args->>'leaseToken')::uuid,lease_expires_at=now()+interval '4 minutes',attempts=attempts+1,
    email_status=case when email_status='provider_accepted' then email_status else 'sending' end,
    calendar_status=case when email_status='provider_accepted' then 'syncing' else calendar_status end,error=null where id=s.id returning * into s;
   return public.lk_live_booking_claim_json(s);
  end if;
  select * into s from public.lk_live_quote_submissions x where x.company_id=company and x.id=(args->>'id')::uuid for update;
  if not found then raise exception using errcode='LK404',message='Booking request not found.';end if;
  if s.lease_token is distinct from (args->>'leaseToken')::uuid or s.lease_expires_at<=now() or s.lease_token is null then raise exception using errcode='LK409',message='Delivery lease expired or changed.';end if;
  if command='delivery_freeze' then
   if jsonb_typeof(args->'payload') is distinct from 'object' or octet_length((args->'payload')::text)>1500000 or coalesce(args->>'pdfBase64','')='' or length(args->>'pdfBase64')>1000000 then raise exception using errcode='LK400',message='Invalid private receipt.';end if;
   if args->'payload'->>'to' is distinct from s.verified_email and args->'payload'->'to' is distinct from jsonb_build_array(s.verified_email) then raise exception using errcode='LK403',message='Receipt recipient must be the verified customer email.';end if;
   pdf:=decode(args->>'pdfBase64','base64');
   if octet_length(pdf)>750000 or octet_length(pdf)<5 or convert_from(substring(pdf from 1 for 5),'UTF8')<>'%PDF-' or encode(sha256(pdf),'hex') is distinct from args->>'pdfHash' then raise exception using errcode='LK400',message='Invalid private receipt bytes or hash.';end if;
   if s.pdf_base64 is not null then
    if s.pdf_base64 is distinct from args->>'pdfBase64' or s.pdf_hash is distinct from args->>'pdfHash' or s.send_payload is distinct from args->'payload' then raise exception using errcode='LK409',message='Receipt and outgoing email are already frozen.';end if;
   else
    update public.lk_live_quote_submissions set pdf_base64=args->>'pdfBase64',pdf_hash=args->>'pdfHash',send_payload=args->'payload',receipt_frozen_at=now() where id=s.id returning * into s;
   end if;
   return public.lk_live_booking_claim_json(s);
  elsif command='delivery_email_attempt' then
   if s.pdf_base64 is null or s.email_status='provider_accepted' then raise exception using errcode='LK409',message='A frozen receipt and pending email are required.';end if;
   if s.email_first_attempt_at<=now()-interval '24 hours' then raise exception using errcode='LK409',message='Email acceptance requires manual provider review.';end if;
   update public.lk_live_quote_submissions set email_first_attempt_at=coalesce(email_first_attempt_at,now()) where id=s.id returning * into s;
   return public.lk_live_booking_claim_json(s);
  elsif command='delivery_email_accepted' then
   if s.pdf_base64 is null or s.email_first_attempt_at is null or coalesce(length(args->>'providerMessageId'),0) not between 1 and 200 then raise exception using errcode='LK409',message='A recorded frozen email attempt is required.';end if;
   if s.email_status='provider_accepted' and s.provider_message_id is distinct from args->>'providerMessageId' then raise exception using errcode='LK409',message='Provider acceptance already recorded.';end if;
   update public.lk_live_quote_submissions set email_status='provider_accepted',provider_message_id=args->>'providerMessageId',calendar_status=case when calendar_status='blocked' then 'pending' else calendar_status end,error=null where id=s.id returning * into s;
  elsif command='delivery_calendar_synced' then
   if s.email_status<>'provider_accepted' or coalesce(length(args->>'eventId'),0) not between 1 and 200 or coalesce(length(args->>'eventEtag'),0) not between 1 and 300 then raise exception using errcode='LK409',message='Email provider acceptance and verified calendar readback are required.';end if;
   update public.lk_live_quote_submissions set calendar_status='synced',calendar_event_id=args->>'eventId',calendar_event_etag=args->>'eventEtag',error=null,lease_token=null,lease_expires_at=null where id=s.id returning * into s;
  elsif command='delivery_failed' then
   if coalesce(args->>'stage','') not in ('email','calendar') or coalesce(args->>'outcome','') not in ('retrying','outcome_unknown','manual_review','conflict','failed') or coalesce(length(args->>'error'),0) not between 1 and 300 then raise exception using errcode='LK400',message='Invalid safe delivery failure.';end if;
   if args->>'stage'='email' then
    if s.email_status='provider_accepted' or args->>'outcome'='conflict' then raise exception using errcode='LK409',message='Accepted email cannot be retried.';end if;
    update public.lk_live_quote_submissions set email_status=args->>'outcome',error=args->>'error',next_attempt_at=now()+interval '1 minute',lease_token=null,lease_expires_at=null where id=s.id returning * into s;
   else
    if s.email_status<>'provider_accepted' or args->>'outcome' not in ('retrying','manual_review','conflict') or s.calendar_status='synced' then raise exception using errcode='LK409',message='Calendar failure requires an accepted email and incomplete sync.';end if;
    update public.lk_live_quote_submissions set calendar_status=args->>'outcome',error=args->>'error',next_attempt_at=now()+interval '1 minute',lease_token=null,lease_expires_at=null where id=s.id returning * into s;
   end if;
  else raise exception using errcode='LK400',message='Invalid delivery command.';
  end if;
  return public.lk_live_booking_submission_json(s);
 end if;
 if command='staff_state' then
  if coalesce(args->>'actorUserId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or coalesce(args->>'actorSessionId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK403',message='Verified staff actor required.';end if;
  select * into r from public.lk_quote_requests where company_id=company and id=(args->>'id')::uuid;
  if not found then raise exception using errcode='LK404',message='Booking request not found.';end if;
  return public.lk_live_booking_state(r);
 end if;
 if command not in ('state','approve','date','review','submit','retry','receipt','replay') then raise exception using errcode='LK400',message='Invalid booking command.';end if;
 if jsonb_typeof(args->'customerAccess') is distinct from 'object' or owner is null or owner !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Verify your customer email before approving a booking request.';end if;
 perform pg_advisory_xact_lock(hashtextextended('live-request:'||company||':'||owner,0));
 resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
 if resolved->>'hash' is distinct from owner or args->'customerAccess'->>'companyId' is distinct from company or args->'customerAccess'->>'requestId' is distinct from args->>'expectedRequestId' then raise exception using errcode='LK403',message='Saved quote access changed.';end if;
 uid:=(args->'customerAccess'->>'authUserId')::uuid;
 select * into r from public.lk_quote_requests where company_id=company and owner_hash=owner and id=(args->>'expectedRequestId')::uuid for update;
 if not found then raise exception using errcode='LK404',message='Saved quote not found.';end if;
 select * into s from public.lk_live_quote_submissions where company_id=company and request_id=r.id for update;
 if command='state' then return public.lk_live_booking_state(r);end if;
 if command='receipt' then
  if s.id is null or s.pdf_base64 is null then raise exception using errcode='LK409',message='Your private receipt is being prepared. Retry shortly.';end if;
  return jsonb_build_object('submission',public.lk_live_booking_submission_json(s),'pdfBase64',s.pdf_base64,'pdfHash',s.pdf_hash,'payload',s.send_payload);
 end if;
 if command='retry' then
  if s.id is null then raise exception using errcode='LK409',message='Submit your signed booking request first.';end if;
  if s.email_status='manual_review' or s.calendar_status in ('manual_review','conflict') then raise exception using errcode='LK409',message='The company must review this delivery before retrying.';end if;
  if s.email_status<>'provider_accepted' and s.email_first_attempt_at<=now()-interval '24 hours' then
   update public.lk_live_quote_submissions set email_status='manual_review',error='The original email attempt requires provider review before another send.' where id=s.id;
  elsif s.calendar_status<>'synced' then
   update public.lk_live_quote_submissions set email_status=case when email_status='failed' then 'retrying' else email_status end,next_attempt_at=now() where id=s.id;
  end if;
  return public.lk_live_booking_state(r);
 end if;
 if command='replay' then
  if args->>'operation' not in ('approve','date') then raise exception using errcode='LK400',message='Invalid replay operation.';end if;
  fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',args->>'operation','args',args-array['operation','companyId','ownerHash','expiresAt','expectedRequestId','customerAccess','dateCheck','calendarTarget','reviewExpiresAt']));
  select * into receipt from public.lk_live_quote_booking_receipts where company_id=company and request_id=r.id and auth_user_id=uid and idempotency_key=(args->>'idempotencyKey')::uuid;
  if not found then return 'null'::jsonb;end if;
  if receipt.command_hash<>fingerprint then raise exception using errcode='LK409',message='This retry key belongs to different booking request details.';end if;
  return public.lk_live_booking_state(r);
 end if;
 if command in ('approve','date','submit') then
  if coalesce(args->>'idempotencyKey','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid booking retry key.';end if;
  key:=(args->>'idempotencyKey')::uuid;
  fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',command,'args',args-array['companyId','ownerHash','expiresAt','expectedRequestId','customerAccess','dateCheck','calendarTarget','reviewExpiresAt']));
  select * into receipt from public.lk_live_quote_booking_receipts where company_id=company and request_id=r.id and auth_user_id=uid and idempotency_key=key;
  if found then
   if receipt.command_hash<>fingerprint then raise exception using errcode='LK409',message='This retry key belongs to different booking request details.';end if;
   return public.lk_live_booking_state(r);
  end if;
 end if;
 if command='submit' and s.id is not null then
  if s.approval_id::text is distinct from args->>'approvalId' or s.selection_revision is distinct from (args->>'selectionRevision')::integer or s.snapshot_hash is distinct from args->>'snapshotHash' or s.signature is distinct from args->'signature' then raise exception using errcode='LK409',message='This booking request already has an immutable signed submission.';end if;
  result:=public.lk_live_booking_state(r);
  insert into public.lk_live_quote_booking_receipts values(company,r.id,uid,key,fingerprint,result,now());
  return result;
 end if;
 if s.id is not null then raise exception using errcode='LK409',message='Your signed request is saved. Contact the company to change it.';end if;
 if command='approve' then
  if r.revision is distinct from (args->>'expectedRevision')::integer then raise exception using errcode='LK409',message='Saved details changed. Reload before approving.';end if;
  select * into j from public.lk_quote_analysis_jobs where company_id=company and request_id=r.id order by created_at desc,id desc limit 1;
  manifest:=public.lk_live_booking_manifest(r);
  if j.id is null or j.id::text is distinct from args->>'analysisId' or j.status<>'succeeded' or j.input_revision<>r.revision or j.input_snapshot->'photos' is distinct from manifest or j.input_snapshot->'service' is distinct from r.payload->'service' or exists(select 1 from public.lk_live_quote_photos p where p.company_id=company and p.request_id=r.id and p.state='uploading') then raise exception using errcode='LK409',message='Use the latest completed estimate for your current saved details and photos.';end if;
  if j.pricing->>'status' is distinct from 'provisional_estimate' or jsonb_typeof(j.pricing->'total') is distinct from 'number' or not public.lk_quote_pricing_v2_valid(j.pricing,j.analysis,j.input_snapshot->'service',manifest) then raise exception using errcode='LK409',message='A validated numeric provisional estimate is required.';end if;
  target:=args->'calendarTarget';
  perform 1 from public.lk_google_connection c where c.id=1 and c.account_sub=target->>'accountSub' for share;
  if not found or coalesce(target->>'calendarId','')='' then raise exception using errcode='LK409',message='The company calendar connection changed. Reload before approving.';end if;
  select coalesce(max(version),0)+1 into versionvalue from public.lk_live_quote_approvals where company_id=company and request_id=r.id;
  snapshot:=jsonb_build_object('mode','live','kind','nonbinding_booking_request','version','live-booking-request-ack-v1','requestId',r.id,'reference',r.reference,'inputRevision',r.revision,'analysisId',j.id,'payload',r.payload,'verifiedEmail',args->'customerAccess'->>'email','analysis',j.analysis,'inputSnapshot',j.input_snapshot,'pricing',j.pricing,'photos',manifest,'acknowledgment',public.lk_live_booking_ack(),'calendarTarget',target);
  insert into public.lk_live_quote_approvals(company_id,request_id,auth_user_id,verified_email,version,analysis_id,input_revision,source_snapshot,snapshot_hash)
  values(company,r.id,uid,args->'customerAccess'->>'email',versionvalue,j.id,r.revision,snapshot,public.lk_live_booking_hash(snapshot)) returning * into a;
 else
  select * into a from public.lk_live_quote_approvals where company_id=company and request_id=r.id and id=(args->>'approvalId')::uuid for update;
  if not found or a.id is distinct from (select x.id from public.lk_live_quote_approvals x where x.company_id=company and x.request_id=r.id order by x.version desc limit 1) or a.auth_user_id<>uid or not public.lk_live_booking_source_current(r,a) then raise exception using errcode='LK409',message='The approved estimate changed. Review and approve the current estimate again.';end if;
  target:=a.source_snapshot->'calendarTarget';
  perform 1 from public.lk_google_connection c where c.id=1 and c.account_sub=target->>'accountSub' for share;
  if not found then raise exception using errcode='LK409',message='The company calendar connection changed.';end if;
  if command='date' then
   datevalue:=(args->>'preferredDate')::date;
   if jsonb_typeof(args->'dateCheck') is distinct from 'object' or jsonb_typeof(args->'dateCheck'->'checkedAt') is distinct from 'string' or jsonb_typeof(args->'dateCheck'->'expiresAt') is distinct from 'string' or (args->'dateCheck'->>'checkedAt')::timestamptz>now()+interval '30 seconds' or args->'dateCheck'->>'accountSub' is distinct from target->>'accountSub' or args->'dateCheck'->>'calendarId' is distinct from target->>'calendarId' or args->'dateCheck'->>'revision' is distinct from args->>'availabilityRevision' or (args->'dateCheck'->>'expiresAt')::timestamptz<=now() or (args->'dateCheck'->>'checkedAt')::timestamptz<now()-interval '2 minutes' or datevalue<timezone('Australia/Sydney',now())::date or datevalue>timezone('Australia/Sydney',now())::date+366 then raise exception using errcode='LK409',message='Calendar availability changed. Refresh and choose the date again.';end if;
   perform pg_advisory_xact_lock(hashtextextended('live-booking-date:'||company||':'||(target->>'calendarId')||':'||datevalue::text,0));
   if exists(select 1 from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=target->>'accountSub' and x.calendar_id=target->>'calendarId' and x.start_date<=datevalue and x.end_date>datevalue) then raise exception using errcode='LK409',message='This date has a confirmed booking.';end if;
   update public.lk_live_quote_approvals set preferred_date=datevalue,selection_revision=selection_revision+1,availability_revision=args->>'availabilityRevision',availability_checked_at=(args->'dateCheck'->>'checkedAt')::timestamptz where id=a.id returning * into a;
  else
   if a.preferred_date is null or a.selection_revision is distinct from (args->>'selectionRevision')::integer then raise exception using errcode='LK409',message='The preferred date changed. Review the current request again.';end if;
   snapshot:=a.source_snapshot||jsonb_build_object('preferredDate',a.preferred_date);
   if command='review' then return jsonb_build_object('snapshot',snapshot,'snapshotHash',public.lk_live_booking_hash(snapshot),'approvalId',a.id,'selectionRevision',a.selection_revision);end if;
   if jsonb_typeof(args->'reviewExpiresAt') is distinct from 'string' or args->>'snapshotHash' is distinct from public.lk_live_booking_hash(snapshot) or (args->>'reviewExpiresAt')::timestamptz<=now() then raise exception using errcode='LK409',message='Your reviewed summary changed or expired. Review it again before signing.';end if;
   if jsonb_typeof(args->'dateCheck') is distinct from 'object' or jsonb_typeof(args->'dateCheck'->'checkedAt') is distinct from 'string' or jsonb_typeof(args->'dateCheck'->'expiresAt') is distinct from 'string' or (args->'dateCheck'->>'checkedAt')::timestamptz>now()+interval '30 seconds' or args->'dateCheck'->>'accountSub' is distinct from target->>'accountSub' or args->'dateCheck'->>'calendarId' is distinct from target->>'calendarId' or (args->'dateCheck'->>'expiresAt')::timestamptz<=now() or (args->'dateCheck'->>'checkedAt')::timestamptz<now()-interval '2 minutes' or a.preferred_date<timezone('Australia/Sydney',now())::date then raise exception using errcode='LK409',message='Calendar availability changed. Review the preferred date again.';end if;
   perform pg_advisory_xact_lock(hashtextextended('live-booking-date:'||company||':'||(target->>'calendarId')||':'||a.preferred_date::text,0));
   if exists(select 1 from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=target->>'accountSub' and x.calendar_id=target->>'calendarId' and x.start_date<=a.preferred_date and x.end_date>a.preferred_date) then raise exception using errcode='LK409',message='This date has a confirmed booking.';end if;
   signature:=args->'signature';if not public.lk_live_booking_signature_valid(signature) then raise exception using errcode='LK400',message='A valid name, signature and acknowledgment are required.';end if;
   sid:=gen_random_uuid();
   insert into public.lk_live_quote_submissions(id,company_id,request_id,approval_id,reference,auth_user_id,verified_email,preferred_date,selection_revision,snapshot,snapshot_hash,signature,signed_content_hash,email_idempotency_key)
   values(sid,company,r.id,a.id,'REQUEST-'||upper(left(replace(sid::text,'-',''),12)),uid,a.verified_email,a.preferred_date,a.selection_revision,snapshot,public.lk_live_booking_hash(snapshot),signature,public.lk_live_booking_hash(jsonb_build_object('snapshot',snapshot,'signature',signature)),'live-booking-email:'||sid::text||':v1') returning * into s;
  end if;
 end if;
 result:=public.lk_live_booking_state(r);
 insert into public.lk_live_quote_booking_receipts values(company,r.id,uid,key,fingerprint,result,now());
 return result;
end;
$$;
-- Freeze source writes after submission, including begin/start that do not advance the input revision.
alter function public.lk_quote_requests_command(text,jsonb) rename to lk_quote_requests_customer_command;
create function public.lk_quote_requests_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if command in ('save','request_review') and args->>'ownerHash' ~ '^[a-f0-9]{64}$' then
  perform pg_advisory_xact_lock(hashtextextended('live-request:'||(args->>'companyId')||':'||(args->>'ownerHash'),0));
  if args ? 'customerAccess' then perform public.lk_quote_customer_command('resolve',args->'customerAccess');end if;
  perform 1 from public.lk_quote_requests q where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash' for update;
  if exists(select 1 from public.lk_live_quote_submissions s join public.lk_quote_requests q on q.id=s.request_id and q.company_id=s.company_id where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash') then raise exception using errcode='LK409',message='Your signed booking request is saved. Contact the company to change it.';end if;
 end if;
 return public.lk_quote_requests_customer_command(command,args);
end;
$$;
alter function public.lk_quote_media_command(text,jsonb) rename to lk_quote_media_customer_command;
create function public.lk_quote_media_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if command in ('photo_begin','photo_finalize','photo_remove','reopen','analysis_start') and args->>'ownerHash' ~ '^[a-f0-9]{64}$' then
  perform pg_advisory_xact_lock(hashtextextended('live-request:'||(args->>'companyId')||':'||(args->>'ownerHash'),0));
  if args ? 'customerAccess' then perform public.lk_quote_customer_command('resolve',args->'customerAccess');end if;
  perform 1 from public.lk_quote_requests q where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash' for update;
  if exists(select 1 from public.lk_live_quote_submissions s join public.lk_quote_requests q on q.id=s.request_id and q.company_id=s.company_id where q.company_id=args->>'companyId' and q.owner_hash=args->>'ownerHash') then raise exception using errcode='LK409',message='Your signed booking request is saved. Contact the company to change it.';end if;
 end if;
 return public.lk_quote_media_customer_command(command,args);
end;
$$;
-- No browser grants/policies. Only the service role can invoke these transaction-bound commands.
do $grants$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'lk_live_booking_%' or p.proname='lk_live_quote_booking_command' or p.proname in ('lk_quote_requests_command','lk_quote_requests_customer_command','lk_quote_media_command','lk_quote_media_customer_command')) loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated';execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end;$grants$;
commit;
