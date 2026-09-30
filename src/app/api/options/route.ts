import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { apiError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/options → 지금 신청 가능한(active) 유료 옵션 목록. 가격을 넣고 활성화하기 전에는 빈 배열.
export async function GET(req: Request) {
  try {
    const rl = rateLimit(`options:${clientIp(req)}`, 60, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);

    const { rows } = await pool.query(
      `select id::int as id, code, name, description, price, unit_type, max_qty, time_slots,
              order_deadline_days_before, order_deadline_time::text as order_deadline_time
         from options where active order by sort_order, id`,
    );
    return NextResponse.json({
      options: rows.map((r) => ({
        id: r.id, code: r.code, name: r.name, description: r.description, price: r.price,
        unitType: r.unit_type, maxQty: r.max_qty, timeSlots: r.time_slots,
        deadlineDaysBefore: r.order_deadline_days_before,
        deadlineTime: String(r.order_deadline_time).slice(0, 5),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
