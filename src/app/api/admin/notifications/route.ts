import { z } from "zod";
import { pool } from "@/server/db";
import { adminRoute } from "@/server/admin/http";
import { retryNotification, sendTest } from "@/server/admin/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("retry"), id: z.preprocess(Number, z.number().int().positive()) }),
  z.object({ op: z.literal("test"), channel: z.enum(["sms", "email"]) }),
]);

// POST /api/admin/notifications — 실패한 알림 재시도, 테스트 발송 (소유자만)
export const POST = adminRoute({ role: "owner", schema }, async ({ admin, body }) =>
  body.op === "retry" ? retryNotification(pool, admin, body.id) : sendTest(pool, admin, body.channel));
