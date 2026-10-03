import { z } from "zod";
import { pool } from "@/server/db";
import { bookingNoField, phoneField, reviewRoute } from "@/server/reviews/http";
import { createReview, deleteOwnReview, updateReview } from "@/server/reviews/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const content = { rating: z.unknown(), details: z.unknown().optional(), content: z.unknown() };
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), bookingNo: bookingNoField, phone: phoneField, ...content }),
  z.object({ op: z.literal("update"), bookingNo: bookingNoField, phone: phoneField, ...content }),
  z.object({ op: z.literal("delete"), bookingNo: bookingNoField, phone: phoneField }),
]);

// POST /api/reviews { op: "create" | "update" | "delete", bookingNo, phone, rating?, details?, content? }
export const POST = reviewRoute("review-write", 10, 10 * 60_000, schema, async ({ body, ip }) => {
  if (body.op === "delete") return deleteOwnReview(pool, { ...body, ip });
  return body.op === "create" ? createReview(pool, { ...body, ip }) : updateReview(pool, { ...body, ip });
});
