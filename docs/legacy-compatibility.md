# 기존 공개 화면·관리자 호환 (2026-11-03)

이 변경은 기존 `/`, `#today`, 캘린더, 월간 보고, `/admin` 화면과 Supabase 관리자 로그인을 유지하면서 **매핑한 운영 기록**의 조회·저장 경로를 통합 권한 API로 바꿉니다. 기존 `ms_*` 회원·재등록·GX·수납·건의 흐름과 `calendar_tasks`는 변경하지 않습니다. 기존 관리자에게 HQ 권한을 자동 부여하지 않습니다.

## 경로와 권한

- 공개 브라우저 → `/api/integration-public` → 고정된 `LEGACY_SITE_ID`의 Workers 공개 API → 서명된 Supabase Edge gateway → service-role 전용 범위 RPC.
- 기존 `/admin` → 기존 Supabase Auth 로그인 → `/api/integration-legacy`에 현재 access token을 Authorization 헤더로 전달 → Workers가 Auth user·활성 app_admins 및 D1의 명시적 user→site 매핑을 매 요청 확인 → 그 단지의 RPC만 호출.
- 기존 관리자 세션에서 `SITE_ADMIN`이라는 개인별 행위자 유형을 사용합니다. 공용 비밀번호 직원 `SITE_STAFF`와 구분합니다. `/legacy/session`의 단지 ID와 관리앱 설정이 다르면 화면을 열지 않습니다.
- 기존 관리자에는 기존 단지의 등록·수정·공개 플래그 편집을 허용하되, 이 호환 API에 본사 역할 변경·입찰·단지 추가/설정·영구삭제 경로를 제공하지 않습니다.
- API 에러는 빈 배열이나 데모로 변환하지 않습니다. 페이지 전체 건수와 중복 ID를 확인하여 완전히 읽힌 기록만 표시합니다. API 응답과 개인 화면·스크립트는 공유 서비스워커 캐시에 넣지 않습니다.
- 기존 Supabase 로그인은 회원서비스 보존 때문에 유지됩니다. 새 비밀번호나 별도 로컬 토큰을 만들지 않습니다. access token을 URL·사진 주소·새 localStorage 키에 기록하지 않습니다.

## 사진·첨부

기존 공개 버킷 객체를 비공개로 바꿨다고 주장하지 않습니다. 기존 경로 자체는 유지합니다. 공개 API는 명시적으로 공개된 매핑 기록의 `legacy_photo_count`만 반환합니다. 브라우저는 해당 기록 ID+배열 인덱스로 공개 사진 API에 요청하고, 서버가 그 기록의 실제 경로를 확인합니다. 임의 Storage 경로/URL 입력은 받지 않습니다.

기존 관리자 사진은 Bearer 인증으로 받아 메모리 Blob URL로 보여 줍니다. 로그아웃·페이지 이탈 시 URL과 사진 캐시를 폐기하며, 그 사이에 끝난 이전 요청은 화면을 복원하지 못합니다. 새 사진은 기존 이미지 인코더로 디코딩·메타데이터 제거·JPEG 재인코딩하여 512 KiB 이하로 만든 뒤, **업무 기록 저장 후** R2 첨부 API로 보냅니다. 파일 업로드의 UUID 멱등성 키는 재시도 때 유지합니다. 기록 성공/파일 실패가 나면 부분 실패를 명확히 표시하고 같은 요청으로 재시도합니다. 기존 증빙 사진을 폼에서 제거하거나 영구삭제하지 않습니다.

사진 미리보기에서는 이미지 첨부를 보여 줍니다. 별도의 PDF 등 통합 첨부는 통합 업무 화면의 첨부 목록에서 확인합니다. 관리앱의 기존 사진 입력 기능은 이미지 파일을 대상으로 유지합니다.

## 설정과 전환 순서

Vercel 관리앱의 환경별 변수는 `integration.env.example`을 따릅니다. `API_ORIGIN_PRODUCTION`과 `API_ORIGIN_STAGING`을 분리하고, Preview 설정이 없으면 운영 API로 fallback하지 않습니다. `INTEGRATION_HQ_ORIGIN`은 경로/쿼리/자격증명이 없는 HTTPS origin이어야 합니다. Workers에는 별도로 실제 관리앱 Origin인 `LEGACY_APP_ORIGIN`을 허용합니다.

