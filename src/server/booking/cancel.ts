/**
 * 고객 예약 조회 · 취소 · 환불
 *
 * 순서(중요): ① DB에서 예약 취소 + 재고 해제 + refunds 행 기록(한 트랜잭션) → ② 토스 취소 호출
 *  - 토스 호출이 실패해도 예약은 이미 취소·재고 해제되고, refunds 가 manual_needed 로 남아 나중에 재시도한다.
 *  - 재시도는 같은 멱등키(refund-<id>)를 쓰므로 환불이 두 번 나가지 않는다.
 *  - 잠금 순서: payments → stay_dates → bookings
 */
import type { Pool } from "pg";
import { cancelStay, withTx, type Db } from "@/server/booking/hold";
import { verifyBooking, type BookingRow } from "@/server/booking/lookup";
import { PaymentError } from "@/server/payments/errors";
import { createTossClient, type TossClient } from "@/server/payments/toss";
import { calcRefund, kstDate, refundInputFromBooking, RefundPolicyError, type RefundLine } from "@/server/refund/calc";

export interface CancelAssessment {
  allowed: boolean;
  reason?: string;
  expectedRefund: number;
  preview: null | { daysBefore: number; lines: RefundLine[]; totalAmount: number; deductTotal: number; refundTotal: number };
}
interface PaidPayment { id: number; amount: number; pg_payment_key: string | null }

export function assessCancel(row: Pick<BookingRow, "status" | "check_in" | "discount_amount" | "extra_guest_fee" | "created_at" | "price_snapshot" | "policy_snapshot">,
  pay: PaidPayment | null, now: Date): CancelAssessment {
  const no = (reason: string): CancelAssessment => ({ allowed: false, reason, expectedRefund: 0, preview: null });
  if (!["held", "pending_payment", "confirmed"].includes(row.status)) return no("이미 취소되었거나 취소할 수 없는 상태의 예약입니다");
  if (kstDate(now) > row.check_in) return no("이용이 시작된 예약은 온라인으로 취소할 수 없습니다. 문의해 주세요");
  if (row.status !== "confirmed" || !pay) return { allowed: true, expectedRefund: 0, preview: null };   // 결제 전 예약: 환불할 금액 없음
  try {
    const r = calcRefund(refundInputFromBooking(row as any, { now, cause: "guest", paidAmount: pay.amount }));
    return { allowed: true, expectedRefund: r.refundTotal,
      preview: { daysBefore: r.daysBefore, lines: r.lines, totalAmount: r.totalAmount, deductTotal: r.deductTotal, refundTotal: r.refundTotal } };
  } catch (e) {
    if (e instanceof RefundPolicyError) return no("자동으로 환불 금액을 계산할 수 없는 예약입니다. 문의해 주세요");
    throw e;
  }
}

async function paidPayment(db: Db, bookingId: string, forUpdate = false): Promise<PaidPayment | null> {
  const r = await db.query(
    `select id, amount, pg_payment_key from payments
      where booking_id = $1 and kind = 'booking' and status = 'paid' order by id desc limit 1 ${forUpdate ? "for update" : ""}`, [bookingId]);
  return r.rows[0] ?? null;
}

/** 조회 화면용: 예약 요약 + 결제 상태 + 취소 가능 여부와 환불 미리보기 */
export async function lookupBooking(pool: Pool, input: { bookingNo: string; phone: string; ip: string }, now = new Date()) {
  const row = await verifyBooking(pool, input.bookingNo, input.phone, input.ip);
  const pay = await paidPayment(pool, row.id);
  const last = (await pool.query(
    `select status, method, amount, paid_at, raw_response->'receipt'->>'url' as receipt_url
       from payments where booking_id = $1 and kind = 'booking' and status in ('paid','partial_cancelled','cancelled')
      order by id desc limit 1`, [row.id])).rows[0] ?? null;
  const refund = (await pool.query(`select amount, deduct_amount, status from refunds where booking_id = $1 order by id desc limit 1`, [row.id])).rows[0] ?? null;
  return {
    booking: {
      bookingNo: row.booking_no, status: row.status, guestName: row.guest_name, phoneLast4: row.guest_phone_last4,
      checkIn: row.check_in, checkOut: row.check_out, nights: row.nights, guests: row.guests,
      roomTotal: row.room_total, extraGuestFee: row.extra_guest_fee, optionTotal: row.option_total, totalAmount: row.total_amount,
      options: ((row.price_snapshot?.options ?? []) as any[]).map((o) => ({ name: o.name, qty: o.qty, amount: o.amount, useDate: o.useDate, useTime: o.useTime })),
      createdAt: row.created_at,
    },
    payment: last && { status: last.status, method: last.method, amount: last.amount, paidAt: last.paid_at, receiptUrl: last.receipt_url },
    refund: refund && { amount: refund.amount, deductAmount: refund.deduct_amount, status: refund.status },
    cancel: assessCancel(row, pay, now),
  };
}

