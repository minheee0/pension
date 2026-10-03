import { z } from "zod";
import { pool } from "@/server/db";
import { bookingNoField, phoneField, reviewRoute } from "@/server/reviews/http";
import { getReviewState } from "@/server/reviews/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/reviews/status { bookingNo, phone } → 후기를 쓸 수 있는지 / 이미 쓴 후기
export const POST = reviewRoute("review-status", 40, 10 * 60_000, z.object({ bookingNo: bookingNoField, phone: phoneField }),
  ({ body, ip }) => getReviewState(pool, { ...body, ip }));
