import { z } from "zod";
import { pool } from "@/server/db";
import { adminRoute } from "@/server/admin/http";
import { deleteOverride, deleteSeason, saveOption, saveOverride, saveSeason, setBasePrices } from "@/server/admin/pricing";
import { bool, dateStr, money } from "@/server/admin/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().positive().optional());
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("base"), weekday: money, weekend: money }),
  z.object({ op: z.literal("season_save"), id, name: z.string().trim().min(1, "이름을 입력해 주세요").max(50), dateFrom: dateStr, dateTo: dateStr,
    priceWeekday: money, priceWeekend: money, minNights: money, active: bool }),
  z.object({ op: z.literal("season_delete"), id: z.preprocess(Number, z.number().int().positive()) }),
  z.object({ op: z.literal("override_save"), date: dateStr, price: money, dayType: z.enum(["weekday", "weekend"]).default("weekend"),
    refundTier: z.enum(["off", "peak"]).default("peak"), minNights: money, memo: z.string().max(100).optional() }),
  z.object({ op: z.literal("override_delete"), date: dateStr }),
  z.object({ op: z.literal("option_save"), id: z.preprocess(Number, z.number().int().positive()), price: money, active: bool, maxQty: money,
    timeSlots: z.string().max(200).default(""), deadlineDays: money, deadlineTime: z.string().default("18:00") }),
]);

// POST /api/admin/pricing — 요금·성수기·특정일·옵션 수정 (새 예약부터 적용, 소유자만)
export const POST = adminRoute({ role: "owner", schema }, async ({ admin, body }) => {
  switch (body.op) {
    case "base": return setBasePrices(pool, admin, body);
    case "season_save": return saveSeason(pool, admin, body);
    case "season_delete": return deleteSeason(pool, admin, body.id);
    case "override_save": return saveOverride(pool, admin, body);
    case "override_delete": return deleteOverride(pool, admin, body.date);
    case "option_save": return saveOption(pool, admin, body);
  }
});
