# 비로그인 회원 접수 API

기존 `member_service`와 관리자 승인 규칙은 유지합니다. 회원용 새 화면은 Auth 로그인·가입·초대 없이 `guest_service`를 사용합니다. 공개 공지·상품·약관·신청서 설정은 기존 `member_service('public_home', {})`를 그대로 읽습니다.

프로그램별 양식·약관·서명 및 현금 처리의 최신 세부 계약은 [프로그램별 신청서 계약](program-forms-contract.md)을 따릅니다.

`supabase.rpc('guest_service', {action, payload})` 응답은 `{ok:true,...}` 또는 `{ok:false,error}`입니다. HTTP 오류와 `ok:false`를 모두 실패로 처리합니다. 실패·오프라인에서 접수 완료를 표시하지 않습니다. 인증키·개인정보를 URL, QR, localStorage, 분석로그에 넣지 않습니다.

## 비로그인 접수

1. 화면에 신청서와 운영 준비 안내를 표시합니다. 실제 운영 설정 전에는 제출을 비활성화합니다. 서버도 기존 `applications_enabled` 또는 `requests_enabled`와 개인정보 목적·항목·보유기간 및 승인된 개인정보 안내를 검사합니다.
2. 개인정보 동의와 연락처를 입력한 뒤 `prepare`를 호출합니다. 이때 아직 이름·동호수·사진은 서버에 저장하지 않습니다. 연락처는 한도 검사에 필요한 해시만 저장합니다.
3. 반환한 ticket와 확인키를 메모리에 보관하고 필요한 사진을 업로드합니다. 최종 제출 성공 전에는 접수 완료로 표시하지 않습니다.
4. 최종 제출 성공 후 접수번호·확인키를 보여 주고 사용자가 별도로 저장하도록 합니다. 키는 20분 준비기간이 끝나도 최종 접수된 건의 조회에 계속 사용됩니다. 키 분실 시 이름·연락처만으로 온라인 복구하거나 기존 회원정보를 노출하지 않습니다.

### prepare

입력: `{kind:'application'|'request',program:'fitness_golf'|'gx',phone,consents:[termId],honeypot:''}`. 신청은 프로그램을 고정하며 건의는 항상 `common`입니다.

출력: `{ticket_id,receipt_no,receipt_key,expires_at,program}`. 확인키는 DB에서 생성한 256비트 무작위 64자리 소문자 hex이며 해시만 저장합니다. 응답을 잃으면 새 준비 요청이 필요하지만 최종 제출은 같은 ticket으로 재시도하면 중복 생성되지 않습니다. 준비 유효시간은 20분입니다.

### upload_photo

입력: `{ticket_id,receipt_key,mime,base64,purpose:'photo'|'signature',replace_photo_id?}`

출력: `{photo:{id,mime,bytes,purpose}}`.

- JPEG/PNG/WebP만 허용합니다. 브라우저에서 실제 이미지 디코딩·리사이즈·EXIF 제거 후 보내며 서버는 크기와 파일 헤더를 확인합니다.
- 사진 1장 최대 512 KiB, 요청 사진은 운영자 `photo_limit`과 3장 중 작은 수까지, 서명은 1장입니다.
- 이미지는 전용 비공개 DB 테이블에 저장됩니다. 공개 Storage 경로나 서비스 키는 사용하지 않습니다.
- 전체 익명 접수 사진 보관량은 원본 바이트 합계 50 MiB가 상한입니다. 초과 시 사진 없이 접수하거나 안내데스크에 문의하도록 안내합니다. 기존 접수 자료를 자동 삭제하지 않습니다.
- 동일 내용 업로드는 기존 사진 ID를 반환합니다. 최종 접수 전에는 같은 ticket·같은 종류의 `replace_photo_id`를 지정하여 첨부 교체·서명 재작성이 가능합니다. 최종 접수 후 업로드·교체는 차단됩니다.

### submit_application

입력:

```js
{
  ticket_id, receipt_key,
  profile: {name, building, unit, phone},
  kind: 'new' | 'renewal',
  product_id, // product_id 또는 gx_class_id 중 하나
  gx_class_id,
  payment_method: 'cash' | 'card' | 'transfer',
  payer_name, desired_start_date,
  consents: [termId], form_values: {},
  signature_photo_id, student_name, guardian_consent,
  expected_amount, expected_catalog_updated_at, expected_form_id
}
```

