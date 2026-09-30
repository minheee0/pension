-- ============================================================
-- 만복 요금 설정
--  1) 아래 숫자를 고치고 저장합니다.
--  2) 프로젝트 폴더에서 이 두 줄을 실행하면 DB에 적용됩니다.
--       docker compose cp db/prices.sql db:/tmp/prices.sql
--       docker compose exec db psql -U hanok -d hanok -v ON_ERROR_STOP=1 -f /tmp/prices.sql
--  * 새 예약부터 적용됩니다. 이미 만들어진 예약의 금액은 바뀌지 않습니다.
--  * 중간에 오류가 나면 전부 취소되어 기존 값이 그대로 유지됩니다.
-- ============================================================
begin;

-- 1) 기본 요금 (1박, 기준 4명) ------------------------------
update base_prices set price = 1000 where day_type = 'weekday';   -- 평일(일~목 밤)
update base_prices set price = 1500 where day_type = 'weekend';   -- 주말(금·토 밤)

-- 2) 추가 인원 1인당 요금 (1회 숙박당 1회) ---------------------
--    ※ 화면 안내 문구는 src/lib/site.ts 의 extraPersonFee 이므로 그 값도 같이 바꿔 주세요.
update policy_settings set value = '10000' where key = 'extra_person_fee';

-- 3) 유료 옵션 (active = false 로 두면 예약 화면에 나오지 않습니다) ----
update options set price = 40000, active = true where code = 'bbq';     -- 바비큐
update options set price = 30000, active = true where code = 'sauna';   -- 찜질방

-- 4) 성수기 ---------------------------------------------------
--    ★ 이 파일이 기준입니다. 실행하면 기존 성수기 등록을 모두 지우고 아래 내용으로 바꿉니다.
--    쓰려는 줄 앞의 "-- " 를 지우면 됩니다. 각 줄은 쉼표(,)로 끝나야 하고,
--    맨 아래 '__none__' 줄은 지우지 마세요.
--    형식: ('이름', '시작일', '종료일(포함)', 평일요금, 주말요금, 최소숙박일)
delete from season_periods;
insert into season_periods (name, date_from, date_to, price_weekday, price_weekend, min_nights) values
  -- ('여름 성수기', '2027-07-15', '2027-08-24', 700000, 800000, 2),
  -- ('겨울 성수기', '2026-12-20', '2027-02-20', 700000, 800000, 2),
  ('__none__', '2000-01-01', '2000-01-01', 0, 0, 1);   -- 지우지 마세요
delete from season_periods where name = '__none__';

-- 5) 특정일 요금 (명절·연휴 등, 성수기보다 우선) ---------------
--    사용법은 위와 같습니다. 형식: ('날짜'::date, 요금, 최소숙박일, '메모')
delete from date_overrides;
insert into date_overrides (date, price, day_type, refund_tier, min_nights, memo)
select d, p, 'weekend', 'peak', m, memo from (values
  -- ('2027-02-07'::date, 900000, 2, '설 연휴'),
  -- ('2027-09-16'::date, 900000, 2, '추석 연휴'),
  ('2000-01-01'::date, 0, 1, '__none__')   -- 지우지 마세요
) as t(d, p, m, memo)
where memo <> '__none__';

commit;

-- 적용 결과 확인
select day_type, price from base_prices order by day_type desc;
select code, price, active from options order by sort_order;
select name, date_from, date_to, price_weekday, price_weekend, min_nights from season_periods order by date_from;
