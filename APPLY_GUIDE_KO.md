# 원스포츠 휘트니스센터 관리앱 적용 안내서

적용 대상: **힐스테이트 상도 센트럴파크 1단지 휘트니스센터**  
운영 기록 시작일: **2026년 9월 1일**

이 앱은 다음 두 주소로 나뉩니다.

- 공개 열람 화면: `https://배포주소/`
  - 입주자대표회의·관리사무소 등은 보기만 가능
  - 공개로 설정된 오전·오후 점검, 조치업무, 민원 처리현황 확인
- 원스포츠 관리자 화면: `https://배포주소/admin`
  - 승인된 관리자만 로그인
  - 입력·수정·삭제·사진 등록 가능

---

## 먼저 확인할 사항

이번 버전은 운영 시작일을 **2026-09-01**로 고정했습니다.

- 2026년 8월 31일 이전 날짜는 화면에서 선택할 수 없습니다.
- 캘린더와 월간보고도 2026년 9월부터 시작합니다.
- 관리자도 9월 1일 이전 기록을 입력할 수 없습니다.
- 데이터베이스에서도 9월 1일 이전 날짜의 저장과 조회를 차단합니다.
- 제공받은 원스포츠 로고를 공개 화면, 관리자 화면, 휴대폰 홈 화면 아이콘에 적용했습니다.

> 주의: `setup.sql` 또는 `update-2026-09-01.sql`을 실행하면 2026년 9월 1일 이전에 입력한 테스트 기록이 삭제됩니다. 보관할 기록이 있다면 SQL 실행 전에 먼저 백업하세요.

---

# A. 처음부터 새로 적용하는 방법

## 1단계. 압축파일 풀기

1. `onesports-management-app-20260901.zip`을 다운로드합니다.
2. 압축을 풉니다.
3. 압축을 푼 폴더 안에 아래 파일들이 보이는지 확인합니다.

```text
index.html
admin.html
assets/
api/
supabase/
vercel.json
manifest.webmanifest
```

GitHub에 올릴 때는 위 파일들이 저장소의 첫 화면, 즉 저장소 루트에 있어야 합니다. `onesports-management-app/onesports-management-app/index.html`처럼 폴더가 한 번 더 중첩되지 않게 주의합니다.

---

## 2단계. Supabase 프로젝트 만들기

1. Supabase에 로그인합니다.
2. 새 프로젝트를 만듭니다.
3. 프로젝트 이름은 예를 들어 `onesports-management`로 입력합니다.
4. 데이터베이스 비밀번호는 별도로 안전하게 보관합니다.
5. 프로젝트 생성이 끝날 때까지 기다립니다.

---

## 3단계. 데이터베이스와 권한 설정

1. Supabase 왼쪽 메뉴에서 **SQL Editor**를 엽니다.
2. **New query**를 누릅니다.
3. 프로젝트 폴더의 `supabase/setup.sql` 파일을 메모장으로 엽니다.
4. 파일 내용을 처음부터 끝까지 전부 복사합니다.
5. SQL Editor에 붙여넣고 **Run**을 누릅니다.
6. 오류 없이 완료되었는지 확인합니다.

이 SQL 한 번으로 다음 항목이 설정됩니다.

- 관리구역 9개
- 오전·오후 점검 테이블
- 민원·시설 조치업무 테이블
- 사진 저장공간
- 공개 열람 권한
- 원스포츠 관리자 입력·수정·삭제 권한
- 2026년 9월 1일 이전 기록 차단
- 실시간 연동 설정

---

## 4단계. 원스포츠 관리자 로그인 계정 만들기

1. Supabase 왼쪽 메뉴에서 **Authentication → Users**로 이동합니다.
2. **Add user** 또는 **Create user**를 누릅니다.
3. 실제 관리자가 사용할 이메일과 비밀번호를 입력합니다.
4. 이메일 확인 없이 바로 사용할 수 있도록 계정을 확인 완료 상태로 생성합니다.
5. 생성된 이메일을 확인합니다.

관리자마다 계정을 따로 만드는 것이 좋습니다. 예를 들어 센터장 계정과 관리이사 계정을 분리하면 누가 입력했는지 관리하기 쉽고, 퇴사자 계정만 별도로 차단할 수 있습니다.

---

## 5단계. 생성한 계정에 관리자 권한 주기

Supabase **SQL Editor**에서 아래 SQL의 이름과 이메일을 실제 정보로 바꿔 실행합니다.

```sql
insert into public.app_admins (user_id, display_name, active)
select id, '장지연', true
from auth.users
where email = '실제관리자이메일@example.com'
on conflict (user_id)
do update set display_name = excluded.display_name, active = true;
```