1. DB·Storage 백업과 복원 검증, 운영 테이블/정책/단지 소속 근거를 확정합니다.
2. 호환 코드와 Workers/Edge gateway를 배포하되 관리앱의 `LEGACY_INTEGRATION_ENABLED`는 false로 둡니다. 기존 동작은 그대로입니다.
3. 승인된 정확한 기존 사용자→단지 매핑을 D1에 등록하고, 새 HQ 역할은 별도 지정된 개인 계정에만 부여합니다.
4. SQL 준비 마이그레이션을 적용합니다. 아직 기존 행을 매핑하지 않습니다.
5. 짧은 전환 구간 동안 기존 운영 기록 쓰기를 통제하고 마지막 백업 이후 변경분을 확인합니다. 매핑 manifest의 fingerprint가 다르면 중단하고 재검토합니다.
6. 정확한 manifest를 원자적으로 매핑한 후 `LEGACY_INTEGRATION_ENABLED=true`와 정확한 단지 ID를 사용한 관리앱 빌드를 배포합니다. 매핑과 관리앱 전환 사이에는 기존 직접 조회에서 해당 행이 잠시 보이지 않으므로 작업 창을 계획합니다.
7. 기존 공개 날짜별 건수·사진·캘린더·월간 집계, 기존 관리자 로그인·수정·회원서비스, 새 HQ·현장 권한을 확인합니다. 실패 때 기록을 삭제하거나 RLS 가드를 해제하지 않습니다.

## 소속과 공개 범위의 정확한 증거

자동으로 전체 테이블을 상도 단지에 넣는 코드가 없습니다. 운영자는 다음 증거와 정확한 ID 목록을 확인한 후 별도 manifest를 준비합니다. 실제 행 내용·이메일·사진을 이 저장소에 넣지 않습니다.

| 범위 | 필요한 근거 |
| --- | --- |
| 단지 | 원본 화면·저장소가 단일 상도 1단지를 명시하고, 실제 배포 config가 동일 Supabase 프로젝트를 가리킴 |
| 공간 | 원본 13개 공간의 ID·slug·명칭·점검양식과 실제 DB 공간 ID가 일치함. 새/미확인 공간은 별도 제외 |
| 점검 | 정확한 record ID, 검증된 공간 참조, 기존 승인 관리자 작성자, 날짜/AM-PM 및 원본 snapshot hash |
| 민원·비품 | 정확한 record ID와 작성자, 검증된 공간 또는 공통 기록에 대한 원본 앱 소속 근거, 기존 is_public 값 |
| 본사점검 | 정확한 record ID·작성자·원본 전용 테이블 사용 근거·일자와 원본 snapshot hash |
| 공유 데이터 | calendar_tasks 및 ms_*를 manifest에서 제외함. 이 테이블들의 행·정책·함수를 변경하지 않음 |

주 에이전트의 2026-11-03 읽기 전용 확인으로 운영 기록 1,624개가 하나의 기존 승인 관리자 작성자이고, 점검은 원본 13개 공간의 확인된 날짜 범위에 속한다는 증거가 확보되었습니다. 이 사실을 일괄 UPDATE의 대체 조건으로 쓰지 않고 각 행의 ID·fingerprint로 다시 확인합니다. 사용자 ID·이메일·실제 manifest는 승인된 운영 작업 위치에서만 취급합니다.

실제 과거 정책과 원본 공개 페이지 필터는 다음과 같습니다.

- inspections: `inspection_date >= 2026-09-01`; 공개 페이지는 선택한 조회기간과 오늘까지 추가 제한.
- head_office_checks: `check_date >= 2026-09-01`; 공개 페이지 기간 제한.
- issues/inventories: `is_public=true` 및 해당 날짜 cutoff. 기존 false 값은 절대 true로 바꾸지 않음.
- areas: `active=true`.

점검·본사점검 manifest 항목은 `{resource,id,sha256,was_public,visibility_evidence}`를 명시해야 합니다. was_public은 **당시 실제 정책과 원본 페이지에서 공개되었음이 입증된 경우만** true입니다. visibility_evidence에는 검토한 정책과 근거를 남깁니다. 이 값은 별도 매핑 ledger에 보존하며, 같은 ID를 다른 공개 판정으로 재실행하면 거절합니다. 기존 is_public이 있는 민원·비품의 플래그는 매핑 중 바꾸지 않습니다. 범위를 판단할 수 없는 행은 미매핑 상태로 남깁니다.

## 로컬 검증

- `npm test`: 기존 47개와 새 호환 테스트 9개, 총 56개 통과.
- `node tests/integration-operations.mjs`: 실제 격리 PostgreSQL 보안/CRUD/매핑 테스트 19개 통과.
- 신규 검사: 원래 공개 정책의 개별 증거 없이는 공개 매핑 거절, 사진 개수만 공개, 기존 수정자·시각 보존, expected_updated_at의 stale edit 40001 거절, status 필터, 부분 업로드 재시도, 로그아웃 중 사진 요청 무효화, 고정 단지 프록시/출처/환경 분리.
- 실제 Chrome headless 로컬 검사 통과: 합성 데이터/API 응답으로 `/admin`의 단지별 읽기·점검 수정, 회원서비스 메뉴 유지, 인증 사진 Blob 표시, 공개 `#today`, 390px 모바일 가로 넘침 없음. 운영 API와 운영 데이터를 사용하지 않은 화면 호환 검사이며 외부 통합 검증과 구분합니다.
- 원격 배포·마이그레이션·실제 record 매핑은 주 에이전트가 배포 결과에서 별도로 보고합니다. 이 문서의 로컬 통과 결과만으로 운영 반영을 주장하지 않습니다.
