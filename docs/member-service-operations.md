# 회원서비스 DB 적용·복구 안내

> 기본 회원서비스 설치 기록입니다. 현재 회원 화면은 계정 없는 접수 방식으로 전환했습니다. 기본 설치 후 `guest-service.sql`을 추가 적용하며, 최신 운영 절차는 [비로그인 접수 안내](guest-service-operations.md)를 따릅니다. 회원 Auth 가입·초대·인증메일·복귀주소 설정은 새 회원 화면에 필요하지 않습니다.

## 대상 확인

기존 OneSports Vercel 사이트는 `https://onesports-management.vercel.app`이고 저장소의 기존 Supabase 프로젝트 참조는 `csacwkwasjntfkzinzfg`입니다. Supabase 대시보드 표시 이름이 다른 프로그램처럼 보일 수 있으므로 표시 이름만으로 판단하지 마세요. 실제 프로젝트 참조, 기존 `public.app_admins`와 기존 운영 테이블의 구조 및 현재 원스포츠 화면 연결을 함께 확인합니다. 이 프로젝트는 현재 하나의 센터를 사용하며 기존 승인 관리자 목록을 그대로 사용합니다.

관리자·서비스 키를 프런트엔드, 문서, 로그에 복사하지 않습니다. 아래 점검은 승인된 DB 소유자 연결 또는 해당 Supabase 프로젝트 SQL Editor에서 수행합니다.

```sql
-- 읽기 전용 사전 점검
select current_database(), current_user;
select to_regclass('public.app_admins') as existing_admin_table,
       to_regprocedure('public.is_app_admin()') as existing_admin_check,
       to_regclass('auth.users') as auth_table,
       to_regclass('storage.objects') as storage_table,
       to_regclass('storage.buckets') as storage_buckets;
select extname, extnamespace::regnamespace from pg_extension where extname='pgcrypto';
select tablename from pg_tables where schemaname='public' and tablename like 'ms\_%' escape '\';
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id='member-service-files';
```

`app_admins`에는 `user_id`, `active`, `display_name`이 있어야 하고 `is_app_admin()`은 현재 인증 사용자 중 승인된 관리자만 참이어야 합니다. `auth.users.email_confirmed_at`, `auth.uid()`, Supabase `anon`·`authenticated` 역할 및 Storage 스키마가 필요합니다. `pgcrypto`는 `public` 또는 `extensions` 스키마에서 제공되어야 합니다. 마이그레이션 계정은 테이블·함수·정책 및 전용 버킷을 만들 수 있어야 합니다.

처음 적용하는데 이미 `ms_` 테이블이나 `member-service-files` 버킷이 있다면 기존 회원서비스 배포인지 확인합니다. 관계없는 서비스의 동일 이름이면 적용하지 않습니다. 기존 프로젝트의 다른 앱·테이블·정책은 이번 작업 대상이 아닙니다.

## 백업·격리 검증

1. 적용 시점과 대상 프로젝트 참조를 기록하고, 호스팅 제공자의 복원 기능 사용 가능 여부를 확인합니다. 무료 플랜 등에 복원 기능이 없으면 있다고 가정하지 않습니다.
2. 기존 DB 스키마·데이터를 승인된 보안 저장소에 백업하고, 백업 파일과 복원 절차를 확인합니다. 백업에는 개인정보가 포함되므로 이 저장소나 공개 산출물에 커밋하지 않습니다. 기존 Storage 객체는 DB 덤프만으로 복원되지 않으므로 별도 객체 백업·보존 범위를 확인합니다.
3. 운영과 분리된 로컬 PostgreSQL에서 `node tests/database.mjs` 및 `node tests/backend-security.mjs`를 순서대로 실행합니다. 두 테스트는 같은 로컬 포트를 사용하므로 동시에 실행하지 않습니다. 테스트는 운영 설정을 읽지 않으며 임시 가짜 계정·결제·사진 메타데이터만 만듭니다. Storage HTTP 업로드와 실제 Supabase Auth 메일 동작은 별도 미리보기 환경에서 확인합니다.
4. 기존 관리자/공개 화면과 새 회원 화면을 미리보기 배포에서 확인합니다. 운영에 가짜 회원·결제·민원 테스트를 만들지 않습니다.

## 적용

