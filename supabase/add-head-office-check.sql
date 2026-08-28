-- ============================================================
-- 기존 원스포츠 Supabase에 본사점검현황 기능 추가
-- 기존 데이터는 삭제하지 않습니다.
-- Supabase > SQL Editor > New query에서 전체 실행하세요.
-- ============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.head_office_checks (
  id uuid primary key default gen_random_uuid(),
  check_date date not null default greatest(current_date, date '2026-09-01'),
  check_type text not null default 'onsite' check (check_type in ('onsite', 'written')),
  scope text not null default 'all' check (scope = 'all'),
  status text not null default 'completed' check (status = 'completed'),
  title text not null check (char_length(title) between 1 and 120),
  result text not null check (char_length(result) between 1 and 5000),
  follow_up text not null default '',
  photo_paths text[] not null default '{}'::text[],
  manager_name text not null default '',
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint head_office_checks_operational_date_check
    check (check_date >= date '2026-09-01')
);

create index if not exists head_office_checks_date_idx
  on public.head_office_checks (check_date desc);
create index if not exists head_office_checks_type_idx
  on public.head_office_checks (check_type, check_date desc);

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

drop trigger if exists head_office_checks_set_updated_fields on public.head_office_checks;
create trigger head_office_checks_set_updated_fields
before update on public.head_office_checks
for each row execute function public.set_management_updated_fields();

alter table public.head_office_checks enable row level security;

revoke all on table public.head_office_checks from anon, authenticated;
grant select on table public.head_office_checks to anon, authenticated;
grant insert, update, delete on table public.head_office_checks to authenticated;

-- 공개 열람자는 완료된 본사점검 결과를 읽을 수 있습니다.
drop policy if exists head_office_checks_public_read on public.head_office_checks;
create policy head_office_checks_public_read
on public.head_office_checks for select
to anon, authenticated
using (check_date >= date '2026-09-01');

-- 승인된 원스포츠 관리자만 입력·수정·삭제할 수 있습니다.
drop policy if exists head_office_checks_admin_insert on public.head_office_checks;
create policy head_office_checks_admin_insert
on public.head_office_checks for insert
to authenticated
with check (
  public.is_app_admin()
  and check_date >= date '2026-09-01'
  and scope = 'all'
  and status = 'completed'
);

drop policy if exists head_office_checks_admin_update on public.head_office_checks;
create policy head_office_checks_admin_update
on public.head_office_checks for update
to authenticated
using (public.is_app_admin())
with check (
  public.is_app_admin()
  and check_date >= date '2026-09-01'
  and scope = 'all'
  and status = 'completed'
);

drop policy if exists head_office_checks_admin_delete on public.head_office_checks;
create policy head_office_checks_admin_delete
on public.head_office_checks for delete
to authenticated
using (public.is_app_admin());

alter table public.head_office_checks replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'head_office_checks'
  ) then
    alter publication supabase_realtime add table public.head_office_checks;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- 실행 확인용 SQL
-- select * from public.head_office_checks order by check_date desc;
