import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/db";
import { confirmPayment } from "@/server/payments/service";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().min(6).max(64),
  amount: z.number().int().positive(),
});

// POST /api/payments/confirm  (successUrl 페이지가 호출) → 승인 + 예약 확정. 여러 번 호출해도 안전하다.
export async function POST(req: Request) {
  try {
    const rl = rateLimit(`pay-confirm:${clientIp(req)}`, 30, 10 * 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
    }
    const input = body.parse(await req.json().catch(() => ({})));
    const outcome = await confirmPayment(pool, input);
    return NextResponse.json(outcome, { status: outcome.kind === "failed" ? 402 : 200 });
  } catch (e) {
    return apiError(e);
  }
}
