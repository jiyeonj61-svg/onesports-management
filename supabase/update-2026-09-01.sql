-- ============================================================
-- 기존 원스포츠 Supabase 프로젝트용 업데이트
-- 적용 내용: 운영 시작일을 2026-09-01로 고정하고 이전 기록을 제거·차단
-- Supabase Dashboard > SQL Editor에서 전체 실행하세요.
-- ============================================================

begin;

-- 이전 테스트 기록 제거
-- 주의: 2026-09-01 이전 데이터가 실제로 필요하다면 먼저 백업하세요.
delete from public.inspections where inspection_date < date '2026-09-01';
delete from public.issues where received_date < date '2026-09-01';

-- 기본 날짜와 데이터베이스 제약조건
alter table public.inspections
  alter column inspection_date set default greatest(current_date, date '2026-09-01');
alter table public.issues
  alter column received_date set default greatest(current_date, date '2026-09-01');

alter table public.inspections drop constraint if exists inspections_operational_date_check;
alter table public.inspections
  add constraint inspections_operational_date_check
  check (inspection_date >= date '2026-09-01');

alter table public.issues drop constraint if exists issues_operational_date_check;
alter table public.issues
  add constraint issues_operational_date_check
  check (received_date >= date '2026-09-01');

-- 공개 및 관리자 권한정책도 운영 시작일 이후로 제한
drop policy if exists inspections_public_read on public.inspections;
create policy inspections_public_read
on public.inspections for select
to anon, authenticated
using (inspection_date >= date '2026-09-01');

drop policy if exists inspections_admin_insert on public.inspections;
create policy inspections_admin_insert
on public.inspections for insert
to authenticated
with check (public.is_app_admin() and inspection_date >= date '2026-09-01');

drop policy if exists inspections_admin_update on public.inspections;
create policy inspections_admin_update
on public.inspections for update
to authenticated
using (public.is_app_admin() and inspection_date >= date '2026-09-01')
with check (public.is_app_admin() and inspection_date >= date '2026-09-01');

drop policy if exists issues_public_read on public.issues;
create policy issues_public_read
on public.issues for select
to anon
using (is_public = true and received_date >= date '2026-09-01');

drop policy if exists issues_authenticated_read on public.issues;
create policy issues_authenticated_read
on public.issues for select
to authenticated
using (received_date >= date '2026-09-01' and (is_public = true or public.is_app_admin()));

drop policy if exists issues_admin_insert on public.issues;
create policy issues_admin_insert
on public.issues for insert
to authenticated
with check (public.is_app_admin() and received_date >= date '2026-09-01');

drop policy if exists issues_admin_update on public.issues;
create policy issues_admin_update
on public.issues for update
to authenticated
using (public.is_app_admin() and received_date >= date '2026-09-01')
with check (public.is_app_admin() and received_date >= date '2026-09-01');

commit;
