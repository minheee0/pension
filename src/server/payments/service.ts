/**
 * 결제 서비스: 준비 → (결제창) → 승인 → 예약 확정 / 가상계좌 입금 대기, 웹훅 대사, 자동 환불
 *
 * 원칙
 *  1) 금액은 항상 DB(bookings.total_amount)가 기준. 브라우저가 보낸 amount 는 대조용일 뿐이다.
 *  2) 토스에서 돈이 승인됐다면(DONE) 어떤 경우에도 우리 DB에 기록한다. 예약을 확정할 수 없으면 즉시 자동 환불한다.
 *  3) 승인 응답이 유실돼도(5xx·타임아웃) 토스에 조회해서 실제 상태를 확인한다.
 *  4) 잠금 순서: payments → stay_dates → bookings (재고 코드의 순서와 맞춘다)
 *  5) 웹훅 본문은 믿지 않는다. 항상 토스에 다시 조회한 결과로만 상태를 바꾼다.
 *  6) 가상계좌: 계좌가 실제로 발급된 뒤에만 날짜를 입금 기한만큼 잡아 둔다(결제창만 열고 떠난 사람이 날짜를 오래 막지 못하게).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { cancelStay, confirmStay, extendHoldForVirtualAccount, StayError, withTx, type Db } from "@/server/booking/hold";
import { encryptText } from "@/server/crypto";
import { SITE } from "@/lib/site";
import { notify } from "@/server/notify/enqueue";
import { PaymentError } from "./errors";
import { createTossClient, TossApiError, type TossClient, type TossPayment } from "./toss";

export { PaymentError } from "./errors";
export type PayMethod = "CARD" | "VIRTUAL_ACCOUNT";

export interface BookingSummary {
  bookingNo: string; status: string; checkIn: string; checkOut: string;
  nights: number; guests: number; totalAmount: number;
}
export interface VirtualAccountInfo { bankCode: string; accountNumber: string; holderName: string | null; dueDate: string | null }
export type ConfirmOutcome =
  | { kind: "confirmed"; booking: BookingSummary; receiptUrl: string | null; already: boolean }
  | { kind: "waiting_deposit"; booking: BookingSummary; virtualAccount: VirtualAccountInfo; amount: number }
  | { kind: "unavailable"; booking: BookingSummary }
  | { kind: "refunded"; reason: "HOLD_LOST" | "CANCELLED" | "AMOUNT_MISMATCH"; refundOk: boolean; booking: BookingSummary }
  | { kind: "failed"; code: string; message: string };

interface PayRow {
  id: number; booking_id: string; booking_no: string; amount: number; status: string;
  pg_payment_key: string | null; method: string | null; virtual_account: any;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const kstLocalIso = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 19);   // yyyy-MM-dd'T'HH:mm:ss (KST)

async function loadByOrderId(db: Db, orderId: string): Promise<PayRow | null> {
  const { rows } = await db.query<PayRow>(
    `select p.id, p.booking_id, b.booking_no, p.amount, p.status, p.pg_payment_key, p.method, p.virtual_account
       from payments p join bookings b on b.id = p.booking_id
      where p.pg_order_id = $1 and p.pg_provider = 'toss'`, [orderId]);
  return rows[0] ?? null;
}

async function bookingSummary(db: Db, bookingId: string): Promise<BookingSummary> {
  const { rows } = await db.query(
    `select booking_no, status, check_in::text as check_in, check_out::text as check_out, nights, guests, total_amount
       from bookings where id = $1`, [bookingId]);
  const r = rows[0];
  return { bookingNo: r.booking_no, status: r.status, checkIn: r.check_in, checkOut: r.check_out,
    nights: r.nights, guests: r.guests, totalAmount: r.total_amount };
}

// ------------------------------------------------------------------
// 1) 결제 준비: 결제창을 열기 전에 서버가 주문번호·금액(·가상계좌 입금 기한)을 확정한다
// ------------------------------------------------------------------
export async function preparePayment(pool: Pool, bookingNo: string, method: PayMethod = "CARD") {
  const clientKey = process.env.TOSS_CLIENT_KEY;
  if (!clientKey) throw new Error("환경변수 TOSS_CLIENT_KEY 가 없습니다 (.env.local 확인)");

  const { rows } = await pool.query(
    `select b.id, b.status, b.total_amount, b.nights, b.check_in::text as check_in, b.check_out::text as check_out,
            b.hold_expires_at,
            (select count(*) from stay_dates s
              where s.booking_id = b.id and s.status = 'held' and s.held_until > now()) as live
       from bookings b where b.booking_no = $1`, [bookingNo]);
  const b = rows[0];
  if (!b) throw new PaymentError("NOT_FOUND", "예약을 찾을 수 없습니다", 404);
  if (b.status === "confirmed" || b.status === "completed") throw new PaymentError("INVALID_STATE", "이미 결제가 완료된 예약입니다", 409);
  if (b.status === "pending_payment") throw new PaymentError("INVALID_STATE", "이미 가상계좌가 발급된 예약입니다. 예약 조회에서 입금 정보를 확인해 주세요", 409);
  if (b.status !== "held" || Number(b.live) !== b.nights) {
    throw new PaymentError("INVALID_STATE", "날짜 확보 시간이 끝났습니다. 처음부터 다시 예약해 주세요", 409);
  }

  // 아직 결제 전인 시도가 있으면 재사용 (새로고침·재시도마다 행이 쌓이지 않게)
  const ex = await pool.query(
    `select pg_order_id from payments where booking_id = $1 and pg_provider = 'toss' and kind = 'booking' and status = 'ready'
      order by id desc limit 1`, [b.id]);
  let orderId: string = ex.rows[0]?.pg_order_id;
  if (!orderId) {
    orderId = `${bookingNo}_${randomBytes(4).toString("hex")}`;   // 6~64자, 영문·숫자·-_= 만 허용
    await pool.query(
      `insert into payments (booking_id, pg_provider, pg_order_id, kind, amount, status)
       values ($1, 'toss', $2, 'booking', $3, 'ready')`, [b.id, orderId, b.total_amount]);
  }

  let dueDate: string | null = null;
  if (method === "VIRTUAL_ACCOUNT") {
    const s = await pool.query(`select value from policy_settings where key = 'virtual_account_due_minutes'`);
    dueDate = kstLocalIso(Date.now() + Number(s.rows[0]?.value ?? 120) * 60_000);
  }
  return {
    clientKey, orderId, amount: b.total_amount as number, method,
    orderName: `${SITE.name} 한옥 ${b.nights}박`,
    bookingNo, checkIn: b.check_in as string, checkOut: b.check_out as string,
    holdExpiresAt: b.hold_expires_at as Date, dueDate,
  };
}

// ------------------------------------------------------------------
// 2) 승인: successUrl 로 돌아온 뒤 호출
// ------------------------------------------------------------------
export async function confirmPayment(
  pool: Pool,
  input: { paymentKey: string; orderId: string; amount: number },
  toss: TossClient = createTossClient(),
): Promise<ConfirmOutcome> {
  const pay = await loadByOrderId(pool, input.orderId);
  if (!pay) throw new PaymentError("NOT_FOUND", "주문 정보를 찾을 수 없습니다", 404);
  if (pay.amount !== input.amount) throw new PaymentError("AMOUNT_MISMATCH", "결제 금액이 주문 금액과 다릅니다", 400);
  if (pay.status === "paid") {
    return { kind: "confirmed", booking: await bookingSummary(pool, pay.booking_id), receiptUrl: null, already: true };
  }
  if (pay.status === "waiting_deposit") {   // 새로고침 등: 이미 발급된 가상계좌 정보를 다시 보여준다 (토스 재호출 없음)
    return waitingOutcome(pool, pay);
  }
  if (pay.status === "cancelled") throw new PaymentError("INVALID_STATE", "이미 취소된 결제입니다", 409);

  let tp: TossPayment;
  try {
    tp = await toss.confirm(input, `confirm-${input.orderId}`);
  } catch (e) {
    if (!(e instanceof TossApiError)) throw e;
    // 승인 응답이 오류여도 실제로는 승인됐을 수 있다(응답 유실·중복 호출). 반드시 조회해서 확인한다.
    const looked = await toss.getByOrderId(input.orderId).catch(() => null);
    if (looked?.status === "DONE" || looked?.status === "WAITING_FOR_DEPOSIT") {
      tp = looked;
    } else if (e.retryable && (!looked || ["READY", "IN_PROGRESS"].includes(looked.status))) {
      throw new PaymentError("UNVERIFIED", "결제 결과를 확인하는 중입니다. 잠시 후 다시 시도해 주세요. 결제되었다면 자동으로 반영됩니다", 502);
    } else {
      await pool.query(
        `update payments set status = 'failed', raw_response = $2::jsonb where id = $1 and status = 'ready'`,
        [pay.id, JSON.stringify({ error: { code: e.code, message: e.message } })]);
      return { kind: "failed", code: e.code, message: e.message };
    }
  }
  if (tp.status === "WAITING_FOR_DEPOSIT") return settleWaiting(pool, pay, tp, toss);
  if (tp.status !== "DONE") throw new PaymentError("UNVERIFIED", `결제 상태(${tp.status})를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요`, 502);
  return settlePaid(pool, pay, tp, toss);
}

function toVaInfo(va: any): VirtualAccountInfo {
  return { bankCode: String(va?.bankCode ?? ""), accountNumber: String(va?.accountNumber ?? ""), holderName: va?.holderName ?? va?.customerName ?? null, dueDate: va?.dueDate ?? null };
}

async function waitingOutcome(pool: Pool, pay: PayRow): Promise<ConfirmOutcome> {
  return { kind: "waiting_deposit", booking: await bookingSummary(pool, pay.booking_id), virtualAccount: toVaInfo(pay.virtual_account), amount: pay.amount };
}

/** 가상계좌가 발급됨(입금 전): 계좌 정보를 저장하고, 입금 기한만큼 날짜를 잡아 둔다. */
async function settleWaiting(pool: Pool, pay: PayRow, tp: TossPayment, toss: TossClient): Promise<ConfirmOutcome> {
  const va = tp.virtualAccount;
  if (tp.totalAmount !== pay.amount || !va?.accountNumber) {
    await cancelUnpaidAccount(pool, pay, tp.paymentKey, "가상계좌 정보 확인 실패로 자동 취소", toss);
    throw new PaymentError("UNVERIFIED", "가상계좌를 발급하지 못했습니다. 다시 시도해 주세요", 502);
  }
  const stored = { bankCode: String(va.bankCode ?? ""), accountNumber: String(va.accountNumber), holderName: va.customerName ?? null,
    dueDate: va.dueDate ?? null, secretHash: tp.secret ? sha(tp.secret) : null };   // 입금 웹훅 검증용. 비밀값 원문은 저장하지 않는다
  await pool.query(
    `update payments set status = 'waiting_deposit', pg_payment_key = $2, method = $3,
            virtual_account = $4::jsonb, raw_response = $5::jsonb
      where id = $1 and status in ('ready', 'failed')`,
    [pay.id, tp.paymentKey, tp.method ?? "가상계좌", JSON.stringify(stored), JSON.stringify(tp.raw)]);

  const until = await extendHoldForVirtualAccount(pool, pay.booking_id);
  if (!until) {   // 계좌 발급 사이에 날짜를 잃음 → 돈이 들어오기 전에 계좌를 닫는다
    await cancelUnpaidAccount(pool, pay, tp.paymentKey, "선택하신 날짜를 확보하지 못해 가상계좌를 자동 취소", toss);
    return { kind: "unavailable", booking: await bookingSummary(pool, pay.booking_id) };
  }
  await notify(pool, { type: "deposit_waiting", bookingId: pay.booking_id });   // 입금 안내(계좌·금액·기한)를 문자로도 보낸다
  return { kind: "waiting_deposit", booking: await bookingSummary(pool, pay.booking_id), virtualAccount: toVaInfo(stored), amount: pay.amount };
}

