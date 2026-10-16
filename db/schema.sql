-- ============================================================
-- 한옥 독채 펜션 DB 스키마 (PostgreSQL 14+)
-- 실행: psql "$DATABASE_URL" -f schema.sql
--
-- 설계 원칙
--  1) 독채 1개 → 재고는 stay_dates(날짜당 1행). 그 행이 곧 "잠금 대상"이다.
--  2) 요금·성수기·환불표는 전부 데이터(설정값). 코드에 금액을 박지 않는다.
--  3) 예약 시점의 요금·규정은 bookings/booking_nights에 스냅샷으로 저장한다.
--  4) 1박 = 그날 밤. 숙박일은 [check_in, check_out) 이다.
--     (체크아웃 12:00 / 체크인 16:00 이라 같은 날 퇴실-입실 교차 가능)
--  5) 개인정보(전화번호 등)는 앱에서 암호화한 값만 저장한다(_enc).
-- ============================================================

begin;

-- ---------- 공통 ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- 1. 정책·요금 설정
-- ============================================================
create table policy_settings (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

insert into policy_settings (key, value, description) values
  ('check_in_time',               '16:00',    '체크인 시각'),
  ('check_out_time',              '12:00',    '체크아웃 시각'),
  ('weekend_days',                'FRI,SAT',  '주말로 보는 "박"의 요일(그날 밤 기준). MON..SUN 콤마 구분'),
  ('base_guests',                 '4',        '기준 인원'),
  ('max_guests',                  '6',        '최대 인원(36개월 미만 제외)'),
  ('extra_person_fee',            '10000',    '추가 인원 1인당 요금'),
  ('extra_fee_mode',              'per_stay', 'per_stay(1회 숙박당 1회) | per_night(박당)'),
  ('infant_excluded_months',      '36',       '이 개월 수 미만은 인원에서 제외'),
  ('hold_minutes',                '15',       '결제 진입 시 임시 점유 시간(분)'),
  ('virtual_account_due_minutes', '120',      '가상계좌 입금 기한(분). 이 시간 동안 날짜가 점유됨'),
  ('booking_open_days',           '365',      '오늘부터 며칠 뒤까지 예약 가능한지'),
  ('no_show_deadline_time',       '22:00',    '체크인 당일 이 시각까지 연락 없으면 노쇼(당일 취소) 처리'),
  ('free_change_days_off',        '7',        '비수기 무료 날짜 변경 가능 기한(체크인 N일 전)'),
  ('free_change_days_peak',       '14',       '성수기 무료 날짜 변경 가능 기한(체크인 N일 전)'),
  ('member_review_days',          '30',       '체크아웃 후 후기 작성 가능 일수'),
  ('checkin_guide',               '',         '체크인 전날 안내 문자에 덧붙는 출입 방법·주차 안내');

-- 기본 요금 (평일/주말). 값은 가정치 → 관리자에서 수정
create table base_prices (
  day_type text primary key check (day_type in ('weekday', 'weekend')),
  price    integer not null check (price >= 0)
);
insert into base_prices values ('weekday', 600000), ('weekend', 650000);

-- 성수기 기간. 이 한 건이 "요금 + 환불 등급 + 최소 숙박일"을 함께 결정한다.
create table season_periods (
  id            bigint generated always as identity primary key,
  name          text not null,
  date_from     date not null,
  date_to       date not null,            -- 포함(inclusive)
  price_weekday integer not null check (price_weekday >= 0),
  price_weekend integer not null check (price_weekend >= 0),
  min_nights    integer not null default 1 check (min_nights >= 1),
  refund_tier   text not null default 'peak' check (refund_tier in ('off', 'peak')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (date_to >= date_from),
  -- 활성 성수기 기간끼리 겹치면 요금 결정이 모호해지므로 DB에서 차단
  constraint season_no_overlap
    exclude using gist (daterange(date_from, date_to, '[]') with &&) where (active)
);

-- 특정일 지정가(명절·연휴 등). 성수기보다 우선
create table date_overrides (
  date        date primary key,
  price       integer not null check (price >= 0),
  day_type    text not null default 'weekend' check (day_type in ('weekday', 'weekend')),
  refund_tier text not null default 'peak' check (refund_tier in ('off', 'peak')),
  min_nights  integer not null default 1 check (min_nights >= 1),
  memo        text
);

-- 환불(공제) 규정. days_before_min = "체크인 N일 이상 전"이면 적용
-- 조회 예:
--   select deduct_rate from refund_policies
--    where applies_to='room' and tier=$1 and day_type=$2 and days_before_min <= $3
--    order by days_before_min desc limit 1;
create table refund_policies (
  id              bigint generated always as identity primary key,
  applies_to      text not null default 'room' check (applies_to in ('room', 'option')),
  tier            text not null check (tier in ('off', 'peak')),
  day_type        text not null check (day_type in ('weekday', 'weekend')),
  days_before_min integer not null check (days_before_min >= 0),
  deduct_rate     integer not null check (deduct_rate between 0 and 100),
  unique (applies_to, tier, day_type, days_before_min)
);

-- ★ 초안 수치(제안값). 오픈 전 소비자분쟁해결기준 원문과 대조 후 확정할 것.
--   당일 공제 상한: 비수기 주중20/주말30, 성수기 주중80/주말90
insert into refund_policies (tier, day_type, days_before_min, deduct_rate) values
  ('off',  'weekday', 10, 0), ('off',  'weekday', 7, 0),  ('off',  'weekday', 5, 0),
  ('off',  'weekday', 3, 10), ('off',  'weekday', 1, 10), ('off',  'weekday', 0, 20),
  ('off',  'weekend', 10, 0), ('off',  'weekend', 7, 0),  ('off',  'weekend', 5, 10),
  ('off',  'weekend', 3, 20), ('off',  'weekend', 1, 20), ('off',  'weekend', 0, 30),
  ('peak', 'weekday', 10, 0), ('peak', 'weekday', 7, 10), ('peak', 'weekday', 5, 30),
  ('peak', 'weekday', 3, 50), ('peak', 'weekday', 1, 70), ('peak', 'weekday', 0, 80),
  ('peak', 'weekend', 10, 0), ('peak', 'weekend', 7, 10), ('peak', 'weekend', 5, 30),
  ('peak', 'weekend', 3, 50), ('peak', 'weekend', 1, 80), ('peak', 'weekend', 0, 90);

-- 할인 규칙(현재 미정 → 0건이 정상). 앱에서 적용 로직을 구현하기 전까지 비워 둘 것
create table discount_rules (
  id             bigint generated always as identity primary key,
  name           text not null,
  min_nights     integer not null default 2 check (min_nights >= 1),
  discount_type  text not null check (discount_type in ('percent', 'fixed')),
  value          integer not null check (value > 0),
  stackable      boolean not null default false,
  active         boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ============================================================
-- 2. 유료 옵션 (바비큐, 찜질방)
-- ============================================================
create table options (
  id                         bigint generated always as identity primary key,
  code                       text not null unique,
  name                       text not null,
  description                text,
  price                      integer not null default 0 check (price >= 0),
  unit_type                  text not null default 'per_use'
                               check (unit_type in ('per_stay', 'per_night', 'per_person', 'per_use')),
  max_qty                    integer not null default 1 check (max_qty >= 1),
  time_slots                 text[] not null default '{}',  -- 예: {17:00,18:00}. 비어 있으면 시간 선택 없음
  -- 신청 마감: 이용일 N일 전 order_deadline_time 까지 (기본: 이용 전날 18:00)
  order_deadline_days_before integer not null default 1 check (order_deadline_days_before >= 0),
  order_deadline_time        time not null default '18:00',
  active                     boolean not null default false, -- 가격 확정 전까지 비활성
  sort_order                 integer not null default 0,
  updated_at                 timestamptz not null default now()
);

insert into options (code, name, description, unit_type, time_slots, sort_order) values
  ('bbq',  '바비큐',  '숯·그릴 포함, 팀 단위 1회', 'per_use', '{17:00,18:00,19:00,20:00}', 1),
  ('sauna','찜질방',  '팀 단위 1회(2시간), 예열 필요', 'per_use', '{19:00,21:00}',            2);

-- ============================================================
-- 3. 예약
-- ============================================================
create table bookings (
  id                 uuid primary key default gen_random_uuid(),
  booking_no         text not null unique,            -- 추측 불가 랜덤(앱 생성)
  status             text not null default 'held' check (status in (
                       'held',             -- 임시 점유(결제 진행 중)
                       'pending_payment',  -- 가상계좌 입금 대기
                       'confirmed',        -- 예약 확정
                       'completed',        -- 이용 완료
                       'cancelled',
                       'expired',          -- 점유 만료
                       'no_show')),
  guest_name         text not null,
  guest_phone_enc    text not null,                   -- 앱에서 암호화
  guest_phone_hash   text not null,                   -- 조회용 HMAC (복호화 없이 비교)
  guest_phone_last4  char(4) not null,
  guest_email        text,
  check_in           date not null,
  check_out          date not null,
  nights             integer generated always as (check_out - check_in) stored,
  guests             integer not null check (guests >= 1),
  room_total         integer not null check (room_total >= 0),
  extra_guest_fee    integer not null default 0 check (extra_guest_fee >= 0),
  option_total       integer not null default 0 check (option_total >= 0),
  discount_amount    integer not null default 0 check (discount_amount >= 0),
  total_amount       integer not null check (total_amount >= 0),
  hold_expires_at    timestamptz,
  policy_snapshot    jsonb not null,                  -- 예약 시점 환불표·설정
  price_snapshot     jsonb not null,                  -- 예약 시점 견적 전체
  request_memo       text,
  agreed_terms_at    timestamptz not null,            -- 환불규정 동의 시각
  terms_version      text,                            -- 예약 당시 동의한 이용약관 버전
  privacy_version    text,                            -- 예약 당시 안내받은 개인정보처리방침 버전
  anonymized_at      timestamptz,                     -- 보유기간 경과로 개인정보를 파기(비식별화)한 시각
  cancelled_at       timestamptz,
  cancel_reason      text,
  cancelled_by       text check (cancelled_by in ('guest', 'admin', 'system')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (check_out > check_in),
  check (total_amount = room_total + extra_guest_fee + option_total - discount_amount)
);
create index idx_bookings_purge on bookings (status, created_at) where anonymized_at is null;
create index idx_bookings_lookup   on bookings (booking_no, guest_phone_hash);
create index idx_bookings_status   on bookings (status, check_in);
create index idx_bookings_checkin  on bookings (check_in);

-- 박별 요금 스냅샷 (환불 계산·분쟁 대응용)
create table booking_nights (
  booking_id  uuid not null references bookings(id) on delete cascade,
  date        date not null,
  price       integer not null check (price >= 0),
  rule_applied text not null,                          -- override | season | weekend | base
  refund_tier text not null check (refund_tier in ('off', 'peak')),
  day_type    text not null check (day_type in ('weekday', 'weekend')),
  primary key (booking_id, date)
);

create table booking_options (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references bookings(id) on delete cascade,
  option_id   bigint not null references options(id),
  qty         integer not null check (qty >= 1),
  unit_price  integer not null check (unit_price >= 0),
  amount      integer not null check (amount >= 0),
  use_date    date,
  use_time    text,
  status      text not null default 'active' check (status in ('active', 'cancelled'))
);
create index idx_booking_options_booking on booking_options (booking_id);

-- ============================================================
-- 4. 재고 (핵심). 1박 = 1행.
--    예약 확정 여부와 무관하게 "이 행을 잠근 트랜잭션이 그 날의 주인"이다.
-- ============================================================
create table stay_dates (
  date        date primary key,
  status      text not null default 'available'
                check (status in ('available', 'held', 'booked', 'blocked')),
  booking_id  uuid references bookings(id),
  held_until  timestamptz,
  memo        text,                                     -- blocked 사유(수리·개인 사용 등)
  updated_at  timestamptz not null default now(),
  -- 상태와 컬럼 조합이 어긋나는 행은 아예 저장될 수 없게 한다
  constraint stay_dates_consistency check (
       (status = 'available' and booking_id is null     and held_until is null)
    or (status = 'held'      and booking_id is not null and held_until is not null)
    or (status = 'booked'    and booking_id is not null and held_until is null)
    or (status = 'blocked'   and booking_id is null     and held_until is null)
  )
);
create index idx_stay_dates_booking on stay_dates (booking_id);
create index idx_stay_dates_held    on stay_dates (held_until) where status = 'held';

-- 지정 범위(끝 제외)의 재고 행을 보장. 크론으로 미래 1년치를 미리 채워 둔다.
create or replace function ensure_stay_dates(p_from date, p_to date) returns integer
language sql as $$
  with ins as (
    insert into stay_dates (date)
    select p_from + g.i from generate_series(0, p_to - p_from - 1) as g(i)
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from ins
$$;

-- ============================================================
-- 5. 날짜별 요금 결정 (우선순위: 특정일 > 성수기 > 주말 > 평일)
-- ============================================================
create or replace function resolve_night(d date)
returns table (price integer, refund_tier text, day_type text, rule text, min_nights integer)
language plpgsql stable as $$
#variable_conflict use_column
declare
  wd       text[];
  dname    text;
  is_wknd  boolean;
  o        date_overrides%rowtype;
  s        season_periods%rowtype;
begin
  select string_to_array(upper(replace(value, ' ', '')), ',') into wd
    from policy_settings where key = 'weekend_days';
  dname   := (array['MON','TUE','WED','THU','FRI','SAT','SUN'])[extract(isodow from d)::int];
  is_wknd := dname = any (coalesce(wd, array['FRI','SAT']));

  select * into o from date_overrides where date_overrides.date = d;
  if found then
    return query select o.price, o.refund_tier, o.day_type, 'override'::text, o.min_nights;
    return;
  end if;

  select * into s from season_periods sp
   where sp.active and d between sp.date_from and sp.date_to limit 1;
  if found then
    return query select
      case when is_wknd then s.price_weekend else s.price_weekday end,
      s.refund_tier,
      case when is_wknd then 'weekend' else 'weekday' end,
      'season'::text,
      s.min_nights;
    return;
  end if;

  return query
    select bp.price, 'off'::text, bp.day_type,
           case when is_wknd then 'weekend' else 'base' end,
           1
      from base_prices bp
     where bp.day_type = case when is_wknd then 'weekend' else 'weekday' end;
end $$;

-- 달력 UI용: 만료된 임시 점유는 "예약 가능"으로 보여준다(크론이 늦어도 화면이 정확)
create view v_calendar as
select sd.date,
       case when sd.status = 'held' and sd.held_until <= now()
            then 'available' else sd.status end as effective_status,
       r.price, r.refund_tier, r.day_type, r.rule, r.min_nights
  from stay_dates sd
 cross join lateral resolve_night(sd.date) r;

-- ============================================================
-- 6. 결제 · 환불 · 현금영수증
-- ============================================================
create table payments (
  id                bigint generated always as identity primary key,
  booking_id        uuid not null references bookings(id),
  pg_provider       text not null,                      -- toss | portone ...
  pg_order_id       text not null unique,               -- 우리 쪽 주문번호
  pg_payment_key    text unique,                        -- PG 거래키
  kind              text not null default 'booking' check (kind in ('booking', 'change_extra')),
  method            text,                               -- card | easy_pay | virtual_account | transfer
  amount            integer not null check (amount > 0),
  status            text not null default 'ready' check (status in (
                      'ready', 'waiting_deposit', 'paid',
                      'partial_cancelled', 'cancelled', 'failed', 'expired')),
  virtual_account   jsonb,                              -- {bank, number, holder, due_at}
  paid_at           timestamptz,
  raw_response      jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_payments_booking on payments (booking_id);

-- 웹훅 멱등 처리: 같은 이벤트가 두 번 와도 한 번만 처리
create table payment_events (
  id          bigint generated always as identity primary key,
  provider    text not null,
  event_id    text not null,
  payload     jsonb not null,
  processed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (provider, event_id)
);

create table refunds (
  id               bigint generated always as identity primary key,
  booking_id       uuid not null references bookings(id),
  payment_id       bigint not null references payments(id),
  amount           integer not null check (amount >= 0),
  deduct_amount    integer not null default 0 check (deduct_amount >= 0),
  breakdown        jsonb,                               -- 박별·옵션별 공제 내역
  reason           text,
  status           text not null default 'requested'
                     check (status in ('requested', 'done', 'failed', 'manual_needed')),
  pg_cancel_key    text,
  refund_account_enc text,                              -- 가상계좌 환불용(암호화)
  requested_at     timestamptz not null default now(),
  refunded_at      timestamptz,
  updated_at       timestamptz not null default now()
);
create index idx_refunds_booking on refunds (booking_id);

create table cash_receipts (
  id             bigint generated always as identity primary key,
  payment_id     bigint not null references payments(id),
  type           text not null check (type in ('income', 'expense')),  -- 소득공제 | 지출증빙
  identifier_enc text not null,                          -- 휴대폰/사업자번호(암호화)
  receipt_no     text,
  status         text not null default 'requested'
                   check (status in ('requested', 'issued', 'cancelled', 'failed')),
  issued_at      timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_cash_receipts_payment on cash_receipts (payment_id);

-- 예약 변경 이력/요청 (MVP: 요청 → 사장님 승인)
create table booking_changes (
  id           bigint generated always as identity primary key,
  booking_id   uuid not null references bookings(id),
  kind         text not null check (kind in ('dates', 'guests', 'options')),
  before_data  jsonb not null,
  after_data   jsonb not null,
  diff_amount  integer not null default 0,               -- +추가결제 / -환불
  status       text not null default 'requested'
                 check (status in ('requested', 'approved', 'rejected', 'applied')),
  memo         text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- 7. 후기
-- ============================================================
create table reviews (
  id             bigint generated always as identity primary key,
  booking_id     uuid not null unique references bookings(id),   -- 1예약 1후기
  author_name    text not null,                                   -- 마스킹된 이름
  rating         smallint not null check (rating between 1 and 5),
  rating_details jsonb not null default '{}',                     -- 청결/시설/위치/분위기/응대
  content        text not null check (char_length(content) between 1 and 2000),
  images         text[] not null default '{}' check (coalesce(array_length(images, 1), 0) <= 5),
  status         text not null default 'visible' check (status in ('visible', 'hidden', 'reported')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table review_replies (
  id         bigint generated always as identity primary key,
  review_id  bigint not null unique references reviews(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- 후기 신고 (손님이 공개 목록에서 신고. 자동으로 숨기지 않고 관리자가 검토)
create table review_reports (
  id         bigint generated always as identity primary key,
  review_id  bigint not null references reviews(id) on delete cascade,
  reason     text not null check (reason in ('abuse', 'false', 'privacy', 'spam', 'other')),
  detail     text check (char_length(detail) <= 300),
  ip         inet,
  created_at timestamptz not null default now()
);
-- 같은 IP 가 같은 후기를 반복 신고해 신고 수를 부풀리는 것을 막는다
create unique index uq_review_reports_ip on review_reports (review_id, ip) where ip is not null;
create index idx_review_reports_review on review_reports (review_id);
create index idx_reviews_status_created on reviews (status, created_at desc);

-- DB 차원의 백스톱: 이용 완료된 예약만 후기 작성 가능
create or replace function reviews_require_completed() returns trigger
language plpgsql as $$
begin
  if (select status from bookings where id = new.booking_id) is distinct from 'completed' then
    raise exception 'review allowed only for completed bookings' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_reviews_require_completed
  before insert on reviews for each row execute function reviews_require_completed();

-- ============================================================
-- 8. 콘텐츠 · 운영
-- ============================================================
create table notices (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table faqs (
  id         bigint generated always as identity primary key,
  question   text not null,
  answer     text not null,
  sort_order integer not null default 0,
  published  boolean not null default true
);

create table admin_users (
  id            bigint generated always as identity primary key,
  email         text not null unique,
  password_hash text not null,
  name          text not null,
  role          text not null default 'staff' check (role in ('owner', 'staff')),
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create table audit_logs (
  id          bigint generated always as identity primary key,
  admin_id    bigint references admin_users(id),
  action      text not null,                              -- 예: price.update, booking.cancel
  target_type text,
  target_id   text,
  before_data jsonb,
  after_data  jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index idx_audit_logs_created on audit_logs (created_at desc);

-- 알림 발송 대기열: 이벤트가 생기면 먼저 여기에 기록하고, 별도 작업이 발송·재시도한다 (알림 실패가 결제를 막지 않게)
create table notifications (
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
create index idx_notifications_due on notifications (status, scheduled_at);
create index idx_notifications_booking on notifications (booking_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_notifications_updated') then
    create trigger trg_notifications_updated before update on notifications for each row execute function set_updated_at();
  end if;
end $$;

-- 비회원 예약 조회 무차별 대입 방지용 (IP·예약번호별 최근 시도 횟수로 제한)
create table lookup_attempts (
  id         bigint generated always as identity primary key,
  booking_no text,
  ip         inet,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index idx_lookup_attempts_ip on lookup_attempts (ip, created_at desc);
create index idx_lookup_attempts_no on lookup_attempts (booking_no, created_at desc);

-- ============================================================
-- 9. updated_at 트리거
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['policy_settings','options','bookings','stay_dates','payments',
                           'refunds','cash_receipts','booking_changes','reviews'] loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- 초기 재고: 오늘부터 400일치
select ensure_stay_dates(current_date, current_date + 400);

commit;

-- ============================================================
-- 운영 메모
--  * 크론(1분마다): release_expired_holds (booking-hold.ts의 releaseExpiredHolds)
--  * 크론(매일): ensure_stay_dates(current_date, current_date + 400)
--  * 크론(매일 12시 이후): 체크아웃 지난 confirmed → completed, 노쇼 처리
--  * 앱 DB 계정은 audit_logs / payment_events 에 UPDATE·DELETE 권한을 주지 않는 것을 권장
-- ============================================================
