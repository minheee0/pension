import type { Pool } from "pg";
import { reconcileByOrderId } from "@/server/payments/service";
import { createTossClient, type TossClient } from "@/server/payments/toss";
import { audit, type AdminCtx } from "./audit";

/**
 * 입금 대기(가상계좌) 건을 토스의 실제 상태와 맞춘다.
 * 웹훅이 오지 않는 환경(로컬 개발, 웹훅 미등록)이나 웹훅을 놓친 경우에도 관리자 화면에 입금이 바로 보이게 한다.
 *  - 토스에 조회한 결과로만 상태를 바꾼다(reconcileByOrderId). 몇 번 실행해도 안전하다.
 *  - 토스가 느리거나 오류여도 화면은 정상적으로 열린다(5초 제한, 실패는 무시하고 저장된 상태를 보여 준다).
 */
export async function syncWaitingDeposits(
  pool: Pool, admin: AdminCtx | null, opts: { bookingNo?: string; limit?: number } = {}, toss?: TossClient,
) {
  const { rows } = opts.bookingNo
    ? await pool.query(
        `select p.pg_order_id from payments p join bookings b on b.id = p.booking_id
          where p.status = 'waiting_deposit' and p.pg_provider = 'toss' and b.booking_no = $1`, [opts.bookingNo.toUpperCase()])
    : await pool.query(
        `select pg_order_id from payments where status = 'waiting_deposit' and pg_provider = 'toss' order by id desc limit $1`, [opts.limit ?? 10]);
  if (rows.length === 0) return { checked: 0, changed: 0, errors: 0 };

  let client: TossClient;
  try { client = toss ?? createTossClient({ timeoutMs: 5000 }); }
  catch { return { checked: rows.length, changed: 0, errors: rows.length }; }      // 토스 키가 없는 환경

  const results = await Promise.allSettled(rows.map((r) => reconcileByOrderId(pool, r.pg_order_id, client)));
  let changed = 0, errors = 0;
  for (const r of results) {
    if (r.status === "rejected") { errors++; console.warn("[admin-sync] 입금 상태 확인 실패", r.reason); }
    else if (r.value === "settled" || r.value === "closed") changed++;
  }
  if (changed > 0 && admin) await audit(pool, admin, "payment.sync", {}, undefined, { checked: rows.length, changed });
  return { checked: rows.length, changed, errors };
}
