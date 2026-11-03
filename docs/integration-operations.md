# 통합 단지 운영 API 및 배포·복구 안내

## 구현 상태와 신뢰 경계

`supabase/migrations/20261030_integration_operations.sql`은 기존 운영 테이블에 단지 범위를 추가하는 준비 마이그레이션입니다. 기존 행의 소속을 추정하거나 운영 데이터를 옮기지 않습니다. 단지 기본정보·접속 가능 상태·공용 비밀번호 버전·세션·본사 역할의 원본은 입찰 앱의 Cloudflare D1입니다. 이 저장소는 검증된 단지 UUID만 참조합니다. 두 저장소의 ID 일치가 외래키나 분산 트랜잭션을 의미하지 않습니다.

Workers가 현재 본사/현장 세션, 활성 상태, 기능, 단지 범위를 확인한 뒤 서명된 Supabase Edge gateway를 통해 서버 전용 `integration_operations` RPC를 호출합니다. Edge gateway는 설정된 P-256 공개키로 요청을 검증하고, Supabase 내장 service role 자격증명으로 허용된 RPC/사진/기존 관리자 검증 동작만 수행합니다. 운영 service role 키를 Cloudflare나 브라우저로 복사하지 않습니다. 이 RPC는 `service_role`만 실행할 수 있으며 고정된 resource·action·컬럼 허용 목록을 사용합니다. `service_role`은 RLS를 우회하므로 보호의 핵심은 Workers 인증, gateway 서명·동작 검증, 이 RPC의 모든 SQL에 포함된 단지 검증입니다. RLS만으로 보호된다고 볼 수 없습니다.

원본 테이블의 `integration_site_id`가 NULL인 기존 행은 기존 정책을 유지합니다. 매핑된 행과 새 통합 행은 `anon`·`authenticated` 대상의 restrictive RLS 정책이 기존 전역 관리자 정책과 공개 정책을 모두 제한합니다. 따라서 기존 `/admin`이나 직접 Supabase API로 다른 단지에 우회 접근할 수 없습니다. 다만 **행을 실제 매핑하는 순간 그 행은 구버전 공개/관리 화면에서 제외되므로, 호환 화면 전환·공개 범위 검증이 끝나기 전에는 매핑 함수를 실행하면 안 됩니다.** 준비 마이그레이션만 적용한 상태에서는 기존 행의 읽기·쓰기와 회원서비스를 그대로 유지합니다.

## RPC 계약

`POST /rest/v1/rpc/integration_operations`

```json
{
  "p_site_id": "validated-server-side-site-uuid",
  "p_resource": "issues",
  "p_action": "create",
  "p_payload": {
    "request_id": "client-operation-uuid",
    "title": "운동기구 점검",
    "description": "확인한 현상",
    "received_date": "2026-10-30",
    "actor_type": "SITE_STAFF",
    "actor_id": "server-derived-session-reference"
  }
}
```

예시 값은 형식 설명이며 실제 UUID로 대체해야 합니다. `p_site_id`, `actor_type`, `actor_id`는 서버가 검증한 값으로 지정하고 클라이언트가 보낸 동명 필드는 거절합니다. 공용 계정의 `manager_name`은 자가 입력한 이름이며 인증된 개인 신원이 아닙니다. SQL 감사기록에는 요청 본문·비밀번호·키·사진·민원 내용을 남기지 않습니다.