관리자 계정을 여러 개 만들 때는 이메일과 표시이름을 바꿔 같은 SQL을 한 번씩 실행합니다.

### 관리자 등록 확인

```sql
select
  a.display_name,
  a.active,
  u.email
from public.app_admins a
join auth.users u on u.id = a.user_id;
```

`active`가 `true`로 보이면 정상입니다.

---

## 6단계. Supabase 연결값 확인하기

Supabase 프로젝트에서 아래 두 값을 확인합니다.

1. **Project URL**
2. **Publishable Key**

화면에 Publishable Key 대신 기존 **anon public key**만 보이는 프로젝트라면 해당 키를 사용할 수도 있습니다.

반드시 공개용 키만 사용합니다.

```text
사용 가능: Publishable Key, anon public key
사용 금지: Secret Key, service_role key
```

두 값을 메모장에 잠시 복사해 둡니다.

---

## 7단계. GitHub에 프로젝트 올리기

1. GitHub에 로그인합니다.
2. **New repository**를 누릅니다.
3. 저장소 이름을 예를 들어 `onesports-management`로 입력합니다.
4. 저장소를 생성합니다.
5. **Add file → Upload files**를 누릅니다.
6. 압축을 푼 폴더 안의 파일과 폴더를 모두 업로드합니다.
7. 화면 아래 **Commit changes**를 누릅니다.
8. 저장소 첫 화면에 `index.html`, `admin.html`, `vercel.json`이 바로 보이는지 확인합니다.

---

## 8단계. Vercel에 배포하기

1. Vercel에 로그인합니다.
2. **Add New → Project**를 누릅니다.
3. 방금 만든 GitHub 저장소를 찾아 **Import**합니다.
4. Framework Preset은 자동 인식값을 사용하거나 **Other**로 둡니다.
5. Root Directory는 기본값 `./`로 둡니다.
6. Build Command와 Output Directory는 별도로 입력하지 않습니다.
7. 아직 **Deploy**를 누르기 전에 환경변수를 추가합니다.

### Vercel 환경변수

| 변수명 | 입력값 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable Key 또는 anon public key |

운영 사이트에 필요한 **Production**은 반드시 적용합니다. 미리보기 배포에서도 테스트하려면 **Preview**에도 같은 값을 적용합니다.

환경변수 입력 후 **Deploy**를 누릅니다.

---

## 9단계. 배포 주소 확인하기

배포가 완료되면 Vercel이 주소를 발급합니다.

```text
공개 열람 화면
https://발급된주소.vercel.app/

원스포츠 관리자 화면
https://발급된주소.vercel.app/admin
```

### 공개 화면 확인

- 원스포츠 로고가 보이는지
- `관리기록 시작일 2026.09.01`이 보이는지
- 입력·수정·삭제 버튼이 없는지
- 2026년 8월 날짜로 이동할 수 없는지

### 관리자 화면 확인

- `/admin`에서 로그인 화면이 보이는지
- Supabase에서 만든 관리자 계정으로 로그인되는지
- 오전·오후 점검을 입력할 수 있는지
- 민원·시설 조치업무를 등록할 수 있는지
- 2026년 9월 1일 이전 날짜가 선택되지 않는지

---

# B. 이전 버전을 이미 배포한 경우

기존 Supabase 프로젝트와 GitHub·Vercel 연결을 그대로 사용하면서 이번 버전으로 교체할 수 있습니다.

## 1단계. 기존 기록 백업 여부 확인

`2026-09-01` 이전 기록이 테스트 데이터라면 그대로 진행해도 됩니다. 실제로 보관해야 할 기록이 있다면 먼저 별도로 백업합니다.

## 2단계. 기존 Supabase 프로젝트 업데이트

1. 기존 Supabase 프로젝트를 엽니다.
2. **SQL Editor → New query**로 이동합니다.
3. 이번 파일의 `supabase/update-2026-09-01.sql` 내용을 전부 붙여넣습니다.
4. **Run**을 누릅니다.

이 SQL은 다음 작업을 합니다.

- 2026년 9월 1일 이전 테스트 기록 삭제
- 점검일과 민원 접수일의 시작일 제한
- 공개·관리자 권한정책에 시작일 제한 반영

## 3단계. GitHub 파일 교체

기존 저장소의 파일을 이번 압축파일에 들어 있는 파일로 교체합니다.

특히 아래 파일은 반드시 새 버전으로 바꿉니다.

