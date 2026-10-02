import { z } from "zod";
import { pool } from "@/server/db";
import { adminCancelBooking, previewAdminCancel } from "@/server/admin/bookings";
import { adminRoute } from "@/server/admin/http";
import { bookingNo, needOwner } from "@/server/admin/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mode = z.enum(["host", "policy"]);
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("preview"), bookingNo, mode }),
  z.object({
    op: z.literal("cancel"), bookingNo, mode, expectedRefund: z.number().int().min(0),
    refundAccount: z.object({
      bank: z.string().regex(/^\d{2,3}$/, "은행을 선택해 주세요"),
      accountNumber: z.string().transform((s) => s.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8,20}$/, "계좌번호를 확인해 주세요")),
      holderName: z.string().trim().min(1, "예금주를 입력해 주세요").max(30),
    }).optional(),
  }),
]);

// POST /api/admin/bookings  { op: "preview" | "cancel", ... }  — 취소는 소유자만
export const POST = adminRoute({ schema }, async ({ admin, body }) => {
  if (body.op === "preview") return previewAdminCancel(pool, body.bookingNo, body.mode);
  needOwner(admin);
  return adminCancelBooking(pool, admin, body);
});
