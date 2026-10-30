-- Additive preparation ONLY. Does not map existing records, grant HQ roles,
-- change Auth settings, touch calendar_tasks, or change existing bucket visibility.
-- Apply after reviewing docs/integration-operations.md and a verified backup.
begin;

do $migration$
declare tab text;
begin
  foreach tab in array array['areas','inspections','issues','inventories','head_office_checks'] loop
    if to_regclass('public.' || tab) is null then
      raise exception 'Required legacy table missing: %',tab;
    end if;
    execute format('alter table public.%I add column if not exists integration_site_id uuid',tab);
    execute format('alter table public.%I add column if not exists integration_legacy_record boolean not null default false',tab);
    execute format('create index if not exists %I on public.%I (integration_site_id,id)', 'osi_'||tab||'_site_idx',tab);
    -- Restrictive policies combine with every existing permissive policy. Legacy
    -- NULL rows retain their existing behavior; mapped/new rows are server-only.
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=tab and policyname='osi_legacy_scope_guard') then
      execute format('create policy osi_legacy_scope_guard on public.%I as restrictive for all to anon,authenticated using (integration_site_id is null) with check (integration_site_id is null)',tab);
    end if;
  end loop;
end;
$migration$;

alter table public.inspections add column if not exists integration_is_public boolean not null default false;
alter table public.head_office_checks add column if not exists integration_is_public boolean not null default false;
create unique index if not exists osi_areas_id_site_unique on public.areas(id,integration_site_id);

-- Legacy BEFORE UPDATE triggers overwrite updated_at/updated_by. A scope-only
-- operator mapping is not a new business edit; preserve those original fields.
create or replace function public.osi_preserve_mapping_metadata() returns trigger
language plpgsql set search_path=pg_catalog,public as $trigger$
begin
 if old.integration_site_id is null and new.integration_site_id is not null and new.integration_legacy_record
  and (to_jsonb(old)-'integration_site_id'-'integration_legacy_record'-'updated_at'-'updated_by'-'completed_at')=
      (to_jsonb(new)-'integration_site_id'-'integration_legacy_record'-'updated_at'-'updated_by'-'completed_at') then
  new:=jsonb_populate_record(new,jsonb_build_object('updated_at',to_jsonb(old)->'updated_at','updated_by',to_jsonb(old)->'updated_by','completed_at',to_jsonb(old)->'completed_at'));
 end if;
 return new;
end;
$trigger$;
revoke all on function public.osi_preserve_mapping_metadata() from public,anon,authenticated;
do $triggers$
declare tab text;
begin
 foreach tab in array array['areas','inspections','issues','inventories','head_office_checks'] loop
  if not exists(select 1 from pg_trigger where tgrelid=('public.'||tab)::regclass and tgname='zz_osi_preserve_mapping_metadata') then
   execute format('create trigger zz_osi_preserve_mapping_metadata before update on public.%I for each row execute function public.osi_preserve_mapping_metadata()',tab);
  end if;
 end loop;
end;
$triggers$;

do $constraints$
declare tab text;
begin
 foreach tab in array array['inspections','issues','inventories'] loop
  if not exists(select 1 from pg_constraint where conname='osi_'||tab||'_site_area_fk' and conrelid=('public.'||tab)::regclass) then
   execute format('alter table public.%I add constraint %I foreign key (area_id,integration_site_id) references public.areas(id,integration_site_id) not valid',tab,'osi_'||tab||'_site_area_fk');
  end if;
 end loop;
end;
$constraints$;

create table if not exists public.osi_operation_audit (
 id bigint generated always as identity primary key,
 site_id uuid not null, resource text not null, record_id text,
 action text not null, actor_type text not null, actor_id text,
 created_at timestamptz not null default now()
);
create table if not exists public.osi_operation_requests (
 site_id uuid not null, resource text not null, request_id uuid not null,
 payload_hash text not null, response jsonb not null,
 created_at timestamptz not null default now(),
 primary key(site_id,resource,request_id)
);
create table if not exists public.osi_legacy_mappings (
 resource text not null, record_id text not null, site_id uuid not null,
 row_sha256 text not null, evidence text not null, approved_by uuid not null,
 mapped_at timestamptz not null default now(), primary key(resource,record_id)
);
alter table public.osi_operation_audit enable row level security;
alter table public.osi_operation_requests enable row level security;
alter table public.osi_legacy_mappings enable row level security;
revoke all on public.osi_operation_audit,public.osi_operation_requests,public.osi_legacy_mappings from public,anon,authenticated;

