import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { quoteStay } from "@/server/booking/hold";
import { isRangeAvailable } from "@/server/booking/queries";
import { quoteQuerySchema } from "@/server/booking/schemas";
import { apiError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/quote?checkIn=2026-10-09&checkOut=2026-10-11&guests=5
export async function GET(req: Request) {
  try {
    const rl = rateLimit(`quote:${clientIp(req)}`, 60, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);

    const q = quoteQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const quote = await quoteStay(pool, q);
    const available = await isRangeAvailable(pool, q.checkIn, q.checkOut);
    return NextResponse.json({ available, quote });
  } catch (e) {
    return apiError(e);
  }
}
