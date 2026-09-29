import type { Db } from "@/server/booking/hold";

export interface CalendarDay {
  date: string;
  available: boolean;   // 이 날 "밤"을 예약할 수 있는가 (지난 날짜·예약 가능 기간 밖 포함)
  price: number;        // 그 날 1박 객실 요금
  dayType: "weekday" | "weekend";
  isPeak: boolean;
  minNights: number;
}

/**
 * 월별 달력. stay_dates 행이 아직 없는 날짜도 "예약 가능"으로 계산한다
 * (재고 행을 미리 채우는 크론이 멈춰도 달력이 틀리지 않게).
 * 만료된 임시 점유는 빈 날로 보고, 공개 API에서는 held/booked/blocked 를 구분하지 않는다.
 */
export async function getMonthCalendar(db: Db, month: string): Promise<CalendarDay[]> {
  const { rows } = await db.query<{
    date: string; available: boolean; price: number; refund_tier: string;
    day_type: "weekday" | "weekend"; min_nights: number;
  }>(
    `with p as (
       select ($1::text || '-01')::date as f,
              (now() at time zone 'Asia/Seoul')::date as today,
              (select value::int from policy_settings where key = 'booking_open_days') as open_days
     )
     select (p.f + g.i)::text as date,
            ( (p.f + g.i) >= p.today
              and (p.f + g.i) <= p.today + p.open_days
              and ( sd.status is null
                    or sd.status = 'available'
                    or (sd.status = 'held' and sd.held_until <= now()) )
            ) as available,
            r.price, r.refund_tier, r.day_type, r.min_nights
       from p
      cross join generate_series(0, ((p.f + interval '1 month')::date - p.f) - 1) as g(i)
       left join stay_dates sd on sd.date = p.f + g.i
      cross join lateral resolve_night(p.f + g.i) r
      order by g.i`,
    [month],
  );
  return rows.map((r) => ({
    date: r.date,
    available: r.available,
    price: r.price,
    dayType: r.day_type,
    isPeak: r.refund_tier === "peak",
    minNights: r.min_nights,
  }));
}

/** [checkIn, checkOut) 의 모든 밤이 지금 비어 있는가 (잠금 없는 미리보기용) */
export async function isRangeAvailable(db: Db, checkIn: string, checkOut: string): Promise<boolean> {
  const { rows } = await db.query<{ blocked: string }>(
    `select count(*) as blocked from stay_dates
      where date >= $1::date and date < $2::date
        and not (status = 'available' or (status = 'held' and held_until <= now()))`,
    [checkIn, checkOut],
  );
  return Number(rows[0].blocked) === 0;
}

/** 같은 전화번호로 진행 중인 임시 점유 수 (날짜 선점 남용 방지) */
export async function countActiveHolds(db: Db, phoneHash: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from bookings
      where guest_phone_hash = $1
        and status in ('held', 'pending_payment')
        and hold_expires_at > now()`,
    [phoneHash],
  );
  return Number(rows[0].n);
}