```text
index.html
admin.html
assets/common.js
assets/data.js
assets/viewer.js
assets/admin.js
assets/styles.css
assets/onesports-logo.png
icons/
manifest.webmanifest
sw.js
supabase/
README.md
APPLY_GUIDE_KO.md
```

GitHub Desktop을 사용한다면 폴더에 새 파일을 덮어쓴 뒤 Commit과 Push를 합니다. GitHub 웹사이트를 사용한다면 기존 파일을 수정하거나 새 버전 전체를 다시 업로드합니다.

## 4단계. Vercel 재배포 확인

GitHub 변경사항이 Vercel과 연결되어 있으면 새 Commit이 올라간 뒤 자동으로 재배포됩니다. Vercel의 **Deployments** 화면에서 최신 배포가 `Ready`인지 확인합니다.

환경변수를 아직 입력하지 않았다면 아래 두 값을 추가합니다.

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

환경변수를 새로 추가하거나 수정했다면 최신 Commit을 재배포합니다.

## 5단계. 예전 화면·로고 캐시 지우기

### PC 크롬

```text
Ctrl + Shift + R
```

### 삼성 갤럭시 홈 화면 앱

1. 기존 원스포츠 바로가기를 삭제합니다.
2. 크롬에서 새 배포 주소를 다시 엽니다.
3. 크롬 메뉴에서 **홈 화면에 추가** 또는 **앱 설치**를 선택합니다.

그래도 예전 화면이 남으면 크롬의 해당 사이트 저장정보를 삭제한 뒤 다시 접속합니다.

---

# C. 9월 1일 실제 운영 시작 절차

운영 전날 또는 당일 아래 순서대로 확인합니다.

1. 관리자 계정으로 로그인합니다.
2. 날짜가 `2026년 9월 1일`로 표시되는지 확인합니다.
3. 오전 관리자가 각 공간을 점검합니다.
4. 특이사항이 없으면 오전 미점검 공간을 정상 처리합니다.
5. 이상이 있는 공간은 상태·내용·사진을 따로 입력합니다.
6. 오후에도 같은 방식으로 점검합니다.
7. 민원이 들어오면 민원 관리에서 등록합니다.
8. 공개가 곤란한 내부 민원은 `입대의 열람 화면에 공개`를 끕니다.
9. 공개 주소에서 입력 내용이 반영되는지 확인합니다.

---

# D. 최종 점검표

아래 항목이 모두 맞으면 적용 완료입니다.

- [ ] 원스포츠 공식 로고가 공개·관리자 화면에 보인다.
- [ ] 휴대폰 홈 화면 아이콘이 원스포츠 로고로 보인다.
- [ ] 공개 화면에는 입력·수정·삭제 기능이 없다.
- [ ] `/admin`은 로그인해야 들어갈 수 있다.
- [ ] 승인되지 않은 일반 로그인 계정은 관리자로 사용할 수 없다.
- [ ] 날짜 선택의 시작일이 2026년 9월 1일이다.
- [ ] 캘린더가 2026년 9월부터 시작한다.
- [ ] 2026년 8월 이전 기록이 공개 화면에 나타나지 않는다.
- [ ] 관리자도 2026년 8월 날짜로 기록할 수 없다.
- [ ] 오전·오후 점검이 구분된다.
- [ ] 민원과 시설 조치업무를 등록할 수 있다.
- [ ] 비공개 민원은 공개 화면에 나타나지 않는다.
- [ ] 관리자 입력 후 공개 화면에 반영된다.

---

# E. 자주 발생하는 문제

## 관리자 로그인이 되지만 관리화면이 열리지 않는 경우

로그인 계정이 `app_admins`에 등록되지 않았을 가능성이 큽니다. 5단계의 관리자 등록 SQL을 다시 실행하고 `active = true`인지 확인합니다.

## 공개 화면은 열리지만 데이터가 저장되지 않는 경우

Vercel의 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`가 정확한지 확인합니다. 값을 수정했다면 재배포가 필요합니다.

## `데모 모드`가 표시되는 경우

Supabase 환경변수를 불러오지 못한 상태입니다. Vercel 환경변수 이름의 철자와 적용 환경을 확인합니다.

## 사진 업로드가 실패하는 경우

`setup.sql`이 끝까지 실행되었는지, Supabase Storage에 `management-photos` 버킷이 생성됐는지 확인합니다.

## 예전 로고가 계속 보이는 경우

브라우저 또는 홈 화면 앱이 이전 Service Worker 캐시를 사용하고 있을 수 있습니다. 강력 새로고침 후, 홈 화면 바로가기를 삭제하고 다시 설치합니다.