적용 파일은 **`supabase/member-service.sql` 하나**입니다. 기존 `setup.sql`이나 과거 업데이트 SQL에는 기존 운영 기록 삭제 구문이 있으므로 다시 실행하지 않습니다.

이 파일은 `BEGIN`/`COMMIT`으로 묶여 있습니다. 실패하면 전체 트랜잭션을 롤백하고 오류를 수정한 뒤 다시 실행합니다. `ms_` 테이블, `member_service` RPC와 전용 보조 함수, 새 Storage 버킷·정책만 추가합니다. 기존 시설점검·민원·비품 테이블과 기존 관리자 인증 함수는 수정하지 않습니다. 초기 데이터는 고정 ID와 `ON CONFLICT DO NOTHING`을 사용하므로 재적용이 운영자의 요금·문구·시간표 변경을 덮어쓰지 않습니다.

첫 적용 후 수집 기능은 닫혀 있고, 12개 기간권과 11개 GX 반은 검토 전 상태입니다. 개인정보 목적·항목·보유기간, 승인된 개인정보 동의문과 이용규정, 실제 요금·기간, GX 운영 필수값을 운영자가 확인해야 접수를 열 수 있습니다. 입금계좌를 설정하지 않으면 계좌이체 신청만 차단됩니다. 기존 이용권은 현장 확인 회원에 한해 관리자 화면의 **기존 이용권 기록**으로 원본 근거와 함께 옮깁니다. 이 기록은 결제로 가장하지 않고 `source='import'`로 남습니다.

## 적용 후 읽기 점검

```sql
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename like 'ms\_%' escape '\';
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema='public' and (routine_name='member_service' or routine_name like 'ms\_%' escape '\')
order by routine_name, grantee;
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema='public' and table_name like 'ms\_%' escape '\'
  and grantee in ('PUBLIC','anon','authenticated');
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id='member-service-files';
```

`ms_` 테이블은 모두 RLS가 켜져 있어야 하고 공개·일반 로그인 역할의 직접 테이블 권한은 없어야 합니다. `member_service`와 읽기 정책 보조 함수 `ms_file_read`만 `anon` 실행이 가능하고, `ms_file_upload`는 `authenticated`만 실행합니다. 나머지 `ms_` 보조 함수는 클라이언트가 직접 실행할 수 없어야 합니다. 인증·입금확인·금액·기간·본인 확인은 RPC 안에서 검증합니다. 버킷은 비공개, 최대 8 MiB, JPEG/PNG/WebP만 허용합니다.

운영 확인은 공개 게시물 조회와 기존 화면 동작 등 읽기 위주로 수행합니다. DB 적용 성공, 웹 배포 성공, 실사용 설정 완료는 별도 상태로 기록합니다. 현장 QR 촬영과 실제 단말기·입금 확인은 수행하지 않았다면 완료라고 기록하지 않습니다.

## 중단·복구

가장 먼저 관리자 **회원서비스 설정**에서 신청 접수와 건의 접수를 끕니다. 이 조치는 새 신청·요청을 DB에서도 차단하며 기존 기록과 본인 처리내역 조회는 유지합니다. 필요한 경우 메뉴 표시를 끄고 게시물을 게시 중단합니다.

웹 회귀 문제가 있으면 기존 Vercel 배포로 되돌립니다. 새 DB 테이블은 기존 화면에서 사용하지 않으므로 남겨 두는 편이 기록 보존에 안전합니다. 운영 기록이 생긴 뒤 새 테이블·결제·신청·Storage 객체를 즉시 삭제하거나 초기 SQL로 되돌리지 않습니다. DB 문제가 있으면 승인된 유지보수 절차로 새 기능만 중단하고, 백업·감사기록을 확인한 후 필요한 개별 복구를 검토합니다. 자동 환불·은행 반환·카드 취소 기능은 없습니다.

사진 참조를 제거하거나 게시물을 중단하면 새 파일 접근 권한은 사라집니다. 이미 발급한 서명 URL은 프런트엔드가 요청한 60초 유효기간 동안 남을 수 있습니다. 원본 객체는 검토 증빙을 바꾸지 않도록 클라이언트에서 덮어쓰기·삭제하지 않으며, 실제 파기는 운영자가 보존 의무와 보유기간을 확인한 별도 절차로 수행합니다.