- resource: `areas`, `inspections`, `issues`, `inventories`, `head_office_checks`.
- action: `list`, `get`, `public_list`, `summary`, `create`, `update`, `delete`.
- 읽기 응답: `{ok:true,items:[],total,limit,offset}` 또는 `{ok:true,item:{...}}`. total은 필터를 적용한 해당 단지 전체 건수이며 빈 페이지에서도 정확합니다.
- 쓰기 응답: `{ok:true,item:{...}}`, 삭제는 `{ok:true,deleted:true}`.
- `get`, `update`, `delete`는 `id`가 필요합니다. 대상 ID가 다른 단지에 속하거나 존재하지 않으면 같은 `P0002` 오류를 냅니다.
- list/public_list 필터: `start`, `end`(해당 resource 날짜), `search`(title/name), `status`(점검·민원·비품), `limit`(1–200, 기본 100), `offset`(0–100000). 페이지 길이를 전체 건수로 표시하면 안 됩니다. 실제 대시보드는 날짜 필터와 전체 페이지 집계가 필요합니다.
- create는 UUID `request_id`가 필수입니다. DB transaction advisory lock과 원문 해시로 동시/반복 요청을 하나의 결과에 묶습니다. 같은 키의 다른 내용은 거절합니다. 네트워크 응답 유실 시 새 키를 만들지 않고 같은 내용·같은 키로 재시도합니다.
- update는 전달한 필드만 바꿉니다. `expected_updated_at`을 보내면 행 잠금 아래 기존 수정시각과 비교하며 달라졌을 때 SQLSTATE `40001`로 거절합니다. 서버는 이를 409 충돌로 표시해야 합니다. 새 기록 ID를 직접 지정하거나 권한/단지/사진 경로를 본문에 넣을 수 없습니다.
- `summary`는 resource=`inspections`에서만 허용하고, payload는 선택적 `start`/`end` 날짜 필터만 받습니다. 둘 다 생략하면 서버 KST 오늘을 사용합니다. `{ok:true,today,periodStart,periodEnd,inspectionCount,completedCount,expectedChecks,openIssueCount,recentHeadOfficeChecks:[]}`를 반환합니다. inspectionCount는 선택 기간 점검 행 수, completedCount는 그중 normal/completed 수, expectedChecks는 **하루 기준** 활성 공간 수×2, openIssueCount는 전체 기간의 미완료 민원·조치 수입니다. 최근 본사점검은 전체 기간에서 날짜/수정시각 내림차순 5개이며 담당자/파일을 제외합니다. 페이지 제한 없이 DB 전체 단지 범위에서 집계합니다.

| resource | 쓰기 필드 | 핵심 규칙 |
| --- | --- | --- |
| areas | name, sort_order, checklist(문자열 배열), active | 본사 전용. slug는 단지 UUID와 요청 UUID에서 생성; 기존 ID/slug를 재사용하지 않음 |
| inspections | inspection_date, period, area_id, status, checked_items, item_statuses, note, manager_name, is_public | AM/PM; 동일 단지 공간 필수; 기존 날짜·오전오후·공간 unique 유지 |
| issues | category, area_id, title, description, status, priority, received_date, due_date, action_note, manager_name, is_public | 공간이 있으면 해당 단지 공간만 허용 |
| inventories | record_date, area_id, category, name, quantity, status, note, manager_name, is_public | 공간이 있으면 해당 단지 공간만 허용 |
| head_office_checks | check_date, check_type, title, result, follow_up, manager_name, is_public | 기존 scope=all/status=completed 유지; 현장 쓰기 허용 여부는 API에서 통제 |

새 기록은 비공개 기본값입니다. 점검·본사점검에는 기존에 공개 플래그가 없어 내부 컬럼 `integration_is_public`을 추가하지만 RPC 입출력에서는 `is_public`로 표시합니다. 기존 issues/inventories의 공개 플래그는 임의 변경하지 않습니다. 날짜 기본값과 미래일 검사는 Asia/Seoul을 사용합니다. 운영 시작 전인 2026-09-01 이전 기록 제한은 기존 제약을 유지합니다.

Workers는 현장에 삭제·단지 설정·공개 변경·본사점검 변경·전체 내보내기를 기본 허용하지 않아야 합니다. SQL 함수는 검증된 서버 호출의 데이터 범위를 강제하는 계층이며 현장 사용자 자체를 인증하지 않습니다.

## 공개 열람과 파일

`public_list`도 service_role 전용입니다. Workers가 D1의 해당 단지 `public_enabled`를 먼저 확인해야 합니다. 함수는 해당 단지의 명시적 공개 행만 반환하고 담당자·작성자·단지 내부 ID·파일 경로를 공개 응답에서 제외합니다. 기존 사진은 `legacy_photo_count`만 반환하고 고정된 기록 ID·배열 인덱스의 공개 사진 API에서 권한을 다시 확인합니다. 신규 단지는 공개 열람 기본 OFF입니다.

