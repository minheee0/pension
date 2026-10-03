import { z } from "zod";
import { pool } from "@/server/db";
import { reviewRoute } from "@/server/reviews/http";
import { reportReview } from "@/server/reviews/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ reviewId: z.number().int().positive(), reason: z.string(), detail: z.string().max(300).optional() });

// POST /api/reviews/report { reviewId, reason, detail? } — 누구나 신고할 수 있다(IP당 시간당 10회). 신고만으로 숨겨지지는 않는다.
export const POST = reviewRoute("review-report", 10, 60 * 60_000, schema, ({ body, inet }) => reportReview(pool, { ...body, ip: inet }));
