-- Calendar event state is private, server-owned, and fenced by the shared sync lease.
begin;
alter table public.lk_bookings add column calendar_ready_revision integer;
create table public.lk_booking_calendar_links (
  event_id text primary key,
  booking_id uuid not null references public.lk_bookings(id),
  proposal_id uuid not null references public.lk_booking_proposals(id),
  segment_id text not null,
  kind text not null check(kind in ('work','summary')),
  calendar_id text not null,
  etag text not null,
  start_at timestamptz,
  end_at timestamptz,
  start_date date,
  end_date_exclusive date,
  synced_revision integer not null,
  unique(booking_id,proposal_id,segment_id),
  check((kind='work' and start_at is not null and end_at>start_at and start_date is null and end_date_exclusive is null)
     or (kind='summary' and start_at is null and end_at is null and start_date is not null and end_date_exclusive>start_date))
);
create index lk_booking_calendar_links_booking on public.lk_booking_calendar_links(booking_id,proposal_id);
create table public.lk_booking_calendar_retire_intents (
  event_id text primary key references public.lk_booking_calendar_links(event_id),
  booking_id uuid not null references public.lk_bookings(id),
  new_proposal_id uuid not null references public.lk_booking_proposals(id),
  booking_revision integer not null,
  expected_provider_etag text not null,
  created_at timestamptz not null default now()
);
create table public.lk_booking_calendar_changes (
  id uuid primary key,
  booking_id uuid not null references public.lk_bookings(id),
  proposal_id uuid not null references public.lk_booking_proposals(id),
  segment_id text not null,
  event_id text not null,
  provider_etag text not null,
  booking_revision integer not null,
  kind text not null check(kind in ('move','delete','invalid')),
  proposed_start_at timestamptz,
  proposed_end_at timestamptz,
  status text not null default 'pending' check(status in ('pending','superseded')),
  created_at timestamptz not null default now(),
  unique(event_id,provider_etag,booking_revision)
);
create index lk_booking_calendar_changes_pending on public.lk_booking_calendar_changes(booking_id,created_at desc) where status='pending';
alter table public.lk_booking_calendar_links enable row level security;
alter table public.lk_booking_calendar_retire_intents enable row level security;
alter table public.lk_booking_calendar_changes enable row level security;
revoke all on public.lk_booking_calendar_links,public.lk_booking_calendar_retire_intents,public.lk_booking_calendar_changes from public,anon,authenticated;
grant select,insert,update,delete on public.lk_booking_calendar_links,public.lk_booking_calendar_retire_intents,public.lk_booking_calendar_changes to service_role;

-- The older provisional-enquiry API must never change signed demo booking dates.
create function public.lk_booking_legacy_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(old.payload_json->>'demoSubmissionId',new.payload_json->>'demoSubmissionId') is not null
    and row(new.start_at,new.end_at,new.status,new.schedule_notes,new.payload_json->>'preferredDate')
      is distinct from row(old.start_at,old.end_at,old.status,old.schedule_notes,old.payload_json->>'preferredDate') then
    raise exception using errcode='LK409',message='Signed demo schedule requires a new proposal';
  end if;
  return new;
end$$;
revoke all on function public.lk_booking_legacy_guard() from public,anon,authenticated;
grant execute on function public.lk_booking_legacy_guard() to service_role;
create trigger lk_booking_enquiry_legacy_guard before update on public.lk_enquiries
 for each row execute function public.lk_booking_legacy_guard();
create function public.lk_booking_change_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='pending' and new.status in ('approved','rejected')
    and exists(select 1 from public.lk_enquiries e where e.id=old.enquiry_id and e.payload_json->>'demoSubmissionId' is not null) then
    raise exception using errcode='LK409',message='Signed demo schedule requires a new proposal';
  end if;
  return new;
end$$;
revoke all on function public.lk_booking_change_guard() from public,anon,authenticated;
grant execute on function public.lk_booking_change_guard() to service_role;
create trigger lk_booking_legacy_change_guard before update on public.lk_change_requests
 for each row execute function public.lk_booking_change_guard();

-- Keep one selected target while a confirmed booking or linked event exists.
create function public.lk_booking_calendar_target_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.selected_calendar_id is distinct from old.selected_calendar_id
    and (exists(select 1 from public.lk_booking_calendar_links)
      or exists(select 1 from public.lk_bookings where status='confirmed')) then
    raise exception using errcode='LK409',message='Booking Calendar has linked or confirmed work';
  end if;
  return new;