출력: `{receipt,duplicate?}`. 금액·일수·규정·신청서 버전은 서버에서 읽고 화면에 표시했던 expected 값과 다르면 거절합니다. 신청 당시 상품·규정 원문·폼을 보존하며 이후 카탈로그 변경으로 덮어쓰지 않습니다. 제출자가 보낸 승인상태·금액·회원 ID는 사용하지 않습니다.

재등록 화면은 기존 회원정보나 기존 이용권을 조회하지 않습니다. 최종 기간은 직원의 현장 확인과 실제 결제 확인 후 기존 이용권을 고려하여 확정합니다.

GX는 접수 직후 `reservation_status:'unassigned'`이며 자리 확보·입금 안내를 하지 않습니다. 직원이 직접 회원을 확인·연결하고 `admin_convert`를 실행할 때 DB 잠금 아래 자리 또는 대기 순서를 배정합니다. 이후 결제·최종 이용권 처리는 기존 규칙을 따릅니다.

### submit_request

입력: `{ticket_id,receipt_key,profile:{name,building,unit,phone},category_id,title,body,location?,item_name?,quantity?,photo_ids:[],consents:[privacyTermId]}`

출력: `{receipt,duplicate?}`. 요청에도 접수 당시 개인정보 동의 원문·버전·시각이 보관됩니다. 동일 연락처의 기존 회원을 검색하거나 자동 연결하지 않습니다.

### receipt / payment_report / photo

- `receipt({receipt_no,receipt_key})` → `{receipt}`. UUID인 `ticket_id`도 내부 흐름에서 사용할 수 있으나 사용자 조회 화면은 접수번호+확인키를 요구합니다.
- `payment_report({receipt_no,receipt_key,payer_name?})` → `{receipt}`. 본인의 계좌이체 신청에 `reported`만 기록합니다. 결제확인·이용권 생성은 하지 않습니다. GX 미배정·대기·만료·취소 및 보류 상태는 거절합니다.
- `photo({receipt_no,receipt_key,photo_id})` → `{photo:{id,mime,base64}}`. 해당 접수에서 선택된 본문·조치 사진 또는 본인 서명만 반환합니다. 브라우저 Blob URL로 표시하고 화면 전환 시 해제합니다.

`receipt` 구조:

```js
{
  ticket_id, receipt_no, kind, program, status, intake_status,
  profile_snapshot, // 작성자가 입력한 정보만
  application,     // 변환 전에도 상품/금액/결제/접수상태를 포함
  request,         // 제목/내용/분류/상태/공개답변/사진 ID
  photos: [{id,mime,bytes,purpose}],
  settings, created_at, submitted_at
}
```

`application`은 `product_snapshot`, `amount`, `kind`, `payment_method`, `payer_name`, `desired_start_date`, `proposed_start_date`, `proposed_end_date`, `application_status`, `payment_status`, `pass_status`, `external_status`, `reservation_status`, 규정/폼 스냅샷 등을 포함합니다. 직원 처리 후에는 같은 접수에 연결된 기존 신청의 처리 결과를 반환합니다. 실제 회원 ID·기존 회원정보·이전 이용기간·다른 신청은 반환하지 않습니다. 은행·계좌·예금주는 본인 신청 중 계좌이체가 가능한 상태에서만 포함합니다.

## 관리자 API

모든 `admin_*` 액션 및 관리자 사진 열람은 기존 `app_admins` 승인 검사로 제한합니다. 일반 로그인이 관리자 권한을 만들지 않습니다.

