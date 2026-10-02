import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/db";
import { cancelBooking } from "@/server/booking/cancel";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refundAccount = z.object({
  bank: z.string().regex(/^\d{2,3}$/, "은행을 선택해 주세요"),
  accountNumber: z.string().transform((s) => s.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8,20}$/, "계좌번호를 확인해 주세요")),
  holderName: z.string().trim().min(1, "예금주를 입력해 주세요").max(30),
});
const body = z.object({
  bookingNo: z.string().trim().toUpperCase().regex(/^H[0-9A-Z]{10}$/, "예약번호 형식이 올바르지 않습니다"),
  phone: z.string().min(1).max(30),
  expectedRefund: z.number().int().min(0),
  refundAccount: refundAccount.optional(),
});

// POST /api/bookings/cancel { bookingNo, phone, expectedRefund, refundAccount? }
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`cancel:${ip}`, 10, 10 * 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
    }
    const input = body.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await cancelBooking(pool, { ...input, ip }));
  } catch (e) {
    return apiError(e);
  }
}
