-- Source: center-supplied fitness/golf and GX DOCX forms, 2026-09-29.

-- Apply after program-forms.sql. Idempotent; never updates operator edits or collection switches.

-- Terms remain drafts because retention and GX operational values require administrator setup.

begin;

insert into public.ms_forms(id,program,title,fields,signature_mode,active,version)
select 'd0290929-0000-4000-8000-000000000001'::uuid,'fitness_golf','헬스·골프 이용신청서','[]'::jsonb,'always',true,1
where not exists(select 1 from public.ms_forms where program='fitness_golf')
on conflict(id) do nothing;

insert into public.ms_terms(id,program,kind,title,body,required,approved,active,version)
select 'd0290929-0000-4000-8000-000000000002'::uuid,'fitness_golf','rules','헬스·골프 이용신청서 이용규정','이용 안내
당 아파트 주민운동시설 운영규정을 준수해야 합니다. 입주민 전용시설이며 외부인은 이용할 수 없습니다.
개인 부주의로 인한 안전사고 등에 대하여 관리주체 및 피트니스에 책임이 없음을 안내합니다.
이용기간은 등록일을 기준으로 1개월(30일), 3개월(90일), 6개월(180일), 12개월(365일)로 적용됩니다. 정기 휴무일과 기타 휴관일(공휴일 포함)도 이용일수에 포함됩니다. 달력상의 날짜를 기준으로 산정하며 별도의 연장이나 보상은 제공하지 않습니다.

환불규정
총 등록금액에서 위약금 10%와 사용일만큼의 일할 금액을 공제합니다. 일할 계산은 1개월권 금액을 기준으로 합니다. 공제금액이 총 등록금액을 초과하는 경우 환불은 불가합니다.

이용 연기규정
1개월권: 연기 불가
3개월권: 7일, 최대 1회
6개월권: 14일, 최대 2회
12개월권: 30일, 최대 4회
연기 신청은 1회당 최소 7일 이상입니다.
이용을 잠시 중단하는 이용 연기는 안내데스크로 문의해 주세요. 02-826-8907

양도규정
해당 입주민에 한하여 양도할 수 있으며 총 등록금액의 10%에 해당하는 양도비가 발생합니다.',true,false,false,
coalesce((select max(version)+1 from public.ms_terms where program='fitness_golf' and kind='rules' and title='헬스·골프 이용신청서 이용규정'),1)
where not exists(select 1 from public.ms_terms where program='fitness_golf' and kind='rules')
on conflict(id) do nothing;

insert into public.ms_terms(id,program,kind,title,body,required,approved,active,version)
select 'd0290929-0000-4000-8000-000000000003'::uuid,'fitness_golf','privacy','헬스·골프 이용신청서 개인정보 수집·이용','힐스테이트 상도 센트럴파크 1단지 주민운동시설의 운영업체 (주)원스포츠는 이용 신청과 입주민 확인, 신청 처리 및 연락을 위해 아래 정보를 수집·이용합니다.

수집 항목: 신청자 이름, 동·호수, 연락처. 이용 신청 시 선택한 이용권 또는 GX 반, 신청 내용, 결제방식, 계좌이체 시 입금자명, 동의 및 서명 기록을 함께 보관합니다.

수집 목적: 입주민 및 신청자 확인, 이용 신청 처리, 결제 확인, 신청 관련 연락과 동의 기록 관리.

보유·이용기간: [관리자 설정 필요 — 보유기간을 확정한 후 접수를 시작합니다.]

개인정보 수집·이용에 동의하지 않을 권리가 있습니다. 필수 정보 수집·이용에 동의하지 않으면 온라인 이용 신청과 입주민 확인을 진행할 수 없습니다. 안내데스크로 문의해 주세요. 02-826-8907',true,false,false,
coalesce((select max(version)+1 from public.ms_terms where program='fitness_golf' and kind='privacy' and title='헬스·골프 이용신청서 개인정보 수집·이용'),1)
where not exists(select 1 from public.ms_terms where program='fitness_golf' and kind='privacy')
on conflict(id) do nothing;

