-- Source fragment for build-resident-migration.mjs; apply generated migration.
create schema if not exists osi_resident_private;
revoke all on schema osi_resident_private from public,anon,authenticated,service_role;
create table if not exists public.osi_resident_centers (
 singleton boolean primary key default true check(singleton),
 site_id uuid not null unique, enabled boolean not null default false,
 evidence text not null check(length(trim(evidence)) between 10 and 2000),
 bound_at timestamptz not null default now()
);
create table if not exists public.osi_resident_audit (
 id uuid primary key default gen_random_uuid(),site_id uuid not null,
 actor_type text not null default 'SITE_STAFF' check(actor_type='SITE_STAFF'), actor_id uuid not null,
 actor_name text,service text not null,action text not null,entity text,record_id uuid,
 details jsonb not null default '{}',created_at timestamptz not null default now()
);
create table if not exists public.osi_resident_uploads (
 id uuid primary key default gen_random_uuid(),site_id uuid not null,actor_id uuid not null,
 entity text not null check(entity in ('requests','posts')),record_id uuid not null,
 path text not null unique,mime text not null,bytes integer not null check(bytes between 12 and 524288),
 content_hash text not null,created_at timestamptz not null default now(),
 constraint osi_resident_upload_identity unique(site_id,actor_id,entity,record_id,content_hash)
);
do $setup$ declare t text;begin
 foreach t in array array['osi_resident_centers','osi_resident_audit','osi_resident_uploads'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $setup$;
create index if not exists osi_resident_audit_record on public.osi_resident_audit(site_id,service,record_id,created_at);

-- Retain every historical auth FK. A real staff session is a separate namespace,
-- never an invented auth.users identity or the old administrator's identity.
alter table public.ms_payments add column if not exists staff_actor_id uuid;
alter table public.ms_request_notes add column if not exists staff_actor_id uuid;
alter table public.ms_guest_notes add column if not exists staff_actor_id uuid;
alter table public.ms_payments alter column confirmed_by drop not null;
alter table public.ms_request_notes alter column created_by drop not null;
alter table public.ms_guest_notes alter column created_by drop not null;
do $constraints$ declare t text; actor_column text;begin
 foreach t in array array['ms_payments','ms_request_notes','ms_guest_notes'] loop
 actor_column:=case when t='ms_payments' then 'confirmed_by' else 'created_by' end;
 if not exists(select 1 from pg_constraint where conname=t||'_staff_or_auth_actor' and conrelid=('public.'||t)::regclass) then
 execute format('alter table public.%I add constraint %I check(%I is not null or staff_actor_id is not null)',t,t||'_staff_or_auth_actor',actor_column);
 end if;
 end loop;
end $constraints$;
create or replace function osi_resident_private.fill_staff_actor() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (to_jsonb(new)->>tg_argv[0]) is null then
 new.staff_actor_id:=nullif(current_setting('osi.resident.actor',true),'')::uuid;
 if new.staff_actor_id is null then raise exception 'Verified resident staff actor required' using errcode='42501';end if;
 end if;
 return new;
end $$;
revoke all on function osi_resident_private.fill_staff_actor() from public,anon,authenticated,service_role;
drop trigger if exists osi_resident_payment_actor on public.ms_payments;
create trigger osi_resident_payment_actor before insert on public.ms_payments for each row execute function osi_resident_private.fill_staff_actor('confirmed_by');
drop trigger if exists osi_resident_request_actor on public.ms_request_notes;
create trigger osi_resident_request_actor before insert on public.ms_request_notes for each row execute function osi_resident_private.fill_staff_actor('created_by');
drop trigger if exists osi_resident_guest_actor on public.ms_guest_notes;
create trigger osi_resident_guest_actor before insert on public.ms_guest_notes for each row execute function osi_resident_private.fill_staff_actor('created_by');

create or replace function osi_resident_private.photo_attached_to(p_path text,p_entity text,p_record uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.osi_resident_uploads u join storage.objects o on o.bucket_id='member-service-files' and o.name=u.path
 where u.path=p_path and u.entity=p_entity and u.record_id=p_record
 and u.site_id=nullif(current_setting('osi.resident.site',true),'')::uuid)
$$;
revoke all on function osi_resident_private.photo_attached_to(text,text,uuid) from public,anon,authenticated,service_role;

create or replace function osi_resident_private.redact(value jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog,public as $$
declare result jsonb;begin
 if jsonb_typeof(value)='object' then
 select coalesce(jsonb_object_agg(key,osi_resident_private.redact(v)),'{}') into result
 from jsonb_each(value) e(key,v) where key<>all(array['secret_hash','phone_hash','receipt_key','idempotency_key','submitted_by','processed_by','user_id','created_by','updated_by','actor_id','staff_actor_id']);return result;
 elsif jsonb_typeof(value)='array' then
 select coalesce(jsonb_agg(osi_resident_private.redact(v) order by n),'[]') into result from jsonb_array_elements(value) with ordinality e(v,n);return result;
 end if;return value;
end $$;
revoke all on function osi_resident_private.redact(jsonb) from public,anon,authenticated,service_role;
