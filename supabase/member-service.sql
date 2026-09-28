-- OneSports member services: ADDITIVE migration. Never rerun setup.sql on production.
-- Run with a database-owner migration connection after backup and isolated validation.
begin;
create extension if not exists pgcrypto;

create table if not exists public.ms_settings (
 id boolean primary key default true check (id),
 data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
 updated_at timestamptz not null default now()
);
create table if not exists public.ms_profiles (
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references auth.users(id),
 name text not null check (length(trim(name)) between 1 and 80),
 building text not null check (length(trim(building)) between 1 and 30),
 unit text not null check (length(trim(unit)) between 1 and 30),
 phone text not null check (phone ~ '^[0-9+() -]{8,24}$'),
 resident_verified boolean not null default false,
 phone_verified boolean not null default false,
 approved boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ms_categories (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('board','request')),
 name text not null check(length(trim(name)) between 1 and 80),
 sort_order integer not null default 0, active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.ms_products (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 facility text not null check(length(facility) between 1 and 80),
 duration_days integer not null check(duration_days between 1 and 3660),
 calculation_method text not null default 'days' check(calculation_method='days'),
 price integer not null check(price between 0 and 100000000),
 effective_from date not null default ((now() at time zone 'Asia/Seoul')::date),
 sort_order integer not null default 0, active boolean not null default false,
 reviewed boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(not active or reviewed)
);
create table if not exists public.ms_gx_classes (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 class_name text not null default '', weekdays integer[] not null default '{}', start_time time,
 period_start date, period_end date, price integer not null check(price between 0 and 100000000),
 capacity integer check(capacity between 1 and 10000),
 registration_start timestamptz, registration_end timestamptz,
 priority_start timestamptz, priority_end timestamptz,
 payment_due_hours integer check(payment_due_hours between 1 and 720),
 waitlist_enabled boolean not null default false,
 status text not null default 'inactive' check(status in ('inactive','open','closed','suspended')),
 reviewed boolean not null default false, is_child boolean not null default false,
 guardian_terms text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(weekdays <@ array[1,2,3,4,5,6,7]),
 check(period_end is null or period_end>=period_start),
 check(registration_end is null or registration_end>registration_start),
 check((priority_start is null and priority_end is null) or (priority_start is not null and priority_end>priority_start)),
 check(status<>'open' or priority_start is null or (priority_start>=registration_start and priority_end<=registration_end)),
 check(status<>'open' or (reviewed and capacity is not null and period_start is not null and period_end is not null and start_time is not null and cardinality(weekdays)>0 and registration_start is not null and registration_end is not null and payment_due_hours is not null and (not is_child or length(trim(guardian_terms))>0)))
);
create table if not exists public.ms_terms (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 120),
 body text not null check(length(trim(body)) between 1 and 30000),
 kind text not null check(kind in ('privacy','rules','guardian')),
 required boolean not null default true, approved boolean not null default false,
 active boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 check(not active or approved)
);
create table if not exists public.ms_forms (
 id uuid primary key default gen_random_uuid(), fields jsonb not null default '[]'::jsonb,
 active boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 check(jsonb_typeof(fields)='array' and jsonb_array_length(fields)<=30)
);
create unique index if not exists ms_forms_one_active on public.ms_forms(active) where active;
create table if not exists public.ms_posts (
 id uuid primary key default gen_random_uuid(), category_id uuid not null references public.ms_categories(id),
 title text not null check(length(trim(title)) between 1 and 160), body text not null check(length(body)<=30000),
 location text not null default '', progress_status text not null default '', action_date date,
 photos text[] not null default '{}', before_photos text[] not null default '{}', after_photos text[] not null default '{}',
 pinned boolean not null default false,
 status text not null default 'draft' check(status in ('draft','published','archived')),
 publish_at timestamptz not null default now(), expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 check(expires_at is null or expires_at>publish_at),
 check(cardinality(photos)+cardinality(before_photos)+cardinality(after_photos)<=15)
);
create table if not exists public.ms_applications (
 id uuid primary key default gen_random_uuid(), application_no text not null unique,
 member_id uuid not null references public.ms_profiles(id),
 kind text not null check(kind in ('new','renewal')),
 product_id uuid references public.ms_products(id), gx_class_id uuid references public.ms_gx_classes(id),
 product_snapshot jsonb not null, amount integer not null check(amount>=0),
 payment_method text not null check(payment_method in ('card','transfer')), payer_name text not null default '',
 desired_start_date date, previous_start_date date, previous_end_date date,
 proposed_start_date date, proposed_end_date date, final_start_date date, final_end_date date,
 application_status text not null default 'pending' check(application_status in ('new','pending','needs_review','completed','cancelled','refund_required')),
 payment_status text not null default 'awaiting' check(payment_status in ('awaiting','reported','confirmed','refund_required')),
 pass_status text not null default 'pending' check(pass_status in ('pending','applied','needs_review','revoked')),
 external_status text not null default 'pending' check(external_status in ('pending','done')),
 reservation_status text not null default 'none' check(reservation_status in ('none','reserved','waitlisted','confirmed','expired','cancelled')),
 reservation_expires_at timestamptz,
 consents_snapshot jsonb not null, form_snapshot jsonb not null, form_values jsonb not null default '{}',
 signature_path text, student_name text, guardian_consent boolean not null default false,
 idempotency_key uuid not null, submitted_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 processed_at timestamptz, processed_by uuid references auth.users(id),
 check((product_id is null) <> (gx_class_id is null)),
 unique(submitted_by,idempotency_key)
);
create table if not exists public.ms_payments (
 id uuid primary key default gen_random_uuid(), application_id uuid not null unique references public.ms_applications(id),
 member_id uuid not null references public.ms_profiles(id), method text not null check(method in ('card','transfer')),
 actual_amount integer not null check(actual_amount>=0), paid_at timestamptz not null,
 confirmed_by uuid not null references auth.users(id), note text not null default '',
 refund_status text not null default 'none' check(refund_status in ('none','required','confirmed')),
 created_at timestamptz not null default now()
);
create table if not exists public.ms_passes (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.ms_profiles(id),
 application_id uuid unique references public.ms_applications(id), facility text not null, product_name text not null,
 start_date date not null, end_date date not null,
 status text not null default 'active' check(status in ('active','suspended','revoked')),
 gx_class_id uuid references public.ms_gx_classes(id), source text not null default 'application' check(source in ('application','import')),
 created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 check(end_date>=start_date), check(source='import' or application_id is not null)
);
create table if not exists public.ms_requests (
 id uuid primary key default gen_random_uuid(), request_no text not null unique,
 member_id uuid not null references public.ms_profiles(id), category_id uuid not null references public.ms_categories(id),
 title text not null check(length(trim(title)) between 1 and 160), body text not null check(length(trim(body)) between 1 and 10000),
 location text not null default '' check(length(location)<=300), photos text[] not null default '{}',
 item_name text not null default '' check(length(item_name)<=150), quantity integer check(quantity between 1 and 100000),
 status text not null default 'received' check(status in ('received','reviewing','in_progress','completed','needs_info','held','declined')),
 reply text not null default '' check(length(reply)<=10000), action_photos text[] not null default '{}',
 assignee uuid references auth.users(id), idempotency_key uuid not null, submitted_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(submitted_by,idempotency_key), check(cardinality(photos)<=10 and cardinality(action_photos)<=10)
);
create table if not exists public.ms_request_notes (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.ms_requests(id),
 body text not null check(length(trim(body)) between 1 and 10000), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.ms_profile_changes (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.ms_profiles(id),
 changes jsonb not null, status text not null default 'pending' check(status in ('pending','approved','rejected')),
 note text not null default '', created_at timestamptz not null default now(), processed_at timestamptz, processed_by uuid references auth.users(id)
);
create table if not exists public.ms_invites (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.ms_profiles(id),
 code_hash text not null unique, expected_email text, expires_at timestamptz not null,
 used_at timestamptz, used_by uuid references auth.users(id), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.ms_rate_limits (
 actor_id uuid not null references auth.users(id), action text not null, window_start timestamptz not null,
 attempts integer not null default 0, primary key(actor_id,action,window_start)
);
create table if not exists public.ms_audit (
 id uuid primary key default gen_random_uuid(), entity text not null, entity_id uuid, action text not null,
 before_data jsonb, after_data jsonb, actor_id uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.ms_import_batches (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 idempotency_key uuid not null, content_hash text not null, result jsonb not null,
 created_at timestamptz not null default now(), unique(actor_id,idempotency_key)
);
create index if not exists ms_applications_member on public.ms_applications(member_id,created_at desc);
create index if not exists ms_applications_gx on public.ms_applications(gx_class_id,reservation_status);
create index if not exists ms_passes_member on public.ms_passes(member_id,facility,end_date);
create index if not exists ms_requests_member on public.ms_requests(member_id,created_at desc);
create index if not exists ms_posts_public on public.ms_posts(status,publish_at);

-- Defaults never overwrite an operator's changes. No fake bank, retention period, or operations.
insert into public.ms_settings(id,data) values(true,'{
 "center_name":"힐스테이트 상도 센트럴파크 1단지 휘트니스센터","contact":"","main_title":"회원분들께 보고드립니다.",
 "subtitle":"회원님의 의견과 센터의 운영 소식을 전합니다.","intro":"",
 "menu_renew":true,"menu_requests":true,"menu_my":true,"menu_board":true,
 "applications_enabled":false,"requests_enabled":false,
 "bank_name":"","bank_account":"","bank_holder":"","transfer_guide":"관리자 확인 후 재등록이 완료됩니다.",
 "card_guide":"사전 신청이 완료되었습니다. 안내데스크에서 회원 이름 또는 신청번호를 말씀해 주세요. 카드결제 확인 후 재등록이 완료됩니다.",
 "request_guide":"다른 사람의 개인정보나 얼굴이 포함되지 않도록 확인해 주세요.",
 "privacy_purpose":"","privacy_items":"","privacy_retention":"","signature_enabled":false,"photo_limit":5
}'::jsonb) on conflict(id) do nothing;
insert into public.ms_categories(id,kind,name,sort_order) values
 ('11000000-0000-4000-8000-000000000001','board','조치사항',1),
 ('11000000-0000-4000-8000-000000000002','board','특이사항',2),
 ('11000000-0000-4000-8000-000000000003','board','공지사항',3),
 ('12000000-0000-4000-8000-000000000001','request','이용 불편·민원',1),
 ('12000000-0000-4000-8000-000000000002','request','시설 개선',2),
 ('12000000-0000-4000-8000-000000000003','request','기구 고장',3),
 ('12000000-0000-4000-8000-000000000004','request','청결·위생',4),
 ('12000000-0000-4000-8000-000000000005','request','필요한 물품',5),
 ('12000000-0000-4000-8000-000000000006','request','프로그램 제안',6),
 ('12000000-0000-4000-8000-000000000007','request','기타',7) on conflict(id) do nothing;
insert into public.ms_products(id,name,facility,duration_days,price,sort_order) values
 ('21000000-0000-4000-8000-000000000001','헬스 1개월','fitness',30,30000,1),
 ('21000000-0000-4000-8000-000000000002','헬스 3개월','fitness',90,68000,2),
 ('21000000-0000-4000-8000-000000000003','헬스 6개월','fitness',180,125000,3),
 ('21000000-0000-4000-8000-000000000004','헬스 12개월','fitness',365,235000,4),
 ('21000000-0000-4000-8000-000000000005','골프 1개월','golf',30,42000,5),
 ('21000000-0000-4000-8000-000000000006','골프 3개월','golf',90,110000,6),
 ('21000000-0000-4000-8000-000000000007','골프 6개월','golf',180,205000,7),
 ('21000000-0000-4000-8000-000000000008','골프 12개월','golf',365,400000,8),
 ('21000000-0000-4000-8000-000000000009','헬스+골프 1개월','fitness_golf',30,60000,9),
 ('21000000-0000-4000-8000-000000000010','헬스+골프 3개월','fitness_golf',90,145000,10),
 ('21000000-0000-4000-8000-000000000011','헬스+골프 6개월','fitness_golf',180,265000,11),
 ('21000000-0000-4000-8000-000000000012','헬스+골프 12개월','fitness_golf',365,515000,12) on conflict(id) do nothing;
insert into public.ms_gx_classes(id,name,class_name,weekdays,start_time,price,is_child) values
 ('31000000-0000-4000-8000-000000000001','서킷 트레이닝','A',array[1,3,5],'09:00',50000,false),
 ('31000000-0000-4000-8000-000000000002','다이어트댄스','A',array[1,3,5],'10:00',50000,false),
 ('31000000-0000-4000-8000-000000000003','K-POP댄스','A',array[1,3,5],'11:00',50000,false),
 ('31000000-0000-4000-8000-000000000004','요가','B',array[1,3,5],'20:00',50000,false),
 ('31000000-0000-4000-8000-000000000005','줌바','B',array[1,3,5],'21:00',50000,false),
 ('31000000-0000-4000-8000-000000000006','매트필라테스','A',array[2,4],'09:00',40000,false),
 ('31000000-0000-4000-8000-000000000007','라인댄스','A',array[2,4],'10:00',40000,false),
 ('31000000-0000-4000-8000-000000000008','전신근력 & 타바타','A',array[2,4],'11:00',40000,false),
 ('31000000-0000-4000-8000-000000000009','매트필라테스','B',array[2,4],'20:00',40000,false),
 ('31000000-0000-4000-8000-000000000010','라인댄스','B',array[2,4],'21:00',40000,false),
 ('31000000-0000-4000-8000-000000000011','K-POP댄스','B — 초등반',array[6],'11:00',30000,true) on conflict(id) do nothing;
insert into public.ms_forms(id,fields,active,version) values('41000000-0000-4000-8000-000000000001','[]',true,1) on conflict(id) do nothing;

-- Helper routines are not exposed as client mutations.
create or replace function public.ms_kst_today() returns date language sql stable
set search_path=pg_catalog as $$ select (now() at time zone 'Asia/Seoul')::date $$;
create or replace function public.ms_facility_overlap(a text,b text) returns boolean language sql immutable
set search_path=pg_catalog as $$ select a=b or (a='fitness_golf' and b in ('fitness','golf')) or (b='fitness_golf' and a in ('fitness','golf')) $$;
create or replace function public.ms_rate(action_name text, max_attempts integer) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 if auth.uid() is null then return false; end if;
 insert into public.ms_rate_limits(actor_id,action,window_start,attempts)
 values(auth.uid(),action_name,date_trunc('hour',now()),1)
 on conflict(actor_id,action,window_start) do update set attempts=ms_rate_limits.attempts+1 returning attempts into n;
 return n<=max_attempts;
end $$;
create or replace function public.ms_file_read(path text) returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
 select public.is_app_admin()
 or (auth.uid() is not null and split_part(path,'/',1) in ('requests','applications') and split_part(path,'/',2)=auth.uid()::text)
 or exists(select 1 from public.ms_requests r join public.ms_profiles m on m.id=r.member_id where m.user_id=auth.uid() and m.active and path=any(r.photos||r.action_photos))
 or exists(select 1 from public.ms_posts p join public.ms_categories c on c.id=p.category_id where p.status='published' and p.publish_at<=now() and (p.expires_at is null or p.expires_at>now()) and c.active and path=any(p.photos||p.before_photos||p.after_photos))
$$;
create or replace function public.ms_files_valid(paths text[], kind text, owner_id uuid, max_count integer) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(cardinality(paths),0)<=max_count and not exists(
 select 1 from unnest(paths) p where p !~ ('^'||kind||'/'||owner_id::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
 or not exists(select 1 from storage.objects o where o.bucket_id='member-service-files' and o.name=p))
$$;
create or replace function public.ms_file_upload(path text) returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
 select auth.uid() is not null
 and path ~ '^(requests|applications|posts)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
 and (public.is_app_admin() or (
  split_part(path,'/',2)=auth.uid()::text
  and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
  and (case split_part(path,'/',1)
   when 'requests' then exists(select 1 from public.ms_profiles where user_id=auth.uid() and active and approved and resident_verified)
   when 'applications' then exists(select 1 from public.ms_settings where id=true and (data->>'applications_enabled')::boolean)
   else false end)
  and (select count(*) from storage.objects where bucket_id='member-service-files' and split_part(name,'/',2)=auth.uid()::text and created_at>now()-interval '1 hour')<100
 ))
$$;
create or replace function public.ms_expire_gx(class_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Caller must own class row lock. Payment-reported and held applications NEVER expire automatically.
 with changed as (
 update public.ms_applications set reservation_status='expired',application_status='cancelled',updated_at=now()
 where gx_class_id=class_id and reservation_status='reserved' and reservation_expires_at<now()
 and payment_status='awaiting' and application_status in ('new','pending') returning id
 ) insert into public.ms_audit(entity,entity_id,action,actor_id)
 select 'applications',id,'reservation_expired',auth.uid() from changed;
end $$;

create or replace function public.member_service(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
 u uuid:=auth.uid(); adm boolean:=public.is_app_admin(); s jsonb; d jsonb; outj jsonb; beforej jsonb;
 m public.ms_profiles%rowtype; a public.ms_applications%rowtype; p public.ms_products%rowtype;
 g public.ms_gx_classes%rowtype; req public.ms_requests%rowtype; inv public.ms_invites%rowtype;
 formrow public.ms_forms%rowtype; change_row public.ms_profile_changes%rowtype;
 ident uuid; entity text; op text; tab text; cols text; assignments text; keys text[]; key text;
 v text; code text; em text; n integer; amount integer; startd date; endd date; prevstart date; prevend date;
 statusv text; reservev text; expires timestamptz; consentj jsonb; snap jsonb; rowj jsonb; fieldj jsonb;
 preview jsonb:='[]'; errors jsonb; duplicates jsonb; idx integer:=0; has_errors boolean:=false; has_duplicates boolean:=false;
 paths text[]; allowed text[]; confirmed boolean; profile_id uuid;
begin
 if payload is null or jsonb_typeof(payload)<>'object' or length(payload::text)>1000000 then raise exception '잘못된 요청입니다.'; end if;
 select data into s from public.ms_settings where id=true;

 if action='public_home' then
 return jsonb_build_object('ok',true,
 'settings',(s-array['bank_name','bank_account','bank_holder','privacy_purpose','privacy_items','privacy_retention'])||jsonb_build_object('transfer_available',coalesce(trim(s->>'bank_name'),'')<>'' and coalesce(trim(s->>'bank_account'),'')<>'' and coalesce(trim(s->>'bank_holder'),'')<>''),
 'categories',coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.ms_categories c where kind='board' and active),'[]'),
 'request_categories',coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.ms_categories c where kind='request' and active),'[]'),
 'products',coalesce((select jsonb_agg(to_jsonb(t) order by sort_order) from public.ms_products t where active and reviewed and effective_from<=public.ms_kst_today()),'[]'),
 'gx_classes',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('remaining_seats',greatest(0,t.capacity-(select count(*) from public.ms_applications gxapp where gxapp.gx_class_id=t.id and gxapp.reservation_status in ('reserved','confirmed') and not(gxapp.reservation_status='reserved' and gxapp.payment_status='awaiting' and gxapp.application_status in ('new','pending') and gxapp.reservation_expires_at<now())))) order by period_start,start_time) from public.ms_gx_classes t where reviewed and status in ('open','closed','suspended')),'[]'),
 'posts',coalesce((select jsonb_agg(x.data order by x.pinned desc,x.publish_at desc) from (select to_jsonb(t)-array['created_by','updated_by'] as data,t.pinned,t.publish_at from public.ms_posts t join public.ms_categories c on c.id=t.category_id where t.status='published' and t.publish_at<=now() and (t.expires_at is null or t.expires_at>now()) and c.active order by t.pinned desc,t.publish_at desc limit 100) x),'[]'),
 'terms',coalesce((select jsonb_agg(to_jsonb(t)-'created_by' order by kind,title) from public.ms_terms t where active and approved),'[]'),
 'form',(select to_jsonb(f)-'created_by' from public.ms_forms f where active limit 1));
 end if;
 if u is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select * into m from public.ms_profiles where user_id=u;

 if action='my' then
 return jsonb_build_object('ok',true,'profile',case when m.id is not null then to_jsonb(m) else null end,
 'passes',coalesce((select jsonb_agg(to_jsonb(t)-'created_by' order by end_date desc) from public.ms_passes t where member_id=m.id),'[]'),
 'applications',coalesce((select jsonb_agg(to_jsonb(t)-array['processed_by','submitted_by','idempotency_key'] order by created_at desc) from public.ms_applications t where member_id=m.id),'[]'),
 'requests',coalesce((select jsonb_agg(to_jsonb(t)-array['assignee','submitted_by','idempotency_key'] order by created_at desc) from public.ms_requests t where member_id=m.id),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(t)-array['confirmed_by','note'] order by created_at desc) from public.ms_payments t where member_id=m.id),'[]'),
 'profile_changes',coalesce((select jsonb_agg(to_jsonb(t)-'processed_by' order by created_at desc) from public.ms_profile_changes t where member_id=m.id),'[]'),
 'settings',case when m.active and ((m.approved and m.resident_verified) or exists(select 1 from public.ms_applications where member_id=m.id)) then s else s-array['bank_name','bank_account','bank_holder'] end);
 end if;

 if action='activate_invite' then
 if not public.ms_rate('activate_invite',10) then return jsonb_build_object('ok',false,'error','초대코드 시도 한도를 초과했습니다. 한 시간 후 다시 시도해 주세요.'); end if;
 if m.id is not null then return jsonb_build_object('ok',false,'error','이미 회원정보와 연결된 계정입니다.'); end if;
 select lower(email) into em from auth.users where id=u and email_confirmed_at is not null;
 if em is null then return jsonb_build_object('ok',false,'error','이메일 확인 후 다시 시도해 주세요.'); end if;
 code:=lower(trim(coalesce(payload->>'code','')));
 if code !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'error','유효하지 않거나 만료된 초대코드입니다.'); end if;
 select * into inv from public.ms_invites where code_hash=encode(digest(code,'sha256'),'hex') for update;
 if inv.id is null or inv.used_at is not null or inv.expires_at<=now() or (inv.expected_email is not null and inv.expected_email<>em) then return jsonb_build_object('ok',false,'error','유효하지 않거나 만료된 초대코드입니다.'); end if;
 select * into m from public.ms_profiles where id=inv.member_id for update;
 if m.user_id is not null or not m.active or not m.approved or not m.resident_verified then return jsonb_build_object('ok',false,'error','관리자 회원 확인이 필요합니다.'); end if;
 update public.ms_profiles set user_id=u,updated_at=now() where id=m.id returning * into m;
 update public.ms_invites set used_at=now(),used_by=u where id=inv.id;
 insert into public.ms_audit(entity,entity_id,action,actor_id) values('profiles',m.id,'invite_activated',u);
 return jsonb_build_object('ok',true,'profile',to_jsonb(m));
 end if;

 if action='application_submit' then
 if not coalesce((s->>'applications_enabled')::boolean,false) then raise exception '회원 신청은 관리자 설정 확인 후 열립니다.'; end if;
 if not public.ms_rate('application_submit',30) then return jsonb_build_object('ok',false,'error','신청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.'); end if;
 ident:=(payload->>'idempotency_key')::uuid;
 if ident is null then raise exception '중복 방지 신청키가 필요합니다.'; end if;
 select * into a from public.ms_applications where submitted_by=u and idempotency_key=ident;
 if a.id is not null then return jsonb_build_object('ok',true,'application',to_jsonb(a)-array['processed_by','submitted_by','idempotency_key'],'duplicate',true); end if;
 if not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then raise exception '이메일 확인 후 신청해 주세요.'; end if;
 if payload->>'kind' not in ('new','renewal') or payload->>'kind' is null then raise exception '신규 또는 재등록을 선택해 주세요.'; end if;
 if m.id is null then
  if payload->>'kind'<>'new' then raise exception '관리자 초대코드로 회원정보를 먼저 연결해 주세요.'; end if;
  d:=payload->'profile';
  insert into public.ms_profiles(user_id,name,building,unit,phone) values(u,trim(d->>'name'),trim(d->>'building'),trim(d->>'unit'),trim(d->>'phone')) on conflict(user_id) do nothing;
  select * into m from public.ms_profiles where user_id=u;
 end if;
 select * into m from public.ms_profiles where id=m.id for update;
 select * into a from public.ms_applications where submitted_by=u and idempotency_key=ident;
 if a.id is not null then return jsonb_build_object('ok',true,'application',to_jsonb(a)-array['processed_by','submitted_by','idempotency_key'],'duplicate',true); end if;
 if not m.active then raise exception '중지된 회원입니다. 관리자에게 문의해 주세요.'; end if;
 if payload->>'kind'='renewal' and not(m.approved and m.resident_verified) then raise exception '관리자 입주민 확인 후 재등록할 수 있습니다.'; end if;
 if payload->>'payment_method' not in ('card','transfer') or payload->>'payment_method' is null then raise exception '결제방식을 선택해 주세요.'; end if;
 if payload->>'payment_method'='transfer' and (coalesce(trim(s->>'bank_name'),'')='' or coalesce(trim(s->>'bank_account'),'')='' or coalesce(trim(s->>'bank_holder'),'')='') then raise exception '입금계좌 설정 전에는 계좌이체 신청을 할 수 없습니다.'; end if;
 if jsonb_typeof(coalesce(payload->'consents','[]'))<>'array' then raise exception '동의 내용을 확인해 주세요.'; end if;
 confirmed:=exists(select 1 from public.ms_gx_classes where id=nullif(payload->>'gx_class_id','')::uuid and is_child);
 if exists(select 1 from public.ms_terms t where active and approved and required and (kind<>'guardian' or confirmed) and not (coalesce(payload->'consents','[]') ? t.id::text)) then raise exception '필수 약관을 확인하고 동의해 주세요.'; end if;
 if not exists(select 1 from public.ms_terms where active and approved and kind='privacy') or not exists(select 1 from public.ms_terms where active and approved and kind='rules') then raise exception '관리자 규정 승인이 필요합니다.'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)-'created_by'||jsonb_build_object('agreed_at',now(),'member_id',m.id)),'[]') into consentj from public.ms_terms t where active and approved and (kind<>'guardian' or confirmed) and (coalesce(payload->'consents','[]') ? t.id::text);
 select * into formrow from public.ms_forms where active;
 if formrow.id is null then raise exception '신청서 설정이 필요합니다.'; end if;
 if payload ? 'expected_form_id' and (payload->>'expected_form_id')::uuid is distinct from formrow.id then raise exception '신청서가 변경되었습니다. 새로고침 후 내용을 다시 확인해 주세요.'; end if;
 d:=coalesce(payload->'form_values','{}');
 if jsonb_typeof(d)<>'object' or length(d::text)>20000 then raise exception '신청서 입력이 올바르지 않습니다.'; end if;
 for fieldj in select value from jsonb_array_elements(formrow.fields) loop
  key:=fieldj->>'key'; v:=d->>key;
  if coalesce((fieldj->>'required')::boolean,false) and (coalesce(trim(v),'')='' or (fieldj->>'type'='checkbox' and v<>'true')) then raise exception '필수 항목을 입력해 주세요: %',fieldj->>'label'; end if;
  if v is not null and length(v)>3000 then raise exception '입력 항목이 너무 깁니다.'; end if;
  if nullif(v,'') is not null and fieldj->>'type'='select' and not (fieldj->'options' ? v) then raise exception '선택 항목을 확인해 주세요.'; end if;
  if v is not null and fieldj->>'type'='checkbox' and v not in ('true','false') then raise exception '체크 항목이 올바르지 않습니다.'; end if;
 end loop;
 if exists(select 1 from jsonb_object_keys(d) k where not exists(select 1 from jsonb_array_elements(formrow.fields) f where f->>'key'=k)) then raise exception '허용되지 않은 신청서 항목입니다.'; end if;
 if coalesce((s->>'signature_enabled')::boolean,false) and payload->>'kind'='new' and nullif(payload->>'signature_path','') is null then raise exception '서명이 필요합니다.'; end if;
 if nullif(payload->>'signature_path','') is not null and not public.ms_files_valid(array[payload->>'signature_path'],'applications',u,1) then raise exception '서명 파일을 확인해 주세요.'; end if;
 if ((nullif(payload->>'product_id','') is null) = (nullif(payload->>'gx_class_id','') is null)) then raise exception '이용권 또는 GX 반 하나를 선택해 주세요.'; end if;
 startd:=greatest(coalesce(nullif(payload->>'desired_start_date','')::date,public.ms_kst_today()),public.ms_kst_today());
 if startd>public.ms_kst_today()+366 then raise exception '희망 시작일을 확인해 주세요.'; end if;
 statusv:='pending'; reservev:='none';
 if nullif(payload->>'product_id','') is not null then
  select * into p from public.ms_products where id=(payload->>'product_id')::uuid and active and reviewed and effective_from<=public.ms_kst_today();
  if p.id is null then raise exception '현재 신청할 수 없는 이용권입니다.'; end if;
  select min(start_date),max(end_date) into prevstart,prevend from public.ms_passes where member_id=m.id and facility=p.facility and status='active';
  startd:=greatest(startd,coalesce(prevend+1,startd)); endd:=startd+p.duration_days-1; snap:=to_jsonb(p); amount:=p.price;
  if exists(select 1 from public.ms_passes where member_id=m.id and public.ms_facility_overlap(facility,p.facility) and ((status='suspended') or (status='active' and end_date>=public.ms_kst_today() and facility<>p.facility))) then statusv:='needs_review'; end if;
 else
  select * into g from public.ms_gx_classes where id=(payload->>'gx_class_id')::uuid for update;
  if g.id is null or g.status<>'open' or not g.reviewed or now()<g.registration_start or now()>g.registration_end or g.period_end<public.ms_kst_today() then raise exception '현재 접수 중인 GX 반이 아닙니다.'; end if;
  if g.priority_start is not null and now()>=g.priority_start and now()<g.priority_end and not exists(select 1 from public.ms_passes t join public.ms_gx_classes oldg on oldg.id=t.gx_class_id where t.member_id=m.id and t.status='active' and oldg.name=g.name and oldg.class_name=g.class_name and oldg.period_end=(select max(previous_class.period_end) from public.ms_gx_classes previous_class where previous_class.name=g.name and previous_class.class_name=g.class_name and previous_class.period_end<g.period_start)) then raise exception '기존 수강생 우선접수 기간입니다.'; end if;
  if g.is_child and (coalesce(trim(payload->>'student_name'),'')='' or not coalesce((payload->>'guardian_consent')::boolean,false)) then raise exception '어린이 수강생 이름과 보호자 동의가 필요합니다.'; end if;
  perform public.ms_expire_gx(g.id);
  select count(*) into n from public.ms_applications where gx_class_id=g.id and reservation_status in ('reserved','confirmed');
  if n>=g.capacity then if not g.waitlist_enabled then raise exception '정원이 마감되었습니다.'; end if; reservev:='waitlisted'; else reservev:='reserved'; expires:=now()+make_interval(hours=>g.payment_due_hours); end if;
  startd:=g.period_start; endd:=g.period_end; snap:=to_jsonb(g); amount:=g.price;
 end if;
 if (payload ? 'expected_amount' and (payload->>'expected_amount')::integer is distinct from amount) or (payload ? 'expected_catalog_updated_at' and (payload->>'expected_catalog_updated_at')::timestamptz is distinct from (snap->>'updated_at')::timestamptz) then raise exception '상품 금액 또는 이용기간이 변경되었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
 select * into a from public.ms_applications where member_id=m.id and ((product_id=p.id and desired_start_date is not distinct from nullif(payload->>'desired_start_date','')::date) or gx_class_id=g.id) and application_status not in ('cancelled','refund_required') and (application_status<>'completed' or gx_class_id is not null) order by created_at desc limit 1;
 if a.id is not null then return jsonb_build_object('ok',true,'application',to_jsonb(a)-array['processed_by','submitted_by','idempotency_key'],'duplicate',true); end if;
 insert into public.ms_applications(application_no,member_id,kind,product_id,gx_class_id,product_snapshot,amount,payment_method,payer_name,desired_start_date,previous_start_date,previous_end_date,proposed_start_date,proposed_end_date,application_status,reservation_status,reservation_expires_at,consents_snapshot,form_snapshot,form_values,signature_path,student_name,guardian_consent,idempotency_key,submitted_by)
 values('A-'||to_char(public.ms_kst_today(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),m.id,payload->>'kind',p.id,g.id,snap,amount,payload->>'payment_method',left(coalesce(payload->>'payer_name',m.name),80),nullif(payload->>'desired_start_date','')::date,prevstart,prevend,startd,endd,statusv,reservev,expires,consentj,to_jsonb(formrow)-'created_by',d,nullif(payload->>'signature_path',''),left(payload->>'student_name',80),coalesce((payload->>'guardian_consent')::boolean,false),ident,u) returning * into a;
 insert into public.ms_audit(entity,entity_id,action,after_data,actor_id) values('applications',a.id,'submitted',jsonb_build_object('amount',a.amount,'reservation_status',a.reservation_status),u);
 return jsonb_build_object('ok',true,'application',to_jsonb(a)-array['processed_by','submitted_by','idempotency_key']);
 end if;

 if action in ('request_submit','profile_change','payment_report') then
 if m.id is null or not m.active or not m.approved or not m.resident_verified then
  -- A new pending registration may report its own payment; all other member operations need verification.
  if action<>'payment_report' or m.id is null or not m.active then raise exception '확인된 회원만 이용할 수 있습니다.' using errcode='42501'; end if;
 end if;
 if not public.ms_rate(action,60) then return jsonb_build_object('ok',false,'error','요청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.'); end if;
 if action='request_submit' then
  if not coalesce((s->>'requests_enabled')::boolean,false) then raise exception '건의 접수는 관리자 설정 확인 후 열립니다.'; end if;
  if not exists(select 1 from public.ms_terms where active and approved and kind='privacy') then raise exception '개인정보 동의문 관리자 확인 후 접수할 수 있습니다.'; end if;
  ident:=(payload->>'idempotency_key')::uuid; if ident is null then raise exception '중복 방지 접수키가 필요합니다.'; end if;
  perform 1 from public.ms_profiles where id=m.id for update;
  select * into req from public.ms_requests where submitted_by=u and idempotency_key=ident;
  if req.id is null then
   if not exists(select 1 from public.ms_categories where id=(payload->>'category_id')::uuid and kind='request' and active) then raise exception '분류를 확인해 주세요.'; end if;
   select coalesce(array_agg(value),'{}') into paths from jsonb_array_elements_text(coalesce(payload->'photos','[]'));
   if not public.ms_files_valid(paths,'requests',u,least(10,(s->>'photo_limit')::integer)) then raise exception '사진 파일을 확인해 주세요.'; end if;
   insert into public.ms_requests(request_no,member_id,category_id,title,body,location,photos,item_name,quantity,idempotency_key,submitted_by)
   values('R-'||to_char(public.ms_kst_today(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),m.id,(payload->>'category_id')::uuid,trim(payload->>'title'),trim(payload->>'body'),coalesce(payload->>'location',''),paths,coalesce(payload->>'item_name',''),nullif(payload->>'quantity','')::integer,ident,u) returning * into req;
   insert into public.ms_audit(entity,entity_id,action,actor_id) values('requests',req.id,'submitted',u);
  end if;
  return jsonb_build_object('ok',true,'request',to_jsonb(req)-array['assignee','submitted_by','idempotency_key']);
 elsif action='profile_change' then
  d:=payload->'changes';
  if d is null or jsonb_typeof(d)<>'object' or d='{}' or exists(select 1 from jsonb_object_keys(d) k where k<>all(array['name','building','unit','phone'])) then raise exception '회원정보 변경 항목이 올바르지 않습니다.'; end if;
  if length(d::text)>1000 then raise exception '변경 내용이 너무 깁니다.'; end if;
  insert into public.ms_profile_changes(member_id,changes) values(m.id,d) returning to_jsonb(ms_profile_changes) into outj;
  return jsonb_build_object('ok',true,'item',outj);
 else
  select * into a from public.ms_applications where id=(payload->>'id')::uuid and member_id=m.id for update;
  if a.id is null then raise exception '신청을 찾을 수 없습니다.' using errcode='42501'; end if;
  if a.payment_method<>'transfer' or a.application_status in ('cancelled','refund_required') or a.reservation_status in ('waitlisted','expired','cancelled') then raise exception '현재 입금 확인을 요청할 수 없는 신청입니다.'; end if;
  if a.payment_status in ('awaiting','reported') then
   update public.ms_applications set payment_status='reported',payer_name=left(coalesce(nullif(payload->>'payer_name',''),payer_name),80),updated_at=now() where id=a.id returning * into a;
   insert into public.ms_audit(entity,entity_id,action,after_data,actor_id) values('applications',a.id,'payment_reported',jsonb_build_object('payer_name',a.payer_name),u);
  end if;
  return jsonb_build_object('ok',true,'application',to_jsonb(a)-array['processed_by','submitted_by','idempotency_key']);
 end if;
 end if;

 -- All following actions require the existing approved administrator list.
 if not adm then raise exception '승인된 관리자 권한이 필요합니다.' using errcode='42501'; end if;
 entity:=payload->>'entity'; ident:=nullif(payload->>'id','')::uuid; op:=payload->>'operation';
 if action='admin_list' then
 if entity='admins' then return jsonb_build_object('ok',true,'items',coalesce((select jsonb_agg(jsonb_build_object('id',user_id,'user_id',user_id,'display_name',display_name)) from public.app_admins where active),'[]')); end if;
 tab:=case entity when 'profiles' then 'ms_profiles' when 'passes' then 'ms_passes' when 'applications' then 'ms_applications' when 'payments' then 'ms_payments' when 'requests' then 'ms_requests' when 'posts' then 'ms_posts' when 'products' then 'ms_products' when 'gx_classes' then 'ms_gx_classes' when 'categories' then 'ms_categories' when 'terms' then 'ms_terms' when 'forms' then 'ms_forms' when 'profile_changes' then 'ms_profile_changes' when 'audit' then 'ms_audit' when 'settings' then 'ms_settings' end;
 if tab is null then raise exception '허용되지 않은 목록입니다.'; end if;
 if entity='settings' then return jsonb_build_object('ok',true,'items',jsonb_build_array(s)); end if;
 if entity='requests' then
 select coalesce(jsonb_agg(x.data),'[]') into outj from (select to_jsonb(r)||jsonb_build_object('member',to_jsonb(member_row),'internal_notes',coalesce((select jsonb_agg(to_jsonb(t) order by created_at) from public.ms_request_notes t where request_id=r.id),'[]')) data from public.ms_requests r join public.ms_profiles member_row on member_row.id=r.member_id where (nullif(payload->>'status','') is null or r.status=payload->>'status') and (nullif(payload->>'search','') is null or (to_jsonb(r)::text||to_jsonb(member_row)::text) ilike '%'||(payload->>'search')||'%') and (nullif(payload->>'category_id','') is null or r.category_id=(payload->>'category_id')::uuid) and (nullif(payload->>'location','') is null or r.location ilike '%'||(payload->>'location')||'%') and (nullif(payload->>'date_from','') is null or (r.created_at at time zone 'Asia/Seoul')::date>=(payload->>'date_from')::date) and (nullif(payload->>'date_to','') is null or (r.created_at at time zone 'Asia/Seoul')::date<=(payload->>'date_to')::date) order by r.created_at desc limit 1000) x;
 elsif entity='applications' then
 select coalesce(jsonb_agg(x.data),'[]') into outj from (select to_jsonb(t)||jsonb_build_object('member',to_jsonb(member_row)) data from public.ms_applications t join public.ms_profiles member_row on member_row.id=t.member_id where (nullif(payload->>'status','') is null or payload->>'status' in (t.application_status,t.payment_status,t.pass_status,t.external_status,t.reservation_status)) and (nullif(payload->>'search','') is null or (to_jsonb(t)::text||to_jsonb(member_row)::text) ilike '%'||(payload->>'search')||'%') order by t.created_at desc limit 1000) x;
 else execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from (select * from public.%I t where ($1 is null or to_jsonb(t)::text ilike ''%%''||$1||''%%'') and ($2 is null or coalesce(to_jsonb(t)->>''status'','''')=$2) order by created_at desc limit 1000) x',tab) into outj using nullif(payload->>'search',''),nullif(payload->>'status',''); end if;
 return jsonb_build_object('ok',true,'items',outj);
 end if;

 if action='issue_invite' then
 select * into m from public.ms_profiles where id=(payload->>'member_id')::uuid for update;
 if m.id is null or m.user_id is not null or not m.active or not m.approved or not m.resident_verified then raise exception '현장 확인 및 승인된 미연결 회원만 초대할 수 있습니다.'; end if;
 code:=encode(gen_random_bytes(32),'hex'); expires:=now()+make_interval(hours=>least(24,greatest(1,coalesce((payload->>'expires_hours')::integer,24))));
 em:=nullif(lower(trim(payload->>'email')),'');
 if em is not null and em !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception '이메일을 확인해 주세요.'; end if;
 update public.ms_invites set expires_at=least(expires_at,now()) where member_id=m.id and used_at is null;
 insert into public.ms_invites(member_id,code_hash,expected_email,expires_at,created_by) values(m.id,encode(digest(code,'sha256'),'hex'),em,expires,u);
 insert into public.ms_audit(entity,entity_id,action,actor_id) values('profiles',m.id,'invite_issued',u);
 return jsonb_build_object('ok',true,'code',code,'expires_at',expires);
 end if;

 if action='admin_save' then
 d:=payload->'data'; if d is null or jsonb_typeof(d)<>'object' then raise exception '저장할 내용을 확인해 주세요.'; end if;
 if entity='settings' then
  d:=coalesce(d->'data',d); d:=d-'id';
  allowed:=array['center_name','contact','main_title','subtitle','intro','menu_renew','menu_requests','menu_my','menu_board','applications_enabled','requests_enabled','bank_name','bank_account','bank_holder','transfer_guide','card_guide','request_guide','privacy_purpose','privacy_items','privacy_retention','signature_enabled','photo_limit'];
  if exists(select 1 from jsonb_object_keys(d) k where k<>all(allowed)) then raise exception '허용되지 않은 설정입니다.'; end if;
  select data into beforej from public.ms_settings where id=true for update; s:=beforej||d;
  foreach key in array array['menu_renew','menu_requests','menu_my','menu_board','applications_enabled','requests_enabled','signature_enabled'] loop if jsonb_typeof(s->key)<>'boolean' then raise exception '설정값 형식을 확인해 주세요: %',key; end if; end loop;
  if coalesce(trim(s->>'center_name'),'')='' or coalesce(trim(s->>'main_title'),'')='' or jsonb_typeof(s->'photo_limit') is distinct from 'number' or (s->>'photo_limit')::integer not between 0 and 10 or length(s::text)>30000 then raise exception '센터 설정을 확인해 주세요.'; end if;
  if (s->>'applications_enabled')::boolean or (s->>'requests_enabled')::boolean then
   if coalesce(trim(s->>'privacy_purpose'),'')='' or coalesce(trim(s->>'privacy_items'),'')='' or coalesce(trim(s->>'privacy_retention'),'')='' or not exists(select 1 from public.ms_terms where active and approved and kind='privacy') then raise exception '개인정보 수집 목적·항목·보유기간 및 승인된 동의문을 먼저 설정해 주세요.'; end if;
  end if;
  if (s->>'applications_enabled')::boolean and (not exists(select 1 from public.ms_terms where active and approved and kind='rules') or not exists(select 1 from public.ms_forms where active)) then raise exception '승인된 이용규정과 신청서 설정이 필요합니다.'; end if;
  update public.ms_settings set data=s,updated_at=now() where id=true;
  insert into public.ms_audit(entity,action,before_data,after_data,actor_id) values(entity,'save',beforej,s,u);
  return jsonb_build_object('ok',true,'item',s);
 end if;
 tab:=case entity when 'profiles' then 'ms_profiles' when 'products' then 'ms_products' when 'gx_classes' then 'ms_gx_classes' when 'categories' then 'ms_categories' when 'posts' then 'ms_posts' when 'terms' then 'ms_terms' when 'forms' then 'ms_forms' end;
 if tab is null then raise exception '허용되지 않은 저장 대상입니다.'; end if;
 allowed:=case entity
 when 'profiles' then array['name','building','unit','phone','active']
 when 'products' then array['name','facility','duration_days','price','effective_from','sort_order','active','reviewed','calculation_method']
 when 'gx_classes' then array['name','class_name','weekdays','start_time','period_start','period_end','price','capacity','registration_start','registration_end','priority_start','priority_end','payment_due_hours','waitlist_enabled','status','reviewed','is_child','guardian_terms']
 when 'categories' then array['kind','name','sort_order','active']
 when 'posts' then array['category_id','title','body','location','progress_status','action_date','photos','before_photos','after_photos','pinned','status','publish_at','expires_at']
 when 'terms' then array['title','body','kind','required','approved','active']
 when 'forms' then array['fields','active'] end;
 ident:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tab) into beforej using ident;
 if exists(select 1 from jsonb_object_keys(d-array['id','preview_confirmed','expected_updated_at']) k where k<>all(allowed)) then raise exception '허용되지 않은 입력 필드입니다.'; end if;
 if d ? 'expected_updated_at' and beforej is not null and beforej->>'updated_at' is distinct from d->>'expected_updated_at' then raise exception '다른 관리자가 수정했습니다. 새로고침 후 다시 확인해 주세요.'; end if;
 if entity='products' and beforej is not null and d ? 'facility' and beforej->>'facility'<>d->>'facility' and exists(select 1 from public.ms_applications where product_id=ident) then raise exception '사용된 상품의 시설은 변경할 수 없습니다. 새 상품을 추가해 주세요.'; end if;
 if entity='categories' and beforej is not null and d ? 'kind' and beforej->>'kind'<>d->>'kind' then raise exception '분류 종류는 변경할 수 없습니다.'; end if;
 if entity='gx_classes' and beforej is not null then
  select count(*) into n from public.ms_applications where gx_class_id=ident and reservation_status in ('reserved','confirmed');
  if d ? 'capacity' and (d->>'capacity')::integer<n then raise exception '확보된 자리 수보다 정원을 줄일 수 없습니다.'; end if;
  if exists(select 1 from public.ms_applications where gx_class_id=ident and application_status not in ('cancelled')) and ((d ? 'period_start' and d->>'period_start' is distinct from beforej->>'period_start') or (d ? 'period_end' and d->>'period_end' is distinct from beforej->>'period_end') or (d ? 'start_time' and (d->>'start_time')::time is distinct from (beforej->>'start_time')::time) or (d ? 'weekdays' and d->'weekdays' is distinct from beforej->'weekdays')) then raise exception '신청이 있는 반의 수강기간·일정은 변경할 수 없습니다. 새 반을 추가해 주세요.'; end if;
 end if;
 if entity='posts' then
  rowj:=coalesce(beforej,'{}')||d;
  if not exists(select 1 from public.ms_categories where id=(rowj->>'category_id')::uuid and kind='board' and active) then raise exception '게시물 분류를 확인해 주세요.'; end if;
  if rowj->>'status'='published' and not coalesce((d->>'preview_confirmed')::boolean,false) then raise exception '개인정보가 없는 공개용 글인지 미리보기로 확인해 주세요.'; end if;
  select coalesce(array_agg(value),'{}') into paths from jsonb_array_elements_text(coalesce(rowj->'photos','[]')||coalesce(rowj->'before_photos','[]')||coalesce(rowj->'after_photos','[]'));
  if not public.ms_files_valid(paths,'posts',ident,15) then raise exception '게시물에 직접 업로드한 공개용 사진만 선택해 주세요.'; end if;
  d:=d||jsonb_build_object('updated_by',u,'updated_at',now()); if beforej is null then d:=d||jsonb_build_object('created_by',u); end if;
 end if;
 if entity='forms' then
  if jsonb_typeof(d->'fields')<>'array' or jsonb_array_length(d->'fields')>30 then raise exception '신청서 항목은 최대 30개입니다.'; end if;
  for fieldj in select value from jsonb_array_elements(d->'fields') loop
   if coalesce(fieldj->>'key','') !~ '^extra_[a-z0-9_]{1,40}$' or fieldj->>'type' not in ('text','textarea','select','checkbox') or fieldj->>'type' is null or coalesce(trim(fieldj->>'label'),'')='' or length(fieldj::text)>5000 then raise exception '추가항목은 extra_ 이름과 허용된 입력 유형을 사용해 주세요.'; end if;
   if fieldj->>'type'='select' and (jsonb_typeof(fieldj->'options')<>'array' or jsonb_array_length(fieldj->'options') not between 1 and 30) then raise exception '선택지 설정을 확인해 주세요.'; end if;
   if fieldj ? 'required' and jsonb_typeof(fieldj->'required')<>'boolean' then raise exception '필수 여부는 참/거짓 값이어야 합니다.'; end if;
   if fieldj->>'type'='select' and exists(select 1 from jsonb_array_elements(fieldj->'options') x where jsonb_typeof(x)<>'string' or length(x::text)>300) then raise exception '선택지는 짧은 글로 입력해 주세요.'; end if;
  end loop;
  if (select count(*)<>count(distinct f->>'key') from jsonb_array_elements(d->'fields') f) then raise exception '중복 항목 키가 있습니다.'; end if;
  perform pg_advisory_xact_lock(813011);
  if coalesce((d->>'active')::boolean,true) then update public.ms_forms set active=false where active; end if;
  select coalesce(max(version),0)+1 into n from public.ms_forms;
  ident:=gen_random_uuid(); beforej:=null; d:=d||jsonb_build_object('version',n,'created_by',u,'active',coalesce((d->>'active')::boolean,true));
 end if;
 if entity='terms' then
  perform pg_advisory_xact_lock(813012);
  rowj:=coalesce(beforej,'{}')||d;
  select coalesce(max(version),0)+1 into n from public.ms_terms where kind=rowj->>'kind' and title=rowj->>'title';
  if coalesce((rowj->>'active')::boolean,false) then update public.ms_terms set active=false where kind=rowj->>'kind' and title=rowj->>'title'; end if;
  d:=rowj-array['id','created_at','created_by','version']; d:=d||jsonb_build_object('version',n,'created_by',u); ident:=gen_random_uuid(); beforej:=null;
 end if;
 d:=d-array['id','preview_confirmed','expected_updated_at'];
 if entity in ('profiles','products','gx_classes') then d:=d||jsonb_build_object('updated_at',now()); end if;
 select string_agg(format('%I',k),','),string_agg(format('%I=r.%I',k,k),',') into cols,assignments from jsonb_object_keys(d) k;
 if beforej is null then
  d:=d||jsonb_build_object('id',ident); cols:='id,'||cols;
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) returning to_jsonb(%1$I)',tab,cols) into outj using d;
 else
  execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) r where t.id=$2 returning to_jsonb(t)',tab,assignments) into outj using d,ident;
 end if;
 insert into public.ms_audit(entity,entity_id,action,before_data,after_data,actor_id) values(entity,ident,'save',beforej,outj,u);
 return jsonb_build_object('ok',true,'item',outj);
 end if;

 if action='admin_action' then
 if entity='applications' then
  select * into a from public.ms_applications where id=ident;
  if a.id is null then raise exception '신청을 찾을 수 없습니다.'; end if;
  -- Consistent lock order: member, GX class, application. Submission/expiry use the same order.
  select * into m from public.ms_profiles where id=a.member_id for update;
  if a.gx_class_id is not null then select * into g from public.ms_gx_classes where id=a.gx_class_id for update; end if;
  select * into a from public.ms_applications where id=ident for update;
  beforej:=to_jsonb(a);
  if op='approve' and a.payment_status='confirmed' and a.pass_status='applied' then return jsonb_build_object('ok',true,'item',to_jsonb(a),'duplicate',true); end if;
  if payload ? 'expected_updated_at' and (payload->>'expected_updated_at')::timestamptz is distinct from a.updated_at then raise exception '신청이 변경되었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  if op='approve' then
   if a.application_status in ('cancelled','refund_required') then raise exception '취소된 신청은 승인할 수 없습니다.'; end if;
   if not m.active or not m.approved or not m.resident_verified then raise exception '입주민 확인 및 회원 승인이 필요합니다.'; end if;
   if payload->>'actual_amount' is null or (payload->>'actual_amount')::integer<>a.amount then raise exception '실제 결제금액이 신청금액과 다릅니다. 확인 필요로 보류해 주세요.'; end if;
   if a.gx_class_id is null then
    v:=a.product_snapshot->>'facility';
    if exists(select 1 from public.ms_passes where member_id=m.id and public.ms_facility_overlap(facility,v) and (status='suspended' or (status='active' and end_date>=public.ms_kst_today() and facility<>v))) then raise exception '이용 연기 또는 권종 변경 확인이 필요합니다. 기존 이용권을 검토해 주세요.'; end if;
    select max(end_date) into prevend from public.ms_passes where member_id=m.id and facility=v and status='active';
    startd:=greatest(public.ms_kst_today(),coalesce(a.desired_start_date,public.ms_kst_today()),coalesce(prevend+1,public.ms_kst_today()));
    endd:=startd+(a.product_snapshot->>'duration_days')::integer-1;
   else
    if a.reservation_status not in ('reserved','confirmed') or g.status='suspended' then raise exception '배정된 GX 자리와 운영상태를 확인해 주세요.'; end if;
    -- Exact GX period never becomes a rolling pass. After course start a fresh informed application is required.
    if public.ms_kst_today()>(a.product_snapshot->>'period_start')::date then raise exception '수강 시작일이 지났습니다. 회원에게 변경된 수강기간을 안내하고 새 반으로 재신청해 주세요.'; end if;
    startd:=(a.product_snapshot->>'period_start')::date; endd:=(a.product_snapshot->>'period_end')::date; v:='gx';
   end if;
   if (payload ? 'expected_start_date' and (payload->>'expected_start_date')::date is distinct from startd) or (payload ? 'expected_end_date' and (payload->>'expected_end_date')::date is distinct from endd) then raise exception '최신 이용기간이 변경되었습니다. 새로고침 후 최종 이용기간을 다시 확인해 주세요.'; end if;
   if nullif(payload->>'paid_at','')::timestamptz>now()+interval '5 minutes' then raise exception '결제일시는 미래로 기록할 수 없습니다.'; end if;
   insert into public.ms_payments(application_id,member_id,method,actual_amount,paid_at,confirmed_by,note)
   values(a.id,m.id,a.payment_method,a.amount,coalesce(nullif(payload->>'paid_at','')::timestamptz,now()),u,left(coalesce(payload->>'payment_note',''),2000));
   insert into public.ms_passes(member_id,application_id,facility,product_name,start_date,end_date,gx_class_id,created_by)
   values(m.id,a.id,v,a.product_snapshot->>'name',startd,endd,a.gx_class_id,u);
   update public.ms_applications set application_status='completed',payment_status='confirmed',pass_status='applied',final_start_date=startd,final_end_date=endd,reservation_status=case when gx_class_id is null then 'none' else 'confirmed' end,processed_at=now(),processed_by=u,updated_at=now() where id=a.id returning * into a;
  elsif op='hold' then
   if a.application_status in ('completed','cancelled','refund_required') then raise exception '완료·취소 신청은 보류할 수 없습니다.'; end if;
   if coalesce(trim(payload->>'note'),'')='' then raise exception '보류 사유를 입력해 주세요.'; end if;
   update public.ms_applications set application_status='needs_review',updated_at=now() where id=a.id returning * into a;
  elsif op='cancel' then
   if coalesce(trim(payload->>'note'),'')='' then raise exception '취소 사유를 입력해 주세요.'; end if;
   if a.payment_status='confirmed' then
    update public.ms_payments set refund_status='required' where application_id=a.id;
    update public.ms_applications set application_status='refund_required',payment_status='refund_required',updated_at=now() where id=a.id returning * into a;
   elsif a.payment_status='refund_required' then null;
   else update public.ms_applications set application_status='cancelled',reservation_status=case when gx_class_id is null then 'none' else 'cancelled' end,updated_at=now() where id=a.id returning * into a; end if;
  elsif op='external_done' then
   if a.pass_status<>'applied' or a.application_status<>'completed' then raise exception '이용권 반영 후 외부 출입 반영을 확인해 주세요.'; end if;
   update public.ms_applications set external_status='done',updated_at=now() where id=a.id returning * into a;
  elsif op='assign_seat' then
   if g.id is null or g.status<>'open' or a.reservation_status<>'waitlisted' then raise exception '대기접수 중인 열린 반만 배정할 수 있습니다.'; end if;
   perform public.ms_expire_gx(g.id);
   select count(*) into n from public.ms_applications where gx_class_id=g.id and reservation_status in ('reserved','confirmed');
   if n>=g.capacity then raise exception '잔여 자리가 없습니다.'; end if;
   if exists(select 1 from public.ms_applications where gx_class_id=g.id and reservation_status='waitlisted' and (created_at,id)<(a.created_at,a.id)) then raise exception '앞 순서의 대기 회원부터 배정해 주세요.'; end if;
   update public.ms_applications set reservation_status='reserved',reservation_expires_at=now()+make_interval(hours=>g.payment_due_hours),updated_at=now() where id=a.id returning * into a;
  else raise exception '허용되지 않은 신청 처리입니다.'; end if;
  outj:=to_jsonb(a);
 elsif entity='profiles' and op='import_pass' then
  select * into m from public.ms_profiles where id=ident for update;
  if m.id is null or not m.active or not m.approved or not m.resident_verified then raise exception '입주민 확인된 회원의 기존 이용권만 기록할 수 있습니다.'; end if;
  if coalesce(trim(payload->>'note'),'')='' then raise exception '기존 이용권을 확인한 자료와 근거를 입력해 주세요.'; end if;
  select * into p from public.ms_products where id=(payload->>'product_id')::uuid;
  if p.id is null then raise exception '기존 이용권에 해당하는 상품을 선택해 주세요.'; end if;
  startd:=(payload->>'start_date')::date; endd:=(payload->>'end_date')::date;
  if startd is null or endd is null or endd<startd or endd-startd>3660 then raise exception '확인된 기존 이용기간을 입력해 주세요.'; end if;
  if exists(select 1 from public.ms_passes where member_id=m.id and public.ms_facility_overlap(facility,p.facility) and status in ('active','suspended') and daterange(start_date,end_date,'[]') && daterange(startd,endd,'[]')) then raise exception '겹치는 기존 이용권이 있습니다. 중복 입력하지 마세요.'; end if;
  insert into public.ms_passes(member_id,facility,product_name,start_date,end_date,source,created_by) values(m.id,p.facility,p.name,startd,endd,'import',u) returning to_jsonb(ms_passes) into outj;
 elsif entity='passes' and op in ('suspend','resume') then
  select member_id into profile_id from public.ms_passes where id=ident;
  if profile_id is null then raise exception '이용권을 찾을 수 없습니다.'; end if;
  perform 1 from public.ms_profiles where id=profile_id for update;
  select to_jsonb(t) into beforej from public.ms_passes t where id=ident for update;
  if beforej->>'status'='revoked' or coalesce(trim(payload->>'note'),'')='' then raise exception '유효한 이용권과 처리 사유를 확인해 주세요.'; end if;
  update public.ms_passes set status=case when op='suspend' then 'suspended' else 'active' end where id=ident returning to_jsonb(ms_passes) into outj;
 elsif entity='requests' and op='update' then
  select * into req from public.ms_requests where id=ident for update; if req.id is null then raise exception '요청을 찾을 수 없습니다.'; end if; beforej:=to_jsonb(req);
  if payload->>'status'='declined' and coalesce(trim(payload->>'reply'),'')='' then raise exception '반영이 어려운 이유를 회원 답변으로 입력해 주세요.'; end if;
  if nullif(payload->>'assignee','') is not null and not exists(select 1 from public.app_admins where user_id=(payload->>'assignee')::uuid and active) then raise exception '승인된 담당자를 선택해 주세요.'; end if;
  select coalesce(array_agg(value),'{}') into paths from jsonb_array_elements_text(coalesce(payload->'action_photos',to_jsonb(req.action_photos)));
  if cardinality(paths)>10 or exists(select 1 from unnest(paths) path where not (path=any(req.action_photos)) and not public.ms_files_valid(array[path],'requests',u,1)) then raise exception '조치 사진을 확인해 주세요.'; end if;
  update public.ms_requests set status=coalesce(payload->>'status',status),reply=coalesce(payload->>'reply',reply),action_photos=paths,assignee=case when payload ? 'assignee' then nullif(payload->>'assignee','')::uuid else assignee end,updated_at=now() where id=ident returning to_jsonb(ms_requests) into outj;
  if coalesce(trim(payload->>'internal_note'),'')<>'' then insert into public.ms_request_notes(request_id,body,created_by) values(ident,trim(payload->>'internal_note'),u); end if;
 elsif entity='profiles' and op in ('verify','suspend') then
  select to_jsonb(t) into beforej from public.ms_profiles t where id=ident for update; if beforej is null then raise exception '회원을 찾을 수 없습니다.'; end if;
  if op='verify' then update public.ms_profiles set resident_verified=true,approved=true,active=true,updated_at=now() where id=ident returning to_jsonb(ms_profiles) into outj;
  else update public.ms_profiles set active=false,updated_at=now() where id=ident returning to_jsonb(ms_profiles) into outj; end if;
 elsif entity='profile_changes' and op in ('approve','reject') then
  select * into change_row from public.ms_profile_changes where id=ident for update; if change_row.id is null then raise exception '변경 요청을 찾을 수 없습니다.'; end if;
  if change_row.status<>'pending' then return jsonb_build_object('ok',true,'item',to_jsonb(change_row),'duplicate',true); end if;
  beforej:=to_jsonb(change_row);
  if op='approve' then
   d:=change_row.changes;
   update public.ms_profiles set name=coalesce(d->>'name',name),building=coalesce(d->>'building',building),unit=coalesce(d->>'unit',unit),phone=coalesce(d->>'phone',phone),phone_verified=case when d ? 'phone' then false else phone_verified end,updated_at=now() where id=change_row.member_id;
  end if;
  update public.ms_profile_changes set status=case when op='approve' then 'approved' else 'rejected' end,note=left(coalesce(payload->>'note',''),2000),processed_at=now(),processed_by=u where id=ident returning to_jsonb(ms_profile_changes) into outj;
 else raise exception '허용되지 않은 관리자 처리입니다.'; end if;
 insert into public.ms_audit(entity,entity_id,action,before_data,after_data,actor_id) values(entity,ident,op,beforej,outj||jsonb_build_object('admin_note',left(coalesce(payload->>'note',''),2000)),u);
 return jsonb_build_object('ok',true,'item',outj);
 end if;

 if action='import_members' then
 d:=payload->'rows'; if jsonb_typeof(d)<>'array' or jsonb_array_length(d) not between 1 and 500 then raise exception 'CSV는 1~500명씩 가져와 주세요.'; end if;
 -- A serializable preview/commit boundary is explicit: commit revalidates against current DB and batch.
 perform pg_advisory_xact_lock(813013);
 ident:=nullif(payload->>'idempotency_key','')::uuid;
 if coalesce((payload->>'commit')::boolean,false) and ident is not null then
  select result,content_hash into outj,v from public.ms_import_batches where actor_id=u and idempotency_key=ident;
  if outj is not null then
   if v<>encode(digest(d::text,'sha256'),'hex') then raise exception '같은 가져오기 키로 다른 파일을 처리할 수 없습니다.'; end if;
   return outj||jsonb_build_object('duplicate',true);
  end if;
 end if;
 for rowj in select value from jsonb_array_elements(d) loop
  idx:=idx+1; errors:='[]';
  if coalesce(length(trim(rowj->>'name')),0) not between 1 and 80 then errors:=errors||'"이름 필수 (80자 이내)"'::jsonb; end if;
  if coalesce(length(trim(rowj->>'building')),0) not between 1 and 30 then errors:=errors||'"동 필수 (30자 이내)"'::jsonb; end if;
  if coalesce(length(trim(rowj->>'unit')),0) not between 1 and 30 then errors:=errors||'"호수 필수 (30자 이내)"'::jsonb; end if;
  if coalesce(rowj->>'phone','') !~ '^[0-9+() -]{8,24}$' then errors:=errors||'"전화번호 형식 확인"'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'building',building,'unit',unit,'phone',phone)),'[]') into duplicates from public.ms_profiles where name=trim(rowj->>'name') or regexp_replace(phone,'[^0-9]','','g')=regexp_replace(rowj->>'phone','[^0-9]','','g');
  if (select count(*) from jsonb_array_elements(d) x where x->>'name'=rowj->>'name' or regexp_replace(x->>'phone','[^0-9]','','g')=regexp_replace(rowj->>'phone','[^0-9]','','g'))>1 then duplicates:=duplicates||jsonb_build_array(jsonb_build_object('batch_duplicate',true)); end if;
  has_errors:=has_errors or jsonb_array_length(errors)>0; has_duplicates:=has_duplicates or jsonb_array_length(duplicates)>0;
  preview:=preview||jsonb_build_array(jsonb_build_object('index',idx,'row',rowj,'errors',errors,'duplicate_candidates',duplicates));
 end loop;
 if not coalesce((payload->>'commit')::boolean,false) then return jsonb_build_object('ok',true,'preview',preview); end if;
 if has_errors then return jsonb_build_object('ok',false,'error','필수값 오류를 수정해 주세요. 회원은 추가되지 않았습니다.','preview',preview); end if;
 if has_duplicates and not coalesce((payload->>'confirm_duplicates')::boolean,false) then return jsonb_build_object('ok',false,'error','중복 후보를 확인한 후 별도 회원으로 추가를 선택해 주세요. 자동 병합하지 않습니다.','preview',preview); end if;
 for rowj in select value from jsonb_array_elements(d) loop
  insert into public.ms_profiles(name,building,unit,phone) values(trim(rowj->>'name'),trim(rowj->>'building'),trim(rowj->>'unit'),trim(rowj->>'phone')) returning id into profile_id;
  insert into public.ms_audit(entity,entity_id,action,actor_id) values('profiles',profile_id,'csv_import',u);
 end loop;
 outj:=jsonb_build_object('ok',true,'preview',preview,'inserted',jsonb_array_length(d));
 if ident is not null then insert into public.ms_import_batches(actor_id,idempotency_key,content_hash,result) values(u,ident,encode(digest(d::text,'sha256'),'hex'),outj); end if;
 return outj;
 end if;
 raise exception '지원하지 않는 요청입니다.';
end $$;

-- Explicit privilege boundary. No direct SELECT/INSERT/UPDATE/DELETE on private member tables.
do $$ declare t text; begin
 foreach t in array array['ms_settings','ms_profiles','ms_categories','ms_products','ms_gx_classes','ms_terms','ms_forms','ms_posts','ms_applications','ms_payments','ms_passes','ms_requests','ms_request_notes','ms_profile_changes','ms_invites','ms_rate_limits','ms_audit','ms_import_batches'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public, anon, authenticated',t);
  -- Defense in depth for accidental future grants; RPC executes as the migration owner.
  execute format('drop policy if exists ms_admin_only on public.%I',t);
  execute format('create policy ms_admin_only on public.%I for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin())',t);
 end loop;
end $$;
revoke all on function public.ms_kst_today() from public,anon,authenticated;
revoke all on function public.ms_facility_overlap(text,text) from public,anon,authenticated;
revoke all on function public.ms_rate(text,integer) from public,anon,authenticated;
revoke all on function public.ms_files_valid(text[],text,uuid,integer) from public,anon,authenticated;
revoke all on function public.ms_expire_gx(uuid) from public,anon,authenticated;
revoke all on function public.member_service(text,jsonb) from public;
grant execute on function public.member_service(text,jsonb) to anon,authenticated;
revoke all on function public.ms_file_read(text) from public;
grant execute on function public.ms_file_read(text) to anon,authenticated;
revoke all on function public.ms_file_upload(text) from public,anon;
grant execute on function public.ms_file_upload(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('member-service-files','member-service-files',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists ms_files_read on storage.objects;
create policy ms_files_read on storage.objects for select to anon,authenticated
using(bucket_id='member-service-files' and public.ms_file_read(name));
drop policy if exists ms_files_upload on storage.objects;
create policy ms_files_upload on storage.objects for insert to authenticated with check(
 bucket_id='member-service-files' and public.ms_file_upload(name));
-- No UPDATE policy: immutable object paths prevent silently changing already reviewed attachments.
-- No client DELETE policy: removing references hides photos; retention is an audited operator task.
commit;