/** 입금 전 가상계좌 취소(환불할 돈이 없다). 실패하면 크게 알린다: 나중에 입금되면 수동 환불이 필요해진다. */
export async function cancelUnpaidAccount(pool: Pool, pay: Pick<PayRow, "id">, paymentKey: string, reason: string, toss: TossClient) {
  try {
    await toss.cancel(paymentKey, { cancelReason: reason }, `va-cancel-${pay.id}`);
    await pool.query(`update payments set status = 'cancelled' where id = $1 and status in ('waiting_deposit','ready')`, [pay.id]);
    return true;
  } catch (e) {
    console.error(`[ALERT] 가상계좌 취소 실패 — 토스 대시보드에서 직접 취소 필요. payment=${pay.id} paymentKey=${paymentKey}`, e);
    return false;
  }
}

/** 토스에서 DONE 이 확인된 결제를 DB에 반영하고 예약을 확정한다. 확정할 수 없으면 자동 환불. */
async function settlePaid(pool: Pool, pay: PayRow, tp: TossPayment, toss: TossClient): Promise<ConfirmOutcome> {
  if (tp.totalAmount !== pay.amount) {
    const ok = await refundFull(pool, pay, tp.paymentKey, "결제 금액 불일치로 자동 환불", toss);
    await notify(pool, { type: "auto_refunded", bookingId: pay.booking_id, refund: { amount: pay.amount, deduct: 0, done: ok } });
    return { kind: "refunded", reason: "AMOUNT_MISMATCH", refundOk: ok, booking: await bookingSummary(pool, pay.booking_id) };
  }
  const r = await withTx(pool, async (c) => {
    const { rows } = await c.query(`select status from payments where id = $1 for update`, [pay.id]);
    const st = rows[0].status as string;
    if (st === "paid") return { ok: true as const, already: true };
    if (st === "cancelled") return { ok: false as const, reason: "CANCELLED" as const };
    await c.query(
      `update payments set status = 'paid', pg_payment_key = $2, method = $3,
              paid_at = coalesce($4::timestamptz, now()), raw_response = $5::jsonb where id = $1`,
      [pay.id, tp.paymentKey, tp.method, tp.approvedAt, JSON.stringify(tp.raw)]);
    await recordCashReceipt(c, pay.id, tp);
    const cs = await confirmStay(c, pay.booking_id);
    return cs.ok ? { ok: true as const, already: false } : { ok: false as const, reason: cs.reason === "CANCELLED" ? "CANCELLED" as const : "HOLD_LOST" as const };
  });
  if (r.ok) {
    if (!r.already) await notify(pool, { type: "booking_confirmed", bookingId: pay.booking_id });   // 손님 확정 안내 + 사장님 새 예약 알림
    return { kind: "confirmed", booking: await bookingSummary(pool, pay.booking_id), receiptUrl: tp.receiptUrl ?? tp.cashReceipt?.receiptUrl ?? null, already: r.already };
  }
  const reason = r.reason === "CANCELLED" ? "CANCELLED" : "HOLD_LOST";
  const ok = await refundFull(pool, pay, tp.paymentKey,
    reason === "CANCELLED" ? "예약이 취소되어 자동 환불" : "선택하신 날짜가 이미 다른 예약으로 확정되어 자동 환불", toss);
  await notify(pool, { type: "auto_refunded", bookingId: pay.booking_id, refund: { amount: pay.amount, deduct: 0, done: ok } });
  return { kind: "refunded", reason, refundOk: ok, booking: await bookingSummary(pool, pay.booking_id) };
}

