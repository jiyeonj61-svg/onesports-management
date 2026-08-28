-- 원스포츠 관리앱 적용 상태 확인용 SQL

select 'areas_count' as check_name, count(*)::text as result
from public.areas
where active = true;

select 'item_statuses_column' as check_name, count(*)::text as result
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inspections'
  and column_name = 'item_statuses';

select 'inventories_table' as check_name, count(*)::text as result
from information_schema.tables
where table_schema = 'public'
  and table_name = 'inventories';

select
  'admin' as check_name,
  u.email || ' / ' || a.display_name || ' / active=' || a.active::text as result
from public.app_admins a
join auth.users u on u.id = a.user_id
order by a.created_at;

select
  'realtime_' || tablename as check_name,
  'enabled' as result
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('inspections', 'issues', 'inventories')
order by tablename;
