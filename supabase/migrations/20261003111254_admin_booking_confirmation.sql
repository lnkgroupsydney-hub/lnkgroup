-- Company-only demonstration booking proposals. Original submitted evidence stays immutable.
begin;
create table public.lk_bookings (
  id uuid primary key references public.lk_quote_submissions(id),
  revision integer not null default 0 check(revision>=0),
  calendar_id text not null,
  resource_id text not null default 'demo-single-resource' check(resource_id='demo-single-resource'),
  status text not null default 'requested' check(status in ('requested','confirmed')),
  confirmed_proposal_id uuid,pending_proposal_id uuid,
  sync_status text not null default 'pending' check(sync_status in ('pending','synced','retrying','review_required')),
  confirmed_at timestamptz,updated_at timestamptz not null default now()
);
create table public.lk_booking_proposals (
  id uuid primary key,booking_id uuid not null references public.lk_bookings(id),revision integer not null check(revision>0),
  idempotency_key text not null unique,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
  snapshot jsonb not null,snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),segments jsonb not null,notes text not null,
  actor_hash text not null,created_at timestamptz not null default now(),
  signature jsonb,consented_at timestamptz,consent_key text unique,consent_hash text,
  email_status text not null default 'pending' check(email_status in ('pending','sending','provider_accepted','retrying','failed','outcome_unknown')),
  email_payload jsonb,email_first_attempt_at timestamptz,email_provider_id text,email_accepted_at timestamptz,email_attempts integer not null default 0,
  error_code text,retry_after timestamptz not null default now(),lease_holder text,lease_generation integer not null default 0,lease_until timestamptz,
  confirmed_at timestamptz,confirm_key text unique,confirm_hash text,
  unique(booking_id,revision),check((signature is null)=(consented_at is null)),
  check((email_status='provider_accepted')=(email_provider_id is not null))
);
alter table public.lk_bookings add constraint lk_bookings_confirmed_proposal foreign key(confirmed_proposal_id) references public.lk_booking_proposals(id);
alter table public.lk_bookings add constraint lk_bookings_pending_proposal foreign key(pending_proposal_id) references public.lk_booking_proposals(id);
create table public.lk_booking_segments (
  booking_id uuid not null references public.lk_bookings(id),segment_id text not null,
  start_at timestamptz not null,end_at timestamptz not null,primary key(booking_id,segment_id),check(end_at>start_at),
  -- The only resource in this demo has capacity one, including concurrent SQL writers.
  exclude using gist(tstzrange(start_at,end_at,'[)') with &&)
);
create table public.lk_booking_outbox (
  booking_id uuid primary key references public.lk_bookings(id),revision integer not null,proposal_id uuid not null references public.lk_booking_proposals(id),updated_at timestamptz not null default now()
);
create index lk_booking_proposals_work on public.lk_booking_proposals(retry_after,created_at) where consented_at is not null and email_status in ('pending','sending','retrying');
create index lk_booking_proposals_booking on public.lk_booking_proposals(booking_id);
do $$declare t text;begin
  foreach t in array array['lk_bookings','lk_booking_proposals','lk_booking_segments','lk_booking_outbox'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end$$;
create function public.lk_booking_evidence_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if row(new.id,new.booking_id,new.revision,new.idempotency_key,new.request_hash,new.snapshot,new.snapshot_hash,new.segments,new.notes,new.actor_hash,new.created_at)
    is distinct from row(old.id,old.booking_id,old.revision,old.idempotency_key,old.request_hash,old.snapshot,old.snapshot_hash,old.segments,old.notes,old.actor_hash,old.created_at)
    or (old.signature is not null and row(new.signature,new.consented_at,new.consent_key,new.consent_hash) is distinct from row(old.signature,old.consented_at,old.consent_key,old.consent_hash))
    or (old.email_payload is not null and new.email_payload is distinct from old.email_payload)
    or (old.email_first_attempt_at is not null and new.email_first_attempt_at is distinct from old.email_first_attempt_at)
    or (old.email_provider_id is not null and new.email_provider_id is distinct from old.email_provider_id)
    or (old.confirmed_at is not null and row(new.confirmed_at,new.confirm_key,new.confirm_hash) is distinct from row(old.confirmed_at,old.confirm_key,old.confirm_hash)) then
    raise exception using errcode='LK409',message='Booking evidence cannot be changed';
  end if;return new;
end$$;
revoke all on function public.lk_booking_evidence_guard() from public,anon,authenticated;
grant execute on function public.lk_booking_evidence_guard() to service_role;
create trigger lk_booking_proposal_immutable before update on public.lk_booking_proposals for each row execute function public.lk_booking_evidence_guard();

create function public.lk_booking_detail(booking_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'submission',jsonb_build_object('id',s.id,'reference',s.reference,'snapshot',s.snapshot,'snapshotHash',s.snapshot_hash,'signature',s.signature,'submittedAt',s.submitted_at,'emailStatus',s.email_status,'calendarStatus',coalesce(e.calendar_status,'blocked')),
 'booking',jsonb_build_object('id',s.id,'revision',coalesce(b.revision,0),'status',coalesce(b.status,'requested'),'syncStatus',coalesce(b.sync_status,'pending'),'confirmedProposalId',b.confirmed_proposal_id,'pendingProposalId',b.pending_proposal_id,'confirmedAt',b.confirmed_at),
 'proposals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision,'snapshot',p.snapshot,'snapshotHash',p.snapshot_hash,'segments',p.segments,'notes',p.notes,'createdAt',p.created_at,'signature',p.signature,'consentedAt',p.consented_at,'emailStatus',p.email_status,'emailError',p.error_code,'confirmedAt',p.confirmed_at) order by p.revision desc) from public.lk_booking_proposals p where p.booking_id=s.id),'[]'::jsonb)
) from public.lk_quote_submissions s left join public.lk_bookings b on b.id=s.id left join public.lk_enquiries e on e.id=s.enquiry_id where s.id=booking_id;
$$;
revoke all on function public.lk_booking_detail(uuid) from public,anon,authenticated;
grant execute on function public.lk_booking_detail(uuid) to service_role;

create function public.lk_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare
 s public.lk_quote_submissions;b public.lk_bookings;p public.lk_booking_proposals;item jsonb;previous_end timestamptz;
 selected_calendar text;next_revision integer;total integer;result jsonb;held_ranges tstzmultirange;held_range tstzrange;h text:=args->>'owner_hash';
begin
 if command='admin_list' then
  return (select coalesce(jsonb_agg(q),'[]'::jsonb) from (select s.id,s.reference,s.snapshot->'payload'->'contact'->>'name' as "clientName",s.snapshot->>'preferredDate' as "preferredDate",s.submitted_at as "submittedAt",coalesce(b.revision,0) revision,coalesce(b.status,'requested') status,coalesce(b.sync_status,'pending') as "syncStatus",b.confirmed_proposal_id as "confirmedProposalId",b.pending_proposal_id as "pendingProposalId",b.confirmed_at as "confirmedAt",p.email_status as "proposalEmailStatus" from public.lk_quote_submissions s left join public.lk_bookings b on b.id=s.id left join public.lk_booking_proposals p on p.id=b.pending_proposal_id order by s.submitted_at desc limit 100) q);
 elsif command='admin_detail' then return public.lk_booking_detail((args->>'id')::uuid);
 elsif command='customer_detail' then
  if h is null or h !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Invalid author session';end if;
  select * into s from public.lk_quote_submissions where owner_hash=h; if not found then return 'null';end if;
  return public.lk_booking_detail(s.id);
 elsif command='occupancy' then
  return (select coalesce(jsonb_agg(jsonb_build_object('startAt',start_at,'endAt',end_at)),'[]'::jsonb) from public.lk_booking_segments where start_at<(args->>'end_at')::timestamptz and end_at>(args->>'start_at')::timestamptz);
 end if;
 -- Same lock as existing Google target selection: provider calls happen outside it.
 perform pg_advisory_xact_lock(76001001);
 if command='proposal_create' then
  select * into s from public.lk_quote_submissions where id=(args->>'id')::uuid;
  if not found then raise exception using errcode='LK404',message='Submission not found';end if;
  if s.email_status<>'provider_accepted' or lower(s.snapshot->'payload'->'contact'->>'email')<>'lnkgroupsydney@gmail.com' then raise exception using errcode='LK409',message='Original company demo email must be accepted first';end if;
  select * into p from public.lk_booking_proposals where idempotency_key=args->>'key';
  if found then
   if p.booking_id<>s.id or p.request_hash is distinct from args->>'request_hash' then raise exception using errcode='LK409',message='Request key reused';end if;
   return public.lk_booking_detail(s.id);
  end if;
  insert into public.lk_bookings(id,calendar_id) values(s.id,s.calendar_id) on conflict(id) do nothing;
  select * into b from public.lk_bookings where id=s.id for update;
  if b.revision is distinct from (args->>'expected_revision')::integer then raise exception using errcode='LK409',message='Booking changed; reload';end if;
  if b.status='confirmed' and b.sync_status not in ('synced','review_required') then raise exception using errcode='LK409',message='Wait for the current booking sync before proposing another schedule';end if;
  next_revision:=(select coalesce(max(revision),0)+1 from public.lk_booking_proposals where booking_id=b.id);
  if args->'snapshot'->>'mode' is distinct from 'demo' or args->'snapshot'->>'version' is distinct from 'booking-demo-v1'
    or args->'snapshot'->>'submissionId' is distinct from s.id::text or args->'snapshot'->>'proposalId' is distinct from args->>'proposal_id'
    or args->'snapshot'->>'proposalRevision' is distinct from next_revision::text or args->'snapshot'->'submission' is distinct from s.snapshot
    or args->'snapshot'->>'resource' is distinct from 'demo-single-resource' then raise exception using errcode='LK400',message='Invalid demo proposal';end if;
  if jsonb_typeof(args->'snapshot'->'segments') is distinct from 'array' then raise exception using errcode='LK400',message='Work segments required';end if;
  total:=jsonb_array_length(args->'snapshot'->'segments');if total<1 or total>20 then raise exception using errcode='LK400',message='Work segments required';end if;
  for item in select value from jsonb_array_elements(args->'snapshot'->'segments') loop
   if item->>'id' is null or item->>'startAt' is null or item->>'endAt' is null or (item->>'startAt')::timestamptz<=now() or (item->>'endAt')::timestamptz<=(item->>'startAt')::timestamptz or (previous_end is not null and (item->>'startAt')::timestamptz<previous_end) then raise exception using errcode='LK400',message='Invalid work segments';end if;
   previous_end:=(item->>'endAt')::timestamptz;
  end loop;
  insert into public.lk_booking_proposals(id,booking_id,revision,idempotency_key,request_hash,snapshot,snapshot_hash,segments,notes,actor_hash)
   values((args->>'proposal_id')::uuid,b.id,next_revision,args->>'key',args->>'request_hash',args->'snapshot',args->>'snapshot_hash',args->'snapshot'->'segments',coalesce(args->'snapshot'->>'notes',''),args->>'actor_hash') returning * into p;
  update public.lk_bookings set revision=revision+1,pending_proposal_id=p.id,updated_at=now() where id=b.id;
  return public.lk_booking_detail(b.id);
 elsif command='consent' then
  if h is null or h !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Invalid author session';end if;
  select * into p from public.lk_booking_proposals where id=(args->>'proposal_id')::uuid;
  select * into s from public.lk_quote_submissions where id=p.booking_id and owner_hash=h;
  if s.id is null then raise exception using errcode='LK404',message='Proposal unavailable';end if;
  select * into b from public.lk_bookings where id=s.id for update;
  if p.consented_at is not null then
   if p.consent_key is distinct from args->>'key' or p.consent_hash is distinct from args->>'request_hash' then raise exception using errcode='LK409',message='Proposal already acknowledged';end if;
   return public.lk_booking_detail(b.id);
  end if;
  if b.pending_proposal_id is distinct from p.id or p.snapshot_hash is distinct from args->>'snapshot_hash' then raise exception using errcode='LK409',message='Proposal changed; review the latest schedule';end if;
  if args->'signature'->>'acknowledged' is distinct from 'true' or length(trim(coalesce(args->'signature'->>'name',''))) not between 1 and 120 or jsonb_typeof(args->'signature'->'strokes') is distinct from 'array' or jsonb_array_length(args->'signature'->'strokes')<1 then raise exception using errcode='LK400',message='Signature required';end if;
  update public.lk_booking_proposals set signature=args->'signature',consented_at=now(),consent_key=args->>'key',consent_hash=args->>'request_hash',retry_after=now() where id=p.id;
  update public.lk_bookings set revision=revision+1,updated_at=now() where id=b.id;
  return public.lk_booking_detail(b.id);
 elsif command='confirm' then
  select * into b from public.lk_bookings where id=(args->>'id')::uuid for update;
  select * into p from public.lk_booking_proposals where id=(args->>'proposal_id')::uuid and booking_id=b.id;
  if p.id is null then raise exception using errcode='LK404',message='Proposal unavailable';end if;
  if p.confirmed_at is not null then
   if p.confirm_key is distinct from args->>'key' or p.confirm_hash is distinct from args->>'request_hash' then raise exception using errcode='LK409',message='Proposal already confirmed';end if;
   return public.lk_booking_detail(b.id);
  end if;
  if b.revision is distinct from (args->>'expected_revision')::integer or b.pending_proposal_id is distinct from p.id or p.consented_at is null or p.email_status<>'provider_accepted' then raise exception using errcode='LK409',message='Current signed proposal and accepted company email required';end if;
  if args->>'checked_at' is null or (args->>'checked_at')::timestamptz<clock_timestamp()-interval '30 seconds' or (args->>'checked_at')::timestamptz>clock_timestamp()+interval '1 second' then raise exception using errcode='LK409',message='Fresh Calendar check required';end if;
  select selected_calendar_id into selected_calendar from public.lk_google_connection where id=1;
  if selected_calendar is distinct from b.calendar_id or b.calendar_id is distinct from args->>'calendar_id' then raise exception using errcode='LK409',message='Calendar target changed';end if;
  select range_agg(occupied) into held_ranges from (select tstzrange(start_at,end_at,'[)') occupied from public.lk_booking_segments where booking_id=b.id union all select tstzrange((value->>'startAt')::timestamptz,(value->>'endAt')::timestamptz,'[)') from jsonb_array_elements(p.segments)) spans;
  delete from public.lk_booking_segments where booking_id=b.id;
  for item in select value from jsonb_array_elements(p.segments) loop
   if (item->>'startAt')::timestamptz<=now() then raise exception using errcode='LK409',message='The proposed start time has passed';end if;
  end loop;
  total:=0;
  for held_range in select unnest(held_ranges) loop
   total:=total+1;insert into public.lk_booking_segments values(b.id,'occupancy-'||total,lower(held_range),upper(held_range));
  end loop;
  update public.lk_booking_proposals set confirmed_at=now(),confirm_key=args->>'key',confirm_hash=args->>'request_hash' where id=p.id;
  update public.lk_bookings set revision=revision+1,status='confirmed',sync_status='pending',updated_at=now() where id=b.id returning * into b;
  insert into public.lk_booking_outbox(booking_id,revision,proposal_id) values(b.id,b.revision,p.id) on conflict(booking_id) do update set revision=excluded.revision,proposal_id=excluded.proposal_id,updated_at=now();
  return public.lk_booking_detail(b.id);
 elsif command='email_claim' then
  if length(coalesce(args->>'holder','')) not between 16 and 160 then raise exception using errcode='LK400',message='Invalid delivery worker';end if;
  update public.lk_booking_proposals set email_status='outcome_unknown',error_code='email_outcome_unknown',lease_holder=null,lease_until=null where email_status in ('pending','sending','retrying') and email_first_attempt_at<=now()-interval '23 hours' and (lease_until is null or lease_until<=now());
  with candidates as(select p.id from public.lk_booking_proposals p join public.lk_bookings b on b.id=p.booking_id where (b.pending_proposal_id=p.id or p.email_first_attempt_at is not null) and p.consented_at is not null and p.email_status in ('pending','sending','retrying') and p.retry_after<=now() and (p.lease_until is null or p.lease_until<=now()) and (args->>'id' is null or p.id=(args->>'id')::uuid) order by p.retry_after limit least(10,greatest(1,coalesce((args->>'limit')::integer,1))) for update of p skip locked),claimed as(update public.lk_booking_proposals p set lease_holder=args->>'holder',lease_generation=lease_generation+1,lease_until=now()+interval '2 minutes' from candidates c where p.id=c.id returning p.*) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;return result;
 elsif command in ('email_attempt','email_accepted','email_failed') then
  select * into p from public.lk_booking_proposals where id=(args->>'id')::uuid for update;
  if p.id is null or p.lease_holder is distinct from args->>'holder' or p.lease_generation is distinct from (args->>'generation')::integer or p.lease_until is null or p.lease_until<=now() then raise exception using errcode='LK409',message='Delivery lease expired';end if;
  if command='email_attempt' then
   select * into b from public.lk_bookings where id=p.booking_id;
   if p.consented_at is null or (b.pending_proposal_id is distinct from p.id and p.email_first_attempt_at is null) or p.email_status not in ('pending','sending','retrying') then raise exception using errcode='LK409',message='Proposal is no longer awaiting delivery';end if;
   if p.email_first_attempt_at<=now()-interval '23 hours' then update public.lk_booking_proposals set email_status='outcome_unknown',error_code='email_outcome_unknown',lease_holder=null,lease_until=null where id=p.id returning * into p;return to_jsonb(p);end if;
   if jsonb_typeof(args->'payload') is distinct from 'object' or octet_length((args->'payload')::text)>2000000 then raise exception using errcode='LK400',message='Invalid email payload';end if;
   if p.email_payload is not null and p.email_payload is distinct from args->'payload' then raise exception using errcode='LK409',message='Email payload changed';end if;
   update public.lk_booking_proposals set email_payload=args->'payload',email_status='sending',email_first_attempt_at=coalesce(email_first_attempt_at,now()),email_attempts=email_attempts+1,error_code=null where id=p.id returning * into p;return to_jsonb(p);
  elsif command='email_accepted' then
   if p.email_payload is null or length(coalesce(args->>'provider_id','')) not between 1 and 200 or (p.email_provider_id is not null and p.email_provider_id is distinct from args->>'provider_id') then raise exception using errcode='LK409',message='Acceptance does not match delivery';end if;
   update public.lk_booking_proposals set email_status='provider_accepted',email_provider_id=args->>'provider_id',email_accepted_at=now(),error_code=null,lease_holder=null,lease_until=null where id=p.id;
  else
   if args->>'outcome' not in ('retrying','failed','outcome_unknown') or args->>'outcome' is null or args->>'error_code' not in ('email_transient','email_rejected','email_outcome_unknown','email_payload_conflict','email_retry_window_expired','email_configuration','email_document_invalid') or args->>'error_code' is null then raise exception using errcode='LK400',message='Invalid delivery outcome';end if;
   update public.lk_booking_proposals set email_status=args->>'outcome',error_code=args->>'error_code',retry_after=now()+interval '60 seconds',lease_holder=null,lease_until=null where id=p.id;
  end if;
  return jsonb_build_object('emailStatus',case when command='email_accepted' then 'provider_accepted' else args->>'outcome' end);
 else raise exception using errcode='LK400',message='Unknown booking operation';end if;
exception when exclusion_violation then raise exception using errcode='LK409',message='A work segment is already occupied';
end$$;
revoke all on function public.lk_booking_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_booking_command(text,jsonb) to service_role;
commit;
