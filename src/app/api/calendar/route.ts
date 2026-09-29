import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { getMonthCalendar } from "@/server/booking/queries";
import { calendarQuerySchema } from "@/server/booking/schemas";
import { apiError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calendar?month=2026-10
export async function GET(req: Request) {
  try {
    const rl = rateLimit(`calendar:${clientIp(req)}`, 120, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);

    const { month } = calendarQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const days = await getMonthCalendar(pool, month);
    return NextResponse.json({ month, days }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
