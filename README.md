# (주)원스포츠 휘트니스센터 실시간 관리현황

힐스테이트 상도 센트럴파크 1단지 휘트니스센터의 관리업무를 기록하고, 입주자대표회의·관리사무소에 열람 전용으로 공유하는 모바일 대응 웹앱입니다.

## 2026-09-28 회원서비스 추가

- `/members`: 회원 안내 게시판, 빠른 연장·재등록, 비공개 건의, 본인 처리내역
- 기존 `/admin`에 회원·이용권, 신청·결제, GX, 게시판, 건의, 회원서비스 설정 추가
- 기존 운영 DB에는 **`supabase/member-service.sql`만** 적용합니다. 아래 과거 설치/업데이트 절차를 다시 실행하지 마세요.
- [DB 적용·복구 안내](docs/member-service-operations.md), [API 계약](docs/member-service-contract.md)
- 최초 신청·건의 접수는 꺼져 있습니다. 요금·GX 정원과 일정·개인정보 보유기간·승인된 동의문을 운영자가 확인한 후 엽니다.
- 검증: `npm ci`, `npm test`, `npm run test:db`, `node tests/backend-security.mjs`. DB 테스트 두 명령은 분리된 로컬 PostgreSQL을 사용하므로 순서대로 실행합니다.

## 이번 적용 버전

- 제공받은 **원스포츠 공식 로고**를 공개 화면·관리자 화면·모바일 앱 아이콘에 적용
- **운영 기록 시작일을 2026년 9월 1일로 고정**
- 2026년 8월 31일 이전 날짜는 날짜 선택·캘린더·월간보고에서 접근 불가
- 관리자도 2026년 9월 1일 이전 점검·민원·조치업무를 입력할 수 없음
- Supabase 데이터베이스 제약조건과 RLS 정책에서도 이전 날짜 저장·조회 차단

> `supabase/setup.sql` 또는 `supabase/update-2026-09-01.sql`을 실행하면 기존에 입력된 2026년 9월 1일 이전 테스트 기록은 삭제됩니다. 필요한 자료가 있다면 먼저 백업하세요.

## 포함 기능

- 공개 열람 화면: 로그인 없이 보기만 가능
- 관리자 화면: 승인된 원스포츠 관리자만 입력·수정·삭제
- 로비·헬스장·골프연습장·GX룸·탁구장·남녀 탈의실·화장실·독서실 관리
- 모든 공간의 오전·오후 점검 구분
- 상태: 정상 / 이상 발견 / 조치 중 / 조치 완료
- 점검항목, 특이사항, 담당자, 입력시간, 사진 기록
- 시설·안전·청결 조치업무 관리
- 민원 접수 → 확인 중 → 조치 중 → 완료 관리
- 날짜별 캘린더, 월간 집계, 인쇄·PDF
- Supabase Realtime을 이용한 화면 간 즉시 반영
- 휴대폰 홈 화면 설치용 PWA

## 보안 구조

화면에서 입력 버튼만 숨기는 방식이 아니라 Supabase Row Level Security(RLS)로 권한을 통제합니다.

- `anon`: 2026년 9월 1일 이후 공개 관리현황 읽기만 가능
- `authenticated`: 기본적으로 읽기만 가능
- `app_admins`에 등록된 로그인 사용자: 입력·수정·삭제 가능
- 브라우저에는 공개 가능한 Publishable/Anon Key만 사용
- `service_role` 키는 웹 코드나 Vercel 환경변수에 넣지 않음

## 적용 방법

자세한 순서는 [`APPLY_GUIDE_KO.md`](./APPLY_GUIDE_KO.md)를 확인하세요.

### 처음 설치하는 경우

1. Supabase 프로젝트 생성
2. `supabase/setup.sql` 전체 실행
3. Authentication에 관리자 계정 생성
4. 관리자 계정을 `app_admins`에 등록
5. 프로젝트 파일 전체를 GitHub 저장소 루트에 업로드
6. Vercel에서 GitHub 저장소 Import
7. `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 환경변수 추가
8. 배포 후 공개 주소와 `/admin` 주소 확인

### 기존 버전을 이미 적용한 경우

1. `supabase/update-2026-09-01.sql` 실행
2. GitHub의 기존 파일을 이번 버전으로 교체
3. Vercel 재배포 확인
4. 휴대폰·PC에서 강력 새로고침
5. 홈 화면 앱이 예전 로고를 표시하면 기존 바로가기를 삭제 후 다시 설치

## 관리자 등록 SQL

Supabase Dashboard의 Authentication에서 관리자 이메일 계정을 먼저 만든 다음 아래 SQL을 수정해 실행합니다.

```sql
insert into public.app_admins (user_id, display_name, active)
select id, '장지연', true
from auth.users
where email = '관리자이메일@example.com'
on conflict (user_id)
do update set display_name = excluded.display_name, active = true;
```

## 배포 환경변수

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable Key 또는 기존 Anon Key |

`service_role` 또는 Secret Key는 입력하지 않습니다.

## 접속 주소

- 입대의·관리사무소 열람 주소: `https://배포주소/`
- 원스포츠 관리자 주소: `https://배포주소/admin`

## 데모 확인

운영 사이트는 Supabase 연결 실패 시 오류를 표시합니다. 자동 데모 전환은 하지 않습니다. 데모는 localhost 또는 127.0.0.1에서 `?demo=1`을 명시한 기존 관리현황 화면에만 허용합니다. 회원서비스는 데모 저장을 지원하지 않습니다.

```bash
python -m http.server 8000
```

- 공개 화면: `http://localhost:8000/?demo=1`
- 관리자 화면: `http://localhost:8000/admin.html?demo=1`
- 관리자 화면에서 `데모 관리자 화면 보기` 선택

데모 입력은 현재 브라우저의 LocalStorage에만 저장됩니다.

## 운영 권장 원칙

- 정상 점검은 실제 확인 후 저장
- 이상 발견 시 현상과 사진을 함께 기록
- 조치 중에는 업체 접수일·예정일을 기록
- 완료 시 최종 결과와 완료 사진을 기록
- 민원인의 이름·전화번호·동호수 등 개인정보는 입력하지 않음
- `입대의 열람 화면에 공개`를 끄면 관리자만 해당 기록을 확인 가능

## 파일 구조

```text
index.html                         공개 열람 화면
admin.html                         관리자 화면
assets/onesports-logo.png          적용된 원스포츠 로고
assets/                            CSS·JavaScript
api/config.js                      Vercel 환경변수 전달 함수
supabase/setup.sql                 최초 DB·RLS·Storage·Realtime 설정
supabase/update-2026-09-01.sql     기존 프로젝트의 시작일 변경용 SQL
manifest.webmanifest               모바일 앱 설치 설정
sw.js                              PWA 캐시
vercel.json                        Vercel 라우팅·보안 헤더
APPLY_GUIDE_KO.md                  적용 순서 안내서
```