- `admin_list({entity:'applications'|'requests',search?,status?})` → `{items}`. 임시 ticket은 제외하고 최대 1000건을 반환합니다.
- `admin_detail({id})` → `{item}`. 사진 메타데이터, `internal_notes`, `history`, 연결된 `linked_application`을 포함합니다. 키 해시는 관리자 응답에도 제외합니다.
- `admin_create_member({id})` → `{item,profile}`. 접수 입력값으로 **미승인** 프로필만 만듭니다. Auth 계정을 만들지 않으며 자동 현장확인·회원연결은 하지 않습니다. 재시도해도 같은 임시 프로필을 반환합니다.
- 기존 `member_service('admin_action',{entity:'profiles',id,operation:'verify'})`로 현장확인을 기록합니다.
- `admin_match({id,member_id})` → `{item}`. 직원이 직접 선택한 확인·승인·활성 회원만 연결합니다. 이름·전화번호가 같아도 자동 병합하지 않습니다.
- `admin_convert({id})` → `{item,application,duplicate?}`. 명시적 연결 후에만 기존 `ms_applications`로 변환합니다. `submitted_by:null`과 고유 `guest_submission_id`로 원래 제출자가 계정 없는 방문자였음을 보존하며 관리자에게 제출 행위를 잘못 귀속시키지 않습니다. 변환은 여러 번 요청해도 한 번입니다. 결제승인·이용권 반영은 별도 기존 관리자 액션입니다.
- `admin_action({id,operation:'hold'|'cancel',note})` → `{item}`. 변환 전 접수에만 적용합니다. 변환 후 보류·취소·환불확인 등은 기존 신청·수납 기능을 사용합니다.
- `admin_update_request({id,status,reply,internal_note?,assignee?,action_photo_ids?})` → `{item}`. 내부 메모는 별도 비공개 테이블에 저장합니다. 반영 어려움 상태는 답변이 필수입니다.
- `admin_upload_photo({id,mime,base64,purpose:'action'})` → `{photo}`. 같은 요청의 조치사진을 최대 3장 추가합니다. 회원 접수가 중단되어도 기존 업무 처리를 위한 관리자 업로드는 가능합니다.
- `photo({photo_id})`는 승인된 관리자에게 해당 비공개 사진을 반환합니다.

관리자 item 주요 필드: `id`(ticket ID), `receipt_no`, `kind`, `status`, `profile_snapshot`, `application_payload`, `request_payload`, `amount`, `product_snapshot`, `consents_snapshot`, `photo_ids`, `action_photo_ids`, `created_profile_id`, `matched_member_id`, `linked_application_id`, `reply`, `assignee`, `created_at`, `submitted_at`, `updated_at`. 확인키와 연락처 해시는 제외합니다.

신청 접수상태: `received`, `needs_review`, `cancelled`, `converted`. 건의 상태: `received`, `reviewing`, `in_progress`, `completed`, `needs_info`, `held`, `declined`.

변환 시 현재 판매 중단된 기간권은 차단합니다. 활성 상품의 이름·금액·일수가 바뀌었어도 이미 수락한 신청의 원래 스냅샷으로만 처리합니다. GX 일정이 신청 후 변경되면 직원에게 회원 안내 후 재접수를 요구합니다. 이 동작은 가격·기간을 말없이 바꾸지 않기 위한 제한입니다.

## 데이터·한도·배포

`supabase/guest-service.sql`은 기존 회원서비스 마이그레이션 이후 실행합니다. 새 private 테이블은 `ms_guest_submissions`, `ms_guest_photos`, `ms_guest_notes`, `ms_guest_limits` 네 개이며 직접 클라이언트 조회·변경 권한이 없습니다. 기존 신청 테이블에는 고유 guest 참조를 추가하고 제출자의 Auth FK를 nullable로 바꾸되 Auth 제출자 또는 guest 참조 중 하나가 반드시 있도록 CHECK 제약을 둡니다.

비로그인 액션은 고정 allowlist와 시간당 전체 1200회, 준비 요청 전체 시간당 100회/일 300회 및 연락처 해시당 시간당 5회/일 20회 한도를 적용합니다. 전달된 IP 헤더나 휴대폰 입력을 본인인증으로 신뢰하지 않습니다. 허니팟은 보조 장치이며 유료 CAPTCHA·문자·메일 서비스를 추가하지 않습니다. 의도적인 분산 남용을 완전히 판별하는 장치는 아니므로 한도에 도달하면 정상 접수도 잠시 차단될 수 있습니다. 파일 저장량은 50 MiB에서 실패하도록 설계되어 있습니다.

실제 운영의 접수 스위치·약관·상품 활성화는 이 마이그레이션이 변경하지 않습니다. 현재 사용자 선택은 **화면·배포 먼저 완료하고 관리자 설정 후 접수 시작**입니다. 운영 DB에 시험용 회원·결제·민원을 만들지 않으며 자동화 검증은 `node tests/guest-service.mjs`의 격리 PostgreSQL에서 실행합니다.
