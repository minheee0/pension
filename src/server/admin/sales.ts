import type { Db } from "@/server/booking/hold";

/**
 * 월별 매출 집계 (한국시간 기준). 대시보드 카드의 숫자와 [매출 내역] 화면의 목록이 같은 조건을 쓰도록 한 곳에서 계산한다.
 *  - 결제 금액: 그 달에 결제된 금액 (나중에 환불된 건도 포함 = 총 결제액)
 *  - 환불 금액: 그 달에 환불이 '완료'된 금액 (지난달 결제분의 환불도 포함)
 *  - 순매출   : 결제 금액 − 환불 금액
 *  - 예약된 박 수: 그 달에 걸쳐 있는 '예약 확정' 상태의 밤 수 (이용이 끝난 박도 포함)
 */
export const MONTH_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
const PAID_STATUSES = `('paid','partial_cancelled','cancelled')`;

export async function kstMonth(db: Db): Promise<string> {
  return (await db.query(`select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') as m`)).rows[0].m as string;
}

export async function monthTotals(db: Db, month: string) {
  const [pay, ref, nights] = await Promise.all([
    db.query(`select coalesce(sum(amount), 0)::bigint as n, count(*)::int as c from payments
               where status in ${PAID_STATUSES} and paid_at is not null and to_char(paid_at at time zone 'Asia/Seoul', 'YYYY-MM') = $1`, [month]),
    db.query(`select coalesce(sum(amount), 0)::bigint as n, count(*)::int as c from refunds
               where status = 'done' and refunded_at is not null and to_char(refunded_at at time zone 'Asia/Seoul', 'YYYY-MM') = $1`, [month]),
    db.query(`select count(*)::int as n from stay_dates where status = 'booked' and to_char(date, 'YYYY-MM') = $1`, [month]),
  ]);
  const paid = Number(pay.rows[0].n), refunded = Number(ref.rows[0].n);
  return { paid, paidCount: pay.rows[0].c as number, refunded, refundedCount: ref.rows[0].c as number, net: paid - refunded, bookedNights: nights.rows[0].n as number };
}

export type SalesTab = "payments" | "refunds" | "net" | "nights";

export async function getSales(db: Db, month: string, tab: SalesTab) {
  const totals = await monthTotals(db, month);
  const payments = tab === "payments" || tab === "net" ? (await db.query(
    `select p.id::int as id, p.paid_at as at, p.amount, p.status, p.method, b.booking_no, b.guest_name
       from payments p join bookings b on b.id = p.booking_id
      where p.status in ${PAID_STATUSES} and p.paid_at is not null and to_char(p.paid_at at time zone 'Asia/Seoul', 'YYYY-MM') = $1
      order by p.paid_at desc limit 500`, [month])).rows : [];
  const refunds = tab === "refunds" || tab === "net" ? (await db.query(
    `select r.id::int as id, r.refunded_at as at, r.amount, r.deduct_amount, r.reason, b.booking_no, b.guest_name
       from refunds r join bookings b on b.id = r.booking_id
      where r.status = 'done' and r.refunded_at is not null and to_char(r.refunded_at at time zone 'Asia/Seoul', 'YYYY-MM') = $1
      order by r.refunded_at desc limit 500`, [month])).rows : [];
  const nights = tab === "nights" ? (await db.query(
    `select s.date::text as date, b.booking_no, b.guest_name, b.status, bn.price
       from stay_dates s join bookings b on b.id = s.booking_id left join booking_nights bn on bn.booking_id = b.id and bn.date = s.date
      where s.status = 'booked' and to_char(s.date, 'YYYY-MM') = $1 order by s.date`, [month])).rows : [];
  return { month, totals, payments, refunds, nights };
}
