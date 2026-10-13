-- One customer acknowledgment, fixed take-off start and one EMS confirmation.
-- V1 signed evidence and the original proposal/acceptance workflow are preserved.
begin;
alter table public.lk_live_quote_approvals add column preferred_time text check(preferred_time is null or preferred_time ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$');
alter table public.lk_live_quote_submissions add column preferred_time text check(preferred_time is null or preferred_time ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$');
-- Replace only the status enum and email gate, leaving receipt/provider/sync gates.
do $constraints$ declare c record; begin
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.lk_live_quote_submissions'::regclass and contype='c' loop
  if c.def like '%calendar_status%' and (c.def like '%manual_review%' or c.def like '%email_status%') then execute format('alter table public.lk_live_quote_submissions drop constraint %I',c.conname);end if;
 end loop;
end;$constraints$;
alter table public.lk_live_quote_submissions add constraint lk_live_request_calendar_status_v2 check(calendar_status in ('not_required','blocked','pending','syncing','synced','retrying','conflict','manual_review')),
 add constraint lk_live_request_email_calendar_gate_v2 check(calendar_status in ('blocked','not_required') or email_status='provider_accepted'),
 add constraint lk_live_request_v2_time check(snapshot->>'version'<>'live-booking-request-ack-v2' or (preferred_time is not null and snapshot->>'preferredTime'=preferred_time and snapshot->>'preferredDate'=preferred_date::text)),
 add constraint lk_live_request_v2_calendar check((snapshot->>'version'='live-booking-request-ack-v2')=(calendar_status='not_required'));
alter table public.lk_live_company_bookings alter column acceptance_id drop not null,
 add column confirmation_basis text not null default 'customer_proposal' check(confirmation_basis in ('customer_proposal','signed_request')),
 add column signed_submission_id uuid references public.lk_live_quote_submissions(id),
 add constraint lk_live_company_confirmation_evidence check((confirmation_basis='customer_proposal' and acceptance_id is not null and signed_submission_id is null) or (confirmation_basis='signed_request' and acceptance_id is null and signed_submission_id is not null));
create function public.lk_live_booking_simple_ack() returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('version','live-booking-request-ack-v2','text','I acknowledge the provisional photo-based painting estimate and request the take-off date and Sydney time shown here. I agree that the company may assign the installation date and time and notify me in the booking confirmation email. Additional damage found on site may increase the price; any additional work and cost will be discussed before proceeding. No date is held until company confirmation. This request is not a contract, work authorisation or payment obligation.');
$$;
create function public.lk_live_booking_sydney_instant(value text) returns timestamptz language plpgsql stable security invoker set search_path='' as $$
declare localvalue timestamp; result timestamptz; n integer;
begin
 if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='LK400',message='Choose a valid Sydney date and time.';end if;
 begin localvalue:=value::timestamp;exception when others then raise exception using errcode='LK400',message='Choose a valid Sydney date and time.';end;
 select count(*),min(candidate) into n,result from (select (localvalue-make_interval(hours=>hours)) at time zone 'UTC' candidate from unnest(array[10,11]) hours) x where to_char(candidate at time zone 'Australia/Sydney','YYYY-MM-DD"T"HH24:MI')=value;
 if n<>1 then raise exception using errcode='LK400',message='Sydney local time is nonexistent or ambiguous.';end if;
 return result;
end;$$;
create or replace function public.lk_live_booking_approval_json(a public.lk_live_quote_approvals,r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',a.id,'version',a.version,'analysisId',a.analysis_id,'inputRevision',a.input_revision,'approvedAt',a.approved_at,'snapshot',a.source_snapshot,'snapshotHash',a.snapshot_hash,'stale',not public.lk_live_booking_source_current(r,a),'preferredDate',a.preferred_date,'preferredTime',a.preferred_time,'selectionRevision',a.selection_revision,'availabilityRevision',a.availability_revision);
$$;
create or replace function public.lk_live_booking_submission_json(s public.lk_live_quote_submissions) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',s.id,'reference',s.reference,'requestId',s.request_id,'approvalId',s.approval_id,'submittedAt',s.submitted_at,'preferredDate',s.preferred_date,'preferredTime',s.preferred_time,'snapshot',s.snapshot,'snapshotHash',s.snapshot_hash,'signedContentHash',s.signed_content_hash,'signature',s.signature,'emailStatus',s.email_status,'calendarStatus',s.calendar_status,'error',s.error,'receiptReady',s.pdf_base64 is not null,'providerMessageId',s.provider_message_id,'calendarEventId',s.calendar_event_id);
$$;
create or replace function public.lk_live_booking_state(r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'verified',exists(select 1 from public.lk_quote_request_access x where x.company_id=r.company_id and x.request_id=r.id and x.revoked_at is null),
 'canEdit',not exists(select 1 from public.lk_live_quote_submissions s where s.company_id=r.company_id and s.request_id=r.id),
 'approval',(select public.lk_live_booking_approval_json(a,r) from public.lk_live_quote_approvals a where a.company_id=r.company_id and a.request_id=r.id order by a.version desc limit 1),
 'submission',(select public.lk_live_booking_submission_json(s) from public.lk_live_quote_submissions s where s.company_id=r.company_id and s.request_id=r.id),'acknowledgment',coalesce((select a.source_snapshot->'acknowledgment' from public.lk_live_quote_approvals a where a.request_id=r.id order by a.version desc limit 1),public.lk_live_booking_simple_ack()));
$$;
create or replace function public.lk_live_booking_immutable_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='lk_live_quote_approvals' then
  if (to_jsonb(new)-'preferred_time'-'preferred_date'-'selection_revision'-'availability_revision'-'availability_checked_at') is distinct from (to_jsonb(old)-'preferred_time'-'preferred_date'-'selection_revision'-'availability_revision'-'availability_checked_at') then raise exception using errcode='LK409',message='An approved source snapshot is immutable.';end if;
 else
  if (to_jsonb(new)-array['email_status','calendar_status','error','provider_message_id','calendar_event_id','calendar_event_etag','lease_token','lease_expires_at','next_attempt_at','attempts','email_first_attempt_at','pdf_base64','pdf_hash','send_payload','receipt_frozen_at']) is distinct from (to_jsonb(old)-array['email_status','calendar_status','error','provider_message_id','calendar_event_id','calendar_event_etag','lease_token','lease_expires_at','next_attempt_at','attempts','email_first_attempt_at','pdf_base64','pdf_hash','send_payload','receipt_frozen_at']) then raise exception using errcode='LK409',message='A signed booking request is immutable.';end if;
  if old.calendar_status='not_required' and new.calendar_status<>'not_required' then raise exception using errcode='LK409',message='This request has no pre-confirmation Calendar event.';end if;
  if old.pdf_base64 is not null and (new.pdf_base64 is distinct from old.pdf_base64 or new.pdf_hash is distinct from old.pdf_hash or new.send_payload is distinct from old.send_payload or new.receipt_frozen_at is distinct from old.receipt_frozen_at) then raise exception using errcode='LK409',message='The receipt and outgoing email are already frozen.';end if;
  if old.email_first_attempt_at is not null and new.email_first_attempt_at is distinct from old.email_first_attempt_at then raise exception using errcode='LK409',message='The first email attempt is immutable.';end if;
  if old.email_status='provider_accepted' and (new.email_status<>'provider_accepted' or new.provider_message_id is distinct from old.provider_message_id) then raise exception using errcode='LK409',message='Provider acceptance is immutable.';end if;
 end if;
 return new;
end;
$$;
create or replace function public.lk_live_quote_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare company text:=args->>'companyId';owner text:=args->>'ownerHash';resolved jsonb;r public.lk_quote_requests;a public.lk_live_quote_approvals;s public.lk_live_quote_submissions;j public.lk_quote_analysis_jobs;
 receipt public.lk_live_quote_booking_receipts;target jsonb;manifest jsonb;snapshot jsonb;result jsonb;fingerprint text;key uuid;uid uuid;sid uuid;datevalue date;signature jsonb;versionvalue integer;pdf bytea;claimskipped integer:=0; ack jsonb; timevalue text;
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
   (x.email_status in ('pending','sending','retrying','outcome_unknown') or x.email_status='provider_accepted' and (x.calendar_status in ('pending','syncing','retrying') or x.calendar_status='not_required' and x.lease_token is not null)) order by x.next_attempt_at,x.submitted_at for update skip locked limit 1;
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
    calendar_status=case when email_status='provider_accepted' and calendar_status<>'not_required' then 'syncing' else calendar_status end,error=null where id=s.id returning * into s;
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
  elsif command='delivery_request_complete' then
   if s.snapshot->>'version'<>'live-booking-request-ack-v2' or s.calendar_status<>'not_required' or s.email_status<>'provider_accepted' or s.pdf_base64 is null then raise exception using errcode='LK409',message='A recorded v2 request email is required.';end if;
   update public.lk_live_quote_submissions set lease_token=null,lease_expires_at=null,error=null where id=s.id returning * into s;
  elsif command='delivery_calendar_synced' then
   if s.calendar_status='not_required' then raise exception using errcode='LK409',message='This request requires EMS confirmation before Calendar storage.';end if;
   if s.email_status<>'provider_accepted' or coalesce(length(args->>'eventId'),0) not between 1 and 200 or coalesce(length(args->>'eventEtag'),0) not between 1 and 300 then raise exception using errcode='LK409',message='Email provider acceptance and verified calendar readback are required.';end if;
   update public.lk_live_quote_submissions set calendar_status='synced',calendar_event_id=args->>'eventId',calendar_event_etag=args->>'eventEtag',error=null,lease_token=null,lease_expires_at=null where id=s.id returning * into s;
  elsif command='delivery_failed' then
   if coalesce(args->>'stage','') not in ('email','calendar') or coalesce(args->>'outcome','') not in ('retrying','outcome_unknown','manual_review','conflict','failed') or coalesce(length(args->>'error'),0) not between 1 and 300 then raise exception using errcode='LK400',message='Invalid safe delivery failure.';end if;
   if args->>'stage'='email' then
    if s.email_status='provider_accepted' or args->>'outcome'='conflict' then raise exception using errcode='LK409',message='Accepted email cannot be retried.';end if;
    update public.lk_live_quote_submissions set email_status=args->>'outcome',error=args->>'error',next_attempt_at=now()+interval '1 minute',lease_token=null,lease_expires_at=null where id=s.id returning * into s;
   else
    if s.email_status<>'provider_accepted' or args->>'outcome' not in ('retrying','manual_review','conflict') or s.calendar_status in ('synced','not_required') then raise exception using errcode='LK409',message='Calendar failure requires an accepted email and incomplete sync.';end if;
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
  ack:=case coalesce(args->>'acknowledgmentVersion','live-booking-request-ack-v2') when 'live-booking-request-ack-v1' then public.lk_live_booking_ack() when 'live-booking-request-ack-v2' then public.lk_live_booking_simple_ack() else null end;
  if ack is null then raise exception using errcode='LK400',message='Invalid booking acknowledgment version.';end if;
  if r.revision is distinct from (args->>'expectedRevision')::integer then raise exception using errcode='LK409',message='Saved details changed. Reload before approving.';end if;
  select * into j from public.lk_quote_analysis_jobs where company_id=company and request_id=r.id order by created_at desc,id desc limit 1;
  manifest:=public.lk_live_booking_manifest(r);
  if j.id is null or j.id::text is distinct from args->>'analysisId' or j.status<>'succeeded' or not public.lk_quote_analysis_source_current(j,r) then raise exception using errcode='LK409',message='Use the latest completed estimate for your current saved details and photos.';end if;
  if j.pricing->>'status' is distinct from 'provisional_estimate' or jsonb_typeof(j.pricing->'total') is distinct from 'number' or not public.lk_quote_pricing_v2_valid(j.pricing,j.analysis,j.input_snapshot->'service',manifest) then raise exception using errcode='LK409',message='A validated numeric provisional estimate is required.';end if;
  target:=args->'calendarTarget';
  perform 1 from public.lk_google_connection c where c.id=1 and c.account_sub=target->>'accountSub' for share;
  if not found or coalesce(target->>'calendarId','')='' then raise exception using errcode='LK409',message='The company calendar connection changed. Reload before approving.';end if;
  select coalesce(max(version),0)+1 into versionvalue from public.lk_live_quote_approvals where company_id=company and request_id=r.id;
  snapshot:=jsonb_build_object('mode','live','kind','nonbinding_booking_request','version',ack->>'version','requestId',r.id,'reference',r.reference,'inputRevision',r.revision,'analysisId',j.id,'payload',r.payload,'verifiedEmail',args->'customerAccess'->>'email','analysis',j.analysis,'inputSnapshot',j.input_snapshot,'pricing',j.pricing,'photos',manifest,'acknowledgment',ack,'calendarTarget',target);
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
   timevalue:=args->>'preferredTime';
   if a.source_snapshot->>'version'='live-booking-request-ack-v2' then
    if a.source_snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or timevalue is null or timevalue !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='LK400',message='Choose a valid Sydney take-off time.';end if;
    if public.lk_live_booking_sydney_instant(datevalue::text||'T'||timevalue)<=clock_timestamp() then raise exception using errcode='LK409',message='Choose a future Sydney take-off date and time.';end if;
   elsif timevalue is not null then raise exception using errcode='LK400',message='Existing acknowledgment only supports a preferred date.';end if;
   if jsonb_typeof(args->'dateCheck') is distinct from 'object' or jsonb_typeof(args->'dateCheck'->'checkedAt') is distinct from 'string' or jsonb_typeof(args->'dateCheck'->'expiresAt') is distinct from 'string' or (args->'dateCheck'->>'checkedAt')::timestamptz>now()+interval '30 seconds' or args->'dateCheck'->>'accountSub' is distinct from target->>'accountSub' or args->'dateCheck'->>'calendarId' is distinct from target->>'calendarId' or args->'dateCheck'->>'revision' is distinct from args->>'availabilityRevision' or (args->'dateCheck'->>'expiresAt')::timestamptz<=now() or (args->'dateCheck'->>'checkedAt')::timestamptz<now()-interval '2 minutes' or datevalue<timezone('Australia/Sydney',now())::date or datevalue>timezone('Australia/Sydney',now())::date+366 then raise exception using errcode='LK409',message='Calendar availability changed. Refresh and choose the date again.';end if;
   perform pg_advisory_xact_lock(hashtextextended('live-booking-date:'||company||':'||(target->>'calendarId')||':'||datevalue::text,0));
   if exists(select 1 from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=target->>'accountSub' and x.calendar_id=target->>'calendarId' and x.start_date<=datevalue and x.end_date>datevalue) then raise exception using errcode='LK409',message='This date has a confirmed booking.';end if;
   update public.lk_live_quote_approvals set preferred_date=datevalue,preferred_time=timevalue,selection_revision=selection_revision+1,availability_revision=args->>'availabilityRevision',availability_checked_at=(args->'dateCheck'->>'checkedAt')::timestamptz where id=a.id returning * into a;
  else
   if a.preferred_date is null or a.selection_revision is distinct from (args->>'selectionRevision')::integer then raise exception using errcode='LK409',message='The preferred date changed. Review the current request again.';end if;
   snapshot:=a.source_snapshot||jsonb_build_object('preferredDate',a.preferred_date);
   if a.source_snapshot->>'version'='live-booking-request-ack-v2' then
    if a.preferred_time is null or a.source_snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or public.lk_live_booking_sydney_instant(a.preferred_date::text||'T'||a.preferred_time)<=clock_timestamp() then raise exception using errcode='LK409',message='Choose a future Sydney take-off date and time.';end if;
    snapshot:=snapshot||jsonb_build_object('preferredTime',a.preferred_time);
   end if;
   if command='review' then return jsonb_build_object('snapshot',snapshot,'snapshotHash',public.lk_live_booking_hash(snapshot),'approvalId',a.id,'selectionRevision',a.selection_revision);end if;
   if jsonb_typeof(args->'reviewExpiresAt') is distinct from 'string' or args->>'snapshotHash' is distinct from public.lk_live_booking_hash(snapshot) or (args->>'reviewExpiresAt')::timestamptz<=now() then raise exception using errcode='LK409',message='Your reviewed summary changed or expired. Review it again before signing.';end if;
   if jsonb_typeof(args->'dateCheck') is distinct from 'object' or jsonb_typeof(args->'dateCheck'->'checkedAt') is distinct from 'string' or jsonb_typeof(args->'dateCheck'->'expiresAt') is distinct from 'string' or (args->'dateCheck'->>'checkedAt')::timestamptz>now()+interval '30 seconds' or args->'dateCheck'->>'accountSub' is distinct from target->>'accountSub' or args->'dateCheck'->>'calendarId' is distinct from target->>'calendarId' or (args->'dateCheck'->>'expiresAt')::timestamptz<=now() or (args->'dateCheck'->>'checkedAt')::timestamptz<now()-interval '2 minutes' or a.preferred_date<timezone('Australia/Sydney',now())::date then raise exception using errcode='LK409',message='Calendar availability changed. Review the preferred date again.';end if;
   perform pg_advisory_xact_lock(hashtextextended('live-booking-date:'||company||':'||(target->>'calendarId')||':'||a.preferred_date::text,0));
   if exists(select 1 from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=target->>'accountSub' and x.calendar_id=target->>'calendarId' and x.start_date<=a.preferred_date and x.end_date>a.preferred_date) then raise exception using errcode='LK409',message='This date has a confirmed booking.';end if;
   signature:=args->'signature';if not public.lk_live_booking_signature_valid(signature) then raise exception using errcode='LK400',message='A valid name, signature and acknowledgment are required.';end if;
   sid:=gen_random_uuid();
   insert into public.lk_live_quote_submissions(id,company_id,request_id,approval_id,reference,auth_user_id,verified_email,preferred_date,preferred_time,calendar_status,selection_revision,snapshot,snapshot_hash,signature,signed_content_hash,email_idempotency_key)
   values(sid,company,r.id,a.id,'REQUEST-'||upper(left(replace(sid::text,'-',''),12)),uid,a.verified_email,a.preferred_date,a.preferred_time,case when snapshot->>'version'='live-booking-request-ack-v2' then 'not_required' else 'blocked' end,a.selection_revision,snapshot,public.lk_live_booking_hash(snapshot),signature,public.lk_live_booking_hash(jsonb_build_object('snapshot',snapshot,'signature',signature)),'live-booking-email:'||sid::text||':v1') returning * into s;
  end if;
 end if;
 result:=public.lk_live_booking_state(r);
 insert into public.lk_live_quote_booking_receipts values(company,r.id,uid,key,fingerprint,result,now());
 return result;
end;
$$;
create or replace function public.lk_live_company_booking_json(b public.lk_live_company_bookings) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('confirmationBasis',b.confirmation_basis,'signedSubmissionId',b.signed_submission_id,'id',b.id,'proposalId',b.proposal_id,'proposalHash',b.proposal_hash,'version',b.version,'status',b.status,'error',b.error,'confirmedAt',b.confirmed_at,'emailStatus',coalesce((select o.email_status from public.lk_live_company_outbox o where o.proposal_id=b.proposal_id and o.kind='confirmation'),'pending'),'receiptReady',exists(select 1 from public.lk_live_company_outbox o where o.proposal_id=b.proposal_id and o.kind='confirmation' and o.pdf_base64 is not null),'events',(select coalesce(jsonb_agg(jsonb_build_object('segmentIndex',e.segment_index,'eventId',e.event_id,'payloadHash',e.payload_hash,'etag',e.etag,'verifiedAt',e.verified_at) order by e.segment_index),'[]'::jsonb) from public.lk_live_company_events e where e.booking_id=b.id));
$$;
-- Derive every protected confirmation field from the immutable v2 signed request.
create function public.lk_live_company_simple_snapshot(s public.lk_live_quote_submissions,args jsonb,target jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare firstat timestamptz;takeend timestamptz;installstart timestamptz;installend timestamptz;segments jsonb;pricing jsonb:=s.snapshot->'pricing';amount bigint;gst bigint;total bigint;note text:=btrim(args->>'companyNote');
begin
 if s.snapshot->>'version' is distinct from 'live-booking-request-ack-v2' or s.snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or s.preferred_time is null or s.snapshot->>'preferredTime' is distinct from s.preferred_time or s.snapshot->>'preferredDate' is distinct from s.preferred_date::text or public.lk_live_booking_hash(s.snapshot)<>s.snapshot_hash or public.lk_live_booking_hash(jsonb_build_object('snapshot',s.snapshot,'signature',s.signature))<>s.signed_content_hash or not public.lk_live_booking_signature_valid(s.signature) then raise exception using errcode='LK409',message='This signed request requires the original separate company proposal workflow.';end if;
 if jsonb_typeof(args->'companyNote') is distinct from 'string' or length(note) not between 1 and 3000 or note ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception using errcode='LK400',message='Enter a valid company damage and installation note.';end if;
 if pricing->>'status' is distinct from 'provisional_estimate' or jsonb_typeof(pricing->'subtotal') is distinct from 'number' or jsonb_typeof(pricing->'tax') is distinct from 'number' or jsonb_typeof(pricing->'total') is distinct from 'number' or pricing->>'currency' is distinct from 'AUD' then raise exception using errcode='LK409',message='The original numeric photo estimate is required.';end if;
 amount:=(pricing->>'subtotal')::bigint;gst:=(pricing->>'tax')::bigint;total:=(pricing->>'total')::bigint;
 if amount<1 or amount>100000000 or (pricing->>'subtotal')::numeric<>amount or (pricing->>'tax')::numeric<>gst or (pricing->>'total')::numeric<>total or gst<>round(amount*0.1) or total<>amount+gst then raise exception using errcode='LK409',message='The original estimate arithmetic changed.';end if;
 firstat:=public.lk_live_booking_sydney_instant(s.preferred_date::text||'T'||s.preferred_time);
 takeend:=public.lk_live_booking_sydney_instant(args->>'takeOffEndLocal');installstart:=public.lk_live_booking_sydney_instant(args->>'installStartLocal');installend:=public.lk_live_booking_sydney_instant(args->>'installEndLocal');
 if firstat<=clock_timestamp() or takeend<=firstat or takeend-firstat>interval '90 days' or installstart<takeend or installend<=installstart or installend-installstart>interval '90 days' then raise exception using errcode='LK400',message='Choose future take-off and installation periods, with installation after take-off and an end after each start.';end if;
 select jsonb_agg(jsonb_build_object('kind','timed','purpose',x.purpose,'startAt',to_char(x.a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(x.b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'startLocal',x.alocal,'endLocal',x.blocal,'startDate',(x.a at time zone 'Australia/Sydney')::date,'endDate',((x.b-interval '1 microsecond') at time zone 'Australia/Sydney')::date+1) order by x.idx) into segments from (values(0,'take_off',firstat,takeend,s.preferred_date::text||'T'||s.preferred_time,args->>'takeOffEndLocal'),(1,'install',installstart,installend,args->>'installStartLocal',args->>'installEndLocal')) x(idx,purpose,a,b,alocal,blocal);
 return jsonb_build_object('confirmationBasis','signed_request','signedSubmissionId',s.id,'originalSnapshotHash',s.snapshot_hash,'originalSignedContentHash',s.signed_content_hash,'companyNote',note,'amountExGst',amount,'gst',gst,'total',total,'currency','AUD','pricing',pricing,'priceKind','photo_estimate','scope',left('Photo-based cabinet painting estimate. '||coalesce(s.snapshot->'analysis'->>'summary',''),5000),'adjustmentReason','Original photo estimate retained. Additional site damage and costs require discussion before proceeding.','segments',segments,'calendarTarget',target);
end;$$;
-- Retain the complete v1 implementation, with the same authorization and workers.
alter function public.lk_live_company_booking_command(text,jsonb) rename to lk_live_company_booking_command_v1;
alter function public.lk_live_company_booking_command_v1(text,jsonb) set schema lk_private;
revoke all on function lk_private.lk_live_company_booking_command_v1(text,jsonb) from public,anon,authenticated,service_role;
create function public.lk_live_company_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;uid uuid;sid uuid;q public.lk_quote_requests;s public.lk_live_quote_submissions;p public.lk_live_company_proposals;b public.lk_live_company_bookings;prior public.lk_live_company_command_receipts;rev integer;key uuid;fingerprint text;snapshot jsonb;target jsonb;segment jsonb;idx integer:=0;v integer;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company booking access denied.';end if;
 if command not in ('staff_prepare_request','staff_confirm_request') then
  -- V2 never publishes a changed-price proposal or requires a fabricated second acceptance.
  if command in ('staff_draft','staff_publish','staff_confirm','customer_review','customer_accept') and exists(select 1 from public.lk_live_quote_submissions x where x.request_id=coalesce(nullif(args->>'requestId',''),nullif(args->>'expectedRequestId',''))::uuid and x.snapshot->>'version'='live-booking-request-ack-v2') then raise exception using errcode='LK409',message='Use the single signed-request booking confirmation for this request.';end if;
  return lk_private.lk_live_company_booking_command_v1(command,args);
 end if;
 uid:=(args->>'actorUserId')::uuid;sid:=(args->>'actorSessionId')::uuid;
 if not lk_private.company_booking_staff_allowed(uid,sid) then raise exception using errcode='LK403',message='Current company staff membership and verification required.';end if;
 if exists(select 1 from jsonb_object_keys(args) k where k not in ('companyId','actorUserId','actorSessionId','requestId','expectedRevision','idempotencyKey','takeOffEndLocal','installStartLocal','installEndLocal','companyNote','calendarCheck')) then raise exception using errcode='LK400',message='Only the installation periods and company note may be changed.';end if;
 rid:=(args->>'requestId')::uuid;
 select * into q from public.lk_quote_requests where id=rid and company_id='lk-group' for update;
 if not found then raise exception using errcode='LK404',message='Saved quote not found.';end if;
 select * into s from public.lk_live_quote_submissions where request_id=rid;
 if not found then raise exception using errcode='LK409',message='The customer must sign and submit the take-off request first.';end if;
 if jsonb_typeof(args->'expectedRevision') is distinct from 'number' or coalesce(args->>'idempotencyKey','')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='A current revision and retry-safe command key are required.';end if;
 key:=(args->>'idempotencyKey')::uuid;
 fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command','staff_confirm_request','args',args-array['companyId','actorUserId','actorSessionId','calendarCheck']));
 select * into prior from public.lk_live_company_command_receipts where request_id=rid and idempotency_key=key;
 if found then
  if prior.command<>'staff_confirm_request' or prior.command_hash<>fingerprint or prior.actor_id<>uid then raise exception using errcode='LK409',message='A retry key was used for different booking details.';end if;
  return public.lk_live_company_state(rid);
 end if;
 select * into b from public.lk_live_company_bookings where request_id=rid;
 if b.id is not null then raise exception using errcode='LK409',message='This request already has an immutable company booking. Use delivery retry instead.';end if;
 select revision into rev from public.lk_live_company_booking_requests where request_id=rid;
 rev:=coalesce(rev,0);
 if (args->>'expectedRevision')::integer<>rev then raise exception using errcode='LK409',message='This company request changed. Reload before confirming.';end if;
 target:=s.snapshot->'calendarTarget';
 if target->>'calendarId' is distinct from 'lnkgroupsydney@gmail.com' or not exists(select 1 from public.lk_google_connection g where g.id=1 and g.account_sub=target->>'accountSub' and lower(g.email)='lnkgroupsydney@gmail.com') then raise exception using errcode='LK409',message='The company Calendar target changed.';end if;
 snapshot:=public.lk_live_company_simple_snapshot(s,args,target);
 p.snapshot:=snapshot;p.snapshot_hash:=public.lk_live_booking_hash(snapshot);
 if command='staff_prepare_request' then return snapshot||jsonb_build_object('hash',p.snapshot_hash);end if;
 if not public.lk_live_company_calendar_proof(p,args->'calendarCheck') then raise exception using errcode='LK409',message='Refresh availability for the complete take-off and installation periods.';end if;
 insert into public.lk_live_company_booking_requests(request_id) values(rid) on conflict do nothing;
 select revision into rev from public.lk_live_company_booking_requests where request_id=rid for update;
 if (args->>'expectedRevision')::integer<>rev then raise exception using errcode='LK409',message='This company request changed. Reload before confirming.';end if;
 select coalesce(max(version),0)+1 into v from public.lk_live_company_proposals where request_id=rid;
 -- Published means immutable, not another customer action or a proposal notice.
 insert into public.lk_live_company_proposals(request_id,submission_id,version,revision,status,snapshot,snapshot_hash,created_by,published_at,published_by) values(rid,s.id,v,rev+1,'published',snapshot,p.snapshot_hash,uid,clock_timestamp(),uid) returning * into p;
 insert into public.lk_live_company_bookings(request_id,proposal_id,acceptance_id,signed_submission_id,confirmation_basis,proposal_hash,version,created_by) values(rid,p.id,null,s.id,'signed_request',p.snapshot_hash,p.version,uid) returning * into b;
 for segment in select value from jsonb_array_elements(snapshot->'segments') loop
  insert into public.lk_live_booking_confirmed_segments(company_id,submission_id,account_sub,calendar_id,start_date,end_date,confirmation_version,booking_id,start_at,end_at) values('lk-group',s.id,target->>'accountSub',target->>'calendarId',(segment->>'startDate')::date,(segment->>'endDate')::date,p.version,b.id,(segment->>'startAt')::timestamptz,(segment->>'endAt')::timestamptz);
  insert into public.lk_live_company_events(booking_id,segment_index,event_id,payload_hash) values(b.id,idx,'b'||encode(sha256(convert_to('lk-company-confirmed-v1:'||b.id::text||':'||p.snapshot_hash||':'||idx::text,'UTF8')),'hex'),'');idx:=idx+1;
 end loop;
 insert into public.lk_live_company_outbox(request_id,proposal_id,kind,email_idempotency_key) values(rid,p.id,'confirmation','company-confirmation:'||b.id::text);
 update public.lk_live_company_booking_requests set revision=revision+1,updated_at=clock_timestamp() where request_id=rid returning revision into rev;
 insert into public.lk_live_company_command_receipts(request_id,idempotency_key,command,command_hash,actor_id) values(rid,key,'staff_confirm_request',fingerprint,uid);
 insert into public.lk_live_company_audit(request_id,action,actor_id,revision,details) values(rid,'staff_confirm_request',uid,rev,jsonb_build_object('proposalId',p.id,'proposalHash',p.snapshot_hash,'signedSubmissionId',s.id,'signedContentHash',s.signed_content_hash,'confirmationBasis','signed_request'));
 return public.lk_live_company_state(rid);
exception when exclusion_violation then raise exception using errcode='LK409',message='The work periods overlap another held company booking. No part of this booking was reserved.';
end;$$;
revoke all on function public.lk_live_booking_simple_ack(),public.lk_live_booking_sydney_instant(text),public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb),public.lk_live_company_booking_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lk_live_booking_simple_ack(),public.lk_live_booking_sydney_instant(text),public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb),public.lk_live_company_booking_command(text,jsonb) to service_role;
commit;
