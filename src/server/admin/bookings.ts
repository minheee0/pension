import type { Pool } from "pg";
import { executeCancel, assessCancel, type CancelAssessment, type RefundAccount } from "@/server/booking/cancel";
import type { BookingRow } from "@/server/booking/lookup";
import { decryptText } from "@/server/crypto";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

const STATUSES = ["held", "pending_payment", "confirmed", "completed", "cancelled", "expired", "no_show"] as const;
const PAGE = 30;

export async function listBookings(pool: Pool, f: { q?: string; status?: string; from?: string; to?: string; outFrom?: string; outTo?: string; page?: number }) {
  const where: string[] = [], args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  const q = (f.q ?? "").trim();
  if (q) {
    if (/^H[0-9A-Z]{2,10}$/i.test(q)) add("b.booking_no like ?", q.toUpperCase() + "%");
    else if (/^\d{4}$/.test(q)) add("b.guest_phone_last4 = ?", q);
    else add("b.guest_name ilike ?", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  }
  const statuses = (f.status ?? "").split(",").map((x) => x.trim()).filter((x) => (STATUSES as readonly string[]).includes(x));   // "confirmed,completed" 처럼 여러 개 가능
  if (statuses.length) add("b.status = any(?::text[])", statuses);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) add("b.check_in >= ?::date", f.from);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) add("b.check_in <= ?::date", f.to);
  if (f.outFrom && /^\d{4}-\d{2}-\d{2}$/.test(f.outFrom)) add("b.check_out >= ?::date", f.outFrom);
  if (f.outTo && /^\d{4}-\d{2}-\d{2}$/.test(f.outTo)) add("b.check_out <= ?::date", f.outTo);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const page = Math.max(0, f.page ?? 0);
  const total = (await pool.query(`select count(*)::int as n from bookings b ${w}`, args)).rows[0].n as number;
  const { rows } = await pool.query(
    `select b.booking_no, b.status, b.guest_name, b.guest_phone_last4::text as last4, b.check_in::text as check_in, b.check_out::text as check_out,
            b.nights, b.guests, b.total_amount, b.created_at, p.status as pay_status, p.method as pay_method
       from bookings b
       left join lateral (select status, method from payments where booking_id = b.id and kind = 'booking' order by id desc limit 1) p on true
       ${w} order by b.created_at desc limit ${PAGE} offset ${page * PAGE}`, args);
  return { rows, total, page, pageSize: PAGE };
}

async function bookingRowByNo(pool: Pool, bookingNo: string): Promise<BookingRow & { guest_phone_enc: string; guest_email: string | null; request_memo: string | null }> {
  const { rows } = await pool.query(
    `select id, booking_no, status, guest_name, guest_phone_last4::text as guest_phone_last4, guest_phone_enc, guest_email, request_memo,
            check_in::text as check_in, check_out::text as check_out, nights, guests,
            room_total, extra_guest_fee, option_total, discount_amount, total_amount, created_at, price_snapshot, policy_snapshot
       from bookings where booking_no = $1`, [bookingNo.toUpperCase()]);
  if (!rows[0]) throw new AdminError("NOT_FOUND", "예약을 찾을 수 없습니다", 404);
  return rows[0];
}

export async function getBookingDetail(pool: Pool, admin: AdminCtx, bookingNo: string) {
  const b = await bookingRowByNo(pool, bookingNo);
  const [nights, options, payments, refunds, receipts] = await Promise.all([
    pool.query(`select date::text as date, price, rule_applied, refund_tier, day_type from booking_nights where booking_id = $1 order by date`, [b.id]),
    pool.query(`select o.name, bo.qty, bo.unit_price, bo.amount, bo.use_date::text as use_date, bo.use_time, bo.status
                  from booking_options bo join options o on o.id = bo.option_id where bo.booking_id = $1`, [b.id]),
    pool.query(`select id, pg_order_id, status, method, amount, paid_at, kind, virtual_account->>'accountNumber' as account_number, virtual_account->>'dueDate' as due_date,
                       raw_response->'receipt'->>'url' as receipt_url, raw_response->'cashReceipt'->>'receiptUrl' as cash_receipt_url
                  from payments where booking_id = $1 order by id`, [b.id]),
    pool.query(`select id, amount, deduct_amount, status, reason, requested_at, refunded_at, (refund_account_enc is not null) as has_account from refunds where booking_id = $1 order by id`, [b.id]),
    pool.query(`select cr.type, cr.status, cr.receipt_no, cr.issued_at from cash_receipts cr join payments p on p.id = cr.payment_id where p.booking_id = $1`, [b.id]),
  ]);
  await audit(pool, admin, "booking.view", { type: "booking", id: b.booking_no });   // 전화번호 원문을 화면에 보이므로 열람 기록을 남긴다
  return {
    booking: {
      bookingNo: b.booking_no, status: b.status, guestName: b.guest_name, phone: decryptText(b.guest_phone_enc), email: b.guest_email, memo: b.request_memo,
      checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, guests: b.guests,
      roomTotal: b.room_total, extraGuestFee: b.extra_guest_fee, optionTotal: b.option_total, totalAmount: b.total_amount, createdAt: b.created_at,
    },
    nights: nights.rows, options: options.rows, payments: payments.rows, refunds: refunds.rows, cashReceipts: receipts.rows,
  };
}

export type CancelMode = "host" | "policy";   // host = 사업자 사정(전액 환불), policy = 환불 규정 적용

export async function previewAdminCancel(pool: Pool, bookingNo: string, mode: CancelMode): Promise<CancelAssessment> {
  const b = await bookingRowByNo(pool, bookingNo);
  const pay = (await pool.query(`select id, amount, pg_payment_key, method from payments where booking_id = $1 and kind = 'booking' and status = 'paid' order by id desc limit 1`, [b.id])).rows[0] ?? null;
  return assessCancel(b, pay, new Date(), { cause: mode === "host" ? "host" : "guest", allowAfterStart: true });
}

export async function adminCancelBooking(pool: Pool, admin: AdminCtx, p: { bookingNo: string; mode: CancelMode; expectedRefund: number; refundAccount?: RefundAccount }) {
  const b = await bookingRowByNo(pool, p.bookingNo);
  const result = await executeCancel(pool, b, {
    expectedRefund: p.expectedRefund, refundAccount: p.refundAccount, cause: p.mode === "host" ? "host" : "guest", by: "admin", allowAfterStart: true,
  });
  await audit(pool, admin, "booking.cancel", { type: "booking", id: b.booking_no }, { status: b.status },
    { mode: p.mode, refund: result.refund && { amount: result.refund.amount, deduct: result.refund.deductAmount, done: result.refund.done }, refundAccount: p.refundAccount ? "provided" : undefined });
  return result;
}
