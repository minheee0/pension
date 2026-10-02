import { z } from "zod";
import { pool } from "@/server/db";
import { adminRoute } from "@/server/admin/http";
import { retryRefund } from "@/server/admin/refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ op: z.literal("retry"), id: z.preprocess(Number, z.number().int().positive()) });

// POST /api/admin/refunds { op: "retry", id } — 실패한 환불 재시도 (소유자만)
export const POST = adminRoute({ role: "owner", schema }, async ({ admin, body }) => retryRefund(pool, admin, body.id));
