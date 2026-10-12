-- Live company price/schedule proposals and capacity-one primary Calendar bookings.
-- No published proposal, acknowledgment or original request evidence is overwritten.
begin;
create table public.lk_live_company_booking_requests (
 request_id uuid primary key references public.lk_quote_requests(id),revision integer not null default 0 check(revision>=0),updated_at timestamptz not null default now()
);
create table public.lk_live_company_proposals (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),submission_id uuid not null references public.lk_live_quote_submissions(id),
 version integer not null check(version>0),revision integer not null check(revision>0),status text not null default 'draft' check(status in ('draft','published')),
 snapshot jsonb not null,snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),created_by uuid not null,created_at timestamptz not null default now(),published_at timestamptz,published_by uuid,
 unique(request_id,version),check((status='published')=(published_at is not null))
);
create table public.lk_live_company_acceptances (
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null unique references public.lk_live_company_proposals(id),auth_user_id uuid not null,verified_email text not null,
 proposal_hash text not null,signature jsonb not null,acknowledgment_version text not null,acknowledgment_text text not null,accepted_at timestamptz not null default now(),signed_hash text not null
);
create table public.lk_live_company_bookings (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique references public.lk_quote_requests(id),proposal_id uuid not null references public.lk_live_company_proposals(id),acceptance_id uuid not null references public.lk_live_company_acceptances(id),
 proposal_hash text not null,version integer not null,status text not null default 'confirming' check(status in ('confirming','confirmed','review_required')),error text,confirmed_at timestamptz,
 created_by uuid not null,created_at timestamptz not null default now(),last_calendar_check_at timestamptz
);
create table public.lk_live_company_events (
 booking_id uuid not null references public.lk_live_company_bookings(id),segment_index integer not null,event_id text not null unique,payload_hash text not null,etag text,verified_at timestamptz,
 primary key(booking_id,segment_index)
);
create table public.lk_live_company_outbox (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),proposal_id uuid not null references public.lk_live_company_proposals(id),kind text not null check(kind in ('proposal_notice','acceptance_receipt','confirmation')),
 email_status text not null default 'pending' check(email_status in ('pending','sending','provider_accepted','retrying','failed','outcome_unknown','manual_review')),provider_message_id text,
 email_first_attempt_at timestamptz,email_idempotency_key text not null unique,pdf_base64 text,pdf_hash text,payload jsonb,lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default now(),error text,complete boolean not null default false,
 created_at timestamptz not null default now(),unique(proposal_id,kind),check(email_status<>'provider_accepted' or provider_message_id is not null),
 check((pdf_base64 is null and pdf_hash is null and payload is null) or (pdf_base64 is not null and pdf_hash~'^[a-f0-9]{64}$' and jsonb_typeof(payload)='object'))
);
create table public.lk_live_company_command_receipts (
 request_id uuid not null references public.lk_quote_requests(id),idempotency_key uuid not null,command text not null,command_hash text not null,actor_id uuid not null,created_at timestamptz not null default now(),primary key(request_id,idempotency_key)
);
create table public.lk_live_company_audit (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),action text not null,actor_id uuid,revision integer not null,created_at timestamptz not null default now(),details jsonb not null default '{}'::jsonb
);
-- Legacy date projections remain valid and are backfilled as Sydney all-day UTC periods.
alter table public.lk_live_booking_confirmed_segments add column booking_id uuid references public.lk_live_company_bookings(id),add column start_at timestamptz,add column end_at timestamptz;
update public.lk_live_booking_confirmed_segments set start_at=start_date::timestamp at time zone 'Australia/Sydney',end_at=end_date::timestamp at time zone 'Australia/Sydney';
alter table public.lk_live_booking_confirmed_segments alter column start_at set not null,alter column end_at set not null;
alter table public.lk_live_booking_confirmed_segments add constraint lk_live_company_segment_interval check(end_at>start_at);
-- The approved operating resource is exactly one company primary Calendar.
-- This partial exclusion also includes preexisting primary-calendar projections.
alter table public.lk_live_booking_confirmed_segments add constraint lk_live_primary_period_exclusion exclude using gist(tstzrange(start_at,end_at,'[)') with &&) where(calendar_id='lnkgroupsydney@gmail.com');
create function public.lk_live_company_segment_projection() returns trigger language plpgsql set search_path='' as $$
begin
 if new.start_at is null then new.start_at:=new.start_date::timestamp at time zone 'Australia/Sydney';end if;
 if new.end_at is null then new.end_at:=new.end_date::timestamp at time zone 'Australia/Sydney';end if;
 new.start_date:=(new.start_at at time zone 'Australia/Sydney')::date;
 new.end_date:=((new.end_at-interval '1 microsecond') at time zone 'Australia/Sydney')::date+1;
 return new;
