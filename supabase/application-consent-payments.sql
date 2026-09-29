-- OneSports application consent/payment policy. Apply after program-forms.sql.
-- Targeted, repeatable function upgrade: no table, row, setting, snapshot or privilege changes.
-- New applications require card/transfer and all applicable privacy/rules consents.
-- Existing cash applications/payments and their original snapshots remain readable and processable.
begin;
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
 paths text[]; allowed text[]; confirmed boolean; profile_id uuid; programv text;
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
 'forms',coalesce((select jsonb_agg(to_jsonb(public.ms_form_for(f.program))-'created_by' order by f.program) from public.ms_forms f where active),'[]'),
 'form_programs',coalesce((select jsonb_agg(distinct program) from public.ms_forms where program<>'common'),'[]'),
 'form',(select to_jsonb(public.ms_form_for('common'))-'created_by'));
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
 perform pg_advisory_xact_lock(813012); perform pg_advisory_xact_lock(813011);
 if ((nullif(payload->>'product_id','') is null) = (nullif(payload->>'gx_class_id','') is null)) then raise exception '이용권 또는 GX 반 하나를 선택해 주세요.'; end if;
 programv:=case when nullif(payload->>'gx_class_id','') is not null then 'gx' else 'fitness_golf' end;
 select * into formrow from public.ms_form_for(programv);
 if formrow.id is null then raise exception '선택한 프로그램의 신청서 설정이 필요합니다.'; end if;
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
 if payload->>'payment_method' not in ('card','transfer') or payload->>'payment_method' is null then raise exception '카드 또는 계좌이체를 선택해 주세요.'; end if;
 if payload->>'payment_method'='transfer' and (coalesce(trim(s->>'bank_name'),'')='' or coalesce(trim(s->>'bank_account'),'')='' or coalesce(trim(s->>'bank_holder'),'')='') then raise exception '입금계좌 설정 전에는 계좌이체 신청을 할 수 없습니다.'; end if;
 if jsonb_typeof(coalesce(payload->'consents','[]'))<>'array' then raise exception '동의 내용을 확인해 주세요.'; end if;
 confirmed:=exists(select 1 from public.ms_gx_classes where id=nullif(payload->>'gx_class_id','')::uuid and is_child);
 if exists(select 1 from public.ms_terms_for(programv) t where (required or kind in ('privacy','rules')) and (kind<>'guardian' or confirmed) and not (coalesce(payload->'consents','[]') ? t.id::text)) then raise exception '이용규정과 개인정보 안내를 각각 확인하고 필수 항목에 동의해 주세요.'; end if;
 if not exists(select 1 from public.ms_terms_for(programv) where kind='privacy') or not exists(select 1 from public.ms_terms where active and approved and kind='rules' and program=formrow.program) then raise exception '선택한 프로그램의 개인정보 안내 및 이용규정 승인이 필요합니다.'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)-'created_by'||jsonb_build_object('agreed_at',now(),'member_id',m.id)),'[]') into consentj from public.ms_terms_for(programv) t where (kind<>'guardian' or confirmed) and (coalesce(payload->'consents','[]') ? t.id::text);
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
 if (formrow.signature_mode='always' or (formrow.signature_mode='new' and payload->>'kind'='new')) and nullif(payload->>'signature_path','') is null then raise exception '선택한 신청서에는 서명이 필요합니다.'; end if;
 if formrow.signature_mode='none' and nullif(payload->>'signature_path','') is not null then raise exception '이 신청서는 서명을 수집하지 않습니다.'; end if;
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
  if not exists(select 1 from public.ms_terms where active and approved and kind='privacy' and program='common') then raise exception '개인정보 동의문 관리자 확인 후 접수할 수 있습니다.'; end if;
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
   if coalesce(trim(s->>'privacy_purpose'),'')='' or coalesce(trim(s->>'privacy_items'),'')='' or coalesce(trim(s->>'privacy_retention'),'')='' or not exists(select 1 from public.ms_terms where active and approved and kind='privacy') or ((s->>'requests_enabled')::boolean and not exists(select 1 from public.ms_terms_for('common') where kind='privacy')) then raise exception '개인정보 수집 목적·항목·보유기간 및 승인된 동의문을 먼저 설정해 주세요.'; end if;
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
 when 'terms' then array['title','body','kind','required','approved','active','program']
 when 'forms' then array['fields','active','program','title','signature_mode'] end;
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
  if beforej is not null and d ? 'program' and d->>'program' is distinct from beforej->>'program' then raise exception '기존 신청서의 프로그램은 변경할 수 없습니다. 새 신청서를 추가해 주세요.'; end if;
  d:=jsonb_build_object('program','common','title','이용 신청서','signature_mode','none')||coalesce(beforej,'{}')||d;
  if jsonb_typeof(d->'fields')<>'array' or jsonb_array_length(d->'fields')>30 then raise exception '신청서 항목은 최대 30개입니다.'; end if;
  for fieldj in select value from jsonb_array_elements(d->'fields') loop
   if coalesce(fieldj->>'key','') !~ '^extra_[a-z0-9_]{1,40}$' or fieldj->>'type' not in ('text','textarea','select','checkbox') or fieldj->>'type' is null or coalesce(trim(fieldj->>'label'),'')='' or length(fieldj::text)>5000 then raise exception '추가항목은 extra_ 이름과 허용된 입력 유형을 사용해 주세요.'; end if;
   if fieldj->>'type'='select' and (jsonb_typeof(fieldj->'options')<>'array' or jsonb_array_length(fieldj->'options') not between 1 and 30) then raise exception '선택지 설정을 확인해 주세요.'; end if;
   if fieldj ? 'required' and jsonb_typeof(fieldj->'required')<>'boolean' then raise exception '필수 여부는 참/거짓 값이어야 합니다.'; end if;
   if fieldj->>'type'='select' and exists(select 1 from jsonb_array_elements(fieldj->'options') x where jsonb_typeof(x)<>'string' or length(x::text)>300) then raise exception '선택지는 짧은 글로 입력해 주세요.'; end if;
  end loop;
  if (select count(*)<>count(distinct f->>'key') from jsonb_array_elements(d->'fields') f) then raise exception '중복 항목 키가 있습니다.'; end if;
  perform pg_advisory_xact_lock(813011);
  if beforej is not null then update public.ms_forms set active=false where id=ident; end if;
  if coalesce((d->>'active')::boolean,true) then update public.ms_forms set active=false where active and program=d->>'program'; end if;
  select coalesce(max(version),0)+1 into n from public.ms_forms where program=d->>'program';
  ident:=gen_random_uuid(); beforej:=null; d:=(d-array['id','created_at','created_by','version'])||jsonb_build_object('version',n,'created_by',u,'active',coalesce((d->>'active')::boolean,true));
 end if;
 if entity='terms' then
  perform pg_advisory_xact_lock(813012);
  if beforej is not null and d ? 'program' and d->>'program' is distinct from beforej->>'program' then raise exception '기존 약관의 프로그램은 변경할 수 없습니다. 새 약관을 추가해 주세요.'; end if;
  rowj:=jsonb_build_object('program','common')||coalesce(beforej,'{}')||d;
  select greatest(coalesce(max(version),0),coalesce((beforej->>'version')::integer,0))+1 into n from public.ms_terms where program=rowj->>'program' and kind=rowj->>'kind' and title=rowj->>'title';
  if beforej is not null then update public.ms_terms set active=false where id=ident; end if;
  if coalesce((rowj->>'active')::boolean,false) then update public.ms_terms set active=false where program=rowj->>'program' and kind=rowj->>'kind' and title=rowj->>'title'; end if;
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
   if payload->>'kind' not in ('new','renewal') or payload->>'kind' is null then raise exception '신규 또는 재등록을 선택해 주세요.'; end if;
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

-- CREATE OR REPLACE keeps the existing owner and ACL for both established RPC signatures.
commit;
