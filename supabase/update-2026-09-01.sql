-- ============================================================
-- 기존 원스포츠 Supabase 프로젝트용 업데이트
-- 적용 내용:
-- 1) 점검 항목별 상태(item_statuses) 추가
-- 2) 스크린골프장 1·2·3, 기구필라테스룸 공간 추가
-- 3) 시설비품현황(inventories) 기능 추가
-- 4) 운영 시작일 2026-09-01 유지
-- Supabase Dashboard > SQL Editor에서 전체 실행하세요.
-- ============================================================

begin;

create extension if not exists pgcrypto;

alter table public.inspections add column if not exists item_statuses jsonb not null default '{}'::jsonb;
alter table public.inspections alter column manager_name set default '';
alter table public.issues alter column manager_name set default '';

create table if not exists public.inventories (
  id uuid primary key default gen_random_uuid(),
  record_date date not null default current_date,
  area_id bigint references public.areas(id) on delete set null,
  category text not null default 'other' check (category in ('facility', 'equipment', 'supply', 'other')),
  name text not null check (char_length(name) between 1 and 120),
  quantity text not null default '',
  status text not null default 'normal' check (status in ('normal', 'low', 'restocking', 'repair')),
  note text not null default '',
  photo_paths text[] not null default '{}'::text[],
  is_public boolean not null default true,
  manager_name text not null default '',
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

delete from public.inspections where inspection_date < date '2026-09-01';
delete from public.issues where received_date < date '2026-09-01';
delete from public.inventories where record_date < date '2026-09-01';

alter table public.inspections alter column inspection_date set default greatest(current_date, date '2026-09-01');
alter table public.issues alter column received_date set default greatest(current_date, date '2026-09-01');
alter table public.inventories alter column record_date set default greatest(current_date, date '2026-09-01');

alter table public.inspections drop constraint if exists inspections_operational_date_check;
alter table public.inspections add constraint inspections_operational_date_check check (inspection_date >= date '2026-09-01');
alter table public.issues drop constraint if exists issues_operational_date_check;
alter table public.issues add constraint issues_operational_date_check check (received_date >= date '2026-09-01');
alter table public.inventories drop constraint if exists inventories_operational_date_check;
alter table public.inventories add constraint inventories_operational_date_check check (record_date >= date '2026-09-01');

create index if not exists inventories_record_date_idx on public.inventories (record_date desc);
create index if not exists inventories_category_status_idx on public.inventories (category, status);

create or replace function public.set_management_updated_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  if tg_table_name = 'issues' then
    if new.status = 'completed' and (old.status is distinct from 'completed' or old.completed_at is null) then
      new.completed_at = now();
    elsif new.status <> 'completed' then
      new.completed_at = null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventories_set_updated_fields on public.inventories;
create trigger inventories_set_updated_fields
before update on public.inventories
for each row execute function public.set_management_updated_fields();

insert into public.areas (slug, name, sort_order, checklist, active)
values
  ('lobby', '로비', 1, '["바닥·출입구 청결", "안내물·비품 정리", "조명 상태", "특이사항 확인"]'::jsonb, true),
  ('fitness', '헬스장', 2, '["운동기구 작동 상태", "바닥·기구 청결", "안전 상태", "환기·온도", "원판·소도구 정리"]'::jsonb, true),
  ('golf', '골프연습장', 3, '["타석·스크린 작동", "안전망·매트 상태", "바닥 청결", "골프용품 정리", "조명·환기"]'::jsonb, true),
  ('screen-golf-1', '스크린골프장 1번', 4, '["기기 전원·작동", "타석·센서 상태", "매트·타석 청결", "골프채·비품 정리", "조명·환기"]'::jsonb, true),
  ('screen-golf-2', '스크린골프장 2번', 5, '["기기 전원·작동", "타석·센서 상태", "매트·타석 청결", "골프채·비품 정리", "조명·환기"]'::jsonb, true),
  ('screen-golf-3', '스크린골프장 3번', 6, '["기기 전원·작동", "타석·센서 상태", "매트·타석 청결", "골프채·비품 정리", "조명·환기"]'::jsonb, true),
  ('gx', 'GX룸', 7, '["바닥·거울 청결", "음향기기 작동", "운동용품 정리", "조명·환기", "안전 상태"]'::jsonb, true),
  ('pilates', '기구필라테스룸', 8, '["리포머·기구 상태", "바닥·거울 청결", "소도구 정리", "조명·환기", "안전 상태"]'::jsonb, true),
  ('table-tennis', '탁구장', 9, '["탁구대·네트 상태", "라켓·공 비품", "바닥 청결", "조명 상태", "주변 정리"]'::jsonb, true),
  ('mens-locker', '남자 탈의실', 10, '["락커·바닥 청결", "샤워시설·배수", "드라이기·비품", "악취·환기", "안전 상태"]'::jsonb, true),
  ('womens-locker', '여자 탈의실', 11, '["락커·바닥 청결", "샤워시설·배수", "드라이기·비품", "악취·환기", "안전 상태"]'::jsonb, true),
  ('restroom', '화장실', 12, '["변기·세면대 청결", "휴지·비누 보충", "배수 상태", "악취·환기", "조명 상태"]'::jsonb, true),
  ('reading-room', '독서실', 13, '["책상·의자 정리", "바닥 청결", "조명 상태", "냉난방·환기", "소음·이용환경"]'::jsonb, true)
on conflict (slug) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  checklist = excluded.checklist,
  active = excluded.active;

alter table public.inventories enable row level security;
revoke all on table public.inventories from anon, authenticated;
grant select on table public.inventories to anon, authenticated;
grant insert, update, delete on table public.inventories to authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = auth.uid() and a.active = true
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated;

drop policy if exists inspections_public_read on public.inspections;
create policy inspections_public_read on public.inspections for select to anon, authenticated using (inspection_date >= date '2026-09-01');

drop policy if exists inspections_admin_insert on public.inspections;
create policy inspections_admin_insert on public.inspections for insert to authenticated with check (public.is_app_admin() and inspection_date >= date '2026-09-01');

drop policy if exists inspections_admin_update on public.inspections;
create policy inspections_admin_update on public.inspections for update to authenticated using (public.is_app_admin() and inspection_date >= date '2026-09-01') with check (public.is_app_admin() and inspection_date >= date '2026-09-01');

drop policy if exists issues_public_read on public.issues;
create policy issues_public_read on public.issues for select to anon using (is_public = true and received_date >= date '2026-09-01');

drop policy if exists issues_authenticated_read on public.issues;
create policy issues_authenticated_read on public.issues for select to authenticated using (received_date >= date '2026-09-01' and (is_public = true or public.is_app_admin()));

drop policy if exists issues_admin_insert on public.issues;
create policy issues_admin_insert on public.issues for insert to authenticated with check (public.is_app_admin() and received_date >= date '2026-09-01');

drop policy if exists issues_admin_update on public.issues;
create policy issues_admin_update on public.issues for update to authenticated using (public.is_app_admin() and received_date >= date '2026-09-01') with check (public.is_app_admin() and received_date >= date '2026-09-01');

drop policy if exists inventories_public_read on public.inventories;
create policy inventories_public_read on public.inventories for select to anon using (is_public = true and record_date >= date '2026-09-01');

drop policy if exists inventories_authenticated_read on public.inventories;
create policy inventories_authenticated_read on public.inventories for select to authenticated using (record_date >= date '2026-09-01' and (is_public = true or public.is_app_admin()));

drop policy if exists inventories_admin_insert on public.inventories;
create policy inventories_admin_insert on public.inventories for insert to authenticated with check (public.is_app_admin() and record_date >= date '2026-09-01');

drop policy if exists inventories_admin_update on public.inventories;
create policy inventories_admin_update on public.inventories for update to authenticated using (public.is_app_admin() and record_date >= date '2026-09-01') with check (public.is_app_admin() and record_date >= date '2026-09-01');

drop policy if exists inventories_admin_delete on public.inventories;
create policy inventories_admin_delete on public.inventories for delete to authenticated using (public.is_app_admin());

alter table public.inventories replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventories'
  ) then
    alter publication supabase_realtime add table public.inventories;
  end if;
end $$;

commit;
