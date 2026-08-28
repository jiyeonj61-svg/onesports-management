# 원스포츠 관리앱 깨끗하게 재배포하는 방법

## 먼저 확인할 점

이번 증상은 Supabase 데이터베이스가 아니라 웹파일의 자바스크립트 오류와 이전 서비스워커 캐시가 겹쳐 발생한 문제입니다.

따라서 `jangjiyeon-work-calendar` Supabase 프로젝트를 삭제하거나 새로 만들 필요가 없습니다.
기존 `calendar_tasks`, `app_admins`, `areas`, `inspections`, `issues` 데이터도 그대로 유지합니다.

---

## 1. Supabase 업데이트 SQL 실행

이미 원스포츠 초기 SQL을 실행했다면 아래 파일만 실행합니다.

```text
supabase/update-2026-09-01.sql
```

Supabase에서:

```text
jangjiyeon-work-calendar
→ SQL Editor
→ New query
→ update-2026-09-01.sql 전체 복사
→ Run
```

정상이라면 `Success. No rows returned`가 표시됩니다.

### 확인

```sql
select name, sort_order
from public.areas
where active = true
order by sort_order;
```

13개 공간이 표시되어야 합니다.

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inspections'
  and column_name = 'item_statuses';
```

`item_statuses` 한 줄이 표시되어야 합니다.

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'inventories';
```

`inventories`가 표시되어야 합니다.

---

## 2. 새 GitHub 저장소 만들기

기존 저장소의 오래된 파일과 폴더 중첩을 피하기 위해 새 저장소 사용을 권장합니다.

GitHub에서:

```text
New repository
Repository name: onesports-management-clean
Public 또는 Private 선택
Create repository
```

압축파일을 푼 뒤 `onesports-clean-reset` 폴더 안의 내용 전체를 업로드합니다.

저장소 첫 화면에 다음 파일이 직접 보여야 합니다.

```text
index.html
admin.html
diagnostics.html
vercel.json
assets
api
icons
supabase
```

바깥에 `onesports-clean-reset` 폴더가 한 번 더 생기면 안 됩니다.

---

## 3. 새 Vercel 프로젝트 만들기

Vercel에서:

```text
Add New
→ Project
→ 방금 만든 onesports-management-clean 저장소 Import
```

설정:

```text
Framework Preset: Other
Root Directory: ./
Build Command: 비움
Output Directory: 비움
```

아직 Deploy를 누르기 전에 환경변수를 입력합니다.

---

## 4. 기존 Supabase 연결값 입력

Supabase의 `jangjiyeon-work-calendar` 프로젝트에서 Project URL과 Publishable Key를 확인합니다.

Vercel 환경변수:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

둘 다 Production, Preview, Development에 적용합니다.

주의:

```text
service_role
secret key
데이터베이스 비밀번호
```

는 입력하지 않습니다.

환경변수를 저장한 뒤 Deploy합니다.

---

## 5. 배포 진단

배포 완료 후 아래 주소를 엽니다.

```text
https://새주소.vercel.app/diagnostics.html
```

다음 항목이 모두 정상이어야 합니다.

- 공개 화면 스크립트
- 관리자 스크립트
- 공통 모듈
- 데이터 모듈
- 스타일 파일
- Vercel 환경변수
- Supabase areas 조회

환경변수가 비어 있다고 나오면 Vercel에서 값을 입력한 후 반드시 Redeploy합니다.

---

## 6. 접속 주소

열람 화면:

```text
https://새주소.vercel.app/
```

관리자 화면:

```text
https://새주소.vercel.app/admin
```

관리자 로그인은 Supabase `Authentication → Users`에 만든 이메일과 비밀번호를 사용합니다.
해당 계정은 `app_admins`에 `active = true`로 등록되어 있어야 합니다.

확인 SQL:

```sql
select
  u.email,
  a.display_name,
  a.active
from public.app_admins a
join auth.users u on u.id = a.user_id;
```

---

## 7. 기존 주소를 계속 사용할 때

기존 주소에는 오래된 서비스워커와 캐시가 남아 있을 수 있습니다.

PC 크롬:

```text
기존 사이트 접속
→ 주소창 왼쪽 사이트 설정
→ 데이터 삭제
→ 창 닫기
→ Ctrl + Shift + R
```

또는:

```text
F12
→ Application
→ Service Workers
→ Unregister
→ Storage
→ Clear site data
```

삼성 갤럭시:

```text
기존 홈 화면 아이콘 삭제
→ 크롬 설정
→ 사이트 설정
→ 저장된 데이터
→ 기존 원스포츠 주소 삭제
→ 새 주소 재접속
→ 홈 화면에 추가
```

새 Vercel 주소에서는 기존 캐시 영향을 받지 않습니다.

---

## 최종 확인표

- 상단 상태가 `실시간 연결됨`으로 변경되는지
- 메뉴 버튼이 정상적으로 눌리는지
- 관리공간이 13개인지
- 점검 항목별 상태 선택이 나오는지
- 새 점검 입력 시 담당자란이 공란인지
- 시설비품현황에서 등록·수정이 가능한지
- 공개 화면에서는 입력·수정 버튼이 없는지
