-- 약관 동의 버전 기록 + 개인정보 파기(비식별화) 표시 컬럼 (이미 만들어 둔 DB에 적용. 여러 번 실행해도 안전)
--   docker compose cp db/migrations/003_legal_consent.sql db:/tmp/m3.sql
--   docker compose exec db psql -U hanok -d hanok      -v ON_ERROR_STOP=1 -f /tmp/m3.sql
--   docker compose exec db psql -U hanok -d hanok_test -v ON_ERROR_STOP=1 -f /tmp/m3.sql
begin;

alter table bookings
  add column if not exists terms_version   text,          -- 예약 당시 동의한 이용약관 버전
  add column if not exists privacy_version text,          -- 예약 당시 안내받은 개인정보처리방침 버전
  add column if not exists anonymized_at   timestamptz;   -- 보유기간이 지나 개인정보를 파기(비식별화)한 시각

create index if not exists idx_bookings_purge on bookings (status, created_at) where anonymized_at is null;

commit;
