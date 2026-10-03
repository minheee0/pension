import type { Pool } from "pg";
import { monthTotals } from "./sales";

/** 대시보드: 한국시간(KST) 기준 오늘/이번 달 */
export async function getDashboard(pool: Pool) {
  const today = (await pool.query(`select (now() at time zone 'Asia/Seoul')::date::text as d`)).rows[0].d as string;
  const month = today.slice(0, 7);
  const bk = `select booking_no, guest_name, guest_phone_last4::text as last4, check_in::text as check_in, check_out::text as check_out, nights, guests, total_amount, status`;
  const [ci, co, up, pend, refunds, fresh, totals, rv] = await Promise.all([
    pool.query(`${bk} from bookings where status = 'confirmed' and check_in = $1::date order by created_at`, [today]),
    pool.query(`${bk} from bookings where status in ('confirmed','completed') and check_out = $1::date order by created_at`, [today]),
    pool.query(`${bk} from bookings where status = 'confirmed' and check_in > $1::date and check_in <= $1::date + 7 order by check_in`, [today]),
    pool.query(`${bk}, hold_expires_at from bookings where status = 'pending_payment' order by hold_expires_at`),
    pool.query(`select r.id::int as id, r.amount, r.status, r.requested_at, b.booking_no from refunds r join bookings b on b.id = r.booking_id
                 where r.status in ('requested','manual_needed','failed') order by r.id`),
    pool.query(`select count(*)::int as n from bookings where created_at > now() - interval '24 hours' and status in ('confirmed','pending_payment')`),
    monthTotals(pool, month),
    pool.query(`select count(*) filter (where r.status = 'reported')::int as reported,
                       count(*) filter (where rp.id is null and r.status <> 'hidden')::int as needs_reply
                  from reviews r left join review_replies rp on rp.review_id = r.id`),
  ]);
  return {
    today, month,
    checkInsToday: ci.rows, checkOutsToday: co.rows, upcoming: up.rows, pendingDeposits: pend.rows,
    refundIssues: refunds.rows, newBookings24h: fresh.rows[0].n as number,
    reviewsReported: rv.rows[0].reported as number, reviewsNeedReply: rv.rows[0].needs_reply as number,
    monthPaid: totals.paid, monthRefunded: totals.refunded, monthNet: totals.net, monthBookedNights: totals.bookedNights,
  };
}
