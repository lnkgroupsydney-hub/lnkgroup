-- Demonstration submissions are private and immutable. Calendar work starts only
-- after the email provider accepts the frozen message; no payment is authorised.
begin;
create table public.lk_quote_submissions (
  id uuid primary key,
  draft_id uuid not null unique references public.lk_quote_drafts(id),
  owner_hash text not null unique check(owner_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null unique check(length(idempotency_key) between 16 and 160),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  reference text not null unique check(reference ~ '^DEMO-[A-Z0-9-]{8,40}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
  signature jsonb not null check(jsonb_typeof(signature)='object'),
  calendar_id text not null check(length(calendar_id) between 1 and 512),
  submitted_at timestamptz not null default now(),
  email_status text not null default 'pending' check(email_status in ('pending','sending','provider_accepted','retrying','failed','outcome_unknown')),
  email_payload jsonb,
  email_attempts integer not null default 0 check(email_attempts>=0),
  email_first_attempt_at timestamptz,
  email_provider_id text,
  email_accepted_at timestamptz,
  error_code text check(error_code in ('email_transient','email_configuration','email_rejected','email_outcome_unknown','email_payload_conflict','email_retry_window_expired','email_document_invalid','calendar_target_changed')),
  retry_after timestamptz not null default now(),
  lease_holder text,
  lease_generation integer not null default 0,
  lease_until timestamptz,
  enquiry_id uuid unique references public.lk_enquiries(id),
  check((email_status='provider_accepted')=(email_provider_id is not null)),
  check(enquiry_id is null or email_status='provider_accepted')
);
create index lk_quote_submissions_work on public.lk_quote_submissions(retry_after,submitted_at)
  where email_status in ('pending','sending','retrying') or (email_status='provider_accepted' and enquiry_id is null);
alter table public.lk_quote_submissions enable row level security;
revoke all on public.lk_quote_submissions from public,anon,authenticated;
grant select,insert,update,delete on public.lk_quote_submissions to service_role;

create function public.lk_guard_quote_submission() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='lk_quote_drafts' then
    if exists(select 1 from public.lk_quote_submissions where draft_id=old.id) then
      raise exception using errcode='LK409',message='Submitted details cannot be changed';
    end if;
  elsif tg_table_name='lk_google_connection' then
    if new.selected_calendar_id is distinct from old.selected_calendar_id and exists(
      select 1 from public.lk_quote_submissions where enquiry_id is not null and calendar_id=old.selected_calendar_id
    ) then raise exception using errcode='LK409',message='Calendar has submitted requests; migration needs review'; end if;
  else
    if row(new.id,new.draft_id,new.owner_hash,new.idempotency_key,new.request_hash,new.reference,new.snapshot,new.snapshot_hash,new.signature,new.calendar_id,new.submitted_at)
      is distinct from row(old.id,old.draft_id,old.owner_hash,old.idempotency_key,old.request_hash,old.reference,old.snapshot,old.snapshot_hash,old.signature,old.calendar_id,old.submitted_at)
      or (old.email_payload is not null and new.email_payload is distinct from old.email_payload)
      or (old.email_provider_id is not null and new.email_provider_id is distinct from old.email_provider_id)
      or (old.enquiry_id is not null and new.enquiry_id is distinct from old.enquiry_id)
      or (old.email_first_attempt_at is not null and new.email_first_attempt_at is distinct from old.email_first_attempt_at) then
      raise exception using errcode='LK409',message='Submitted evidence cannot be changed';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.lk_guard_quote_submission() from public,anon,authenticated;
grant execute on function public.lk_guard_quote_submission() to service_role;
create trigger lk_quote_draft_submitted before update on public.lk_quote_drafts for each row execute function public.lk_guard_quote_submission();
create trigger lk_quote_submission_immutable before update on public.lk_quote_submissions for each row execute function public.lk_guard_quote_submission();
create trigger lk_quote_calendar_target before update on public.lk_google_connection for each row execute function public.lk_guard_quote_submission();

create function public.lk_quote_submission(command text,args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.lk_quote_submissions; d public.lk_quote_drafts; e public.lk_enquiries;
  h text:=args->>'owner_hash'; r jsonb; payload jsonb; contact jsonb; service jsonb;
  current_calendar text; batch integer; next_status text; next_error text;
begin
  if command in ('read','submit') then
    if h is null or h !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Invalid draft session'; end if;
    -- Match the existing draft-save lock before checking revision and freezing it.
    if command='submit' then perform pg_advisory_xact_lock(hashtextextended('quote-draft:'||h,0)); end if;
    select * into s from public.lk_quote_submissions where owner_hash=h;
    select * into d from public.lk_quote_drafts where owner_hash=h;
    if s.id is null and (d.id is null or d.expires_at<=now()) then
      if command='read' then return 'null'; end if;
      raise exception using errcode='LK403',message='Draft session expired';
    end if;
    if command='submit' then
      if s.id is not null then
        if s.idempotency_key is distinct from args->>'key' or s.request_hash is distinct from args->>'request_hash'
          or s.snapshot is distinct from args->'snapshot' or s.snapshot_hash is distinct from args->>'snapshot_hash'
          or s.signature is distinct from args->'signature' then
          raise exception using errcode='LK409',message='This draft was already submitted';
        end if;
      else
        if args->>'expected_revision' is null or args->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'
          or d.revision<>(args->>'expected_revision')::integer
          or args->'snapshot'->>'draftId' is distinct from d.id::text
          or args->'snapshot'->>'draftRevision' is distinct from d.revision::text
          or args->'snapshot'->'payload' is distinct from d.payload then
          raise exception using errcode='LK409',message='Saved details changed; review again';
        end if;
        if d.payload->'service' is null or d.payload->'service'='null'::jsonb
          or args->'snapshot'->>'mode' is distinct from 'demo'
          or args->'snapshot'->>'version' is distinct from 'kcp-demo-v1'
          or coalesce(args->'snapshot'->>'preferredDate','') !~ '^\d{4}-\d{2}-\d{2}$'
          or args->'signature'->>'acknowledged' is distinct from 'true'
          or length(trim(coalesce(args->'signature'->>'name',''))) not between 1 and 120
          or jsonb_typeof(args->'signature'->'strokes') is distinct from 'array'
          or jsonb_array_length(args->'signature'->'strokes')<1 then
          raise exception using errcode='LK400',message='Complete the demo review and signature';
        end if;
        perform pg_advisory_xact_lock(76001001);
        select selected_calendar_id into current_calendar from public.lk_google_connection where id=1;
        if current_calendar is null or current_calendar is distinct from args->>'calendar_id' then
          raise exception using errcode='LK409',message='Calendar target changed; review again';
        end if;
        insert into public.lk_quote_submissions(id,draft_id,owner_hash,idempotency_key,request_hash,reference,snapshot,snapshot_hash,signature,calendar_id)
          values((args->>'id')::uuid,d.id,h,args->>'key',args->>'request_hash',args->>'reference',args->'snapshot',args->>'snapshot_hash',args->'signature',current_calendar)
          returning * into s;
      end if;
    elsif s.id is null then return 'null'; end if;
  elsif command='claim' then
    if length(coalesce(args->>'holder','')) not between 16 and 160 then raise exception using errcode='LK400',message='Invalid delivery worker'; end if;
    batch:=least(10,greatest(1,coalesce((args->>'limit')::integer,1)));
    perform pg_advisory_xact_lock(76001001);
    -- Resend retains idempotency keys for 24h; stop automatic replay after 23h.
    update public.lk_quote_submissions set email_status='outcome_unknown',error_code='email_outcome_unknown',lease_holder=null,lease_until=null
      where email_status in ('pending','sending','retrying') and email_first_attempt_at<=now()-interval '23 hours'
        and (lease_until is null or lease_until<=now());
    with candidates as (
      select id from public.lk_quote_submissions
      where (email_status in ('pending','sending','retrying') or (email_status='provider_accepted' and enquiry_id is null))
        and retry_after<=now() and (lease_until is null or lease_until<=now())
        and (args->>'id' is null or id=(args->>'id')::uuid)
      order by retry_after,submitted_at limit batch for update skip locked
    ), claimed as (
      update public.lk_quote_submissions q set lease_holder=args->>'holder',lease_generation=lease_generation+1,lease_until=now()+interval '2 minutes'
      from candidates c where q.id=c.id returning q.*
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into r from claimed;
    return r;
  elsif command in ('email_attempt','email_accepted','email_failed') then
    perform pg_advisory_xact_lock(76001001);
    select * into s from public.lk_quote_submissions where id=(args->>'id')::uuid for update;
    if s.id is null or s.lease_holder is distinct from args->>'holder' or s.lease_generation is distinct from (args->>'generation')::integer
      or s.lease_until is null or s.lease_until<=now() then raise exception using errcode='LK409',message='Delivery lease expired'; end if;
    if command='email_attempt' then
      if s.email_status not in ('pending','sending','retrying') then raise exception using errcode='LK409',message='Email is not awaiting delivery'; end if;
      if s.email_first_attempt_at is not null and s.email_first_attempt_at<=now()-interval '23 hours' then
        update public.lk_quote_submissions set email_status='outcome_unknown',error_code='email_outcome_unknown',lease_holder=null,lease_until=null where id=s.id returning * into s;
        return to_jsonb(s);
      end if;
      if jsonb_typeof(args->'payload') is distinct from 'object' or octet_length((args->'payload')::text)>2000000 then
        raise exception using errcode='LK400',message='Invalid email payload';
      end if;
      if s.email_payload is not null and s.email_payload is distinct from args->'payload' then
        raise exception using errcode='LK409',message='Email payload changed after first attempt';
      end if;
      update public.lk_quote_submissions set email_payload=args->'payload',email_attempts=email_attempts+1,
        email_first_attempt_at=coalesce(email_first_attempt_at,now()),email_status='sending',error_code=null where id=s.id returning * into s;
      return to_jsonb(s);
    elsif command='email_failed' then
      if s.email_status='provider_accepted' then raise exception using errcode='LK409',message='Email was already accepted'; end if;
      next_status:=args->>'outcome'; next_error:=args->>'error_code';
      if next_status not in ('retrying','failed','outcome_unknown') or next_status is null
        or next_error not in ('email_transient','email_configuration','email_rejected','email_outcome_unknown','email_payload_conflict','email_retry_window_expired','email_document_invalid') or next_error is null then
        raise exception using errcode='LK400',message='Invalid delivery outcome';
      end if;
      update public.lk_quote_submissions set email_status=next_status,error_code=next_error,retry_after=now()+interval '60 seconds',lease_holder=null,lease_until=null where id=s.id returning * into s;
    else
      if length(coalesce(args->>'provider_id','')) not between 1 and 200 or s.email_payload is null or s.email_first_attempt_at is null
        or (s.email_provider_id is not null and s.email_provider_id is distinct from args->>'provider_id') then
        raise exception using errcode='LK409',message='Email acceptance does not match delivery';
      end if;
      update public.lk_quote_submissions set email_status='provider_accepted',email_provider_id=args->>'provider_id',email_accepted_at=coalesce(email_accepted_at,now())
        where id=s.id returning * into s;
      select selected_calendar_id into current_calendar from public.lk_google_connection where id=1;
      if s.enquiry_id is null and current_calendar is not distinct from s.calendar_id then
        contact:=s.snapshot->'payload'->'contact'; service:=s.snapshot->'payload'->'service';
        payload:=jsonb_build_object('serviceId',service->>'serviceId','projectIntent',service->>'intent','targetSurfaces',service->'surfaces',
          'doorCount',service->'doorCount','drawerCount',service->'drawerCount','material',service->>'material','colourPreference',service->>'colourPreference',
          'name',contact->>'name','email',contact->>'email','phone',contact->>'phone','siteAddress',contact->>'siteAddress','suburb',contact->>'suburb',
          'postcode',contact->>'postcode','notes',contact->>'details','preferredDate',s.snapshot->>'preferredDate','acknowledgement',true,
          'demo',true,'demoSubmissionId',s.id,'submissionSnapshotHash',s.snapshot_hash);
        insert into public.lk_enquiries(id,reference,source,idempotency_key,payload_hash,payload_json,status,revision,calendar_status)
          values(s.id,s.reference,'web','demo-submission:'||s.id,s.snapshot_hash,payload,'submitted',1,'pending');
        insert into public.lk_outbox values(s.id,1,now());
        update public.lk_quote_submissions set enquiry_id=id where id=s.id returning * into s;
      end if;
      update public.lk_quote_submissions set email_status='provider_accepted',email_provider_id=args->>'provider_id',email_accepted_at=coalesce(email_accepted_at,now()),
        error_code=case when enquiry_id is null then 'calendar_target_changed' end,retry_after=now()+interval '60 seconds',lease_holder=null,lease_until=null
        where id=s.id returning * into s;
    end if;
  else raise exception using errcode='LK400',message='Unknown submission operation';
  end if;
  if s.enquiry_id is not null then select * into e from public.lk_enquiries where id=s.enquiry_id; end if;
  return jsonb_build_object('id',s.id,'reference',s.reference,'submittedAt',s.submitted_at,'preferredDate',s.snapshot->>'preferredDate',
    'emailStatus',s.email_status,'calendarStatus',coalesce(e.calendar_status,'blocked'),
    'error',coalesce(s.error_code,case when e.calendar_error is not null then 'calendar_needs_attention' end));
end;
$$;
revoke all on function public.lk_quote_submission(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_submission(text,jsonb) to service_role;
commit;