/** 현금영수증 발급 내역 기록. 토스가 결제와 연동해 자동 발급하며, 결제를 취소하면 자동으로 함께 취소된다. */
async function recordCashReceipt(db: Db, paymentId: number, tp: TossPayment) {
  const cr = tp.cashReceipt;
  if (!cr || cr.type === "미발행") return;
  await db.query(
    `insert into cash_receipts (payment_id, type, identifier_enc, receipt_no, status, issued_at)
     select $1::bigint, $2, $3, $4, 'issued', now()
      where not exists (select 1 from cash_receipts where payment_id = $1::bigint)`,
    [paymentId, cr.type === "지출증빙" ? "expense" : "income", encryptText("-"), cr.issueNumber ?? cr.receiptKey ?? null]);
}

/** 전액 환불. 토스 취소가 실패하면 manual_needed 로 남기고 로그를 크게 남긴다(사장님 확인 필요). */
async function refundFull(pool: Pool, pay: PayRow, paymentKey: string, reason: string, toss: TossClient): Promise<boolean> {
  const ins = await pool.query(
    `insert into refunds (booking_id, payment_id, amount, deduct_amount, reason, status)
     values ($1, $2, $3, 0, $4, 'requested') returning id`, [pay.booking_id, pay.id, pay.amount, reason]);
  const refundId = ins.rows[0].id;
  try {
    const t = await toss.cancel(paymentKey, { cancelReason: reason }, `cancel-full-${pay.id}`);
    const last = t.cancels?.[t.cancels.length - 1];
    await pool.query(`update refunds set status = 'done', refunded_at = now(), pg_cancel_key = $2 where id = $1`, [refundId, last?.transactionKey ?? null]);
    await pool.query(`update payments set status = 'cancelled' where id = $1`, [pay.id]);
    await pool.query(`update cash_receipts set status = 'cancelled', cancelled_at = now() where payment_id = $1`, [pay.id]);
    return true;
  } catch (e) {
    await pool.query(`update refunds set status = 'manual_needed' where id = $1`, [refundId]);
    await notify(pool, { type: "owner_refund_failed", refundId });
    console.error(`[ALERT] 자동 환불 실패 — 토스 대시보드에서 직접 취소 필요(가상계좌는 환불 계좌 확인 필요). payment=${pay.id} paymentKey=${paymentKey}`, e);
    return false;
  }
}