기존 `management-photos`는 저장소 SQL상 공개 버킷이며 실제 운영 상태는 별도 확인해야 합니다. 이미 존재하는 `photo_paths`는 매핑 때 삭제/이동/변경하지 않으며 내부 get/list에서는 `integration_legacy_record`와 함께 반환합니다. 이를 비공개 첨부라고 표시하면 안 됩니다. 새 통합 업로드는 Workers의 기존 R2 FILES 바인딩과 D1 `os_files`로 처리하며, 이 RPC에 임의 photo_paths를 저장하는 방식은 거절합니다. 파일 열람 전 RPC get으로 기록·단지 소속을 재확인해야 합니다. 기존 사진을 새로운 공개 버킷에 복사하지 않습니다.

기존 회원서비스의 `member-service-files`, `ms_guest_photos`, 회원·재등록·결제확인·GX·공개 공지·비공개 건의 기능은 수정하지 않습니다. `is_app_admin()`을 전역 HQ 판정으로 교체하지 않습니다. 해당 기능은 기존 단일 센터 범위이며 여러 단지로 일반화했다고 주장하지 않습니다.

## 설정 위치

| 위치 | 변수/권한 | 비고 |
| --- | --- | --- |
| Workers 환경별 Secret | MANAGEMENT_GATEWAY_PRIVATE_KEY | P-256 서명키. 브라우저/VITE 변수 금지; 지정된 Edge gateway 호출에만 사용 |
| Supabase Edge 설정 | 검증용 공개 JWK 및 내장 service role | service role 비밀값을 외부로 가져오거나 표시하지 않음 |
| Workers 환경별 설정 | MANAGEMENT_SUPABASE_URL, MANAGEMENT_SUPABASE_PROJECT_REF, MANAGEMENT_DATA_ENV | API의 APP_ENV와 일치; staging/preview 이름만으로 분리로 판단하지 않음 |
| 기존 Vercel 관리앱 | SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY | 기존 공개 config API 유지; service key 추가하지 않음 |
| 승인된 DB 운영자 연결 | PGHOST/PGDATABASE/PGUSER/PGSSLMODE 및 안전한 자격증명 공급 | 대화·Git·명령 출력에 비밀값을 넣지 않음 |

최초 HQ 관리자 지정은 D1의 별도 명시적 사용자 ID 등록 절차에서 수행합니다. 이 SQL은 기존 app_admins 사용자 누구도 HQ로 승격하지 않습니다. 지정할 실제 ID가 확인되지 않으면 설정 대기로 유지합니다.

## 준비 마이그레이션 적용 순서

1. 실제 Supabase 프로젝트 ID, DB 스키마/정책, Storage 버킷, 연결된 앱 및 calendar_tasks 존재를 읽기 전용으로 확인합니다. 개발·staging·운영의 데이터 식별자가 실제로 다름을 확인합니다.
2. 운영 DB와 파일을 보안 백업 위치에 백업하고 격리 DB에 복원해 검증합니다. 백업을 소스 저장소, 테스트 산출물, 공개 파일에 저장하지 않습니다.
3. 복원한 비운영 DB에 이 준비 마이그레이션을 적용하고 재실행합니다. 기존 행 수·핵심 필드·사진 경로·참조 관계·회원서비스 RPC/공개 페이지를 전후 비교합니다.
4. 권한·세션·업무 통합 테스트가 통과하면 확인된 대상에 같은 준비 SQL을 적용합니다. 이 단계는 기존 행을 매핑하지 않으며 기존 프론트를 바꾸지 않습니다.
5. 새 통합 화면은 환경이 분리된 API/Supabase로 검증합니다. 연결 실패는 오류로 표시하고 임의 데모/운영 fallback을 사용하지 않습니다.
6. 실제 단지 매핑은 아래 별도 전환 게이트가 충족된 뒤 진행합니다. 운영 승인·대상·백업이 확인되지 않으면 운영 명령을 실행하지 않습니다.

설정된 안전한 DB 연결을 사용하는 명령 예시:

```powershell
psql --set ON_ERROR_STOP=1 --file supabase/migrations/20261030_integration_operations.sql
```

