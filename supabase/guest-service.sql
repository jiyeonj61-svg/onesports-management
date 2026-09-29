-- OneSports anonymous intake. Apply AFTER member-service.sql. No Auth configuration changes.
-- Existing collection switches stay unchanged. No existing members are matched automatically.
begin;
create table if not exists public.ms_guest_submissions (
 id uuid primary key default gen_random_uuid(), receipt_no text not null unique,
 secret_hash bytea not null check(octet_length(secret_hash)=32), phone_hash bytea not null,
 kind text not null check(kind in ('application','request')),
 program text check(program in ('common','fitness_golf','gx')),
 status text not null default 'draft' check(status in ('draft','received','needs_review','cancelled','converted','reviewing','in_progress','completed','needs_info','held','declined')),
 expires_at timestamptz not null default now()+interval '20 minutes',
 profile_snapshot jsonb, application_payload jsonb, request_payload jsonb,
 product_snapshot jsonb, amount integer check(amount>=0), consents_snapshot jsonb,
 photo_ids uuid[] not null default '{}', action_photo_ids uuid[] not null default '{}',
 matched_member_id uuid references public.ms_profiles(id), created_profile_id uuid references public.ms_profiles(id),
 linked_application_id uuid unique references public.ms_applications(id),
 reply text not null default '' check(length(reply)<=10000), assignee uuid references auth.users(id),
 created_at timestamptz not null default now(), submitted_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.ms_guest_photos (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.ms_guest_submissions(id),
 purpose text not null check(purpose in ('photo','signature','action')),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
 bytes integer not null check(bytes between 12 and 524288), body bytea not null,
 content_hash bytea not null, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
 unique(submission_id,purpose,content_hash), check(bytes=octet_length(body))
);
create table if not exists public.ms_guest_notes (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.ms_guest_submissions(id),
 body text not null check(length(trim(body)) between 1 and 10000), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.ms_guest_limits (
 key text not null, window_start timestamptz not null, attempts integer not null default 0,
 primary key(key,window_start)
);
alter table public.ms_applications add column if not exists guest_submission_id uuid references public.ms_guest_submissions(id);
create unique index if not exists ms_applications_guest_submission on public.ms_applications(guest_submission_id) where guest_submission_id is not null;
alter table public.ms_applications alter column submitted_by drop not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='ms_applications_submission_source' and conrelid='public.ms_applications'::regclass) then
  alter table public.ms_applications add constraint ms_applications_submission_source check(submitted_by is not null or guest_submission_id is not null);
 end if;
end $$;
create index if not exists ms_guest_submissions_created on public.ms_guest_submissions(created_at desc);

create or replace function public.ms_guest_rate(rate_key text,max_count integer,window_unit text default 'hour') returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 insert into public.ms_guest_limits(key,window_start,attempts) values(rate_key,date_trunc(window_unit,now()),1)
 on conflict(key,window_start) do update set attempts=ms_guest_limits.attempts+1 returning attempts into n;
 return n<=max_count;
end $$;
create or replace function public.ms_guest_secret_matches(secret text,expected bytea) returns boolean
language plpgsql immutable set search_path=pg_catalog,public,extensions as $$
declare actual bytea; difference integer:=0; i integer;
begin
 -- Compare all 32 hash bytes. Never store or return the receipt key after ticket creation.
 if secret is null or secret !~ '^[0-9a-f]{64}$' or expected is null or octet_length(expected)<>32 then return false; end if;
 actual:=digest(secret,'sha256');
 for i in 0..31 loop difference:=difference | (get_byte(actual,i) # get_byte(expected,i)); end loop;
 return difference=0;
end $$;
create or replace function public.ms_guest_receipt(receipt_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.ms_guest_submissions%rowtype; app jsonb; requestj jsonb; cfg jsonb; photos jsonb; bank_allowed boolean:=false;
begin
 select * into r from public.ms_guest_submissions where id=receipt_id;
 select data into cfg from public.ms_settings where id=true;
 if r.linked_application_id is not null then
  select to_jsonb(t)-array['member_id','submitted_by','processed_by','idempotency_key','guest_submission_id','previous_start_date','previous_end_date'] into app from public.ms_applications t where id=r.linked_application_id;
 else app:=r.application_payload; end if;
 if r.kind='application' and app is not null then
  if r.linked_application_id is null then app:=app||jsonb_build_object('application_status',r.status); end if;
  -- Read-time expiry closes bank instructions even before another class operation persists expiry.
  -- Reported payments and administrator holds are deliberately protected from automatic expiry.
  if app->>'reservation_status'='reserved' and app->>'payment_status'='awaiting' and app->>'application_status' in ('new','pending') and (app->>'reservation_expires_at')::timestamptz<=now() then app:=app||jsonb_build_object('reservation_status','expired'); end if;
  bank_allowed:=app->>'payment_method'='transfer' and app->>'application_status' not in ('draft','cancelled','refund_required','needs_review') and coalesce(app->>'reservation_status','none') not in ('unassigned','waitlisted','expired','cancelled');
 end if;
 if r.kind='request' then requestj:=r.request_payload||jsonb_build_object('status',r.status,'reply',r.reply,'action_photo_ids',to_jsonb(r.action_photo_ids)); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'mime',mime,'bytes',bytes,'purpose',purpose) order by created_at),'[]') into photos from public.ms_guest_photos where submission_id=r.id and (id=any(r.photo_ids||r.action_photo_ids) or (purpose='signature' and id::text=r.application_payload->>'signature_photo_id'));
 cfg:=cfg-array['privacy_purpose','privacy_items','privacy_retention'];
 if not bank_allowed then cfg:=cfg-array['bank_name','bank_account','bank_holder']; end if;
 return jsonb_build_object('ticket_id',r.id,'receipt_no',r.receipt_no,'kind',r.kind,'program',coalesce(r.program,app->'form_snapshot'->>'program','common'),'status',coalesce(app->>'application_status',r.status),'intake_status',r.status,'profile_snapshot',r.profile_snapshot,'application',app,'request',requestj,'photos',photos,'settings',cfg,'created_at',r.created_at,'submitted_at',r.submitted_at);
