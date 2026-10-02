import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/db";
import { lookupBooking } from "@/server/booking/cancel";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bookingNoSchema = z.string().trim().toUpperCase().regex(/^H[0-9A-Z]{10}$/, "예약번호 형식이 올바르지 않습니다");
const body = z.object({ bookingNo: bookingNoSchema, phone: z.string().min(1, "휴대폰 번호를 입력해 주세요").max(30) });

// POST /api/bookings/lookup { bookingNo, phone } → 예약 요약 + 취소 가능 여부·환불 미리보기
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`lookup:${ip}`, 30, 10 * 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
    }
    const input = body.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await lookupBooking(pool, { ...input, ip }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