/** 고객 취소. expectedRefund = 화면에서 고객이 확인한 환불 금액 (시간이 지나 금액이 바뀌었으면 거절하고 다시 확인받는다) */
export async function cancelBooking(
  pool: Pool,
  input: { bookingNo: string; phone: string; expectedRefund: number; ip: string },
  toss: TossClient = createTossClient(),
) {
  const row = await verifyBooking(pool, input.bookingNo, input.phone, input.ip);

  const tx = await withTx(pool, async (c) => {
    const pay = await paidPayment(c, row.id, true);                                   // ① payments 잠금
    const fresh = (await c.query(`select status from bookings where id = $1`, [row.id])).rows[0].status as string;
    const assess = assessCancel({ ...row, status: fresh }, pay, new Date());
    if (!assess.allowed) throw new PaymentError("NOT_CANCELLABLE", assess.reason!, 409);
    if (assess.expectedRefund !== input.expectedRefund) {
      throw new PaymentError("REFUND_CHANGED", "시간이 지나 환불 금액이 달라졌습니다. 금액을 다시 확인해 주세요", 409, { cancel: assess });
    }
    await cancelStay(c, row.id, { by: "guest", reason: "고객 요청 취소" });             // ② stay_dates → bookings
    let refundId: number | null = null;
    if (pay && assess.preview) {
      const ins = await c.query(
        `insert into refunds (booking_id, payment_id, amount, deduct_amount, breakdown, reason, status)
         values ($1, $2, $3, $4, $5::jsonb, $6, 'requested') returning id`,
        [row.id, pay.id, assess.preview.refundTotal, assess.preview.deductTotal,
         JSON.stringify({ daysBefore: assess.preview.daysBefore, lines: assess.preview.lines }), "고객 요청 취소"]);
      refundId = ins.rows[0].id;
    }
    return { refundId, assess };
  });

  let refundDone: boolean | null = null;
  if (tx.refundId) refundDone = await processRefund(pool, tx.refundId, toss);
  return {
    status: "cancelled" as const,
    refund: tx.assess.preview && {
      amount: tx.assess.preview.refundTotal, deductAmount: tx.assess.preview.deductTotal,
      lines: tx.assess.preview.lines, done: refundDone,
    },
  };
}

/** refunds 한 건을 토스에 반영한다. 몇 번 호출해도 안전(멱등). 성공 여부 반환 */
export async function processRefund(pool: Pool, refundId: number, toss: TossClient = createTossClient()): Promise<boolean> {
  const { rows } = await pool.query(
    `select r.id, r.status, r.amount, r.reason, p.id as payment_id, p.amount as paid, p.pg_payment_key
       from refunds r join payments p on p.id = r.payment_id where r.id = $1`, [refundId]);
  const r = rows[0];
  if (!r) return false;
  if (r.status === "done") return true;
  try {
    if (r.amount === 0) {                                        // 환불할 금액이 없는 취소(전액 공제)
      await pool.query(`update refunds set status = 'done', refunded_at = now() where id = $1`, [r.id]);
      return true;
    }
    if (!r.pg_payment_key) throw new Error("pg_payment_key 없음");
    const full = r.amount === r.paid;
    const t = await toss.cancel(r.pg_payment_key,
      { cancelReason: r.reason ?? "고객 요청 취소", ...(full ? {} : { cancelAmount: r.amount }) }, `refund-${r.id}`);
    const last = t.cancels?.[t.cancels.length - 1];
    await pool.query(`update refunds set status = 'done', refunded_at = now(), pg_cancel_key = $2 where id = $1`, [r.id, last?.transactionKey ?? null]);
    await pool.query(`update payments set status = $2 where id = $1`, [r.payment_id, full ? "cancelled" : "partial_cancelled"]);
    return true;
  } catch (e) {
    await pool.query(`update refunds set status = 'manual_needed' where id = $1`, [r.id]);
    console.error(`[ALERT] 환불 실패 — 재시도 필요 refund=${r.id} payment=${r.payment_id}`, e);
    return false;
  }
}

/** 아직 끝나지 않은 환불을 다시 시도한다 (수동 실행 또는 크론) */
export async function retryPendingRefunds(pool: Pool, toss: TossClient = createTossClient()) {
  const { rows } = await pool.query(
    `select id from refunds where status in ('requested', 'manual_needed') and requested_at < now() - interval '1 minute' order by id`);
  const results: { id: number; ok: boolean }[] = [];
  for (const r of rows) results.push({ id: r.id, ok: await processRefund(pool, r.id, toss) });
  return results;
}
