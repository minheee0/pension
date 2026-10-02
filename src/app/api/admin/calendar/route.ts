import { z } from "zod";
import { pool } from "@/server/db";
import { blockDates, unblockDates } from "@/server/admin/calendar";
import { adminRoute } from "@/server/admin/http";
import { dateStr } from "@/server/admin/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("block"), from: dateStr, to: dateStr, memo: z.string().max(100).optional() }),
  z.object({ op: z.literal("unblock"), from: dateStr, to: dateStr }),
]);

// POST /api/admin/calendar  { op: "block" | "unblock", from, to, memo? }  — 소유자만
export const POST = adminRoute({ role: "owner", schema }, async ({ admin, body }) =>
  body.op === "block" ? blockDates(pool, admin, body) : unblockDates(pool, admin, body));