`supabase/setup.sql`과 `supabase/update-2026-09-01.sql`은 기존 기록 삭제가 포함되어 있으므로 기존 환경에 다시 실행하지 않습니다.

## 명시적 기존 기록 매핑

`integration_map_legacy_records(site UUID, manifest JSONB, evidence TEXT, approved_by UUID, approved_by_system TEXT DEFAULT 'supabase-auth')`는 DB 소유자만 실행할 수 있습니다. `service_role`, anon, authenticated에는 실행 권한이 없습니다. 실제 기존 기록·공간 소속을 확인한 운영자만 사용합니다. 승인자는 `supabase-auth` 또는 `better-auth`로 구분하여 실제 확인한 사용자 UUID를 기록합니다. `supabase-auth`는 해당 `auth.users` 존재를 검사하며, `better-auth`는 운영자가 D1의 사용자·활성 HQ 멤버십과 배포 승인 근거를 직접 확인하여 evidence에 남겨야 합니다. 다른 서비스의 사용자를 기존 관리자 UUID로 바꾸거나 가상 Supabase 사용자를 만들지 않습니다. 감사기록에도 `namespace:UUID`를 남깁니다.

manifest는 최대 1000개 `{resource,id,sha256}` 항목입니다. 공간을 먼저, 공간을 참조하는 기록을 나중에 나열합니다. fingerprint는 아래 표현식으로 생성합니다. 결과와 근거는 접근이 제한된 운영 매핑 파일로 보관하고 Git에 넣지 않습니다.

```sql
encode(digest(convert_to(
  (to_jsonb(t)-'integration_site_id'-'integration_legacy_record'-'integration_is_public')::text,
  'UTF8'),'sha256'),'hex')
```

사전에 검토한 행의 해시와 다른 행, 미존재 행, 다른 단지에 이미 매핑된 행, 다른 단지 공간을 참조하는 행은 거절합니다. 하나라도 실패하면 전체 manifest가 롤백됩니다. 동일 manifest 재실행은 중복 매핑 없이 끝납니다. 기존 업무 수정시각·수정자·완료시각·사진 경로는 보존하고 별도 매핑 감사기록만 남깁니다. 예상하지 못한 기존 trigger가 업무 필드를 변경하면 비교 검사로 전체 매핑을 중단합니다.

매핑 전 필수 게이트:

- 상도 1단지의 검증된 고유 ID 및 해당 기존 행·공간·공개 범위·사진 연결 근거.
- 구 공개 URL, `#today`, 구 `/admin`에서 해당 행을 새 권한으로 읽는 호환 경로가 완성되고 검증됨.
- 기존 개인 관리자들의 단지 또는 HQ 역할을 명시적으로 매핑함. 자동 승격 금지.
- inspections/head_office_checks 공개 전환은 승인된 개별 범위를 별도 확인함. 이 준비 SQL은 공개를 자동 켜지 않음.
- 기존 회원서비스를 기존 센터에 유지하는 전환 계획과 회귀 테스트.

게이트가 완료되지 않은 상태에서는 매핑을 실행하지 않아야 합니다. 현재 기존 공개/관리 UI의 호환 adapter가 구현되어 있으며 실제 전환은 [기존 화면 호환 절차](legacy-compatibility.md)의 환경 설정·명시적 매핑·외부 검증을 완료해야 합니다.

## 백업·복구·롤백

