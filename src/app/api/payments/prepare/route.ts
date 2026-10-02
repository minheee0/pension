import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/db";
import { preparePayment } from "@/server/payments/service";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  bookingNo: z.string().regex(/^H[0-9A-Z]{10}$/, "예약번호 형식이 올바르지 않습니다"),
  method: z.enum(["CARD", "VIRTUAL_ACCOUNT"]).default("CARD"),
});

// POST /api/payments/prepare  { bookingNo, method } → 결제창에 넘길 주문번호·금액(서버 확정값)
export async function POST(req: Request) {
  try {
    const rl = rateLimit(`pay-prepare:${clientIp(req)}`, 20, 10 * 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
    }
    const { bookingNo, method } = body.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await preparePayment(pool, bookingNo, method));
  } catch (e) {
    return apiError(e);
  }
}
