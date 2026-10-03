import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { z } from "zod";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { ReviewError } from "./service";

/** 후기 API 공통: 요청 제한 → JSON 확인 → 입력 검증 → 실행 */
export function reviewRoute<T>(key: string, limit: number, windowMs: number, schema: z.ZodType<T>,
  handler: (c: { body: T; ip: string; inet: string | null }) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      const ip = clientIp(req);
      const rl = rateLimit(`${key}:${ip}`, limit, windowMs);
      if (!rl.ok) return tooMany(rl.retryAfterSec);
      if (!req.headers.get("content-type")?.includes("application/json")) return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);
      const parsed = schema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다", 400);
      const out = await handler({ body: parsed.data, ip, inet: isIP(ip) ? ip : null });
      return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof ReviewError) return jsonError(e.code, e.message, e.status);
      return apiError(e);
    }
  };
}

export const bookingNoField = z.string().trim().toUpperCase().regex(/^H[0-9A-Z]{10}$/, "예약번호 형식이 올바르지 않습니다");
export const phoneField = z.string().min(1, "휴대폰 번호를 입력해 주세요").max(30);
