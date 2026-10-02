/**
 * 고객 예약 조회 · 취소 · 환불
 *
 * 순서(중요): ① DB에서 예약 취소 + 재고 해제 + refunds 행 기록(한 트랜잭션) → ② 토스 취소 호출
 *  - 토스 호출이 실패해도 예약은 이미 취소·재고 해제되고, refunds 가 manual_needed 로 남아 나중에 재시도한다.
 *  - 재시도는 같은 멱등키(refund-<id>)를 쓰므로 환불이 두 번 나가지 않는다.
 *  - 잠금 순서: payments → stay_dates → bookings
 * 예외: 가상계좌 "입금 전" 취소는 돈이 오가지 않으므로 토스에서 계좌부터 닫고(실패하면 취소 거절) DB를 취소한다.
 *       계좌가 열린 채 예약만 취소되면 나중에 입금될 위험이 있기 때문이다.
 * 가상계좌 "입금 후" 환불은 환불 받을 계좌가 필요하다(암호화 저장, 환불 완료 시 삭제).
 */
import type { Pool } from "pg";
import { cancelStay, withTx, type Db } from "@/server/booking/hold";
import { verifyBooking, type BookingRow } from "@/server/booking/lookup";
import { decryptText, encryptText } from "@/server/crypto";
import { PaymentError } from "@/server/payments/errors";
import { reconcileByOrderId } from "@/server/payments/service";
import { createTossClient, TossApiError, type TossClient } from "@/server/payments/toss";
import { calcRefund, kstDate, refundInputFromBooking, RefundPolicyError, type RefundLine } from "@/server/refund/calc";

export interface RefundAccount { bank: string; accountNumber: string; holderName: string }
export interface CancelAssessment {
  allowed: boolean;
  reason?: string;
  expectedRefund: number;
  refundAccountRequired: boolean;   // 가상계좌로 결제했고 환불할 금액이 있으면 true
  preview: null | { daysBefore: number; lines: RefundLine[]; totalAmount: number; deductTotal: number; refundTotal: number };
}
interface PaidPayment { id: number; amount: number; pg_payment_key: string | null; method: string | null }

export interface AssessOptions { cause?: "guest" | "host"; allowAfterStart?: boolean }
export function assessCancel(row: Pick<BookingRow, "status" | "check_in" | "discount_amount" | "extra_guest_fee" | "created_at" | "price_snapshot" | "policy_snapshot">,
  pay: PaidPayment | null, now: Date, opts: AssessOptions = {}): CancelAssessment {
  const no = (reason: string): CancelAssessment => ({ allowed: false, reason, expectedRefund: 0, refundAccountRequired: false, preview: null });
  if (!["held", "pending_payment", "confirmed"].includes(row.status)) return no("이미 취소되었거나 취소할 수 없는 상태의 예약입니다");
  if (!opts.allowAfterStart && kstDate(now) > row.check_in) return no("이용이 시작된 예약은 온라인으로 취소할 수 없습니다. 문의해 주세요");
  if (row.status !== "confirmed" || !pay) return { allowed: true, expectedRefund: 0, refundAccountRequired: false, preview: null };   // 결제·입금 전 예약: 환불할 금액 없음
  try {
    const r = calcRefund(refundInputFromBooking(row as any, { now, cause: opts.cause ?? "guest", paidAmount: pay.amount }));
    return { allowed: true, expectedRefund: r.refundTotal, refundAccountRequired: pay.method === "가상계좌" && r.refundTotal > 0,
      preview: { daysBefore: r.daysBefore, lines: r.lines, totalAmount: r.totalAmount, deductTotal: r.deductTotal, refundTotal: r.refundTotal } };
  } catch (e) {
    if (e instanceof RefundPolicyError) return no("자동으로 환불 금액을 계산할 수 없는 예약입니다. 문의해 주세요");
    throw e;
  }
}

async function paidPayment(db: Db, bookingId: string, forUpdate = false): Promise<PaidPayment | null> {
  const r = await db.query(
    `select id, amount, pg_payment_key, method from payments
      where booking_id = $1 and kind = 'booking' and status = 'paid' order by id desc limit 1 ${forUpdate ? "for update" : ""}`, [bookingId]);
  return r.rows[0] ?? null;
}

