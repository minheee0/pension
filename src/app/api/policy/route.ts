import { NextResponse } from "next/server";
import { pool } from "@/server/db";
import { getPolicyView } from "@/server/booking/policy";
import { apiError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/policy → 환불표·성수기·변경/옵션 규정 (예약 화면에서 표시)
export async function GET(req: Request) {
  try {
    const rl = rateLimit(`policy:${clientIp(req)}`, 60, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    return NextResponse.json(await getPolicyView(pool), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
