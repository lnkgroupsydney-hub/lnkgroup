-- Keep account/message deduplication after an authorised enquiry deletion.
-- A NULL enquiry_id is a tombstone: gmail_seen still finds the message and
-- gmail_import's existing FOUND branch cannot recreate the deleted enquiry.
-- Existing non-NULL references, primary key, RLS, grants and RPC stay intact.
-- Data cleanup is a separate, scoped operation performed under the sync lease.
begin;
alter table public.lk_gmail_seen alter column enquiry_id drop not null;
commit;