/** 조회 화면용: 예약 요약 + 결제 상태(가상계좌 입금 안내, 영수증) + 취소 가능 여부와 환불 미리보기 */
export async function lookupBooking(pool: Pool, input: { bookingNo: string; phone: string; ip: string }, now = new Date(), toss?: TossClient) {
  let row = await verifyBooking(pool, input.bookingNo, input.phone, input.ip);
  if (row.status === "pending_payment") {
    // 입금 대기 중이면 토스의 실제 상태를 한 번 확인해 반영한다. 웹훅을 놓쳤거나(또는 웹훅이 오지 않는 로컬 환경) 입금이 화면에 바로 안 보이는 일을 막는다.
    const wp = (await pool.query(
      `select pg_order_id from payments where booking_id = $1 and status = 'waiting_deposit' order by id desc limit 1`, [row.id])).rows[0];
    if (wp) {
      try {
        await reconcileByOrderId(pool, wp.pg_order_id, toss ?? createTossClient());
        row = await verifyBooking(pool, input.bookingNo, input.phone, input.ip);
      } catch (e) {
        console.warn("[lookup] 입금 상태 확인 실패 — 저장된 상태로 표시합니다", e);
      }
    }
  }
  const pay = await paidPayment(pool, row.id);
  const last = (await pool.query(
    `select status, method, amount, paid_at, virtual_account,
            raw_response->'receipt'->>'url' as receipt_url, raw_response->'cashReceipt'->>'receiptUrl' as cash_receipt_url
       from payments where booking_id = $1 and kind = 'booking' and status in ('paid','partial_cancelled','cancelled','waiting_deposit')
      order by id desc limit 1`, [row.id])).rows[0] ?? null;
  const refund = (await pool.query(`select amount, deduct_amount, status from refunds where booking_id = $1 order by id desc limit 1`, [row.id])).rows[0] ?? null;
  const va = last?.virtual_account;
  return {
    booking: {
      bookingNo: row.booking_no, status: row.status, guestName: row.guest_name, phoneLast4: row.guest_phone_last4,
      checkIn: row.check_in, checkOut: row.check_out, nights: row.nights, guests: row.guests,
      roomTotal: row.room_total, extraGuestFee: row.extra_guest_fee, optionTotal: row.option_total, totalAmount: row.total_amount,
      options: ((row.price_snapshot?.options ?? []) as any[]).map((o) => ({ name: o.name, qty: o.qty, amount: o.amount, useDate: o.useDate, useTime: o.useTime })),
      createdAt: row.created_at,
    },
    payment: last && {
      status: last.status, method: last.method, amount: last.amount, paidAt: last.paid_at,
      receiptUrl: last.receipt_url, cashReceiptUrl: last.cash_receipt_url,
      virtualAccount: va && last.status === "waiting_deposit"
        ? { bankCode: va.bankCode, accountNumber: va.accountNumber, holderName: va.holderName, dueDate: va.dueDate } : null,
    },
    refund: refund && { amount: refund.amount, deductAmount: refund.deduct_amount, status: refund.status },
    cancel: assessCancel(row, pay, now),
  };
}

/** 고객 취소. expectedRefund = 화면에서 고객이 확인한 환불 금액 (시간이 지나 금액이 바뀌었으면 거절하고 다시 확인받는다) */
export async function cancelBooking(
  pool: Pool,
  input: { bookingNo: string; phone: string; expectedRefund: number; refundAccount?: RefundAccount; ip: string },
  toss: TossClient = createTossClient(),
) {
  const row = await verifyBooking(pool, input.bookingNo, input.phone, input.ip);
  return executeCancel(pool, row, { expectedRefund: input.expectedRefund, refundAccount: input.refundAccount, cause: "guest", by: "guest" }, toss);
}

export interface ExecuteCancelInput {
  expectedRefund: number;
  refundAccount?: RefundAccount;
  cause: "guest" | "host";            // guest = 환불 규정 적용, host = 사업자 사정(전액 환불)
  by: "guest" | "admin";
  allowAfterStart?: boolean;          // 관리자는 이용 시작 이후에도 취소 가능
}