end;$$;
create trigger lk_live_company_segment_projection before insert or update on public.lk_live_booking_confirmed_segments for each row execute function public.lk_live_company_segment_projection();
do $$declare t text;begin
 foreach t in array array['lk_live_company_booking_requests','lk_live_company_proposals','lk_live_company_acceptances','lk_live_company_bookings','lk_live_company_events','lk_live_company_outbox','lk_live_company_command_receipts','lk_live_company_audit'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to service_role',t);
 end loop;
end;$$;
create function public.lk_live_company_ack() returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version','company-price-schedule-ack-v1','text','I confirm the company proposal amount, scope and all work periods shown here. This confirms the proposed price and schedule for company booking review. It is not a contract, work authorisation or payment obligation. Final contractual terms require separate acceptance.');
$$;
-- auth.users remains provider-owned, exposed only through this narrow server predicate.
create function lk_private.company_booking_staff_allowed(uid uuid,sid uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare meta jsonb;email text;token text;ms bigint;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or not lk_private.staff_session_active(sid,uid) then return false;end if;
 select u.raw_app_meta_data,u.email into meta,email from auth.users u where u.id=uid;
 if meta->'lk_staff'->>'company_id' is distinct from 'lk-group' or coalesce(meta->'lk_staff'->>'role','') not in ('admin','owner') or meta->'lk_staff'->>'status' is distinct from 'active' or meta->'lk_staff_password_change_required' is distinct from 'false'::jsonb then return false;end if;
 token:=encode(sha256(convert_to('staff:'||sid::text,'UTF8')),'hex');ms:=(extract(epoch from clock_timestamp())*1000)::bigint;
 return exists(select 1 from public.lk_sessions s join public.lk_staff_email_checks c on c.token_hash=s.token_hash where s.token_hash=token and s.mode='staff' and s.account_sub=uid::text and s.expires_at>ms and c.user_id=uid and c.status='verified' and c.verified_until>ms and c.email_hash=encode(sha256(convert_to(lower(btrim(email)),'UTF8')),'hex'));
end;$$;
create function public.lk_live_company_proposal_json(p public.lk_live_company_proposals) returns jsonb language sql stable set search_path='' as $$
 select p.snapshot||jsonb_build_object('id',p.id,'version',p.version,'revision',p.revision,'status',p.status,'hash',p.snapshot_hash,'createdAt',p.created_at,'publishedAt',p.published_at,
 'emailStatus',coalesce((select o.email_status from public.lk_live_company_outbox o where o.proposal_id=p.id and o.kind='proposal_notice'),'pending'),'receiptReady',exists(select 1 from public.lk_live_company_outbox o where o.proposal_id=p.id and o.kind='proposal_notice' and o.pdf_base64 is not null));
$$;
create function public.lk_live_company_acceptance_json(a public.lk_live_company_acceptances) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',a.id,'proposalId',a.proposal_id,'proposalHash',a.proposal_hash,'acceptedAt',a.accepted_at,'signature',a.signature,'acknowledgmentVersion',a.acknowledgment_version,'acknowledgmentText',a.acknowledgment_text,'emailStatus',coalesce((select o.email_status from public.lk_live_company_outbox o where o.proposal_id=a.proposal_id and o.kind='acceptance_receipt'),'pending'),'receiptReady',exists(select 1 from public.lk_live_company_outbox o where o.proposal_id=a.proposal_id and o.kind='acceptance_receipt' and o.pdf_base64 is not null));
$$;
create function public.lk_live_company_booking_json(b public.lk_live_company_bookings) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'proposalId',b.proposal_id,'proposalHash',b.proposal_hash,'version',b.version,'status',b.status,'error',b.error,'confirmedAt',b.confirmed_at,'emailStatus',coalesce((select o.email_status from public.lk_live_company_outbox o where o.proposal_id=b.proposal_id and o.kind='confirmation'),'pending'),'receiptReady',exists(select 1 from public.lk_live_company_outbox o where o.proposal_id=b.proposal_id and o.kind='confirmation' and o.pdf_base64 is not null),'events',(select coalesce(jsonb_agg(jsonb_build_object('segmentIndex',e.segment_index,'eventId',e.event_id,'payloadHash',e.payload_hash,'etag',e.etag,'verifiedAt',e.verified_at) order by e.segment_index),'[]'::jsonb) from public.lk_live_company_events e where e.booking_id=b.id));
$$;
create function public.lk_live_company_state(rid uuid,customer boolean default false) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('requestId',rid,'revision',coalesce((select q.revision from public.lk_live_company_booking_requests q where q.request_id=rid),0),'submission',(select public.lk_live_booking_submission_json(s) from public.lk_live_quote_submissions s where s.request_id=rid),
 'proposal',(select public.lk_live_company_proposal_json(p) from public.lk_live_company_proposals p where p.request_id=rid and (not customer or p.status='published') order by p.version desc limit 1),
 'proposals',(select coalesce(jsonb_agg(public.lk_live_company_proposal_json(p) order by p.version desc),'[]'::jsonb) from public.lk_live_company_proposals p where p.request_id=rid and (not customer or p.status='published')),
 'acceptance',(select public.lk_live_company_acceptance_json(a) from public.lk_live_company_acceptances a join public.lk_live_company_proposals p on p.id=a.proposal_id where p.request_id=rid order by p.version desc limit 1),'booking',(select public.lk_live_company_booking_json(b) from public.lk_live_company_bookings b where b.request_id=rid),'acknowledgment',public.lk_live_company_ack());
$$;
create function public.lk_live_company_claim_json(o public.lk_live_company_outbox) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',o.id,'kind',o.kind,'requestId',o.request_id,'leaseToken',o.lease_token,'leaseExpiresAt',o.lease_expires_at,'emailStatus',o.email_status,'emailIdempotencyKey',o.email_idempotency_key,'emailFirstAttemptAt',o.email_first_attempt_at,'frozenMail',case when o.pdf_base64 is null then null else jsonb_build_object('pdfBase64',o.pdf_base64,'pdfHash',o.pdf_hash,'payload',o.payload) end,'proposal',(select public.lk_live_company_proposal_json(p) from public.lk_live_company_proposals p where p.id=o.proposal_id),'acceptance',(select public.lk_live_company_acceptance_json(a) from public.lk_live_company_acceptances a where a.proposal_id=o.proposal_id),'booking',(select public.lk_live_company_booking_json(b) from public.lk_live_company_bookings b where b.proposal_id=o.proposal_id),'submission',(select public.lk_live_booking_submission_json(s) from public.lk_live_quote_submissions s where s.request_id=o.request_id));
$$;
create function public.lk_live_company_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='lk_live_company_proposals' then
  if old.status='published' and new is distinct from old then raise exception using errcode='LK409',message='Published company proposals are immutable.';end if;
  if new.snapshot is distinct from old.snapshot or new.snapshot_hash is distinct from old.snapshot_hash or new.version<>old.version or new.request_id<>old.request_id or new.submission_id<>old.submission_id then raise exception using errcode='LK409',message='Save a new company proposal version.';end if;
 elsif tg_table_name='lk_live_company_outbox' then
  if old.pdf_base64 is not null and (new.pdf_base64 is distinct from old.pdf_base64 or new.pdf_hash is distinct from old.pdf_hash or new.payload is distinct from old.payload) then raise exception using errcode='LK409',message='Frozen company email evidence cannot change.';end if;
 elsif new is distinct from old then raise exception using errcode='LK409',message='Customer proposal acceptance is immutable.';
 end if;return new;
end;$$;
create trigger lk_live_company_proposal_immutable before update on public.lk_live_company_proposals for each row execute function public.lk_live_company_immutable();
create trigger lk_live_company_acceptance_immutable before update on public.lk_live_company_acceptances for each row execute function public.lk_live_company_immutable();
create trigger lk_live_company_mail_immutable before update on public.lk_live_company_outbox for each row execute function public.lk_live_company_immutable();
create function public.lk_live_company_calendar_proof(p public.lk_live_company_proposals,proof jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(jsonb_typeof(proof)='object' and proof->>'accountSub'=p.snapshot->'calendarTarget'->>'accountSub' and proof->>'calendarId'=p.snapshot->'calendarTarget'->>'calendarId' and proof->>'proposalHash'=p.snapshot_hash and jsonb_typeof(proof->'conflicts')='array' and jsonb_array_length(proof->'conflicts')=0 and jsonb_typeof(proof->'checkedAt')='string' and jsonb_typeof(proof->'expiresAt')='string' and (proof->>'checkedAt')::timestamptz<=clock_timestamp()+interval '5 seconds' and (proof->>'checkedAt')::timestamptz>clock_timestamp()-interval '2 minutes' and (proof->>'expiresAt')::timestamptz>clock_timestamp() and (proof->>'expiresAt')::timestamptz<=clock_timestamp()+interval '3 minutes' and length(proof->>'revision') between 1 and 256 and exists(select 1 from public.lk_google_connection g where g.id=1 and g.account_sub=p.snapshot->'calendarTarget'->>'accountSub' and lower(g.email)='lnkgroupsydney@gmail.com'),false);
$$;
create function public.lk_live_company_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 rid uuid;uid uuid;sid uuid;rev integer;key uuid;fingerprint text;prior public.lk_live_company_command_receipts;
 q public.lk_quote_requests;s public.lk_live_quote_submissions;p public.lk_live_company_proposals;a public.lk_live_company_acceptances;b public.lk_live_company_bookings;o public.lk_live_company_outbox;
 snapshot jsonb;target jsonb;resolved jsonb;segment jsonb;startvalue timestamptz;endvalue timestamptz;amount bigint;gst bigint;v integer;idx integer;skipcount integer:=0;ack jsonb:=public.lk_live_company_ack();customer boolean:=false;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company booking access denied.';end if;
 if command='occupancy' then
  return jsonb_build_object('segments',(select coalesce(jsonb_agg(jsonb_build_object('bookingId',x.booking_id,'startAt',x.start_at,'endAt',x.end_at)),'[]'::jsonb) from public.lk_live_booking_confirmed_segments x where x.account_sub=args->>'accountSub' and x.calendar_id=args->>'calendarId' and (args->>'ignoreBookingId' is null or x.booking_id is distinct from (args->>'ignoreBookingId')::uuid)));
 end if;
 if command='reconcile_batch' then return jsonb_build_object('states',(select coalesce(jsonb_agg(public.lk_live_company_state(x.request_id)),'[]'::jsonb) from (select b1.request_id from public.lk_live_company_bookings b1 where b1.status in ('confirmed','review_required') and exists(select 1 from public.lk_live_booking_confirmed_segments x1 where x1.booking_id=b1.id and x1.end_at>clock_timestamp()) order by b1.last_calendar_check_at nulls first,b1.created_at limit 5)x));end if;
 if command='worker_batch' then return jsonb_build_object('requestIds',(select coalesce(jsonb_agg(x.request_id),'[]'::jsonb) from (select distinct o1.request_id from public.lk_live_company_outbox o1 where not o1.complete and o1.email_status not in ('failed','manual_review') and o1.next_attempt_at<=clock_timestamp() and (o1.lease_expires_at is null or o1.lease_expires_at<=clock_timestamp()) and (o1.kind<>'confirmation' or exists(select 1 from public.lk_live_company_bookings b1 where b1.proposal_id=o1.proposal_id and b1.status in ('confirming','confirmed'))) limit 10)x));end if;
 if command='worker_claim' then
  loop
   select * into o from public.lk_live_company_outbox x where not x.complete and x.email_status not in ('failed','manual_review') and x.next_attempt_at<=clock_timestamp() and (x.lease_expires_at is null or x.lease_expires_at<=clock_timestamp())
    and (args->>'outboxId' is null or x.id=(args->>'outboxId')::uuid) and (args->>'requestId' is null or x.request_id=(args->>'requestId')::uuid)
    and (x.kind<>'confirmation' or exists(select 1 from public.lk_live_company_bookings y where y.proposal_id=x.proposal_id and y.status in ('confirming','confirmed')))
    order by x.created_at,case x.kind when 'proposal_notice' then 0 when 'acceptance_receipt' then 1 else 2 end,x.id for update skip locked limit 1;
   if not found then return null;end if;
   if o.email_status<>'provider_accepted' and o.email_first_attempt_at<clock_timestamp()-interval '23 hours' then
    update public.lk_live_company_outbox set email_status='manual_review',error='Email outcome needs provider review.',lease_token=null,lease_expires_at=null where id=o.id;
    skipcount:=skipcount+1;if args->>'outboxId' is not null or skipcount>=10 then return null;end if;continue;
   end if;
   update public.lk_live_company_outbox set lease_token=(args->>'leaseToken')::uuid,lease_expires_at=clock_timestamp()+interval '4 minutes' where id=o.id returning * into o;
   return public.lk_live_company_claim_json(o);
  end loop;
 end if;
 if command in ('freeze_mail','mail_result','email_attempt','record_event','finish_calendar','worker_error','assert_lease') then
  select * into o from public.lk_live_company_outbox where id=(args->>'id')::uuid for update;
  if not found or o.lease_token is distinct from (args->>'leaseToken')::uuid or o.lease_expires_at<=clock_timestamp() then raise exception using errcode='LK409',message='Company delivery lease changed.';end if;
  select * into p from public.lk_live_company_proposals where id=o.proposal_id;
  select * into s from public.lk_live_quote_submissions where request_id=o.request_id;
  select * into b from public.lk_live_company_bookings where proposal_id=p.id for update;
  if command='assert_lease' and o.kind='confirmation' and (b.status not in ('confirming','confirmed') or b.proposal_id is distinct from p.id or b.proposal_hash is distinct from p.snapshot_hash) then raise exception using errcode='LK409',message='Company booking changed and requires Calendar review.';end if;
  if command='assert_lease' then return public.lk_live_company_claim_json(o);end if;
  if command='freeze_mail' then
   if o.kind='confirmation' and b.status is distinct from 'confirmed' then raise exception using errcode='LK409',message='Verify all Calendar work periods before preparing confirmation mail.';end if;
   if args->'payload'->'to' is distinct from jsonb_build_array(s.verified_email) then raise exception using errcode='LK403',message='The frozen recipient must match the verified quote.';end if;
   if args->>'pdfBase64' is null or length(args->>'pdfBase64')>12000000 or encode(sha256(decode(args->>'pdfBase64','base64')),'hex') is distinct from args->>'pdfHash' then raise exception using errcode='LK400',message='Invalid frozen company PDF.';end if;
   if o.pdf_base64 is not null and (o.pdf_base64 is distinct from args->>'pdfBase64' or o.pdf_hash is distinct from args->>'pdfHash' or o.payload is distinct from args->'payload') then raise exception using errcode='LK409',message='Frozen company notice cannot change.';end if;
   update public.lk_live_company_outbox set pdf_base64=args->>'pdfBase64',pdf_hash=args->>'pdfHash',payload=args->'payload' where id=o.id returning * into o;
  elsif command='email_attempt' then
   if o.kind='confirmation' and (b.status is distinct from 'confirmed' or b.proposal_id is distinct from p.id or b.proposal_hash is distinct from p.snapshot_hash) then raise exception using errcode='LK409',message='Company booking requires Calendar review before any confirmation email attempt.';end if;
   if o.pdf_base64 is null or o.email_status='provider_accepted' then raise exception using errcode='LK409',message='Prepare the original email before sending.';end if;
   if o.email_first_attempt_at<clock_timestamp()-interval '23 hours' then raise exception using errcode='LK409',message='Review the original provider outcome before retrying.';end if;
   update public.lk_live_company_outbox set email_first_attempt_at=coalesce(email_first_attempt_at,clock_timestamp()),email_status='sending' where id=o.id returning * into o;
  elsif command='mail_result' then
   if o.pdf_base64 is null or o.email_first_attempt_at is null or coalesce(length(args->>'providerMessageId'),0) not between 1 and 200 or (o.provider_message_id is not null and o.provider_message_id is distinct from args->>'providerMessageId') then raise exception using errcode='LK409',message='Company email outcome changed.';end if;
   update public.lk_live_company_outbox set email_status='provider_accepted',provider_message_id=args->>'providerMessageId',complete=true,lease_token=null,lease_expires_at=null,error=null where id=o.id returning * into o;
  elsif command='record_event' then
   if o.kind<>'confirmation' or b.status<>'confirming' or coalesce(args->>'payloadHash','')!~'^[a-f0-9]{64}$' or coalesce(length(args->>'etag'),0)=0 then raise exception using errcode='LK409',message='Company Calendar event does not match active booking.';end if;
   update public.lk_live_company_events set payload_hash=args->>'payloadHash',etag=args->>'etag',verified_at=clock_timestamp() where booking_id=b.id and segment_index=(args->>'segmentIndex')::integer and event_id=args->>'eventId' and (verified_at is null or payload_hash=args->>'payloadHash');
   if not found then raise exception using errcode='LK409',message='Company Calendar event manifest changed.';end if;
  elsif command='finish_calendar' then
   if o.kind<>'confirmation' or b.status<>'confirming' or not public.lk_live_company_calendar_proof(p,args->'calendarCheck') or (select count(*) from public.lk_live_company_events e where e.booking_id=b.id and e.verified_at is not null and e.etag is not null)<>jsonb_array_length(p.snapshot->'segments') then raise exception using errcode='LK409',message='All work periods and final availability must be independently verified.';end if;
   update public.lk_live_company_bookings set status='confirmed',error=null,confirmed_at=clock_timestamp() where id=b.id;
  elsif command='worker_error' then
   if args->>'outcome' not in ('retrying','manual_review','failed') or args->>'stage' not in ('email','calendar') then raise exception using errcode='LK400',message='Invalid delivery outcome.';end if;
   update public.lk_live_company_outbox set email_status=case when args->>'stage'='email' then args->>'outcome' else email_status end,error=left(args->>'error',500),next_attempt_at=clock_timestamp()+interval '1 minute',lease_token=null,lease_expires_at=null where id=o.id returning * into o;
   if args->>'stage'='calendar' and args->>'outcome' in ('manual_review','failed') then update public.lk_live_company_bookings set status='review_required',error=left(args->>'error',500) where id=b.id;end if;
  end if;
  return public.lk_live_company_claim_json(o);
 end if;
 if command='reconcile_result' then
  select * into b from public.lk_live_company_bookings where id=(args->>'bookingId')::uuid for update;
  if not found then raise exception using errcode='LK404',message='Company booking not found.';end if;
  update public.lk_live_company_bookings set last_calendar_check_at=clock_timestamp() where id=b.id;
  if args->'ok' is distinct from 'true'::jsonb then update public.lk_live_company_bookings set status='review_required',error=left(args->>'error',500) where id=b.id returning * into b;end if;
  return public.lk_live_company_state(b.request_id);
 end if;
 if command like 'staff_%' then
  uid:=(args->>'actorUserId')::uuid;sid:=(args->>'actorSessionId')::uuid;
  if not lk_private.company_booking_staff_allowed(uid,sid) then raise exception using errcode='LK403',message='Current company staff membership and verification required.';end if;
  if command='staff_list' then return coalesce((select jsonb_agg(public.lk_live_company_state(s1.request_id) order by s1.submitted_at desc) from public.lk_live_quote_submissions s1),'[]'::jsonb);end if;
  rid:=(args->>'requestId')::uuid;
 else
  if command not in ('customer_state','customer_review','customer_accept','customer_document') or jsonb_typeof(args->'customerAccess') is distinct from 'object' then raise exception using errcode='LK403',message='Verified saved quote access required.';end if;
  customer:=true;resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
  if resolved->>'hash' is distinct from args->>'ownerHash' or args->'customerAccess'->>'requestId' is distinct from args->>'expectedRequestId' then raise exception using errcode='LK403',message='Saved quote access changed.';end if;
  rid:=(args->>'expectedRequestId')::uuid;uid:=(args->'customerAccess'->>'authUserId')::uuid;
  if not exists(select 1 from public.lk_quote_customer_sessions c where c.id=(args->'customerAccess'->>'sessionId')::uuid and public.lk_quote_customer_auth_session_active(c.auth_session_id,uid)) then raise exception using errcode='LK401',message='Verify your customer email again.';end if;
 end if;
 select * into q from public.lk_quote_requests where id=rid for update;
 if not found then raise exception using errcode='LK404',message='Saved quote not found.';end if;
 select * into s from public.lk_live_quote_submissions where request_id=rid;
 if not found then if command in ('customer_state','staff_state') then return null;end if;raise exception using errcode='LK409',message='Submit the original booking request before company review.';end if;
 insert into public.lk_live_company_booking_requests(request_id) values(rid) on conflict do nothing;
 select revision into rev from public.lk_live_company_booking_requests where request_id=rid for update;
 select * into p from public.lk_live_company_proposals where request_id=rid order by version desc limit 1;
 select * into b from public.lk_live_company_bookings where request_id=rid;
 if command in ('customer_state','staff_state') then return public.lk_live_company_state(rid,customer);end if;
 if command in ('customer_document','staff_document') then
  select * into o from public.lk_live_company_outbox where request_id=rid and kind=case args->>'kind' when 'proposal' then 'proposal_notice' when 'acceptance' then 'acceptance_receipt' when 'confirmation' then 'confirmation' end and pdf_base64 is not null order by created_at desc limit 1;
  if not found then raise exception using errcode='LK404',message='The saved company PDF is not ready yet.';end if;
  return jsonb_build_object('pdfBase64',o.pdf_base64,'pdfHash',o.pdf_hash,'filename',s.reference||'-'||(args->>'kind')||'.pdf');
 end if;
 if command='staff_retry' then
  update public.lk_live_company_outbox set next_attempt_at=clock_timestamp() where request_id=rid and not complete and email_status in ('pending','sending','retrying','outcome_unknown','provider_accepted');
  return public.lk_live_company_state(rid);
 end if;
 if command='customer_review' then
  if exists(select 1 from jsonb_array_elements(p.snapshot->'segments') x where (x->>'startAt')::timestamptz<=clock_timestamp()) then raise exception using errcode='LK409',message='Past work periods require a new company proposal.';end if;
  if p.id is distinct from (args->>'proposalId')::uuid or p.status<>'published' or p.snapshot_hash is distinct from args->>'proposalHash' or b.id is not null then raise exception using errcode='LK409',message='The company proposal changed. Review the current price and all work periods.';end if;
  return jsonb_build_object('proposal',public.lk_live_company_proposal_json(p),'acknowledgment',ack);
 end if;
 if command='staff_check' then
  if p.id is distinct from (args->>'proposalId')::uuid or p.snapshot_hash is distinct from args->>'proposalHash' then raise exception using errcode='LK409',message='Reload the current company proposal.';end if;return public.lk_live_company_state(rid);
 end if;
 if command not in ('staff_draft','staff_publish','staff_confirm','customer_accept') then raise exception using errcode='LK400',message='Invalid company booking command.';end if;
 key:=(args->>'idempotencyKey')::uuid;if key is null then raise exception using errcode='LK400',message='A retry-safe command key is required.';end if;
 fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',command,'args',args-array['companyId','actorUserId','actorSessionId','customerAccess','ownerHash','expectedRequestId','calendarCheck','reviewExpiresAt']));
 select * into prior from public.lk_live_company_command_receipts where request_id=rid and idempotency_key=key;
 if found then if prior.command_hash<>fingerprint or prior.actor_id<>uid then raise exception using errcode='LK409',message='A retry key was used for different company booking details.';end if;return public.lk_live_company_state(rid,customer);end if;
 if command='customer_accept' then
  select * into a from public.lk_live_company_acceptances where proposal_id=p.id;
  if a.id is not null and p.id=(args->>'proposalId')::uuid and p.snapshot_hash=args->>'proposalHash' and a.signature=args->'signature' and a.auth_user_id=uid then return public.lk_live_company_state(rid,true);end if;
  if a.id is not null then raise exception using errcode='LK409',message='This proposal already has an immutable customer acknowledgment.';end if;
  if exists(select 1 from jsonb_array_elements(p.snapshot->'segments') x where (x->>'startAt')::timestamptz<=clock_timestamp()) then raise exception using errcode='LK409',message='Past work periods require a new company proposal.';end if;
  if p.id is distinct from (args->>'proposalId')::uuid or p.status<>'published' or p.snapshot_hash is distinct from args->>'proposalHash' or b.id is not null or jsonb_typeof(args->'reviewExpiresAt') is distinct from 'string' or (args->>'reviewExpiresAt')::timestamptz<=clock_timestamp() or (args->>'reviewExpiresAt')::timestamptz>clock_timestamp()+interval '16 minutes' then raise exception using errcode='LK409',message='Review the current company proposal and all work periods again.';end if;
  if not public.lk_live_booking_signature_valid(args->'signature') then raise exception using errcode='LK400',message='A valid name, signature and acknowledgment are required.';end if;
  insert into public.lk_live_company_acceptances(proposal_id,auth_user_id,verified_email,proposal_hash,signature,acknowledgment_version,acknowledgment_text,signed_hash) values(p.id,uid,s.verified_email,p.snapshot_hash,args->'signature',ack->>'version',ack->>'text',public.lk_live_booking_hash(jsonb_build_object('proposal',p.snapshot,'signature',args->'signature','acknowledgment',ack))) returning * into a;
  insert into public.lk_live_company_outbox(request_id,proposal_id,kind,email_idempotency_key) values(rid,p.id,'acceptance_receipt','company-acceptance:'||a.id::text);
 elsif command='staff_draft' then
  if b.id is not null then raise exception using errcode='LK409',message='A booking already holds work periods. Its proposal cannot change.';end if;
  if jsonb_typeof(args->'expectedRevision') is distinct from 'number' or (args->>'expectedRevision')::integer<>rev then raise exception using errcode='LK409',message='This company booking changed. Reload before saving.';end if;
  snapshot:=args->'proposal';amount:=(snapshot->>'amountExGst')::bigint;
  if jsonb_typeof(snapshot) is distinct from 'object' or jsonb_typeof(snapshot->'amountExGst') is distinct from 'number' or amount<1 or amount>100000000 or (snapshot->>'amountExGst')::numeric<>amount or jsonb_typeof(snapshot->'scope') is distinct from 'string' or length(btrim(snapshot->>'scope')) not between 1 and 5000 or jsonb_typeof(snapshot->'adjustmentReason') is distinct from 'string' or length(btrim(snapshot->>'adjustmentReason')) not between 1 and 3000 or jsonb_typeof(snapshot->'segments') is distinct from 'array' or jsonb_array_length(snapshot->'segments') not between 1 and 20 then raise exception using errcode='LK400',message='Enter a valid final price, scope, reason and actual work periods.';end if;
  target:=args->'calendarTarget';if target->>'calendarId' is distinct from 'lnkgroupsydney@gmail.com' or not exists(select 1 from public.lk_google_connection g where g.id=1 and g.account_sub=target->>'accountSub' and lower(g.email)='lnkgroupsydney@gmail.com') then raise exception using errcode='LK409',message='The company Calendar target changed.';end if;
  for segment in select value from jsonb_array_elements(snapshot->'segments') loop
   startvalue:=(segment->>'startAt')::timestamptz;endvalue:=(segment->>'endAt')::timestamptz;
   if startvalue is null or endvalue is null or not isfinite(startvalue) or not isfinite(endvalue) or startvalue<=clock_timestamp() or endvalue<=startvalue or endvalue-startvalue>interval '90 days' or coalesce(segment->>'kind','') not in ('all_day','timed') or jsonb_typeof(segment->'startDate') is distinct from 'string' or jsonb_typeof(segment->'endDate') is distinct from 'string' or (segment->>'startDate')::date<>(startvalue at time zone 'Australia/Sydney')::date or (segment->>'endDate')::date<>((endvalue-interval '1 microsecond') at time zone 'Australia/Sydney')::date+1 then raise exception using errcode='LK400',message='Enter valid future Sydney work periods.';end if;
   if segment->>'kind'='all_day' and (startvalue is distinct from (segment->>'startDate')::date::timestamp at time zone 'Australia/Sydney' or endvalue is distinct from (segment->>'endDate')::date::timestamp at time zone 'Australia/Sydney') then raise exception using errcode='LK400',message='All-day periods must use Sydney midnight boundaries.';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(snapshot->'segments') with ordinality x(s,i) join jsonb_array_elements(snapshot->'segments') with ordinality y(s,i) on x.i<y.i where tstzrange((x.s->>'startAt')::timestamptz,(x.s->>'endAt')::timestamptz,'[)')&&tstzrange((y.s->>'startAt')::timestamptz,(y.s->>'endAt')::timestamptz,'[)')) then raise exception using errcode='LK400',message='Work periods cannot overlap each other.';end if;
  gst:=round(amount*0.1);v:=coalesce(p.version,0)+1;
  snapshot:=snapshot||jsonb_build_object('gst',gst,'total',amount+gst,'currency','AUD','calendarTarget',target);
  insert into public.lk_live_company_proposals(request_id,submission_id,version,revision,snapshot,snapshot_hash,created_by) values(rid,s.id,v,rev+1,snapshot,public.lk_live_booking_hash(snapshot),uid) returning * into p;
 elsif command in ('staff_publish','staff_confirm') then
  if command='staff_confirm' and b.id is not null then
   if b.proposal_id=(args->>'proposalId')::uuid and b.proposal_hash=args->>'proposalHash' then return public.lk_live_company_state(rid);end if;raise exception using errcode='LK409',message='An existing booking holds a different company proposal.';
  end if;
  if b.id is not null or (args->>'expectedRevision')::integer is distinct from rev or p.id is distinct from (args->>'proposalId')::uuid or p.snapshot_hash is distinct from args->>'proposalHash' or not public.lk_live_company_calendar_proof(p,args->'calendarCheck') then raise exception using errcode='LK409',message='Refresh the proposal and check all Calendar work periods before continuing.';end if;
  if exists(select 1 from jsonb_array_elements(p.snapshot->'segments') x where (x->>'startAt')::timestamptz<=clock_timestamp()) then raise exception using errcode='LK409',message='Past work periods require a new company proposal.';end if;
  if command='staff_publish' then
   if p.status<>'draft' then raise exception using errcode='LK409',message='This proposal was already published.';end if;
   update public.lk_live_company_proposals set status='published',published_at=clock_timestamp(),published_by=uid where id=p.id returning * into p;
   insert into public.lk_live_company_outbox(request_id,proposal_id,kind,email_idempotency_key) values(rid,p.id,'proposal_notice','company-proposal:'||p.id::text);
  else
   select * into a from public.lk_live_company_acceptances where proposal_id=p.id;
   if p.status<>'published' or a.id is null or a.proposal_hash<>p.snapshot_hash or not exists(select 1 from public.lk_live_company_outbox x where x.proposal_id=p.id and x.kind='acceptance_receipt' and x.email_status='provider_accepted') then raise exception using errcode='LK409',message='The customer must acknowledge this exact price and all periods, and their receipt must be accepted before confirmation.';end if;
   insert into public.lk_live_company_bookings(request_id,proposal_id,acceptance_id,proposal_hash,version,created_by) values(rid,p.id,a.id,p.snapshot_hash,p.version,uid) returning * into b;
   idx:=0;
   for segment in select value from jsonb_array_elements(p.snapshot->'segments') loop
    insert into public.lk_live_booking_confirmed_segments(company_id,submission_id,account_sub,calendar_id,start_date,end_date,confirmation_version,booking_id,start_at,end_at) values('lk-group',s.id,p.snapshot->'calendarTarget'->>'accountSub',p.snapshot->'calendarTarget'->>'calendarId',(segment->>'startDate')::date,(segment->>'endDate')::date,p.version,b.id,(segment->>'startAt')::timestamptz,(segment->>'endAt')::timestamptz);
    insert into public.lk_live_company_events(booking_id,segment_index,event_id,payload_hash) values(b.id,idx,'b'||encode(sha256(convert_to('lk-company-confirmed-v1:'||b.id::text||':'||p.snapshot_hash||':'||idx::text,'UTF8')),'hex'),'');idx:=idx+1;
   end loop;
   insert into public.lk_live_company_outbox(request_id,proposal_id,kind,email_idempotency_key) values(rid,p.id,'confirmation','company-confirmation:'||b.id::text);
  end if;
 end if;
 update public.lk_live_company_booking_requests set revision=revision+1,updated_at=clock_timestamp() where request_id=rid returning revision into rev;
 insert into public.lk_live_company_command_receipts(request_id,idempotency_key,command,command_hash,actor_id) values(rid,key,command,fingerprint,uid);
 insert into public.lk_live_company_audit(request_id,action,actor_id,revision,details) values(rid,command,uid,rev,jsonb_build_object('proposalId',p.id,'proposalHash',p.snapshot_hash));
 return public.lk_live_company_state(rid,customer);
exception when exclusion_violation then raise exception using errcode='LK409',message='The work periods overlap another held company booking. No part of this booking was reserved.';
end;$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname like 'lk_live_company_%') or (n.nspname='lk_private' and p.proname='company_booking_staff_allowed') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;$$;
grant execute on function public.lk_live_company_booking_command(text,jsonb) to service_role;
commit;