create or replace function public.integration_operations(
 p_site_id uuid,p_resource text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $rpc$
declare
 allowed text[]; fields text[]; public_fields text[]; projection text; assignments text;
 d jsonb; original jsonb; answer jsonb; result_items jsonb; row_json jsonb;
 record_id text:=nullif(p_payload->>'id',''); date_field text; public_field text;
 today date:=(now() at time zone 'Asia/Seoul')::date;
 period_start date; period_end date;
 request_key uuid; payload_hash text; stored public.osi_operation_requests%rowtype;
 actor_type text:=coalesce(p_payload->>'actor_type','server');
 actor_id text:=nullif(p_payload->>'actor_id','');
 page_limit integer:=100; page_offset integer:=0; item_count integer; query_filter text;
begin
 if p_site_id is null then raise exception 'Site scope required' using errcode='22023'; end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 then raise exception 'Invalid request' using errcode='22023'; end if;
 if p_resource not in ('areas','inspections','issues','inventories','head_office_checks') or
    p_action not in ('list','get','public_list','summary','create','update','delete') then
  raise exception 'Unsupported operation' using errcode='22023';
 end if;
 if actor_type not in ('HQ_ADMIN','SITE_STAFF','server') or length(coalesce(actor_id,''))>128 then raise exception 'Invalid actor' using errcode='22023'; end if;
 if p_action='summary' then
  if p_resource<>'inspections' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('start','end')) then raise exception 'Summary requires inspections and only start/end filters' using errcode='22023'; end if;
  period_start:=coalesce((p_payload->>'start')::date,today); period_end:=coalesce((p_payload->>'end')::date,today);
  if period_start>period_end then raise exception 'Summary start must not exceed end' using errcode='22023'; end if;
  return jsonb_build_object(
   'ok',true,'today',today,'periodStart',period_start,'periodEnd',period_end,
   'inspectionCount',(select count(*) from public.inspections where integration_site_id=p_site_id and inspection_date between period_start and period_end),
   'completedCount',(select count(*) from public.inspections where integration_site_id=p_site_id and inspection_date between period_start and period_end and status in ('normal','completed')),
   'expectedChecks',(select count(*)*2 from public.areas where integration_site_id=p_site_id and active),
   'openIssueCount',(select count(*) from public.issues where integration_site_id=p_site_id and status<>'completed'),
   'recentHeadOfficeChecks',(select coalesce(jsonb_agg(x.item),'[]'::jsonb) from (
    select jsonb_build_object('id',id,'check_date',check_date,'check_type',check_type,'title',title,'result',result,'follow_up',follow_up,'updated_at',updated_at) item
    from public.head_office_checks where integration_site_id=p_site_id order by check_date desc,updated_at desc,id limit 5
   )x)
  );
 end if;
 case p_resource
 when 'areas' then
  fields:=array['name','sort_order','checklist','active'];
  public_fields:=array['id','name','sort_order','checklist'];
 when 'inspections' then
  fields:=array['inspection_date','period','area_id','status','checked_items','item_statuses','note','manager_name','integration_is_public'];
  date_field:='inspection_date'; public_field:='integration_is_public';
  public_fields:=array['id','inspection_date','period','area_id','status','checked_items','item_statuses','note','updated_at'];
 when 'issues' then
  fields:=array['category','area_id','title','description','status','priority','received_date','due_date','action_note','manager_name','is_public'];
  date_field:='received_date'; public_field:='is_public';
  public_fields:=array['id','category','area_id','title','description','status','priority','received_date','due_date','action_note','updated_at'];
 when 'inventories' then
  fields:=array['record_date','area_id','category','name','quantity','status','note','manager_name','is_public'];
  date_field:='record_date'; public_field:='is_public';
  public_fields:=array['id','record_date','area_id','category','name','quantity','status','note','updated_at'];
 when 'head_office_checks' then
  fields:=array['check_date','check_type','title','result','follow_up','manager_name','integration_is_public'];
  date_field:='check_date'; public_field:='integration_is_public';
  public_fields:=array['id','check_date','check_type','title','result','follow_up','updated_at'];
 end case;

 if p_action in ('list','get','public_list') then
  allowed:=array['id','start','end','search','limit','offset'];
  if exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(allowed))) then raise exception 'Unexpected query field' using errcode='22023'; end if;
  if length(coalesce(p_payload->>'search',''))>120 then raise exception 'Search too long' using errcode='22023'; end if;
  page_limit:=least(200,greatest(1,coalesce((p_payload->>'limit')::integer,100)));
  page_offset:=greatest(0,coalesce((p_payload->>'offset')::integer,0));
  if page_offset>100000 then raise exception 'Offset too large' using errcode='22023'; end if;
  if p_action='get' and record_id is null then raise exception 'Record ID required' using errcode='22023'; end if;
  if p_payload ? 'start' then perform (p_payload->>'start')::date; end if;
  if p_payload ? 'end' then perform (p_payload->>'end')::date; end if;
  -- Only whitelisted identifiers enter SQL; all client values remain parameters.
  if p_action='public_list' then
   select string_agg(format('%L,to_jsonb(t)->%L',f,f),',') into projection from unnest(public_fields) f;
   projection:='jsonb_build_object('||projection||')';
  else
   select string_agg(format('%L,to_jsonb(t)->%L',case when f='integration_is_public' then 'is_public' else f end,f),',')
    into projection from unnest(array['id','integration_site_id','integration_legacy_record','created_at','updated_at']||fields||case when p_resource='areas' then array['slug'] else array['photo_paths'] end) f;
   projection:='jsonb_build_object('||projection||')';
  end if;
  query_filter:=format('where integration_site_id=$1 and ($2::text is null or id::text=$2) %s %s and ($5::text is null or to_jsonb(t)->>''title'' ilike ''%%''||$5||''%%'' or to_jsonb(t)->>''name'' ilike ''%%''||$5||''%%'')',
   case when date_field is null then '' else format('and ($3::date is null or %I >= $3::date) and ($4::date is null or %I <= $4::date)',date_field,date_field) end,
   case when p_action<>'public_list' then '' when p_resource='areas' then 'and active=true' else format('and %I=true',public_field) end);
  execute format('select count(*) from public.%I t %s',p_resource,query_filter) into item_count
   using p_site_id,record_id,p_payload->>'start',p_payload->>'end',nullif(p_payload->>'search','');
  execute format('select coalesce(jsonb_agg(q.item),''[]''::jsonb) from (select %s item from public.%I t %s order by %s,id limit $6 offset $7) q',
   projection,p_resource,query_filter,case when date_field is null then 'sort_order' else quote_ident(date_field)||' desc' end)
   into result_items using p_site_id,record_id,p_payload->>'start',p_payload->>'end',nullif(p_payload->>'search',''),page_limit,page_offset;
  if p_action='get' then
   if jsonb_array_length(result_items)=0 then raise exception 'Record not found' using errcode='P0002'; end if;
   return jsonb_build_object('ok',true,'item',result_items->0);
  end if;
  return jsonb_build_object('ok',true,'items',result_items,'total',item_count,'limit',page_limit,'offset',page_offset);
 end if;

 -- Callers must additionally restrict capabilities by current role. Never accept
 -- actor/site scope directly from a browser: this RPC is service-role only.
 allowed:=fields||array['id','request_id','actor_type','actor_id','is_public'];
 if p_action='delete' then allowed:=array['id','actor_type','actor_id']; end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(allowed))) then raise exception 'Unexpected write field' using errcode='22023'; end if;
 if p_action in ('update','delete') then
  if record_id is null then raise exception 'Record ID required' using errcode='22023'; end if;
  execute format('select to_jsonb(t) from public.%I t where integration_site_id=$1 and id::text=$2 for update',p_resource)
   into original using p_site_id,record_id;
  if original is null then raise exception 'Record not found' using errcode='P0002'; end if;
 end if;
 if p_action='delete' then
  execute format('delete from public.%I where integration_site_id=$1 and id::text=$2',p_resource) using p_site_id,record_id;
  insert into public.osi_operation_audit(site_id,resource,record_id,action,actor_type,actor_id) values(p_site_id,p_resource,record_id,p_action,actor_type,actor_id);
  return jsonb_build_object('ok',true,'deleted',true);
 end if;

 if p_action='create' then
  if record_id is not null then raise exception 'Create does not accept an existing record ID' using errcode='22023'; end if;
  request_key:=nullif(p_payload->>'request_id','')::uuid;
  if request_key is null then raise exception 'Creation request_id required' using errcode='22023'; end if;
  payload_hash:=encode(digest(convert_to((p_payload-'actor_type'-'actor_id')::text,'UTF8'),'sha256'),'hex');
  -- Per-site/request transaction lock makes simultaneous retries deterministic.
  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text||p_resource||request_key::text,0));
  select * into stored from public.osi_operation_requests where site_id=p_site_id and resource=p_resource and request_id=request_key;
  if found then
   if stored.payload_hash<>payload_hash then raise exception 'Idempotency key reused with different content' using errcode='22023'; end if;
   return stored.response;
  end if;
  case p_resource
  when 'areas' then d:=jsonb_build_object('name','','sort_order',0,'checklist','[]'::jsonb,'active',true);
  when 'inspections' then d:=jsonb_build_object('inspection_date',today,'period','AM','status','normal','checked_items','[]'::jsonb,'item_statuses','{}'::jsonb,'note','','manager_name','','integration_is_public',false);
  when 'issues' then d:=jsonb_build_object('category','other','area_id',null,'title','','description','','status','received','priority','normal','received_date',today,'due_date',null,'action_note','','manager_name','','is_public',false);
  when 'inventories' then d:=jsonb_build_object('record_date',today,'area_id',null,'category','other','name','','quantity','','status','normal','note','','manager_name','','is_public',false);
  when 'head_office_checks' then d:=jsonb_build_object('check_date',today,'check_type','onsite','title','','result','','follow_up','','manager_name','','integration_is_public',false);
  end case;
 else d:=original;
 end if;
 d:=d||(p_payload-'id'-'request_id'-'actor_type'-'actor_id');
 if p_resource in ('inspections','head_office_checks') and p_payload ? 'is_public' then d:=d||jsonb_build_object('integration_is_public',(p_payload->>'is_public')::boolean); end if;
 if date_field is not null and ((d->>date_field)::date < date '2026-09-01' or (d->>date_field)::date>today or nullif(d->>date_field,'') is null) then raise exception 'Date outside supported operational period' using errcode='22023'; end if;
 if p_resource<>'areas' and length(coalesce(d->>'manager_name',''))>100 then raise exception 'Manager name too long' using errcode='22023'; end if;
 if p_resource in ('areas','inventories') and (length(trim(coalesce(d->>'name',''))) not between 1 and 120) then raise exception 'Name required (1-120)' using errcode='22023'; end if;
 if p_resource in ('issues','head_office_checks') and (length(trim(coalesce(d->>'title',''))) not between 1 and 120) then raise exception 'Title required (1-120)' using errcode='22023'; end if;
 if p_resource='head_office_checks' and (length(trim(coalesce(d->>'result',''))) not between 1 and 5000) then raise exception 'Check result required (1-5000)' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each_text(d) e where e.key in ('description','note','action_note','follow_up') and length(e.value)>5000) then raise exception 'Text too long' using errcode='22023'; end if;
 if p_resource='areas' and (jsonb_typeof(d->'checklist')<>'array' or jsonb_array_length(d->'checklist')>100 or exists(select 1 from jsonb_array_elements(d->'checklist') v where jsonb_typeof(v)<>'string' or length(v#>>'{}')>200)) then raise exception 'Invalid checklist' using errcode='22023'; end if;
 if p_resource='inspections' and (jsonb_typeof(d->'checked_items')<>'array' or jsonb_array_length(d->'checked_items')>100 or jsonb_typeof(d->'item_statuses')<>'object') then raise exception 'Invalid inspection checklist' using errcode='22023'; end if;
 if p_resource in ('inspections','issues','inventories') and (d->>'area_id') is not null then
  if not exists(select 1 from public.areas where id=(d->>'area_id')::bigint and integration_site_id=p_site_id and (active or p_action='update')) then raise exception 'Area does not belong to this site' using errcode='22023'; end if;
 end if;
 if p_resource='inspections' and d->>'area_id' is null then raise exception 'Area required' using errcode='22023'; end if;
 -- photos cannot be introduced through text fields or arbitrary public URLs.
 -- Existing legacy links remain unchanged until an approved file mapping exists.
 if p_action='create' then
  d:=d||jsonb_build_object('integration_site_id',p_site_id);
  if p_resource='areas' then
   d:=d||jsonb_build_object('slug',p_site_id::text||'-'||request_key::text);
   fields:=fields||array['slug','integration_site_id'];
  else
   d:=d||jsonb_build_object('id',gen_random_uuid()); fields:=fields||array['id','integration_site_id'];
  end if;
  select string_agg(format('%I',f),',') into projection from unnest(fields) f;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I.*)',p_resource,projection,projection,p_resource,p_resource) into row_json using d;
  record_id:=row_json->>'id';
 else
  select string_agg(format('%I=x.%I',f,f),',') into assignments from unnest(fields) f;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) x where t.integration_site_id=$2 and t.id::text=$3 returning to_jsonb(t.*)',p_resource,assignments,p_resource) into row_json using d,p_site_id,record_id;
 end if;
 answer:=public.integration_operations(p_site_id,p_resource,'get',jsonb_build_object('id',record_id));
 insert into public.osi_operation_audit(site_id,resource,record_id,action,actor_type,actor_id) values(p_site_id,p_resource,record_id,p_action,actor_type,actor_id);
 if p_action='create' then insert into public.osi_operation_requests(site_id,resource,request_id,payload_hash,response) values(p_site_id,p_resource,request_key,payload_hash,answer); end if;
 return answer;
end;
$rpc$;
revoke all on function public.integration_operations(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.integration_operations(uuid,text,text,jsonb) to service_role;

-- Operator-only explicit mapping. Produce hashes from a private, reviewed
-- backup/export; never copy row contents into source control or test fixtures.
create or replace function public.integration_map_legacy_records(
 p_site_id uuid,p_manifest jsonb,p_evidence text,p_approved_by uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $mapping$
declare entry jsonb; tab text; ident text; row_value jsonb; mapped_row jsonb; row_hash text; prior public.osi_legacy_mappings%rowtype; mapped integer:=0;
begin
 if p_site_id is null or p_approved_by is null or not exists(select 1 from auth.users where id=p_approved_by) or length(trim(coalesce(p_evidence,'')))<10 then raise exception 'Explicit operator identity and mapping evidence required'; end if;
 if jsonb_typeof(p_manifest)<>'array' or jsonb_array_length(p_manifest) not between 1 and 1000 then raise exception 'Manifest must contain 1-1000 reviewed records'; end if;
 -- Areas must be listed before their records. All rows lock and validate in one
 -- transaction; one error aborts the entire manifest without partial mapping.
 for entry in select value from jsonb_array_elements(p_manifest) loop
  tab:=entry->>'resource'; ident:=entry->>'id';
  if tab not in ('areas','inspections','issues','inventories','head_office_checks') or ident is null or entry->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid manifest entry'; end if;
  select * into prior from public.osi_legacy_mappings where resource=tab and record_id=ident;
  if found then
   if prior.site_id<>p_site_id or prior.row_sha256<>entry->>'sha256' then raise exception 'Record already mapped differently'; end if;
   continue;
  end if;
  execute format('select to_jsonb(t) from public.%I t where id::text=$1 for update',tab) into row_value using ident;
  if row_value is null or row_value->>'integration_site_id' is not null then raise exception 'Unmapped legacy record not found'; end if;
  row_hash:=encode(digest(convert_to((row_value-'integration_site_id'-'integration_legacy_record'-'integration_is_public')::text,'UTF8'),'sha256'),'hex');
  if row_hash<>entry->>'sha256' then raise exception 'Record changed since mapping review'; end if;
  if tab in ('inspections','issues','inventories') and row_value->>'area_id' is not null and not exists(select 1 from public.areas where id=(row_value->>'area_id')::bigint and integration_site_id=p_site_id) then raise exception 'Map the verified area first'; end if;
  execute format('update public.%I t set integration_site_id=$1,integration_legacy_record=true where id::text=$2 returning to_jsonb(t.*)',tab) into mapped_row using p_site_id,ident;
  if (row_value-'integration_site_id'-'integration_legacy_record')<>(mapped_row-'integration_site_id'-'integration_legacy_record') then raise exception 'Legacy trigger unexpectedly changed business data; mapping aborted'; end if;
  insert into public.osi_legacy_mappings(resource,record_id,site_id,row_sha256,evidence,approved_by) values(tab,ident,p_site_id,row_hash,p_evidence,p_approved_by);
  insert into public.osi_operation_audit(site_id,resource,record_id,action,actor_type,actor_id) values(p_site_id,tab,ident,'legacy_mapping','HQ_ADMIN',p_approved_by::text);
  mapped:=mapped+1;
 end loop;
 return jsonb_build_object('ok',true,'mapped',mapped);
end;
$mapping$;
revoke all on function public.integration_map_legacy_records(uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;
-- Intentionally no API grant. Run only through the explicitly approved operator
-- DB connection after compatibility, counts, backups, and public links pass.
commit;
