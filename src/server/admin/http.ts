import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { pool } from "@/server/db";
import { apiError, jsonError, tooMany } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { getAdminByToken, readCookie } from "./auth";
import type { AdminCtx } from "./audit";
import { AdminError } from "./errors";

/**
 * 관리자 API 공통 래퍼: 요청 제한 → 같은 출처 확인(CSRF) → 로그인·권한 확인 → 입력 검증 → 실행.
 *  - 쿠키는 SameSite=Strict + HttpOnly 이고, 변경 요청은 Origin 이 같은 사이트일 때만 받는다.
 *  - role: "owner" 이면 소유자만, 생략하면 로그인한 관리자(직원 포함) 모두 가능
 */
export function adminRoute<T>(
  opts: { role?: "owner"; schema: ZodType<T> },
  handler: (c: { admin: AdminCtx; body: T; req: Request }) => Promise<unknown>,
) {
  return async (req: Request) => {
    try {
      const ip = clientIp(req);
      const rl = rateLimit(`admin:${ip}`, 240, 60_000);
      if (!rl.ok) return tooMany(rl.retryAfterSec);

      const origin = req.headers.get("origin");
      if (!origin || origin !== new URL(req.url).origin) return jsonError("FORBIDDEN", "허용되지 않은 요청입니다", 403);
      if (!req.headers.get("content-type")?.includes("application/json")) return jsonError("INVALID_INPUT", "Content-Type 은 application/json 이어야 합니다", 415);

      const admin = await getAdminByToken(pool, readCookie(req));
      if (!admin) return jsonError("UNAUTHENTICATED", "로그인이 필요합니다", 401);
      if (opts.role === "owner" && admin.role !== "owner") return jsonError("FORBIDDEN", "소유자만 할 수 있는 작업입니다", 403);

      const parsed = opts.schema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return jsonError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다", 400);

      const result = await handler({ admin: { ...admin, ip }, body: parsed.data, req });
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof AdminError) return jsonError(e.code, e.message, e.status, e.detail ? { detail: e.detail } : undefined);
      return apiError(e);
    }
  };
}