- 변경 전: 일관된 DB 백업(스키마·역할·정책·함수·운영/회원 테이블)과 Storage 실제 객체 백업, 각 버킷의 public 설정·정책, 파일 경로/크기/체크섬 manifest를 확보합니다. Supabase DB 덤프만으로 Storage 객체가 복구되지 않습니다.
- 복원 검증: 격리된 같은 PostgreSQL 주요 버전에 복원하고 기록 수/PK/FK/핵심 필드 해시/파일 checksum/공개 링크/회원 신청 snapshot을 대조합니다. D1/R2 측 백업과 기준 시각도 함께 기록하되 두 저장소가 하나의 트랜잭션 백업이라고 가정하지 않습니다.
- 준비 SQL 이후 매핑 전: 이전 프론트/Workers로 코드 롤백 가능. 추가 컬럼/함수/테이블은 남겨두며 DROP으로 롤백하지 않습니다. 기존 NULL 행과 회원서비스는 그대로 유지됩니다.
- 매핑 이후: 코드만 되돌리면 매핑된 행이 구 화면에서 보이지 않습니다. 새 권한이 적용된 호환 경로를 유지하거나 승인된 역매핑 계획을 먼저 수행해야 합니다. RLS 가드를 무조건 제거하면 다른 단지 정보가 공개될 수 있습니다.
- 새 기록 발생 이후: 예전 전체 DB 백업을 운영에 덮어쓰지 않습니다. 장애 이후 추가 기록·첨부·감사로그를 먼저 보존하고, 격리 복원본과 비교하여 명시적 ID별 변경분을 복구한 뒤 건수/참조/권한을 다시 검증합니다. 단지 종료는 보관 상태이며 기록 삭제가 아닙니다.

## 검증 결과와 아직 필요한 확인

### 2026-11-03 최종 전환 확인

아래의 준비 단계 기록 이후, 배포 담당자가 명시적 소유자·단지·공개 범위 검토와 백업 복원 검증을 완료하고 운영 마이그레이션·매핑 및 Workers/Vercel 배포를 수행했습니다. 최종 SQL은 격리 PostgreSQL의 합성 데이터 20개 검사와 실제 백업 복원본 181개 검사를 통과했습니다. 공개 화면의 전환 전후 오늘·9/10/11월 집계, 기존 증빙 사진 3장, 390px 모바일 화면이 일치했고 브라우저 오류가 없었습니다. 기존 Supabase 관리자 세션의 해당 단지 조회·회원 메뉴도 읽기 전용으로 확인했습니다. 회원 데이터·공유 일정은 유지됩니다.

그 뒤 사용자가 기존 관리자 로그인도 중지하고 통합 앱으로 이동하도록 추가 요청했습니다. 해당 코드와 권한 해제 절차는 [로그인 진입 통일](legacy-compatibility.md)에 기록되어 있습니다. 현재 Node 테스트는 신규 경로 검증을 포함하여 62개입니다. 아래 47개/17개 및 미반영 표시는 초기 준비 시점 기록이며 최종 운영 상태를 뜻하지 않습니다.

- `npm ci --ignore-scripts`: 성공, 취약점 0건(설치 시점 출력).
- `npm test`: 기존 Node UI/privacy/QR 테스트 47개 통과.
- `node tests/integration-operations.mjs`: 실제 격리 PostgreSQL 17에서 17개 보안/CRUD/매핑 검사 통과. 테스트는 loopback의 새 DB만 사용하며 운영 연결 정보를 읽지 않습니다. 마이그레이션 재실행, 기존 행/공유 테이블 보존, 권한, cross-site ID/검색/수정/삭제 차단, 익명 직접 조회 차단, 공개 필드 제한, 생성 멱등성, 정확한 전체 집계/페이지 건수, 매핑 원자성·fingerprint·원본 metadata 보존을 검증했습니다.
- `node tests/backend-security.mjs`: 기존 회원서비스 실제 격리 PostgreSQL 보안 12개 그룹 통과.
- 실제 Supabase 프로젝트 `csacwkwasjntfkzinzfg`의 운영 main, 핵심 스키마, 공유 calendar_tasks, management-photos 공개 상태는 주 에이전트의 읽기 전용 대시보드 메타데이터 확인으로 검증했습니다. 별도 비운영 Supabase는 확인되지 않았습니다. 전체 정책/역할·키 방식, 실제 소유자 사용자 ID, 초기 행 매핑, 파일별 공개 적합성, 백업 복원은 아직 미검증입니다. 운영 SQL이나 운영 데이터 쓰기는 실행하지 않았습니다.
- 이 문서는 관리 저장소의 준비 범위를 기록합니다. Workers/Vercel 배포 주소 및 최종 검증 상태는 상위 통합 보고서의 실제 결과를 따릅니다. 이 SQL을 작성하거나 로컬 테스트를 통과한 사실이 운영 반영 완료를 뜻하지 않습니다.