insert into public.ms_forms(id,program,title,fields,signature_mode,active,version)
select 'd0290929-0000-4000-8000-000000000004'::uuid,'gx','GX 프로그램 신청서','[]'::jsonb,'always',true,1
where not exists(select 1 from public.ms_forms where program='gx')
on conflict(id) do nothing;

insert into public.ms_terms(id,program,kind,title,body,required,approved,active,version)
select 'd0290929-0000-4000-8000-000000000005'::uuid,'gx','rules','GX 프로그램 신청서 이용규정','수강 및 접수 조건
주민운동시설 운영규정 제3조(회원의 자격)에 따라 아파트 입주민 외 외부인은 주민운동시설을 사용할 수 없습니다. 대리 접수 또한 일체 금지됩니다.
모든 수업은 계약 만료일까지 소진해야 하며, 만료기간이 지난 계약내용은 보상받을 수 없습니다.
수업에 참여하는 회원 수에 따라 진행 여부가 결정되며, 인원 미달 시 폐강될 수 있습니다.

환불규정
개강 후 환불 시 위약금 10%와 등록금액을 기준으로 일할 계산한 사용금액을 차감한 후 환불합니다.

운동 상태 및 안전 동의
회원은 현재 운동할 수 있는 적절한 육체적·정신적 상태에 있으며 GX 수업을 받을 수 없는 의학적 이유나 건강 쇠약 또는 질병이 없음을 확인합니다.
강사는 GX 수업을 받기 위한 신체 상태와 능력에 관한 의학적 충고를 하지 않으며, 그러한 충고를 할 수 없습니다. 의학적인 우려나 질문이 있으면 강습 전에 전문의와 상담해야 합니다.
GX 수업 도중 부상의 위험이 있음을 인지합니다. 회원 부주의로 인해 신체·정신상의 상해나 경제적 손실 또는 손상이 발생하더라도 체육관과 강사에게 책임이 없다는 내용에 동의합니다.

약정 및 서명
약정서에 기재되지 않은 사항에 대해서 강사는 어떤 약속이나 책임을 지지 않으며, 이 약정서 이외의 구두 또는 서면 약정은 효력이 없습니다.
위 사용조건을 확인·수락하고 서명하여 사용을 신청합니다.',true,false,false,
coalesce((select max(version)+1 from public.ms_terms where program='gx' and kind='rules' and title='GX 프로그램 신청서 이용규정'),1)
where not exists(select 1 from public.ms_terms where program='gx' and kind='rules')
on conflict(id) do nothing;

insert into public.ms_terms(id,program,kind,title,body,required,approved,active,version)
select 'd0290929-0000-4000-8000-000000000006'::uuid,'gx','privacy','GX 프로그램 신청서 개인정보 수집·이용','힐스테이트 상도 센트럴파크 1단지 주민운동시설의 운영업체 (주)원스포츠는 이용 신청과 입주민 확인, 신청 처리 및 연락을 위해 아래 정보를 수집·이용합니다.

수집 항목: 신청자 이름, 동·호수, 연락처. 이용 신청 시 선택한 이용권 또는 GX 반, 신청 내용, 결제방식, 계좌이체 시 입금자명, 동의 및 서명 기록을 함께 보관합니다. 어린이 반 신청 시에는 수강생 이름과 보호자 동의 기록을 함께 보관합니다.

수집 목적: 입주민 및 신청자 확인, 이용 신청 처리, 결제 확인, 신청 관련 연락과 동의 기록 관리.

보유·이용기간: [관리자 설정 필요 — 보유기간을 확정한 후 접수를 시작합니다.]

개인정보 수집·이용에 동의하지 않을 권리가 있습니다. 필수 정보 수집·이용에 동의하지 않으면 온라인 이용 신청과 입주민 확인을 진행할 수 없습니다. 안내데스크로 문의해 주세요. 02-826-8907',true,false,false,
coalesce((select max(version)+1 from public.ms_terms where program='gx' and kind='privacy' and title='GX 프로그램 신청서 개인정보 수집·이용'),1)
where not exists(select 1 from public.ms_terms where program='gx' and kind='privacy')
on conflict(id) do nothing;

commit;
