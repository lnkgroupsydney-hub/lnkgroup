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