end$$;
revoke all on function public.lk_booking_calendar_target_guard() from public,anon,authenticated;
grant execute on function public.lk_booking_calendar_target_guard() to service_role;
create trigger lk_booking_calendar_target_guard before update of selected_calendar_id on public.lk_google_connection
 for each row execute function public.lk_booking_calendar_target_guard();

create function public.lk_booking_calendar(command text,args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare b public.lk_bookings; l public.lk_booking_calendar_links; ms bigint; n integer; output jsonb;
begin
  perform pg_advisory_xact_lock(76001001);
  ms:=floor(extract(epoch from clock_timestamp())*1000);
  if command is null or command not in ('own_links','calendar_links','review_list','reconcile_ready','calendar_pending',
    'external_change','busy_conflict','retire_authorization','retire_intent','etag_update','link_put','link_delete',
    'calendar_failure','calendar_ready','calendar_success') then
    raise exception using errcode='LK400',message='Unknown booking Calendar operation';
  end if;
  if command='own_links' then
    return (select coalesce(jsonb_agg(event_id),'[]'::jsonb) from public.lk_booking_calendar_links
      where booking_id=(args->>'booking_id')::uuid and calendar_id=args->>'calendar_id');
  elsif command='calendar_links' then
    return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from public.lk_booking_calendar_links q
      where q.calendar_id=args->>'calendar_id');
  elsif command='review_list' then
    return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from
      (select * from public.lk_booking_calendar_changes where booking_id=(args->>'booking_id')::uuid and status='pending' order by created_at desc limit 100) q);
  elsif command='reconcile_ready' then
    return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from
      (select b.id as booking_id,b.revision,b.calendar_id,p.segments,
        (select coalesce(jsonb_agg(l.event_id),'[]'::jsonb) from public.lk_booking_calendar_links l where l.booking_id=b.id and l.calendar_id=b.calendar_id) as own_event_ids
       from public.lk_bookings b join public.lk_booking_proposals p on p.id=b.confirmed_proposal_id
       where b.status='confirmed' and b.sync_status='synced' and b.calendar_id=args->>'calendar_id'
       order by b.updated_at) q);
  end if;
  if not exists(select 1 from public.lk_sync_lease where holder=args->>'holder' and expires_at>ms) then
    raise exception using errcode='LK409',message='Calendar sync lease expired';
  end if;
  if command='calendar_pending' then
    return (select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from
      (select b.id as booking_id,b.revision,o.proposal_id,b.calendar_id,s.reference,p.segments,
        (select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.lk_booking_calendar_links l where l.booking_id=b.id) as links
       from public.lk_booking_outbox o join public.lk_bookings b on b.id=o.booking_id
       join public.lk_booking_proposals p on p.id=o.proposal_id
       join public.lk_quote_submissions s on s.id=b.id
       where b.revision=o.revision and b.pending_proposal_id=o.proposal_id and b.status='confirmed'
         and b.sync_status in ('pending','retrying') and b.calendar_id=args->>'calendar_id'
       order by o.updated_at limit 50) q);
  end if;
  select * into b from public.lk_bookings where id=(args->>'booking_id')::uuid for update;
  if b.id is null then raise exception using errcode='LK404',message='Booking unavailable';end if;
  if b.calendar_id is distinct from args->>'calendar_id'
    or (select selected_calendar_id from public.lk_google_connection where id=1) is distinct from b.calendar_id then
    raise exception using errcode='LK409',message='Booking Calendar target changed';
  end if;
  if command='external_change' then
    select * into l from public.lk_booking_calendar_links where event_id=args->>'event_id' and booking_id=b.id;
    if l.event_id is null or l.proposal_id is distinct from (args->>'proposal_id')::uuid
      or l.segment_id is distinct from args->>'segment_id' then return 'false';end if;
    if not exists(select 1 from public.lk_booking_calendar_changes
      where booking_id=b.id and event_id=l.event_id and provider_etag=args->>'etag' and status='pending') then
      update public.lk_booking_calendar_changes set status='superseded'
        where booking_id=b.id and event_id=l.event_id and status='pending'
          and provider_etag is distinct from args->>'etag';
      insert into public.lk_booking_calendar_changes(id,booking_id,proposal_id,segment_id,event_id,provider_etag,booking_revision,kind,proposed_start_at,proposed_end_at)
        values((args->>'change_id')::uuid,b.id,l.proposal_id,l.segment_id,l.event_id,args->>'etag',b.revision,args->>'kind',
         (args->>'start_at')::timestamptz,(args->>'end_at')::timestamptz)
        on conflict(event_id,provider_etag,booking_revision) do nothing;
    end if;
    update public.lk_bookings set sync_status='review_required',updated_at=now() where id=b.id;
    return 'true';
  elsif command='busy_conflict' then
    if b.revision is distinct from (args->>'revision')::integer or b.sync_status not in ('synced','pending','retrying') then return 'false';end if;
    insert into public.lk_booking_calendar_changes(id,booking_id,proposal_id,segment_id,event_id,provider_etag,booking_revision,kind)
      values((args->>'change_id')::uuid,b.id,coalesce(b.pending_proposal_id,b.confirmed_proposal_id),'availability',
        'availability:'||b.id::text,'busy:'||b.revision::text,b.revision,'invalid')
      on conflict(event_id,provider_etag,booking_revision) do nothing;
    update public.lk_bookings set sync_status='review_required',updated_at=now() where id=b.id;return 'true';
  elsif command='retire_authorization' then
    -- Missing after a fenced delete intent is a recoverable lost response.
    if args->>'etag'='deleted' and exists(
      select 1 from public.lk_booking_calendar_retire_intents i
      where i.event_id=args->>'event_id' and i.booking_id=b.id and i.new_proposal_id=(args->>'proposal_id')::uuid
        and i.booking_revision=(args->>'revision')::integer
    ) then return 'true';end if;
    -- Otherwise a new signed proposal may acknowledge a previously observed external edit.
    return to_jsonb(exists(
      select 1 from public.lk_booking_calendar_changes c
      join public.lk_booking_proposals p on p.id=b.pending_proposal_id
      where c.booking_id=b.id and c.event_id=args->>'event_id' and c.provider_etag=args->>'etag'
        and c.status='pending' and c.created_at<p.created_at and p.consented_at is not null
        and p.id=(args->>'proposal_id')::uuid and b.revision=(args->>'revision')::integer
    ));
  elsif command='etag_update' then
    update public.lk_booking_calendar_links set etag=args->>'etag'
      where event_id=args->>'event_id' and booking_id=b.id and etag=args->>'expected_etag';
    get diagnostics n=row_count;return to_jsonb(n=1);
  end if;
  -- Never let an old worker completion clear a newer proposal or its occupancy.
  if b.revision is distinct from (args->>'revision')::integer
    or b.pending_proposal_id is distinct from (args->>'proposal_id')::uuid
    or not exists(select 1 from public.lk_booking_outbox where booking_id=b.id and revision=b.revision and proposal_id=b.pending_proposal_id)
    then return 'false';end if;
  if command='retire_intent' then
    select * into l from public.lk_booking_calendar_links where event_id=args->>'event_id' and booking_id=b.id;
    if l.event_id is null or l.proposal_id=b.pending_proposal_id or l.etag is distinct from args->>'link_etag'
      or length(coalesce(args->>'etag','')) not between 1 and 1000 then return 'false';end if;
    if l.etag is distinct from args->>'etag' and not exists(
      select 1 from public.lk_booking_calendar_changes c
      join public.lk_booking_proposals p on p.id=b.pending_proposal_id
      where c.booking_id=b.id and c.event_id=l.event_id and c.provider_etag=args->>'etag'
        and c.status='pending' and c.created_at<p.created_at and p.consented_at is not null
    ) then return 'false';end if;
    insert into public.lk_booking_calendar_retire_intents(event_id,booking_id,new_proposal_id,booking_revision,expected_provider_etag)
      values(l.event_id,b.id,b.pending_proposal_id,b.revision,args->>'etag')
      on conflict(event_id) do update set new_proposal_id=excluded.new_proposal_id,booking_revision=excluded.booking_revision,
        expected_provider_etag=excluded.expected_provider_etag,created_at=now();
    return 'true';
  elsif command='link_put' then
    if args->>'kind' not in ('work','summary') or args->>'kind' is null or length(coalesce(args->>'event_id','')) not between 1 and 1000
      or length(coalesce(args->>'etag','')) not between 1 and 1000 then raise exception using errcode='LK400',message='Invalid Calendar event';end if;
    insert into public.lk_booking_calendar_links(event_id,booking_id,proposal_id,segment_id,kind,calendar_id,etag,start_at,end_at,start_date,end_date_exclusive,synced_revision)
      values(args->>'event_id',b.id,b.pending_proposal_id,args->>'segment_id',args->>'kind',b.calendar_id,args->>'etag',
        (args->>'start_at')::timestamptz,(args->>'end_at')::timestamptz,(args->>'start_date')::date,(args->>'end_date_exclusive')::date,b.revision)
      on conflict(event_id) do update set etag=excluded.etag,start_at=excluded.start_at,end_at=excluded.end_at,
       start_date=excluded.start_date,end_date_exclusive=excluded.end_date_exclusive,synced_revision=excluded.synced_revision
      where lk_booking_calendar_links.booking_id=b.id and lk_booking_calendar_links.proposal_id=b.pending_proposal_id
        and lk_booking_calendar_links.segment_id=excluded.segment_id and lk_booking_calendar_links.kind=excluded.kind;
    get diagnostics n=row_count;return to_jsonb(n=1);
  elsif command='link_delete' then
    select * into l from public.lk_booking_calendar_links where event_id=args->>'event_id' and booking_id=b.id for update;
    if l.event_id is null or l.proposal_id=b.pending_proposal_id or l.etag is distinct from args->>'etag' then return 'false';end if;
    delete from public.lk_booking_calendar_retire_intents where event_id=args->>'event_id' and booking_id=b.id
      and new_proposal_id=b.pending_proposal_id and booking_revision=b.revision;
    delete from public.lk_booking_calendar_links where event_id=l.event_id and booking_id=b.id;
    get diagnostics n=row_count;return to_jsonb(n=1);
  elsif command='calendar_failure' then
    update public.lk_bookings set sync_status=case when args->>'review'='true' then 'review_required' else 'retrying' end,updated_at=now() where id=b.id;
    return 'true';
  elsif command='calendar_ready' then
    if (select count(*) from public.lk_booking_calendar_links where booking_id=b.id and proposal_id=b.pending_proposal_id and kind='work')
       <>jsonb_array_length((select segments from public.lk_booking_proposals where id=b.pending_proposal_id))
      or exists(
       select 1 from public.lk_booking_proposals p cross join lateral jsonb_array_elements(p.segments) seg(value)
       where p.id=b.pending_proposal_id and not exists(
        select 1 from public.lk_booking_calendar_links l where l.booking_id=b.id and l.proposal_id=p.id
          and l.kind='work' and l.segment_id=seg.value->>'id'
          and l.start_at=(seg.value->>'startAt')::timestamptz and l.end_at=(seg.value->>'endAt')::timestamptz))
      or exists(select 1 from public.lk_booking_calendar_changes where booking_id=b.id and proposal_id=b.pending_proposal_id and status='pending') then return 'false';end if;
    -- New opaque events are verified before old opaque events can be retired.
    -- This releases old DB dates only when the new signed dates are already held.
    delete from public.lk_booking_segments where booking_id=b.id;
    insert into public.lk_booking_segments(booking_id,segment_id,start_at,end_at)
      select b.id,value->>'id',(value->>'startAt')::timestamptz,(value->>'endAt')::timestamptz
      from jsonb_array_elements((select segments from public.lk_booking_proposals where id=b.pending_proposal_id));
    update public.lk_bookings set calendar_ready_revision=b.revision,
      confirmed_at=case when confirmed_proposal_id is distinct from pending_proposal_id then now() else confirmed_at end,
      confirmed_proposal_id=pending_proposal_id,updated_at=now() where id=b.id;
    return 'true';
  elsif command='calendar_success' then
    if b.calendar_ready_revision is distinct from b.revision
      or exists(select 1 from public.lk_booking_calendar_links where booking_id=b.id and proposal_id<>b.pending_proposal_id)
      or exists(select 1 from public.lk_booking_calendar_changes where booking_id=b.id and proposal_id=b.pending_proposal_id and status='pending') then return 'false';end if;
    update public.lk_bookings set sync_status='synced',updated_at=now() where id=b.id;
    delete from public.lk_booking_outbox where booking_id=b.id and revision=b.revision;
    update public.lk_booking_calendar_changes set status='superseded' where booking_id=b.id and status='pending';
    return 'true';
  end if;
  raise exception using errcode='LK400',message='Unknown booking Calendar operation';
end$$;
revoke all on function public.lk_booking_calendar(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_booking_calendar(text,jsonb) to service_role;
commit;