// ------------------------------------------------------------------
// 3) 웹훅/대사: 토스의 실제 상태를 조회해 DB를 맞춘다 (본문은 신뢰하지 않음)
// ------------------------------------------------------------------
export async function reconcileByOrderId(pool: Pool, orderId: string, toss: TossClient = createTossClient()) {
  const pay = await loadByOrderId(pool, orderId);
  if (!pay) return "ignored" as const;          // 우리 주문이 아님
  const tp = await toss.getByOrderId(orderId);

  if (tp.status === "DONE" && pay.status !== "paid" && pay.status !== "cancelled") {
    await settlePaid(pool, pay, tp, toss);       // 카드 승인 누락분, 가상계좌 입금 완료
    return "settled" as const;
  }
  if (tp.status === "DONE" && pay.status === "paid" && tp.cashReceipt) {
    await recordCashReceipt(pool, pay.id, tp);   // 현금영수증 정보가 나중에 붙는 경우
    return "noop" as const;
  }
  if ((tp.status === "CANCELED" || tp.status === "EXPIRED") && pay.status === "waiting_deposit") {
    if (await closeWaiting(pool, pay, tp.status)) await notify(pool, { type: "deposit_expired", bookingId: pay.booking_id });   // 입금 전에 계좌가 닫힘(기한 만료·취소)
    return "closed" as const;
  }
  if ((tp.status === "CANCELED" || tp.status === "PARTIAL_CANCELED") && pay.status === "paid") {
    await pool.query(`update payments set status = $2 where id = $1`,
      [pay.id, tp.status === "CANCELED" ? "cancelled" : "partial_cancelled"]);
    // 우리 시스템이 시작한 환불(refunds 행이 있음)이면 정상 흐름이므로 경고하지 않는다
    const ours = await pool.query(`select 1 from refunds where payment_id = $1 limit 1`, [pay.id]);
    if (ours.rowCount === 0) {
      console.warn(`[REVIEW] 토스에서 결제가 취소됨 — 예약 ${pay.booking_no} 의 취소/재고 처리를 확인하세요`);
      return "cancel_recorded" as const;
    }
    return "synced" as const;
  }
  if (tp.status === "WAITING_FOR_DEPOSIT" && pay.status === "paid") {
    console.warn(`[REVIEW] 입금 오류로 결제가 입금 대기로 되돌아감 — 예약 ${pay.booking_no} 고객에게 재입금 안내 필요`);
    return "deposit_error" as const;
  }
  if (["EXPIRED", "ABORTED"].includes(tp.status) && pay.status === "ready") {
    await pool.query(`update payments set status = $2 where id = $1`, [pay.id, tp.status === "EXPIRED" ? "expired" : "failed"]);
    return "closed" as const;
  }
  return "noop" as const;
}

