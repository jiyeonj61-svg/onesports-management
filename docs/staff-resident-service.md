# 통합 직원 입주민 업무 계약과 적용

2026-11-04. 기존 `/members` 공개 접수와 단일 센터 데이터는 유지하고, 통합 앱의 검증된 직원 세션에 신청·건의·게시판 처리만 제공합니다. `member_service`, `guest_service`, `is_app_admin()`의 본문과 권한은 변경하지 않습니다. 기존 `/admin` 접속 중단도 유지합니다.

## 공개 화면

- `/members`: 입주민 게시판 홈
- `/members/renew`: 프로그램 신청서 선택
- `/members/renew/fitness-golf`, `/members/renew/gx`: 기존 회원 재등록
- `/members/requests`: 비로그인 건의·요청
- `/members/my`: 접수번호와 비밀 확인키로 본인 접수 확인

온라인 신규 회원 가입은 제공하지 않습니다. 기존 회원 명부에 없는 재등록 접수는 종이 기록을 확인하여 미승인 프로필로 추가한 뒤 명시적으로 입주민 확인·연결합니다. Auth 계정은 만들지 않습니다. 기존 접수 활성화 스위치, 상품·약관·신청서 설정은 변경하지 않습니다.

## 인증과 연결

Worker가 `requireStaff`로 세션을 검증하고 고정 센터 연결을 확인한 뒤 서명된 Edge gateway에 `{siteId,actorId,service,action,payload}`를 보냅니다. `actorId`는 서버가 확인한 세션 UUID이며 브라우저가 지정할 수 없습니다. Gateway만 내장 service role로 `osi_staff_resident_service(p_site_id uuid,p_actor_id text,p_service text,p_action text,p_payload jsonb)`를 호출합니다.

`osi_resident_centers`는 하나의 명시적으로 확인된 센터만 허용합니다. 초기 행은 생성하지 않습니다. DB 소유자가 근거를 남겨 연결하며 service_role도 이 표를 직접 조회·변경할 수 없습니다. 다른 단지 직원에게 기존 단일 센터 회원정보를 재사용하지 않습니다.

공용 직원 접속은 개인 신원을 증명하지 않습니다. 별도 `osi_resident_audit`에 `SITE_STAFF`와 세션 UUID를 기록하고 `actor_name`은 선택적인 자가 입력으로 구분합니다. 과거 Supabase 관리자 ID를 가장하지 않습니다.

## API

`POST /api/integration/staff/residents/:service/:action`의 JSON은 아래 payload입니다. 성공 응답은 `{ok:true,...}`이며 오류 코드 42501=403, 40001=409, P0002=404, 22023/P0001=400입니다. DB 진단·SQL은 사용자에게 전달하지 않습니다.

`member` 허용 action:

- `status({})`: `{status:{center_name,applications_enabled,requests_enabled,programs:[{program,ready}],message}}`. 계좌 정보는 포함하지 않습니다.
- `admin_list({entity,search?,status?,category_id?,location?,date_from?,date_to?,limit?,offset?,member_id?,id?})`: `{items,total,limit,offset}`. `limit` 1–100(기본 50). entity는 applications, requests, profiles, passes, products, gx_classes, categories, admins, audit, posts. passes/audit는 대상 member_id 또는 id가 필요합니다.
- `admin_detail({entity,id})`: entity applications, requests, profiles, posts. item에 필요한 member, passes, history, staff_history를 포함합니다. 신청에는 `expected_period:{start,end}`와 비밀을 제외한 연결 guest_submission이 있습니다.
- `admin_action`: applications의 approve/hold/cancel/assign_seat/external_done, profiles의 verify, requests의 update만 허용합니다. 기존 계약의 금액·기간·정원·환불 검증을 유지합니다. verify는 `identity_confirmed:true`가 필요합니다. approve는 actual_amount, paid_at, expected_start_date, expected_end_date를 명시합니다.
- `admin_save({entity:'posts',data})`: 기존 게시판 필드만 사용합니다. 게시할 때 `preview_confirmed:true`가 필요하며 수정에는 data.expected_updated_at을 넣습니다. 가격·계좌·약관·양식 변경은 허용하지 않습니다.
- `photo({entity,id,kind,index})`: requests photo/action, applications signature, posts photo/before/after. SQL이 정확한 부모 참조를 확인하고 Edge가 private Storage에서 `{photo:{mime,base64}}`로 변환합니다. 기존 jpeg 확장자도 열람합니다.
- `admin_upload_photo({entity:'requests'|'posts',id,purpose:'action'|'photo',mime,base64})`: 먼저 저장된 부모가 필요합니다. 최대 512KiB JPEG/PNG/WebP. SQL은 `osi_resident_uploads`에 site/actor/parent/hash를 연결하여 `{upload:true,photo:{bucket,path,mime,bytes}}`를 반환합니다. Edge만 고정 private bucket에 업로드하고 UI에는 photo.path를 돌려줍니다. 같은 내용은 같은 path를 사용합니다. 부모의 updated_at은 바뀌지 않습니다.

