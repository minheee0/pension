import { z } from "zod";
import { pool } from "@/server/db";
import { adminRoute } from "@/server/admin/http";
import { deleteReply, deleteReview, dismissReports, hideReview, restoreReview, saveReply } from "@/server/admin/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.preprocess(Number, z.number().int().positive());
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("hide"), id, reason: z.string().default("") }),
  z.object({ op: z.literal("restore"), id }),
  z.object({ op: z.literal("dismiss"), id }),
  z.object({ op: z.literal("reply"), id, content: z.string().default("") }),
  z.object({ op: z.literal("reply_delete"), id }),
  z.object({ op: z.literal("delete"), id, reason: z.string().default("") }),
]);

// POST /api/admin/reviews — 후기 숨김·복구·신고 검토·답글·영구 삭제 (소유자만)
export const POST = adminRoute({ role: "owner", schema }, async ({ admin, body }) => {
  switch (body.op) {
    case "hide": return hideReview(pool, admin, body.id, body.reason);
    case "restore": return restoreReview(pool, admin, body.id);
    case "dismiss": return dismissReports(pool, admin, body.id);
    case "reply": return saveReply(pool, admin, body.id, body.content);
    case "reply_delete": return deleteReply(pool, admin, body.id);
    case "delete": return deleteReview(pool, admin, body.id, body.reason);
  }
});