/** 입금 전 가상계좌가 만료·취소됨: 결제를 닫고 예약을 취소해 날짜를 풀어 준다 */
async function closeWaiting(pool: Pool, pay: PayRow, tossStatus: string): Promise<boolean> {
  let closed = false;
  await withTx(pool, async (c) => {
    const { rows } = await c.query(`select status from payments where id = $1 for update`, [pay.id]);
    if (rows[0].status !== "waiting_deposit") return;
    await c.query(`update payments set status = $2 where id = $1`, [pay.id, tossStatus === "EXPIRED" ? "expired" : "cancelled"]);
    try {
      await cancelStay(c, pay.booking_id, { by: "system", reason: "가상계좌 입금 기한 만료" });
      closed = true;
    } catch (e) {
      if (!(e instanceof StayError)) throw e;   // 이미 취소·확정된 예약이면 그대로 둔다
    }
  });
  return closed;
}

/**
 * 입금 기한이 지난 입금 대기 건을 토스 실제 상태와 맞춘다 (크론/수동 실행).
 * 웹훅을 놓쳤거나 토스가 만료 웹훅을 보내지 않는 경우의 안전망.
 */
export async function reconcileWaitingDeposits(pool: Pool, toss: TossClient = createTossClient()) {
  const { rows } = await pool.query(
    `select p.pg_order_id from payments p join bookings b on b.id = p.booking_id
      where p.pg_provider = 'toss' and p.status = 'waiting_deposit' and b.hold_expires_at < now() - interval '1 minute'`);
  const out: { orderId: string; result: string }[] = [];
  for (const r of rows) {
    try { out.push({ orderId: r.pg_order_id, result: await reconcileByOrderId(pool, r.pg_order_id, toss) }); }
    catch (e) { out.push({ orderId: r.pg_order_id, result: "error" }); console.error("[reconcile]", r.pg_order_id, e); }
  }
  return out;
}
