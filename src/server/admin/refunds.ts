import type { Pool } from "pg";
import { processRefund } from "@/server/booking/cancel";
import { audit, type AdminCtx } from "./audit";
import { AdminError } from "./errors";

export async function listRefunds(pool: Pool, onlyOpen = false) {
  const { rows } = await pool.query(
    `select r.id::int as id, r.amount, r.deduct_amount, r.status, r.reason, r.requested_at, r.refunded_at, b.booking_no, b.guest_name,
            p.method, (r.refund_account_enc is not null) as has_account
       from refunds r join bookings b on b.id = r.booking_id join payments p on p.id = r.payment_id
      ${onlyOpen ? "where r.status in ('requested','manual_needed','failed')" : ""} order by r.id desc limit 200`);
  return rows;
}

/** 실패한 환불 다시 시도 (같은 멱등키라 중복 환불되지 않음) */
export async function retryRefund(pool: Pool, admin: AdminCtx, id: number) {
  const r = await pool.query(`select status from refunds where id = $1`, [id]);
  if (!r.rows[0]) throw new AdminError("NOT_FOUND", "환불 내역을 찾을 수 없습니다", 404);
  if (r.rows[0].status === "done") throw new AdminError("CONFLICT", "이미 완료된 환불입니다", 409);
  const ok = await processRefund(pool, id);
  await audit(pool, admin, "refund.retry", { type: "refund", id: String(id) }, { status: r.rows[0].status }, { ok });
  return { ok };
}
