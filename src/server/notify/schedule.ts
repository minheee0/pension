import type { Pool } from "pg";
import { notify } from "./enqueue";
import { notifyMode } from "./mode";

/**
 * 시간이 정해진 알림을 만든다 (크론으로 주기적으로 실행. 여러 번 실행해도 같은 알림은 한 번만 만들어진다).
 *  - 체크인 전날 안내: 내일 체크인인 '예약 확정' 건 → 오늘 17:00(KST)부터 발송
 *  - 후기 요청: 체크아웃이 지난 '이용 완료' 건(최근 3일) 중 후기가 없는 건 → 12:00(KST)부터 발송
 */
export async function scheduleReminders(pool: Pool) {
  if (notifyMode() !== "all") return { checkinReminders: 0, reviewRequests: 0, disabled: true };   // 체크인 안내·후기 요청은 모두 손님 알림
  const today = (await pool.query(`select (now() at time zone 'Asia/Seoul')::date::text as d`)).rows[0].d as string;
  const at = (hhmm: string) => { const d = new Date(`${today}T${hhmm}:00+09:00`); return Date.now() >= d.getTime() ? undefined : d; };

  const ci = await pool.query(`select id from bookings where status = 'confirmed' and check_in = $1::date + 1`, [today]);
  for (const r of ci.rows) await notify(pool, { type: "checkin_reminder", bookingId: r.id, scheduledAt: at("17:00") });

  const rv = await pool.query(
    `select b.id from bookings b
      where b.status = 'completed' and b.check_out between $1::date - 3 and $1::date - 1
        and not exists (select 1 from reviews r where r.booking_id = b.id)`, [today]);
  for (const r of rv.rows) await notify(pool, { type: "review_request", bookingId: r.id, scheduledAt: at("12:00") });

  return { checkinReminders: ci.rowCount ?? 0, reviewRequests: rv.rowCount ?? 0 };
}