/** 고객·관리자 공용 취소 실행. (본인 확인/권한 확인은 호출자가 끝낸 상태) */
export async function executeCancel(pool: Pool, row: BookingRow, input: ExecuteCancelInput, toss: TossClient = createTossClient()) {
  const reason = input.by === "guest" ? "고객 요청 취소" : input.cause === "host" ? "사업자 사정 취소(전액 환불)" : "관리자 취소(환불 규정 적용)";
  const opts: AssessOptions = { cause: input.cause, allowAfterStart: input.allowAfterStart };

  // 가상계좌 입금 전: 토스에서 계좌부터 닫는다
  if (row.status === "pending_payment") {
    const wp = (await pool.query(
      `select id, pg_payment_key from payments where booking_id = $1 and status = 'waiting_deposit' order by id desc limit 1`, [row.id])).rows[0];
    if (wp?.pg_payment_key) {
      try {
        await toss.cancel(wp.pg_payment_key, { cancelReason: `${reason}(입금 전)` }, `va-cancel-${wp.id}`);
      } catch (e) {
        if (!(e instanceof TossApiError)) throw e;
        throw new PaymentError("UNVERIFIED", "가상계좌를 닫지 못했습니다. 방금 입금되었다면 잠시 후 예약 상태를 다시 확인해 주세요", 502);
      }
    }
  }

  const tx = await withTx(pool, async (c) => {
    const pay = await paidPayment(c, row.id, true);                                   // ① payments 잠금
    const fresh = (await c.query(`select status from bookings where id = $1`, [row.id])).rows[0].status as string;
    const assess = assessCancel({ ...row, status: fresh }, pay, new Date(), opts);
    if (!assess.allowed) throw new PaymentError("NOT_CANCELLABLE", assess.reason!, 409);
    if (assess.expectedRefund !== input.expectedRefund) {
      throw new PaymentError("REFUND_CHANGED", "시간이 지나 환불 금액이 달라졌습니다. 금액을 다시 확인해 주세요", 409, { cancel: assess });
    }
    if (assess.refundAccountRequired && !input.refundAccount) {
      throw new PaymentError("REFUND_ACCOUNT_REQUIRED", "가상계좌로 결제하셔서 환불받을 계좌 정보가 필요합니다", 400, { cancel: assess });
    }
    await cancelStay(c, row.id, { by: input.by, reason });                           // ② stay_dates → bookings
    await c.query(`update payments set status = 'cancelled' where booking_id = $1 and status = 'waiting_deposit'`, [row.id]);
    let refundId: number | null = null;
    if (pay && assess.preview) {
      const ins = await c.query(
        `insert into refunds (booking_id, payment_id, amount, deduct_amount, breakdown, reason, status, refund_account_enc)
         values ($1, $2, $3, $4, $5::jsonb, $6, 'requested', $7) returning id`,
        [row.id, pay.id, assess.preview.refundTotal, assess.preview.deductTotal,
         JSON.stringify({ daysBefore: assess.preview.daysBefore, lines: assess.preview.lines }), reason,
         assess.refundAccountRequired && input.refundAccount ? encryptText(JSON.stringify(input.refundAccount)) : null]);
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
    `select r.id, r.status, r.amount, r.reason, r.refund_account_enc, p.id as payment_id, p.amount as paid, p.pg_payment_key, p.method
       from refunds r join payments p on p.id = r.payment_id where r.id = $1`, [refundId]);
  const r = rows[0];
  if (!r) return false;
  if (r.status === "done") return true;
  try {
    if (r.amount === 0) {                                        // 환불할 금액이 없는 취소(전액 공제)
      await pool.query(`update refunds set status = 'done', refunded_at = now(), refund_account_enc = null where id = $1`, [r.id]);
      return true;
    }
    if (!r.pg_payment_key) throw new Error("pg_payment_key 없음");
    const full = r.amount === r.paid;
    let refundReceiveAccount: { bank: string; accountNumber: string; holderName: string } | undefined;
    if (r.method === "가상계좌") {
      if (!r.refund_account_enc) throw new Error("가상계좌 환불 계좌 정보 없음");
      refundReceiveAccount = JSON.parse(decryptText(r.refund_account_enc));
    }
    const t = await toss.cancel(r.pg_payment_key,
      { cancelReason: r.reason ?? "고객 요청 취소", ...(full ? {} : { cancelAmount: r.amount }), ...(refundReceiveAccount ? { refundReceiveAccount } : {}) },
      `refund-${r.id}`);
    const last = t.cancels?.[t.cancels.length - 1];
    await pool.query(`update refunds set status = 'done', refunded_at = now(), pg_cancel_key = $2, refund_account_enc = null where id = $1`, [r.id, last?.transactionKey ?? null]);
    await pool.query(`update payments set status = $2 where id = $1`, [r.payment_id, full ? "cancelled" : "partial_cancelled"]);
    if (full) await pool.query(`update cash_receipts set status = 'cancelled', cancelled_at = now() where payment_id = $1`, [r.payment_id]);   // 토스가 연동 현금영수증도 자동 취소
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
