import { z } from "zod";
import { pool } from "@/server/db";
import { adminRoute } from "@/server/admin/http";
import { saveRefundRules, saveSettings } from "@/server/admin/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 폼에서 rate_<규정id> / s_<설정키> 이름으로 넘어온다
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("refund") }).catchall(z.string()),
  z.object({ op: z.literal("settings") }).catchall(z.string()),
]);

// POST /api/admin/policy — 환불 공제율, 운영 설정 수정 (새 예약부터 적용, 소유자만)
export const POST = adminRoute({ role: "owner", schema }, async ({ admin, body }) => {
  const entries = Object.entries(body).filter(([k]) => k !== "op") as [string, string][];
  if (body.op === "refund") {
    const updates = entries.filter(([k]) => k.startsWith("rate_")).map(([k, v]) => ({ id: Number(k.slice(5)), deductRate: /^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN }));
    return saveRefundRules(pool, admin, updates);
  }
  return saveSettings(pool, admin, Object.fromEntries(entries.filter(([k]) => k.startsWith("s_")).map(([k, v]) => [k.slice(2), v])));
});
