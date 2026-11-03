-- Source fragment for build-resident-migration.mjs; apply generated migration.
create or replace function public.osi_staff_resident_service(p_site_id uuid,p_actor_id text,p_service text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
 actor uuid; payload jsonb:=p_payload; allowed text[]; entity text; ident uuid; op text;
 result jsonb; rowj jsonb; profilej jsonb; items jsonb; source_sql text; filter_sql text;
 take integer; skip integer; total bigint; stamp timestamptz; expected timestamptz;
 startd date; endd date; previous_end date; a public.ms_applications%rowtype;
 paths text[]; pathv text; kind text; mime text; raw bytea; hashv text; bytes integer; upload_id uuid;
 mutation boolean:=false; replay boolean:=false;
begin
 if p_site_id is null or not exists(select 1 from public.osi_resident_centers where singleton and site_id=p_site_id and enabled) then raise exception '이 단지에 연결된 입주민 업무가 없습니다.' using errcode='42501';end if;
 if p_actor_id is null or p_actor_id!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception '직원 접속을 확인해 주세요.' using errcode='42501';end if;
 actor:=p_actor_id::uuid;
 if p_service is null or p_service not in ('member','guest') or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>800000 then raise exception '입력 형식 또는 크기를 확인해 주세요.' using errcode='22023';end if;
 if length(coalesce(payload->>'actor_name',''))>100 then raise exception '작성자 이름은 100자 이내로 입력해 주세요.' using errcode='22023';end if;
 perform set_config('osi.resident.actor',actor::text,true);perform set_config('osi.resident.site',p_site_id::text,true);
 allowed:=case p_action
 when 'status' then array[]::text[]
 when 'admin_list' then array['entity','search','status','category_id','location','date_from','date_to','limit','offset','member_id','id']
 when 'admin_detail' then array['entity','id']
 when 'photo' then case when p_service='guest' then array['photo_id'] else array['entity','id','kind','index'] end
 when 'admin_upload_photo' then array['entity','id','mime','base64','purpose']
 when 'admin_create_member' then array['id','expected_updated_at']
 when 'admin_match' then array['id','member_id','expected_updated_at','identity_confirmed']
 when 'admin_convert' then array['id','expected_updated_at']
 when 'admin_update_request' then array['id','status','reply','internal_note','assignee','action_photo_ids','expected_updated_at']
 when 'admin_action' then case when p_service='guest' then array['id','operation','note','expected_updated_at'] else array['entity','id','operation','expected_updated_at','identity_confirmed','actual_amount','paid_at','payment_note','note','expected_start_date','expected_end_date','status','reply','internal_note','assignee','action_photos'] end
 when 'admin_save' then array['entity','data'] end;
 if allowed is null or (p_service='member' and p_action not in ('status','admin_list','admin_detail','admin_action','admin_save','photo','admin_upload_photo')) or (p_service='guest' and p_action not in ('admin_list','admin_detail','admin_create_member','admin_match','admin_convert','admin_action','admin_update_request','admin_upload_photo','photo')) or exists(select 1 from jsonb_object_keys(payload) k where k<>all(allowed||array['actor_name'])) then raise exception '허용되지 않은 입주민 업무 요청입니다.' using errcode='22023';end if;
 entity:=payload->>'entity';ident:=nullif(payload->>'id','')::uuid;op:=payload->>'operation';
 if p_service='member' and p_action='admin_action' and not ((entity='applications' and op in ('approve','hold','cancel','assign_seat','external_done')) or (entity='requests' and op='update') or (entity='profiles' and op='verify')) then raise exception '허용되지 않은 업무 처리입니다.' using errcode='42501';end if;
 if p_action='admin_save' and entity is distinct from 'posts' then raise exception '가격·계좌·약관 및 운영 설정은 본사에서 관리합니다.' using errcode='42501';end if;

 if p_action='status' then
  select data into rowj from public.ms_settings where id=true;
  select jsonb_agg(jsonb_build_object('program',p.program,'ready',
   coalesce(trim(rowj->>'privacy_purpose'),'')<>'' and coalesce(trim(rowj->>'privacy_items'),'')<>'' and coalesce(trim(rowj->>'privacy_retention'),'')<>''
   and (public.ms_form_for(p.program)).id is not null and exists(select 1 from public.ms_terms_for(p.program) term where term.kind='privacy')
   and exists(select 1 from public.ms_terms term where term.active and term.approved and term.kind='rules' and term.program=(public.ms_form_for(p.program)).program)
   and case when p.program='fitness_golf' then exists(select 1 from public.ms_products product where product.active and product.reviewed and product.effective_from<=public.ms_kst_today()) else exists(select 1 from public.ms_gx_classes gx where gx.reviewed and gx.status='open' and now() between gx.registration_start and gx.registration_end) end)) into items from unnest(array['fitness_golf','gx']) p(program);
  result:=jsonb_build_object('ok',true,'status',jsonb_build_object('center_name',rowj->>'center_name','applications_enabled',coalesce((rowj->>'applications_enabled')::boolean,false),'requests_enabled',coalesce((rowj->>'requests_enabled')::boolean,false),'programs',items,
   'message',case when coalesce((rowj->>'applications_enabled')::boolean,false) or coalesce((rowj->>'requests_enabled')::boolean,false) then '접수 항목별 운영 설정과 신청서 준비 상태를 확인해 주세요.' else '현재 온라인 신청·건의 접수는 중지되어 있습니다. 기존 접수 조회·처리는 가능합니다.' end));
 elsif p_action='admin_list' then
  take:=coalesce((payload->>'limit')::integer,50);skip:=coalesce((payload->>'offset')::integer,0);
  if take not between 1 and 100 or skip not between 0 and 100000 or length(coalesce(payload->>'search',''))>120 or length(coalesce(payload->>'location',''))>300 then raise exception '조회 조건을 확인해 주세요.' using errcode='22023';end if;
  if p_service='guest' then
   if entity is null or entity not in ('applications','requests') then raise exception '조회 종류를 확인해 주세요.' using errcode='22023';end if;
   source_sql:='select (to_jsonb(t)-array[''secret_hash'',''phone_hash''])||jsonb_build_object(''linked_application'',(select to_jsonb(a) from public.ms_applications a where a.id=t.linked_application_id)) as data from public.ms_guest_submissions t where t.status<>''draft'' and t.kind='||quote_literal(case entity when 'applications' then 'application' else 'request' end);
  else
   if entity is null or entity not in ('applications','requests','profiles','passes','products','gx_classes','categories','admins','audit','posts') then raise exception '조회 종류를 확인해 주세요.' using errcode='22023';end if;
   if entity in ('passes','audit') and coalesce(payload->>'member_id',payload->>'id','')='' then raise exception '대상 회원 또는 기록을 지정해 주세요.' using errcode='22023';end if;
   if entity in ('applications','requests') then source_sql:=format('select to_jsonb(t)||jsonb_build_object(''member'',to_jsonb(m)) as data from public.%I t join public.ms_profiles m on m.id=t.member_id','ms_'||entity);
   elsif entity='admins' then source_sql:='select jsonb_build_object(''id'',user_id,''display_name'',display_name) data from public.app_admins where active';
   else source_sql:=format('select to_jsonb(t) as data from public.%I t','ms_'||entity);end if;
  end if;
  filter_sql:=' from ('||source_sql||') x where ($1->>''search'' is null or data::text ilike ''%''||($1->>''search'')||''%'')
   and (nullif($1->>''status'','''') is null or $1->>''status'' in(data->>''status'',data->>''application_status'',data->>''payment_status'',data->>''pass_status'',data->>''external_status'',data->>''reservation_status''))
   and (nullif($1->>''category_id'','''') is null or coalesce(data->>''category_id'',data->''request_payload''->>''category_id'')=$1->>''category_id'')
   and (nullif($1->>''location'','''') is null or coalesce(data->>''location'',data->''request_payload''->>''location'') ilike ''%''||($1->>''location'')||''%'')
   and (nullif($1->>''date_from'','''') is null or ((data->>''created_at'')::timestamptz at time zone ''Asia/Seoul'')::date>=($1->>''date_from'')::date)
   and (nullif($1->>''date_to'','''') is null or ((data->>''created_at'')::timestamptz at time zone ''Asia/Seoul'')::date<=($1->>''date_to'')::date)
   and (nullif($1->>''member_id'','''') is null or data->>''member_id''=$1->>''member_id'')
   and (nullif($1->>''id'','''') is null or data->>''id''=$1->>''id'' or data->>''entity_id''=$1->>''id'')';
  execute 'select count(*)'||filter_sql into total using payload;
  execute 'select coalesce(jsonb_agg(data),''[]'') from (select data'||filter_sql||' order by data->>''created_at'' desc nulls last,data->>''id'' limit $2 offset $3) page' into items using payload,take,skip;
  result:=jsonb_build_object('ok',true,'items',items,'total',total,'limit',take,'offset',skip);
 elsif p_service='member' and p_action='admin_detail' then
  if entity is null or entity not in ('applications','requests','profiles','posts') or ident is null then raise exception '기록 종류와 번호를 확인해 주세요.' using errcode='22023';end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1','ms_'||entity) into rowj using ident;
  if rowj is null then raise exception '기록을 찾을 수 없습니다.' using errcode='P0002';end if;
  if entity in ('applications','requests') then
   select to_jsonb(m) into profilej from public.ms_profiles m where id=(rowj->>'member_id')::uuid;
   rowj:=rowj||jsonb_build_object('member',profilej,'passes',(select coalesce(jsonb_agg(to_jsonb(p) order by end_date desc),'[]') from public.ms_passes p where member_id=(rowj->>'member_id')::uuid));
  end if;
  if entity='applications' then
   select * into a from public.ms_applications where id=ident;
   if a.gx_class_id is null then
    select max(end_date) into previous_end from public.ms_passes where member_id=a.member_id and facility=a.product_snapshot->>'facility' and status='active' and application_id is distinct from a.id;
    startd:=greatest(public.ms_kst_today(),coalesce(a.desired_start_date,public.ms_kst_today()),coalesce(previous_end+1,public.ms_kst_today()));endd:=startd+(a.product_snapshot->>'duration_days')::integer-1;
   else startd:=(a.product_snapshot->>'period_start')::date;endd:=(a.product_snapshot->>'period_end')::date;end if;
   rowj:=rowj||jsonb_build_object('expected_period',jsonb_build_object('start',coalesce(a.final_start_date,startd),'end',coalesce(a.final_end_date,endd)),
    'guest_submission',(select to_jsonb(g)-array['secret_hash','phone_hash'] from public.ms_guest_submissions g where id=a.guest_submission_id));
  elsif entity='requests' then rowj:=rowj||jsonb_build_object('internal_notes',(select coalesce(jsonb_agg(to_jsonb(n) order by created_at),'[]') from public.ms_request_notes n where request_id=ident));end if;
  rowj:=rowj||jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(h) order by created_at),'[]') from public.ms_audit h where entity_id=ident),'staff_history',(select coalesce(jsonb_agg(jsonb_build_object('action',action,'actor_name',actor_name,'created_at',created_at,'details',details) order by created_at),'[]') from public.osi_resident_audit where site_id=p_site_id and record_id=ident));
  result:=jsonb_build_object('ok',true,'item',rowj);
 elsif p_service='member' and p_action='photo' then
  if entity is null or entity not in ('applications','requests','posts') or ident is null then raise exception '사진 기록을 확인해 주세요.' using errcode='22023';end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1','ms_'||entity) into rowj using ident;
  if rowj is null then raise exception '기록을 찾을 수 없습니다.' using errcode='P0002';end if;
  kind:=payload->>'kind';skip:=coalesce((payload->>'index')::integer,0);
  if skip<0 or skip>99 or not ((entity='applications' and kind='signature' and skip=0) or (entity='requests' and kind in ('photo','action')) or (entity='posts' and kind in ('photo','before','after'))) then raise exception '사진 종류를 확인해 주세요.' using errcode='22023';end if;
  pathv:=case kind when 'signature' then rowj->>'signature_path' else rowj->(case kind when 'photo' then 'photos' when 'action' then 'action_photos' when 'before' then 'before_photos' else 'after_photos' end)->>skip end;
  if pathv is null or pathv!~'^(requests|applications|posts)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' or not exists(select 1 from storage.objects where bucket_id='member-service-files' and name=pathv) then raise exception '사진을 찾을 수 없습니다.' using errcode='P0002';end if;
  result:=jsonb_build_object('ok',true,'photo',jsonb_build_object('bucket','member-service-files','path',pathv));
 elsif p_service='member' and p_action='admin_upload_photo' then
  entity:=coalesce(entity,'requests');
  if entity not in ('requests','posts') or ident is null or payload->>'purpose' is distinct from (case when entity='requests' then 'action' else 'photo' end) then raise exception '사진 용도를 확인해 주세요.' using errcode='22023';end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1','ms_'||entity) into rowj using ident;
  if rowj is null then raise exception '기록을 먼저 저장해 주세요.' using errcode='P0002';end if;
  mime:=payload->>'mime';raw:=decode(payload->>'base64','base64');bytes:=octet_length(raw);
  if bytes is null or bytes not between 12 and 524288 or not ((mime='image/jpeg' and substring(raw from 1 for 3)=decode('ffd8ff','hex')) or (mime='image/png' and substring(raw from 1 for 8)=decode('89504e470d0a1a0a','hex')) or (mime='image/webp' and substring(raw from 1 for 4)=decode('52494646','hex') and substring(raw from 9 for 4)=decode('57454250','hex'))) then raise exception '512KB 이하 JPG·PNG·WebP 사진을 선택해 주세요.' using errcode='22023';end if;
  hashv:=encode(digest(raw,'sha256'),'hex');upload_id:=gen_random_uuid();pathv:=entity||'/'||ident||'/'||upload_id||case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
  insert into public.osi_resident_uploads(id,site_id,actor_id,entity,record_id,path,mime,bytes,content_hash) values(upload_id,p_site_id,actor,entity,ident,pathv,mime,bytes,hashv)
  on conflict on constraint osi_resident_upload_identity do update set content_hash=excluded.content_hash returning path into pathv;
  result:=jsonb_build_object('ok',true,'upload',true,'photo',jsonb_build_object('bucket','member-service-files','path',pathv,'mime',mime,'bytes',bytes));mutation:=true;
 else
  mutation:=p_action not in ('admin_detail','photo');
  if p_service='guest' and p_action='photo' then
   if not exists(select 1 from public.ms_guest_photos p join public.ms_guest_submissions g on g.id=p.submission_id where p.id=(payload->>'photo_id')::uuid and g.status<>'draft') then raise exception '사진을 찾을 수 없습니다.' using errcode='P0002';end if;
  elsif p_service='guest' then
   select to_jsonb(g)-array['secret_hash','phone_hash'] into rowj from public.ms_guest_submissions g where id=ident for update;
   if rowj is null or rowj->>'status'='draft' then raise exception '최종 접수된 기록을 찾을 수 없습니다.' using errcode='P0002';end if;
   replay:=(p_action='admin_create_member' and nullif(rowj->>'created_profile_id','') is not null) or (p_action='admin_convert' and nullif(rowj->>'linked_application_id','') is not null);
   if p_action='admin_match' and (payload->>'identity_confirmed') is distinct from 'true' then raise exception '현장에서 회원 본인을 확인한 뒤 연결해 주세요.' using errcode='22023';end if;
  elsif p_action='admin_save' then
   if jsonb_typeof(payload->'data') is distinct from 'object' then raise exception '게시글 내용을 확인해 주세요.' using errcode='22023';end if;
   ident:=nullif(payload->'data'->>'id','')::uuid;
   if ident is not null then select to_jsonb(t) into rowj from public.ms_posts t where id=ident for update;end if;
   if ident is not null and rowj is null then raise exception '게시글을 찾을 수 없습니다.' using errcode='P0002';end if;
   select coalesce(array_agg(v),'{}') into paths from jsonb_array_elements_text(coalesce(payload->'data'->'photos',rowj->'photos','[]')||coalesce(payload->'data'->'before_photos',rowj->'before_photos','[]')||coalesce(payload->'data'->'after_photos',rowj->'after_photos','[]')) e(v);
   if exists(select 1 from unnest(paths) p where not (coalesce(rowj->'photos','[]')||coalesce(rowj->'before_photos','[]')||coalesce(rowj->'after_photos','[]') ? p) and not osi_resident_private.photo_attached_to(p,'posts',ident)) then raise exception '이 게시글에 첨부한 사진만 사용해 주세요.' using errcode='22023';end if;
  else
   if entity='applications' then
    select * into a from public.ms_applications where id=ident;
    if a.id is null then raise exception '신청을 찾을 수 없습니다.' using errcode='P0002';end if;
    perform 1 from public.ms_profiles where id=a.member_id for update;
    if a.gx_class_id is not null then perform 1 from public.ms_gx_classes where id=a.gx_class_id for update;end if;
   end if;
   execute format('select to_jsonb(t) from public.%I t where id=$1 for update','ms_'||entity) into rowj using ident;
   if rowj is null then raise exception '기록을 찾을 수 없습니다.' using errcode='P0002';end if;
   replay:=entity='applications' and op='approve' and rowj->>'payment_status'='confirmed' and rowj->>'pass_status'='applied';
   if entity='profiles' and (payload->>'identity_confirmed') is distinct from 'true' then raise exception '현장에서 입주민 정보를 확인해 주세요.' using errcode='22023';end if;
   if entity='applications' and op='approve' and not replay and (nullif(payload->>'expected_start_date','') is null or nullif(payload->>'expected_end_date','') is null or nullif(payload->>'paid_at','') is null) then raise exception '최종 이용기간과 실제 결제일시를 확인해 주세요.' using errcode='22023';end if;
  end if;
  if mutation and p_action<>'admin_upload_photo' and rowj is not null and not replay then
   expected:=nullif(case when p_action='admin_save' then payload->'data'->>'expected_updated_at' else payload->>'expected_updated_at' end,'')::timestamptz;
   stamp:=(rowj->>'updated_at')::timestamptz;
   if expected is null or expected is distinct from stamp then raise exception '다른 직원이 변경했습니다. 최신 내용을 다시 확인해 주세요.' using errcode='40001';end if;
  end if;
  if length(coalesce(payload->>'reply',''))>10000 or length(coalesce(payload->>'internal_note',''))>5000 or length(coalesce(payload->>'note',''))>2000 then raise exception '답변 또는 메모 길이를 확인해 주세요.' using errcode='22023';end if;
  if p_service='member' then result:=osi_resident_private.member_core(p_action,payload-'actor_name'-'identity_confirmed');
  else result:=osi_resident_private.guest_core(p_action,payload-'actor_name'-'identity_confirmed');end if;
  if result->>'ok' is distinct from 'true' then raise exception '%',coalesce(result->>'error','처리 결과를 확인해 주세요.') using errcode='P0001';end if;
 end if;
 if ident is null then ident:=nullif(result->'item'->>'id','')::uuid;end if;
 insert into public.osi_resident_audit(site_id,actor_id,actor_name,service,action,entity,record_id,details)
 values(p_site_id,actor,nullif(trim(payload->>'actor_name'),''),p_service,p_action,entity,ident,
 jsonb_strip_nulls(jsonb_build_object('operation',op,'mutation',mutation,'duplicate',result->'duplicate','status',result->'item'->'status','application_status',result->'item'->'application_status','payment_status',result->'item'->'payment_status','matched_member_id',result->'item'->'matched_member_id','linked_application_id',result->'item'->'linked_application_id','actual_amount',case when op='approve' then payload->'actual_amount' end)));
 return osi_resident_private.redact(result);
end $$;
revoke all on function public.osi_staff_resident_service(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.osi_staff_resident_service(uuid,text,text,text,jsonb) to service_role;
