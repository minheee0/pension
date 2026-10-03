-- 후기 신고 테이블 추가 (이미 만들어 둔 DB에 적용하는 마이그레이션). 여러 번 실행해도 안전합니다.
--   docker compose cp db/migrations/001_review_reports.sql db:/tmp/m1.sql
--   docker compose exec db psql -U hanok -d hanok      -v ON_ERROR_STOP=1 -f /tmp/m1.sql
--   docker compose exec db psql -U hanok -d hanok_test -v ON_ERROR_STOP=1 -f /tmp/m1.sql
begin;

create table if not exists review_reports (
  id         bigint generated always as identity primary key,
  review_id  bigint not null references reviews(id) on delete cascade,
  reason     text not null check (reason in ('abuse', 'false', 'privacy', 'spam', 'other')),
  detail     text check (char_length(detail) <= 300),
  ip         inet,
  created_at timestamptz not null default now()
);
-- 같은 IP 가 같은 후기를 반복 신고해 신고 수를 부풀리는 것을 막는다
create unique index if not exists uq_review_reports_ip on review_reports (review_id, ip) where ip is not null;
create index if not exists idx_review_reports_review on review_reports (review_id);
create index if not exists idx_reviews_status_created on reviews (status, created_at desc);

commit;
