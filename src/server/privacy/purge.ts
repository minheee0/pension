/**
 * 개인정보 파기: 보유기간이 지난 개인정보를 지운다(비식별화). 정기 작업(/api/cron/run)에서 호출하며 몇 번 실행해도 안전하다.
 * 보유기간은 src/lib/legal.ts 의 RETENTION — 개인정보처리방침에 적힌 숫자와 같은 값이다.
 *
 *  1) 결제가 한 번도 완료되지 않은 예약(결제 전 취소·점유 만료·입금 기한 만료): 만든 지 N일 후
 *  2) 결제가 완료된 예약: 이용 종료일(취소했다면 취소일) 후 5년 — 전자상거래법상 거래기록 보존기간이 끝난 뒤
 *     → 이름·연락처·이메일·요청사항을 지우고, 결제사 응답 원문·가상계좌 정보·남은 환불 계좌 정보도 지운다.
 *       (예약번호, 금액, 일정 같은 개인을 식별하지 않는 거래 통계는 남긴다. 후기는 가린 이름으로 남는다.)
 *  3) 예약 조회 시도 기록(IP 포함), 오래된 결제사 통지 원문 삭제
 */
import type { Pool } from "pg";
import { RETENTION } from "@/lib/legal";
import { withTx } from "@/server/booking/hold";

const BATCH = 500;

async function anonymize(pool: Pool, ids: string[]) {
  await withTx(pool, async (c) => {
    await c.query(
      `update bookings set guest_name = '(삭제됨)', guest_phone_enc = '', guest_phone_hash = 'purged:' || id::text, guest_phone_last4 = '----',
              guest_email = null, request_memo = null, anonymized_at = now()
        where id = any($1::uuid[]) and anonymized_at is null`, [ids]);
    await c.query(`update payments set raw_response = null, virtual_account = null where booking_id = any($1::uuid[])`, [ids]);
    await c.query(`update refunds set refund_account_enc = null where booking_id = any($1::uuid[])`, [ids]);
  });
}

async function purgeBatch(pool: Pool, where: string, args: unknown[]) {
  let total = 0;
  for (;;) {
    const { rows } = await pool.query(`select b.id from bookings b where b.anonymized_at is null and ${where} order by b.created_at limit ${BATCH}`, args);
    if (rows.length === 0) return total;
    await anonymize(pool, rows.map((r) => r.id));
    total += rows.length;
    if (rows.length < BATCH) return total;
  }
}

export async function purgePersonalData(pool: Pool) {
  const unpaidBookings = await purgeBatch(pool,
    `b.status in ('held', 'expired', 'cancelled') and b.created_at < now() - make_interval(days => $1::int)
     and not exists (select 1 from payments p where p.booking_id = b.id and p.paid_at is not null)`, [RETENTION.unpaidDays]);

  const paidBookings = await purgeBatch(pool,
    `b.status in ('confirmed', 'completed', 'cancelled', 'no_show')
     and exists (select 1 from payments p where p.booking_id = b.id and p.paid_at is not null)
     and greatest(b.check_out, coalesce((b.cancelled_at at time zone 'Asia/Seoul')::date, b.check_out))
         < (now() at time zone 'Asia/Seoul')::date - make_interval(years => $1::int)`, [RETENTION.bookingYears]);

  const logs = await pool.query(`delete from lookup_attempts where created_at < now() - make_interval(days => $1::int)`, [RETENTION.accessLogDays]);
  const events = await pool.query(`delete from payment_events where created_at < now() - make_interval(years => $1::int)`, [RETENTION.paymentEventYears]);
  return { unpaidBookings, paidBookings, accessLogs: logs.rowCount ?? 0, paymentEvents: events.rowCount ?? 0 };
}