end $$;

create or replace function public.guest_service(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
 adm boolean:=public.is_app_admin(); u uuid:=auth.uid(); s jsonb; r public.ms_guest_submissions%rowtype;
 p public.ms_products%rowtype; g public.ms_gx_classes%rowtype; a public.ms_applications%rowtype; m public.ms_profiles%rowtype; f public.ms_forms%rowtype;
 photo public.ms_guest_photos%rowtype; d jsonb; fieldj jsonb; outj jsonb; consentj jsonb; snap jsonb; beforej jsonb;
 programv text; ident uuid; ids uuid[]; secret text; phone text; v text; key text; op text; kindv text; reservev text;
 raw bytea; hashv bytea; countv integer; sizev integer; total_bytes bigint; pricev integer; childv boolean;
 startd date; endd date; prevstart date; prevend date; expires timestamptz;
begin
 if action is null or action<>all(array['prepare','receipt','photo','upload_photo','submit_application','submit_request','payment_report','admin_list','admin_detail','admin_create_member','admin_match','admin_convert','admin_action','admin_update_request','admin_upload_photo']) or payload is null or jsonb_typeof(payload)<>'object' or length(payload::text)>800000 then return jsonb_build_object('ok',false,'error','요청 종류, 크기 또는 형식을 확인해 주세요.'); end if;
 select data into s from public.ms_settings where id=true for share;
 if action in ('prepare','upload_photo','submit_application','submit_request') then
  perform pg_advisory_xact_lock(813012); perform pg_advisory_xact_lock(813011);
  if coalesce(trim(s->>'privacy_purpose'),'')='' or coalesce(trim(s->>'privacy_items'),'')='' or coalesce(trim(s->>'privacy_retention'),'')='' then return jsonb_build_object('ok',false,'error','개인정보 안내 설정 확인 후 접수를 시작합니다.'); end if;
 end if;
 if action like 'admin_%' and not adm then return jsonb_build_object('ok',false,'error','승인된 관리자 권한이 필요합니다.'); end if;
 if not adm then
  if coalesce(payload->>'honeypot','')<>'' then return jsonb_build_object('ok',false,'error','접수 내용을 확인해 주세요.'); end if;
  if not public.ms_guest_rate('all:global',1200) then return jsonb_build_object('ok',false,'error','접속이 많습니다. 잠시 후 다시 시도해 주세요.'); end if;
 end if;
 -- Validation errors roll back this inner block, retaining anonymous rate counters outside it.
 begin
 if action='prepare' then
  kindv:=payload->>'kind';
  if kindv not in ('application','request') or kindv is null then raise exception '접수 종류를 확인해 주세요.'; end if;
  programv:=case when kindv='request' then 'common' else coalesce(nullif(payload->>'program',''),'common') end;
  if programv not in ('common','fitness_golf','gx') or (kindv='application' and programv='common' and exists(select 1 from public.ms_forms where program<>'common')) then raise exception '신청할 프로그램을 선택하고 접수를 다시 시작해 주세요.'; end if;
  if kindv='application' then
   select * into f from public.ms_form_for(programv); if f.id is null then raise exception '선택한 프로그램의 신청서 설정이 필요합니다.'; end if;
   if not exists(select 1 from public.ms_terms where active and approved and kind='rules' and program=f.program) then raise exception '선택한 프로그램의 이용규정 확인 후 접수를 시작합니다.'; end if;
  end if;
  if not coalesce((s->>(case when kindv='application' then 'applications_enabled' else 'requests_enabled' end))::boolean,false) then raise exception '관리자 운영 설정 확인 후 접수를 시작합니다.'; end if;
  if coalesce(trim(s->>'privacy_purpose'),'')='' or coalesce(trim(s->>'privacy_items'),'')='' or coalesce(trim(s->>'privacy_retention'),'')='' or not exists(select 1 from public.ms_terms_for(programv) where kind='privacy') then raise exception '개인정보 안내 설정 확인 후 접수를 시작합니다.'; end if;
  if jsonb_typeof(coalesce(payload->'consents','[]'))<>'array' or exists(select 1 from public.ms_terms_for(programv) where kind='privacy' and (required or kindv='application') and not(coalesce(payload->'consents','[]') ? id::text)) then raise exception '개인정보 안내를 읽고 동의해 주세요.'; end if;
  phone:=regexp_replace(coalesce(payload->>'phone',''),'[^0-9]','','g');
  if phone !~ '^[0-9]{8,15}$' then raise exception '연락처를 확인해 주세요.'; end if;
  hashv:=digest(phone,'sha256');
  -- No claimed IP or arbitrary headers are trusted. These quotas fail closed under abuse.
  if not public.ms_guest_rate('prepare:global',100) or not public.ms_guest_rate('prepare:day',300,'day') or not public.ms_guest_rate('prepare:phone:'||encode(hashv,'hex'),5) or not public.ms_guest_rate('prepare:phone-day:'||encode(hashv,'hex'),20,'day') then
   return jsonb_build_object('ok',false,'error','접수 시도 한도를 초과했습니다. 잠시 후 다시 시도하거나 안내데스크에 문의해 주세요.');
  end if;
  secret:=encode(gen_random_bytes(32),'hex');
  insert into public.ms_guest_submissions(receipt_no,secret_hash,phone_hash,kind,program)
  values((case when kindv='application' then 'A-' else 'R-' end)||to_char(public.ms_kst_today(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),digest(secret,'sha256'),hashv,kindv,programv) returning * into r;
  return jsonb_build_object('ok',true,'ticket_id',r.id,'receipt_no',r.receipt_no,'receipt_key',secret,'expires_at',r.expires_at,'program',r.program);
 end if;

 if action='admin_list' then
  kindv:=case payload->>'entity' when 'applications' then 'application' when 'requests' then 'request' end;
  if kindv is null then raise exception '목록 종류를 확인해 주세요.'; end if;
  select coalesce(jsonb_agg(x.data),'[]') into outj from (
   select to_jsonb(t)-array['secret_hash','phone_hash']||jsonb_build_object('linked_application',(select to_jsonb(app) from public.ms_applications app where app.id=t.linked_application_id)) data
   from public.ms_guest_submissions t where t.kind=kindv and t.status<>'draft'
   and (nullif(payload->>'status','') is null or t.status=payload->>'status')
   and (nullif(payload->>'search','') is null or (coalesce(t.profile_snapshot::text,'')||t.receipt_no||coalesce(t.request_payload::text,'')) ilike '%'||(payload->>'search')||'%')
   and (nullif(payload->>'category_id','') is null or t.request_payload->>'category_id'=payload->>'category_id')
   and (nullif(payload->>'location','') is null or t.request_payload->>'location' ilike '%'||(payload->>'location')||'%')
   and (nullif(payload->>'date_from','') is null or (t.created_at at time zone 'Asia/Seoul')::date>=(payload->>'date_from')::date)
   and (nullif(payload->>'date_to','') is null or (t.created_at at time zone 'Asia/Seoul')::date<=(payload->>'date_to')::date)
   order by t.created_at desc limit 1000) x;
  return jsonb_build_object('ok',true,'items',outj);
 end if;
 if action='photo' and adm then
  select * into photo from public.ms_guest_photos where id=(payload->>'photo_id')::uuid;
  if photo.id is null then raise exception '사진을 찾을 수 없습니다.'; end if;
  return jsonb_build_object('ok',true,'photo',jsonb_build_object('id',photo.id,'mime',photo.mime,'base64',encode(photo.body,'base64')));
 end if;

 ident:=coalesce(nullif(payload->>'ticket_id','')::uuid,nullif(payload->>'id','')::uuid);
 if ident is not null then select * into r from public.ms_guest_submissions where id=ident for update;
 else select * into r from public.ms_guest_submissions where receipt_no=upper(trim(payload->>'receipt_no')) for update; end if;
 if not (adm and action like 'admin_%') then
  if not public.ms_guest_secret_matches(payload->>'receipt_key',r.secret_hash) then return jsonb_build_object('ok',false,'error','접수번호와 확인키를 확인해 주세요.'); end if;
 end if;
 if r.id is null then raise exception '접수를 찾을 수 없습니다.'; end if;
 programv:=coalesce(r.program,'common');
 if action in ('upload_photo','submit_application','submit_request') and r.status='draft' then
  if r.kind='application' and programv='common' and exists(select 1 from public.ms_forms where program<>'common') then raise exception '프로그램별 신청서가 변경되었습니다. 접수를 다시 시작해 주세요.'; end if;
  if not exists(select 1 from public.ms_terms_for(programv) where kind='privacy') then raise exception '선택한 접수의 개인정보 안내 확인 후 접수를 시작합니다.'; end if;
  if r.kind='application' then select * into f from public.ms_form_for(programv); if f.id is null then raise exception '선택한 프로그램의 신청서 설정이 필요합니다.'; end if; end if;
 end if;

 if action='receipt' then
  if r.status='draft' then raise exception '아직 최종 접수되지 않았습니다.'; end if;
  return jsonb_build_object('ok',true,'receipt',public.ms_guest_receipt(r.id));
 end if;
 if action='photo' then
  if r.status='draft' then raise exception '아직 접수되지 않은 사진입니다.'; end if;
  select * into photo from public.ms_guest_photos where id=(payload->>'photo_id')::uuid and submission_id=r.id and (id=any(r.photo_ids||r.action_photo_ids) or (purpose='signature' and id::text=r.application_payload->>'signature_photo_id'));
  if photo.id is null then raise exception '사진을 찾을 수 없습니다.'; end if;
  return jsonb_build_object('ok',true,'photo',jsonb_build_object('id',photo.id,'mime',photo.mime,'base64',encode(photo.body,'base64')));
 end if;

 if action in ('upload_photo','admin_upload_photo') then
  kindv:=coalesce(payload->>'purpose',case when action='admin_upload_photo' then 'action' else 'photo' end);
  if action='upload_photo' then
   if r.status<>'draft' or r.expires_at<=now() then raise exception '접수 준비 시간이 지났습니다. 다시 작성해 주세요.'; end if;
   if not coalesce((s->>(case when r.kind='application' then 'applications_enabled' else 'requests_enabled' end))::boolean,false) or not exists(select 1 from public.ms_terms_for(programv) where kind='privacy') then raise exception '현재 사진 접수가 중단되어 있습니다.'; end if;
   if r.kind='application' and not exists(select 1 from public.ms_terms where active and approved and kind='rules' and program=f.program) then raise exception '선택한 프로그램의 이용규정 확인 후 서명을 접수합니다.'; end if;
   if not ((r.kind='request' and kindv='photo') or (r.kind='application' and kindv='signature' and f.signature_mode in ('new','always'))) then raise exception '허용되지 않은 사진 종류입니다.'; end if;
  elsif r.kind<>'request' or r.status='draft' or kindv<>'action' then raise exception '접수된 요청의 조치 사진만 등록할 수 있습니다.'; end if;
  if payload->>'mime' not in ('image/jpeg','image/png','image/webp') or payload->>'mime' is null then raise exception 'JPEG, PNG, WebP 이미지만 첨부할 수 있습니다.'; end if;
  raw:=decode(payload->>'base64','base64'); sizev:=octet_length(raw);
  if sizev is null or sizev not between 12 and 524288 then raise exception '사진 한 장은 512 KiB 이하여야 합니다.'; end if;
  if not ((payload->>'mime'='image/jpeg' and substring(raw from 1 for 3)=decode('ffd8ff','hex')) or (payload->>'mime'='image/png' and substring(raw from 1 for 8)=decode('89504e470d0a1a0a','hex')) or (payload->>'mime'='image/webp' and substring(raw from 1 for 4)=decode('52494646','hex') and substring(raw from 9 for 4)=decode('57454250','hex'))) then raise exception '이미지 파일 형식을 확인해 주세요.'; end if;
  hashv:=digest(raw,'sha256');
  if nullif(payload->>'replace_photo_id','') is not null then
   if action<>'upload_photo' or r.status<>'draft' then raise exception '최종 접수 전 임시 사진만 교체할 수 있습니다.'; end if;
   select * into photo from public.ms_guest_photos where id=(payload->>'replace_photo_id')::uuid and submission_id=r.id and purpose=kindv for update;
   if photo.id is null then raise exception '교체할 사진을 확인해 주세요.'; end if;
   perform pg_advisory_xact_lock(914201);
   select coalesce(sum(bytes),0) into total_bytes from public.ms_guest_photos;
   if total_bytes-photo.bytes+sizev>52428800 then raise exception '사진 보관 한도에 도달했습니다.'; end if;
   update public.ms_guest_photos set body=raw,bytes=sizev,mime=payload->>'mime',content_hash=hashv where id=photo.id returning * into photo;
   return jsonb_build_object('ok',true,'photo',jsonb_build_object('id',photo.id,'mime',photo.mime,'bytes',photo.bytes,'purpose',photo.purpose));
  end if;
  select * into photo from public.ms_guest_photos where submission_id=r.id and purpose=kindv and content_hash=hashv;
  if photo.id is null then
   perform pg_advisory_xact_lock(914201);
   select count(*) into countv from public.ms_guest_photos where submission_id=r.id and purpose=kindv;
   if countv>=(case when kindv='signature' then 1 when kindv='photo' then least(3,(s->>'photo_limit')::integer) else 3 end) then raise exception '허용된 사진 개수를 초과했습니다.'; end if;
   select coalesce(sum(bytes),0) into total_bytes from public.ms_guest_photos;
   if total_bytes+sizev>52428800 then raise exception '사진 보관 한도에 도달했습니다. 사진 없이 접수하거나 안내데스크에 문의해 주세요.'; end if;
   insert into public.ms_guest_photos(submission_id,purpose,mime,bytes,body,content_hash,created_by) values(r.id,kindv,payload->>'mime',sizev,raw,hashv,case when action='admin_upload_photo' then u else null end) returning * into photo;
  end if;
  return jsonb_build_object('ok',true,'photo',jsonb_build_object('id',photo.id,'mime',photo.mime,'bytes',photo.bytes,'purpose',photo.purpose));
 end if;

 if action in ('submit_application','submit_request') then
  if (action='submit_application' and r.kind<>'application') or (action='submit_request' and r.kind<>'request') then raise exception '접수 종류를 확인해 주세요.'; end if;
  if r.status<>'draft' then return jsonb_build_object('ok',true,'receipt',public.ms_guest_receipt(r.id),'duplicate',true); end if;
  if action='submit_application' and payload->>'kind' is distinct from 'renewal' then raise exception '최초 이용 신청은 안내데스크에서 수기 이용신청서를 작성해 주세요. 온라인에서는 기존 회원 재등록만 접수합니다.'; end if;
  if r.expires_at<=now() then raise exception '접수 준비 시간이 지났습니다. 다시 작성해 주세요.'; end if;
  if not coalesce((s->>(case when r.kind='application' then 'applications_enabled' else 'requests_enabled' end))::boolean,false) then raise exception '관리자 운영 설정 확인 후 접수를 시작합니다.'; end if;
  d:=payload->'profile';
  if jsonb_typeof(d)<>'object' or coalesce(length(trim(d->>'name')),0) not between 1 and 80 or coalesce(length(trim(d->>'building')),0) not between 1 and 30 or coalesce(length(trim(d->>'unit')),0) not between 1 and 30 or coalesce(d->>'phone','') !~ '^[0-9+() -]{8,24}$' then raise exception '이름, 동, 호수, 연락처를 확인해 주세요.'; end if;
  phone:=regexp_replace(d->>'phone','[^0-9]','','g');
  if digest(phone,'sha256')<>r.phone_hash then raise exception '연락처가 변경되었습니다. 접수를 다시 시작해 주세요.'; end if;
  d:=jsonb_build_object('name',trim(d->>'name'),'building',trim(d->>'building'),'unit',trim(d->>'unit'),'phone',trim(d->>'phone'));
  if r.kind='application' then
   if ((nullif(payload->>'product_id','') is null)=(nullif(payload->>'gx_class_id','') is null)) then raise exception '이용권 또는 GX 반 하나를 선택해 주세요.'; end if;
   v:=case when nullif(payload->>'gx_class_id','') is not null then 'gx' else 'fitness_golf' end;
   if programv<>'common' and programv<>v then raise exception '신청 프로그램이 변경되었습니다. 접수를 다시 시작해 주세요.'; end if;
   programv:=v; select * into f from public.ms_form_for(programv);
  end if;
  if not exists(select 1 from public.ms_terms_for(programv) where kind='privacy') then raise exception '개인정보 안내 설정 확인 후 접수를 시작합니다.'; end if;
  childv:=exists(select 1 from public.ms_gx_classes where id=nullif(payload->>'gx_class_id','')::uuid and is_child);
  if jsonb_typeof(coalesce(payload->'consents','[]'))<>'array' or exists(select 1 from public.ms_terms_for(programv) where (required or (r.kind='application' and kind in ('privacy','rules'))) and (kind='privacy' or (r.kind='application' and (kind<>'guardian' or childv))) and not (coalesce(payload->'consents','[]') ? id::text)) then raise exception '이용규정과 개인정보 안내를 각각 확인하고 필수 항목에 동의해 주세요.'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)-'created_by'||jsonb_build_object('agreed_at',now(),'receipt_no',r.receipt_no)),'[]') into consentj from public.ms_terms_for(programv) t where (kind='privacy' or (r.kind='application' and (kind<>'guardian' or childv))) and (coalesce(payload->'consents','[]') ? t.id::text);
  if r.kind='request' then
   if not exists(select 1 from public.ms_categories where id=(payload->>'category_id')::uuid and kind='request' and active) then raise exception '건의 분류를 확인해 주세요.'; end if;
   if coalesce(length(trim(payload->>'title')),0) not between 1 and 160 or coalesce(length(trim(payload->>'body')),0) not between 1 and 10000 or length(coalesce(payload->>'location',''))>300 or length(coalesce(payload->>'item_name',''))>150 then raise exception '제목과 내용을 확인해 주세요.'; end if;
   if nullif(payload->>'quantity','') is not null and (payload->>'quantity')::integer not between 1 and 100000 then raise exception '수량을 확인해 주세요.'; end if;
   select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(payload->'photo_ids','[]'));
   if cardinality(ids)>least(3,(s->>'photo_limit')::integer) or exists(select 1 from unnest(ids) x where not exists(select 1 from public.ms_guest_photos where id=x and submission_id=r.id and purpose='photo')) then raise exception '첨부 사진을 확인해 주세요.'; end if;
   snap:=jsonb_build_object('title',trim(payload->>'title'),'body',trim(payload->>'body'),'category_id',payload->>'category_id','location',coalesce(payload->>'location',''),'item_name',coalesce(payload->>'item_name',''),'quantity',nullif(payload->>'quantity','')::integer,'photo_ids',to_jsonb(ids),'consents_snapshot',consentj);
   update public.ms_guest_submissions set profile_snapshot=d,request_payload=snap,consents_snapshot=consentj,photo_ids=ids,status='received',submitted_at=now(),updated_at=now() where id=r.id returning * into r;
  else
   if payload->>'payment_method' not in ('card','transfer') or payload->>'payment_method' is null then raise exception '카드 또는 계좌이체를 선택해 주세요.'; end if;
   if payload->>'payment_method'='transfer' and (coalesce(trim(s->>'bank_name'),'')='' or coalesce(trim(s->>'bank_account'),'')='' or coalesce(trim(s->>'bank_holder'),'')='') then raise exception '입금계좌 설정 전에는 계좌이체 신청을 할 수 없습니다.'; end if;
   if not exists(select 1 from public.ms_terms where active and approved and kind='rules' and program=f.program) then raise exception '선택한 프로그램의 이용규정 확인 후 접수를 시작합니다.'; end if;
   if f.id is null or nullif(payload->>'expected_form_id','')::uuid is distinct from f.id then raise exception '신청서가 변경되었습니다. 내용을 다시 확인해 주세요.'; end if;
   if jsonb_typeof(coalesce(payload->'form_values','{}'))<>'object' or length(coalesce(payload->'form_values','{}')::text)>20000 then raise exception '추가 입력 항목을 확인해 주세요.'; end if;
   for fieldj in select value from jsonb_array_elements(f.fields) loop
    key:=fieldj->>'key'; v:=payload->'form_values'->>key;
    if coalesce((fieldj->>'required')::boolean,false) and (coalesce(trim(v),'')='' or (fieldj->>'type'='checkbox' and v<>'true')) then raise exception '필수 항목을 입력해 주세요: %',fieldj->>'label'; end if;
    if length(v)>3000 or (nullif(v,'') is not null and fieldj->>'type'='select' and not(fieldj->'options' ? v)) or (v is not null and fieldj->>'type'='checkbox' and v not in ('true','false')) then raise exception '추가 입력 내용을 확인해 주세요.'; end if;
   end loop;
   if exists(select 1 from jsonb_object_keys(coalesce(payload->'form_values','{}')) k where not exists(select 1 from jsonb_array_elements(f.fields) x where x->>'key'=k)) then raise exception '허용되지 않은 신청서 항목입니다.'; end if;
   if ((nullif(payload->>'product_id','') is null)=(nullif(payload->>'gx_class_id','') is null)) then raise exception '이용권 또는 GX 반 하나를 선택해 주세요.'; end if;
   if nullif(payload->>'product_id','') is not null then
    select * into p from public.ms_products where id=(payload->>'product_id')::uuid and active and reviewed and effective_from<=public.ms_kst_today();
    if p.id is null then raise exception '현재 신청할 수 없는 이용권입니다.'; end if;
    snap:=to_jsonb(p); pricev:=p.price; reservev:='none';
   else
    select * into g from public.ms_gx_classes where id=(payload->>'gx_class_id')::uuid;
    if g.id is null or not g.reviewed or g.status<>'open' or now()<g.registration_start or now()>g.registration_end or g.period_start<public.ms_kst_today() then raise exception '현재 접수 중인 GX 반이 아닙니다.'; end if;
    if g.is_child and (coalesce(trim(payload->>'student_name'),'')='' or not coalesce((payload->>'guardian_consent')::boolean,false)) then raise exception '수강생 이름과 보호자 동의가 필요합니다.'; end if;
    snap:=to_jsonb(g); pricev:=g.price; reservev:='unassigned'; startd:=g.period_start; endd:=g.period_end;
   end if;
   if nullif(payload->>'expected_amount','')::integer is distinct from pricev or nullif(payload->>'expected_catalog_updated_at','')::timestamptz is distinct from (snap->>'updated_at')::timestamptz then raise exception '금액 또는 이용기간이 변경되었습니다. 다시 확인해 주세요.'; end if;
   if nullif(payload->>'desired_start_date','')::date>public.ms_kst_today()+366 then raise exception '희망 시작일을 확인해 주세요.'; end if;
   if (f.signature_mode='always' or (f.signature_mode='new' and payload->>'kind'='new')) and nullif(payload->>'signature_photo_id','') is null then raise exception '선택한 신청서에는 서명이 필요합니다.'; end if;
   if f.signature_mode='none' and nullif(payload->>'signature_photo_id','') is not null then raise exception '이 신청서는 서명을 수집하지 않습니다.'; end if;
   if nullif(payload->>'signature_photo_id','') is not null and not exists(select 1 from public.ms_guest_photos where id=(payload->>'signature_photo_id')::uuid and submission_id=r.id and purpose='signature') then raise exception '서명을 확인해 주세요.'; end if;
   outj:=jsonb_build_object('program',programv,'kind',payload->>'kind','product_id',p.id,'gx_class_id',g.id,'product_snapshot',snap,'amount',pricev,'payment_method',payload->>'payment_method','payer_name',left(coalesce(payload->>'payer_name',d->>'name'),80),'desired_start_date',nullif(payload->>'desired_start_date','')::date,'proposed_start_date',startd,'proposed_end_date',endd,'application_status','received','payment_status','awaiting','pass_status','pending','external_status','pending','reservation_status',reservev,'consents_snapshot',consentj,'form_snapshot',to_jsonb(f)-'created_by','form_values',coalesce(payload->'form_values','{}'),'signature_photo_id',nullif(payload->>'signature_photo_id','')::uuid,'student_name',left(payload->>'student_name',80),'guardian_consent',coalesce((payload->>'guardian_consent')::boolean,false));
   update public.ms_guest_submissions set profile_snapshot=d,application_payload=outj,product_snapshot=snap,amount=pricev,consents_snapshot=consentj,status='received',submitted_at=now(),updated_at=now() where id=r.id returning * into r;
  end if;
  insert into public.ms_audit(entity,entity_id,action,after_data,actor_id) values('guest_'||r.kind,r.id,'submitted',jsonb_build_object('receipt_no',r.receipt_no),null);
  return jsonb_build_object('ok',true,'receipt',public.ms_guest_receipt(r.id));
 end if;

 if action='payment_report' then
  if r.kind<>'application' or r.status in ('draft','cancelled','needs_review') then raise exception '현재 입금 확인을 요청할 수 없습니다.'; end if;
  if r.linked_application_id is not null then
   select * into a from public.ms_applications where id=r.linked_application_id for update;
   if a.payment_method<>'transfer' or a.application_status in ('cancelled','refund_required','needs_review') or a.reservation_status in ('waitlisted','expired','cancelled') then raise exception '배정과 결제방식을 확인해 주세요.'; end if;
   if a.reservation_status='reserved' and a.payment_status='awaiting' and a.reservation_expires_at<=now() then raise exception 'GX 결제기한이 지났습니다. 입금 전 안내데스크에 확인해 주세요.'; end if;
   if a.payment_status in ('awaiting','reported') then update public.ms_applications set payment_status='reported',payer_name=left(coalesce(nullif(payload->>'payer_name',''),payer_name),80),updated_at=now() where id=a.id; end if;
  else
   if r.application_payload->>'payment_method'<>'transfer' or r.application_payload->>'reservation_status'='unassigned' then raise exception 'GX 자리 배정 전에는 입금하지 마세요.'; end if;
   update public.ms_guest_submissions set application_payload=application_payload||jsonb_build_object('payment_status','reported','payer_name',left(coalesce(nullif(payload->>'payer_name',''),application_payload->>'payer_name'),80)),updated_at=now() where id=r.id;
  end if;
  insert into public.ms_audit(entity,entity_id,action,actor_id) values('guest_application',r.id,'payment_reported',null);
  return jsonb_build_object('ok',true,'receipt',public.ms_guest_receipt(r.id));
 end if;

 if not adm then raise exception '허용되지 않은 요청입니다.'; end if;
 if action='admin_detail' then
  outj:=to_jsonb(r)-array['secret_hash','phone_hash'];
  outj:=outj||jsonb_build_object('linked_application',(select to_jsonb(t) from public.ms_applications t where id=r.linked_application_id),'photos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'mime',mime,'bytes',bytes,'purpose',purpose)) from public.ms_guest_photos where submission_id=r.id),'[]'),'internal_notes',coalesce((select jsonb_agg(to_jsonb(t) order by created_at) from public.ms_guest_notes t where submission_id=r.id),'[]'),'history',coalesce((select jsonb_agg(to_jsonb(t) order by created_at) from public.ms_audit t where entity_id=r.id),'[]'));
  return jsonb_build_object('ok',true,'item',outj);
 end if;
 if r.status='draft' then raise exception '아직 최종 접수되지 않았습니다.'; end if;
 beforej:=to_jsonb(r)-array['secret_hash','phone_hash'];
 if action='admin_create_member' then
  if r.kind<>'application' or r.status='cancelled' or r.linked_application_id is not null then raise exception '회원 확인 대기 신청만 처리할 수 있습니다.'; end if;
  if r.created_profile_id is not null then select * into m from public.ms_profiles where id=r.created_profile_id;
  else
   d:=r.profile_snapshot;
   insert into public.ms_profiles(name,building,unit,phone) values(d->>'name',d->>'building',d->>'unit',d->>'phone') returning * into m;
   update public.ms_guest_submissions set created_profile_id=m.id,updated_at=now() where id=r.id returning * into r;
   insert into public.ms_audit(entity,entity_id,action,after_data,actor_id) values('guest_application',r.id,'pending_member_created',jsonb_build_object('member_id',m.id),u);
  end if;
  return jsonb_build_object('ok',true,'item',to_jsonb(r)-array['secret_hash','phone_hash'],'profile',to_jsonb(m));
 elsif action='admin_match' then
  if r.kind<>'application' or r.status='cancelled' or r.linked_application_id is not null then raise exception '연결 전 신청만 처리할 수 있습니다.'; end if;
  select * into m from public.ms_profiles where id=(payload->>'member_id')::uuid for update;
  if m.id is null or not m.active or not m.approved or not m.resident_verified then raise exception '현장 확인 및 승인된 회원을 직접 선택해 주세요.'; end if;
  update public.ms_guest_submissions set matched_member_id=m.id,updated_at=now() where id=r.id returning * into r;
 elsif action='admin_convert' then
  if r.linked_application_id is not null then return jsonb_build_object('ok',true,'item',to_jsonb(r)-array['secret_hash','phone_hash'],'application',(select to_jsonb(t) from public.ms_applications t where id=r.linked_application_id),'duplicate',true); end if;
  if r.kind<>'application' or r.status='cancelled' or r.matched_member_id is null then raise exception '먼저 현장에서 확인한 회원을 연결해 주세요.'; end if;
  select * into m from public.ms_profiles where id=r.matched_member_id for update;
  if not m.active or not m.approved or not m.resident_verified then raise exception '회원 현장 확인과 승인이 필요합니다.'; end if;
  d:=r.application_payload; snap:=r.product_snapshot;
  reservev:='none';
  if nullif(d->>'gx_class_id','') is not null then
   select * into g from public.ms_gx_classes where id=(d->>'gx_class_id')::uuid for update;
   if g.id is null or g.status<>'open' or g.period_start<public.ms_kst_today() or now()>g.registration_end then raise exception 'GX 접수기간과 운영상태를 확인해 주세요.'; end if;
   if to_jsonb(g)->>'period_start' is distinct from snap->>'period_start' or to_jsonb(g)->>'period_end' is distinct from snap->>'period_end' or to_jsonb(g)->>'start_time' is distinct from snap->>'start_time' or to_jsonb(g)->'weekdays' is distinct from snap->'weekdays' then raise exception '신청 후 GX 일정이 변경되었습니다. 회원에게 안내 후 새로 접수해 주세요.'; end if;
   if g.priority_start is not null and now()>=g.priority_start and now()<g.priority_end and not exists(select 1 from public.ms_passes t join public.ms_gx_classes oldg on oldg.id=t.gx_class_id where t.member_id=m.id and t.status='active' and oldg.name=g.name and oldg.class_name=g.class_name and oldg.period_end=(select max(z.period_end) from public.ms_gx_classes z where z.name=g.name and z.class_name=g.class_name and z.period_end<g.period_start)) then raise exception '우선접수 대상 기존 수강생 확인이 필요합니다.'; end if;
   perform public.ms_expire_gx(g.id);
   select count(*) into countv from public.ms_applications where gx_class_id=g.id and reservation_status in ('reserved','confirmed');
   if countv>=g.capacity then if not g.waitlist_enabled then raise exception '정원 마감입니다. 신청을 보류하고 회원에게 안내해 주세요.'; end if; reservev:='waitlisted';
   else reservev:='reserved';expires:=now()+make_interval(hours=>g.payment_due_hours);end if;
   startd:=(snap->>'period_start')::date;endd:=(snap->>'period_end')::date;
  else
   select * into p from public.ms_products where id=(d->>'product_id')::uuid;
   if p.id is null or not p.active or not p.reviewed then raise exception '현재 중단된 상품입니다. 신청을 보류하고 운영자 확인 후 처리해 주세요.'; end if;
   -- Already accepted price/duration/name stay exactly as consented, even after catalog edits.
   select min(start_date),max(end_date) into prevstart,prevend from public.ms_passes where member_id=m.id and facility=snap->>'facility' and status='active';
   startd:=greatest(public.ms_kst_today(),coalesce((d->>'desired_start_date')::date,public.ms_kst_today()),coalesce(prevend+1,public.ms_kst_today()));endd:=startd+(snap->>'duration_days')::integer-1;
  end if;
  if exists(select 1 from public.ms_applications where member_id=m.id and application_status not in ('cancelled','refund_required') and ((product_id=nullif(d->>'product_id','')::uuid and application_status<>'completed' and desired_start_date is not distinct from nullif(d->>'desired_start_date','')::date) or gx_class_id=g.id)) then raise exception '동일 회원의 중복 신청 후보가 있습니다. 기존 신청을 확인해 주세요.'; end if;
  insert into public.ms_applications(application_no,member_id,kind,product_id,gx_class_id,product_snapshot,amount,payment_method,payer_name,desired_start_date,previous_start_date,previous_end_date,proposed_start_date,proposed_end_date,payment_status,reservation_status,reservation_expires_at,consents_snapshot,form_snapshot,form_values,student_name,guardian_consent,idempotency_key,submitted_by,guest_submission_id,created_at)
  values(r.receipt_no,m.id,d->>'kind',nullif(d->>'product_id','')::uuid,g.id,snap,r.amount,d->>'payment_method',d->>'payer_name',nullif(d->>'desired_start_date','')::date,prevstart,prevend,startd,endd,d->>'payment_status',reservev,expires,r.consents_snapshot,d->'form_snapshot',d->'form_values',d->>'student_name',(d->>'guardian_consent')::boolean,r.id,null,r.id,r.submitted_at) returning * into a;
  update public.ms_guest_submissions set linked_application_id=a.id,status='converted',updated_at=now() where id=r.id returning * into r;
  insert into public.ms_audit(entity,entity_id,action,after_data,actor_id) values('applications',a.id,'guest_converted',jsonb_build_object('guest_submission_id',r.id,'member_id',m.id),u);
 elsif action='admin_action' then
  if r.kind<>'application' or r.linked_application_id is not null then raise exception '연결 후 신청은 기존 신청·수납 메뉴에서 처리해 주세요.'; end if;
  if coalesce(trim(payload->>'note'),'')='' or payload->>'operation' is null or payload->>'operation' not in ('hold','cancel') then raise exception '처리 종류와 사유를 입력해 주세요.'; end if;
  update public.ms_guest_submissions set status=case when payload->>'operation'='hold' then 'needs_review' else 'cancelled' end,reply=left(payload->>'note',2000),updated_at=now() where id=r.id returning * into r;
 elsif action='admin_update_request' then
  if r.kind<>'request' then raise exception '건의 접수만 처리할 수 있습니다.'; end if;
  if payload->>'status' not in ('received','reviewing','in_progress','completed','needs_info','held','declined') or payload->>'status' is null then raise exception '처리상태를 확인해 주세요.'; end if;
  if payload->>'status'='declined' and coalesce(trim(payload->>'reply'),'')='' then raise exception '반영이 어려운 이유를 회원 답변으로 입력해 주세요.'; end if;
  if nullif(payload->>'assignee','') is not null and not exists(select 1 from public.app_admins where user_id=(payload->>'assignee')::uuid and active) then raise exception '승인된 담당자를 선택해 주세요.'; end if;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(payload->'action_photo_ids',to_jsonb(r.action_photo_ids)));
  if cardinality(ids)>3 or exists(select 1 from unnest(ids) x where not exists(select 1 from public.ms_guest_photos where id=x and submission_id=r.id and purpose='action')) then raise exception '조치 사진을 확인해 주세요.'; end if;
  update public.ms_guest_submissions set status=payload->>'status',reply=coalesce(payload->>'reply',reply),action_photo_ids=ids,assignee=case when payload ? 'assignee' then nullif(payload->>'assignee','')::uuid else assignee end,updated_at=now() where id=r.id returning * into r;
  if coalesce(trim(payload->>'internal_note'),'')<>'' then insert into public.ms_guest_notes(submission_id,body,created_by) values(r.id,trim(payload->>'internal_note'),u); end if;
 else raise exception '지원하지 않는 요청입니다.'; end if;
 outj:=to_jsonb(r)-array['secret_hash','phone_hash'];
 insert into public.ms_audit(entity,entity_id,action,before_data,after_data,actor_id) values('guest_'||r.kind,r.id,action,beforej,outj,u);
 if action='admin_convert' then return jsonb_build_object('ok',true,'item',outj,'application',to_jsonb(a)); end if;
 return jsonb_build_object('ok',true,'item',outj);
 exception when others then
  return jsonb_build_object('ok',false,'error',case when sqlstate in ('22P02','23502','22023','22007','22008') then '입력 형식과 필수 항목을 확인해 주세요.' else sqlerrm end);
 end;
end $$;

do $$ declare t text; begin
 foreach t in array array['ms_guest_submissions','ms_guest_photos','ms_guest_notes','ms_guest_limits'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
  execute format('drop policy if exists ms_guest_admin_only on public.%I',t);
  execute format('create policy ms_guest_admin_only on public.%I for all to authenticated using(public.is_app_admin()) with check(public.is_app_admin())',t);
 end loop;
end $$;
revoke all on function public.ms_guest_rate(text,integer,text) from public,anon,authenticated;
revoke all on function public.ms_guest_secret_matches(text,bytea) from public,anon,authenticated;
revoke all on function public.ms_guest_receipt(uuid) from public,anon,authenticated;
revoke all on function public.guest_service(text,jsonb) from public;
grant execute on function public.guest_service(text,jsonb) to anon,authenticated;
commit;