`guest` 허용 action과 응답은 기존 계약의 admin_list, admin_detail, admin_create_member, admin_match, admin_convert, admin_action(hold/cancel), admin_update_request, admin_upload_photo, photo입니다. admin_match에 `identity_confirmed:true`가 필요합니다. 아직 최종 제출하지 않은 draft는 직원 목록·상세·사진에서 제외합니다.

모든 행 변경에 현재 `expected_updated_at`이 필요합니다. 예외는 새 게시글, 사진 업로드 및 이미 완료된 동일 회원생성·수납전환·결제승인 재시도입니다. 사진 업로드 후 기존 편집 버전을 유지할 수 있습니다. 최상위 `actor_name`은 모든 요청에서 선택적으로 허용합니다.

건의 답변은 원래 접수 조회에서만 보이며, 내부 메모는 별도 비공개 표에 남습니다. 건의를 공개 게시글로 자동 변환하지 않습니다. 사진은 같은 부모의 기존 참조 또는 같은 부모의 검증된 업로드만 저장할 수 있습니다. Storage 업로드 후 참조 저장 전에 실패하면 비공개 미연결 객체가 남을 수 있으며 자동 삭제하지 않습니다.

## SQL 변경과 검증

CLI로 생성한 `supabase/migrations/20261103225932_staff_resident_service.sql`은 독립 실행 가능합니다. `scripts/build-resident-migration.mjs`가 원본 두 RPC에서 검토한 업무 로직을 private schema에 복사하고 setup/wrapper 소스와 합칩니다. private schema 및 내부 함수는 PUBLIC/anon/authenticated/service_role 권한을 모두 회수하고, 공개 wrapper만 service_role에 실행 권한을 줍니다. 원본 prosrc 정규화 MD5가 다르면 적용을 중단합니다.

기존 ms_payments.confirmed_by, ms_request_notes.created_by, ms_guest_notes.created_by의 Auth FK와 기존 값은 유지합니다. staff_actor_id를 추가하고 NOT NULL을 `Auth actor 또는 staff actor 필수` CHECK로 대체합니다. 직원 행은 트리거가 wrapper의 검증된 세션을 기록하며, 기존 관리자 작성은 Auth ID를 그대로 기록합니다. 다른 ms_* 표·기존 운영표의 필드와 설정을 일괄 수정하지 않습니다.

`node tests/resident-service.mjs`는 새 로컬 PostgreSQL 55442에서 가짜 자료만 사용합니다. 두 번 적용·모든 원래 ms_* 필드 해시·기존 함수 해시 보존, 역할/센터/위조 차단, 비밀키 제거, 버전 충돌, 회원 확인·전환·결제 재시도, 금액/기간/정원/대기순서, 유상 취소와 과거 Auth 작성, 사진 부모 연결 및 공지 공개/철회를 검사합니다. 결과는 무시되는 `work/resident-service-results.json`에 저장합니다.

## 적용과 되돌리기

1. 원본 함수 해시·권한, 영향 테이블 스키마·건수·원래 필드 해시와 비공개 백업을 확보합니다. 실제 접수/결제/사진을 테스트 자료로 복사하거나 공개 저장소에 저장하지 않습니다.
2. 격리 DB 검증과 API/브라우저 검증 후 소유자 권한으로 생성된 migration을 한 트랜잭션에 적용합니다. 기존 setup.sql, member-service.sql, guest-service.sql을 운영에 다시 실행하지 않습니다.
3. 운영자 검증 후 기존 센터의 정확한 canonical site UUID만 osi_resident_centers에 enabled=true와 근거로 등록합니다. frontend 배포가 DB 연결을 자동 추정하지 않습니다.
4. 기능 철회는 Worker 접근 차단과 `osi_resident_centers.enabled=false`로 즉시 수행합니다. 기존 공개 접수 및 과거 RPC는 그대로 유지합니다. 처리된 결제·이용권·답변·감사 및 사진을 삭제하지 않습니다.
5. 직원 작성 행이 생긴 후 원래 NOT NULL을 무조건 복원하거나 추가 열을 삭제하지 않습니다. 새 직원 출처를 보존할 별도 검토가 필요합니다. 소유자만 사용하는 private executors와 연결 비활성화 상태를 유지하는 것이 비파괴 rollback입니다.
