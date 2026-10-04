-- 알림(문자·이메일) 발송 대기열 + 체크인 안내문 설정 (이미 만들어 둔 DB에 적용. 여러 번 실행해도 안전)
--   docker compose cp db/migrations/002_notifications.sql db:/tmp/m2.sql
--   docker compose exec db psql -U hanok -d hanok      -v ON_ERROR_STOP=1 -f /tmp/m2.sql
--   docker compose exec db psql -U hanok -d hanok_test -v ON_ERROR_STOP=1 -f /tmp/m2.sql
begin;

create table if not exists notifications (
  id            bigint generated always as identity primary key,
  kind          text not null,                                   -- booking_confirmed, checkin_reminder ...
  audience      text not null check (audience in ('guest', 'owner')),
  channel       text not null check (channel in ('sms', 'email')),
  booking_id    uuid references bookings(id) on delete set null,
  recipient_enc text,                                            -- 손님 연락처(암호화). 사장님 알림은 환경변수 연락처를 쓰므로 null
  subject       text,
  body          text not null,
  dedupe_key    text not null unique,                            -- 같은 알림이 두 번 만들어지지 않게 한다
  status        text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts      integer not null default 0,
  last_error    text,
  scheduled_at  timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_notifications_due on notifications (status, scheduled_at);
create index if not exists idx_notifications_booking on notifications (booking_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_notifications_updated') then
    create trigger trg_notifications_updated before update on notifications for each row execute function set_updated_at();
  end if;
end $$;

insert into policy_settings (key, value, description) values
  ('checkin_guide', '', '체크인 전날 안내 문자에 덧붙는 출입 방법·주차 안내 (예: 대문 비밀번호는 입실 당일 안내)')
on conflict (key) do nothing;

commit;
